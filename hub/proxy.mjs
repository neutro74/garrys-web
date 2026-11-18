// Web proxy for the launcher's Browser tab, plus a plain CORS proxy (signed-in accounts only).
//
//   POST /proxy/session                    (account token) -> { token, expires }    a proxy session, 12 hours
//   GET|POST|HEAD /p/<token>/<scheme>/<host>/<path...>    a web page or anything it loads, with its links rewritten to come
//                                          back through here; HTML gets a small script (/proxy/client.js) that sends
//                                          fetch/XHR/new elements through the proxy and tells the launcher where it is
//   GET|POST|PUT|DELETE|HEAD /cors?url=<url>   one request, answered as is with CORS headers (X-Proxy-Token: <token>, or
//                                          the account's Authorization), for pages and the game to read other sites
//
// Safety: only http(s) on ports 80, 443, 8080 and 8443; never local, private or tailnet addresses (checked on the address
// the name resolves to, so a name cannot point back inside); no cookies from the player's browser (each session keeps its
// own small cookie jar here); per-account limits on requests and bytes. PROXY=0 turns it all off.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ON = process.env.PROXY !== '0';
const SESSION_MS = 12 * 3600e3, MAX_BODY = 8 << 20, MAX_REWRITE = 16 << 20, MAX_RESPONSE = 200 << 20;
const DAY_BYTES = +(process.env.PROXY_DAY_MB ?? 2048) * 1048576, PER_MIN = +(process.env.PROXY_PER_MIN ?? 600);
const PORTS = new Set([80, 443, 8080, 8443]);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CLIENT = fs.readFileSync(fileURLToPath(new URL('./proxy-client.js', import.meta.url)), 'utf8');

