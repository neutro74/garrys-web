// Each account's game files, kept apart in this browser and in step with the hub (hub/cloud.mjs), so saves, dupes, data/
// and game settings follow the player to any browser:
//   - Guests use the OPFS folder "garrys-wasm"; an account uses "garrys-wasm@<user>". Signing in or out switches folders.
//   - A new account starts with the guest's files (copied once); an existing one fills its folder from the cloud.
//   - Syncing is three-way: this browser's files, the cloud's, and what both had at the last sync. A file changed on one side
//     only goes to the other; changed on both, the newer one wins. Deletions travel the same way.
//   - Before the game starts (launcher) a full sync runs. While the game runs, only this browser's changes are sent: the
//     game's storage worker owns the folder then, so nothing is written to it from here.
import { account, authHeaders } from './account.js';
import { hubHttp } from './library.js';

const DIRS = ['saves', 'dupes', 'data', 'cfg', 'settings', 'demos', 'screenshots'];
const MAX_FILE = 64 * 1048576;
export const gameDirName = (user = account()?.user) => (user ? `garrys-wasm@${user}` : 'garrys-wasm');
const baseKey = (u) => `garrys-wasm.cloud-base@${u}`;
const loadBase = (u) => { try { return JSON.parse(localStorage.getItem(baseKey(u)) ?? '{}'); } catch { return {}; } };
const saveBase = (u, b) => { try { localStorage.setItem(baseKey(u), JSON.stringify(b)); } catch { /* full: the next sync compares by content */ } };

async function dirAt(root, parts, create = false) { let d = root; for (const p of parts) d = await d.getDirectoryHandle(p, { create }); return d; }
async function exists(root, name) { try { await root.getDirectoryHandle(name); return true; } catch { return false; } }
async function copyDir(from, to) {
  for await (const [name, h] of from.entries()) {
    if (h.kind === 'directory') await copyDir(h, await to.getDirectoryHandle(name, { create: true }));
    else { const w = await (await to.getFileHandle(name, { create: true })).createWritable(); await (await h.getFile()).stream().pipeTo(w); }
  }
}
// The account's folder exists before the game opens it. A just-created account (account.js sets 'adopt-files') takes a copy of
// the guest's files, so nothing made before signing up is lost.
export async function prepareGameDir() {
  const a = account(), root = await navigator.storage.getDirectory();
  if (!a) return gameDirName(null);
  const name = gameDirName(a.user);
  let adopt = null; try { adopt = localStorage.getItem('garrys-wasm.adopt-files'); localStorage.removeItem('garrys-wasm.adopt-files'); } catch { /* blocked */ }
  if (adopt === a.user && !(await exists(root, name)) && (await exists(root, 'garrys-wasm'))) {
    const to = await root.getDirectoryHandle(name + '.part', { create: true });
    await copyDir(await root.getDirectoryHandle('garrys-wasm'), to);
    if (to.move) await to.move(name); else { await copyDir(to, await root.getDirectoryHandle(name, { create: true })); await root.removeEntry(name + '.part', { recursive: true }); }
  }
  await root.getDirectoryHandle(name, { create: true });
  return name;
}

// This browser's files: path (garrysmod/...) -> { file handle, size, lastModified }.
async function localFiles(user) {
  const out = new Map();
  let gm;
  try { gm = await dirAt(await navigator.storage.getDirectory(), [gameDirName(user), 'overlay', 'garrysmod']); } catch { return out; }
  const walk = async (dir, p) => {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') { await walk(h, `${p}/${name}`); continue; }
      const f = await h.getFile();
      if (f.size <= MAX_FILE) out.set(`${p}/${name}`, { handle: h, size: f.size, mtime: f.lastModified });
    }
  };
  for (const d of DIRS) { try { await walk(await gm.getDirectoryHandle(d), `garrysmod/${d}`); } catch { /* none */ } }
  return out;
}
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const shaOf = async (blob) => hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));

