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
  proc = spawn(process.execPath, ['hub/hub.mjs'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', WS_CACHE: cache, ACCOUNT_ATTEMPTS: '200' } });
  proc.on('exit', () => fs.rmSync(cache, { recursive: true, force: true }));
  await new Promise((r) => proc.stdout.once('data', r));
});
test.after(() => proc.kill());

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`), queue = [], waiters = [];
  ws.onmessage = (e) => { if (typeof e.data !== 'string') return; const m = JSON.parse(e.data); const w = waiters.findIndex((x) => x.t === m.t); if (w >= 0) waiters.splice(w, 1)[0].r(m); else queue.push(m); };
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
  // Chat is for accounts: a guest's join gets an empty, locked room and saying anything is refused.
  a.send({ t: 'join', room: 'general' }); const ra = await a.next('room'); assert.equal(ra.locked, true); assert.deepEqual(ra.history, []);
  a.send({ t: 'say', room: 'general', text: 'hi' }); assert.match((await a.next('error')).error, /account/);
  b.send({ t: 'watch-lobbies' }); assert.deepEqual((await b.next('lobbies')).lobbies, []);
  a.send({ t: 'host', lobby: { name: 'Sandbox', edition: 'extended', map: 'gm_construct', max: 4 } });
  const h = await a.next('hosting');
  const l = (await b.next('lobbies')).lobbies[0];
  assert.equal(l.id, h.id); assert.equal(l.edition, 'extended'); assert.equal(l.host, wa.id);
  b.send({ t: 'signal', to: l.host, data: { kind: 'join', lobby: l.id } });
  const s = await a.next('signal'); assert.equal(s.from.id, wb.id); assert.equal(s.data.kind, 'join');
  a.ws.close();
  assert.deepEqual((await b.next('lobbies')).lobbies, []);
  b.ws.close();
});

test('rate limit', async () => {
  const { c } = await account('spam');
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
  c.send({ t: 'auth', user, token }); await c.next('authed'); await c.next('friends'); await c.next('pings');
  return { user, token, c, welcome, auth: { Authorization: `Bearer ${token}`, 'X-User': user } };
}

test('chat: replies, edits, reactions, deletions and mentions', async () => {
  const a = await account('ann'), b = await account('ben');
  for (const x of [a, b]) { x.c.send({ t: 'join', room: 'general' }); await x.c.next('room'); }
  a.c.send({ t: 'say', room: 'general', text: 'first' }); const first = await b.c.next('msg'); await a.c.next('msg');
  b.c.send({ t: 'say', room: 'general', text: `yes @${a.user}`, reply: first.id });
  const reply = await a.c.next('msg'); await b.c.next('msg');
  assert.equal(reply.reply.id, first.id); assert.equal(reply.reply.text, 'first'); assert.equal(reply.reply.account, a.user);
  const ping = await a.c.next('ping'); assert.equal(ping.from.account, b.user); assert.equal(ping.kind, 'mention');
  b.c.send({ t: 'edit', room: 'general', id: first.id, text: 'hacked' });
  assert.match((await b.c.next('error')).error, /own/);
  a.c.send({ t: 'edit', room: 'general', id: first.id, text: 'first!' });
  assert.equal((await b.c.next('edited')).text, 'first!'); await a.c.next('edited');
  b.c.send({ t: 'react', room: 'general', id: first.id, emoji: '👍' });
  const r = await a.c.next('reacted'); assert.equal(r.by, b.user); assert.equal(r.on, true); await b.c.next('reacted');
  b.c.send({ t: 'react', room: 'general', id: first.id, emoji: 'not an emoji' }); assert.match((await b.c.next('error')).error, /emoji/);
  // A fresh join sees the edit and the reaction.
  const { c } = await account('cat');
  c.send({ t: 'join', room: 'general' }); const hist = (await c.next('room')).history;
  const seen = hist.find((m) => m.id === first.id);
  assert.equal(seen.text, 'first!'); assert.ok(seen.edited); assert.deepEqual(seen.reactions, { '👍': [b.user] });
  a.c.send({ t: 'delete', room: 'general', id: first.id }); assert.equal((await c.next('msg-deleted')).id, first.id);
  c.send({ t: 'say', room: 'announcements', text: 'x' }); assert.match((await c.next('error')).error, /room first|admins/);
  for (const x of [a.c, b.c, c]) x.ws.close();
});

test('pings: answers, quiet answers, kept while away, @ suggestions', async () => {
  const a = await account('pia'), b = await account('pob');
  for (const x of [a, b]) { x.c.send({ t: 'join', room: 'general' }); await x.c.next('room'); }
  a.c.send({ t: 'say', room: 'general', text: 'question?' }); const q = await b.c.next('msg'); await a.c.next('msg');
  b.c.send({ t: 'say', room: 'general', text: 'quiet answer', reply: q.id, replyPing: false }); await a.c.next('msg'); await b.c.next('msg');
  b.c.send({ t: 'say', room: 'general', text: 'loud answer', reply: q.id }); await a.c.next('msg'); await b.c.next('msg');
  const p = await a.c.next('ping'); assert.equal(p.kind, 'reply'); assert.equal(p.text, 'loud answer');
  // @everyone means nothing from a player who is not an admin.
  b.c.send({ t: 'say', room: 'general', text: 'hey @everyone' }); assert.equal((await a.c.next('msg')).everyone, undefined); await b.c.next('msg');
  // Signing in again (another browser, later) brings the kept pings.
  a.c.send({ t: 'auth', user: a.user, token: a.token }); const kept = await a.c.next('pings');
  assert.equal(kept.list.length, 1); assert.equal(kept.list[0].text, 'loud answer');
  a.c.send({ t: 'pings-seen', at: Date.now() }); assert.ok((await a.c.next('pings-seen')).at > 0);
  a.c.send({ t: 'find-users', q: b.user.slice(0, 5) }); assert.ok((await a.c.next('found-users')).users.includes(b.user));
  for (const x of [a.c, b.c]) x.ws.close();
});

test('automod: slurs, repeats, mention spam, names; strikes mute', async () => {
  const a = await account('amy'), b = await account('bea');
  for (const x of [a, b]) { x.c.send({ t: 'join', room: 'general' }); await x.c.next('room'); }
  const blocked = async (text) => { a.c.send({ t: 'say', room: 'general', text }); return a.c.next('automod'); };
  const hit = await blocked('you are a f4gg0t'); assert.equal(hit.rule, 'words'); assert.equal(hit.text, 'you are a f4gg0t');
  a.c.send({ t: 'say', room: 'general', text: 'Nigeria and Niger are countries; spicy raccoons' }); assert.match((await b.c.next('msg')).text, /Nigeria/); await a.c.next('msg');
  assert.equal((await blocked('@aaa1 @bbb1 @ccc1 @ddd1 @eee1 @fff1')).rule, 'mentions');
  // Three blocked messages in ten minutes: muted for ten.
  const third = await blocked('THIS IS ALL CAPITAL LETTERS SHOUTING'); assert.equal(third.rule, 'caps'); assert.match(third.reason, /muted/);
  a.c.send({ t: 'say', room: 'general', text: 'hello' }); assert.match((await a.c.next('error')).error, /muted/);
  b.c.send({ t: 'say', room: 'general', text: 'same' }); await b.c.next('msg'); await a.c.next('msg');
  b.c.send({ t: 'say', room: 'general', text: 'same' }); await b.c.next('msg'); await a.c.next('msg');
  b.c.send({ t: 'say', room: 'general', text: 'same' }); assert.equal((await b.c.next('automod')).rule, 'spam');
  b.c.send({ t: 'nick', name: 'n1gg3r' }); assert.match((await b.c.next('error')).error, /not allowed/);
  const r = await fetch(`http://127.0.0.1:${PORT}/profile`, { method: 'PUT', headers: { ...b.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ bio: 'k y s' }) });
  assert.equal(r.status, 400);
  for (const x of [a.c, b.c]) x.ws.close();
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

