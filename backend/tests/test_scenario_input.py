import copy
import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.store import Store
from app.scenarios import sample
from app.validator import validate_plan
from app.models import Scenario, Plan


def session(client):
    r = client.post('/api/sessions', json={})
    assert r.status_code == 201
    return {'Authorization': 'Bearer ' + r.json()['token']}


@pytest.mark.parametrize('stage', ['initial', 'draft', 'approved', 'completed', 'disrupted', 'replanned'])
def test_reset_authoritative_state_and_history(tmp_path, stage):
    path = str(tmp_path/'reset.sqlite3')
    client = TestClient(create_app(path))
    s = client.get('/api/state').json()
    original = s['scenario']
    pid = None
    if stage != 'initial':
        s = client.post('/api/plans', json={'revision':s['revision']}).json()
        pid = s['latest']['id']
    if stage in ('approved','completed','disrupted','replanned'):
        s = client.post(f'/api/plans/{pid}/approve', json={'revision':s['revision']}).json()
    if stage in ('completed','disrupted','replanned'):
        task = min(s['latest']['plan']['tasks'], key=lambda t:t['end'])
        s = client.post(f"/api/plans/{pid}/tasks/{task['lot_id']}/complete", json={'revision':s['revision']}).json()
    if stage in ('disrupted','replanned'):
        s = client.post('/api/disruptions', json={'revision':s['revision'],'deadline':35,'now_minute':s['scenario']['now_minute'],'disabled_workers':['W2'],'forklift_enabled':False}).json()
    if stage == 'replanned':
        s = client.post('/api/plans', json={'revision':s['revision']}).json()
        pid = s['latest']['id']
    count = len(client.get('/api/plans').json())
    r = client.post('/api/reset', json={'revision':s['revision']})
    assert r.status_code == 200
    restored = r.json()
    assert restored['scenario'] == original == sample().model_dump()
    assert restored['latest'] is None
    assert restored['revision'] == s['revision'] + 1
    assert restored['scenario_epoch'] == s['scenario_epoch'] + 1
    assert restored['input_source'] == 'sample'
    assert client.get('/api/state').json() == restored
    assert Store(path).state()['latest'] is None
    history = client.get('/api/plans').json()
    assert len(history) == count and all(p['state']=='superseded' for p in history)
    if pid:
        assert client.post(f'/api/plans/{pid}/approve', json={'revision':restored['revision']}).status_code == 409
        assert client.post(f'/api/plans/{pid}/tasks/L02/complete', json={'revision':restored['revision']}).status_code == 409
    assert client.post('/api/reset', json={'revision':s['revision']}).status_code == 409
    # Older reset events leaving the latest-30 audit window must not revive historical plans.
    store = Store(path)
    with store.connection() as db:
        for n in range(35):
            store.event(db, 'test_audit', str(n))
    assert store.state()['latest'] is None
    regenerated = client.post('/api/plans', json={'revision':restored['revision']}).json()
    assert regenerated['latest']['state'] == 'draft'
    assert regenerated['latest']['scenario_epoch'] == restored['scenario_epoch']


def test_custom_session_workflow_isolation_and_reset(tmp_path):
    path = str(tmp_path/'demo.sqlite3')
    client = TestClient(create_app(path))
    first, second = session(client), session(client)
    scenario = sample().model_dump()
    scenario.update(id='operator-yard', name='Operator assumptions', deadline=45, now_minute=5)
    scenario['lots'][0].update(id='paper-load', value_inr=20000, exposed_loss_inr=8000)
    r = client.post('/api/scenario', headers=first, json={'revision':0,'scenario':scenario})
    assert r.status_code == 200
    s = r.json()
    assert s['input_source']=='custom' and s['latest'] is None and s['revision']==1
    assert client.get('/api/state', headers=second).json()['scenario']==sample().model_dump()
    assert client.get('/api/state').json()['scenario']==sample().model_dump()
    assert client.post('/api/scenario', headers=first, json={'revision':0,'scenario':scenario}).status_code==409
    client = TestClient(create_app(path))  # capability + custom data survive a local restart
    assert client.get('/api/state', headers=first).json()['scenario']==scenario
    s = client.post('/api/plans', headers=first, json={'revision':1}).json()
    p = s['latest']
    assert validate_plan(Scenario.model_validate(scenario), Plan.model_validate(p['plan'])).valid
    assert all(validate_plan(Scenario.model_validate(scenario), Plan.model_validate(b)).valid for b in p['comparisons'])
    s = client.post(f"/api/plans/{p['id']}/approve", headers=first, json={'revision':1}).json()
    t = min(p['plan']['tasks'], key=lambda t:t['end'])
    s = client.post(f"/api/plans/{p['id']}/tasks/{t['lot_id']}/complete", headers=first,json={'revision':1}).json()
    assert client.post('/api/scenario', headers=first,json={'revision':2,'scenario':scenario}).status_code==409
    reset = client.post('/api/reset',headers=first,json={'revision':2}).json()
    assert reset['latest'] is None and reset['scenario']==sample().model_dump()
    assert len(client.get('/api/plans',headers=first).json())==1
    assert client.get('/api/plans',headers=second).json()==[]


