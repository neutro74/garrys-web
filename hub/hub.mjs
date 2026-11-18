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
import { createServers } from './servers.mjs';
import { createSteamLogin } from './steam-login.mjs';
import { createChatStore } from './chat-store.mjs';
import { createAdmin } from './admin.mjs';
import { createProfiles } from './profiles.mjs';
import { createCloud } from './cloud.mjs';
import { createShares } from './shares.mjs';
import { createSocial } from './social.mjs';
import { createEmotes } from './emotes.mjs';
import { createVoice } from './voice.mjs';
import { createAutomod } from './automod.mjs';
import { createProxy } from './proxy.mjs';
import { json, fail, bytes, imageType, blobStore, limiter } from './http-util.mjs';
import path from 'node:path';

const PORT = +(process.env.PORT ?? 8787), HOST = process.env.HOST ?? '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ORIGINS = (process.env.ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// Text channels, grouped like a Discord server's. Read-only ones take posts from admins only.
const CHANNELS = [
  { id: 'announcements', name: 'announcements', category: 'Garry\'s Web', topic: 'News about Garry\'s Web.', readonly: true },
  { id: 'general', name: 'general', category: 'Garry\'s Web', topic: 'Talk about anything Garry\'s Mod.' },
  { id: 'help', name: 'help', category: 'Garry\'s Web', topic: 'Problems starting or playing? Ask here.' },
  { id: 'looking-for-game', name: 'looking-for-game', category: 'Play', topic: 'Find people to play with.' },
  { id: 'showcase', name: 'showcase', category: 'Play', topic: 'Show your builds, saves and screenshots.' },
  { id: 'off-topic', name: 'off-topic', category: 'Other', topic: 'Anything else.' },
];
const ROOMS = CHANNELS.map((c) => c.id);
const MUTED = new Set(['say', 'dm', 'nick', 'host', 'edit', 'react', 'typing']);
const LIMITED = new Set(['find-users', 'say', 'dm', 'nick', 'hello', 'host', 'room-history', 'dm-history', 'edit', 'delete', 'react', 'friend-add', 'profile-of', 'vc-join', 'vc-edit', 'vc-allow', 'vc-kick']);
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3)(?:[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic}|\p{Emoji_Presentation})*$/u;
const IMG = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/;
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
    this.tokens = LIMITS.burst; this.last = Date.now(); this.alive = true; this.since = Date.now();
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
      } else if (op === 2) {
        if (!this.onBinary || !fin) return this.close(1003);
        this.onBinary(body);
      }
    }
  }
  raw(b) { if (!this.closed) this.socket.write(b); }
  send(obj) { this.raw(frame(1, Buffer.from(JSON.stringify(obj)))); }
  sendBinary(b) { if (!this.closed && this.socket.writableLength < 4 << 20) this.socket.write(frame(2, b)); }
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
    if (this.onText) return this.onText(text);   // the admin terminal
    if (this.relay) return;
    let m;
    try { m = JSON.parse(text); } catch { return this.send({ t: 'error', error: 'Bad message' }); }
    if (!m || typeof m.t !== 'string') return;
    // The spam limit is for what people type (and history reads, which touch the disk); joining rooms, signing in and other
    // setup a page sends on connecting are not counted.
    if (LIMITED.has(m.t) && !this.allow()) return this.send({ t: 'error', error: 'Slow down a little.' });
    try { handle(this, m); } catch (e) { this.send({ t: 'error', error: String(e.message ?? e) }); }
  }
  gone() {
    if (this.gone_) return;
    this.gone_ = true; this.closed = true;
    if (this.relay) { relays.delete(this); this.onClose?.(); return; }
    clients.delete(this);
    if (this.name) admin.seen(this);
    for (const r of this.rooms) leaveRoom(this, r);
    voice.leave(this);
    for (const [id, l] of lobbies) if (l.host === this) dropLobby(id);
    if (this.account) presenceChanged(this.account);
  }
}

