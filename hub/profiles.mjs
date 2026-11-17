// Profiles: what other players see about a Garry's Web account (chat, friends list, profile cards).
//   GET  /profile/<user>                 -> public profile
//   GET  /profiles?u=a,b,c               -> { profiles: { user: profile } } (up to 100)
//   PUT  /profile        {fields}        -> profile                 (signed in)
//   PUT  /profile/image?kind=avatar|banner  (picture bytes) -> profile (signed in)
//   DELETE /profile/image?kind=avatar|banner                -> profile (signed in)
//   GET  /img/<sha>.<ext>                -> a stored picture
// Pictures are stored once by content hash under WS_CACHE/profiles/img; the browser resizes them before upload.
import fs from 'node:fs';
import path from 'node:path';
import { json, fail, bytes, jsonBody, imageType, blobStore, limiter } from './http-util.mjs';

const USER = /^[a-z0-9_]{3,20}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
export const STATUSES = ['online', 'idle', 'dnd', 'invisible'];
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮]/g, '').trim().slice(0, max);
const LIMITS = { avatar: 512 * 1024, banner: 1536 * 1024 };

export function createProfiles({ accounts, dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'profiles'), onChange = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const images = blobStore(path.join(dir, 'img')), uploads = limiter(20, 600e3);
  const file = (u) => path.join(dir, u + '.json');
  const cache = new Map();
  const read = (u) => {
    if (cache.has(u)) return cache.get(u);
    let p = null; try { p = JSON.parse(fs.readFileSync(file(u), 'utf8')); } catch { /* none yet */ }
    if (cache.size > 2000) cache.clear();
    cache.set(u, p); return p;
  };
  const write = (u, p) => { fs.writeFileSync(file(u) + '.tmp', JSON.stringify(p)); fs.renameSync(file(u) + '.tmp', file(u)); cache.set(u, p); };
  // Every account has a profile, even before it is edited; `user` is the account name and never changes.
  const view = (u) => {
    const p = read(u) ?? {};
    return { user: u, display: p.display || u, bio: p.bio ?? '', pronouns: p.pronouns ?? '', accent: p.accent ?? '', banner: p.banner ?? '',
      avatar: p.avatar ?? '', bannerImg: p.bannerImg ?? '', status: STATUSES.includes(p.status) ? p.status : 'online', custom: p.custom ?? null,
      links: p.links ?? [], favorite: p.favorite ?? '', since: p.since ?? 0, updated: p.updated ?? 0 };
  };
  // What others are shown: an invisible player appears offline, so the chosen status is only told to its owner.
  const publicView = (u) => { const v = view(u); if (v.status === 'invisible') v.status = 'offline'; return v; };
  function update(u, f) {
    const p = { ...(read(u) ?? {}) };
    if ('display' in f) { const d = clean(f.display, 32); if (d && d.length < 2) throw fail(400, 'Display names are at least 2 characters.'); p.display = d; }
    if ('bio' in f) p.bio = clean(f.bio, 300).replace(/\n{3,}/g, '\n\n');
    if ('pronouns' in f) p.pronouns = clean(f.pronouns, 24);
    if ('accent' in f) p.accent = COLOR.test(f.accent ?? '') ? f.accent.toLowerCase() : '';
    if ('banner' in f) p.banner = COLOR.test(f.banner ?? '') ? f.banner.toLowerCase() : '';
    if ('status' in f) { if (!STATUSES.includes(f.status)) throw fail(400, 'Unknown status.'); p.status = f.status; }
    if ('custom' in f) {
      const c = f.custom, text = clean(c?.text, 64), emoji = clean(c?.emoji, 8);
      p.custom = text || emoji ? { text, emoji, ...(+c?.until > Date.now() ? { until: +c.until } : {}) } : null;
    }
    if ('links' in f) p.links = (Array.isArray(f.links) ? f.links : []).slice(0, 4).map((l) => clean(l, 200)).filter((l) => /^https:\/\/[^\s<>"]+$/.test(l));
    if ('favorite' in f) p.favorite = clean(f.favorite, 48);
    p.since ??= Date.now(); p.updated = Date.now();
    write(u, p); onChange(u);
    return view(u);
  }
  const handle = async function handle(req, res, { ip, headers = {} }) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (!(p.startsWith('/profile') || p.startsWith('/img/'))) return false;
    const h = { ...headers, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE' };
    if (req.method === 'OPTIONS') { res.writeHead(204, h).end(); return true; }
    try {
      if (req.method === 'GET' && p.startsWith('/img/')) { images.serve(res, p.slice(5), h); return true; }
      if (req.method === 'GET' && p === '/profiles') {
        const users = String(url.searchParams.get('u') ?? '').toLowerCase().split(',').filter((u) => USER.test(u)).slice(0, 100);
        return json(res, 200, { profiles: Object.fromEntries(users.filter((u) => accounts.exists(u)).map((u) => [u, publicView(u)])) }, h), true;
      }
      const one = /^\/profile\/([a-z0-9_]{3,20})$/.exec(p.toLowerCase());
      if (req.method === 'GET' && one) {
        if (!accounts.exists(one[1])) return json(res, 404, { error: 'No such account.' }, h), true;
        const me = accounts.userOf(req);
        return json(res, 200, me === one[1] ? view(one[1]) : publicView(one[1]), h), true;
      }
      const me = accounts.userOf(req);
      if (!me) return json(res, 401, { error: 'Sign in to edit your profile.' }, h), true;
      if (req.method === 'PUT' && p === '/profile') return json(res, 200, update(me, await jsonBody(req)), h), true;
      if (p === '/profile/image') {
        const kind = url.searchParams.get('kind') === 'banner' ? 'banner' : 'avatar', field = kind === 'banner' ? 'bannerImg' : 'avatar';
        if (req.method === 'DELETE') { const q = { ...(read(me) ?? {}) }; q[field] = ''; q.updated = Date.now(); write(me, q); onChange(me); return json(res, 200, view(me), h), true; }
        if (req.method !== 'PUT') throw fail(405, 'Use PUT.');
        if (!uploads(ip)) throw fail(429, 'Too many pictures uploaded. Wait a few minutes.');
        const b = await bytes(req, LIMITS[kind]), t = imageType(b);
        if (!t) throw fail(415, 'Pictures must be PNG, JPEG, WebP or GIF.');
        const q = { ...(read(me) ?? {}) }; q[field] = images.put(b, t.ext); q.updated = Date.now(); write(me, q); onChange(me);
        return json(res, 200, view(me), h), true;
      }
      json(res, 404, { error: 'Not found' }, h);
    } catch (e) { json(res, e.status ?? 400, { error: String(e.message ?? e) }, h); }
    return true;
  };
  handle.view = view;
  handle.publicView = publicView;
  handle.status = (u) => view(u).status;
  handle.setStatus = (u, status) => update(u, { status });
  return handle;
}
