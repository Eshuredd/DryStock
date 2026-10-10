"""Run from project root: python backend/benchmarks/run.py --output artifacts/phase2"""
import argparse
import json
import sys
from pathlib import Path
from statistics import mean, median
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.engine import ComputeRequest, execute, scenario_hash, SolverUnavailable
from app.validator import validate_plan
from benchmarks.suite import scenarios, SEEDS


def utilisation(s, p):
    window = s.deadline - s.now_minute
    available = sum(max(0,min(s.deadline,w.available_until)-max(s.now_minute,w.available_from)) for w in s.workers if w.enabled)
    worker_minutes = sum((t.end-t.start)*len(t.worker_ids) for t in p.tasks)
    used_tarps = {t.tarp_id for t in s.completed + p.tasks if t.tarp_id}
    used_bays = {t.storage_id for t in s.completed + p.tasks if t.storage_id}
    forklift_minutes = sum(t.end-t.start for t in p.tasks if t.forklift_id)
    forklift_available = sum(max(0,min(s.deadline,f.available_until)-max(s.now_minute,f.available_from)) for f in s.forklifts if f.enabled)
    return {'window_minutes':window, 'worker_minutes':worker_minutes, 'available_worker_minutes':available,
        'worker_utilisation_pct':worker_minutes/available*100 if available else None,
        'forklift_minutes':forklift_minutes, 'available_forklift_minutes':forklift_available,
        'forklift_utilisation_pct':forklift_minutes/forklift_available*100 if forklift_available else None,
        'occupied_tarps_including_completed':len(used_tarps), 'occupied_bays_including_completed':len(used_bays)}


def result_row(identifier, seed, s, seconds=1):
    request = ComputeRequest(scenario=s,solver_seconds=seconds)
    try:
        result = execute(request)
    except SolverUnavailable as exc:
        return {'id':identifier,'seed':seed,'scenario_sha256':scenario_hash(s),'parameters':s.model_dump(),
                'solver_status':exc.status,'solver_time_budget_seconds':seconds,'timeout':exc.status=='UNKNOWN','usable':False}
    strategies = {}
    for p in [result.plan,*result.comparisons]:
        checked = validate_plan(s,p)
        if not checked.valid: raise RuntimeError('Invalid benchmark schedule: ' + identifier)
        lookup = {l.id:l for l in s.lots}
        strategies[p.strategy] = {'additional_avoided_loss_inr':p.planned_saved_inr, 'completed_benefit_inr':p.completed_saved_inr,
            'residual_loss_inr':p.residual_loss_inr, 'scheduled_lots':len(p.tasks), 'completed_lots':len(s.completed),
            'unprotected_lots':len(p.unprotected_lot_ids), 'scheduled_kg':sum(lookup[t.lot_id].weight_kg for t in p.tasks),
            'resource_utilisation':utilisation(s,p), 'validation':checked.model_dump(), 'plan':p.model_dump()}
    best = max(p.planned_saved_inr for p in result.comparisons)
    gain = result.plan.planned_saved_inr-best
    return {'id':identifier,'seed':seed,'scenario_sha256':scenario_hash(s),'parameters':s.model_dump(),
        'solver_status':result.plan.solver_status, 'solver_seconds':result.plan.solve_seconds,
        'solver_time_budget_seconds':seconds, 'optimality_proven':result.plan.solver_status=='OPTIMAL',
        'timeout':result.plan.solver_status in ('UNKNOWN', 'FEASIBLE'),
        'usable':True,'strategies':strategies,'best_baseline_inr':best,'gain_inr':gain,
        'relative_gain_pct':gain/best*100 if best else None}


def summary(rows):
    usable = [r for r in rows if r['usable']]
    gains = [r['gain_inr'] for r in usable]
    relative = [r['relative_gain_pct'] for r in usable if r['relative_gain_pct'] is not None]
    count = len(usable)
    return {'scenarios':len(rows),'usable':count,'mean_gain_inr':mean(gains) if gains else None,
        'median_gain_inr':median(gains) if gains else None,'mean_relative_gain_pct':mean(relative) if relative else None,
        'median_relative_gain_pct':median(relative) if relative else None,'relative_defined_count':len(relative),
        'best_gain_inr':max(gains) if gains else None,'worst_gain_inr':min(gains) if gains else None,
        'improvement_pct':sum(g>0 for g in gains)/count*100 if count else 0,
        'tie_pct':sum(g==0 for g in gains)/count*100 if count else 0,
        'baseline_better_count':sum(g<0 for g in gains),'optimal_count':sum(r['solver_status']=='OPTIMAL' for r in rows),
        'feasible_unproven_count':sum(r['solver_status']=='FEASIBLE' for r in rows),'timeouts':sum(r['timeout'] for r in rows)}


