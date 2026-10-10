from itertools import product
import pytest
from pydantic import ValidationError
from app.models import Scenario, Lot, Action, Worker, Resource, Forklift, Task
from app.optimizer import optimize
from app.baselines import compare
from app.validator import validate


def tiny(losses=(10, 8, 7), durations=(4, 2, 2), deadline=4):
    return Scenario(deadline=deadline, lots=[Lot(id=f'L{i}', category='paper', description='Test lot', weight_kg=1,
        location='Test', exposure='high', condition='Dry', value_inr=20, vulnerability=3, exposed_loss_inr=loss,
        actions=[Action(kind='cover', duration=durations[i], workers=1, effectiveness_bps=10000)]) for i, loss in enumerate(losses)],
        workers=[Worker(id='W', name='Worker')], forklifts=[], storage=[],
        tarps=[Resource(id=f'T{i}', name='Tarp', capacity_kg=2, categories=['paper']) for i in range(len(losses))])


def test_small_optimum_against_independent_exhaustive_search():
    # Enumerate omit/start choices without using optimizer, choices or baseline helpers.
    for losses, durations in [((10,8,7),(4,2,2)), ((5,5,5),(1,3,2)), ((8,2,9),(2,2,3)), ((0,2,3),(1,1,4))]:
        s = tiny(losses, durations)
        best = 0
        for starts in product(*[[-1] + list(range(s.deadline-d+1)) for d in durations]):
            selected = [i for i,t in enumerate(starts) if t >= 0]
            if any(starts[i] < starts[j]+durations[j] and starts[j] < starts[i]+durations[i] for i in selected for j in selected if i < j):
                continue
            best = max(best, sum(losses[i] for i in selected))
        plan = optimize(s)
        assert plan.solver_status == 'OPTIMAL'
        assert plan.planned_saved_inr == best
        assert validate(s, plan.tasks).valid


def test_sample_valid_and_better_than_baselines(yard, optimized):
    assert optimized.validation.valid
    assert optimized.solver_status == 'OPTIMAL'
    assert len(optimized.tasks) <= 5
    baselines = compare(yard)
    assert all(b.validation.valid for b in baselines)
    assert optimized.planned_saved_inr > max(b.planned_saved_inr for b in baselines)
    assert optimized.residual_loss_inr == optimized.initial_loss_inr - optimized.planned_saved_inr
    assert len(yard.lots) == 12


def test_equivalent_baseline_honestly_matches():
    s = tiny((5,), (1,), 4)
    p = optimize(s)
    assert all(b.planned_saved_inr == p.planned_saved_inr for b in compare(s))


@pytest.mark.parametrize('deadline', [0, 8, 20, 35])
def test_short_deadlines(yard, deadline):
    yard.deadline = deadline
    p = optimize(yard)
    assert p.validation.valid
    assert all(t.end <= deadline for t in p.tasks)
    assert all(b.validation.valid for b in compare(yard))


def test_all_resources_unavailable(yard):
    for w in yard.workers:
        w.enabled = False
    p = optimize(yard)
    assert p.tasks == []
    assert p.validation.valid
    assert p.residual_loss_inr == p.initial_loss_inr


def test_forklift_disruption(yard):
    yard.forklifts[0].enabled = False
    p = optimize(yard)
    assert p.validation.valid
    assert all(t.forklift_id is None for t in p.tasks)


def test_worker_availability_and_skills(yard):
    yard.workers[0].available_from = 40
    yard.workers[0].available_until = 55
    p = optimize(yard)
    assert validate(yard, p.tasks).valid
    assert all(t.start >= 40 and t.end <= 55 for t in p.tasks if 'W1' in t.worker_ids)
    assert all('W1' in t.worker_ids for t in p.tasks if t.forklift_id)


def test_completed_resources_and_clock_preserved(yard, optimized):
    first = min(optimized.tasks, key=lambda t: t.end)
    yard.completed = [first]
    yard.now_minute = first.end
    p = optimize(yard)
    assert p.validation.valid
    assert all(t.lot_id != first.lot_id and t.start >= first.end for t in p.tasks)
    assert all(not first.tarp_id or t.tarp_id != first.tarp_id for t in p.tasks)
    assert all(not first.storage_id or t.storage_id != first.storage_id for t in p.tasks)
    assert p.completed_saved_inr == first.saved_loss_inr
    assert p.residual_loss_inr == p.initial_loss_inr-p.completed_saved_inr-p.planned_saved_inr


