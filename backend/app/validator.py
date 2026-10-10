"""Independent validation: never imports CP-SAT or assignment enumeration."""
from math import isfinite
from .models import Scenario, Task, Validation, Plan


def validate(s: Scenario, tasks: list[Task], *, history: bool = False) -> Validation:
    errors: list[str] = []
    if not history and s.completed:
        completed_check = validate(s, s.completed, history=True)
        errors.extend('Completed history: ' + e for e in completed_check.errors)
    lots = {x.id: x for x in s.lots}
    workers = {x.id: x for x in s.workers}
    forklifts = {x.id: x for x in s.forklifts}
    tarps = {x.id: x for x in s.tarps}
    storage = {x.id: x for x in s.storage}
    seen = set()
    consumed = {'tarp': set(), 'storage': set()}
    if not history:
        for t in s.completed:
            seen.add(t.lot_id)
            consumed['tarp'].add(t.tarp_id)
            consumed['storage'].add(t.storage_id)
    for t in tasks:
        label = f'{t.lot_id}: '
        if t.lot_id in seen:
            errors.append(label + 'duplicate or already completed lot')
        seen.add(t.lot_id)
        lot = lots.get(t.lot_id)
        if lot is None:
            errors.append(label + 'unknown lot')
            continue
        if lot.protection_status != 'exposed':
            errors.append(label + 'lot is already protected')
        action = next((a for a in lot.actions if a.kind == t.action), None)
        if action is None:
            errors.append(label + 'action is not permitted')
            continue
        if t.end - t.start != action.duration:
            errors.append(label + 'incorrect handling duration')
        if t.start < (0 if history else s.now_minute) or t.end > s.deadline:
            errors.append(label + 'outside handling window')
        if t.saved_loss_inr != lot.exposed_loss_inr * action.effectiveness_bps // 10000:
            errors.append(label + 'incorrect estimated benefit')
        if len(t.worker_ids) != action.workers or len(set(t.worker_ids)) != len(t.worker_ids):
            errors.append(label + 'incorrect or duplicate crew')
        for wid in t.worker_ids:
            w = workers.get(wid)
            if w is None:
                errors.append(label + 'unknown worker')
            elif (not history and not w.enabled) or not set(action.required_skills) <= set(w.skills) or t.start < w.available_from or t.end > w.available_until:
                errors.append(label + 'worker unavailable or missing skill')
        if bool(t.forklift_id) != action.forklift:
            errors.append(label + 'incorrect forklift requirement')
        if t.forklift_id:
            f = forklifts.get(t.forklift_id)
            if f is None or (not history and not f.enabled) or t.start < f.available_from or t.end > f.available_until:
                errors.append(label + 'forklift unavailable')
        if (t.action == 'cover' and (not t.tarp_id or t.storage_id)) or (t.action == 'relocate' and (not t.storage_id or t.tarp_id)):
            errors.append(label + 'incorrect protection resource')
        for kind, rid, pool in [('tarp', t.tarp_id, tarps), ('storage', t.storage_id, storage)]:
            if rid is None:
                continue
            r = pool.get(rid)
            if r is None or (not history and not r.enabled) or lot.weight_kg > r.capacity_kg or lot.category not in r.categories:
                errors.append(label + f'incompatible {kind}')
            if rid in consumed[kind]:
                errors.append(label + f'{kind} already allocated')
            consumed[kind].add(rid)
    for i, left in enumerate(tasks):
        for right in tasks[i + 1:]:
            if left.start < right.end and right.start < left.end:
                if set(left.worker_ids) & set(right.worker_ids):
                    errors.append(f'{left.lot_id}/{right.lot_id}: overlapping worker assignment')
                if left.forklift_id and left.forklift_id == right.forklift_id:
                    errors.append(f'{left.lot_id}/{right.lot_id}: overlapping forklift assignment')
    return Validation(valid=not errors, errors=errors)


def validate_plan(s: Scenario, plan: Plan) -> Validation:
    """Recompute summary values as well as checking the raw schedule."""
    result = validate(s, plan.tasks)
    initial = sum(l.exposed_loss_inr for l in s.lots if l.protection_status == 'exposed')
    completed = sum(t.saved_loss_inr for t in s.completed)
    planned = sum(t.saved_loss_inr for t in plan.tasks)
    protected = {t.lot_id for t in s.completed + plan.tasks}
    unprotected = [l.id for l in s.lots if l.protection_status == 'exposed' and l.id not in protected]
    for field, expected in [('initial_loss_inr', initial), ('completed_saved_inr', completed),
                            ('planned_saved_inr', planned), ('residual_loss_inr', initial-completed-planned)]:
        if getattr(plan, field) != expected:
            result.errors.append('Incorrect summary: ' + field)
    if plan.unprotected_lot_ids != unprotected:
        result.errors.append('Incorrect unprotected lots')
    if not isfinite(plan.solve_seconds) or plan.solve_seconds < 0:
        result.errors.append('Invalid solve duration')
    if plan.best_bound_inr is not None and plan.best_bound_inr < planned:
        result.errors.append('Solver upper bound is below incumbent')
    if plan.solver_status == 'OPTIMAL' and plan.best_bound_inr != planned:
        result.errors.append('Optimal solution must match its upper bound')
    result.valid = not result.errors
    return result