def markdown(rows, stats):
    fmt = lambda v: 'N/A' if v is None else f'{v:,.2f}'
    lines = ['# DryStock Phase 2 benchmark', '',
        'Fictional modelled benefits, not measured financial or environmental savings. No fixture was retuned after outcomes.', '',
        f"{stats['scenarios']} fixed cases, {stats['optimal_count']} proven optimal, {stats['feasible_unproven_count']} feasible/unproven, {stats['timeouts']} time-budget exits.", '',
        f"Mean gain: INR {fmt(stats['mean_gain_inr'])}; median: INR {fmt(stats['median_gain_inr'])}. Best: INR {fmt(stats['best_gain_inr'])}; worst: INR {fmt(stats['worst_gain_inr'])}.",
        f"Mean relative gain: {fmt(stats['mean_relative_gain_pct'])}%; median: {fmt(stats['median_relative_gain_pct'])}% over {stats['relative_defined_count']} cases with nonzero baseline benefit.",
        f"Improvement in {stats['improvement_pct']:.2f}% of usable cases; ties in {stats['tie_pct']:.2f}%; baseline better in {stats['baseline_better_count']} cases.", '',
        'Percentages of improving/tied cases use usable cases as denominator. Zero-baseline relative gain is undefined (N/A), not 0%. Timeouts include UNKNOWN and feasible exits at the time budget; FEASIBLE remains a usable unproven incumbent.', '',
        '## Fixed protocol', '',
        f'Generated seeds: {list(SEEDS)}. One second per solver, one worker, solver seed 7. All strategies receive identical complete scenarios and independently validated schedules. Actual elapsed times vary by machine.',
        'Capacity zero means the corresponding resources are disabled. Resource utilisation reports new worker/equipment minutes; assets include completed work and are event-long allocations.', '',
        '| Case | Status | CP-SAT INR | Best baseline INR | Gain INR | Relative gain | Scheduled lots | Exposed lots |',
        '|---|---|---:|---:|---:|---:|---:|---:|']
    for r in rows:
        if not r['usable']:
            lines.append(f"| {r['id']} | {r['solver_status']} | N/A | N/A | N/A | N/A | N/A | N/A |")
            continue
        p = r['strategies']['CP-SAT']
        relative_text = 'N/A' if r['relative_gain_pct'] is None else f"{r['relative_gain_pct']:.2f}%"
        lines.append(f"| {r['id']} | {r['solver_status']} | {p['additional_avoided_loss_inr']} | {r['best_baseline_inr']} | {r['gain_inr']} | {relative_text} | {p['scheduled_lots']} | {p['unprotected_lots']} |")
    lines += ['', '## Interpretation', '',
        'The historical original case remains a small 0.73% improvement. The historical disruption retains L02 and tarp T2: its additional benefit improves by 12.25%. This distinguishes already-completed benefit from new planned benefit.',
        'Larger observed gains arise where greedy early decisions use a scarce asset or worker interval that would serve a better combination of actions. These associations are inspectable in the JSON allocations; they are not causal proofs or guarantees for actual yards.',
        'Ties show where a simple strategy provides equivalent modelled value. With no feasible handling window or no workers, every strategy correctly schedules nothing. A nonzero tie likewise provides no financial-model advantage for CP-SAT.',
        'Generated scenarios are synthetic stress variations, not a representative industry sample. Means and medians describe only this predefined suite. No carbon, waste-prevention, adoption or measured savings claims follow.']
    return '\n'.join(lines)+'\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output',default='artifacts/phase2')
    parser.add_argument('--solver-seconds',type=float,default=1)
    args = parser.parse_args()
    rows = [result_row(identifier,seed,s,args.solver_seconds) for identifier,seed,s in scenarios()]
    stats = summary(rows)
    destination = Path(args.output)
    destination.mkdir(parents=True,exist_ok=True)
    (destination/'benchmarks.json').write_text(json.dumps({'protocol_version':'1','seeds':SEEDS,'summary':stats,'cases':rows},indent=2,ensure_ascii=False),encoding='utf-8')
    (destination/'BENCHMARKS.md').write_text(markdown(rows,stats),encoding='utf-8')
    print(json.dumps(stats,indent=2))
