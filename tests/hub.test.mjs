// Hub server: chat, lobbies and signal relay over a real socket (Node's built-in WebSocket client).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 18000 + Math.floor(Math.random() * 1000);
let proc;
test.before(async () => {
  proc = spawn(process.execPath, ['hub/hub.mjs'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' } });
  await new Promise((r) => proc.stdout.once('data', r));
});
test.after(() => proc.kill());

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`), queue = [], waiters = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiters.findIndex((x) => x.t === m.t); if (w >= 0) waiters.splice(w, 1)[0].r(m); else queue.push(m); };
  const next = (t) => { const i = queue.findIndex((m) => m.t === t); if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]); return new Promise((r) => waiters.push({ t, r })); };
  return { ws, next, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => (ws.onopen = r)) };
}

test('chat, lobbies and signaling', async () => {
  const a = client(), b = client();
  await a.open; await b.open;
  a.send({ t: 'say', room: 'general', text: 'x' });
  assert.match((await a.next('error')).error, /hello/);
  a.send({ t: 'hello', name: '  Alice\u0000  ' });
  const wa = await a.next('welcome'); assert.equal(wa.name, 'Alice');
  b.send({ t: 'hello', name: 'Bob' }); const wb = await b.next('welcome');
  a.send({ t: 'join', room: 'general' }); await a.next('room');
  b.send({ t: 'join', room: 'general' }); const rb = await b.next('room'); assert.equal(rb.users.length, 2);
  assert.equal((await a.next('joined')).user.name, 'Bob');
  b.send({ t: 'say', room: 'general', text: 'hi <b>there</b>' });
  assert.equal((await a.next('msg')).text, 'hi <b>there</b>');
  b.send({ t: 'watch-lobbies' }); assert.deepEqual((await b.next('lobbies')).lobbies, []);
  a.send({ t: 'host', lobby: { name: 'Sandbox', edition: 'extended', map: 'gm_construct', max: 4 } });
  const h = await a.next('hosting');
  const l = (await b.next('lobbies')).lobbies[0];
  assert.equal(l.id, h.id); assert.equal(l.edition, 'extended'); assert.equal(l.host, wa.id);
  b.send({ t: 'signal', to: l.host, data: { kind: 'join', lobby: l.id } });
  const s = await a.next('signal'); assert.equal(s.from.id, wb.id); assert.equal(s.data.kind, 'join');
  a.ws.close();
  assert.equal((await b.next('left')).user.name, 'Alice');
  assert.deepEqual((await b.next('lobbies')).lobbies, []);
  b.ws.close();
});

test('rate limit', async () => {
  const c = client(); await c.open; c.send({ t: 'hello', name: 'Spam' }); await c.next('welcome');
  c.send({ t: 'join', room: 'general' }); await c.next('room');
  for (let i = 0; i < 12; i++) c.send({ t: 'say', room: 'general', text: 'x' + i });
  assert.match((await c.next('error')).error, /Slow down/);
  c.ws.close();
});

test('health endpoint', async () => {
  const r = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  assert.equal(r.ok, true); assert.equal(r.rooms.length, 4);
});

test('shared versions round-trip and are sanitised', async () => {
  const base = `http://127.0.0.1:${PORT}`;
  const r = await fetch(`${base}/v`, { method: 'POST', body: JSON.stringify({ name: 'My\u0000 Mod Pack', edition: 'extended', addons: [{ id: '264467687', title: 'Stacker', size: 197798 }, { id: '../etc', title: 'x' }], disabled: ['gm_fork', '../x'] }) });
  const { code } = await r.json();
  assert.match(code, /^[A-Za-z0-9_-]{8}$/);
  const v = await (await fetch(`${base}/v/${code}`)).json();
  assert.equal(v.name, 'My Mod Pack'); assert.equal(v.edition, 'extended');
  assert.deepEqual(v.addons.map((a) => a.id), ['264467687']); assert.deepEqual(v.disabled, ['gm_fork']);
  assert.equal((await fetch(`${base}/v/nope1234`)).status, 404);
});

test('accounts: register, sign in, sync a document, sign out', async () => {
  const base = `http://127.0.0.1:${PORT}`, post = (p, b, h = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) });
  const user = 'tester' + Math.floor(Math.random() * 1e6);
  assert.equal((await post('/acct/register', { user: 'x', pass: 'secret1' })).status, 400);
  const reg = await (await post('/acct/register', { user, pass: 'secret1' })).json();
  assert.ok(reg.token); assert.equal((await post('/acct/register', { user, pass: 'other12' })).status, 409);
  assert.equal((await post('/acct/login', { user, pass: 'wrongpw' })).status, 401);
  const { token } = await (await post('/acct/login', { user: user.toUpperCase(), pass: 'secret1' })).json();
  const auth = { Authorization: `Bearer ${token}`, 'X-User': user };
  const put = await fetch(`${base}/acct/me`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: { versions: [{ id: 'a', name: 'Pack' }] } }) });
  assert.equal(put.status, 200);
  const me = await (await fetch(`${base}/acct/me`, { headers: auth })).json();
  assert.equal(me.doc.versions[0].name, 'Pack');
  assert.equal((await fetch(`${base}/acct/me`, { headers: { ...auth, Authorization: 'Bearer ' + 'x'.repeat(40) } })).status, 401);
  await post('/acct/logout', {}, auth);
  assert.equal((await fetch(`${base}/acct/me`, { headers: auth })).status, 401);
});