test('presence: a hosted game shows on the host, for Join in chat', async () => {
  const a = await account('hst'), b = await account('frn');
  b.c.send({ t: 'presence' });
  a.c.send({ t: 'host', lobby: { name: 'Build night', edition: 'base', map: 'gm_construct', max: 6, players: 1 } });
  const hosting = await a.c.next('hosting');
  let p;
  do p = await b.c.next('presence'); while (p.user !== a.user || !p.game);
  assert.equal(p.game.id, hosting.id); assert.equal(p.game.name, 'Build night'); assert.equal(p.game.max, 6);
  a.c.send({ t: 'unhost' });
  do p = await b.c.next('presence'); while (p.user !== a.user);
  assert.equal(p.game, undefined);
  for (const x of [a.c, b.c]) x.ws.close();
});

test('voice: audio frames go through the hub to the others in the channel', async () => {
  const a = await account('vca'), b = await account('vcb'), c = await account('vcc');
  const bin = (x) => new Promise((r) => { x.ws.binaryType = 'arraybuffer'; const prev = x.ws.onmessage; x.ws.addEventListener('message', function h(e) { if (typeof e.data !== 'string') { x.ws.removeEventListener('message', h); r(new Uint8Array(e.data)); } }); });
  for (const x of [a, b]) { x.c.send({ t: 'vc-join', id: 'lounge' }); await x.c.next('vc-joined'); }
  c.c.send({ t: 'vc-join', id: 'gaming' }); await c.c.next('vc-joined');
  const gotB = bin(b.c);
  let cHeard = false; c.c.ws.addEventListener('message', (e) => { if (typeof e.data !== 'string') cHeard = true; });
  a.c.ws.send(new Uint8Array([1, 0xfc, 0xff, 0xfe]));
  const f = await gotB;
  const n = f[0], from = new TextDecoder().decode(f.subarray(1, 1 + n));
  assert.equal(from, a.welcome.id); assert.deepEqual([...f.subarray(1 + n)], [1, 0xfc, 0xff, 0xfe]);
  // Muted: nothing is passed on. Another channel never hears it. Leaving and sending again does not drop the chat connection.
  a.c.send({ t: 'vc-state', muted: true, deafened: false }); await new Promise((r) => setTimeout(r, 200));
  let bHeard = false; b.c.ws.addEventListener('message', (e) => { if (typeof e.data !== 'string') bHeard = true; });
  a.c.ws.send(new Uint8Array([1, 2, 3])); await new Promise((r) => setTimeout(r, 300));
  assert.equal(bHeard, false); assert.equal(cHeard, false);
  a.c.send({ t: 'vc-leave' }); await a.c.next('vc-left');
  a.c.ws.send(new Uint8Array([1, 2, 3])); a.c.send({ t: 'ping' }); await a.c.next('pong');
  // Switching channels: no vc-left, straight to vc-joined.
  b.c.send({ t: 'vc-join', id: 'music' }); const j = await b.c.next('vc-joined'); assert.equal(j.id, 'music');
  for (const x of [a.c, b.c, c.c]) x.ws.close();
});

