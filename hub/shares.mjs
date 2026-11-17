// Shared saves and dupes: a player uploads one save (its .gms and picture) and gets a short code; anyone can open it from a
// link (?save=<code>) or from the community list on the game's Saves page.
//   POST   /share?kind=save&name=&map=&desc=&public=1  (GWB1 bundle: the save file and its .jpg)  -> { code }   (signed in)
//   GET    /shares?kind=save&sort=latest|popular&q=&page=  -> { items, total }
//   GET    /share/<code>            -> details
//   GET    /share/<code>/file       -> the GWB1 bundle (counts a download)
//   GET    /share/<code>/thumb      -> the picture
//   DELETE /share/<code>            -> {} (its author, or an admin)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { json, fail, bytes, limiter } from './http-util.mjs';

const KINDS = { save: /^saves\/[^/]+\.(gms|jpg)$/i, dupe: /^dupes\/[^/]+\.(dupe|jpg)$/i };
const MAX = 24 * 1048576;
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').trim().slice(0, max);

// GWB1 (web/storage.js encodeBackup): "GWB1", then per entry u32 name length, u32 size (0xffffffff = folder), name, bytes.
export function readBundle(b) {
  if (b.length < 4 || b.toString('latin1', 0, 4) !== 'GWB1') throw fail(400, 'Not a Garry\'s Web bundle.');
  const out = []; let p = 4;
  while (p < b.length) {
    if (p + 8 > b.length) throw fail(400, 'Truncated bundle.');
    const n = b.readUInt32LE(p), len = b.readUInt32LE(p + 4); p += 8;
    if (!n || n > 400 || p + n > b.length) throw fail(400, 'Bad bundle.');
    const name = b.toString('utf8', p, p + n); p += n;
    if (len === 0xffffffff) { out.push([name, null]); continue; }
    if (p + len > b.length) throw fail(400, 'Truncated bundle.');
    out.push([name, b.subarray(p, p + len)]); p += len;
    if (out.length > 16) throw fail(400, 'Too many files in the bundle.');
  }
  return out;
}

export function createShares({ accounts, isAdmin = () => false, dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'shares') } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const posts = limiter(12, 3600e3), indexFile = path.join(dir, 'index.json');
  let index = {}; try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { /* new */ }
  let saveTimer = 0;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { fs.writeFileSync(indexFile + '.tmp', JSON.stringify(index)); fs.renameSync(indexFile + '.tmp', indexFile); }, 500); };
  const file = (code, ext) => path.join(dir, `${code}.${ext}`);
  const view = (code) => { const s = index[code]; return s && { code, ...s }; };
  const handle = async function handle(req, res, { ip, headers = {} }) {
    const url = new URL(req.url, 'http://x');
    if (!(url.pathname === '/share' || url.pathname === '/shares' || url.pathname.startsWith('/share/'))) return false;
    const h = { ...headers, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User', 'Access-Control-Allow-Methods': 'GET, POST, DELETE' };
    if (req.method === 'OPTIONS') { res.writeHead(204, h).end(); return true; }
    try {
      if (req.method === 'POST' && url.pathname === '/share') {
        const u = accounts.userOf(req);
        if (!u) throw fail(401, 'Sign in to a Garry\'s Web account to share.');
        if (!posts(u) || !posts('ip:' + ip)) throw fail(429, 'You have shared a lot recently. Try again later.');
        const kind = url.searchParams.get('kind') === 'dupe' ? 'dupe' : 'save';
        const b = await bytes(req, MAX), entries = readBundle(b);
        if (!entries.length || entries.some(([n, x]) => x !== null && !KINDS[kind].test(n))) throw fail(400, `The bundle may only hold ${kind} files.`);
        if (!entries.some(([n, x]) => x && !/\.jpg$/i.test(n))) throw fail(400, `No ${kind} file in the bundle.`);
        const code = crypto.randomBytes(6).toString('base64url');
        fs.writeFileSync(file(code, 'gwb'), b);
        const thumb = entries.find(([n, x]) => x && /\.jpg$/i.test(n));
        if (thumb) fs.writeFileSync(file(code, 'jpg'), thumb[1]);
        const main = entries.find(([n, x]) => x && !/\.jpg$/i.test(n))[0];
        index[code] = { kind, name: clean(url.searchParams.get('name') || main.split('/').pop().replace(/\.\w+$/, ''), 64), map: clean(url.searchParams.get('map'), 64),
          desc: clean(url.searchParams.get('desc'), 300), author: u, at: Date.now(), size: b.length, downloads: 0, thumb: !!thumb, public: url.searchParams.get('public') !== '0' };
        save();
        return json(res, 200, { code, ...index[code] }, h), true;
      }
      if (req.method === 'GET' && url.pathname === '/shares') {
        const kind = url.searchParams.get('kind') === 'dupe' ? 'dupe' : 'save', q = String(url.searchParams.get('q') ?? '').toLowerCase().trim();
        const by = url.searchParams.get('by')?.toLowerCase(), page = Math.max(0, +url.searchParams.get('page') || 0), per = 24;
        let list = Object.keys(index).map(view).filter((s) => s.kind === kind && (by ? s.author === by : s.public));
        if (q) list = list.filter((s) => `${s.name} ${s.map} ${s.author} ${s.desc}`.toLowerCase().includes(q));
        const sort = url.searchParams.get('sort');
        list.sort(sort === 'popular' ? (a, b) => b.downloads - a.downloads || b.at - a.at : (a, b) => b.at - a.at);
        return json(res, 200, { items: list.slice(page * per, page * per + per), total: list.length }, h), true;
      }
      const m = /^\/share\/([A-Za-z0-9_-]{6,12})(\/file|\/thumb)?$/.exec(url.pathname);
      if (!m || !index[m[1]]) throw fail(404, 'That share does not exist (it may have been removed).');
      const code = m[1];
      if (req.method === 'DELETE' && !m[2]) {
        const u = accounts.userOf(req);
        if (!u || (u !== index[code].author && !isAdmin(u))) throw fail(403, 'Only its author can remove this.');
        delete index[code]; save();
        for (const ext of ['gwb', 'jpg']) fs.rmSync(file(code, ext), { force: true });
        return json(res, 200, {}, h), true;
      }
      if (req.method !== 'GET') throw fail(405, 'Not allowed.');
      if (!m[2]) return json(res, 200, view(code), h), true;
      const ext = m[2] === '/file' ? 'gwb' : 'jpg';
      if (!fs.existsSync(file(code, ext))) throw fail(404, 'Not found');
      if (ext === 'gwb') { index[code].downloads++; save(); }
      res.writeHead(200, { 'Content-Type': ext === 'jpg' ? 'image/jpeg' : 'application/octet-stream', 'Cache-Control': ext === 'jpg' ? 'public, max-age=86400' : 'no-store', 'Cross-Origin-Resource-Policy': 'cross-origin', ...h });
      fs.createReadStream(file(code, ext)).pipe(res);
    } catch (e) { json(res, e.status ?? 400, { error: String(e.message ?? e) }, h); }
    return true;
  };
  handle.byAuthor = (u) => Object.keys(index).map(view).filter((s) => s.author === u);
  return handle;
}
