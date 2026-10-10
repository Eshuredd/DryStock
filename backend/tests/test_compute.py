import base64
import io
import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app.engine import ComputeRequest, ComputeResult, execute, verify_result, InvalidResult
from app.lambda_handler import handler
from app.compute import ComputeBackend, ComputeUnavailable
from app.main import create_app
from app.store import Store
from app.validator import validate_plan


def payload(response):
    assert response['statusCode'] == 200
    return ComputeResult.model_validate_json(response['body'])


def test_handler_calls_same_real_solver_as_local(yard):
    request = ComputeRequest(scenario=yard)
    local = execute(request)
    # Direct handler contract test; this is not AWS SAM CLI/container execution evidence.
    remote = payload(handler(request.model_dump(), None))
    assert remote.execution_backend == 'sam'
    assert remote.plan.solver_status == local.plan.solver_status == 'OPTIMAL'
    assert remote.plan.planned_saved_inr == local.plan.planned_saved_inr == 35809
    assert [p.planned_saved_inr for p in remote.comparisons] == [p.planned_saved_inr for p in local.comparisons]
    assert remote.scenario_sha256 == local.scenario_sha256
    assert verify_result(yard, remote)
    assert all(validate_plan(yard,p).valid for p in [remote.plan, *remote.comparisons])


@pytest.mark.parametrize('event,status', [({},422), ({'body':'{'},400), ({'body':'{}'},422),
    ({'body':'!!!!','isBase64Encoded':True},400), (None,422), ({'scenario':{}},422)])
def test_invalid_requests_sanitized(event,status):
    result = handler(event,None)
    assert result['statusCode'] == status
    assert 'Traceback' not in result['body']


def test_base64_proxy_event(yard):
    body = json.dumps({'scenario':yard.model_dump()}).encode()
    result = payload(handler({'body':base64.b64encode(body).decode(),'isBase64Encoded':True},None))
    assert result.plan.planned_saved_inr == 35809


def test_invalid_completed_history_is_422(yard,optimized):
    task = min(optimized.tasks,key=lambda t:t.end).model_copy(update={'saved_loss_inr':999})
    yard.completed = [task]
    yard.now_minute = task.end
    assert handler({'scenario':yard.model_dump()},None)['statusCode'] == 422


def test_solver_timeout_and_feasible_status(monkeypatch,yard,optimized):
    import app.engine as engine
    unknown = optimized.model_copy(deep=True)
    unknown.solver_status = 'UNKNOWN'
    monkeypatch.setattr(engine,'optimize',lambda *a,**kw:unknown)
    result = handler({'scenario':yard.model_dump()},None)
    assert result['statusCode'] == 503
    assert json.loads(result['body'])['solver_status'] == 'UNKNOWN'
    feasible = optimized.model_copy(deep=True)
    feasible.solver_status = 'FEASIBLE'
    feasible.best_bound_inr += 100
    monkeypatch.setattr(engine,'optimize',lambda *a,**kw:feasible)
    assert payload(handler({'scenario':yard.model_dump()},None)).plan.solver_status == 'FEASIBLE'


def test_runtime_failure_sanitized(monkeypatch,yard):
    def fail(*a,**kw):
        raise RuntimeError('secret test sentinel')
    monkeypatch.setattr('app.lambda_handler.execute',fail)
    response = handler({'scenario':yard.model_dump()},None)
    assert response['statusCode'] == 500
    assert 'sentinel' not in response['body']


def test_context_timeout_without_solving(yard):
    class Expired:
        def get_remaining_time_in_millis(self):
            return 100
    assert handler({'scenario':yard.model_dump()},Expired())['statusCode'] == 504


@pytest.mark.parametrize('mutate', ['benefit','summary','baseline','hash','validation_flag'])
def test_independent_output_verification_rejects_tampering(yard,mutate):
    result = execute(ComputeRequest(scenario=yard))
    if mutate == 'benefit': result.plan.tasks[0].saved_loss_inr += 1
    if mutate == 'summary': result.plan.residual_loss_inr += 1
    if mutate == 'baseline': result.comparisons[0].tasks[0].worker_ids = []
    if mutate == 'hash': result.scenario_sha256 = 'wrong'
    if mutate == 'validation_flag':
        result.comparisons[0].planned_saved_inr += 1
        result.comparisons[0].validation.valid = True
    with pytest.raises(InvalidResult): verify_result(yard,result)


def test_sam_transport_persists_validated_response(monkeypatch,tmp_path,yard):
    # Contract transport stub only. Actual SAM evidence comes from sam/Invoke-Verify.ps1.
    result = payload(handler({'scenario':yard.model_dump()},None))
    monkeypatch.setattr('app.compute.urlopen',lambda *a,**kw:io.BytesIO(result.model_dump_json().encode()))
    client = TestClient(create_app(str(tmp_path/'sam.sqlite3'),ComputeBackend('sam')))
    state = client.post('/api/plans',json={'revision':0}).json()
    assert state['compute_backend'] == 'sam'
    assert state['latest']['execution']['execution_backend'] == 'sam'
    assert state['latest']['plan']['planned_saved_inr'] == result.plan.planned_saved_inr


def test_sam_failure_does_not_fall_back_or_persist(monkeypatch,tmp_path):
    def fail(*a,**kw): raise OSError('connection refused')
    monkeypatch.setattr('app.compute.urlopen',fail)
    client = TestClient(create_app(str(tmp_path/'offline.sqlite3'),ComputeBackend('sam')))
    assert client.post('/api/plans',json={'revision':0}).status_code == 503
    assert client.get('/api/plans').json() == []


def test_store_rejects_invalid_baseline_and_migrates_old_db(tmp_path,yard,optimized):
    path = str(tmp_path/'old.sqlite3')
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE plans (id TEXT PRIMARY KEY, revision INTEGER, state TEXT, data TEXT, comparisons TEXT, created TEXT, scenario TEXT)')
    store = Store(path)
    result = execute(ComputeRequest(scenario=yard))
    result.comparisons[0].residual_loss_inr = -1
    with pytest.raises(ValueError): store.save_plan(0,optimized,result.comparisons)
    assert store.history() == []


def test_stale_approval_after_disruption(tmp_path):
    client = TestClient(create_app(str(tmp_path/'stale.sqlite3')))
    pid = client.post('/api/plans',json={'revision':0}).json()['latest']['id']
    client.post('/api/disruptions',json={'revision':0,'deadline':35,'now_minute':0,'forklift_enabled':False})
    assert client.post(f'/api/plans/{pid}/approve',json={'revision':1}).status_code == 409


def test_only_local_sam_endpoint_allowed():
    with pytest.raises(ValueError): ComputeBackend('sam','https://example.com/optimize')
