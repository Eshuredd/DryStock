"""Run ONLY after approved deployment. Tokens remain in memory, never evidence files."""
import argparse
import copy
import json
import re
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))
from app.engine import ComputeRequest, ComputeResult, execute, verify_result
from verify_response import modeled_outcomes

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--api-url', required=True)
    parser.add_argument('--website-url', required=True)
    parser.add_argument('--output', default='artifacts/phase3/cloud-smoke.json')
    args = parser.parse_args()
    api, website = args.api_url.rstrip('/'), args.website_url.rstrip('/')
    if not re.fullmatch(r'https://[a-z0-9]+\.execute-api\.ap-south-1\.amazonaws\.com', api):
        raise SystemExit('Only the actual ap-south-1 API Gateway endpoint is accepted')
    if not re.fullmatch(r'https://[a-z0-9]+\.cloudfront\.net', website):
        raise SystemExit('Only the actual CloudFront HTTPS endpoint is accepted')
    with urlopen(website, timeout=30) as site:
        assert site.status == 200 and b'DryStock' in site.read()

    def request(path, token=None, body=None, expected=200):
        headers = {'Origin': website, 'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = Request(api + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        for attempt in range(8):
            try:
                with urlopen(req, timeout=40) as response:
                    code, data, cors = response.status, json.load(response), response.headers.get('Access-Control-Allow-Origin')
            except HTTPError as error:
                code, data, cors = error.code, json.load(error), error.headers.get('Access-Control-Allow-Origin')
            if code != 429 or expected == 429:
                break
            time.sleep(1)
        assert code == expected, f'{path}: expected HTTP {expected}, received {code}; no token printed'
        assert cors == website, f'{path}: exact frontend CORS origin missing'
        return data

    a = request('/api/sessions', body={}, expected=201)['token']
    b = request('/api/sessions', body={}, expected=201)['token']
    request('/api/state', expected=401)
    original = request('/api/plans', a, {'revision': 0})
    pid = original['latest']['id']
    assert original['latest']['plan']['planned_saved_inr'] == 35809
    assert max(p['planned_saved_inr'] for p in original['latest']['comparisons']) == 35550
    request(f'/api/plans/{pid}/approve', b, {'revision': 0}, expected=409)
    request(f'/api/plans/{pid}/approve', a, {'revision': 0})
    done = request(f'/api/plans/{pid}/tasks/L02/complete', a, {'revision': 0})
    assert done['scenario']['completed'][0]['tarp_id'] == 'T2'
    request('/api/reset', a, {'revision': 0}, expected=409)
    disrupted = request('/api/disruptions', a, {'revision': 1, 'deadline': 35,
        'now_minute': 12, 'disabled_workers': [], 'forklift_enabled': False})
    assert disrupted['latest']['state'] == 'superseded'
    revised = request('/api/plans', a, {'revision': 2})
    assert revised['latest']['plan']['planned_saved_inr'] == 16821
    assert max(p['planned_saved_inr'] for p in revised['latest']['comparisons']) == 14985
    assert request('/api/state', a) == revised
    other = request('/api/state', b)
    assert other['revision'] == 0 and other['latest'] is None and not other['scenario']['completed']
    assert request('/api/plans', b) == []
    bad = copy.deepcopy(revised['latest']['plan'])
    bad['residual_loss_inr'] += 1
    assert request('/api/validate', a, {'revision': 2, 'plan': bad})['valid'] is False
    checks = []
    for state in (original, revised):
        row = state['latest']
        result = ComputeResult.model_validate({**row['execution'], 'plan': row['plan'], 'comparisons': row['comparisons']})
        scenario = ComputeRequest(scenario=row['scenario'])
        assert result.execution_backend == 'aws'
        assert result.runtime['aws_request_id'] != 'local-emulator'
        verify_result(scenario.scenario, result)
        assert modeled_outcomes(result) == modeled_outcomes(execute(scenario))
        checks.append({'scenario_sha256': result.scenario_sha256, 'invocation_id': result.runtime['aws_request_id'],
            'runtime': result.runtime, 'outcomes': modeled_outcomes(result), 'local_outcomes_match': True})
    evidence = {'api_url': api, 'website_url': website, 'real_cloud': True,
        'http_session_isolation': True, 'persistence_reload': True, 'cors': True,
        'stale_revision_rejected': True, 'invalid_plan_rejected': True, 'results': checks,
        'browser_workflow': 'Not checked by this script; separate public browser verification required'}
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(evidence, indent=2))
    print('Actual cloud HTTP workflow and two-session isolation passed. No session tokens written.')
