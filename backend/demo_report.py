"""Reproduce two benchmark snapshots without modifying SQLite or calling AWS."""
import json
from app.scenarios import sample
from app.optimizer import optimize
from app.baselines import compare


def report(scenario):
    p = optimize(scenario)
    baselines = compare(scenario)
    return {
        'deadline': scenario.deadline,
        'now_minute': scenario.now_minute,
        'completed_lots': [t.lot_id for t in scenario.completed],
        'forklift_enabled': scenario.forklifts[0].enabled,
        'solver': p.model_dump(),
        'baselines': [b.model_dump() for b in baselines],
        'gain_over_best_baseline_inr': p.planned_saved_inr - max(b.planned_saved_inr for b in baselines),
    }


if __name__ == '__main__':
    initial = sample()
    first = report(initial)
    completed = next(t for t in optimize(initial).tasks if t.lot_id == 'L02')
    revised = initial.model_copy(deep=True)
    revised.completed = [completed]
    revised.now_minute = completed.end
    revised.deadline = 35
    revised.rain_arrival_minute = 45
    revised.forklifts[0].enabled = False
    print(json.dumps({'mode': 'FICTIONAL ASSUMPTIONS', 'initial': first, 'disruption': report(revised)}, indent=2))
