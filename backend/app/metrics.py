from .models import Scenario, Task, Plan
from .validator import validate


def make_plan(s: Scenario, tasks: list[Task], strategy: str, status: str, **kwargs) -> Plan:
    initial = sum(l.exposed_loss_inr for l in s.lots if l.protection_status == 'exposed')
    completed = sum(t.saved_loss_inr for t in s.completed)
    planned = sum(t.saved_loss_inr for t in tasks)
    protected = {t.lot_id for t in tasks + s.completed}
    return Plan(strategy=strategy, solver_status=status, tasks=sorted(tasks, key=lambda t: (t.start, t.lot_id)),
                unprotected_lot_ids=[l.id for l in s.lots if l.protection_status == 'exposed' and l.id not in protected],
                initial_loss_inr=initial, completed_saved_inr=completed, planned_saved_inr=planned,
                residual_loss_inr=initial - completed - planned, validation=validate(s, tasks), **kwargs)
