"""Local source capacity audit. Never contacts AWS; Moto is required.

Run: rtk proxy .venv/Scripts/python.exe sam/dynamo_capacity_audit.py
Write evidence: add --output artifacts/cloud-update/capacity-audit.json
The split-counter comparison is a cost-only counterfactual, NOT implemented code.
"""
import argparse
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
sys.path.insert(0, str(ROOT / 'backend' / 'tests'))
from dynamo_capacity_model import CapacityMeter, WriteBudget
from test_cloud import call
from app import cloud_handler
from app.dynamo import DynamoStore
from app.engine import ComputeRequest, execute
from app.scenarios import sample
from moto import mock_aws
import boto3
from botocore.exceptions import ClientError


def trace_workflow(rounds):
    # Compute once with the unchanged real engine. Every reuse is revalidated
    # by save_plan; this does not measure Lambda/solver latency or CPU load.
    result = execute(ComputeRequest(scenario=sample()), backend='aws')
    with mock_aws(), patch.dict('os.environ', {'DRYSTOCK_ORIGIN': 'https://example.cloudfront.net'}):
        client = boto3.client('dynamodb', region_name='ap-south-1')
        client.create_table(TableName='local-capacity-audit',
            AttributeDefinitions=[{'AttributeName': k, 'AttributeType': 'S'} for k in ('pk', 'sk')],
            KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
            BillingMode='PROVISIONED', ProvisionedThroughput={'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5})
        meter = CapacityMeter(client)
        store = DynamoStore(meter, 'local-capacity-audit', clock=lambda: 100000)
        requests = []
        def request(label, path, token='', body=None, method='POST'):
            meter.label = label
            start = len(meter.records)
            status, state = call(path, token, body, method)
            assert status in (200, 201), (label, status, state)
            calls = meter.records[start:]
            requests.append({'label': label, 'rcu': sum(r['rcu'] for r in calls),
                'wcu': sum(r['wcu'] for r in calls),
                'split_counter_wcu': sum(1 if r['counter_or_lease'] else r['wcu'] for r in calls),
                'operations': calls})
            return state
        def refresh(token, prefix):
            request(prefix + ':state', '/api/state', token, method='GET')
            return request(prefix + ':history', '/api/plans', token, method='GET')
        with patch.object(cloud_handler, '_store', store), patch.object(cloud_handler, 'execute',
                side_effect=lambda *a, **kw: result.model_copy(deep=True)):
            token = request('session', '/api/sessions')['token']
            refresh(token, 'initial')
            revision = 0
            for i in range(rounds):
                prefix = str(i + 1)
                s = request(prefix + ':generate', '/api/plans', token, {'revision': revision})
                pid = s['latest']['id']
                refresh(token, prefix + ':generated')
                request(prefix + ':approve', f'/api/plans/{pid}/approve', token, {'revision': revision})
                refresh(token, prefix + ':approved')
                lot = min(s['latest']['plan']['tasks'], key=lambda t: t['end'])['lot_id']
                s = request(prefix + ':complete', f'/api/plans/{pid}/tasks/{lot}/complete', token, {'revision': revision})
                revision += 1
                refresh(token, prefix + ':completed')
                request(prefix + ':disrupt', '/api/disruptions', token, {'revision': revision,
                    'deadline': s['scenario']['deadline'], 'now_minute': s['scenario']['now_minute'],
                    'forklift_enabled': False})
                revision += 1
                refresh(token, prefix + ':disrupted')
                s = request(prefix + ':reset', '/api/reset', token, {'revision': revision})
                revision += 1
                assert s['latest'] is None and s['scenario'] == sample().model_dump()
                history = refresh(token, prefix + ':reset')
                assert len(history) == i + 1 and all(p['state'] == 'superseded' for p in history)
    return requests


def replay(requests, visitors, spacing, rate, field):
    """Round-robin visitors at a fixed aggregate API arrival interval.

    Demand is accounted even after the first refusal so figures include offered
    load; this is not a service response trace. Calls in each request occur at
    arrival time. Full five-minute burst credit is optimistic and optional in AWS.
    """
    now = [0.0]
    budget = WriteBudget(rate, lambda: now[0])
    rejected = 0
    first = None
    demand = 0
    for r in requests:
        for visitor in range(visitors):
            units = r[field]
            demand += units
            try:
                budget.consume(units, 'Replay')
            except ClientError:
                rejected += 1
                if first is None:
                    first = {'at_seconds': now[0], 'visitor': visitor + 1, 'request': r['label']}
            now[0] += spacing
    return {'rate_per_second': rate, 'field': field, 'visitors': visitors,
        'aggregate_request_spacing_seconds': spacing, 'duration_seconds': now[0],
        'offered_units': demand, 'mean_units_per_second': round(demand / now[0], 2),
        'model_rejected_requests': rejected, 'first_model_rejection': first}


def audit(rounds=5, visitors=3, spacing=2):
    requests = trace_workflow(rounds)
    return {'evidence_type': 'offline source measurement and synthetic capacity budget; not AWS load verification',
        'rounds_per_visitor': rounds, 'scenario': 'unchanged fictional sample',
        'numeric_item_size': 'AWS approximate numeric encoding; UTF-8 string lengths measured',
        'replay_limitations': 'No AWS partitions, adaptive capacity, SDK retries, solver timing, gateway throttling or worst-case custom inputs modeled',
        'counterfactual': 'Only request/compute/lease writes charged as <=1KiB metadata; no implementation or deployment',
        'requests': requests,
        'replays': [replay(requests, visitors, spacing, rate, field)
            for rate in (5, 25, 50, 100) for field in ('wcu', 'split_counter_wcu', 'rcu')],
        'gateway_rate_stress': {'assumptions': f'Four successive cohorts of {visitors} visitors; each fresh visitor runs {rounds} cycles. Same successful source trace replayed, 2 aggregate requests/sec, full initial five-minute credit. Offered load only; not live responses.',
            'replays': [replay(requests * 4, visitors, 0.5, rate, field)
                for rate in (5, 25, 50, 75, 100, 125) for field in ('wcu', 'split_counter_wcu', 'rcu')]}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rounds', type=int, choices=range(1, 11), default=5)
    parser.add_argument('--visitors', type=int, choices=range(2, 6), default=3)
    parser.add_argument('--spacing', type=float, default=2, help='Aggregate synthetic API request interval, seconds')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.spacing < 0.5:
        parser.error('Do not model traffic above the existing gateway sustained 2 requests/sec')
    evidence = audit(args.rounds, args.visitors, args.spacing)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'requests_per_visitor': len(evidence['requests']), 'replays': evidence['replays']}, indent=2))
