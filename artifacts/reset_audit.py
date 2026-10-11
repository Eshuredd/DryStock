"""Local-only reproduction against the dedicated reset-audit SQLite database."""
import json
import sqlite3
from pathlib import Path
import httpx

root = Path(__file__).resolve().parents[1]
client = httpx.Client(base_url='http://127.0.0.1:8015', timeout=30)
def post(path, state, **extra):
    r = client.post(path, json={'revision': state['revision'], **extra})
    r.raise_for_status()
    return r.json()

initial = client.get('/api/state').json()
s = post('/api/plans', initial)
pid = s['latest']['id']
s = post(f'/api/plans/{pid}/approve', s)
task = min(s['latest']['plan']['tasks'], key=lambda t: t['end'])
s = post(f"/api/plans/{pid}/tasks/{task['lot_id']}/complete", s)
s = post('/api/disruptions', s, deadline=35, now_minute=s['scenario']['now_minute'], forklift_enabled=False, disabled_workers=['W2'])
before = s
s = post('/api/reset', s)
fresh = client.get('/api/state').json()
with sqlite3.connect(root/'artifacts/reset-audit.sqlite3') as db:
    persisted = json.loads(db.execute('select data from yard where id=1').fetchone()[0])
    history = db.execute('select id,state from plans').fetchall()
report = {'http_status': 200, 'before_reset': {'revision':before['revision'], 'completed':len(before['scenario']['completed']), 'deadline':before['scenario']['deadline']},
          'after_reset': {'revision':s['revision'], 'completed':len(s['scenario']['completed']), 'deadline':s['scenario']['deadline'], 'clock':s['scenario']['now_minute'], 'latest':s['latest']},
          'fresh_get_equals_response':fresh == s, 'persisted_equals_initial':persisted == initial['scenario'], 'history':history,
          'reset_event':s['events'][0]}
(root/'artifacts/reset-after-fix.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({**report, 'after_reset':{**report['after_reset'],'latest':{k:s['latest'][k] for k in ('id','state','revision')} if s['latest'] else None}}, indent=2))