// ---- State --------------------------------------------------------------------------------------------------------
const clients = new Set();
const rooms = new Map(ROOMS.map((r) => [r, { members: new Set(), history: [] }]));
const lobbies = new Map();   // id -> { host: Conn, info }
const relays = new Set();    // /udp connections (hub/servers.mjs) and /pair connections
// Paired relay (/pair?t=token): when two players' browsers cannot reach each other directly (no route through their
// routers), both connect here with the token the host put in its invite and the hub passes their game traffic between
// them. Two connections per token; each capped at 1 MB/s; one waiting alone for a partner is dropped after a minute.
const pairs = new Map();     // token -> [Conn, Conn?]
function pairUp(c, token) {
  const list = pairs.get(token) ?? [];
  if (list.length >= 2) return c.close(1008);
  list.push(c); pairs.set(token, list);
  let budget = 1 << 20, last = Date.now();
  c.onBinary = (b) => {
    const now = Date.now(); budget = Math.min(1 << 20, budget + (now - last) * 1048.576); last = now;
    if (budget < b.length) return;
    budget -= b.length;
    const other = pairs.get(token)?.find((x) => x !== c);
    if (other) other.sendBinary(b);
  };
  c.onClose = () => { const l = pairs.get(token); if (!l) return; pairs.delete(token); for (const x of l) if (x !== c) x.close(1000); };
  if (list.length === 2) for (const x of list) x.sendBinary(Buffer.from([0, 0x7b, 0x7d]));   // "{}" text: both ends know the pair is up
  else setTimeout(() => { if (pairs.get(token)?.length === 1) c.close(1000); }, 60e3);
}
const byId = (id) => { for (const c of clients) if (c.id === id) return c; return null; };
// Who wrote a message, as other players see it. `key` identifies the author for edits and deletions: the account, or a hash of
// the browser id for players without one (the browser id itself is a moderation detail and is not shown).
const ownerKey = (c) => (c.account ? 'a:' + c.account : 'g:' + crypto.createHash('sha256').update('gw:' + (c.device ?? c.id)).digest('hex').slice(0, 12));
const user = (c) => ({ id: c.id, name: c.name, key: ownerKey(c), ...(c.account ? { account: c.account } : {}) });
const chat = createChatStore();
const keep = (fn) => { try { fn(); } catch (e) { console.log(`chat: not saved: ${e.message}`); } };
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮]/g, '').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
const channel = (id) => CHANNELS.find((c) => c.id === id);

function roomList() { return CHANNELS.map((ch) => ({ ...ch, name: ch.id, label: ch.name, users: rooms.get(ch.id).members.size })); }
function toRoom(name, obj, except) { for (const c of rooms.get(name).members) if (c !== except) c.send(obj); }
const toAccount = (u, obj) => { for (const c of clients) if (c.account === u) c.send(obj); };
function leaveRoom(c, name) {
  const r = rooms.get(name);
  if (!r?.members.delete(c)) return;
  c.rooms.delete(name);
  toRoom(name, { t: 'left', room: name, user: user(c) });
}
function lobbyView(id, l) { return { id, host: l.host.id, hostName: l.host.name, ...l.info }; }
// A game marked LAN ("Local Server" in Start New Game) is shown only to players behind the same public address.
function lobbyList(viewer) { return [...lobbies].filter(([, l]) => !l.info.lan || l.host.ip === viewer?.ip).map(([id, l]) => lobbyView(id, l)); }
function pushLobbies() { for (const c of clients) if (c.watching) c.send({ t: 'lobbies', lobbies: lobbyList(c) }); }
function dropLobby(id) { if (lobbies.delete(id)) pushLobbies(); }

// ---- Presence ---------------------------------------------------------------------------------------------------
// An account is online while any of its pages is connected; its status is the one chosen in its profile (invisible counts as
// offline to everyone else), and its activity is what its most recently active page reports (in the launcher, in a game...).
function presenceOf(u) {
  const conns = [...clients].filter((c) => c.account === u && c.name);
  if (!conns.length) return { user: u, status: 'offline', activity: null };
  const status = profiles.status(u), act = conns.map((c) => c.activity).filter(Boolean).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;
  return { user: u, status: status === 'invisible' ? 'offline' : status, activity: status === 'invisible' ? null : act };
}
const lastPresence = new Map();
function presenceChanged(u) {
  if (!u) return;
  const p = presenceOf(u), key = JSON.stringify(p);
  if (lastPresence.get(u) === key) return;
  if (p.status === 'offline') lastPresence.delete(u); else lastPresence.set(u, key);
  for (const c of clients) if (c.name) c.send({ t: 'presence', ...p });
  // The player's own pages are told their real status (invisible included).
  toAccount(u, { t: 'my-status', status: profiles.status(u) });
}
const onlineAccounts = () => [...new Set([...clients].filter((c) => c.account && c.name).map((c) => c.account))].map(presenceOf).filter((p) => p.status !== 'offline');
const cleanActivity = (a) => (a && typeof a === 'object' ? { kind: ['launcher', 'menu', 'game', 'server'].includes(a.kind) ? a.kind : 'launcher', detail: clean(a.detail, 80), edition: clean(a.edition, 24), map: clean(a.map, 48), at: Date.now() } : null);

