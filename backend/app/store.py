"""SQLite snapshots and audit events, serialized writes with optimistic revisions."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from .models import Scenario, Plan
from .scenarios import sample
from .validator import validate, validate_plan
from .workflow import approval_valid, completed_scenario, disrupted_scenario


class Conflict(Exception):
    pass


class Store:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS yard (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, comparisons TEXT NOT NULL, created TEXT NOT NULL, scenario TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
            ''')
            columns = {r['name'] for r in db.execute('PRAGMA table_info(plans)')}
            if 'execution' not in columns:
                db.execute("ALTER TABLE plans ADD COLUMN execution TEXT NOT NULL DEFAULT '{}'")
            if 'epoch' not in columns:
                db.execute('ALTER TABLE plans ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0')
            yard_columns = {r['name'] for r in db.execute('PRAGMA table_info(yard)')}
            if 'epoch' not in yard_columns:
                db.execute('ALTER TABLE yard ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0')
                db.execute("ALTER TABLE yard ADD COLUMN input_source TEXT NOT NULL DEFAULT 'sample'")
            db.execute('INSERT OR IGNORE INTO yard(id,revision,data) VALUES (1, 0, ?)', (sample().model_dump_json(),))
            # Upgrade resets from older databases without relying on the bounded UI audit list.
            if 'epoch' not in columns:
                reset = db.execute("SELECT at FROM events WHERE kind='demo_reset' ORDER BY id DESC LIMIT 1").fetchone()
                if reset:
                    db.execute('UPDATE yard SET epoch=1 WHERE id=1')
                    db.execute('UPDATE plans SET epoch=1 WHERE created>?', (reset['at'],))

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def event(self, db, kind, detail):
        db.execute('INSERT INTO events(at,kind,detail) VALUES (?,?,?)', (datetime.now(timezone.utc).isoformat(), kind, detail))

    def yard(self, db):
        row = db.execute('SELECT * FROM yard WHERE id=1').fetchone()
        return Scenario.model_validate_json(row['data']), row['revision']

    def plan_row(self, row):
        if row is None:
            return None
        return {'id': row['id'], 'revision': row['revision'], 'state': row['state'], 'created': row['created'],
                'plan': json.loads(row['data']), 'comparisons': json.loads(row['comparisons']), 'scenario': json.loads(row['scenario']),
                'execution': json.loads(row['execution']), 'scenario_epoch': row['epoch']}

    def state(self):
        with self.connection() as db:
            s, rev = self.yard(db)
            meta = db.execute('SELECT epoch,input_source FROM yard WHERE id=1').fetchone()
            row = db.execute('SELECT * FROM plans WHERE epoch=? ORDER BY rowid DESC LIMIT 1', (meta['epoch'],)).fetchone()
            return {'scenario': s.model_dump(), 'revision': rev, 'latest': self.plan_row(row),
                    'scenario_epoch': meta['epoch'], 'input_source': meta['input_source'],
                    'events': [dict(e) for e in db.execute('SELECT * FROM events ORDER BY id DESC LIMIT 30')]}

    def check(self, db, revision):
        s, rev = self.yard(db)
        if revision != rev:
            raise Conflict('Yard changed. Refresh and try again.')
        return s, rev

    def save_plan(self, revision: int, plan: Plan, comparisons: list[Plan], execution: dict | None = None):
        with self.connection() as db:
            s, rev = self.check(db, revision)
            if any(not validate_plan(s, p).valid for p in [plan, *comparisons]):
                raise ValueError('Cannot save invalid plan or baseline summary')
            db.execute("UPDATE plans SET state='superseded' WHERE state IN ('draft','approved')")
            pid = uuid4().hex[:12]
            epoch = db.execute('SELECT epoch FROM yard WHERE id=1').fetchone()['epoch']
            db.execute('INSERT INTO plans(id,revision,state,data,comparisons,created,scenario,execution,epoch) VALUES (?,?,?,?,?,?,?,?,?)', (pid, rev, 'draft', plan.model_dump_json(),
                       json.dumps([p.model_dump() for p in comparisons]), datetime.now(timezone.utc).isoformat(), s.model_dump_json(),
                       json.dumps(execution or {'execution_backend': plan.execution_backend}), epoch))
            self.event(db, 'plan_generated', f'{pid}: {plan.solver_status}, {len(plan.tasks)} tasks')
            return pid

    def approve(self, pid: str, revision: int):
        with self.connection() as db:
            s, rev = self.check(db, revision)
            row = db.execute('SELECT * FROM plans WHERE id=?', (pid,)).fetchone()
            if not row or row['state'] != 'draft' or row['revision'] != rev:
                raise Conflict('Only a current draft can be approved')
            p = Plan.model_validate_json(row['data'])
            if not approval_valid(s, p):
                raise Conflict('Plan failed independent validation')
            db.execute("UPDATE plans SET state='approved' WHERE id=?", (pid,))
            self.event(db, 'manager_approved', pid)

    def complete(self, pid: str, lot_id: str, revision: int):
        with self.connection() as db:
            s, rev = self.check(db, revision)
            row = db.execute('SELECT * FROM plans WHERE id=?', (pid,)).fetchone()
            if not row or row['state'] != 'approved':
                raise Conflict('Completion requires an approved, active plan')
            if lot_id in {t.lot_id for t in s.completed}:
                raise Conflict('Lot already completed')
            p = Plan.model_validate_json(row['data'])
            s = completed_scenario(s, p, lot_id)
            task = next(t for t in s.completed if t.lot_id == lot_id)
            db.execute('UPDATE yard SET revision=?, data=? WHERE id=1', (rev + 1, s.model_dump_json()))
            db.execute('UPDATE plans SET revision=? WHERE id=?', (rev + 1, pid))
            self.event(db, 'completion_recorded', f'{lot_id}: simulated {task.action}, minute {task.start}–{task.end}, {pid}')

    def disrupt(self, revision: int, *, deadline: int, now_minute: int, disabled_workers: list[str], forklift_enabled: bool):
        with self.connection() as db:
            s, rev = self.check(db, revision)
            updated = disrupted_scenario(s, deadline=deadline, now_minute=now_minute,
                disabled_workers=disabled_workers, forklift_enabled=forklift_enabled)
            db.execute('UPDATE yard SET revision=?, data=? WHERE id=1', (rev + 1, updated.model_dump_json()))
            db.execute("UPDATE plans SET state='superseded' WHERE state IN ('draft','approved')")
            self.event(db, 'disruption_applied', f'Cutoff {deadline}, clock {now_minute}, disabled workers {disabled_workers}, forklift {forklift_enabled}')

    def reset(self, revision: int):
        with self.connection() as db:
            _, rev = self.check(db, revision)
            db.execute("UPDATE yard SET revision=?, data=?, epoch=epoch+1,input_source='sample' WHERE id=1", (rev + 1, sample().model_dump_json()))
            db.execute("UPDATE plans SET state='superseded' WHERE state IN ('draft','approved')")
            self.event(db, 'demo_reset', 'Fictional sample restored; previous plans retained in history')

    def replace_scenario(self, revision: int, scenario: Scenario):
        from .scenario_input import validate_custom
        validate_custom(scenario)
        with self.connection() as db:
            current, rev = self.check(db, revision)
            if current.completed:
                raise Conflict('Reset simulated completed work before replacing scenario inputs')
            db.execute("UPDATE yard SET revision=?,data=?,epoch=epoch+1,input_source='custom' WHERE id=1", (rev + 1, scenario.model_dump_json()))
            db.execute("UPDATE plans SET state='superseded' WHERE state IN ('draft','approved')")
            self.event(db, 'scenario_entered', 'Custom operator assumptions saved for this demo session; previous plans moved to history')

    def history(self):
        with self.connection() as db:
            return [self.plan_row(row) for row in db.execute('SELECT * FROM plans ORDER BY rowid DESC LIMIT 30')]
