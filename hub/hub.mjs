#!/usr/bin/env node
// Garry's Mod (browser build) hub: chat rooms, game lobbies and WebRTC signaling over one WebSocket.
// It never carries game traffic: players connect peer to peer (web/p2p.js) and the hub only passes the pairing codes.
// No dependencies (a minimal RFC 6455 server), so it runs on any Node >= 18, e.g. a Raspberry Pi.
//   PORT=8787 HOST=0.0.0.0 TRUST_PROXY=1 ORIGINS=https://cdn.staticdelivr.com node hub/hub.mjs
// TRUST_PROXY=1: take the client address from CF-Connecting-IP / X-Forwarded-For (behind Cloudflare Tunnel or nginx).
// ORIGINS: comma-separated allowed page origins (empty = any).
// Workshop (hub/workshop.mjs): STEAM_KEY (browsing), WS_CACHE (file cache dir), DEPOT_DOWNLOADER (path to the binary).
import http from 'node:http';
import crypto from 'node:crypto';
import { createWorkshop } from './workshop.mjs';
import { createVersions } from './versions.mjs';
import { createAccounts } from './accounts.mjs';

const PORT = +(process.env.PORT ?? 8787), HOST = process.env.HOST ?? '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ORIGINS = (process.env.ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const ROOMS = ['general', 'help', 'looking-for-game', 'off-topic'];
const LIMITS = { clients: 500, perIp: 6, frame: 64 * 1024, text: 400, name: 24, history: 60, lobbies: 100, burst: 6, refillMs: 1500 };

// ---- WebSocket framing ------------------------------------------------------------------------------------------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(op, payload) {
  const n = payload.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (n >= 126 && n < 65536) { head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else if (n >= 65536) { head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}
class Conn {
  constructor(socket, ip) {
    this.socket = socket; this.ip = ip; this.buf = Buffer.alloc(0); this.parts = []; this.closed = false;
    this.id = crypto.randomBytes(6).toString('base64url'); this.name = null; this.rooms = new Set(); this.watching = false;
    this.tokens = LIMITS.burst; this.last = Date.now(); this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.data(d));
    socket.on('close', () => this.gone());
    socket.on('error', () => this.gone());
  }
  data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1], op = b0 & 15, fin = b0 & 0x80;
      if (!(b1 & 0x80)) return this.close(1002);                     // clients must mask
      let len = b1 & 127, at = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > BigInt(LIMITS.frame)) return this.close(1009); len = Number(big); at = 10; }
      if (len > LIMITS.frame) return this.close(1009);
      if (this.buf.length < at + 4 + len) return;
      const mask = this.buf.subarray(at, at + 4), body = Buffer.from(this.buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(at + 4 + len);
      if (op === 8) return this.close(1000);
      if (op === 9) { this.raw(frame(10, body)); continue; }
      if (op === 10) { this.alive = true; continue; }
      if (op === 1 || op === 0) {
        this.parts.push(body);
        if (this.parts.reduce((a, p) => a + p.length, 0) > LIMITS.frame) return this.close(1009);
        if (fin) { const text = Buffer.concat(this.parts).toString('utf8'); this.parts = []; this.message(text); }
      } else if (op === 2) return this.close(1003);
    }
  }
  raw(b) { if (!this.closed) this.socket.write(b); }
  send(obj) { this.raw(frame(1, Buffer.from(JSON.stringify(obj)))); }
  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code); this.raw(frame(8, p));
    this.closed = true; this.socket.end(); setTimeout(() => this.socket.destroy(), 1000); this.gone();
  }
  // Token bucket: a short burst, then about one message per refill interval.
  allow() {
    const now = Date.now();
    this.tokens = Math.min(LIMITS.burst, this.tokens + (now - this.last) / LIMITS.refillMs); this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1; return true;
  }
  message(text) {
    let m;
    try { m = JSON.parse(text); } catch { return this.send({ t: 'error', error: 'Bad message' }); }
    if (!m || typeof m.t !== 'string') return;
    if (m.t !== 'signal' && !this.allow()) return this.send({ t: 'error', error: 'Slow down a little.' });
    try { handle(this, m); } catch (e) { this.send({ t: 'error', error: String(e.message ?? e) }); }
  }
  gone() {
    if (this.gone_) return;
    this.gone_ = true; this.closed = true;
    clients.delete(this);
    for (const r of this.rooms) leaveRoom(this, r);
    for (const [id, l] of lobbies) if (l.host === this) dropLobby(id);
  }
}

// ---- State --------------------------------------------------------------------------------------------------------
const clients = new Set();
const rooms = new Map(ROOMS.map((r) => [r, { members: new Set(), history: [] }]));
const lobbies = new Map();   // id -> { host: Conn, info }
const byId = (id) => { for (const c of clients) if (c.id === id) return c; return null; };
const user = (c) => ({ id: c.id, name: c.name });
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').trim().slice(0, max);

function roomList() { return ROOMS.map((name) => ({ name, users: rooms.get(name).members.size })); }
function toRoom(name, obj, except) { for (const c of rooms.get(name).members) if (c !== except) c.send(obj); }
function leaveRoom(c, name) {
  const r = rooms.get(name);
  if (!r?.members.delete(c)) return;
  c.rooms.delete(name);
  toRoom(name, { t: 'left', room: name, user: user(c) });
}
function lobbyView(id, l) { return { id, host: l.host.id, hostName: l.host.name, ...l.info }; }
function lobbyList() { return [...lobbies].map(([id, l]) => lobbyView(id, l)); }
function pushLobbies() { const list = lobbyList(); for (const c of clients) if (c.watching) c.send({ t: 'lobbies', lobbies: list }); }
function dropLobby(id) { if (lobbies.delete(id)) pushLobbies(); }

