// Custom emojis and stickers, like a Discord server's: admins add them from the launcher's Admin tab, everyone uses them in
// chat (emojis as :name: in text, stickers as a message of their own). The built-in sets (GMod's Silkicons, flags, entity
// and prop icons) live in the page; only these uploads are kept here.
//   GET    /emotes                                   -> { items: [{ id, kind, name, file, by, at }] }
//   GET    /emotes/img/<file>
//   POST   /emotes?kind=emoji|sticker&name=<name>    (admin account; body: PNG, GIF, WebP or JPEG) -> item
//   DELETE /emotes/<id>                              (admin account)
// Also the GIF link import for chat (a picture from another site is copied here, since the page cannot show
// cross-origin pictures that do not allow it):
//   POST   /chat/import { url }                      (signed in) -> { name } in the chat picture store
// And GIF search through GIPHY (the API key stays here: GIPHY_KEY, or the file <WS_CACHE>/giphy.key):
//   GET    /gifs?q=<words>&offset=<n>                (signed in) -> { items: [{ id, title, preview, w, h, url }], more }
//          no q: trending. The key allows 100 requests an hour, so: results are cached (trending 1 h, searches 1 day),
//          the whole hub makes at most GIPHY_PER_HOUR (90) calls an hour, and each player at most 15 searches an hour.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { json, fail, bytes, jsonBody, imageType, blobStore, limiter } from './http-util.mjs';

const NAME = /^[a-z0-9_]{2,32}$/;
const LIMITS = { emoji: 256 * 1024, sticker: 1024 * 1024 };
export const STICKER = /^(c|e|p):[a-z0-9_]{1,48}$/;   // custom (by id), entity icon, prop icon

export function createEmotes({ accounts, isAdmin, chatImages, muted, onChange = () => {}, log = console.log }) {
  const dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'emotes'), file = path.join(dir, 'index.json');
  fs.mkdirSync(dir, { recursive: true });
  const images = blobStore(path.join(dir, 'img')), uploads = limiter(60, 600e3), imports = limiter(20, 600e3);
  // ---- GIF search (GIPHY) ----
  const giphyKey = () => process.env.GIPHY_KEY || (() => { try { return fs.readFileSync(path.join(dir, '..', 'giphy.key'), 'utf8').trim(); } catch { return ''; } })();
  const PER_HOUR = +(process.env.GIPHY_PER_HOUR ?? 90), calls = [], gifCache = new Map(), searches = limiter(15, 3600e3);
  const budgetLeft = () => { const now = Date.now(); while (calls.length && now - calls[0] > 3600e3) calls.shift(); return PER_HOUR - calls.length; };
  async function giphy(q, offset) {
    const key = `${q}|${offset}`, hit = gifCache.get(key), ttl = q ? 86400e3 : 3600e3;
    if (hit && Date.now() - hit.at < ttl) return hit.data;
    if (!giphyKey()) throw fail(503, 'GIF search is not set up on this hub.');
    if (budgetLeft() <= 0) {
      if (hit) return hit.data;   // an old answer beats none
      const wait = Math.ceil((3600e3 - (Date.now() - calls[0])) / 60e3);
      throw fail(429, `GIF search is resting (it has an hourly limit). Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    }
    calls.push(Date.now());
    const u = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`);
    u.search = new URLSearchParams({ api_key: giphyKey(), limit: '24', offset: String(offset), rating: 'pg-13', bundle: 'messaging_non_clips', ...(q ? { q, lang: 'en' } : {}) });
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!r?.ok) throw fail(502, r?.status === 429 ? 'GIPHY says the hourly limit is used up. Try again later.' : 'GIPHY did not answer.');
    const j = await r.json();
    const data = { items: (j.data ?? []).map((g) => {
      const im = g.images ?? {}, prev = im.fixed_width_small ?? im.fixed_width ?? {}, send = (+(im.downsized?.size ?? 9e9) <= 2.5 * 1048576 ? im.downsized : im.fixed_width) ?? im.original ?? {};
      return { id: g.id, title: String(g.title ?? '').slice(0, 80), preview: prev.webp || prev.url, w: +prev.width || 0, h: +prev.height || 0, url: send.url };
    }).filter((g) => /^https:\/\/media\d*\.giphy\.com\//.test(g.url ?? '') && /^https:\/\/media\d*\.giphy\.com\//.test(g.preview ?? '')),
    more: (j.pagination?.total_count ?? 0) > offset + 24 };
    if (gifCache.size > 3000) gifCache.clear();
    gifCache.set(key, { at: Date.now(), data });
    return data;
  }
  let items = []; try { items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(items)); fs.renameSync(file + '.tmp', file); };

  // A sticker value from a message: built-in sets are trusted by shape; custom ones must exist.
  const sticker = (v) => {
    const s = String(v ?? '');
    if (!STICKER.test(s)) return undefined;
    if (s.startsWith('c:') && !items.some((x) => x.kind === 'sticker' && x.id === s.slice(2))) return undefined;
    return s;
  };

  async function handle(req, res, h, ip) {
    const url = new URL(req.url, 'http://x'), p = url.pathname;
    if (!p.startsWith('/emotes') && p !== '/chat/import' && p !== '/gifs') return false;
    const hh = { ...h, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User', 'Access-Control-Allow-Methods': 'GET, POST, DELETE' };
    if (req.method === 'OPTIONS') { res.writeHead(204, hh).end(); return true; }
    try {
      if (p === '/chat/import' && req.method === 'POST') {
        const u = accounts.userOf(req);
        if (!u) throw fail(401, 'Sign in to post GIFs.');
        if (!imports(u) || !imports('ip:' + ip)) throw fail(429, 'Too many links. Wait a few minutes.');
        if (muted({ ip, account: u })) throw fail(403, 'You are muted.');
        const b = await fetchImage(String((await jsonBody(req)).url ?? ''));
        return json(res, 200, { name: chatImages.put(b, imageType(b).ext) }, hh), true;
      }
      if (req.method === 'GET' && p === '/gifs') {
        const u = accounts.userOf(req);
        if (!u) throw fail(401, 'Sign in to search GIFs.');
        const q = String(url.searchParams.get('q') ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 50), offset = Math.max(0, Math.min(240, +(url.searchParams.get('offset') ?? 0) | 0));
        const cached = gifCache.get(`${q}|${offset}`);
        if (!(cached && Date.now() - cached.at < (q ? 86400e3 : 3600e3)) && q && !searches(u)) throw fail(429, 'That is a lot of searching. Try again in a while.');
        return json(res, 200, await giphy(q, offset), hh), true;
      }
      if (req.method === 'GET' && p === '/emotes') return json(res, 200, { items }, { ...hh, 'Cache-Control': 'no-cache' }), true;
      if (req.method === 'GET' && p.startsWith('/emotes/img/')) { images.serve(res, p.slice('/emotes/img/'.length), hh); return true; }
      const u = accounts.userOf(req);
      if (!u || !isAdmin(u)) throw fail(403, 'Only admins manage emojis and stickers.');
      if (req.method === 'POST' && p === '/emotes') {
        const kind = url.searchParams.get('kind') === 'sticker' ? 'sticker' : 'emoji', name = String(url.searchParams.get('name') ?? '').toLowerCase();
        if (!NAME.test(name)) throw fail(400, 'Names are 2 to 32 letters, digits or _.');
        if (items.some((x) => x.kind === kind && x.name === name)) throw fail(409, `There is already a ${kind} called ${name}.`);
        if (!uploads(u)) throw fail(429, 'Too many uploads. Wait a few minutes.');
        const b = await bytes(req, LIMITS[kind]), t = imageType(b);
        if (!t) throw fail(415, 'Use a PNG, GIF, WebP or JPEG picture.');
        const item = { id: crypto.randomBytes(5).toString('hex'), kind, name, file: images.put(b, t.ext), by: u, at: Date.now() };
        items.push(item); save(); onChange(); log(`emotes: ${u} added ${kind} ${name}`);
        return json(res, 200, item, hh), true;
      }
      const m = /^\/emotes\/([a-f0-9]{10})$/.exec(p);
      if (req.method === 'DELETE' && m) {
        const before = items.length; items = items.filter((x) => x.id !== m[1]);
        if (items.length === before) throw fail(404, 'No such emoji or sticker.');
        save(); onChange(); log(`emotes: ${u} removed ${m[1]}`);
        return json(res, 200, {}, hh), true;
      }
      throw fail(404, 'Not found');
    } catch (e) { json(res, e.status ?? 400, { error: String(e.message ?? e) }, hh); }
    return true;
  }
  return { handle, sticker };
}

