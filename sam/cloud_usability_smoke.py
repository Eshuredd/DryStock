"""Bounded verification of the existing AWS demo. Tokens stay in memory.

Only fresh test sessions are changed; no administrator writes to DynamoDB.
Gateway throttles may be retried because the application did not receive them.
Ambiguous mutation failures stop immediately and retain partial evidence.
"""
import argparse
import copy
import json
import re
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.engine import ComputeResult, verify_result
from app.models import Scenario
from app.scenarios import sample


def custom_scenario():
    return {
        'id': 'cloud-custom', 'name': 'Operator test yard',
        'weather_label': 'Assumed rain for deployment test',
        'rain_arrival_minute': 50, 'safety_buffer_minutes': 10,
        'deadline': 40, 'now_minute': 0, 'completed': [],
        'lots': [dict(id=f'own-paper-{letter}', category='paper',
            description=f'Custom paper lot {letter}', weight_kg=500, location='Open yard',
            exposure='high', condition='Dry', value_inr=20000,
            vulnerability=3, exposed_loss_inr=loss, restrictions=[], protection_status='exposed',
            actions=[dict(kind='cover', duration=8, workers=1, forklift=False,
                          required_skills=['paper_handling'], effectiveness_bps=9000),
                     dict(kind='relocate', duration=12, workers=1, forklift=True,
                          required_skills=['paper_handling'], effectiveness_bps=9800)])
            for letter, loss in [('A', 4000), ('B', 3000)]],
        'workers': [dict(id=f'worker-{i}', name=f'Worker {i}', skills=['paper_handling'],
                         available_from=0, available_until=40, enabled=True) for i in (1, 2)],
        'forklifts': [dict(id='lift-1', name='Forklift', available_from=0, available_until=40, enabled=True)],
        'tarps': [dict(id='tarp-1', name='Tarp', capacity_kg=600, categories=['paper'], enabled=True)],
        'storage': [dict(id='bay-1', name='Covered bay', capacity_kg=600, categories=['paper'], enabled=True)],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--api-url', required=True)
    parser.add_argument('--website-url', required=True)
    parser.add_argument('--output', default='artifacts/cloud-update/usability-smoke.json')
    parser.add_argument('--quotas', action='store_true', help='Exercise 20-compute and 300-request limits on fresh sessions')
    parser.add_argument('--stages', nargs='+', choices=['generated', 'approved', 'completed', 'disrupted'],
                        default=['generated', 'approved', 'completed', 'disrupted'])
    args = parser.parse_args()
    api, website = args.api_url.rstrip('/'), args.website_url.rstrip('/')
    if api != 'https://x59yh2i1yf.execute-api.ap-south-1.amazonaws.com' or website != 'https://d38gzj2yabm82w.cloudfront.net':
        raise SystemExit('Only the verified existing DryStock application is accepted')
    evidence = {'started_at': datetime.now(timezone.utc).isoformat(), 'api_url': api,
                'website_url': website, 'checks': [], 'invocations': [], 'passed': False,
                'direct_dynamodb_inspection': 'Unavailable: deployment profile denies DescribeTable. Persistence verified through AWS API.',
                'quota_scope': 'Fresh sessions only; shared 100/hour and 200/day limits are not deliberately exhausted.'}
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    server_time = 0
    pace = 8.0

    def persist():
        destination.write_text(json.dumps(evidence, indent=2), encoding='utf-8')

    def check(name):
        evidence['checks'].append(name)
        persist()
        print('PASS ' + name, flush=True)

    def request(path, token=None, body=None, expected=200, *, origin=website, method=None, raw=None):
        nonlocal server_time
        # Keep normal traffic below the existing API's 2 requests/second setting.
        time.sleep(pace)
        headers = {'Origin': origin, 'Content-Type': 'application/json'}
        if method == 'OPTIONS':
            headers.update({'Access-Control-Request-Method': 'POST',
                            'Access-Control-Request-Headers': 'content-type,authorization'})
        if token:
            headers['Authorization'] = 'Bearer ' + token
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        req = Request(api + path, data=data, headers=headers, method=method)
        for attempt in range(8):
            try:
                with urlopen(req, timeout=45) as response:
                    status, response_headers, payload = response.status, response.headers, response.read()
            except HTTPError as error:
                status, response_headers, payload = error.code, error.headers, error.read()
            result = json.loads(payload) if payload else None
            # Only API Gateway's explicit throttle is replayed. Application quota
            # responses and 503/lost mutation outcomes are never replayed.
            if status == 429 and isinstance(result, dict) and 'detail' not in result and attempt < 7:
                time.sleep(2)
                continue
            break
        assert status == expected, f'{path}: expected {expected}, got {status}; tokens omitted'
        server_time = parsedate_to_datetime(response_headers['Date']).timestamp()
        if origin == website:
            assert response_headers.get('Access-Control-Allow-Origin') == website, f'{path}: CORS mismatch'
        if status not in (204,):
            assert response_headers.get('Cache-Control') == 'no-store', f'{path}: missing no-store'
        return result

    def session():
        data = request('/api/sessions', body={}, expected=201)
        assert 14300 < data['expires_at'] - server_time <= 14400
        return data['token']

    def state(token):
        value = request('/api/state', token)
        assert value['compute_backend'] == 'aws' and value['persistence'] == 'dynamodb'
        return value

    def generate(token, yard):
        result = request('/api/plans', token, {'revision': yard['revision']})
        row = result['latest']
        assert row['state'] == 'draft'
        computed = ComputeResult.model_validate({**row['execution'], 'plan': row['plan'], 'comparisons': row['comparisons']})
        verify_result(Scenario.model_validate(row['scenario']), computed)
        assert computed.execution_backend == 'aws'
        invocation = computed.runtime['aws_request_id']
        assert re.fullmatch(r'[a-f0-9-]{36}', invocation) and computed.runtime['aws_region'] == 'ap-south-1'
        evidence['invocations'].append({'id': invocation, 'scenario_sha256': computed.scenario_sha256})
        return result

    def approve(token, yard):
        return request(f"/api/plans/{yard['latest']['id']}/approve", token, {'revision': yard['revision']})

    def complete(token, yard):
        task = min(yard['latest']['plan']['tasks'], key=lambda task: task['end'])
        result = request(f"/api/plans/{yard['latest']['id']}/tasks/{task['lot_id']}/complete",
                         token, {'revision': yard['revision']})
        assert result['scenario']['completed'] and result['scenario']['now_minute'] == task['end']
        return result

    def reset(token, yard):
        result = request('/api/reset', token, {'revision': yard['revision']})
        assert result['latest'] is None and result['scenario'] == sample().model_dump()
        assert result['input_source'] == 'sample' and result['scenario_epoch'] == yard['scenario_epoch'] + 1
        assert state(token) == result
        history = request('/api/plans', token)
        assert history and all(p['state'] == 'superseded' and p.get('scenario_epoch', 0) < result['scenario_epoch'] for p in history)
        assert result['events'][0]['kind'] == 'demo_reset'
        request('/api/reset', token, {'revision': yard['revision']}, expected=409)
        return result

    try:
        assert request('/api/health')['persistence'] == 'dynamodb'
        request('/api/scenario', body={'revision': 0, 'scenario': custom_scenario()}, expected=401)
        request('/api/state', expected=403, origin='https://example.invalid')
        request('/api/scenario', method='OPTIONS', expected=204)
        check('AWS health, bearer authentication, wrong-origin rejection and scenario CORS preflight')
        a, b = session(), session()
        original_b = state(b)
        yard = state(a)
        for stage in args.stages:
            yard = generate(a, yard)
            assert yard['latest']['plan']['planned_saved_inr'] == 35809
            if stage != 'generated':
                yard = approve(a, yard)
            if stage in ('completed', 'disrupted'):
                yard = complete(a, yard)
            if stage == 'disrupted':
                yard = request('/api/disruptions', a, {'revision': yard['revision'], 'deadline': 35,
                    'now_minute': max(yard['scenario']['now_minute'], 12), 'disabled_workers': [], 'forklift_enabled': False})
                assert yard['latest']['state'] == 'superseded'
            yard = reset(a, yard)
            check(f'reset after {stage}: exact sample restored, latest null, GET matches, history superseded and prior epoch')
        assert state(b) == original_b and request('/api/plans', b) == []
        check('reset and generation do not affect another session')

        custom = custom_scenario()
        invalid = []
        altered = copy.deepcopy(custom); altered['completed'] = [{'lot_id': 'own-paper-A'}]; invalid.append(altered)
        altered = copy.deepcopy(custom); altered['lots'][0]['exposed_loss_inr'] = 20001; invalid.append(altered)
        altered = copy.deepcopy(custom); altered['workers'][0]['available_until'] = 241; invalid.append(altered)
        altered = copy.deepcopy(custom); altered['tarps'][0]['categories'] = ['unknown']; invalid.append(altered)
        altered = copy.deepcopy(custom); altered['lots'] *= 16; invalid.append(altered)
        altered = copy.deepcopy(custom); altered['unexpected'] = True; invalid.append(altered)
        altered = copy.deepcopy(custom); altered['workers'][0]['id'] = 'invalid/id'; invalid.append(altered)
        for altered in invalid:
            expected = 413 if len(json.dumps({'revision': yard['revision'], 'scenario': altered}).encode()) > 32768 else 422
            request('/api/scenario', a, {'revision': yard['revision'], 'scenario': altered}, expected=expected)
        request('/api/scenario', a, raw=b' ' * 32769, expected=413)
        assert state(a) == yard
        check('server rejects injected completions, loss over value, invalid availability/materials/IDs, excessive lots, unknown fields and bodies over 32 KiB without state mutation')

        yard = request('/api/scenario', a, {'revision': yard['revision'], 'scenario': custom})
        pace = 1.5  # Small custom states use far less of the preserved table capacity.
        assert yard['input_source'] == 'custom' and yard['latest'] is None and yard['scenario'] == custom
        assert state(a) == yard
        request('/api/scenario', a, {'revision': yard['revision'] - 1, 'scenario': custom}, expected=409)
        yard = generate(a, yard)
        assert len(yard['latest']['plan']['tasks']) == 2
        request(f"/api/plans/{yard['latest']['id']}/approve", b, {'revision': 0}, expected=409)
        task_id = yard['latest']['plan']['tasks'][0]['lot_id']
        request(f"/api/plans/{yard['latest']['id']}/tasks/{task_id}/complete", a, {'revision': yard['revision']}, expected=409)
        tampered = copy.deepcopy(yard['latest']['plan']); tampered['residual_loss_inr'] += 1
        assert request('/api/validate', a, {'revision': yard['revision'], 'plan': tampered})['valid'] is False
        check('custom inputs persist; independent validation, approval gate, cross-session and stale-revision checks remain active')
        yard = complete(a, approve(a, yard))
        assert state(a) == yard
        request('/api/scenario', a, {'revision': yard['revision'], 'scenario': custom}, expected=409)
        check('custom arbitrary lot IDs: optimise, approve, complete and reload persist through DynamoDB API')
        yard = reset(a, yard)
        assert state(b) == original_b
        check('Use sample yard after custom completion restores exact fixture and separates historical custom results')

        if args.quotas:
            q = session()
            tiny = custom_scenario()
            tiny.update(deadline=0, rain_arrival_minute=10, lots=tiny['lots'][:1], workers=[], forklifts=[], tarps=[], storage=[])
            quota_yard = request('/api/scenario', q, {'revision': 0, 'scenario': tiny})
            for i in range(20):
                quota_yard = generate(q, quota_yard)
                assert not quota_yard['latest']['plan']['tasks']
                if (i + 1) % 5 == 0: print(f'Compute quota: {i+1}/20', flush=True)
            rejected = request('/api/plans', q, {'revision': quota_yard['revision']}, expected=429)
            assert 'quota' in rejected['detail']
            quota_yard = reset(q, quota_yard)
            request('/api/plans', q, {'revision': quota_yard['revision']}, expected=429)
            check('20-compute session limit enforced in AWS; reset does not replenish compute quota')
            q = session()
            # A small state avoids exhausting the table's existing 5 WCU while
            # checking the per-session counter. The save consumes request one.
            request('/api/scenario', q, {'revision': 0, 'scenario': tiny})
            pace = 1.0
            for i in range(299):
                state(q)
                if (i + 1) % 25 == 0: print(f'Request quota: {i+1}/300', flush=True)
            rejected = request('/api/state', q, expected=429)
            assert 'Session request quota' in rejected['detail']
            check('300-request session limit enforced in AWS')
        evidence['passed'] = True
        evidence['finished_at'] = datetime.now(timezone.utc).isoformat()
        persist()
        print('AWS usability workflow passed. No tokens written.', flush=True)
    except Exception as exc:
        evidence['failure'] = f'{type(exc).__name__}: {exc}'
        persist()
        raise


if __name__ == '__main__':
    main()
