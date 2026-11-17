// The addon library and game versions, shared by the launcher and the in-game menus.
//
// Library: addon files (.gma) in OPFS 'garrys-wasm-library', written here by streaming (never held in memory whole) and
// served to the game by storage-worker.js. Metadata (title, Workshop id, size, type) is kept in localStorage.
// Which addons a launch gets: for the plain Base/Extended editions, the library entries marked `global` (the "my addons"
// set, edited from the in-game Addons page); for a custom game version, exactly that version's list.
//
// Versions: { id, name, edition, addons: [{ name, id?, title, size }], disabled: [bundled addon names], author, code? }.
// They can be shared through the hub (POST /v), which hands back a short code; ?v=<code> opens it in the launcher.
import { hubUrl } from './hub.js';

const store = {
  get(k, d) { try { const v = localStorage.getItem('garrys-wasm.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('garrys-wasm.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
export const wsName = (id) => `ws-${id}.gma`;
export const fileName = (title) => `file-${String(title).toLowerCase().replace(/\.gma$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'addon'}.gma`;

// ---- Metadata ----
export const libraryMeta = () => store.get('library', {});
export function updateMeta(name, info) { const m = libraryMeta(); m[name] = { ...m[name], ...info }; store.set('library', m); return m[name]; }
export function dropMeta(name) { const m = libraryMeta(); delete m[name]; store.set('library', m); }

// ---- Files ----
const libDir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('garrys-wasm-library', { create: true });
export async function hasFile(name) { try { await (await libDir()).getFileHandle(name); return true; } catch { return false; } }
// Streams a body (Response, Blob or ReadableStream) into the library under `name`, reporting bytes written.
export async function writeFile(name, body, onProgress = () => {}) {
  const stream = body instanceof Response ? body.body : body instanceof Blob ? body.stream() : body;
  const tmp = name + '.part', dir = await libDir(), w = await (await dir.getFileHandle(tmp, { create: true })).createWritable();
  let done = 0;
  try {
    await stream.pipeThrough(new TransformStream({ transform(chunk, c) { done += chunk.length; onProgress(done); c.enqueue(chunk); } })).pipeTo(w);
  } catch (e) { await dir.removeEntry(tmp).catch(() => {}); throw e; }
  // OPFS has no rename on every browser: move() where available, else copy.
  const fh = await dir.getFileHandle(tmp);
  if (fh.move) { await dir.removeEntry(name).catch(() => {}); await fh.move(name); }
  else { const w2 = await (await dir.getFileHandle(name, { create: true })).createWritable(); await (await fh.getFile()).stream().pipeTo(w2); await dir.removeEntry(tmp); }
  return done;
}
const MAGIC = 'GMAD';
export async function checkGma(blob) {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...head) !== MAGIC) throw Error('That is not a Garry\'s Mod addon (.gma) file.');
}

// ---- Workshop through the hub (hub/workshop.mjs) ----
export const hubHttp = () => { const u = hubUrl(); return u ? u.replace(/^ws/, 'http').replace(/\/?$/, '/') : ''; };
export async function hubJson(path, init) {
  const base = hubHttp();
  if (!base) throw Error('No hub is set up for this copy of the game, so the Workshop is unavailable.');
  let r;
  try { r = await fetch(base + path, { cache: 'no-store', ...init }); } catch { throw Error('The Workshop service is not reachable right now.'); }
  const j = await r.json().catch(() => ({ error: `The Workshop service answered ${r.status}` }));
  if (!r.ok) throw Object.assign(Error(j.error ?? `Error ${r.status}`), { status: r.status });
  return j;
}
export const workshopDetails = async (ids) => (await hubJson('ws/details?ids=' + encodeURIComponent([].concat(ids).join(',')))).items;
// Downloads a Workshop item into the library. onProgress({ phase: queued|downloading|transferring, loaded, total, position }).
export async function downloadWorkshop(id, { title, onProgress = () => {} } = {}) {
  id = String(id);
  if (!/^\d{1,20}$/.test(id)) throw Error('Not a Workshop item id');
  const name = wsName(id);
  // The hub can restart or the connection blip while a long download runs: connection errors and busy answers are retried
  // for about a minute, and a download the hub no longer knows about (it restarted) is asked for again.
  let failures = 0, restarts = 0, post = true;
  for (let i = 0; ; i++) {
    let st;
    try { st = await hubJson(`ws/fetch/${id}`, { method: post ? 'POST' : 'GET' }); failures = 0; post = false; }
    catch (e) {
      if ((e.status && ![502, 503, 504].includes(e.status)) || ++failures > 30) throw e;
      onProgress({ phase: 'reconnecting', loaded: 0, total: 0, position: 0 });
      await new Promise((r) => setTimeout(r, 2000)); continue;
    }
    onProgress({ phase: st.state, loaded: 0, total: st.size ?? 0, position: st.position ?? 0 });
    if (st.state === 'ready') break;
    if (st.state === 'error') throw Error(st.error || 'The download failed.');
    if (st.state === 'none' && i) { if (++restarts > 3) throw Error('The download was dropped. Try again.'); post = true; continue; }
    if (i > 1800) throw Error('The download is taking too long.');
    await new Promise((r) => setTimeout(r, i < 5 ? 1000 : 2000));
  }
  const r = await fetch(hubHttp() + `ws/file/${id}.gma`);
  if (!r.ok) throw Error(`Download failed (${r.status})`);
  const total = +r.headers.get('content-length') || 0;
  const size = await writeFile(name, r, (loaded) => onProgress({ phase: 'transferring', loaded, total }));
  const meta = libraryMeta()[name] ?? {};
  updateMeta(name, { id, title: title || meta.title || `Workshop item ${id}`, size, added: meta.added ?? Date.now() });
  return name;
}

// ---- How heavy an addon is for this device ----
// Addon content is read from disk as the game needs it, but models, textures and maps still end up in memory once used, and
// Lua runs every frame. The estimate weighs size against the memory the browser reports (navigator.deviceMemory, capped at 8)
// and the core count; it is a hint, not a measurement.
export function device() {
  const mem = navigator.deviceMemory ?? 4, cores = navigator.hardwareConcurrency ?? 4;
  return { mem, cores, low: mem <= 4 || cores <= 4 };
}
export function impact(bytes, { count = 1 } = {}) {
  const d = device(), budget = d.mem * 48 * 1048576 * (d.cores <= 2 ? 0.6 : 1);   // ~190 MB of addons on a 4 GB machine
  const load = bytes / budget + Math.max(0, count - 10) * 0.03;
  return load < 0.2 ? { level: 'light', label: 'Light', color: '#4a4' }
    : load < 1 ? { level: 'moderate', label: 'May slow down', color: '#c80' }
    : { level: 'heavy', label: d.low ? 'Heavy for this device' : 'Heavy', color: '#c33' };
}

// ---- Versions ----
export const versions = () => store.get('versions', []);
export const saveVersions = (list) => store.set('versions', list);
export function getVersion(id) { return versions().find((v) => v.id === id) ?? null; }
export function putVersion(v) {
  const list = versions(), i = list.findIndex((x) => x.id === v.id);
  v = { ...v, updated: Date.now() };
  if (i >= 0) list[i] = v; else list.push(v);
  saveVersions(list); return v;
}
export function removeVersion(id) { saveVersions(versions().filter((v) => v.id !== id)); }
export const newVersionId = () => Math.random().toString(36).slice(2, 10);
// The addon files a launch mounts: a version's list, or the library's "my addons" for a plain edition.
export function launchAddons(version) {
  if (version) return version.addons.map((a) => a.name);
  return Object.entries(libraryMeta()).filter(([, m]) => m.global).map(([n]) => n);
}
export async function shareVersion(v) {
  const body = JSON.stringify({ name: v.name, edition: v.edition, addons: v.addons.filter((a) => a.id).map(({ id, title, size }) => ({ id, title, size })), disabled: v.disabled ?? [], author: v.author ?? '' });
  const r = await hubJson('v', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return r.code;
}
export async function fetchSharedVersion(code) {
  if (!/^[A-Za-z0-9_-]{4,16}$/.test(code)) throw Error('That is not a version code.');
  const v = await hubJson('v/' + code);
  return { id: newVersionId(), name: String(v.name).slice(0, 48), edition: v.edition === 'extended' ? 'extended' : 'base', author: v.author ?? '', code,
    addons: (v.addons ?? []).map((a) => ({ name: wsName(a.id), id: String(a.id), title: a.title, size: a.size })), disabled: v.disabled ?? [] };
}