// Addresses that are never fetched: this machine, private networks, link-local, carrier-grade NAT (Tailscale), multicast.
function blockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return blockedIp(v.slice(7));
  return v === '::' || v === '::1' || /^(fc|fd|fe[89ab]|ff)/.test(v) || v.startsWith('64:ff9b:') || v.startsWith('2001:db8');
}
const blockedHost = (h) => /(^|\.)(localhost|local|internal|lan|home|arpa|ts\.net|intranet|corp)$/i.test(h) || (net.isIP(h) && blockedIp(h));
// DNS answers are checked too (a public name can point at 127.0.0.1).
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (err, list) => {
    if (err) return cb(err);
    const ok = list.filter((a) => !blockedIp(a.address));
    if (!ok.length) return cb(Object.assign(Error('That address is not allowed.'), { code: 'EBLOCKED' }));
    if (opts?.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

export function createProxy({ accounts, log = () => {}, banned = () => null }) {
  const sessions = new Map();   // token -> { user, exp, jar: Map(host -> Map(name -> value)) }
  const usage = new Map();      // user -> { day, bytes, minute, count }
  let active = 0;
  const now = () => Date.now();
  setInterval(() => { for (const [t, s] of sessions) if (s.exp < now()) sessions.delete(t); }, 600e3).unref();

  const allow = (user, bytes = 0) => {
    const d = Math.floor(now() / 86400e3), m = Math.floor(now() / 60e3);
    let u = usage.get(user); if (!u || u.day !== d) { u = { day: d, bytes: 0, minute: m, count: 0 }; usage.set(user, u); }
    if (u.minute !== m) { u.minute = m; u.count = 0; }
    u.bytes += bytes;
    if (!bytes) u.count++;
    return u.bytes <= DAY_BYTES && u.count <= PER_MIN;
  };
  const sessionOf = (token) => { const s = sessions.get(String(token ?? '')); return s && s.exp > now() ? s : null; };

  // Cookies the sites set, kept for this proxy session only (never sent to or from the player's own browser).
  const jarFor = (s, host) => { for (const [h, m] of s.jar) if (host === h || host.endsWith('.' + h)) return m; return null; };
  function cookieHeader(s, host) {
    const out = [];
    for (const [h, m] of s.jar) if (host === h || host.endsWith('.' + h)) for (const [k, v] of m) out.push(`${k}=${v}`);
    return out.join('; ');
  }
  function keepCookies(s, host, set) {
    for (const c of [].concat(set ?? [])) {
      const [pair, ...attrs] = String(c).split(';'), eq = pair.indexOf('=');
      if (eq < 1) continue;
      const domain = (attrs.map((a) => /^\s*domain=\.?(.+)$/i.exec(a)?.[1]).find(Boolean) ?? host).toLowerCase();
      if (host !== domain && !host.endsWith('.' + domain)) continue;
      const m = jarFor(s, domain) ?? s.jar.set(domain, new Map()).get(domain);
      const expired = attrs.some((a) => /^\s*max-age=(-|0\b)/i.test(a) || (/^\s*expires=/i.test(a) && Date.parse(a.split('=')[1]) < now()));
      if (expired) m.delete(pair.slice(0, eq).trim()); else m.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      if (m.size > 60) m.delete(m.keys().next().value);
    }
    if (s.jar.size > 200) s.jar.delete(s.jar.keys().next().value);
  }

  // One request out. Resolves with the upstream response (not followed: redirects go back to the page, rewritten).
  function upstream(method, target, headers, body) {
    return new Promise((resolve, reject) => {
      const lib = target.protocol === 'https:' ? https : http;
      const r = lib.request(target, { method, headers, lookup: safeLookup, timeout: 30e3 }, resolve);
      r.on('timeout', () => r.destroy(Object.assign(Error('The site took too long to answer.'), { status: 504 })));
      r.on('error', (e) => reject(Object.assign(e, { status: e.code === 'EBLOCKED' ? 403 : e.status ?? 502 })));
      if (body?.length) r.write(body);
      r.end();
    });
  }
  const checkTarget = (u) => {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(Error('Only http and https addresses work here.'), { status: 400 });
    const port = +u.port || (u.protocol === 'https:' ? 443 : 80);
    if (!PORTS.has(port)) throw Object.assign(Error('That port is not allowed.'), { status: 403 });
    if (blockedHost(u.hostname.replace(/^\[|\]$/g, ''))) throw Object.assign(Error('That address is not allowed.'), { status: 403 });
  };
  const readBody = async (req) => { const parts = []; let n = 0; for await (const c of req) { n += c.length; if (n > MAX_BODY) throw Object.assign(Error('Too much to send.'), { status: 413 }); parts.push(c); } return Buffer.concat(parts); };
  const decode = (buf, enc) => {
    enc = String(enc ?? '').toLowerCase();
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buf);
    if (enc === 'deflate') { try { return zlib.inflateSync(buf); } catch { return zlib.inflateRawSync(buf); } }
    if (enc === 'br') return zlib.brotliDecompressSync(buf);
    if (enc === 'zstd' && zlib.zstdDecompressSync) return zlib.zstdDecompressSync(buf);
    return buf;
  };

  // ---- Rewriting (pages through /p/) ----
  const prefixOf = (token) => `/p/${token}/`;
  const proxied = (token, abs) => {
    const u = new URL(abs);
    return `${prefixOf(token)}${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}${u.hash}`;
  };
  const rewriteUrl = (token, base, raw) => {
    const v = String(raw).trim();
    if (!v || /^(#|data:|blob:|javascript:|mailto:|tel:|about:|sms:)/i.test(v) || v.startsWith(prefixOf(token))) return raw;
    try { const u = new URL(v.replace(/&amp;/g, '&'), base); return /^https?:$/.test(u.protocol) ? proxied(token, u.href) : raw; } catch { return raw; }
  };
  const rewriteCss = (token, base, css) => css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url(${q}${rewriteUrl(token, base, u)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${rewriteUrl(token, base, u)}${q}`);
  const ATTRS = /(\s(?:href|src|action|formaction|poster|data|background|manifest|ping|longdesc|cite|lowsrc|data-src|data-href)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
  function rewriteHtml(token, base, html) {
    // A <base href> changes what relative links mean; the page keeps working from the address it really has.
    const b = /<base\s[^>]*href\s*=\s*["']?([^"'\s>]+)/i.exec(html);
    if (b) { try { base = new URL(b[1], base).href; } catch { /* keep */ } }
    const att = (q, v) => `"${String(v).replace(/"/g, '&quot;')}"`;
    let out = html
      .replace(/<base\s[^>]*>/gi, '')
      .replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, '')
      .replace(/\s(integrity|nonce)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(<(?:a|area|form)\b[^>]*?\s)target\s*=\s*["']?_(?:top|parent|blank)["']?/gi, '$1target="_self"')
      .replace(/<([a-z][a-z0-9-]*)\b[^>]*>/gi, (tag) => tag
        .replace(ATTRS, (m, pre, all, d, s, u) => pre + att(null, rewriteUrl(token, base, d ?? s ?? u)))
        .replace(/(\s(?:srcset|imagesrcset)\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre, all, d, s) => pre + att(null, (d ?? s).split(',').map((p) => { const [u, ...w] = p.trim().split(/\s+/); return [rewriteUrl(token, base, u), ...w].join(' '); }).join(', ')))
        .replace(/(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre, all, d, s) => pre + att(null, rewriteCss(token, base, (d ?? s).replace(/&quot;/g, '"')))))
      .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, c) => a + rewriteCss(token, base, css) + c)
      .replace(/(<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']\s*\d+\s*;\s*url\s*=\s*)([^"']+)/gi, (m, pre, u) => pre + rewriteUrl(token, base, u));
    const boot = `<script>window.__gwProxy=${JSON.stringify({ token, base, prefix: prefixOf(token) }).replace(/</g, '\\u003c')};</script><script src="/proxy/client.js"></script>`;
    if (/<head\b[^>]*>/i.test(out)) out = out.replace(/<head\b[^>]*>/i, (h) => h + boot);
    else if (/<html\b[^>]*>/i.test(out)) out = out.replace(/<html\b[^>]*>/i, (h) => h + boot);
    else out = boot + out;
    return out;
  }

  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Timing-Allow-Origin': '*' };
  const KEEP = ['content-type', 'cache-control', 'expires', 'etag', 'last-modified', 'content-range', 'accept-ranges', 'content-disposition', 'content-language', 'vary'];
  const fail = (res, status, msg, html = false) => {
    if (res.headersSent) return res.destroy();
    if (html) {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...CORS, 'Cross-Origin-Embedder-Policy': 'credentialless' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Can't open this page</title><body style="font:14px Tahoma,Verdana,sans-serif;padding:24px;color:#333"><h2 style="margin:0 0 8px">Can't open this page</h2><p>${msg.replace(/[<&]/g, (c) => ({ '<': '&lt;', '&': '&amp;' }[c]))}</p></body>`);
    }
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS }); res.end(JSON.stringify({ error: msg }));
  };

  // A proxied request, either kind. `page`: rewrite HTML/CSS and redirects for the Browser tab.
  async function forward(req, res, { s, target, page, ip }) {
    checkTarget(target);
    if (!allow(s.user)) return fail(res, 429, 'Too many requests through the proxy. Wait a minute.', page);
    if (active >= 96) return fail(res, 503, 'The proxy is busy. Try again in a moment.', page);
    const body = ['GET', 'HEAD'].includes(req.method) ? null : await readBody(req);
    const h = { 'user-agent': UA, accept: req.headers.accept ?? '*/*', 'accept-language': req.headers['accept-language'] ?? 'en-US,en;q=0.9', 'accept-encoding': 'gzip, deflate, br' };
    for (const k of ['content-type', 'range', 'if-none-match', 'if-modified-since', 'cache-control']) if (req.headers[k]) h[k] = req.headers[k];
    if (!page) for (const [k, v] of Object.entries(req.headers)) if (/^x-/i.test(k) && !/^x-(proxy-token|user|forwarded|real-ip|admin)/i.test(k)) h[k] = v;
    const cookie = cookieHeader(s, target.hostname); if (cookie) h.cookie = cookie;
    // The site sees itself as the referrer and origin (pages often check), never this hub or the player's address.
    const ref = req.headers.referer && page ? realUrl(req.headers.referer, s) : null;
    if (ref) h.referer = ref;
    if (body && page) h.origin = target.origin;
    active++;
    let up;
    try { up = await upstream(req.method, target, h, body); } finally { active--; }
    keepCookies(s, target.hostname, up.headers['set-cookie']);
    const out = { ...CORS };
    for (const k of KEEP) if (up.headers[k]) out[k] = up.headers[k];
    if (up.headers.location) {
      try { const loc = new URL(up.headers.location, target); out.location = page ? proxied(s.token, loc.href) : loc.href; } catch { /* drop it */ }
    }
    const type = String(up.headers['content-type'] ?? '').toLowerCase();
    const html = page && /text\/html|application\/xhtml/.test(type), css = page && /text\/css/.test(type);
    if (page) out['Cross-Origin-Embedder-Policy'] = 'credentialless';
    if (html) log(`proxy: ${s.user} ${ip} -> ${target.host}${target.pathname.slice(0, 60)}`);
    if ((html || css) && req.method !== 'HEAD') {
      const parts = []; let n = 0;
      for await (const c of up) { n += c.length; if (n > MAX_REWRITE) { up.destroy(); return fail(res, 413, 'That page is too large.', page); } parts.push(c); }
      let text;
      try { text = decode(Buffer.concat(parts), up.headers['content-encoding']).toString('utf8'); } catch { return fail(res, 502, 'The site sent something unreadable.', page); }
      const base = target.href;
      const result = Buffer.from(html ? rewriteHtml(s.token, base, text) : rewriteCss(s.token, base, text));
      allow(s.user, result.length);
      out['content-type'] = html ? 'text/html; charset=utf-8' : 'text/css; charset=utf-8';
      out['content-length'] = result.length;
      res.writeHead(up.statusCode, out); return res.end(result);
    }
    // Anything else streams through as it came (still compressed if it was).
    if (up.headers['content-encoding']) out['content-encoding'] = up.headers['content-encoding'];
    if (up.headers['content-length']) out['content-length'] = up.headers['content-length'];
    res.writeHead(up.statusCode, out);
    let n = 0;
    up.on('data', (c) => { n += c.length; if (n > MAX_RESPONSE || !allow(s.user, c.length)) { up.destroy(); res.destroy(); } });
    up.pipe(res);
    res.on('close', () => up.destroy());
  }
  // /p/<token>/https/host/path -> https://host/path
  function realUrl(proxiedUrl, s) {
    try {
      const u = new URL(proxiedUrl, 'http://x'), m = /^\/p\/([A-Za-z0-9_-]+)\/(https?)\/([^/]+)(\/.*)?$/.exec(u.pathname);
      if (!m || (s && m[1] !== s.token)) return null;
      return `${m[2]}://${m[3]}${m[4] ?? '/'}${u.search}`;
    } catch { return null; }
  }

  return async function handle(req, res, { ip, headers = {} }) {
    const url = new URL(req.url, 'http://x');
    const isPage = url.pathname.startsWith('/p/'), isCors = url.pathname === '/cors', isApi = url.pathname.startsWith('/proxy/');
    if (!isPage && !isCors && !isApi) return false;
    const h = { ...headers, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS', 'Access-Control-Max-Age': '600' };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...h, 'Access-Control-Allow-Origin': '*' }).end(); return true; }
    try {
      if (!ON) return fail(res, 503, 'The web proxy is turned off on this hub.', isPage), true;
      if (url.pathname === '/proxy/client.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...CORS });
        return res.end(CLIENT), true;
      }
      if (url.pathname === '/proxy/session' && req.method === 'POST') {
        const user = accounts.userOf(req);
        if (!user) return fail(res, 401, 'Sign in to a Garry\'s Web account to use the browser.'), true;
        if (banned({ ip, account: user })) return fail(res, 403, 'You are banned.'), true;
        const token = crypto.randomBytes(18).toString('base64url');
        sessions.set(token, { token, user, exp: now() + SESSION_MS, jar: new Map() });
        for (const [t, x] of sessions) if (x.user === user && t !== token && [...sessions.values()].filter((y) => y.user === user).length > 3) sessions.delete(t);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h });
        return res.end(JSON.stringify({ token, expires: now() + SESSION_MS, prefix: prefixOf(token) })), true;
      }
      if (isPage) {
        const m = /^\/p\/([A-Za-z0-9_-]+)\/(https?)\/([^/?#]+)(\/[^?#]*)?$/.exec(url.pathname);
        const s = m && sessionOf(m[1]);
        if (!s) return fail(res, 401, 'This browser session ended. Open the address again from the Browser tab.', true), true;
        let target;
        try { target = new URL(`${m[2]}://${m[3]}${m[4] ?? '/'}${url.search}`); } catch { return fail(res, 400, 'That address is not valid.', true), true; }
        await forward(req, res, { s, target, page: true, ip });
        return true;
      }
      if (isCors) {
        const tok = req.headers['x-proxy-token'] ?? url.searchParams.get('token');
        let s = sessionOf(tok);
        if (!s) { const user = accounts.userOf(req); if (user) s = { token: '', user, jar: new Map() }; }
        if (!s) return fail(res, 401, 'Sign in (or send X-Proxy-Token) to use the proxy.'), true;
        let target;
        try { target = new URL(url.searchParams.get('url') ?? ''); } catch { return fail(res, 400, 'Add ?url=https://...'), true; }
        await forward(req, res, { s, target, page: false, ip });
        return true;
      }
      return fail(res, 404, 'Not found'), true;
    } catch (e) {
      fail(res, e.status ?? 502, e.code === 'ENOTFOUND' ? 'That site could not be found.' : e.code === 'ECONNREFUSED' ? 'That site refused the connection.' : String(e.message ?? e), isPage);
      return true;
    }
  };
}
