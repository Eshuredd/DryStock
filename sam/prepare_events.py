"""Generate reproducible Lambda events from the untouched historical fixture."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.scenarios import sample
from app.optimizer import optimize
from app.models import Scenario


def scenarios():
    original = sample()
    completed = next(t for t in optimize(original).tasks if t.lot_id == 'L02')
    data = original.model_dump()
    data.update(completed=[completed.model_dump()], now_minute=completed.end, deadline=35, rain_arrival_minute=45)
    data['forklifts'][0]['enabled'] = False
    return {'original': original, 'disruption': Scenario.model_validate(data)}


if __name__ == '__main__':
    directory = Path(__file__).parent / 'events'
    directory.mkdir(exist_ok=True)
    for name, s in scenarios().items():
        (directory / f'{name}.json').write_text(json.dumps({'scenario': s.model_dump(), 'solver_seconds': 5}, indent=2, ensure_ascii=False), encoding='utf-8')
    print('Prepared original and disruption events; historical lot assumptions are unchanged.')