// ---- Fetching a picture from a link, safely ----
// HTTPS only, at most 4 MB and 3 redirects, and never to this machine or the home network: every address the name resolves
// to is checked when the connection is made (so a name that changes its answer cannot slip through).
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^0\./, /^22[4-9]\.|^2[3-5]\d\./,
  /^::1$/, /^::$/, /^f[cd]/i, /^fe[89ab]/i, /^::ffff:/i];
const isPrivate = (ip) => PRIVATE.some((r) => r.test(ip));
function safeLookup(host, opts, cb) {
  dns.lookup(host, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err);
    const ok = list.filter((a) => !isPrivate(a.address));
    if (!ok.length || ok.length !== list.length) return cb(Object.assign(Error('That address is not allowed.'), { code: 'EPRIVATE' }));
    if (opts.all) cb(null, ok); else cb(null, ok[0].address, ok[0].family);
  });
}
export function fetchImage(link, redirects = 3) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(link); } catch { return reject(fail(400, 'That is not a link.')); }
    if (u.protocol !== 'https:') return reject(fail(400, 'Only https:// links work.'));
    if (net.isIP(u.hostname) && isPrivate(u.hostname)) return reject(fail(400, 'That address is not allowed.'));
    const req = https.get(u, { lookup: safeLookup, timeout: 10000, headers: { 'User-Agent': 'GarrysWebHub/1 (picture import)', Accept: 'image/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (!redirects) return reject(fail(400, 'Too many redirects.'));
        return resolve(fetchImage(new URL(res.headers.location, u).href, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(fail(400, `The link answered ${res.statusCode}.`)); }
      const parts = []; let n = 0;
      res.on('data', (d) => { n += d.length; if (n > 4 * 1048576) { req.destroy(); reject(fail(413, 'That picture is over 4 MB.')); } else parts.push(d); });
      res.on('end', () => { const b = Buffer.concat(parts); if (!imageType(b)) reject(fail(415, 'That link is not a picture.')); else resolve(b); });
    });
    req.on('timeout', () => req.destroy(Object.assign(Error('The link took too long.'), { status: 504 })));
    req.on('error', (e) => reject(fail(400, e.code === 'EPRIVATE' ? 'That address is not allowed.' : e.status ? e.message : 'The link could not be fetched.')));
  });
}
