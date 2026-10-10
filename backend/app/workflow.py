"""Workflow rules shared by SQLite development and DynamoDB demo sessions."""
from .models import Scenario, Plan
from .validator import validate, validate_plan


def approval_valid(s: Scenario, plan: Plan):
    return validate_plan(s, plan).valid


def completed_scenario(s: Scenario, plan: Plan, lot_id: str) -> Scenario:
    if lot_id in {t.lot_id for t in s.completed}:
        raise ValueError('Lot already completed')
    task = next((t for t in plan.tasks if t.lot_id == lot_id), None)
    if task is None:
        raise ValueError('Lot is not scheduled in this plan')
    result = validate(s, s.completed + [task], history=True)
    if not result.valid:
        raise ValueError('Invalid completion: ' + '; '.join(result.errors))
    updated = s.model_copy(deep=True)
    updated.completed.append(task)
    updated.now_minute = max(updated.now_minute, task.end)
    return updated


def disrupted_scenario(s: Scenario, *, deadline: int, now_minute: int,
                       disabled_workers: list[str], forklift_enabled: bool) -> Scenario:
    if not set(disabled_workers) <= {w.id for w in s.workers}:
        raise ValueError('Unknown worker')
    if now_minute < s.now_minute:
        raise ValueError('Scenario clock cannot move backwards')
    data = s.model_dump()
    data.update(deadline=deadline, now_minute=now_minute,
                rain_arrival_minute=deadline + s.safety_buffer_minutes)
    for w in data['workers']:
        w['enabled'] = w['id'] not in disabled_workers
    for f in data['forklifts']:
        f['enabled'] = forklift_enabled
    updated = Scenario.model_validate(data)
    if not validate(updated, updated.completed, history=True).valid:
        raise ValueError('Change invalidates completed history')
    return updated