def valid_cover():
    return Task(lot_id='L0', action='cover', start=0, end=4, worker_ids=['W'], tarp_id='T0', saved_loss_inr=10)


@pytest.mark.parametrize('change,expected', [
    ({'end':5}, 'duration'), ({'start':1,'end':5}, 'window'),
    ({'worker_ids':[]}, 'crew'), ({'worker_ids':['W','W']}, 'crew'),
    ({'worker_ids':['unknown']}, 'unknown worker'), ({'tarp_id':'missing'}, 'incompatible'),
    ({'tarp_id':None}, 'protection resource'), ({'storage_id':'S'}, 'protection resource'),
    ({'saved_loss_inr':999}, 'benefit'), ({'forklift_id':'F'}, 'forklift'),
    ({'lot_id':'unknown'}, 'unknown lot'), ({'action':'relocate'}, 'not permitted')])
def test_validator_rejects_mutations(change, expected):
    t = valid_cover().model_copy(update=change)
    result = validate(tiny(), [t])
    assert not result.valid
    assert any(expected in e for e in result.errors)


def test_validator_overlap_duplicate_and_persistent_assets():
    s = tiny()
    first = valid_cover()
    second = Task(lot_id='L1', action='cover', start=1, end=3, worker_ids=['W'], tarp_id='T0', saved_loss_inr=8)
    result = validate(s, [first, second])
    assert any('overlapping worker' in e for e in result.errors)
    assert any('already allocated' in e for e in result.errors)
    assert not validate(s, [first, first]).valid
    # Tarp remains occupied even when time intervals don't overlap.
    s.deadline = 6
    second.start, second.end = 4, 6
    assert any('already allocated' in e for e in validate(s,[first,second]).errors)


def test_validator_capacity_category_disabled_skill_and_forklift(yard, optimized):
    cover = next(t for t in optimized.tasks if t.tarp_id)
    resource = next(r for r in yard.tarps if r.id == cover.tarp_id)
    resource.capacity_kg = 1
    assert not validate(yard, [cover]).valid
    resource.capacity_kg = 10000
    resource.categories = ['plastic']
    assert not validate(yard, [cover]).valid
    resource.categories = ['paper', 'newsprint', 'cardboard']
    resource.enabled = False
    assert not validate(yard, [cover]).valid
    move = next(t for t in optimized.tasks if t.forklift_id)
    yard.workers[0].skills = []
    assert any('skill' in e for e in validate(yard, [move]).errors)
    yard.workers[0].skills = ['forklift', 'bale_handling']
    yard.forklifts[0].enabled = False
    assert any('forklift unavailable' in e for e in validate(yard, [move]).errors)


def test_independent_validator_forklift_overlap():
    s = tiny((10,8),(2,2),4)
    s.workers.append(Worker(id='W2',name='Other'))
    s.forklifts = [Forklift(id='F',name='Forklift')]
    s.storage = [Resource(id=f'S{i}', name='Bay', capacity_kg=2, categories=['paper']) for i in range(2)]
    for l in s.lots:
        l.actions = [Action(kind='relocate', duration=2, workers=1, forklift=True, effectiveness_bps=10000)]
    tasks = [Task(lot_id=f'L{i}',action='relocate',start=0,end=2,worker_ids=[['W','W2'][i]],forklift_id='F',storage_id=f'S{i}',saved_loss_inr=[10,8][i]) for i in range(2)]
    assert any('forklift assignment' in e for e in validate(s,tasks).errors)


@pytest.mark.parametrize('change', [{'deadline':71}, {'now_minute':61}, {'deadline':-1}, {'safety_buffer_minutes':80}])
def test_input_deadline_constraints(yard, change):
    data = yard.model_dump()
    data.update(change)
    with pytest.raises(ValidationError):
        Scenario.model_validate(data)


def test_input_duplicates(yard):
    data = yard.model_dump()
    data['workers'].append(data['workers'][0])
    with pytest.raises(ValidationError):
        Scenario.model_validate(data)
