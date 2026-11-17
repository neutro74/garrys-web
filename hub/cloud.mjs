// Cloud files: each account's own game files (saves, dupes, data/, settings), so they follow the player to any browser.
// The browser (web/cloud-sync.js) compares its files with the list and sends or fetches what differs.
//   GET    /cloud/list                         -> { files: [{ p, size, sha, mtime }], used, quota }
//   GET    /cloud/file?p=<path>                -> the file's bytes
//   PUT    /cloud/file?p=<path>&mtime=<ms>     (bytes) -> { p, size, sha, mtime, used }
//   DELETE /cloud/file?p=<path>                -> { used }
// Paths are relative to the game folder (garrysmod/saves/x.gms) and limited to the player's own kinds of files; contents
// are stored once per hash under WS_CACHE/cloud/<user>/blobs, with an index.json per account.
import fs from 'node:fs';
import path from 'node:path';
import { json, fail, bytes, sha256 } from './http-util.mjs';

export const CLOUD_DIRS = ['saves', 'dupes', 'data', 'cfg', 'settings', 'demos', 'screenshots'];
const QUOTA = +(process.env.CLOUD_QUOTA_MB ?? 512) * 1048576, MAX_FILE = 64 * 1048576, MAX_FILES = 20000;
// garrysmod/<one of CLOUD_DIRS>/..., plain names only; GMod's own caches inside data/ are left out.
export function cloudPath(p) {
  p = String(p ?? '');
  const parts = p.split('/');
  if (parts.length < 3 || parts.length > 12 || parts[0] !== 'garrysmod' || !CLOUD_DIRS.includes(parts[1])) return null;
  if (parts.some((x) => !x || x === '.' || x === '..' || x.length > 120 || /[\u0000-\u001f\\:*?"<>|]/.test(x))) return null;
  if (p.length > 400) return null;
  return p;
}

export function createCloud({ accounts, dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'cloud') } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const userDir = (u) => path.join(dir, u);
  const indexFile = (u) => path.join(userDir(u), 'index.json');
  const read = (u) => { try { return JSON.parse(fs.readFileSync(indexFile(u), 'utf8')); } catch { return { files: {} }; } };
  const write = (u, idx) => { fs.mkdirSync(userDir(u), { recursive: true }); fs.writeFileSync(indexFile(u) + '.tmp', JSON.stringify(idx)); fs.renameSync(indexFile(u) + '.tmp', indexFile(u)); };
  const used = (idx) => { const seen = new Set(); let n = 0; for (const f of Object.values(idx.files)) if (!seen.has(f.sha)) { seen.add(f.sha); n += f.size; } return n; };
  const blob = (u, sha) => path.join(userDir(u), 'blobs', sha.slice(0, 2), sha);
  // Contents no longer named by any file are removed.
  const sweep = (u, idx, sha) => { if (!Object.values(idx.files).some((f) => f.sha === sha)) fs.rmSync(blob(u, sha), { force: true }); };
  const handle = async function handle(req, res, { headers = {} }) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/cloud/')) return false;
    const h = { ...headers, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE' };
    if (req.method === 'OPTIONS') { res.writeHead(204, h).end(); return true; }
    try {
      const u = accounts.userOf(req);
      if (!u) throw fail(401, 'Signed out. Sign in again.');
      const idx = read(u);
      if (req.method === 'GET' && url.pathname === '/cloud/list') {
        return json(res, 200, { files: Object.entries(idx.files).map(([p, f]) => ({ p, ...f })), used: used(idx), quota: QUOTA }, h), true;
      }
      if (url.pathname !== '/cloud/file') throw fail(404, 'Not found');
      const p = cloudPath(url.searchParams.get('p'));
      if (!p) throw fail(400, 'That file cannot be kept in the cloud.');
      if (req.method === 'GET') {
        const f = idx.files[p];
        if (!f || !fs.existsSync(blob(u, f.sha))) throw fail(404, 'No such file.');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.size, 'Cache-Control': 'no-store', ...h });
        fs.createReadStream(blob(u, f.sha)).pipe(res); return true;
      }
      if (req.method === 'PUT') {
        const b = await bytes(req, MAX_FILE), sha = sha256(b), old = idx.files[p];
        if (!old && Object.keys(idx.files).length >= MAX_FILES) throw fail(507, 'Too many files in the cloud.');
        const after = used(idx) - (old && !Object.entries(idx.files).some(([q, f]) => q !== p && f.sha === old.sha) ? old.size : 0) + (Object.values(idx.files).some((f) => f.sha === sha) ? 0 : b.length);
        if (after > QUOTA) throw fail(507, `Your cloud space is full (${Math.round(QUOTA / 1048576)} MB).`);
        const target = blob(u, sha);
        if (!fs.existsSync(target)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target + '.tmp', b); fs.renameSync(target + '.tmp', target); }
        const mtime = Math.min(Date.now(), +url.searchParams.get('mtime') || Date.now());
        idx.files[p] = { size: b.length, sha, mtime };
        write(u, idx); if (old && old.sha !== sha) sweep(u, idx, old.sha);
        return json(res, 200, { p, ...idx.files[p], used: used(idx) }, h), true;
      }
      if (req.method === 'DELETE') {
        const old = idx.files[p];
        if (old) { delete idx.files[p]; write(u, idx); sweep(u, idx, old.sha); }
        return json(res, 200, { used: used(idx) }, h), true;
      }
      throw fail(405, 'Not allowed.');
    } catch (e) { json(res, e.status ?? 400, { error: String(e.message ?? e) }, h); }
    return true;
  };
  handle.usage = (u) => used(read(u));
  return handle;
}