function handle(c, m) {
  if (m.t === 'hello') {
    const name = clean(m.name, LIMITS.name);
    if (name.length < 2) throw Error('Pick a name of at least 2 characters.');
    c.name = name;
    return c.send({ t: 'welcome', id: c.id, name, rooms: roomList(), online: clients.size });
  }
  if (!c.name) throw Error('Say hello first.');
  switch (m.t) {
    case 'rooms': return c.send({ t: 'rooms', rooms: roomList(), online: clients.size });
    case 'join': {
      const r = rooms.get(m.room);
      if (!r) throw Error('No such room.');
      if (!r.members.has(c)) { r.members.add(c); c.rooms.add(m.room); toRoom(m.room, { t: 'joined', room: m.room, user: user(c) }, c); }
      return c.send({ t: 'room', room: m.room, users: [...r.members].map(user), history: r.history });
    }
    case 'leave': return leaveRoom(c, m.room);
    case 'say': {
      const r = rooms.get(m.room), text = clean(m.text, LIMITS.text);
      if (!r?.members.has(c)) throw Error('Join the room first.');
      if (!text) return;
      const msg = { t: 'msg', room: m.room, from: user(c), text, at: Date.now() };
      r.history.push(msg); if (r.history.length > LIMITS.history) r.history.shift();
      return toRoom(m.room, msg);
    }
    case 'nick': {
      const name = clean(m.name, LIMITS.name);
      if (name.length < 2) throw Error('Pick a name of at least 2 characters.');
      const old = c.name; c.name = name;
      for (const r of c.rooms) toRoom(r, { t: 'nick', room: r, user: user(c), old });
      return c.send({ t: 'welcome', id: c.id, name, rooms: roomList(), online: clients.size });
    }
    // Lobbies: a host advertises a game; joiners ask to join and the two clients exchange pairing codes via 'signal'.
    case 'watch-lobbies': c.watching = m.on !== false; return c.send({ t: 'lobbies', lobbies: lobbyList() });
    case 'host': {
      const i = m.lobby ?? {};
      const info = { name: clean(i.name, 48) || `${c.name}'s game`, edition: i.edition === 'extended' ? 'extended' : 'base', map: clean(i.map, 48),
        gamemode: clean(i.gamemode, 32), players: Math.max(0, Math.min(64, i.players | 0)), max: Math.max(2, Math.min(64, i.max | 0 || 8)), locked: !!i.locked };
      let id = [...lobbies].find(([, l]) => l.host === c)?.[0];
      if (!id) { if (lobbies.size >= LIMITS.lobbies) throw Error('Too many open games right now.'); id = crypto.randomBytes(5).toString('base64url'); }
      lobbies.set(id, { host: c, info });
      pushLobbies();
      return c.send({ t: 'hosting', id, lobby: lobbyView(id, lobbies.get(id)) });
    }
    case 'unhost': for (const [id, l] of lobbies) if (l.host === c) dropLobby(id); return c.send({ t: 'hosting', id: null });
    case 'signal': {
      // Relayed verbatim between two connected clients; the payload is opaque to the hub (pairing codes, join requests).
      const to = byId(String(m.to));
      if (!to) throw Error('That player is no longer online.');
      if (JSON.stringify(m.data ?? null).length > 48 * 1024) throw Error('Signal too large.');
      return to.send({ t: 'signal', from: user(c), data: m.data ?? null });
    }
    case 'ping': return c.send({ t: 'pong' });
    default: throw Error(`Unknown request ${m.t}`);
  }
}

// ---- HTTP + upgrade -----------------------------------------------------------------------------------------------
const clientIp = (req) => (TRUST_PROXY && (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim())) || req.socket.remoteAddress;
const originOk = (o) => !ORIGINS.length || ORIGINS.includes(o);
const cors = (req) => ({ 'Access-Control-Allow-Origin': originOk(req.headers.origin) && req.headers.origin ? req.headers.origin : ORIGINS[0] ?? '*', Vary: 'Origin' });
const workshop = createWorkshop(), versions = createVersions(), accounts = createAccounts();
const server = http.createServer(async (req, res) => {
  if (await workshop(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await versions(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await accounts(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (req.url === '/health' || req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) });
    return res.end(JSON.stringify({ ok: true, online: clients.size, rooms: roomList(), lobbies: lobbies.size }));
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Garry\'s Mod browser hub. Connect with a WebSocket.\n');
});
server.on('upgrade', (req, socket) => {
  const reject = (code, why) => { socket.end(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`); };
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return reject(400, 'Bad Request');
  if (!originOk(req.headers.origin)) return reject(403, 'Forbidden');
  const ip = clientIp(req);
  if (clients.size >= LIMITS.clients) return reject(503, 'Busy');
  if ([...clients].filter((c) => c.ip === ip).length >= LIMITS.perIp) return reject(429, 'Too Many Connections');
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(new Conn(socket, ip));
});
// Keepalive: drop connections that stop answering pings (sleeping laptops, dead tunnels).
setInterval(() => {
  for (const c of clients) { if (!c.alive) { c.close(1001); continue; } c.alive = false; c.raw(frame(9, Buffer.alloc(0))); }
}, 30000).unref();
server.listen(PORT, HOST, () => console.log(`hub listening on ${HOST}:${PORT}`));
export { server };
