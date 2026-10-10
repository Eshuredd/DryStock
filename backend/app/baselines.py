"""Greedy priorities with identical compatibility and scheduling constraints.
Each lot takes its highest-benefit feasible action at the earliest possible time.
"""
from .models import Scenario, Task, benefit
from .choices import assignments
from .metrics import make_plan


def baseline(s: Scenario, strategy: str):
    done = {t.lot_id for t in s.completed}
    lots = [l for l in s.lots if l.id not in done and l.protection_status == 'exposed']
    keys = {
        'Highest value first': lambda l: l.value_inr,
        'Highest loss first': lambda l: l.exposed_loss_inr,
        'Loss per worker-minute': lambda l: max((benefit(l, a) / (a.duration * a.workers) for a in l.actions), default=0),
    }
    tasks = []
    for lot in sorted(lots, key=lambda l: (-keys[strategy](l), l.id)):
        options = []
        for a in lot.actions:
            for crew, tarp, storage, forklift, earliest, latest in assignments(s, lot, a):
                if any((tarp and t.tarp_id == tarp) or (storage and t.storage_id == storage) for t in tasks):
                    continue
                for start in range(earliest, latest - a.duration + 1):
                    end = start + a.duration
                    if any(start < t.end and t.start < end and (set(crew) & set(t.worker_ids) or (forklift and forklift == t.forklift_id)) for t in tasks):
                        continue
                    options.append(Task(lot_id=lot.id, action=a.kind, start=start, end=end, worker_ids=list(crew),
                                        tarp_id=tarp, storage_id=storage, forklift_id=forklift, saved_loss_inr=benefit(lot, a)))
                    break
        if options:
            tasks.append(min(options, key=lambda t: (-t.saved_loss_inr, t.start, t.end, t.worker_ids, t.tarp_id or '', t.storage_id or '')))
    plan = make_plan(s, tasks, strategy, 'GREEDY')
    if not plan.validation.valid:
        raise RuntimeError('Invalid baseline')
    return plan


def compare(s: Scenario):
    return [baseline(s, name) for name in ['Highest value first', 'Highest loss first', 'Loss per worker-minute']]
