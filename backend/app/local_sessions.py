"""Loopback demo capabilities, isolated SQLite yards and bounded session requests."""
import hashlib
import secrets
import sqlite3
import time
from pathlib import Path
from fastapi import HTTPException
from .store import Store


class LocalSessions:
    def __init__(self, db_path: str):
        self.directory = Path(db_path).with_suffix('.sessions')
        self.directory.mkdir(parents=True, exist_ok=True)
        self.registry = self.directory / 'registry.sqlite3'
        with sqlite3.connect(self.registry) as db:
            db.execute('CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, expires INTEGER, requests INTEGER DEFAULT 0, computes INTEGER DEFAULT 0)')

    def create(self):
        token = secrets.token_hex(24)
        key = hashlib.sha256(token.encode()).hexdigest()
        expires = int(time.time()) + 14400
        with sqlite3.connect(self.registry) as db:
            db.execute('BEGIN IMMEDIATE')
            count = db.execute('SELECT count(*) FROM sessions WHERE expires>?', (int(time.time()) + 10800,)).fetchone()[0]
            if count >= 100:
                raise HTTPException(429, 'Demo session limit reached. Retry later.')
            db.execute('INSERT INTO sessions(key,expires) VALUES (?,?)', (key, expires))
        Store(str(self.directory / f'{key}.sqlite3'))
        return {'token': token, 'expires_at': expires}

    def load(self, authorization: str, *, compute: bool = False) -> Store:
        token = authorization.removeprefix('Bearer ')
        if not authorization.startswith('Bearer ') or len(token) != 48 or any(c not in '0123456789abcdef' for c in token):
            raise HTTPException(401, 'Demo session is missing or expired')
        key = hashlib.sha256(token.encode()).hexdigest()
        with sqlite3.connect(self.registry) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT expires,requests,computes FROM sessions WHERE key=?', (key,)).fetchone()
            if not row or row[0] <= time.time():
                raise HTTPException(401, 'Demo session is missing or expired')
            if row[1] >= 300 or (compute and row[2] >= 20):
                raise HTTPException(429, 'Demo session request or generation limit reached')
            db.execute('UPDATE sessions SET requests=requests+1,computes=computes+? WHERE key=?', (int(compute), key))
        return Store(str(self.directory / f'{key}.sqlite3'))