@pytest.mark.parametrize('change', [
    lambda s:s['lots'][0].update(value_inr=-1),
    lambda s:s['lots'][0].update(exposed_loss_inr=99999999),
    lambda s:s['lots'][0].update(weight_kg=0),
    lambda s:s['lots'][0].update(id='../unsafe'),
    lambda s:s['lots'][0].update(extra='ignored?'),
    lambda s:s['lots'][0]['actions'][0].update(duration=0),
    lambda s:s['lots'][0]['actions'][0].update(effectiveness_bps=10001),
    lambda s:s['workers'][0].update(available_from=100,available_until=10),
    lambda s:s['workers'][0].update(id='W2'),
    lambda s:s.update(workers=s['workers']*3),
    lambda s:s.update(lots=s['lots']*3),
    lambda s:s.update(lots=[]),
    lambda s:s['tarps'][0].update(categories=['unknown']),
    lambda s:s['tarps'][0].update(categories=[]),
    lambda s:s.update(deadline=80),
])
def test_invalid_custom_input_never_changes_state(tmp_path, change):
    client=TestClient(create_app(str(tmp_path/'invalid.sqlite3')))
    headers=session(client)
    scenario=sample().model_dump()
    change(scenario)
    assert client.post('/api/scenario',headers=headers,json={'revision':0,'scenario':scenario}).status_code==422
    assert client.get('/api/state',headers=headers).json()['revision']==0


def test_custom_requires_session_and_rejects_forged_completion_and_large_body(tmp_path):
    client=TestClient(create_app(str(tmp_path/'bounds.sqlite3')))
    headers=session(client)
    scenario=sample().model_dump()
    assert client.post('/api/scenario',json={'revision':0,'scenario':scenario}).status_code==401
    assert client.get('/api/state',headers={'Authorization':'Bearer invalid'}).status_code==401
    generated=client.post('/api/plans',headers=headers,json={'revision':0}).json()
    scenario['completed']=[generated['latest']['plan']['tasks'][0]]
    scenario['now_minute']=scenario['completed'][0]['end']
    assert client.post('/api/scenario',headers=headers,json={'revision':0,'scenario':scenario}).status_code==422
    assert client.post('/api/scenario',headers=headers,json={'revision':0,'scenario':sample().model_dump(),'padding':'x'*32768}).status_code==413


def test_session_limits_are_not_reset_or_replaced(tmp_path):
    path=tmp_path/'quotas.sqlite3'
    client=TestClient(create_app(str(path)))
    headers=session(client)
    registry=path.with_suffix('.sessions')/'registry.sqlite3'
    with sqlite3.connect(registry) as db:
        db.execute('UPDATE sessions SET computes=20')
    assert client.post('/api/plans',headers=headers,json={'revision':0}).status_code==429
    assert client.post('/api/reset',headers=headers,json={'revision':0}).status_code==200
    assert client.post('/api/plans',headers=headers,json={'revision':1}).status_code==429
    with sqlite3.connect(registry) as db:
        db.execute('UPDATE sessions SET requests=300')
    assert client.get('/api/state',headers=headers).status_code==429


def test_legacy_reset_migration_does_not_revive_old_plans(tmp_path):
    path=str(tmp_path/'legacy.sqlite3')
    store=Store(path)
    from app.engine import execute, ComputeRequest
    result=execute(ComputeRequest(scenario=sample()))
    store.save_plan(0,result.plan,result.comparisons)
    store.reset(0)
    with store.connection() as db:
        db.execute('ALTER TABLE plans DROP COLUMN epoch')
        db.execute('ALTER TABLE yard DROP COLUMN epoch')
        db.execute('ALTER TABLE yard DROP COLUMN input_source')
    assert Store(path).state()['latest'] is None
