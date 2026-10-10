from fastapi.testclient import TestClient
from app.main import create_app
from app.store import Store


def test_api_approval_completion_disruption_persistence(tmp_path):
    path = str(tmp_path/'yard.sqlite3')
    client = TestClient(create_app(path))
    assert client.get('/api/health').json()['status'] == 'ok'
    assert client.get('/api/state').json()['revision'] == 0
    generated = client.post('/api/plans',json={'revision':0})
    assert generated.status_code == 200
    state = generated.json()
    p = state['latest']
    pid, task = p['id'], min(p['plan']['tasks'],key=lambda t:t['end'])
    endpoint = f"/api/plans/{pid}/tasks/{task['lot_id']}/complete"
    assert client.post(endpoint,json={'revision':0}).status_code == 409
    assert client.post(f'/api/plans/{pid}/approve',json={'revision':0}).status_code == 200
    assert client.post(f'/api/plans/{pid}/approve',json={'revision':0}).status_code == 409
    recorded = client.post(endpoint,json={'revision':0})
    assert recorded.status_code == 200
    state = recorded.json()
    assert len(state['scenario']['completed']) == 1
    assert state['revision'] == 1
    assert client.post(endpoint,json={'revision':1}).status_code == 409
    # A new store simulates an application restart.
    assert Store(path).state()['scenario']['completed'] == state['scenario']['completed']
    changed = client.post('/api/disruptions',json={'revision':1,'deadline':35,'now_minute':task['end'],'forklift_enabled':False,'disabled_workers':['W2']})
    assert changed.status_code == 200
    assert changed.json()['latest']['state'] == 'superseded'
    assert client.post(endpoint,json={'revision':2}).status_code == 409
    assert client.post('/api/plans',json={'revision':1}).status_code == 409
    revised = client.post('/api/plans',json={'revision':2})
    assert revised.status_code == 200
    latest = revised.json()['latest']
    assert latest['plan']['completed_saved_inr'] == task['saved_loss_inr']
    assert all(t['lot_id'] != task['lot_id'] and t['start'] >= task['end'] and t['forklift_id'] is None for t in latest['plan']['tasks'])
    assert latest['scenario']['completed'] == [task]
    assert client.post('/api/validate',json={'scenario':latest['scenario'],'tasks':latest['plan']['tasks']}).json()['valid']
    assert len(client.get('/api/plans').json()) == 2
    reset = client.post('/api/reset',json={'revision':2})
    assert reset.status_code == 200
    assert reset.json()['scenario']['completed'] == []
    assert len(reset.json()['events']) >= 6


def test_api_invalid_changes_and_empty_plan(tmp_path):
    client = TestClient(create_app(str(tmp_path/'yard.sqlite3')))
    assert client.post('/api/disruptions',json={'revision':0,'deadline':10,'now_minute':20}).status_code == 422
    assert client.post('/api/disruptions',json={'revision':0,'deadline':10,'now_minute':0,'disabled_workers':['unknown']}).status_code == 422
    assert client.post('/api/plans/unknown/approve',json={'revision':0}).status_code == 409
    assert client.get('/api/state').json()['revision'] == 0
    assert client.post('/api/disruptions',json={'revision':0,'deadline':0,'now_minute':0}).status_code == 200
    result = client.post('/api/plans',json={'revision':1})
    assert result.status_code == 200
    assert result.json()['latest']['plan']['tasks'] == []
    assert result.json()['latest']['plan']['validation']['valid']


def test_clock_cannot_go_backwards(tmp_path):
    client = TestClient(create_app(str(tmp_path/'yard.sqlite3')))
    assert client.post('/api/disruptions',json={'revision':0,'deadline':60,'now_minute':10}).status_code == 200
    assert client.post('/api/disruptions',json={'revision':1,'deadline':60,'now_minute':0}).status_code == 422
