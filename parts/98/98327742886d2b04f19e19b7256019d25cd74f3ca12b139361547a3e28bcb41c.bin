// Profiles of Garry's Web accounts (hub/profiles.mjs): looked up in batches and cached, edited by their owner. Players without
// an account have no profile; they show with their chat name and a generated avatar.
import { hubHttp } from './library.js';
import { account, authHeaders } from './account.js';

const cache = new Map(), waiting = new Map();
let batch = null;
const TTL = 5 * 60e3;

// Several lookups made together become one request.
export function getProfile(user) {
  user = String(user ?? '').toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(user) || !hubHttp()) return Promise.resolve(null);
  const hit = cache.get(user);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.p);
  if (waiting.has(user)) return waiting.get(user).promise;
  let resolve; const promise = new Promise((r) => (resolve = r));
  waiting.set(user, { promise, resolve });
  if (!batch) batch = setTimeout(flush, 30);
  return promise;
}
export const cachedProfile = (user) => cache.get(String(user ?? '').toLowerCase())?.p ?? null;
async function flush() {
  batch = null;
  const users = [...waiting.keys()].slice(0, 100), list = users.map((u) => [u, waiting.get(u)]);
  for (const u of users) waiting.delete(u);
  if (waiting.size) batch = setTimeout(flush, 30);
  let got = {};
  try { const r = await fetch(`${hubHttp()}profiles?u=${users.join(',')}`, { cache: 'no-store' }); if (r.ok) got = (await r.json()).profiles ?? {}; } catch { /* offline: no profiles */ }
  for (const [u, w] of list) { const p = got[u] ?? null; cache.set(u, { p, at: Date.now() }); w.resolve(p); }
  for (const fn of listeners) fn(users);
}
// The hub announces profile changes; the next lookup fetches the new one.
export function forget(user) { cache.delete(String(user).toLowerCase()); }
const listeners = new Set();
export function onProfiles(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const imageUrl = (name) => (name ? `${hubHttp()}img/${name}` : '');
// Generated avatars: the first letter on a colour picked from the name, so guests and accounts without a picture differ.
export const nameHue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
export function avatarEl(p, name, size = 40) {
  const el = document.createElement('span');
  el.className = 'gw-avatar';
  el.style.setProperty('--s', size + 'px');
  if (p?.avatar) { const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = imageUrl(p.avatar); img.crossOrigin = 'anonymous'; el.append(img); }
  else { const n = p?.display ?? name ?? '?'; el.textContent = [...n.trim()][0]?.toUpperCase() ?? '?'; el.style.background = `hsl(${nameHue(p?.user ?? n)} 45% 42%)`; }
  return el;
}
export const displayName = (p, fallback) => p?.display || fallback || p?.user || 'Player';

async function call(path, init = {}) {
  if (!account()) throw Error('Sign in to a Garry\'s Web account first.');
  let r;
  try { r = await fetch(hubHttp() + path, { cache: 'no-store', ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } }); }
  catch { throw Error('The Garry\'s Web server is not reachable right now.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error ?? `Error ${r.status}`);
  return j;
}
export async function myProfile() { const a = account(); if (!a) return null; const p = await call('profile/' + a.user); cache.set(a.user, { p, at: Date.now() }); return p; }
export async function saveProfile(fields) {
  const p = await call('profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
  cache.set(p.user, { p, at: Date.now() }); return p;
}
export async function uploadImage(kind, blob) { const p = await call(`profile/image?kind=${kind}`, { method: 'PUT', body: blob }); cache.set(p.user, { p, at: Date.now() }); return p; }
export async function removeImage(kind) { const p = await call(`profile/image?kind=${kind}`, { method: 'DELETE' }); cache.set(p.user, { p, at: Date.now() }); return p; }

// Pictures are made small in the browser before they are sent: an avatar is cropped square, a banner to 3:1 (or a chat picture
// fitted inside `max`). Animated GIFs under the size limit are kept as they are so they still move.
export async function resizeImage(file, { w, h, max, quality = 0.86, keepGifUnder = 0 }) {
  if (keepGifUnder && file.type === 'image/gif' && file.size <= keepGifUnder) return { blob: file, w: 0, h: 0 };
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw Error('That picture could not be read.'); }
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height, tw, th;
  if (max) { const k = Math.min(1, max / Math.max(sw, sh)); tw = Math.round(sw * k); th = Math.round(sh * k); }
  else {
    const want = w / h;
    if (sw / sh > want) { sw = Math.round(sh * want); sx = Math.round((bmp.width - sw) / 2); } else { sh = Math.round(sw / want); sy = Math.round((bmp.height - sh) / 2); }
    tw = Math.min(w, sw); th = Math.round(tw / want);
  }
  const c = new OffscreenCanvas(tw, th), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(bmp, sx, sy, sw, sh, 0, 0, tw, th); bmp.close();
  let blob = await c.convertToBlob({ type: 'image/webp', quality });
  if (blob.type !== 'image/webp') blob = await c.convertToBlob({ type: 'image/jpeg', quality });   // browsers without WebP encoding
  return { blob, w: tw, h: th };
}
