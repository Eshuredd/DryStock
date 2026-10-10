/* global URL, Headers, Response */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
}).outputText;

function client(base, fetchImpl, storage = new Map()) {
  const context = {exports: {}, process: {env: {NEXT_PUBLIC_API_BASE_URL: base}}, Headers, Date,
    fetch: fetchImpl, sessionStorage: {getItem: k => storage.get(k) ?? null,
      setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k)}};
  vm.runInNewContext(source, context);
  return context.exports;
}
const json = (data, status=200) => new Response(JSON.stringify(data), {status});
const session = {token: 'test-capability', expires_at: Math.floor(Date.now()/1000)+14400};

test('local requests preserve relative proxy and have no session requirement', async () => {
  const calls = [];
  const api = client('', async (...args) => {calls.push(args); return json({});});
  assert.equal(api.cloudDemo, false);
  await api.apiFetch('/api/state');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/state');
});
test('cloud session creation is shared across simultaneous first requests', async () => {
  const calls = [];
  const api = client('https://api.example.invalid/', async (url, options) => {
    calls.push({url,options});
    return json(url.endsWith('/sessions') ? session : {});
  });
  await Promise.all([api.apiFetch('/api/state'),api.apiFetch('/api/plans')]);
  assert.equal(calls.filter(c => c.url.endsWith('/sessions')).length, 1);
  for (const call of calls.filter(c => !c.url.endsWith('/sessions'))) {
    assert.equal(call.options.headers.get('Authorization'), 'Bearer test-capability');
    assert(!call.url.includes(session.token));
    assert.equal(call.options.cache, 'no-store');
  }
});
test('reload uses retained per-tab token rather than making another session', async () => {
  const storage = new Map([['drystock-demo-session-v1', JSON.stringify(session)]]);
  const calls=[];
  await client('https://api.example.invalid', async url => {calls.push(url);return json({});}, storage).apiFetch('/api/state');
  assert.deepEqual(calls,['https://api.example.invalid/api/state']);
});
test('expired GET session is safely recreated once', async () => {
  const storage = new Map([['drystock-demo-session-v1', JSON.stringify(session)]]);
  let reads=0;
  const api = client('https://api.example.invalid', async url => {
    if (url.endsWith('/sessions')) return json(session);
    return json({}, ++reads === 1 ? 401 : 200);
  }, storage);
  assert.equal((await api.apiFetch('/api/state')).status, 200);
  assert.equal(reads,2);
});
test('expired mutation is never replayed into a new session', async () => {
  const storage = new Map([['drystock-demo-session-v1', JSON.stringify(session)]]);
  let calls=0;
  const api = client('https://api.example.invalid', async () => {calls++;return json({},401);}, storage);
  assert.equal((await api.apiFetch('/api/reset',{method:'POST'})).status,401);
  assert.equal(calls,1);
  assert.equal(storage.size,0);
});
test('API client rejects arbitrary external paths', async () => {
  const api = client('https://api.example.invalid', async () => {throw new Error('must not fetch');});
  await assert.rejects(()=>api.apiFetch('https://unrelated.example'), /Invalid API path/);
});
