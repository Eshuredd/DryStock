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
            db.execute('INSERT OR IGNORE INTO yard VALUES (1, 0, ?)', (sample().model_dump_json(),))

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
                'execution': json.loads(row['execution'])}

    def state(self):
        with self.connection() as db:
            s, rev = self.yard(db)
            row = db.execute('SELECT * FROM plans ORDER BY rowid DESC LIMIT 1').fetchone()
            return {'scenario': s.model_dump(), 'revision': rev, 'latest': self.plan_row(row),
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
            db.execute('INSERT INTO plans VALUES (?,?,?,?,?,?,?,?)', (pid, rev, 'draft', plan.model_dump_json(),
                       json.dumps([p.model_dump() for p in comparisons]), datetime.now(timezone.utc).isoformat(), s.model_dump_json(),
                       json.dumps(execution or {'execution_backend': plan.execution_backend})))
            self.event(db, 'plan_generated', f'{pid}: {plan.solver_status}, {len(plan.tasks)} tasks')
            return pid

    def approve(self, pid: str, revision: int):
        with self.connection() as db:
            s, rev = self.check(db, revision)
            row = db.execute('SELECT * FROM plans WHERE id=?', (pid,)).fetchone()
            if not row or row['state'] != 'draft' or row['revision'] != rev:
                raise Conflict('Only a current draft can be approved')
            p = Plan.model_validate_json(row['data'])
            if not validate_plan(s, p).valid:
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
            task = next((t for t in p.tasks if t.lot_id == lot_id), None)
            if task is None:
                raise ValueError('Lot is not scheduled in this plan')
            # The demo records operator-attested execution at scheduled times. No partial operations.
            history = validate(s, s.completed + [task], history=True)
            if not history.valid:
                raise Conflict('Invalid completion: ' + '; '.join(history.errors))
            s.completed.append(task)
            s.now_minute = max(s.now_minute, task.end)
            db.execute('UPDATE yard SET revision=?, data=? WHERE id=1', (rev + 1, s.model_dump_json()))
            db.execute('UPDATE plans SET revision=? WHERE id=?', (rev + 1, pid))
            self.event(db, 'completion_recorded', f'{lot_id}: simulated {task.action}, minute {task.start}–{task.end}, {pid}')

    def disrupt(self, revision: int, *, deadline: int, now_minute: int, disabled_workers: list[str], forklift_enabled: bool):
        with self.connection() as db:
            s, rev = self.check(db, revision)
            if not set(disabled_workers) <= {w.id for w in s.workers}:
                raise ValueError('Unknown worker')
            if now_minute < s.now_minute:
                raise ValueError('Scenario clock cannot move backwards')
            data = s.model_dump()
            data.update(deadline=deadline, now_minute=now_minute, rain_arrival_minute=deadline + s.safety_buffer_minutes)
            for w in data['workers']:
                w['enabled'] = w['id'] not in disabled_workers
            for f in data['forklifts']:
                f['enabled'] = forklift_enabled
            updated = Scenario.model_validate(data)
            if not validate(updated, updated.completed, history=True).valid:
                raise ValueError('Change invalidates completed history')
            db.execute('UPDATE yard SET revision=?, data=? WHERE id=1', (rev + 1, updated.model_dump_json()))
            db.execute("UPDATE plans SET state='superseded' WHERE state IN ('draft','approved')")
            self.event(db, 'disruption_applied', f'Cutoff {deadline}, clock {now_minute}, disabled workers {disabled_workers}, forklift {forklift_enabled}')

    def reset(self, revision: int):
        with self.connection() as db:
            _, rev = self.check(db, revision)
            db.execute('UPDATE yard SET revision=?, data=? WHERE id=1', (rev + 1, sample().model_dump_json()))
            db.execute("UPDATE plans SET state='superseded' WHERE state IN ('draft','approved')")
            self.event(db, 'demo_reset', 'Fictional sample restored; previous plans retained in history')

    def history(self):
        with self.connection() as db:
            return [self.plan_row(row) for row in db.execute('SELECT * FROM plans ORDER BY rowid DESC LIMIT 30')]
