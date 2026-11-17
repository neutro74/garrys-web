// Sharing saves through the hub (hub/shares.mjs): a save and its picture go up as one GWB1 bundle and come back as a short code.
// A link (?save=<code>) opens the launcher with that save; the game's Saves page lists community saves and can add any of them.
import { encodeBackup, decodeBackup } from './storage.js';
import { hubHttp } from './library.js';
import { authHeaders, account } from './account.js';

export const saveLink = (code) => `${location.origin}${location.pathname}?save=${code}`;
async function hub(path, init = {}) {
  if (!hubHttp()) throw Error('Sharing needs the Garry\'s Web server, and none is set up for this copy of the game.');
  let r;
  try { r = await fetch(hubHttp() + path, { cache: 'no-store', ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } }); }
  catch { throw Error('The Garry\'s Web server is not reachable right now.'); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Error(j.error ?? `Error ${r.status}`); }
  return r;
}
// entries: [[path under garrysmod (saves/x.gms, saves/x.jpg), bytes]].
export async function shareSave(entries, { name, map = '', desc = '', listed = true } = {}) {
  if (!account()) throw Error('Sign in to a Garry\'s Web account (launcher → Profile) to share saves.');
  const qs = new URLSearchParams({ kind: 'save', name: name ?? '', map, desc, public: listed ? '1' : '0' });
  return (await hub('share?' + qs, { method: 'POST', body: encodeBackup(entries) })).json();
}
export const shareInfo = async (code) => (await hub('share/' + encodeURIComponent(code))).json();
export const listShares = async ({ sort = 'latest', q = '', page = 0, by = '' } = {}) => (await hub('shares?' + new URLSearchParams({ kind: 'save', sort, q, page: String(page), ...(by ? { by } : {}) }))).json();
export const removeShare = (code) => hub('share/' + encodeURIComponent(code), { method: 'DELETE' });
export const shareThumb = (code) => `${hubHttp()}share/${code}/thumb`;
// The bundle's files, renamed so a shared save never overwrites one of the player's own: "<name> (shared <code>).gms".
export async function fetchShare(code) {
  const entries = decodeBackup(await (await hub(`share/${encodeURIComponent(code)}/file`)).arrayBuffer());
  return entries.filter(([p, b]) => b && /^saves\/[^/]+\.(gms|jpg)$/i.test(p)).map(([p, b]) => {
    const m = /^saves\/(.+)\.(gms|jpg)$/i.exec(p);
    return [`/overlay/garrysmod/saves/${m[1].replace(/[^\w .()-]+/g, '_').slice(0, 60)} (shared ${code}).${m[2].toLowerCase()}`, b];
  });
}
