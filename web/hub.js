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

// Every request this page makes to the hub carries the browser's id (X-Device), so a ban by browser covers all of the hub's
// services, not only chat (hub/hub.mjs banOf). Installed once, around fetch, for requests to the hub's own address.
(() => {
  if (globalThis.__gwDeviceFetch || typeof fetch !== 'function') return;
  globalThis.__gwDeviceFetch = true;
  const base = () => { const u = hubUrl(); return u ? u.replace(/^ws/, 'http').replace(/\/?$/, '/') : ''; };
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    try {
      const b = base(), url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      if (b && url && url.startsWith(b)) {
        if (input instanceof Request) { const h = new Headers(input.headers); h.set('X-Device', playerId()); return orig(new Request(input, { headers: h }), init); }
        const h = new Headers(init?.headers ?? {}); h.set('X-Device', playerId());
        return orig(input, { ...(init ?? {}), headers: h });
      }
    } catch { /* fall through unchanged */ }
    return orig(input, init);
  };
})();

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
    this.ws = ws; ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.retry = 0; this.send({ t: 'hello', name: this.name, device: playerId(), activity: this.activity }); };   // device: this browser's id, for moderation
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') { this.emit('binary', e.data); return; }   // voice audio (web/voice-chat.js)
      let m; try { m = JSON.parse(e.data); } catch { return; } this.message(m);
    };
    ws.onclose = () => {
      this.ws = null; this.me = null; if (!this.banned) this.setState('offline');
      if (this.closing) return;
      const wait = Math.min(30000, 1000 * 2 ** this.retry++);   // back off; a hub restart reconnects everyone
      this.timer = setTimeout(() => this.connect(), wait);
    };
  }
  close() { this.closing = true; clearTimeout(this.timer); this.ws?.close(); }
  send(m) { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; }
  // Binary frames (voice audio); dropped rather than queued when the connection is backed up.
  sendBinary(buf) { if (this.ws?.readyState === 1 && this.ws.bufferedAmount < 64 * 1024) { this.ws.send(buf); return true; } return false; }
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
    if (m.t === 'authed') {
      const was = this.account;
      this.account = m.user; this.isAdmin = !!m.admin; this.myStatus = m.status ?? 'online'; if (this.me && m.user) this.me.key = 'a:' + m.user;
      if (m.user && m.user !== was) for (const r of this.rooms) this.send({ t: 'join', room: r });   // chat rooms are for accounts: join again now
    }
    if (m.t === 'pings') { this.pings = m.list; this.pingsSeenAt = m.seen; }
    if (m.t === 'ping') (this.pings ??= []).unshift(m);
    if (m.t === 'pings-seen') this.pingsSeenAt = m.at;
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
  // Pings (mentions and answers): looked at up to now; usernames for @ suggestions.
  pingsSeen(at = Date.now()) { this.pingsSeenAt = at; return this.send({ t: 'pings-seen', at }); }
  findUsers(q) { return this.send({ t: 'find-users', q }); }
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

// Before anything talks to the hub: one request to it, so that a browser which must ask the player first (Chrome's "access
// devices on your local network" prompt: some networks' DNS gives the hub a local address) asks now, while the page is
// still loading, rather than chat and profiles failing later. `onWait` runs if the answer takes a moment (a prompt is up).
// Resolves true once the hub answered; false if it cannot be reached (the page carries on either way, after `max` ms).
export async function requestHubAccess({ url = hubUrl(), onWait = () => {}, max = 12000 } = {}) {
  if (!url) return false;
  const health = url.replace(/^ws/, 'http').replace(/\/?$/, '/health');
  const waiting = setTimeout(onWait, 1500);
  const attempt = async () => {
    // A plain request first; if the browser refuses it outright, again with the hint that the server is on a local
    // network, which is what makes Chrome show its prompt where a plain request is just refused.
    for (const hint of [null, 'local', 'private']) {
      const t0 = performance.now();
      try { const r = await fetch(health, { cache: 'no-store', ...(hint ? { targetAddressSpace: hint } : {}) }); return r.ok; }
      catch { if (performance.now() - t0 > 3000) return false; }   // a slow failure is the network, not the browser
    }
    return false;
  };
  try { return await Promise.race([attempt(), new Promise((r) => setTimeout(() => r(false), max))]); } finally { clearTimeout(waiting); }
}

// Is this browser banned? (hub /ban-check; the launcher shows a ban screen instead of opening.) A ban seen once is kept
// here, so the screen still shows when the hub cannot be reached; a "not banned" answer clears it.
const BAN_KEY = 'garrys-wasm.ban';
export async function banCheck(url = hubUrl()) {
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(BAN_KEY) ?? 'null'); } catch { /* blocked */ }
  if (kept?.until && kept.until < Date.now()) kept = null;
  if (!url) return kept;
  try {
    const a = (() => { try { return JSON.parse(localStorage.getItem('garrys-wasm.account') ?? 'null'); } catch { return null; } })();
    const r = await fetch(url.replace(/^ws/, 'http').replace(/\/?$/, '/ban-check'), { cache: 'no-store', signal: AbortSignal.timeout(6000), headers: a?.token ? { Authorization: `Bearer ${a.token}`, 'X-User': a.user } : {} });
    const j = await r.json();
    try { if (j.banned) localStorage.setItem(BAN_KEY, JSON.stringify({ reason: j.reason ?? '', until: j.until ?? 0, at: Date.now() })); else localStorage.removeItem(BAN_KEY); } catch { /* blocked */ }
    return j.banned ? { reason: j.reason ?? '', until: j.until ?? 0 } : null;
  } catch { return kept; }
}

