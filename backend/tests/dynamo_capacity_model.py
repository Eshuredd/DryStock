"""Offline capacity accounting, not an AWS throughput emulator.

Moto deliberately does not enforce provisioned capacity. These helpers meter the
actual DynamoStore calls and inject a deterministic *shared* write budget into
request-counter updates. They never construct a real AWS client.
"""
import copy
import math
import threading
from botocore.exceptions import ClientError


def item_bytes(item):
    """UTF-8 attributes plus AWS's approximate numeric size; scalar items only.

    Excludes the 100-byte storage overhead (not throughput). STATE/PLAN JSON is
    stored as a string, not a DynamoDB document. Numeric sizing is approximate;
    the measured sample items are well away from the relevant rounding edges.
    """
    size = 0
    for name, value in item.items():
        size += len(name.encode('utf-8'))
        if 'S' in value:
            size += len(value['S'].encode('utf-8'))
        elif 'N' in value:
            digits = value['N'].lstrip('-').replace('.', '').lstrip('0') or '0'
            size += math.ceil(len(digits) / 2) + 1
        else:
            raise AssertionError('Capacity audit only supports the scalar session schema')
    return size


def write_units(before, after, transactional=False):
    return max(1, math.ceil(max(item_bytes(before), item_bytes(after)) / 1024)) * (2 if transactional else 1)


class WriteBudget:
    """Synthetic token bucket; five minutes of credit is an optimistic maximum.

    This is NOT DynamoDB's internal burst algorithm, partition allocation or SDK
    retry behavior. No credit is deducted on rejected writes in this model.
    """
    def __init__(self, rate, clock, burst_seconds=300):
        self.rate, self.clock = rate, clock
        self.maximum = rate * max(1, burst_seconds)
        self.credit, self.at = float(self.maximum), clock()

    def consume(self, units, operation='UpdateItem'):
        now = self.clock()
        self.credit = min(self.maximum, self.credit + max(0, now - self.at) * self.rate)
        self.at = now
        if units > self.credit:
            raise ClientError({'Error': {'Code': 'ProvisionedThroughputExceededException',
                'Message': 'Synthetic offline write budget exhausted'}}, operation)
        self.credit -= units


class CapacityMeter:
    """Measure successful calls against a local Moto client, excluding probes."""
    def __init__(self, client):
        self.client, self.records, self.label = client, [], ''
        self.counter_budget = None
        self.lock = threading.RLock()

    def __getattr__(self, name):
        return getattr(self.client, name)

    def image(self, table, key):
        return self.client.get_item(TableName=table, Key=key, ConsistentRead=True).get('Item', {})

    def record(self, operation, rcu=0, wcu=0, images=(), counter_or_lease=False):
        self.records.append({'request': self.label, 'operation': operation, 'rcu': rcu, 'wcu': wcu,
            'item_bytes': [item_bytes(i) for i in images], 'counter_or_lease': counter_or_lease})

    def get_item(self, **kwargs):
        result = self.client.get_item(**kwargs)
        item = result.get('Item', {})
        units = max(1, math.ceil(item_bytes(item) / 4096))
        self.record('GetItem', rcu=units if kwargs.get('ConsistentRead') else units / 2, images=[item])
        return result

    def query(self, **kwargs):
        result = self.client.query(**kwargs)
        rows = result.get('Items', [])
        units = max(1, math.ceil(sum(item_bytes(i) for i in rows) / 4096))
        self.record('Query', rcu=units if kwargs.get('ConsistentRead') else units / 2, images=rows)
        return result

    def put_item(self, **kwargs):
        after = kwargs['Item']
        before = self.image(kwargs['TableName'], {k: after[k] for k in ('pk', 'sk')})
        result = self.client.put_item(**kwargs)
        self.record('PutItem', wcu=write_units(before, after), images=[before, after])
        return result

    def update_item(self, **kwargs):
        with self.lock:
            before = self.image(kwargs['TableName'], kwargs['Key'])
            expression = kwargs['UpdateExpression']
            counter = expression == 'ADD requests :one'
            if counter and self.counter_budget:
                after = copy.deepcopy(before)
                after['requests'] = {'N': str(int(before['requests']['N']) + 1)}
                self.counter_budget.consume(write_units(before, after))
            result = self.client.update_item(**kwargs)
            after = self.image(kwargs['TableName'], kwargs['Key'])
            quota = counter or 'leaseUntil' in expression
            self.record('UpdateItem', wcu=write_units(before, after), images=[before, after], counter_or_lease=quota)
            return result

    def transact_write_items(self, **kwargs):
        pairs = []
        for action in kwargs['TransactItems']:
            kind, spec = next(iter(action.items()))
            assert kind in ('Update', 'Put'), 'Audit must be extended for a different transaction schema'
            key = spec['Key'] if kind == 'Update' else {k: spec['Item'][k] for k in ('pk', 'sk')}
            pairs.append((spec['TableName'], key, self.image(spec['TableName'], key)))
        result = self.client.transact_write_items(**kwargs)
        for table, key, before in pairs:
            after = self.image(table, key)
            self.record('TransactWriteItems', wcu=write_units(before, after, True), images=[before, after])
        return result