// ---- Messages ---------------------------------------------------------------------------------------------------
function attachments(list) {
  if (!Array.isArray(list)) return undefined;
  const out = list.slice(0, 4).filter((a) => IMG.test(a?.name ?? '')).map((a) => ({ name: a.name, w: Math.max(0, Math.min(8192, a.w | 0)), h: Math.max(0, Math.min(8192, a.h | 0)) }));
  return out.length ? out : undefined;
}
// A reply carries a short copy of the message it answers, so it shows even when that message is far back in the history.
// `account` is who wrote it; `ping` (on unless the writer turned it off) tells them about the answer.
function replyTo(found, ping = true) {
  if (!found) return undefined;
  const acct = typeof found.from === 'string' ? found.from : found.from?.account;
  return { id: found.id, name: found.from?.name ?? found.name ?? found.from, text: String(found.text ?? '').slice(0, 120), ...(acct ? { account: acct, ping: ping !== false } : {}) };
}
// Pings: an @account in a channel message, an answer to someone's message, and (admins only) @everyone or @here. Each one
// goes to that player's open pages straight away and is kept (chat-store pings), so it is still there after they were away.
// Blocked players never ping. At most 20 people are pinged by name in one message (automod usually stops it at fewer).
function pings(c, msg) {
  const who = new Map();
  for (const [, u] of String(msg.text).matchAll(/@([a-z0-9_]{3,20})\b/gi)) {
    const a = u.toLowerCase();
    if (a === 'everyone' || a === 'here' || a === c.account || who.has(a) || who.size >= 20 || !accounts.exists(a)) continue;
    who.set(a, 'mention');
  }
  if (msg.reply?.ping && msg.reply.account && msg.reply.account !== c.account && !who.has(msg.reply.account)) who.set(msg.reply.account, 'reply');
  const base = { id: msg.id, room: msg.room, from: user(c), text: String(msg.text).slice(0, 200), at: msg.at };
  for (const [a, kind] of who) {
    if (social.blocks(a, c.account ?? '')) continue;
    const p = { ...base, kind }; keep(() => chat.savePing(a, p)); toAccount(a, { t: 'ping', ...p });
  }
  if (msg.everyone) {
    const p = { ...base, kind: msg.everyone };
    if (msg.everyone === 'everyone') keep(() => chat.saveEveryone(p));
    const to = msg.everyone === 'here' ? [...(rooms.get(msg.room)?.members ?? [])] : [...clients];
    for (const x of to) if (x.account && x.account !== c.account && !who.has(x.account)) x.send({ t: 'ping', ...p });
  }
}
// Where a message lives: a channel ({room}) or a private chat ({with}); `own` checks who may change it.
function locate(c, m) {
  if (m.room !== undefined) {
    if (!rooms.has(m.room)) throw Error('No such channel.');
    return { find: (id) => chat.findRoom(m.room, id), mark: (x) => chat.markRoom(m.room, x), send: (obj) => toRoom(m.room, { ...obj, room: m.room }), where: { room: m.room } };
  }
  if (!c.account) throw Error('Sign in first.');
  const other = String(m.with ?? '').toLowerCase();
  if (!accounts.exists(other)) throw Error('No such account.');
  return { find: (id) => chat.findDm(c.account, other, id), mark: (x) => chat.markDm(c.account, other, x), send: (obj) => { toAccount(c.account, { ...obj, with: other }); toAccount(other, { ...obj, with: c.account }); }, where: { with: other } };
}
const isAdmin = (c) => !!c.account && admin.isAdmin(c.account);
// Automod (hub/automod.mjs) said no: only the writer hears why, with what they wrote so the page can give it back.
function blockedByAutomod(c, text, opts, m) {
  const hit = automod.check(c, text, opts);
  if (!hit) return false;
  c.send({ t: 'automod', rule: hit.rule, reason: hit.reason, text, ...(m.room !== undefined ? { room: m.room } : {}), ...(m.to ? { with: m.to } : m.with ? { with: m.with } : {}) });
  return true;
}
const ownMsg = (c, msg) => msg && (msg.from?.key ? msg.from.key === ownerKey(c) : msg.from === c.account);

