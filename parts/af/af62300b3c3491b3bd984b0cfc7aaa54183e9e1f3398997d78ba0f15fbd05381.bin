// Accounts (hub/accounts.mjs): the player's settings follow their account instead of one browser (see LOCAL_ONLY below).
// Their game files (saves, dupes, data, game settings) follow it through web/cloud-sync.js; addon files download again where
// they are missing. A new account takes over this browser's settings and files; signing in to an existing one replaces them
// with the account's, and signing out brings back what this browser had as a guest.
import { hubHttp } from './library.js';

// Everything the launcher and game keep in localStorage under "garrys-wasm." follows the account (name, colours, player id,
// game versions, the addon library list, bundled-addon choices, graphics preset, chat state...), except what belongs to this
// browser alone: the session itself, the hub address, one-off page state. 'steam' is the Steam sign-in's key
// (web/steam-account.js): with it, every browser on the account can join real servers.
const LOCAL_ONLY = /^(account|hub|resume|context-lost|guest-stash|cdn-isolation:.*|adopt-files|cloud-.*|launch-timing)$/;
const P = 'garrys-wasm.';
const ls = {
  get(k) { try { return localStorage.getItem(P + k); } catch { return null; } },
  set(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(P + k); else localStorage.setItem(P + k, v); } catch { /* blocked */ } },
};
const syncKeys = () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(P) && !LOCAL_ONLY.test(k.slice(P.length))) out.push(k.slice(P.length)); } } catch { /* blocked */ } return out.sort(); };
// Headers that sign a request in as this browser's account (for the hub's profile, cloud and share services).
export function authHeaders() { const a = account(); return a ? { Authorization: `Bearer ${a.token}`, 'X-User': a.user } : {}; }
export const account = () => { try { return JSON.parse(ls.get('account') ?? 'null'); } catch { return null; } };
const saveAccount = (a) => ls.set('account', a ? JSON.stringify(a) : null);
const snapshot = () => Object.fromEntries(syncKeys().map((k) => [k, ls.get(k)]).filter(([, v]) => v !== null));
// 'v3:' makes every browser send its settings once after the switch from a fixed list of keys to all of them.
const digest = (o) => 'v3:' + JSON.stringify(o);
// What the account itself holds, in the same form as snapshot(). After pulling, this (not this browser's settings) is what
// counts as synced, so anything only this browser has (a Steam sign-in the account lacks) is sent on the next push.
const docSnap = (doc) => Object.fromEntries(Object.entries(doc ?? {}).filter(([k, v]) => !LOCAL_ONLY.test(k) && typeof v === 'string').sort(([a], [b]) => (a < b ? -1 : 1)));
// The account's settings replace this browser's: keys it lacks are removed. A Steam sign-in missing from the account's copy
// leaves this browser's own in place (see hub/accounts.mjs).
function apply(doc) {
  const d = docSnap(doc);
  for (const k of syncKeys()) if (!(k in d) && !(k === 'steam')) ls.set(k, null);
  for (const [k, v] of Object.entries(d)) ls.set(k, v);
}
// Signing in keeps the guest's own settings aside; signing out brings them back, so each account (and the guest) has its own.
function stashGuest() { if (ls.get('guest-stash') === null) ls.set('guest-stash', JSON.stringify(snapshot())); }
function restoreGuest() {
  let stash = null; try { stash = JSON.parse(ls.get('guest-stash') ?? 'null'); } catch { /* bad stash */ }
  if (!stash) return;
  for (const k of syncKeys()) ls.set(k, null);
  for (const [k, v] of Object.entries(stash)) ls.set(k, v);
  ls.set('guest-stash', null);
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const base = hubHttp(), a = account();
  if (!base) throw Error('Accounts need the hub, and none is set up for this copy of the game.');
  const headers = { 'Content-Type': 'application/json' };
  if (auth && a) Object.assign(headers, { Authorization: `Bearer ${a.token}`, 'X-User': a.user });
  let r;
  try { r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', keepalive: method !== 'GET' }); }
  catch { throw Error('The account service is not reachable right now.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && auth) { saveAccount(null); restoreGuest(); }   // signed out elsewhere (password changed): back to the guest's settings
  if (!r.ok) throw Object.assign(Error(j.error ?? `Error ${r.status}`), { status: r.status });
  return j;
}
async function signIn(route, user, pass) {
  const r = await api(route, { method: 'POST', body: { user, pass }, auth: false });
  stashGuest();
  saveAccount({ user: r.user, token: r.token, updated: r.updated, synced: '' });
  if (r.updated && Object.keys(r.doc ?? {}).length) { apply(r.doc); saveAccount({ ...account(), synced: digest(docSnap(r.doc)) }); }
  else { ls.set('adopt-files', r.user); await push(); }   // a new (empty) account starts from this browser's settings and files
  return r.user;
}
export const register = (user, pass) => signIn('acct/register', user, pass);
export const login = (user, pass) => signIn('acct/login', user, pass);
export async function logout() { await push().catch(() => {}); await api('acct/logout', { method: 'POST' }).catch(() => {}); saveAccount(null); restoreGuest(); }
export const changePassword = (old, pass) => api('acct/password', { method: 'POST', body: { old, pass } });

export async function push() {
  const a = account();
  if (!a) return;
  const snap = snapshot(), d = digest(snap);
  if (d === a.synced) return;
  const r = await api('acct/me', { method: 'PUT', body: { doc: snap } });
  saveAccount({ ...account(), updated: r.updated, synced: d });
}
// Brings this browser up to date: the account's newer settings win; otherwise local changes are sent.
export async function sync() {
  const a = account();
  if (!a) return 'signed-out';
  const r = await api('acct/me');
  if (r.updated > (a.updated ?? 0)) { apply(r.doc); saveAccount({ ...account(), updated: r.updated, synced: digest(docSnap(r.doc)) }); return 'pulled'; }
  await push();
  return 'pushed';
}
let timer = 0;
export function autoSync() {
  if (timer || !account()) return;
  timer = setInterval(() => push().catch(() => {}), 10000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') push().catch(() => {}); });
}
