// Accounts (hub/accounts.mjs): the player's settings follow their account instead of one browser. What is synced is a set
// of the launcher's localStorage entries (name, colour, player id, game versions, the addon library list, bundled-addon
// choices, launcher choices). Addon files and saves are not synced: files download again where they are missing.
// A new account takes over this browser's settings; signing in to an existing one replaces them with the account's.
import { hubHttp } from './library.js';

// 'steam' is the Steam sign-in's key (web/steam-account.js): with it, every browser on the account can join real servers.
const KEYS = ['name', 'playercolor', 'playercolor-hex', 'steamid', 'versions', 'library', 'disabled-addons', 'edition', 'quality', 'chat-room', 'steam'];
const P = 'garrys-wasm.';
const ls = {
  get(k) { try { return localStorage.getItem(P + k); } catch { return null; } },
  set(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(P + k); else localStorage.setItem(P + k, v); } catch { /* blocked */ } },
};
export const account = () => { try { return JSON.parse(ls.get('account') ?? 'null'); } catch { return null; } };
const saveAccount = (a) => ls.set('account', a ? JSON.stringify(a) : null);
const snapshot = () => Object.fromEntries(KEYS.map((k) => [k, ls.get(k)]).filter(([, v]) => v !== null));
// 'v2:' makes every browser send its settings once: before v43, a browser that pulled marked a Steam sign-in the account
// lacked as already sent.
const digest = (o) => 'v2:' + JSON.stringify(o);
// What the account itself holds, in the same form as snapshot(). After pulling, this (not this browser's settings) is what
// counts as synced, so anything only this browser has (a Steam sign-in the account lacks) is sent on the next push.
const docSnap = (doc) => Object.fromEntries(KEYS.map((k) => [k, doc?.[k] ?? null]).filter(([, v]) => v !== null));
// A Steam sign-in missing from the account's copy leaves this browser's own in place (see hub/accounts.mjs).
function apply(doc) { for (const k of KEYS) if (k !== 'steam' || doc?.steam != null) ls.set(k, doc?.[k] ?? null); }

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const base = hubHttp(), a = account();
  if (!base) throw Error('Accounts need the hub, and none is set up for this copy of the game.');
  const headers = { 'Content-Type': 'application/json' };
  if (auth && a) Object.assign(headers, { Authorization: `Bearer ${a.token}`, 'X-User': a.user });
  let r;
  try { r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', keepalive: method !== 'GET' }); }
  catch { throw Error('The account service is not reachable right now.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && auth) { saveAccount(null); }
  if (!r.ok) throw Object.assign(Error(j.error ?? `Error ${r.status}`), { status: r.status });
  return j;
}
async function signIn(route, user, pass) {
  const r = await api(route, { method: 'POST', body: { user, pass }, auth: false });
  saveAccount({ user: r.user, token: r.token, updated: r.updated, synced: '' });
  if (r.updated && Object.keys(r.doc ?? {}).length) { apply(r.doc); saveAccount({ ...account(), synced: digest(docSnap(r.doc)) }); }
  else await push();   // a new (empty) account starts from this browser's settings
  return r.user;
}
export const register = (user, pass) => signIn('acct/register', user, pass);
export const login = (user, pass) => signIn('acct/login', user, pass);
export async function logout() { await api('acct/logout', { method: 'POST' }).catch(() => {}); saveAccount(null); }
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
