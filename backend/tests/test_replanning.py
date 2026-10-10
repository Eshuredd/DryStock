import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.optimizer import optimize
from app.validator import validate


def test_completed_history_is_independently_checked(yard, optimized):
    task = min(optimized.tasks, key=lambda t: t.end).model_copy(update={'saved_loss_inr':999999})
    yard.completed = [task]
    yard.now_minute = task.end
    assert not validate(yard, []).valid
    with pytest.raises(RuntimeError):
        optimize(yard)


def test_finish_entire_approved_plan_and_replan(tmp_path):
    client = TestClient(create_app(str(tmp_path/'complete.sqlite3')))
    state = client.post('/api/plans',json={'revision':0}).json()
    pid = state['latest']['id']
    expected_benefit = state['latest']['plan']['planned_saved_inr']
    assert client.post(f'/api/plans/{pid}/approve',json={'revision':0}).status_code == 200
    tasks = sorted(state['latest']['plan']['tasks'],key=lambda t:t['end'])
    for revision, task in enumerate(tasks):
        response = client.post(f"/api/plans/{pid}/tasks/{task['lot_id']}/complete",json={'revision':revision})
        assert response.status_code == 200
    state = response.json()
    assert sum(t['saved_loss_inr'] for t in state['scenario']['completed']) == expected_benefit
    new_plan = client.post('/api/plans',json={'revision':state['revision']}).json()['latest']['plan']
    assert new_plan['tasks'] == []
    assert new_plan['completed_saved_inr'] == expected_benefit
    assert new_plan['planned_saved_inr'] == 0


def test_earlier_rain_rejects_past_clock_and_cannot_reuse_completed_resource(tmp_path):
    client = TestClient(create_app(str(tmp_path/'replan.sqlite3')))
    state = client.post('/api/plans',json={'revision':0}).json()
    pid = state['latest']['id']
    task = min(state['latest']['plan']['tasks'], key=lambda t:t['end'])
    client.post(f'/api/plans/{pid}/approve',json={'revision':0})
    client.post(f"/api/plans/{pid}/tasks/{task['lot_id']}/complete",json={'revision':0})
    assert client.post('/api/disruptions',json={'revision':1,'deadline':task['end']-1,'now_minute':task['end']}).status_code == 422
    assert client.post('/api/disruptions',json={'revision':1,'deadline':35,'now_minute':task['end']}).status_code == 200
    state = client.post('/api/plans',json={'revision':2}).json()
    tasks = state['latest']['plan']['tasks']
    assert all(t['tarp_id'] != task['tarp_id'] for t in tasks) if task['tarp_id'] else True
    assert state['latest']['state'] == 'draft'
