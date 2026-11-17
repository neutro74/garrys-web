// Small helpers shared by the hub's HTTP services (profiles, cloud files, shares, chat uploads).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export function json(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
export const fail = (status, message) => Object.assign(Error(message), { status });
// The request body as bytes, refused past `max`.
export async function bytes(req, max) {
  const len = +(req.headers['content-length'] ?? 0);
  if (len > max) throw fail(413, `Too large (the limit is ${Math.round(max / 1048576 * 10) / 10} MB).`);
  const parts = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw fail(413, `Too large (the limit is ${Math.round(max / 1048576 * 10) / 10} MB).`); parts.push(c); }
  return Buffer.concat(parts);
}
export async function jsonBody(req, max = 64 * 1024) {
  const b = await bytes(req, max);
  try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { throw fail(400, 'Bad JSON.'); }
}
// Pictures people upload: only these formats, recognised by their first bytes (not by what the browser claims).
export function imageType(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  return null;
}
export const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
// Stores content-addressed files (name = hash + extension) and serves them with a long cache lifetime.
export function blobStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    put(buf, ext) { const name = `${sha256(buf)}.${ext}`, f = path.join(dir, name); if (!fs.existsSync(f)) { fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f); } return name; },
    serve(res, name, headers = {}) {
      const m = /^([a-f0-9]{64})\.(png|jpg|webp|gif)$/.exec(name ?? '');
      if (!m) return json(res, 404, { error: 'Not found' }, headers);
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) return json(res, 404, { error: 'Not found' }, headers);
      res.writeHead(200, { 'Content-Type': MIME[m[2]], 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff', ...headers });
      fs.createReadStream(f).pipe(res);
    },
  };
}
// A per-address limiter for uploads and other costly requests: `n` within `ms`.
export function limiter(n, ms) {
  const hits = new Map();
  return (key) => {
    const now = Date.now(), list = (hits.get(key) ?? []).filter((t) => now - t < ms);
    if (list.length >= n) { hits.set(key, list); return false; }
    list.push(now); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < ms)) hits.delete(k);
    return true;
  };
}
