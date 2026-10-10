from time import perf_counter
from ortools.sat.python import cp_model
from .models import Scenario, Task, benefit
from .choices import assignments
from .metrics import make_plan


def optimize(s: Scenario, time_limit: float = 5):
    model = cp_model.CpModel()
    busy: dict[str, list] = {}
    exclusive: dict[str, list] = {}
    candidates = []
    objective = []
    completed = {t.lot_id for t in s.completed}
    for lot in s.lots:
        if lot.id in completed or lot.protection_status != 'exposed':
            continue
        lot_choices = []
        for action in lot.actions:
            for crew, tarp, storage, forklift, earliest, latest in assignments(s, lot, action):
                name = f'{lot.id}_{action.kind}_{len(candidates)}'
                selected = model.new_bool_var(name)
                start = model.new_int_var(earliest, latest - action.duration, name + '_start')
                end = model.new_int_var(earliest + action.duration, latest, name + '_end')
                interval = model.new_optional_interval_var(start, action.duration, end, selected, name + '_interval')
                lot_choices.append(selected)
                for wid in crew:
                    busy.setdefault('worker:' + wid, []).append(interval)
                if forklift:
                    busy.setdefault('forklift:' + forklift, []).append(interval)
                for kind, rid in [('tarp:', tarp), ('storage:', storage)]:
                    if rid:
                        exclusive.setdefault(kind + rid, []).append(selected)
                saved = benefit(lot, action)
                objective.append(saved * selected)
                candidates.append((lot.id, action.kind, crew, tarp, storage, forklift, saved, selected, start, end))
        model.add_at_most_one(lot_choices)
    for intervals in busy.values():
        model.add_no_overlap(intervals)
    for choices in exclusive.values():
        model.add_at_most_one(choices)
    model.maximize(sum(objective))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 7
    started = perf_counter()
    status = solver.solve(model)
    tasks = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for lot, action, crew, tarp, storage, forklift, saved, selected, start, end in candidates:
            if solver.value(selected):
                tasks.append(Task(lot_id=lot, action=action, worker_ids=list(crew), tarp_id=tarp, storage_id=storage,
                                  forklift_id=forklift, saved_loss_inr=saved, start=solver.value(start), end=solver.value(end)))
    plan = make_plan(s, tasks, 'CP-SAT', solver.status_name(status), solve_seconds=round(perf_counter() - started, 3),
                     best_bound_inr=int(round(solver.best_objective_bound)) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None)
    if not plan.validation.valid:
        raise RuntimeError('Optimizer produced invalid plan: ' + '; '.join(plan.validation.errors))
    return plan