async function api(path, init = {}) {
  const r = await fetch(hubHttp() + path, { cache: 'no-store', ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(Error(j.error ?? `Error ${r.status}`), { status: r.status }); }
  return r;
}
const q = (p) => encodeURIComponent(p);

let running = null, writesStopped = false;
// The game is about to open the folder: a sync still running stops writing to it (what it has not fetched comes next time).
export function stopWrites() { writesStopped = true; }
// mode 'full' (launcher, before the game opens the folder) or 'push' (while the game runs). Returns what happened.
export function syncCloud({ mode = 'full', onProgress = () => {} } = {}) {
  if (running) return running;
  running = run(mode, onProgress).finally(() => { running = null; });
  return running;
}
async function run(mode, onProgress) {
  const a = account();
  if (!a || !hubHttp()) return { skipped: true };
  const user = a.user, base = loadBase(user), report = { up: 0, down: 0, removed: 0, used: 0, quota: 0 };
  const remoteList = await (await api('cloud/list')).json();
  report.used = remoteList.used; report.quota = remoteList.quota;
  const remote = new Map(remoteList.files.map((f) => [f.p, f])), local = await localFiles(user);
  const paths = new Set([...local.keys(), ...remote.keys(), ...Object.keys(base)]);
  const jobs = [];
  for (const p of paths) {
    const L = local.get(p), R = remote.get(p), B = base[p];
    const localChanged = L ? !B || L.size !== B.size || L.mtime !== B.lmtime : !!B;
    const remoteChanged = R ? !B || R.sha !== B.sha : !!B;
    if (!localChanged && !remoteChanged) continue;
    jobs.push({ p, L, R, B, localChanged, remoteChanged });
  }
  let done = 0;
  const step = async (j) => {
    const { p, L, R } = j;
    let { localChanged, remoteChanged } = j;
    if (localChanged && remoteChanged) {
      // Both sides changed (or this browser has never synced): same content is no conflict; otherwise the newer wins.
      if (L && R) {
        const sha = await shaOf(await L.handle.getFile());
        if (sha === R.sha) { base[p] = { sha, size: L.size, lmtime: L.mtime }; return; }
        if (L.mtime >= R.mtime) remoteChanged = false; else localChanged = false;
      } else if (L) remoteChanged = false;        // deleted there, changed here: keep it
      else if (R) localChanged = false;           // deleted here, changed there: take it back
      else { delete base[p]; return; }            // gone on both sides
    }
    if (localChanged) {
      if (L) {
        const body = await L.handle.getFile();
        const r = await (await api(`cloud/file?p=${q(p)}&mtime=${L.mtime}`, { method: 'PUT', body })).json();
        base[p] = { sha: r.sha, size: L.size, lmtime: L.mtime }; report.up++; report.used = r.used;
      } else { await api(`cloud/file?p=${q(p)}`, { method: 'DELETE' }); delete base[p]; report.removed++; }
    } else if (remoteChanged && mode === 'full' && !writesStopped) {
      const root = await navigator.storage.getDirectory(), parts = p.split('/'), name = parts.pop();
      const dir = await dirAt(root, [gameDirName(user), 'overlay', ...parts], true);
      if (R) {
        const blob = await (await api(`cloud/file?p=${q(p)}`)).blob();
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(blob); await w.close();
        const f = await (await dir.getFileHandle(name)).getFile();
        base[p] = { sha: R.sha, size: f.size, lmtime: f.lastModified }; report.down++;
      } else { await dir.removeEntry(name).catch(() => {}); delete base[p]; report.removed++; }
    }
  };
  // A few transfers at a time; the base is saved as it goes, so an interrupted sync resumes where it stopped.
  const queue = jobs.slice();
  let error = null;
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let j; !error && (j = queue.shift());) {
      try { await step(j); } catch (e) { if (e.status === 507 || e.status === 401) error = e; else console.warn('[cloud]', j.p, e.message); }
      done++; onProgress(done, jobs.length);
      if (done % 20 === 0) saveBase(user, base);
    }
  }));
  saveBase(user, base);
  if (error) throw error;
  return report;
}

// While the game runs: send this browser's changes every minute and when the page is hidden or closed.
let timer = 0;
export function autoPush(flush = async () => {}) {
  if (timer || !account() || !hubHttp()) return;
  const go = () => flush().catch(() => {}).then(() => syncCloud({ mode: 'push' })).catch((e) => console.warn('[cloud]', e.message));
  timer = setInterval(go, 60e3);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') go(); });
  return go;
}
