"""Reproduce the deployed write amplification with a bounded offline budget.

Expected 503s are the original failure, not evidence that a fix is deployed.
"""
from concurrent.futures import ThreadPoolExecutor
import copy
import json
import pytest
pytest.importorskip('moto', reason='Requires the optional cloud test dependencies')
from test_cloud import cloud, call, session, generate
from dynamo_capacity_model import CapacityMeter, WriteBudget, item_bytes, write_units
from app.dynamo import session_key


def test_capacity_rounding_and_shrinking_transaction():
    small = {'data': {'S': 'a' * 100}}
    large = {'data': {'S': 'a' * 2048}}
    assert item_bytes(large) == 2052
    assert write_units(small, large) == 3
    assert write_units(large, small, transactional=True) == 6
    assert item_bytes({'label': {'S': '₹'}}) == 8


def test_get_request_counter_charges_entire_generated_state(cloud):
    store, _ = cloud
    token = session()
    generated = generate(store, token)
    meter = CapacityMeter(store.client)
    store.client = meter
    assert call('/api/state', token, method='GET')[0] == 200
    counter = next(r for r in meter.records if r['operation'] == 'UpdateItem')
    assert counter['counter_or_lease'] and counter['wcu'] > 5
    assert counter['wcu'] == write_units(meter.image(store.table, store.key(session_key(token))), {})
    assert store.load(token, charge=False)['state'] == generated


def test_two_concurrent_visitors_exhaust_even_maximum_5wcu_burst(cloud):
    store, clock = cloud
    a, b = session(), session()
    state_a, state_b = generate(store, a), generate(store, b)
    meter = CapacityMeter(store.client)
    store.client = meter
    meter.counter_budget = WriteBudget(5, lambda: clock[0], burst_seconds=300)
    statuses = []
    # Two overlapping visitors, one GET each second for one minute. Aggregate
    # 2 requests/sec is within the SAM gateway rate. No real AWS traffic occurs.
    with ThreadPoolExecutor(max_workers=2) as visitors:
        for _ in range(60):
            statuses.extend(visitors.map(lambda token: call('/api/state', token, method='GET')[0], (a, b)))
            clock[0] += 1
    assert 200 in statuses and 503 in statuses
    assert set(statuses) == {200, 503}, 'This is throughput failure, not the 300-request quota'
    assert store.load(a, charge=False)['state'] == state_a
    assert store.load(b, charge=False)['state'] == state_b
    for token in (a, b):
        item = meter.image(store.table, store.key(session_key(token)))
        assert int(item['requests']['N']) < 300
    assert a not in json.dumps(meter.records) and b not in json.dumps(meter.records)


def test_capacity_rejected_reset_preserves_authoritative_state_and_history(cloud, monkeypatch):
    store, _ = cloud
    token = session()
    generate(store, token)
    before = copy.deepcopy(store.load(token, charge=False)['state'])
    history = store.history(store.load(token, charge=False))
    def reject_transaction(**kwargs):
        assert kwargs['TransactItems'][0]['Update']['ConditionExpression'] == '#version = :previous AND expiresAt > :now'
        WriteBudget(5, lambda: 0, burst_seconds=0).consume(100, 'TransactWriteItems')
    monkeypatch.setattr(store.client, 'transact_write_items', reject_transaction)
    code, body = call('/api/reset', token, {'revision': 0})
    assert code == 503 and 'temporarily unavailable' in body['detail']
    assert store.load(token, charge=False)['state'] == before
    assert store.history(store.load(token, charge=False)) == history


def test_full_workflow_capacity_demand_exceeds_5_even_with_small_counters():
    from sam.dynamo_capacity_audit import audit
    evidence = audit(rounds=5, visitors=3, spacing=2)
    first = {r['label']: r for r in evidence['requests']}
    for action in ('generate', 'approve', 'complete', 'disrupt', 'reset'):
        assert first[f'1:{action}']['wcu'] > 5
        assert first[f'1:{action}']['split_counter_wcu'] > 5
    replays = {(r['rate_per_second'], r['field']): r for r in evidence['replays']}
    assert replays[5, 'wcu']['model_rejected_requests'] > 0
    assert replays[5, 'split_counter_wcu']['model_rejected_requests'] > 0
    assert replays[25, 'split_counter_wcu']['model_rejected_requests'] == 0
    assert replays[5, 'split_counter_wcu']['mean_units_per_second'] > 5
    stress = {(r['rate_per_second'], r['field']): r for r in evidence['gateway_rate_stress']['replays']}
    assert stress[25, 'split_counter_wcu']['mean_units_per_second'] > 25
    assert stress[25, 'split_counter_wcu']['model_rejected_requests'] > 0
    assert stress[75, 'split_counter_wcu']['model_rejected_requests'] == 0
