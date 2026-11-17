// The player's saves as the launcher sees them: read and written straight in OPFS (garrys-wasm[@user]/overlay/garrysmod/saves),
// which is only safe while the game is not running (then web/storage-worker.js owns the folder).
import { gameDirName } from './cloud-sync.js';

async function savesDir(create = false) {
  const root = await navigator.storage.getDirectory();
  let d = await root.getDirectoryHandle(gameDirName(), { create });
  for (const p of ['overlay', 'garrysmod', 'saves']) d = await d.getDirectoryHandle(p, { create });
  return d;
}
// Newest first: { file: 'saves/x.gms', name, size, at, thumb: File|null }.
export async function listSaves() {
  let dir; try { dir = await savesDir(); } catch { return []; }
  const files = new Map();
  for await (const [name, h] of dir.entries()) if (h.kind === 'file') files.set(name, h);
  const out = [];
  for (const [name, h] of files) {
    if (!/\.gms$/i.test(name)) continue;
    const f = await h.getFile(), jpg = files.get(name.replace(/\.gms$/i, '.jpg'));
    out.push({ file: 'saves/' + name, name: name.replace(/\.gms$/i, ''), size: f.size, at: f.lastModified, thumb: jpg ? await jpg.getFile() : null });
  }
  return out.sort((a, b) => b.at - a.at);
}
// A save and its picture as bundle entries ([path under garrysmod, bytes]).
export async function saveEntries(file) {
  const dir = await savesDir(), base = file.replace(/^saves\//, '').replace(/\.gms$/i, ''), out = [];
  for (const ext of ['gms', 'jpg']) { try { out.push([`saves/${base}.${ext}`, new Uint8Array(await (await (await dir.getFileHandle(`${base}.${ext}`)).getFile()).arrayBuffer())]); } catch { /* no picture */ } }
  return out;
}
export async function deleteSave(file) {
  const dir = await savesDir(), base = file.replace(/^saves\//, '').replace(/\.gms$/i, '');
  for (const ext of ['gms', 'jpg']) await dir.removeEntry(`${base}.${ext}`).catch(() => {});
}
// Entries as web/save-share.js fetchShare returns them (/overlay/garrysmod/saves/...). Returns the save's 'saves/x.gms'.
export async function writeSaveEntries(entries) {
  const dir = await savesDir(true);
  let gms = null;
  for (const [p, bytes] of entries) {
    const name = p.split('/').pop();
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(bytes); await w.close();
    if (/\.gms$/i.test(name)) gms = 'saves/' + name;
  }
  return gms;
}
