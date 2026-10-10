"""Predeclared variations; never adjusts inputs based on observed solver results."""
import json
import random
from pathlib import Path
from app.models import Scenario
from app.scenarios import sample

SEEDS = tuple(range(1101, 1111))


def scenarios():
    original = sample()
    yield 'historical-original', None, original
    event = Path(__file__).resolve().parents[2] / 'sam' / 'events' / 'disruption.json'
    yield 'historical-disruption', None, Scenario.model_validate(json.loads(event.read_text(encoding='utf-8'))['scenario'])
    for deadline in [0, 10, 20, 35, 90, 120]:
        s = original.model_copy(deep=True)
        s.deadline, s.rain_arrival_minute = deadline, deadline + 10
        yield f'cutoff-{deadline}', None, s
    for unavailable in [('W1',), ('W2',), ('W1','W2'), ('W1','W2','W3')]:
        s = original.model_copy(deep=True)
        for w in s.workers: w.enabled = w.id not in unavailable
        yield 'workers-off-' + '-'.join(unavailable), None, s
    s = original.model_copy(deep=True)
    s.forklifts[0].enabled = False
    yield 'forklift-off', None, s
    for capacity in [0, 300, 700]:
        s = original.model_copy(deep=True)
        for bay in s.storage:
            bay.enabled = capacity > 0
            if capacity: bay.capacity_kg = capacity
        yield f'bay-capacity-{capacity}', None, s
    for allowed in [(), ('T3',)]:
        s = original.model_copy(deep=True)
        for tarp in s.tarps: tarp.enabled = tarp.id in allowed
        yield 'tarps-' + ('-'.join(allowed) or 'none'), None, s
    s = original.model_copy(deep=True)
    for tarp in s.tarps: tarp.categories = ['newsprint']
    for bay in s.storage: bay.categories = ['cardboard']
    yield 'restricted-compatibility', None, s
    for seed in SEEDS:
        rng = random.Random(seed)
        data = original.model_dump()
        data['deadline'] = rng.choice([20,35,50,60,90])
        data['rain_arrival_minute'] = data['deadline'] + 10
        data['lots'] = data['lots'][:rng.randint(8,12)]
        for lot in data['lots']:
            lot['weight_kg'] = rng.randint(150,1500)
            lot['value_inr'] = lot['weight_kg'] * rng.randint(10,30)
            lot['exposed_loss_inr'] = lot['value_inr'] * rng.randint(15,70) // 100 if lot['protection_status'] == 'exposed' else 0
            for action in lot['actions']:
                action['duration'] = max(1, action['duration'] * rng.randint(7,16) // 10)
        for w in data['workers']: w['enabled'] = rng.random() > .15
        data['forklifts'][0]['enabled'] = rng.random() > .3
        for tarp in data['tarps']:
            tarp['enabled'] = rng.random() > .2
            tarp['capacity_kg'] = rng.choice([300,600,900,1500])
        for bay in data['storage']:
            bay['enabled'] = rng.random() > .15
            bay['capacity_kg'] = rng.choice([300,700,1000,1500])
        yield f'generated-{seed}', seed, Scenario.model_validate(data)
