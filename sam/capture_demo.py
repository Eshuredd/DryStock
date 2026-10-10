"""Read-only evidence capture for the isolated, completed SAM UI demonstration."""
import argparse
import json
import sys
from pathlib import Path
from urllib.request import urlopen
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.engine import ComputeRequest, ComputeResult, execute, verify_result
from verify_response import modeled_outcomes

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8001)
    parser.add_argument('--output', default='artifacts/phase2/end-to-end.json')
    args = parser.parse_args()
    root = f'http://127.0.0.1:{args.port}/api'
    with urlopen(root + '/state', timeout=10) as response:
        state = json.load(response)
    with urlopen(root + '/plans', timeout=10) as response:
        history = json.load(response)
    saved = state['latest']
    result = ComputeResult.model_validate({**saved['execution'], 'plan': saved['plan'], 'comparisons': saved['comparisons']})
    request = ComputeRequest(scenario=saved['scenario'])
    verify_result(request.scenario, result)
    assert state['compute_backend'] == result.execution_backend == 'sam'
    assert request.scenario.deadline == 35 and request.scenario.now_minute == 12
    assert len(request.scenario.completed) == 1
    assert request.scenario.completed[0].lot_id == 'L02' and request.scenario.completed[0].tarp_id == 'T2'
    assert not any(f.enabled for f in request.scenario.forklifts)
    assert not any(t.forklift_id or t.tarp_id == 'T2' for t in result.plan.tasks)
    local = execute(request)
    assert modeled_outcomes(local) == modeled_outcomes(result)
    evidence = {'source': root, 'actual_http_response': True, 'outcomes_match': True,
        'independent_validation': True, 'local': modeled_outcomes(local), 'sam': modeled_outcomes(result),
        'state': state, 'history': history}
    Path(args.output).write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print('Real SAM UI disruption state independently validated; local modelled outcomes match.')
