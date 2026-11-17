// Client for the hub (hub/hub.mjs): chat rooms, the open-game list and pairing signals between players.
// The hub address comes from ?hub=wss://..., then a saved choice, then HUB_DEFAULT; empty means no hub (features hide).
export const HUB_DEFAULT = 'wss://homelab.tail40e4e3.ts.net';

const store = {
  get(k, d) { try { return localStorage.getItem('garrys-wasm.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('garrys-wasm.' + k, v); } catch { /* storage blocked */ } },
};
export function hubUrl() {
  const q = new URLSearchParams(location.search).get('hub');
  if (q !== null) store.set('hub', q);
  const u = (q ?? store.get('hub', HUB_DEFAULT)).trim();
  return /^wss?:\/\//.test(u) ? u : '';
}
export const savedName = () => store.get('name', '');
// The player's id (a Steam account number, also used in game by steam.mjs) is made once and kept; the default name uses it.
export function playerId() {
  let id = store.get('steamid', '');
  if (!/^\d{1,10}$/.test(id)) { id = String(1e6 + Math.floor(Math.random() * 2e9)); store.set('steamid', id); }
  return id;
}
const randomName = () => `Player${playerId().slice(-4)}`;

export class Hub extends EventTarget {
  constructor(url = hubUrl()) {
    super();
    this.url = url; this.ws = null; this.me = null; this.state = url ? 'idle' : 'off'; this.retry = 0; this.rooms = new Set(); this.watch = false; this.lobby = null;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { const h = (e) => fn(e.detail); this.addEventListener(type, h); return () => this.removeEventListener(type, h); }
  setState(s) { this.state = s; this.emit('state', s); }
  get name() { return this.me?.name ?? (savedName() || randomName()); }
  connect() {
    if (!this.url || this.ws) return;
    this.setState('connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.setState('offline'); return; }
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.send({ t: 'hello', name: this.name, device: playerId(), activity: this.activity }); };   // device: this browser's id, for moderation
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.message(m); };
    ws.onclose = () => {
      this.ws = null; this.me = null; if (!this.banned) this.setState('offline');
      if (this.closing) return;
      const wait = Math.min(30000, 1000 * 2 ** this.retry++);   // back off; a hub restart reconnects everyone
      this.timer = setTimeout(() => this.connect(), wait);
    };
  }
  close() { this.closing = true; clearTimeout(this.timer); this.ws?.close(); }
  send(m) { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; }
  message(m) {
    if (m.t === 'welcome') {
      const first = !this.me;
      this.me = { id: m.id, name: m.name, key: m.key }; store.set('name', m.name);
      this.online = m.online; this.roomList = m.rooms;
      if (m.presence) this.presence = new Map(m.presence.map((p) => [p.user, p]));
      if (first) {
        this.setState('online');
        this.auth();
        for (const r of this.rooms) this.send({ t: 'join', room: r });   // rejoin after a reconnect
        if (this.watch) this.send({ t: 'watch-lobbies' });
        if (this.lobby) this.send({ t: 'host', lobby: this.lobby });
      }
    }
    if (m.t === 'rooms') { this.roomList = m.rooms; this.online = m.online; }
    if (m.t === 'authed') { this.account = m.user; this.isAdmin = !!m.admin; this.myStatus = m.status ?? 'online'; if (this.me && m.user) this.me.key = 'a:' + m.user; }
    if (m.t === 'my-status') this.myStatus = m.status;
    if (m.t === 'presence') { (this.presence ??= new Map()); if (m.status === 'offline') this.presence.delete(m.user); else this.presence.set(m.user, m); }
    if (m.t === 'presence-list') this.presence = new Map(m.users.map((p) => [p.user, p]));
    if (m.t === 'friends') this.friends = m;
    // Banned by an admin (hub/admin.mjs): the hub closes the socket; trying again would only be refused.
    if (m.t === 'banned') { this.banned = m; this.closing = true; this.setState('banned'); }
    if (m.t === 'lobby-closed') this.lobby = null;
    this.emit(m.t, m);
  }
  // Signed in to a Garry's Web account (Profile, web/account.js): the chat socket signs in too, for private messages.
  auth() {
    let a = null;
    try { a = JSON.parse(localStorage.getItem('garrys-wasm.account') ?? 'null'); } catch { /* storage blocked */ }
    if (a?.user && a?.token) this.send({ t: 'auth', user: a.user, token: a.token }); else this.account = null;
  }
  roomHistory(room, before) { return this.send({ t: 'room-history', room, before }); }
  dm(to, text, extra = {}) { return this.send({ t: 'dm', to, text, ...extra }); }
  dms() { return this.send({ t: 'dms' }); }
  dmHistory(other, before) { return this.send({ t: 'dm-history', with: other, before }); }
  rename(name) { store.set('name', name); if (this.me) this.send({ t: 'nick', name }); }
  join(room) { this.rooms.add(room); this.send({ t: 'join', room }); }
  leave(room) { this.rooms.delete(room); this.send({ t: 'leave', room }); }
  say(room, text, extra = {}) { return this.send({ t: 'say', room, text, ...extra }); }
  // Changing a message: `where` is { room } for a channel or { with } for a private chat.
  edit(where, id, text) { return this.send({ t: 'edit', ...where, id, text }); }
  remove(where, id) { return this.send({ t: 'delete', ...where, id }); }
  react(where, id, emoji, on = true) { return this.send({ t: 'react', ...where, id, emoji, on }); }
  typing(where) { const now = Date.now(); if (now - (this.typedAt ?? 0) < 3000) return; this.typedAt = now; this.send({ t: 'typing', ...where }); }
  friend(op, user) { return this.send({ t: op, user }); }   // friend-add, friend-accept, friend-remove, block, unblock
  setStatus(status) { this.myStatus = status; return this.send({ t: 'status', status }); }
  // What this page is doing (the launcher, a game, a map), shown to friends; resent after a reconnect.
  setActivity(activity) { this.activity = activity; this.send({ t: 'activity', activity }); }
  watchLobbies(on = true) { this.watch = on; this.send({ t: 'watch-lobbies', on }); }
  host(lobby) { this.lobby = lobby; this.send({ t: 'host', lobby }); }
  unhost() { this.lobby = null; this.send({ t: 'unhost' }); }
  signal(to, data) { return this.send({ t: 'signal', to, data }); }
}

// One connection per page, shared by chat, friends, lobbies and the in-game overlay (the hub allows few per address).
let shared = null;
export function sharedHub() { if (!shared || shared.closing) shared = new Hub(); return shared; }

// The hub's public status without opening a socket (for an "N online" line).
export async function hubStatus(url = hubUrl()) {
  if (!url) return null;
  try {
    const r = await fetch(url.replace(/^ws/, 'http').replace(/\/?$/, '/health'), { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
