"""Durable isolated demo state. No tokens are stored; all writes use CAS/transactions."""
import copy
import hashlib
import json
import re
import secrets
import time
from datetime import datetime, timezone
from uuid import uuid4
from botocore.exceptions import ClientError
from .models import Plan, Scenario
from .scenarios import sample
from .workflow import approval_valid, completed_scenario, disrupted_scenario
from .engine import verify_result


class SessionExpired(Exception):
    pass


class RevisionConflict(Exception):
    pass


class QuotaExceeded(Exception):
    pass


def encoded(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


def session_key(token):
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token or ''):
        raise SessionExpired('Demo session is missing or expired')
    return 'SESSION#' + hashlib.sha256(token.encode()).hexdigest()


class DynamoStore:
    def __init__(self, client, table, clock=time.time, ttl=14400):
        self.client, self.table, self.clock, self.ttl = client, table, clock, ttl

    def key(self, pk, sk='STATE'):
        return {'pk': {'S': pk}, 'sk': {'S': sk}}

    def global_quota(self, name, limit, period):
        now = int(self.clock())
        pk = f'QUOTA#{name}#{now // period}'
        try:
            self.client.update_item(TableName=self.table, Key=self.key(pk),
                UpdateExpression='SET expiresAt = :ttl ADD #count :one',
                ConditionExpression='attribute_not_exists(#count) OR #count < :limit',
                ExpressionAttributeNames={'#count': 'count'},
                ExpressionAttributeValues={':ttl': {'N': str(now + period * 2)},
                    ':one': {'N': '1'}, ':limit': {'N': str(limit)}})
        except ClientError as exc:
            if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
                raise QuotaExceeded('Shared demo quota reached; try later') from None
            raise

    def create_session(self):
        self.global_quota('sessions', 100, 3600)
        token = secrets.token_urlsafe(32)
        pk, expires = session_key(token), int(self.clock()) + self.ttl
        state = {'scenario': sample().model_dump(), 'revision': 0, 'latest': None, 'events': [],
                 'compute_backend': 'aws', 'persistence': 'dynamodb', 'expires_at': expires}
        self.client.put_item(TableName=self.table, Item={**self.key(pk), 'version': {'N': '0'},
            'expiresAt': {'N': str(expires)}, 'requests': {'N': '0'}, 'computes': {'N': '0'},
            'data': {'S': encoded(state)}}, ConditionExpression='attribute_not_exists(pk)')
        return {'token': token, 'expires_at': expires}

    def load(self, token, charge=True):
        pk = session_key(token)
        item = self.client.get_item(TableName=self.table, Key=self.key(pk), ConsistentRead=True).get('Item')
        if not item or int(item['expiresAt']['N']) <= self.clock():
            raise SessionExpired('Demo session is missing or expired')
        if charge:
            try:
                self.client.update_item(TableName=self.table, Key=self.key(pk),
                    UpdateExpression='ADD requests :one',
                    ConditionExpression='expiresAt > :now AND requests < :limit',
                    ExpressionAttributeValues={':one': {'N': '1'}, ':now': {'N': str(int(self.clock()))},
                                               ':limit': {'N': '300'}})
            except ClientError as exc:
                if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
                    raise QuotaExceeded('Session request quota reached; start a new demo later') from None
                raise
        return {'pk': pk, 'version': int(item['version']['N']), 'state': json.loads(item['data']['S']),
                'plan_key': item.get('planKey', {}).get('S', '')}

    def compute_lease(self, loaded):
        now = int(self.clock())
        try:
            self.client.update_item(TableName=self.table, Key=self.key(loaded['pk']),
                UpdateExpression='SET leaseUntil = :lease ADD computes :one',
                ConditionExpression='expiresAt > :now AND computes < :limit AND (attribute_not_exists(leaseUntil) OR leaseUntil <= :now)',
                ExpressionAttributeValues={':now': {'N': str(now)}, ':lease': {'N': str(now + 35)},
                    ':one': {'N': '1'}, ':limit': {'N': '20'}})
        except ClientError as exc:
            if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
                raise QuotaExceeded('Demo already computing, expired, or optimisation quota reached') from None
            raise
        # Failed attempts also consume quota; a timed-out lease expires automatically.
        self.global_quota('compute', 200, 86400)

    def release_lease(self, loaded):
        self.client.update_item(TableName=self.table, Key=self.key(loaded['pk']),
            UpdateExpression='REMOVE leaseUntil', ConditionExpression='attribute_exists(pk)')

    def check(self, loaded, revision):
        if revision != loaded['state']['revision']:
            raise RevisionConflict('Yard changed. Refresh and try again.')
        return Scenario.model_validate(loaded['state']['scenario'])

    def event(self, state, kind, detail):
        events = state['events']
        eid = max([e['id'] for e in events], default=0) + 1
        events.insert(0, {'id': eid, 'at': datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(),
                          'kind': kind, 'detail': detail})
        del events[30:]

    def commit(self, loaded, state, *, new_plan=False):
        pk, version = loaded['pk'], loaded['version']
        # Latest data + immutable generation snapshots remain well below DynamoDB's item limit.
        if len(encoded(state).encode()) > 300000:
            raise ValueError('Demo state exceeds its storage limit')
        plan_key = loaded['plan_key']
        writes = []
        if new_plan:
            if loaded['state']['latest']:
                old = copy.deepcopy(loaded['state']['latest'])
                old['state'] = 'superseded'
                writes.append(self.plan_put(pk, plan_key, old, state['expires_at']))
            plan_key = f"PLAN#{version + 1:012d}#{state['latest']['id']}"
        if state['latest']:
            writes.append(self.plan_put(pk, plan_key, state['latest'], state['expires_at']))
        writes.insert(0, {'Update': {'TableName': self.table, 'Key': self.key(pk),
            'UpdateExpression': 'SET #data = :data, #version = :next, planKey = :plan',
            'ConditionExpression': '#version = :previous AND expiresAt > :now',
            'ExpressionAttributeNames': {'#data': 'data', '#version': 'version'},
            'ExpressionAttributeValues': {':data': {'S': encoded(state)}, ':next': {'N': str(version + 1)},
                ':previous': {'N': str(version)}, ':now': {'N': str(int(self.clock()))}, ':plan': {'S': plan_key}}}})
        try:
            self.client.transact_write_items(TransactItems=writes, ClientRequestToken=uuid4().hex)
        except ClientError as exc:
            reasons = [r.get('Code') for r in exc.response.get('CancellationReasons', [])]
            conditional = exc.response['Error']['Code'] == 'ConditionalCheckFailedException'
            cancelled = exc.response['Error']['Code'] == 'TransactionCanceledException' and reasons and all(
                code in ('None', 'ConditionalCheckFailed', 'TransactionConflict') for code in reasons)
            if conditional or cancelled:
                raise RevisionConflict('Yard changed or session expired. Refresh and try again.') from None
            raise
        return state

    def plan_put(self, pk, sk, plan, expires):
        return {'Put': {'TableName': self.table, 'Item': {**self.key(pk, sk),
                'expiresAt': {'N': str(expires)}, 'data': {'S': encoded(plan)}}}}

    def save_plan(self, loaded, revision, result):
        scenario = self.check(loaded, revision)
        verify_result(scenario, result)
        state = copy.deepcopy(loaded['state'])
        pid = uuid4().hex[:12]
        state['latest'] = {'id': pid, 'revision': revision, 'state': 'draft',
            'created': datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(),
            'plan': result.plan.model_dump(), 'comparisons': [p.model_dump() for p in result.comparisons],
            'scenario': scenario.model_dump(), 'execution': result.model_dump(exclude={'plan', 'comparisons'})}
        self.event(state, 'plan_generated', f'{pid}: {result.plan.solver_status}, AWS Lambda')
        return self.commit(loaded, state, new_plan=True)

    def active(self, loaded, pid, expected):
        row = loaded['state']['latest']
        if not row or row['id'] != pid or row['state'] != expected:
            raise RevisionConflict('Only the current active plan permits this action')
        return row

    def approve(self, loaded, pid, revision):
        s = self.check(loaded, revision)
        row = self.active(loaded, pid, 'draft')
        if row['revision'] != revision or not approval_valid(s, Plan.model_validate(row['plan'])):
            raise RevisionConflict('Only a current independently valid draft can be approved')
        state = copy.deepcopy(loaded['state'])
        state['latest']['state'] = 'approved'
        self.event(state, 'manager_approved', pid)
        return self.commit(loaded, state)

    def complete(self, loaded, pid, lot, revision):
        s = self.check(loaded, revision)
        row = self.active(loaded, pid, 'approved')
        if lot in {t.lot_id for t in s.completed}:
            raise RevisionConflict('Lot already completed')
        updated = completed_scenario(s, Plan.model_validate(row['plan']), lot)
        state = copy.deepcopy(loaded['state'])
        state.update(scenario=updated.model_dump(), revision=revision + 1)
        state['latest']['revision'] = revision + 1
        self.event(state, 'completion_recorded', f'{lot}: simulated scheduled-time operator attestation, {pid}')
        return self.commit(loaded, state)

    def disrupt(self, loaded, revision, **changes):
        updated = disrupted_scenario(self.check(loaded, revision), **changes)
        state = copy.deepcopy(loaded['state'])
        state.update(scenario=updated.model_dump(), revision=revision + 1)
        if state['latest']:
            state['latest']['state'] = 'superseded'
        self.event(state, 'disruption_applied', f"Cutoff {updated.deadline}; clock {updated.now_minute}; resources revised")
        return self.commit(loaded, state)

    def reset(self, loaded, revision):
        self.check(loaded, revision)
        state = copy.deepcopy(loaded['state'])
        state.update(scenario=sample().model_dump(), revision=revision + 1)
        if state['latest']:
            state['latest']['state'] = 'superseded'
        self.event(state, 'demo_reset', 'Only this temporary fictional session reset')
        return self.commit(loaded, state)

    def history(self, loaded):
        rows = self.client.query(TableName=self.table, ConsistentRead=True,
            KeyConditionExpression='pk = :pk AND begins_with(sk, :prefix)',
            ExpressionAttributeValues={':pk': {'S': loaded['pk']}, ':prefix': {'S': 'PLAN#'}},
            ScanIndexForward=False, Limit=30).get('Items', [])
        return [json.loads(row['data']['S']) for row in rows if int(row['expiresAt']['N']) > self.clock()]