test('bans never lock out an admin; banning an admin\'s own browser is refused', async () => {
  const base = `http://127.0.0.1:${PORT}`;
  const reg = await (await fetch(base + '/acct/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'neutro74', pass: 'secret1' }) })).json();
  const auth = { Authorization: `Bearer ${reg.token}`, 'X-User': 'neutro74' };
  const adminDev = '424242', otherDev = '515151';
  const signIn = async (device, withAccount) => {
    const c = client(); await c.open; c.send({ t: 'hello', name: 'P', device }); await c.next('welcome');
    if (withAccount) { c.send({ t: 'auth', user: 'neutro74', token: reg.token }); await c.next('authed'); }
    return c;
  };
  const me = await signIn(adminDev, true);
  const { token } = await (await fetch(base + '/admin/unlock', { method: 'POST', headers: auth })).json();
  const act = (name, body) => fetch(`${base}/admin/${name}`, { method: 'POST', headers: { ...auth, 'X-Admin': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const refused = await act('ban', { target: { device: adminDev }, reason: 'oops' });
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /admin account neutro74/);
  assert.equal((await act('ban', { target: { device: otherDev }, reason: 'bye' })).status, 200);
  const guest = await signIn(otherDev, false);
  assert.ok((await guest.next('banned')));
  const adminOnBannedBrowser = await signIn(otherDev, true);
  adminOnBannedBrowser.send({ t: 'ping' }); assert.ok(await adminOnBannedBrowser.next('pong'));
  for (const x of [me, guest, adminOnBannedBrowser]) x.ws.close();
});