function friendsView(u) {
  const s = social.get(u);
  return { t: 'friends', friends: s.friends.map(presenceOf), incoming: s.incoming, outgoing: s.outgoing, blocked: s.blocked };
}

function handle(c, m) {
  if (m.t === 'hello') {
    let name = clean(m.name, LIMITS.name);
    if (name.length < 2 || automod.test(name, 'name')) name = 'Player' + crypto.randomBytes(2).toString('hex');   // a name automod refuses is replaced
    c.name = name; c.device = /^\d{1,12}$/.test(String(m.device ?? '')) ? String(m.device) : null;
    c.activity = cleanActivity(m.activity);
    admin.seen(c);
    if (refuseBanned(c)) return;
    c.send({ t: 'welcome', id: c.id, name, key: ownerKey(c), rooms: roomList(), online: clients.size, presence: onlineAccounts() });
    return voice.sendList(c);
  }
  if (MUTED.has(m.t)) { const mu = admin.muted(c); if (mu) throw Error(`You are muted${mu.until ? ' until ' + new Date(mu.until).toUTCString() : ''}${mu.reason ? ': ' + mu.reason : ''}.`); }
  if (!c.name) throw Error('Say hello first.');
  switch (m.t) {
    case 'rooms': return c.send({ t: 'rooms', rooms: roomList(), online: clients.size });
    case 'join': {
      const r = rooms.get(m.room);
      if (!r) throw Error('No such room.');
      if (!c.account) return c.send({ t: 'room', room: m.room, users: [], history: [], locked: true });   // chat is for accounts only
      if (!r.members.has(c)) { r.members.add(c); c.rooms.add(m.room); toRoom(m.room, { t: 'joined', room: m.room, user: user(c) }, c); }
      let history = r.history;
      try { history = chat.room(m.room, 100).messages; } catch { /* the in-memory copy */ }
      return c.send({ t: 'room', room: m.room, users: [...r.members].map(user), history });
    }
    case 'leave': return leaveRoom(c, m.room);
    case 'say': {
      const r = rooms.get(m.room), text = clean(m.text, LIMITS.text), attach = attachments(m.attach), sticker = emotes.sticker(m.sticker);
      if (!c.account) throw Error('Sign in to a Garry\'s Web account to chat.');
      if (!r?.members.has(c)) throw Error('Join the room first.');
      if (channel(m.room)?.readonly && !isAdmin(c)) throw Error('Only admins post in this channel.');
      if (!text && !attach && !sticker) return;
      if (blockedByAutomod(c, text, { where: 'channel', room: m.room }, m)) return;
      const reply = m.reply ? replyTo(chat.findRoom(m.room, String(m.reply)), m.replyPing) : undefined;
      const everyone = isAdmin(c) ? /(?<![\w`])@everyone\b/.test(text) ? 'everyone' : /(?<![\w`])@here\b/.test(text) ? 'here' : null : null;
      const msg = { t: 'msg', id: crypto.randomBytes(6).toString('base64url'), room: m.room, from: user(c), text, at: Date.now(), ...(reply ? { reply } : {}), ...(attach ? { attach } : {}), ...(sticker ? { sticker } : {}), ...(everyone ? { everyone } : {}) };
      r.history.push(msg); if (r.history.length > LIMITS.history) r.history.shift();
      keep(() => chat.saveRoom(m.room, msg));
      toRoom(m.room, msg);
      return pings(c, msg);
    }
    case 'edit': {
      const at = locate(c, m), id = String(m.id ?? ''), text = clean(m.text, LIMITS.text), msg = at.find(id);
      if (!ownMsg(c, msg)) throw Error('You can only edit your own messages.');
      if (!text) throw Error('A message cannot be empty; delete it instead.');
      if (blockedByAutomod(c, text, { where: 'edit', room: m.room ?? null }, m)) return;
      at.mark({ edit: id, text }); at.send({ t: 'edited', id, text, edited: Date.now() });
      if (m.room !== undefined) { const h = rooms.get(m.room).history.find((x) => x.id === id); if (h) { h.text = text; h.edited = Date.now(); } }
      return;
    }
    case 'delete': {
      const at = locate(c, m), id = String(m.id ?? ''), msg = at.find(id);
      if (!msg) return;
      if (!ownMsg(c, msg) && !(m.room !== undefined && isAdmin(c))) throw Error('You can only delete your own messages.');
      at.mark({ del: id }); at.send({ t: 'msg-deleted', id });
      if (m.room !== undefined) rooms.get(m.room).history = rooms.get(m.room).history.filter((x) => x.id !== id);
      return;
    }
    case 'react': {
      const at = locate(c, m), id = String(m.id ?? ''), emoji = String(m.emoji ?? '');
      if (!c.account) throw Error('Sign in to a Garry\'s Web account to chat.');
      if (!EMOJI.test(emoji) || emoji.length > 16) throw Error('That is not an emoji.');
      if (!at.find(id)) throw Error('That message is gone.');
      const by = c.account ?? c.name, on = m.on !== false;
      at.mark({ react: id, emoji, by, on }); at.send({ t: 'reacted', id, emoji, by, on });
      return;
    }
    case 'typing': {
      if (!c.account) return;
      if (m.room !== undefined) { if (rooms.get(m.room)?.members.has(c)) toRoom(m.room, { t: 'typing', room: m.room, user: user(c) }, c); return; }
      if (!c.account) return;
      const other = String(m.with ?? '').toLowerCase();
      if (social.blocks(other, c.account) || !accounts.exists(other)) return;
      return toAccount(other, { t: 'typing', with: c.account, user: user(c) });
    }
    case 'nick': {
      const name = clean(m.name, LIMITS.name);
      if (name.length < 2) throw Error('Pick a name of at least 2 characters.');
      automod.assert(c, name, 'name');
      const old = c.name; c.name = name;
      for (const r of c.rooms) toRoom(r, { t: 'nick', room: r, user: user(c), old });
      c.send({ t: 'welcome', id: c.id, name, key: ownerKey(c), rooms: roomList(), online: clients.size, presence: onlineAccounts() });
      return voice.sendList(c);
    }
    // Older messages of a room, before a time (the client scrolls back).
    case 'room-history': {
      if (!rooms.has(m.room)) throw Error('No such room.');
      return c.send({ t: 'room-history', room: m.room, ...chat.room(m.room, 100, +m.before || Infinity) });
    }
    // Private messages: between Garry's Web accounts (a name alone is not unique). The socket signs in with the account's
    // session token; messages are kept, and delivered to every connection of both players.
    case 'auth': {
      const before = c.account, u = accounts.verify(m.user, m.token);
      c.account = u ?? null;
      admin.seen(c);
      if (refuseBanned(c)) return;
      c.send({ t: 'authed', user: u ?? null, admin: !!u && admin.isAdmin(u), ...(u ? { status: profiles.status(u) } : {}) });
      if (before !== c.account) {
        presenceChanged(before); presenceChanged(c.account);
        if (!u) for (const r of [...c.rooms]) leaveRoom(c, r);   // signed out: chat is for accounts only
      }
      if (u) { c.send(friendsView(u)); c.send({ t: 'pings', list: chat.pings(u, 50), seen: chat.pingsSeen(u) }); }
      return;
    }
    case 'dm': {
      if (!c.account) throw Error('Sign in to a Garry\'s Web account (Profile) to send private messages.');
      const to = String(m.to ?? '').toLowerCase(), text = clean(m.text, LIMITS.text), attach = attachments(m.attach), sticker = emotes.sticker(m.sticker);
      if (to === c.account) throw Error('That is you.');
      if (!accounts.exists(to)) throw Error(`There is no account called ${to}.`);
      if (social.blocks(to, c.account)) throw Error(`${to} is not accepting your messages.`);
      if (social.blocks(c.account, to)) throw Error(`You blocked ${to}. Unblock them to send messages.`);
      if (!text && !attach && !sticker) return;
      if (blockedByAutomod(c, text, { where: 'dm' }, m)) return;
      const reply = m.reply ? replyTo(chat.findDm(c.account, to, String(m.reply))) : undefined;
      const msg = { t: 'dm', id: crypto.randomBytes(6).toString('base64url'), from: c.account, name: c.name, to, text, at: Date.now(), ...(reply ? { reply } : {}), ...(attach ? { attach } : {}), ...(sticker ? { sticker } : {}) };
      chat.saveDm(c.account, to, msg);
      for (const x of clients) if (x.account === to || x.account === c.account) x.send(msg);
      return;
    }
    case 'dms': {
      if (!c.account) return c.send({ t: 'dms', list: [] });
      return c.send({ t: 'dms', list: chat.conversations(c.account).filter((x) => !social.blocks(c.account, x.with)).map((x) => ({ ...x, online: presenceOf(x.with).status !== 'offline' })) });
    }
    case 'dm-history': {
      if (!c.account) throw Error('Sign in first.');
      const other = String(m.with ?? '').toLowerCase();
      return c.send({ t: 'dm-history', with: other, ...chat.dm(c.account, other, 100, +m.before || Infinity) });
    }
    // Friends (hub/social.mjs). Both players' pages get the new list.
    case 'friends': if (!c.account) return c.send({ t: 'friends', friends: [], incoming: [], outgoing: [], blocked: [] }); return c.send(friendsView(c.account));
    case 'friend-add': case 'friend-accept': case 'friend-remove': case 'block': case 'unblock': {
      if (!c.account) throw Error('Sign in to a Garry\'s Web account to add friends.');
      const other = String(m.user ?? '').toLowerCase().replace(/^@/, '');
      if (!accounts.exists(other)) throw Error(`There is no account called ${other}.`);
      const what = m.t === 'friend-add' ? social.request(c.account, other) : m.t === 'friend-accept' ? social.accept(c.account, other)
        : m.t === 'friend-remove' ? social.remove(c.account, other) : m.t === 'block' ? social.block(c.account, other) : social.unblock(c.account, other);
      toAccount(c.account, friendsView(c.account)); toAccount(other, friendsView(other));
      if (what === 'sent') toAccount(other, { t: 'friend-request', from: c.account, name: c.name, at: Date.now() });
      if (what === 'accepted') toAccount(other, { t: 'friend-accepted', user: c.account, at: Date.now() });
      return;
    }
    // What the player is doing (the launcher, a menu, a map), shown to friends and in member lists.
    case 'activity': c.activity = cleanActivity(m.activity); return presenceChanged(c.account);
    case 'status': {
      if (!c.account) throw Error('Sign in to set a status.');
      profiles.setStatus(c.account, String(m.status)); lastPresence.delete(c.account); return presenceChanged(c.account);
    }
    case 'presence': return c.send({ t: 'presence-list', users: onlineAccounts() });
    case 'watch-lobbies': c.watching = m.on !== false; return c.send({ t: 'lobbies', lobbies: lobbyList(c) });
    case 'host': {
      const i = m.lobby ?? {};
      const info = { name: clean(i.name, 48) || `${c.name}'s game`, edition: i.edition === 'extended' ? 'extended' : 'base', map: clean(i.map, 48),
        gamemode: clean(i.gamemode, 32), lan: !!i.lan, players: Math.max(0, Math.min(64, i.players | 0)), max: Math.max(2, Math.min(64, i.max | 0 || 8)), locked: !!i.locked };
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
    // The player has looked at their pings up to this time.
    case 'pings-seen': if (c.account) { chat.setPingsSeen(c.account, m.at); toAccount(c.account, { t: 'pings-seen', at: chat.pingsSeen(c.account) }); } return;
    // Accounts whose name starts with this (for @ suggestions while typing).
    case 'find-users': {
      if (!c.account) return;
      const q = String(m.q ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
      return c.send({ t: 'found-users', q, users: q ? accounts.find(q, 8) : [] });
    }
    default:
      if (voice.handle(c, m)) return;
      throw Error(`Unknown request ${m.t}`);
  }
}

// ---- HTTP + upgrade -----------------------------------------------------------------------------------------------
const clientIp = (req) => (TRUST_PROXY && (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim())) || req.socket.remoteAddress;
const originOk = (o) => !ORIGINS.length || ORIGINS.includes(o);
const cors = (req) => ({ 'Access-Control-Allow-Origin': originOk(req.headers.origin) && req.headers.origin ? req.headers.origin : ORIGINS[0] ?? '*', Vary: 'Origin' });
// The Steam libraries (steam-session/steam-user and their websocket13 transport) can throw from their own socket callbacks
// (seen: "Cannot read properties of null (reading 'setTimeout')" in WebSocketCMTransport), which would take down chat and
// lobbies with them. Log those and carry on; anything else still crashes the hub so systemd restarts it.
process.on('uncaughtException', (err) => {
  if (/[\\/]node_modules[\\/](steam-|websocket13)/.test(String(err?.stack))) { console.error('steam library error (ignored):', err); return; }
  console.error(err); process.exit(1);
});
const workshop = createWorkshop(), versions = createVersions(), accounts = createAccounts(), servers = createServers({ log: console.log }), steamLogin = createSteamLogin({ log: console.log });
// Profiles, friends, cloud files and shared saves (Garry's Web accounts). A profile change is announced so open chats redraw it.
const profiles = createProfiles({ accounts, check: (u, text) => automod.assert({ account: u }, text, 'profile'), onChange: (u) => { for (const c of clients) if (c.name) c.send({ t: 'profile', user: u }); lastPresence.delete(u); presenceChanged(u); } });
const social = createSocial(), cloud = createCloud({ accounts });
// Pictures posted in chat: signed-in players only, resized by the page first; kept once per content hash.
const chatImages = blobStore(path.join(process.env.WS_CACHE ?? './ws-cache', 'chat', 'img')), chatUploads = limiter(30, 600e3);
async function chatUpload(req, res, h, ip) {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/chat/')) return false;
  const hh = { ...h, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User', 'Access-Control-Allow-Methods': 'GET, POST' };
  if (req.method === 'OPTIONS') { res.writeHead(204, hh).end(); return true; }
  try {
    if (req.method === 'GET' && url.pathname.startsWith('/chat/img/')) { chatImages.serve(res, url.pathname.slice(10), hh); return true; }
    if (req.method === 'POST' && url.pathname === '/chat/upload') {
      const u = accounts.userOf(req);
      if (!u) throw fail(401, 'Sign in to post pictures.');
      if (!chatUploads(u) || !chatUploads('ip:' + ip)) throw fail(429, 'Too many pictures. Wait a few minutes.');
      if (admin.muted({ ip, account: u })) throw fail(403, 'You are muted.');
      const b = await bytes(req, 4 * 1048576), t = imageType(b);
      if (!t) throw fail(415, 'Pictures must be PNG, JPEG, WebP or GIF.');
      return json(res, 200, { name: chatImages.put(b, t.ext) }, hh), true;
    }
    throw fail(404, 'Not found');
  } catch (e) { json(res, e.status ?? 400, { error: String(e.message ?? e) }, hh); }
  return true;
}
// ---- Admin (hub/admin.mjs) --------------------------------------------------------------------------------------------
const admin = createAdmin({ accounts, automod: () => automod, hub: {
  counts: () => ({ clients: clients.size, relays: relays.size, pairs: pairs.size, lobbyCount: lobbies.size }),
  clients: () => [...clients].filter((c) => c.name),
  lobbies: () => [...lobbies].map(([id, l]) => ({ ...lobbyView(id, l), hostIp: l.host.ip, hostDevice: l.host.device ?? null, hostAccount: l.host.account ?? null })),
  roomNames: () => ROOMS.map((name) => { let messages = []; try { messages = chat.room(name, 60).messages; } catch { /* none */ } return { name, users: rooms.get(name).members.size, messages }; }),
  kickWhere(pred, msg) {
    let n = 0;
    for (const c of [...clients, ...relays]) if (pred({ id: c.id, ip: c.ip, device: c.device, account: c.account }) && !c.onText) { if (!c.relay) c.send(msg); c.close(4000); n++; }
    return n;
  },
  deleteMessage(room, id) {
    const r = rooms.get(room); if (!r) throw Error('No such room.');
    chat.deleteRoomMessage(room, id); r.history = r.history.filter((x) => x.id !== id); toRoom(room, { t: 'msg-deleted', room, id });
  },
  clearRoom(room) { const r = rooms.get(room); if (!r) throw Error('No such room.'); chat.clearRoom(room); r.history = []; toRoom(room, { t: 'room-cleared', room }); },
  announce(text) { for (const c of clients) if (c.name) c.send({ t: 'notice', text, at: Date.now() }); return clients.size; },
  closeLobby(id) { const l = lobbies.get(id); if (!l) throw Error('That game is already closed.'); l.host.send({ t: 'lobby-closed', id }); dropLobby(id); },
} });
// Automod: admins are not checked; repeat offenders are muted through the admin panel's mutes (so admins see and lift them).
const automod = createAutomod({ isAdmin: (c) => !!c.account && admin.isAdmin(c.account), accountAge: (u) => Date.now() - (accounts.created(u) || 0),
  mute: (target, minutes, reason) => admin.autoMute(target, minutes, reason) });
// The web proxy for the launcher's Browser tab and a CORS proxy (hub/proxy.mjs): signed-in accounts only.
const proxy = createProxy({ accounts, log: console.log, banned: (p) => admin.banned(p) });
const shares = createShares({ accounts, isAdmin: (u) => admin.isAdmin(u) });
// Custom emojis and stickers (admins add them) and GIF links copied into the chat picture store (hub/emotes.mjs).
const emotes = createEmotes({ accounts, isAdmin: (u) => admin.isAdmin(u), chatImages, muted: (who) => admin.muted(who), log: console.log,
  onChange: () => { for (const c of clients) if (c.name) c.send({ t: 'emotes' }); } });
// Voice channels and "Join to create" ones (hub/voice.mjs); audio goes browser to browser.
const voice = createVoice({ clients: () => clients, isAdmin: (u) => !!u && admin.isAdmin(u), log: console.log });
// A banned player's socket is told why, then closed (the page stops reconnecting).
function refuseBanned(c) {
  const b = admin.banned({ ip: c.ip, device: c.device, account: c.account });
  if (!b) return false;
  c.send({ t: 'banned', ...admin.banInfo(b) }); c.close(4003); return true;
}
const server = http.createServer(async (req, res) => {
  if (await admin(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  const ban = admin.banned({ ip: clientIp(req) });
  if (ban && req.method !== 'OPTIONS' && req.url !== '/health') {
    res.writeHead(403, { 'Content-Type': 'application/json', ...cors(req) });
    return res.end(JSON.stringify({ error: 'You are banned from Garry\'s Web.', banned: true, ...admin.banInfo(ban) }));
  }
  if (await proxy(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await workshop(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await versions(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await accounts(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await servers.handle(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await steamLogin(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await profiles(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await cloud(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await shares(req, res, { ip: clientIp(req), headers: cors(req) })) return;
  if (await emotes.handle(req, res, cors(req), clientIp(req))) return;
  if (await chatUpload(req, res, cors(req), clientIp(req))) return;
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
  const ip = clientIp(req), ipBan = admin.banned({ ip });
  if (req.url.startsWith('/admin/term')) {
    if (relays.size >= 300) return reject(429, 'Too Many Connections');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`);
    const c = new Conn(socket, ip); c.relay = true; admin.terminal(c);
    return;
  }
  if (ipBan && (req.url.startsWith('/udp') || req.url.startsWith('/pair'))) return reject(403, 'Forbidden');
  if (req.url.startsWith('/udp')) {
    if (relays.size >= 200 || [...relays].filter((c) => c.ip === ip && !c.pair).length >= 2) return reject(429, 'Too Many Connections');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`);
    const c = new Conn(socket, ip); c.relay = true; relays.add(c); servers.relay(c);
    return;
  }
  if (req.url.startsWith('/pair')) {
    const token = new URL(req.url, 'http://x').searchParams.get('t') ?? '';
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(token)) return reject(400, 'Bad Request');
    if (relays.size >= 300 || [...relays].filter((c) => c.ip === ip && c.pair).length >= 10) return reject(429, 'Too Many Connections');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`);
    const c = new Conn(socket, ip); c.relay = true; c.pair = true; relays.add(c); pairUp(c, token);
    return;
  }
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
