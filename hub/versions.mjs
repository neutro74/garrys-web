// Shared game versions: a player's custom version (edition + Workshop addon list) stored under a short code, so a link
// (?v=<code>) gives the same setup to anyone. Only Workshop ids are shared, never files.
//   POST /v          JSON body -> { code }
//   GET  /v/<code>   the version
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createVersions({ dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'versions'), perIpHour = 20 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const recent = new Map();
  const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
  const json = (res, code, obj, headers) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
  return async function handle(req, res, { ip, headers = {} }) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/v' && !url.pathname.startsWith('/v/')) return false;
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }).end(); return true; }
    try {
      if (req.method === 'POST' && url.pathname === '/v') {
        const times = (recent.get(ip) ?? []).filter((t) => Date.now() - t < 3600e3);
        if (times.length >= perIpHour) return json(res, 429, { error: 'Too many shared versions from your address this hour.' }, headers), true;
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 64 * 1024) return json(res, 413, { error: 'Version too large.' }, headers), true; }
        const v = JSON.parse(body);
        const out = {
          name: clean(v.name, 48) || 'Untitled', author: clean(v.author, 24), edition: v.edition === 'extended' ? 'extended' : 'base',
          addons: (Array.isArray(v.addons) ? v.addons : []).slice(0, 500).filter((a) => /^\d{1,20}$/.test(String(a?.id)))
            .map((a) => ({ id: String(a.id), title: clean(a.title, 96), size: Math.max(0, +a.size || 0) })),
          disabled: (Array.isArray(v.disabled) ? v.disabled : []).slice(0, 200).map((n) => clean(n, 64)).filter((n) => /^[a-z0-9_.-]+$/i.test(n)),
          created: Date.now(),
        };
        const code = crypto.randomBytes(6).toString('base64url');
        fs.writeFileSync(path.join(dir, code + '.json'), JSON.stringify(out));
        times.push(Date.now()); recent.set(ip, times);
        return json(res, 200, { code }, headers), true;
      }
      const m = /^\/v\/([A-Za-z0-9_-]{4,16})$/.exec(url.pathname);
      if (req.method === 'GET' && m && fs.existsSync(path.join(dir, m[1] + '.json'))) return json(res, 200, JSON.parse(fs.readFileSync(path.join(dir, m[1] + '.json'), 'utf8')), headers), true;
      json(res, 404, { error: 'No such version.' }, headers);
    } catch (e) { json(res, 400, { error: String(e.message ?? e) }, headers); }
    return true;
  };
}
