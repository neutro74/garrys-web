// Hub server: chat, lobbies and signal relay over a real socket (Node's built-in WebSocket client).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 1000);
let proc;
test.before(async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));   // accounts, chat and files of this run only
  proc = spawn(process.execPath, ['hub/hub.mjs'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', WS_CACHE: cache } });
  proc.on('exit', () => fs.rmSync(cache, { recursive: true, force: true }));
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
  assert.equal(r.ok, true); assert.ok(r.rooms.some((x) => x.name === 'general' && x.category));
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

// Accounts used by the social tests: registered over HTTP, then signed in on a chat socket.
async function account(prefix) {
  const base = `http://127.0.0.1:${PORT}`, user = prefix + Math.floor(Math.random() * 1e6);
  const { token } = await (await fetch(base + '/acct/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, pass: 'secret1' }) })).json();
  const c = client(); await c.open;
  c.send({ t: 'hello', name: prefix, device: String(Math.floor(Math.random() * 1e9)) }); const welcome = await c.next('welcome');
  c.send({ t: 'auth', user, token }); await c.next('authed'); await c.next('friends');
  return { user, token, c, welcome, auth: { Authorization: `Bearer ${token}`, 'X-User': user } };
}

test('chat: replies, edits, reactions, deletions and mentions', async () => {
  const a = await account('ann'), b = await account('ben');
  for (const x of [a, b]) { x.c.send({ t: 'join', room: 'general' }); await x.c.next('room'); }
  a.c.send({ t: 'say', room: 'general', text: 'first' }); const first = await b.c.next('msg'); await a.c.next('msg');
  b.c.send({ t: 'say', room: 'general', text: `yes @${a.user}`, reply: first.id });
  const reply = await a.c.next('msg'); await b.c.next('msg');
  assert.equal(reply.reply.id, first.id); assert.equal(reply.reply.text, 'first');
  assert.equal((await a.c.next('mention')).from.account, b.user);
  b.c.send({ t: 'edit', room: 'general', id: first.id, text: 'hacked' });
  assert.match((await b.c.next('error')).error, /own/);
  a.c.send({ t: 'edit', room: 'general', id: first.id, text: 'first!' });
  assert.equal((await b.c.next('edited')).text, 'first!'); await a.c.next('edited');
  b.c.send({ t: 'react', room: 'general', id: first.id, emoji: '👍' });
  const r = await a.c.next('reacted'); assert.equal(r.by, b.user); assert.equal(r.on, true); await b.c.next('reacted');
  b.c.send({ t: 'react', room: 'general', id: first.id, emoji: 'not an emoji' }); assert.match((await b.c.next('error')).error, /emoji/);
  // A fresh join sees the edit and the reaction.
  const c = client(); await c.open; c.send({ t: 'hello', name: 'Cat' }); await c.next('welcome');
  c.send({ t: 'join', room: 'general' }); const hist = (await c.next('room')).history;
  const seen = hist.find((m) => m.id === first.id);
  assert.equal(seen.text, 'first!'); assert.ok(seen.edited); assert.deepEqual(seen.reactions, { '👍': [b.user] });
  a.c.send({ t: 'delete', room: 'general', id: first.id }); assert.equal((await c.next('msg-deleted')).id, first.id);
  c.send({ t: 'say', room: 'announcements', text: 'x' }); assert.match((await c.next('error')).error, /room first|admins/);
  for (const x of [a.c, b.c, c]) x.ws.close();
});

test('friends, presence, blocking and private messages', async () => {
  const a = await account('fay'), b = await account('gus');
  a.c.send({ t: 'friend-add', user: b.user });
  assert.equal((await b.c.next('friend-request')).from, a.user);
  b.c.send({ t: 'friend-accept', user: a.user });
  await a.c.next('friend-accepted');
  let f; do { f = await a.c.next('friends'); } while (!f.friends.length);
  assert.equal(f.friends[0].user, b.user); assert.equal(f.friends[0].status, 'online');
  b.c.send({ t: 'activity', activity: { kind: 'game', detail: 'Playing gm_construct', map: 'gm_construct' } });
  let p; do { p = await a.c.next('presence'); } while (p.user !== b.user || !p.activity);
  assert.equal(p.activity.map, 'gm_construct');
  a.c.send({ t: 'dm', to: b.user, text: 'hello' }); const dm = await b.c.next('dm'); assert.ok(dm.id);
  b.c.send({ t: 'react', with: a.user, id: dm.id, emoji: '❤️' }); assert.equal((await a.c.next('reacted')).emoji, '❤️');
  b.c.send({ t: 'block', user: a.user }); await b.c.next('friends');
  a.c.send({ t: 'dm', to: b.user, text: 'still there?' }); assert.match((await a.c.next('error')).error, /not accepting/);
  // Going invisible shows the player as offline to others.
  b.c.send({ t: 'unblock', user: a.user }); await b.c.next('friends');
  b.c.send({ t: 'status', status: 'invisible' }); let ms; do { ms = await b.c.next('my-status'); } while (ms.status !== 'invisible');
  do { p = await a.c.next('presence'); } while (p.user !== b.user);
  assert.equal(p.status, 'offline');
  a.c.ws.close(); b.c.ws.close();
});

test('profiles, cloud files and shared saves', async () => {
  const base = `http://127.0.0.1:${PORT}`, a = await account('hal');
  const put = (p, body, h = {}) => fetch(base + p, { method: 'PUT', headers: { ...a.auth, ...h }, body });
  const prof = await (await put('/profile', JSON.stringify({ display: 'Hal 9000', bio: 'hi\u0000', accent: '#FF8800', status: 'dnd', links: ['https://x.org', 'javascript:alert(1)'] }), { 'Content-Type': 'application/json' })).json();
  assert.equal(prof.display, 'Hal 9000'); assert.equal(prof.accent, '#ff8800'); assert.deepEqual(prof.links, ['https://x.org']);
  // A 1x1 PNG is accepted as an avatar; other bytes are refused.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const withPic = await (await put('/profile/image?kind=avatar', png)).json();
  assert.match(withPic.avatar, /^[a-f0-9]{64}\.png$/);
  assert.equal((await fetch(`${base}/img/${withPic.avatar}`)).headers.get('content-type'), 'image/png');
  assert.equal((await put('/profile/image?kind=avatar', Buffer.from('<svg>'))).status, 415);
  const pub = await (await fetch(`${base}/profiles?u=${a.user},nobody_here`)).json();
  assert.equal(pub.profiles[a.user].status, 'dnd'); assert.equal(Object.keys(pub.profiles).length, 1);
  // Cloud files: only the player's own kinds of files, under garrysmod/.
  assert.equal((await put('/cloud/file?p=garrysmod/saves/a.gms&mtime=5', Buffer.from('save'))).status, 200);
  assert.equal((await put('/cloud/file?p=garrysmod/lua/x.lua', Buffer.from('x'))).status, 400);
  assert.equal((await put('/cloud/file?p=garrysmod/saves/../../x', Buffer.from('x'))).status, 400);
  const list = await (await fetch(`${base}/cloud/list`, { headers: a.auth })).json();
  assert.deepEqual(list.files.map((f) => [f.p, f.size, f.mtime]), [['garrysmod/saves/a.gms', 4, 5]]);
  assert.equal(await (await fetch(`${base}/cloud/file?p=garrysmod/saves/a.gms`, { headers: a.auth })).text(), 'save');
  assert.equal((await fetch(`${base}/cloud/list`)).status, 401);
  // Shares: a GWB1 bundle with the save and its picture.
  const entry = (name, data) => { const n = Buffer.from(name), h = Buffer.alloc(8); h.writeUInt32LE(n.length, 0); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, n, data]); };
  const bundle = Buffer.concat([Buffer.from('GWB1'), entry('saves/castle.gms', Buffer.from('gms')), entry('saves/castle.jpg', Buffer.from([0xff, 0xd8, 0xff, 0]))]);
  const shared = await (await fetch(`${base}/share?kind=save&name=Castle&map=gm_construct`, { method: 'POST', headers: a.auth, body: bundle })).json();
  assert.ok(shared.code); assert.equal(shared.thumb, true);
  const bad = Buffer.concat([Buffer.from('GWB1'), entry('lua/x.lua', Buffer.from('x'))]);
  assert.equal((await fetch(`${base}/share?kind=save`, { method: 'POST', headers: a.auth, body: bad })).status, 400);
  assert.equal((await fetch(`${base}/share?kind=save`, { method: 'POST', body: bundle })).status, 401);
  const got = Buffer.from(await (await fetch(`${base}/share/${shared.code}/file`)).arrayBuffer());
  assert.ok(got.equals(bundle));
  const listed = await (await fetch(`${base}/shares?kind=save&q=castle`)).json();
  assert.equal(listed.items[0].downloads, 1);
  assert.equal((await fetch(`${base}/share/${shared.code}`, { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(`${base}/share/${shared.code}`, { method: 'DELETE', headers: a.auth })).status, 200);
  a.c.ws.close();
});
