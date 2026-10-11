"""Moto tests are local doubles, never evidence of deployed AWS execution."""
import copy
import json
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
pytest.importorskip('moto', reason='Install backend/requirements-cloud-test.txt for optional cloud tests')
import boto3
from moto import mock_aws
from app import cloud_handler
from app.dynamo import DynamoStore, RevisionConflict, SessionExpired, QuotaExceeded, session_key
from app.engine import ComputeRequest, execute, InvalidResult, SolverUnavailable
from app.models import Scenario
from app.scenarios import sample
from botocore.exceptions import ClientError


@pytest.fixture
def cloud(monkeypatch):
    with mock_aws():
        client = boto3.client('dynamodb', region_name='ap-south-1')
        client.create_table(TableName='drystock-test',
            AttributeDefinitions=[{'AttributeName': x, 'AttributeType': 'S'} for x in ('pk', 'sk')],
            KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
            BillingMode='PROVISIONED', ProvisionedThroughput={'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5})
        clock = [100000]
        store = DynamoStore(client, 'drystock-test', clock=lambda: clock[0])
        monkeypatch.setattr(cloud_handler, '_store', store)
        monkeypatch.setenv('DRYSTOCK_ORIGIN', 'https://example.cloudfront.net')
        yield store, clock


def call(path, token='', body=None, method='POST', **extra):
    headers = {'authorization': 'Bearer ' + token} if token else {}
    event = {'rawPath': path, 'requestContext': {'http': {'method': method}},
             'headers': headers, 'body': json.dumps(body or {}), **extra}
    raw = cloud_handler.handler(event, SimpleNamespace(aws_request_id='test-request', get_remaining_time_in_millis=lambda: 30000))
    return raw['statusCode'], json.loads(raw['body'])


def session():
    code, result = call('/api/sessions')
    assert code == 201
    return result['token']


def generate(store, token):
    loaded = store.load(token)
    result = execute(ComputeRequest(scenario=Scenario.model_validate(loaded['state']['scenario'])), backend='aws')
    return store.save_plan(loaded, loaded['state']['revision'], result)


def test_tokens_isolation_reset_and_history(cloud):
    store, _ = cloud
    a, b = session(), session()
    assert len(a) == len(b) == 43 and a != b
    initial = generate(store, a)
    assert store.load(b)['state']['latest'] is None
    assert store.history(store.load(b)) == []
    assert a not in json.dumps(store.client.scan(TableName=store.table))
    assert call(f"/api/plans/{initial['latest']['id']}/approve", b, {'revision': 0})[0] == 409
    assert call('/api/reset', a, {'revision': 0})[0] == 200
    assert store.load(b)['state']['revision'] == 0
    assert store.load(a)['state']['revision'] == 1


def test_expiry_enforced_before_ttl_removal(cloud):
    store, clock = cloud
    token = session()
    loaded = store.load(token)
    clock[0] += 14400
    assert call('/api/state', token, method='GET')[0] == 401
    with pytest.raises(RevisionConflict):
        store.commit(loaded, loaded['state'])
    assert store.client.get_item(TableName=store.table, Key=store.key(session_key(token))).get('Item')


@pytest.mark.parametrize('token', ['', 'guess', 'a' * 42, 'a' * 43])
def test_missing_or_unknown_token_rejected(cloud, token):
    assert call('/api/state', token, method='GET')[0] == 401


def test_atomic_approval_and_internal_version_conflict(cloud):
    store, _ = cloud
    token = session()
    state = generate(store, token)
    pid = state['latest']['id']
    first, stale = store.load(token), store.load(token)
    store.approve(first, pid, 0)
    with pytest.raises(RevisionConflict):
        store.approve(stale, pid, 0)
    assert store.history(store.load(token))[0]['state'] == 'approved'
    assert call(f'/api/plans/{pid}/approve', token, {'revision': 1})[0] == 409


def test_full_cloud_contract_workflow_and_reload(cloud):
    store, _ = cloud
    token = session()
    code, initial = call('/api/plans', token, {'revision': 0})
    assert code == 200
    assert initial['latest']['plan']['planned_saved_inr'] == 35809
    assert max(p['planned_saved_inr'] for p in initial['latest']['comparisons']) == 35550
    assert initial['latest']['execution']['runtime']['aws_request_id'] == 'test-request'
    pid = initial['latest']['id']
    complete = f'/api/plans/{pid}/tasks/L02/complete'
    assert call(complete, token, {'revision': 0})[0] == 409
    assert call(f'/api/plans/{pid}/approve', token, {'revision': 0})[0] == 200
    code, state = call(complete, token, {'revision': 0})
    assert code == 200 and state['revision'] == 1
    assert call(complete, token, {'revision': 1})[0] == 409
    assert state['scenario']['completed'][0]['tarp_id'] == 'T2'
    changes = {'revision': 1, 'deadline': 35, 'now_minute': 12, 'forklift_enabled': False, 'disabled_workers': []}
    code, disrupted = call('/api/disruptions', token, changes)
    assert code == 200 and disrupted['latest']['state'] == 'superseded'
    assert call(f'/api/plans/{pid}/approve', token, {'revision': 2})[0] == 409
    code, revised = call('/api/plans', token, {'revision': 2})
    assert code == 200
    assert revised['latest']['plan']['planned_saved_inr'] == 16821
    assert max(p['planned_saved_inr'] for p in revised['latest']['comparisons']) == 14985
    tasks = revised['latest']['plan']['tasks']
    assert all(t['start'] >= 12 and t['end'] <= 35 and not t['forklift_id'] and t['tarp_id'] != 'T2' for t in tasks)
    assert call('/api/state', token, method='GET')[1] == revised
    history = call('/api/plans', token, method='GET')[1]
    assert len(history) == 2 and history[1]['state'] == 'superseded'
    # Separate client instance proves no in-process authoritative cache is needed.
    new_store = DynamoStore(boto3.client('dynamodb', region_name='ap-south-1'), store.table, store.clock)
    assert new_store.load(token)['state'] == revised


@pytest.mark.parametrize('changes', [
    {'deadline': 35, 'now_minute': 0, 'forklift_enabled': False, 'disabled_workers': ['unknown']},
    {'deadline': 241, 'now_minute': 0, 'forklift_enabled': False},
    {'deadline': 10, 'now_minute': 12, 'forklift_enabled': False},
    {'deadline': 35, 'now_minute': 0, 'forklift_enabled': False, 'scenario': {}}
])
def test_invalid_change_is_not_persisted(cloud, changes):
    store, _ = cloud
    token = session()
    assert call('/api/disruptions', token, {'revision': 0, **changes})[0] == 422
    assert store.load(token)['state']['scenario'] == sample().model_dump()


def test_tampered_output_and_baseline_rejected(cloud):
    store, _ = cloud
    token = session()
    result = execute(ComputeRequest(scenario=sample()), backend='aws')
    result.comparisons[0].residual_loss_inr += 1
    with pytest.raises(InvalidResult):
        store.save_plan(store.load(token), 0, result)
    assert store.load(token)['state']['latest'] is None


def test_invalid_plan_route(cloud):
    token = session()
    plan = execute(ComputeRequest(scenario=sample())).plan.model_dump()
    plan['tasks'][0]['end'] = 999
    code, validation = call('/api/validate', token, {'revision': 0, 'plan': plan})
    assert code == 200 and validation['valid'] is False


def test_compute_failure_leaves_existing_state(cloud, monkeypatch):
    store, _ = cloud
    token = session()
    def fail(*args, **kwargs):
        raise SolverUnavailable('UNKNOWN')
    monkeypatch.setattr(cloud_handler, 'execute', fail)
    assert call('/api/plans', token, {'revision': 0})[0] == 503
    assert store.load(token)['state']['latest'] is None
    assert 'leaseUntil' not in store.client.get_item(TableName=store.table, Key=store.key(session_key(token)))['Item']


def test_request_size_cors_and_no_public_scenario_upload(cloud):
    assert call('/api/sessions', body={'scenario': {}})[0] == 422
    assert call('/api/sessions', body={'padding': 'x' * 40000})[0] == 413
    assert call('/api/sessions', headers={'origin': 'https://evil.example'})[0] == 403
    assert call('/api/sessions', headers={'origin': 'https://example.cloudfront.net'})[0] == 201


@pytest.mark.parametrize('path, raw_body', [
    ('/api/sessions', ''),
    ('/api/state', ''),
    ('/api/sessions', 'not JSON'),
])
def test_allowed_preflight_needs_no_token_body_or_storage(monkeypatch, path, raw_body):
    origin = 'https://example.cloudfront.net'
    monkeypatch.setenv('DRYSTOCK_ORIGIN', origin)
    get_store = Mock(side_effect=AssertionError('Preflight must not access DynamoDB'))
    monkeypatch.setattr(cloud_handler, 'get_store', get_store)
    event = {'rawPath': path, 'requestContext': {'http': {'method': 'OPTIONS'}},
             'headers': {'origin': origin, 'access-control-request-method': 'POST',
                         'access-control-request-headers': 'content-type,authorization'},
             'body': raw_body}

    result = cloud_handler.handler(event, None)

    assert result['statusCode'] == 204
    assert result['body'] == ''
    assert result['headers']['Access-Control-Allow-Origin'] == origin
    assert result['headers']['Vary'] == 'Origin'
    assert result['headers']['Access-Control-Allow-Methods'] == 'GET, POST, OPTIONS'
    assert result['headers']['Access-Control-Allow-Headers'] == 'Content-Type, Authorization'
    assert result['headers']['Access-Control-Max-Age'] == '300'
    get_store.assert_not_called()


def test_disallowed_preflight_origin_is_rejected_without_storage(monkeypatch):
    monkeypatch.setenv('DRYSTOCK_ORIGIN', 'https://example.cloudfront.net')
    get_store = Mock(side_effect=AssertionError('Rejected origins must not access DynamoDB'))
    monkeypatch.setattr(cloud_handler, 'get_store', get_store)
    event = {'rawPath': '/api/sessions', 'requestContext': {'http': {'method': 'OPTIONS'}},
             'headers': {'origin': 'https://evil.example'}}

    result = cloud_handler.handler(event, None)

    assert result['statusCode'] == 403
    assert 'Access-Control-Allow-Origin' not in result['headers']
    get_store.assert_not_called()


def test_quota_and_concurrent_compute_guard(cloud):
    store, _ = cloud
    token = session()
    loaded = store.load(token)
    store.compute_lease(loaded)
    with pytest.raises(QuotaExceeded):
        store.compute_lease(loaded)
    store.release_lease(loaded)
    store.client.update_item(TableName=store.table, Key=store.key(loaded['pk']),
        UpdateExpression='SET requests = :n', ExpressionAttributeValues={':n': {'N': '300'}})
    assert call('/api/state', token, method='GET')[0] == 429


def test_global_quotas_are_conditional(cloud):
    store, _ = cloud
    store.global_quota('small-test', 1, 60)
    with pytest.raises(QuotaExceeded):
        store.global_quota('small-test', 1, 60)


def test_sanitized_storage_error(cloud, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError('private secret test')
    monkeypatch.setattr(cloud_handler, 'get_store', fail)
    code, body = call('/api/sessions')
    assert code == 503 and 'secret' not in json.dumps(body)


def test_cleanup_failure_does_not_hide_committed_success(cloud, monkeypatch, capsys):
    store, _ = cloud
    token = session()
    def fail(*args, **kwargs):
        raise RuntimeError('private cleanup detail')
    monkeypatch.setattr(store, 'release_lease', fail)
    code, state = call('/api/plans', token, {'revision': 0})
    assert code == 200 and state['latest']['plan']['planned_saved_inr'] == 35809
    assert store.load(token)['state'] == state
    assert 'private' not in capsys.readouterr().out


def test_transaction_capacity_error_is_unavailable_not_revision_conflict(cloud, monkeypatch):
    store, _ = cloud
    token = session()
    def fail(*args, **kwargs):
        raise ClientError({'Error': {'Code': 'TransactionCanceledException'},
            'CancellationReasons': [{'Code': 'ProvisionedThroughputExceeded'}]}, 'TransactWriteItems')
    monkeypatch.setattr(store.client, 'transact_write_items', fail)
    assert call('/api/plans', token, {'revision': 0})[0] == 503
    assert store.load(token)['state']['latest'] is None
