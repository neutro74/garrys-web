#!/usr/bin/env node
// Dev server for the in-browser host: the page and host modules, the lifted DLL artifacts (/out/*), and the user's
// Garry's Mod install as read-only files with HTTP range support (/game/*) plus an index of them (/game-index.json),
// and the game's asset:// URLs (/asset/<host>/<path>) for HTML panels, resolved like the engine does: loose files
// first, then the mounted VPKs, with asset://mapimage/<map> giving the map's thumbnail.
//
//   node web/server.mjs [--port 8080]      GMOD_ROOT selects the install (default: the Steam install)
//
// Local addons and the desktop config.cfg are not part of the browser build (garrysmod/addons appears empty; the
// install is not touched). SERVER_HIDE=path,... hides further install paths.
//
// Cross-origin isolation headers are required for SharedArrayBuffer, which the guest's threads depend on.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameFs } from '../tools/lib/vpk.mjs';
import { gameRoot } from '../tools/lib/game-root.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(REPO, process.env.LIFT_OUT ?? 'tools/lift/out');   // LIFT_OUT=tools/lift/out-next tests a rebuild before swapping
const GAME = gameRoot();
// The Extended edition's tree (tools/build-extended.mjs): other games' folders, bundled addons, a mount.cfg.
const EXT = path.resolve(REPO, process.env.EXT_ROOT ?? 'packs/extended/root');
const portArg = process.argv.indexOf('--port');
const PORT = portArg > 0 ? +process.argv[portArg + 1] : +process.env.PORT || 8080;
const staticArg = process.argv.indexOf('--static');
const STATIC = staticArg > 0 ? path.resolve(process.argv[staticArg + 1]) : null;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.txt': 'text/plain' };
const HEADERS = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-cache' };

// { name: size | { ... } } for every file under the install (one walk at startup).
function buildIndex(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out[e.name] = buildIndex(p);
    else if (e.isFile()) out[e.name] = fs.statSync(p).size;
  }
  return out;
}
let index = null, extIndex = null;
// The desktop game's saved settings are not the browser's: config.cfg carries desktop-only values (for example
// r_flashlightdepthres 8192 = eight 128 MB shadow maps). The browser keeps its own config in OPFS.
const HIDE = ['garrysmod/addons/', 'garrysmod/cfg/config.cfg', ...(process.env.SERVER_HIDE ?? '').split(',')].filter(Boolean);
const HIDDEN = HIDE.map((p) => p.replace(/^\/+|\/+$/g, '').toLowerCase());
const keepDir = new Set(HIDE.filter((p) => p.endsWith('/')).map((p) => p.replace(/^\/+|\/+$/g, '').toLowerCase()));
const hidden = (rel) => { const r = rel.replace(/^\/+/, '').toLowerCase(); return HIDDEN.some((h) => r === h || r.startsWith(h + '/')); };
function hide(tree) {
  for (const h of HIDDEN) {
    const parts = h.split('/'); let n = tree;
    for (const p of parts.slice(0, -1)) { const k = n && Object.keys(n).find((x) => x.toLowerCase() === p); n = k && typeof n[k] === 'object' ? n[k] : null; }
    const k = n && Object.keys(n).find((x) => x.toLowerCase() === parts.at(-1));
    if (k) { if (keepDir.has(h)) n[k] = {}; else delete n[k]; }
  }
  return tree;
}

// The engine's GAME search path: garrysmod first, then the shared Source content, each loose before its VPKs.
let assets = null;
function readAsset(host, rel) {
  assets ??= new GameFs(['garrysmod', 'sourceengine', 'platform'].map((d) => path.join(GAME, d)));
  rel = path.posix.normalize('/' + rel).slice(1);
  if (host.toLowerCase() === 'mapimage') {
    const map = rel.replace(/\.(png|jpg)$/i, '');
    // No picture is a 404, as in the release (asset/mapimage/ holds the stock maps' only): web/menu-extras.js then looks in
    // the addons and falls back to GMod's noicon.
    for (const p of [`maps/thumb/${map}.png`, `maps/thumb/${map}.jpg`]) { const d = assets.read(p); if (d) return { data: d, name: p }; }
    return null;
  }
  const d = assets.read(rel) ?? assets.read(rel.toLowerCase());
  return d ? { data: d, name: rel } : null;
}

function within(root, rel) {
  const p = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  return p === root || p.startsWith(root + path.sep) ? p : null;
}

function serveFile(req, res, file) {
  let st;
  try { st = fs.statSync(file); } catch { notFound(res, file); return; }
  if (!st.isFile()) { notFound(res, file); return; }
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] === '' ? Math.max(0, st.size - +range[2]) : +range[1];
    const end = range[1] === '' || range[2] === '' ? st.size - 1 : Math.min(+range[2], st.size - 1);
    if (start > end || start >= st.size) { res.writeHead(416, { ...HEADERS, 'Content-Range': `bytes */${st.size}` }).end(); return; }
    res.writeHead(206, { ...HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  // READ_LOG=file records every request (path and Range) so tools/make-warm-list.mjs can find the chunks a boot reads.
  if (process.env.READ_LOG) fs.appendFileSync(process.env.READ_LOG, `${pathname}\t${req.headers.range ?? ''}\n`);
  if (STATIC) { serveFile(req, res, within(STATIC, pathname === '/' ? '/index.html' : pathname)); return; }
  if (pathname === '/game-index.json') {
    index ??= hide(buildIndex(GAME));
    const body = JSON.stringify(index);
    res.writeHead(200, { ...HEADERS, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }).end(body);
    return;
  }
  if (pathname === '/game-ext-index.json') {
    if (!fs.existsSync(EXT)) { notFound(res, pathname); return; }
    extIndex ??= buildIndex(EXT);
    const body = JSON.stringify(extIndex);
    res.writeHead(200, { ...HEADERS, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }).end(body);
    return;
  }
  const asset = /^\/asset\/([^/]+)\/(.*)$/.exec(pathname);
  if (asset) {
    const hit = readAsset(asset[1], asset[2]);
    if (!hit) { notFound(res, pathname); return; }
    res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[path.extname(hit.name).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': hit.data.length }).end(hit.data);
    return;
  }
  if (pathname === '/favicon.ico') { serveFile(req, res, path.join(GAME, 'garrysmod/resource/game.ico')); return; }
  let file = null;
  if (pathname.startsWith('/game/ext/')) file = within(EXT, pathname.slice(10));
  else if (pathname.startsWith('/game/')) file = hidden(pathname.slice(6)) ? null : within(GAME, pathname.slice(6));
  else if (pathname.startsWith('/out/')) file = within(OUT, pathname.slice(5));
  else if (pathname === '/') file = path.join(REPO, 'web/index.html');
  else if (pathname === '/ports/gmod/compat/addons.mjs') file = within(REPO, pathname.slice(1));
  else if (/^\/(web|runtime|tools)\//.test(pathname)) file = within(REPO, pathname.slice(1));
  if (!file) { notFound(res, req.url); return; }
  serveFile(req, res, file);
}).listen(PORT, '127.0.0.1', () => console.log(`GMod web host on http://127.0.0.1:${PORT}  (install: ${GAME})`));

function notFound(res, what) {
  if (process.env.SERVER_LOG_404) console.log(`[server] 404 ${what}`);
  res.writeHead(404, HEADERS).end();
}
