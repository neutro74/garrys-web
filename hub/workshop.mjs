// Workshop service for the hub: browse Garry's Mod Workshop items and fetch their .gma files for the browser build.
// The browser cannot do either itself: Steam's Web API sends no CORS headers, and most items have no download link (they
// come through Steam's content system). Browsing uses the Web API (search needs STEAM_KEY; item details do not); files
// come from DepotDownloader's anonymous login (which serves Garry's Mod Workshop items), cached on disk.
//   GET  /ws/browse?sort=trending|popular|latest|search&tag=Weapon&q=text&page=1   (needs STEAM_KEY)
//   GET  /ws/details?ids=1,2,3
//   POST /ws/fetch/<id>   start (or report) a download -> { state: queued|downloading|ready|error, size, error }
//   GET  /ws/fetch/<id>   the same report, without starting anything
//   GET  /ws/file/<id>.gma  the cached file (after state ready)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const API = 'https://api.steampowered.com';
const GMOD = 4000;
const TAGS = ['Gamemode', 'Map', 'Weapon', 'Vehicle', 'NPC', 'Tool', 'Effects', 'Model', 'Entity', 'Servercontent'];
const SORTS = { popular: 0, latest: 1, trending: 3, search: 12 };

export function createWorkshop({ key = process.env.STEAM_KEY ?? '', cacheDir = process.env.WS_CACHE ?? './ws-cache', depotDownloader = process.env.DEPOT_DOWNLOADER ?? 'DepotDownloader',
  maxItem = +(process.env.WS_MAX_ITEM ?? 8 * 1024 ** 3), maxCache = +(process.env.WS_MAX_CACHE ?? 30 * 1024 ** 3), maxAgeDays = +(process.env.WS_MAX_AGE_DAYS ?? 7), perIpHour = +(process.env.WS_PER_IP_HOUR ?? 30) } = {}) {
  fs.mkdirSync(path.join(cacheDir, 'files'), { recursive: true });
  const memo = new Map();   // url -> { at, value }
  const jobs = new Map();   // id -> { state, size, error, waiters }
  const queue = [];
  let running = false;
  const recent = new Map(); // ip -> [timestamps]

  async function cached(k, ms, fn) {
    const hit = memo.get(k);
    if (hit && Date.now() - hit.at < ms) return hit.value;
    const value = await fn();
    memo.set(k, { at: Date.now(), value });
    if (memo.size > 500) memo.delete(memo.keys().next().value);
    return value;
  }
  const item = (d) => ({
    id: String(d.publishedfileid), title: String(d.title ?? ''), preview: d.preview_url ?? '', size: +(d.file_size ?? 0),
    description: String(d.file_description ?? d.description ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300),
    tags: (d.tags ?? []).map((t) => t.tag ?? t.display_name).filter(Boolean), subs: +(d.subscriptions ?? d.lifetime_subscriptions ?? 0),
    up: +(d.vote_data?.votes_up ?? 0), down: +(d.vote_data?.votes_down ?? 0), updated: +(d.time_updated ?? 0),
    ok: d.result === 1 && (d.consumer_app_id ?? d.consumer_appid) === GMOD && !d.banned,
  });

  async function details(ids) {
    ids = [...new Set(ids.map(String).filter((i) => /^\d{1,20}$/.test(i)))].slice(0, 100);
    if (!ids.length) return [];
    return cached('d:' + ids.join(','), 10 * 60e3, async () => {
      const body = new URLSearchParams({ itemcount: String(ids.length) });
      ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));
      const r = await fetch(`${API}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Error(`Steam answered ${r.status}`);
      return (await r.json()).response.publishedfiledetails.map(item);
    });
  }

  async function browse({ sort = 'trending', tag = '', q = '', page = 1 }) {
    if (!key) throw Object.assign(Error('Workshop browsing is not set up on this hub (no Steam Web API key).'), { status: 501 });
    if (q) sort = 'search';
    const qt = SORTS[sort] ?? SORTS.trending;
    const p = new URLSearchParams({ key, appid: String(GMOD), query_type: String(qt), page: String(Math.max(1, Math.min(200, page | 0 || 1))), numperpage: '30',
      return_tags: 'true', return_previews: 'true', return_vote_data: 'true', return_short_description: 'true', 'requiredtags[0]': 'Addon', match_all_tags: 'true', strip_description_bbcode: 'true' });
    if (TAGS.includes(tag)) p.set('requiredtags[1]', tag);
    if (qt === SORTS.trending) p.set('days', '7');
    if (q) p.set('search_text', String(q).slice(0, 100));
    const url = `${API}/IPublishedFileService/QueryFiles/v1/?${p}`;
    return cached('b:' + url, 10 * 60e3, async () => {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Error(`Steam answered ${r.status}`);
      const resp = (await r.json()).response ?? {};
      return { total: resp.total ?? 0, items: (resp.publishedfiledetails ?? []).map(item).filter((i) => i.ok) };
    });
  }

  // ---- Downloads ----
  const file = (id) => path.join(cacheDir, 'files', `${id}.gma`);
  const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.length > 1e5) out = out.slice(-5e4); });
    p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), 20 * 60e3);
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(Error(out.trim().split('\n').slice(-2).join(' ') || `exit ${code}`)); });
    p.on('error', reject);
  });
  const isGma = (f) => { const fd = fs.openSync(f, 'r'), b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); return b.toString('latin1') === 'GMAD'; };
  // The item's file, whatever it is called: .gma, or on old items "..._legacy.bin" or "uploads/addons/<hash>.gm" (both
  // LZMA-compressed). A known extension wins; otherwise the largest file. Its contents are checked after.
  function findGma(dir) {
    const all = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.DepotDownloader') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push({ p, size: fs.statSync(p).size, known: /\.(gma|bin|gm)$/i.test(e.name) }); } };
    walk(dir);
    all.sort((a, b) => b.known - a.known || b.size - a.size);
    return all[0]?.p ?? null;
  }
  // Old items arrive LZMA-compressed; their streams can end with a bad marker after complete data, so a non-zero exit
  // from xz is accepted when the output is a GMA.
  const unlzma = (src, dst) => new Promise((resolve) => {
    const out = fs.createWriteStream(dst), p = spawn('xz', ['-dc', '--format=lzma', src], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.pipe(out); p.on('close', () => out.end(resolve));
  });
  // The cache is cleared of anything nobody fetched for a week (WS_MAX_AGE_DAYS), checked every six hours; files are
  // fetched again from Steam when next asked for. Over WS_MAX_CACHE, the least recently used go first.
  setInterval(() => { try { evict(); } catch { /* next time */ } }, 6 * 3600e3).unref();
  function evict() {
    const dir = path.join(cacheDir, 'files');
    for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (Date.now() - fs.statSync(p).atimeMs > maxAgeDays * 86400e3 && !jobs.has(n.replace(/\.gma$/, ''))) fs.rmSync(p, { force: true }); }
    const files = fs.readdirSync(dir).map((n) => { const s = fs.statSync(path.join(dir, n)); return { p: path.join(dir, n), size: s.size, at: s.atimeMs }; }).sort((a, b) => a.at - b.at);
    let total = files.reduce((a, f) => a + f.size, 0);
    for (const f of files) { if (total <= maxCache) break; fs.rmSync(f.p, { force: true }); total -= f.size; }
  }
  async function download(id) {
    const job = jobs.get(id);
    job.state = 'downloading';
    const work = path.join(cacheDir, 'work', id);
    fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
    try {
      await run(depotDownloader, ['-app', String(GMOD), '-pubfile', id, '-dir', work, '-max-downloads', '4'], { cwd: work });
      const got = findGma(work);
      if (!got) throw Error('The item has no addon file.');
      const tmp = file(id) + '.part';
      if (isGma(got)) fs.renameSync(got, tmp); else await unlzma(got, tmp);
      if (!fs.existsSync(tmp) || !isGma(tmp)) throw Error('The downloaded file is not a Garry\'s Mod addon.');
      if (fs.statSync(tmp).size > maxItem) { fs.rmSync(tmp); throw Error('The addon is larger than this hub allows.'); }
      fs.renameSync(tmp, file(id));
      Object.assign(job, { state: 'ready', size: fs.statSync(file(id)).size });
      evict();
    } catch (e) {
      Object.assign(job, { state: 'error', error: String(e.message ?? e).slice(0, 300) });
      setTimeout(() => { if (jobs.get(id) === job) jobs.delete(id); }, 60e3);   // allow a retry later
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  }
  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) await download(queue.shift());
    running = false;
  }
  function report(id) {
    if (fs.existsSync(file(id))) return { state: 'ready', size: fs.statSync(file(id)).size };
    const j = jobs.get(id);
    return j ? { state: j.state, size: j.size, error: j.error, position: j.state === 'queued' ? queue.indexOf(id) + 1 : 0 } : { state: 'none' };
  }
  async function fetchItem(id, ip) {
    const now = report(id);
    if (now.state !== 'none') return now;
    const times = (recent.get(ip) ?? []).filter((t) => Date.now() - t < 3600e3);
    if (times.length >= perIpHour) throw Object.assign(Error('Too many downloads from your address this hour. Try again later.'), { status: 429 });
    const [d] = await details([id]);
    if (!d?.ok) throw Object.assign(Error('That is not an available Garry\'s Mod Workshop item.'), { status: 404 });
    if (d.tags.some((t) => /^(save|dupe|demo)$/i.test(t))) throw Object.assign(Error('Saves, dupes and demos are not addons.'), { status: 400 });
    if (d.size > maxItem) throw Object.assign(Error(`This addon is ${Math.round(d.size / 1048576)} MB; this hub allows up to ${Math.round(maxItem / 1048576)} MB.`), { status: 413 });
    times.push(Date.now()); recent.set(ip, times);
    jobs.set(id, { state: 'queued', size: d.size });
    queue.push(id); pump();
    return report(id);
  }

  // ---- HTTP ----
  const json = (res, code, obj, headers) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
  return async function handle(req, res, { ip, headers = {} }) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/ws/')) return false;
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Max-Age': '86400' }).end(); return true; }
    try {
      let m;
      if (url.pathname === '/ws/browse') json(res, 200, await browse(Object.fromEntries(url.searchParams)), headers);
      else if (url.pathname === '/ws/details') json(res, 200, { items: await details((url.searchParams.get('ids') ?? '').split(',')) }, headers);
      else if ((m = /^\/ws\/fetch\/(\d{1,20})$/.exec(url.pathname))) json(res, 200, req.method === 'POST' ? await fetchItem(m[1], ip) : report(m[1]), headers);
      else if ((m = /^\/ws\/file\/(\d{1,20})\.gma$/.exec(url.pathname)) && fs.existsSync(file(m[1]))) {
        const f = file(m[1]), size = fs.statSync(f).size, now = new Date();
        fs.utimesSync(f, now, fs.statSync(f).mtime);   // recently used: kept by evict()
        res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'public, max-age=86400',
          'Cross-Origin-Resource-Policy': 'cross-origin' });
        fs.createReadStream(f).pipe(res);
      } else json(res, 404, { error: 'Not found' }, headers);
    } catch (e) { json(res, e.status ?? 502, { error: String(e.message ?? e) }, headers); }
    return true;
  };
}
export { TAGS };
