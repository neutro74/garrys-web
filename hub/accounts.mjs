// Accounts: a username and password, and one settings document per account (name, colour, player id, game versions, the
// addon library list...) that the launcher keeps in step across browsers (web/account.js). Passwords are stored as scrypt
// hashes; sessions are random tokens of which only a SHA-256 is kept.
//   POST /acct/register {user, pass}  -> {token, user, doc}
//   POST /acct/login    {user, pass}  -> {token, user, doc}
//   GET  /acct/me                     -> {user, doc}            (Authorization: Bearer <token>)
//   PUT  /acct/me       {doc}         -> {updated}
//   POST /acct/logout                 -> {}
//   POST /acct/password {old, pass}   -> {}
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const USER = /^[a-z0-9_]{3,20}$/;
export function createAccounts({ dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'accounts') } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const fails = new Map();   // ip -> [timestamps] of failed logins / registrations
  const file = (u) => path.join(dir, u + '.json');
  const read = (u) => { try { return JSON.parse(fs.readFileSync(file(u), 'utf8')); } catch { return null; } };
  const write = (a) => { const tmp = file(a.user) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(a)); fs.renameSync(tmp, file(a.user)); };
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  const throttled = (ip) => (fails.get(ip) ?? []).filter((t) => Date.now() - t < 900e3).length >= 10;
  const failed = (ip) => fails.set(ip, [...(fails.get(ip) ?? []).filter((t) => Date.now() - t < 900e3), Date.now()]);
  const newToken = (a) => { const t = crypto.randomBytes(32).toString('base64url'); a.tokens = [...(a.tokens ?? []).slice(-19), { h: sha(t), at: Date.now() }]; return t; };
  const auth = (req) => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? ''), u = String(req.headers['x-user'] ?? '').toLowerCase();
    if (!m || !USER.test(u)) return null;
    const a = read(u), h = sha(m[1]);
    return a?.tokens?.some((t) => t.h === h) ? { a, h } : null;
  };
  const json = (res, code, obj, headers) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
  async function body(req, max = 256 * 1024) {
    let s = '';
    for await (const c of req) { s += c; if (s.length > max) throw Object.assign(Error('Too large.'), { status: 413 }); }
    return s ? JSON.parse(s) : {};
  }
  const handle = async function handle(req, res, { ip, headers = {} }) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/acct/')) return false;
    const h = { ...headers, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User', 'Access-Control-Allow-Methods': 'GET, POST, PUT' };
    if (req.method === 'OPTIONS') { res.writeHead(204, h).end(); return true; }
    try {
      const route = `${req.method} ${url.pathname}`;
      if (route === 'POST /acct/register' || route === 'POST /acct/login') {
        if (throttled(ip)) return json(res, 429, { error: 'Too many attempts. Wait a few minutes.' }, h), true;
        const b = await body(req), user = String(b.user ?? '').trim().toLowerCase(), pass = String(b.pass ?? '');
        if (!USER.test(user)) return json(res, 400, { error: 'Usernames are 3 to 20 letters, digits or _.' }, h), true;
        if (pass.length < 6 || pass.length > 200) return json(res, 400, { error: 'Passwords are at least 6 characters.' }, h), true;
        let a = read(user);
        if (route === 'POST /acct/register') {
          if (a) { failed(ip); return json(res, 409, { error: 'That username is taken.' }, h), true; }
          failed(ip);   // registrations count toward the limit too, so one address cannot create accounts in bulk
          const salt = crypto.randomBytes(16).toString('hex');
          a = { user, salt, hash: hashPass(pass, salt), created: Date.now(), doc: {}, updated: 0 };
        } else if (!a || !crypto.timingSafeEqual(Buffer.from(hashPass(pass, a.salt), 'hex'), Buffer.from(a.hash, 'hex'))) {
          failed(ip); return json(res, 401, { error: 'Wrong username or password.' }, h), true;
        }
        const token = newToken(a); write(a);
        return json(res, 200, { token, user, doc: a.doc, updated: a.updated }, h), true;
      }
      const s = auth(req);
      if (!s) return json(res, 401, { error: 'Signed out. Sign in again.' }, h), true;
      if (route === 'GET /acct/me') return json(res, 200, { user: s.a.user, doc: s.a.doc, updated: s.a.updated }, h), true;
      if (route === 'PUT /acct/me') {
        const b = await body(req);
        if (typeof b.doc !== 'object' || !b.doc) return json(res, 400, { error: 'No settings.' }, h), true;
        // The Steam sign-in (web/steam-account.js) is kept when a browser that never had it sends its settings; signing out
        // of Steam sends an explicit "out" entry instead, which does replace it.
        const doc = { ...b.doc }; if (doc.steam == null && s.a.doc?.steam != null) doc.steam = s.a.doc.steam;
        s.a.doc = doc; s.a.updated = Date.now(); write(s.a);
        return json(res, 200, { updated: s.a.updated }, h), true;
      }
      if (route === 'POST /acct/logout') { s.a.tokens = s.a.tokens.filter((t) => t.h !== s.h); write(s.a); return json(res, 200, {}, h), true; }
      if (route === 'POST /acct/password') {
        const b = await body(req), pass = String(b.pass ?? '');
        if (!crypto.timingSafeEqual(Buffer.from(hashPass(String(b.old ?? ''), s.a.salt), 'hex'), Buffer.from(s.a.hash, 'hex'))) { failed(ip); return json(res, 401, { error: 'The current password is wrong.' }, h), true; }
        if (pass.length < 6 || pass.length > 200) return json(res, 400, { error: 'Passwords are at least 6 characters.' }, h), true;
        s.a.salt = crypto.randomBytes(16).toString('hex'); s.a.hash = hashPass(pass, s.a.salt); s.a.tokens = s.a.tokens.filter((t) => t.h === s.h); write(s.a);
        return json(res, 200, {}, h), true;
      }
      json(res, 404, { error: 'Not found' }, h);
    } catch (e) { json(res, e.status ?? 400, { error: String(e.message ?? e) }, h); }
    return true;
  };
  // For the chat socket (private messages): is this a live session token for that user? Does the user exist?
  handle.verify = (user, token) => {
    const u = String(user ?? '').toLowerCase();
    if (!USER.test(u) || !/^[A-Za-z0-9_-]{20,}$/.test(String(token ?? ''))) return null;
    const a = read(u), h = sha(String(token));
    return a?.tokens?.some((t) => t.h === h) ? u : null;
  };
  handle.exists = (user) => USER.test(String(user ?? '')) && fs.existsSync(file(String(user)));
  // For the admin panel (hub/admin.mjs): every account, and signing one out everywhere.
  handle.list = () => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => read(f.slice(0, -5))).filter(Boolean)
    .map((a) => ({ user: a.user, created: a.created ?? 0, updated: a.updated ?? 0, sessions: (a.tokens ?? []).length, lastLogin: Math.max(0, ...(a.tokens ?? []).map((t) => t.at ?? 0)) }))
    .sort((x, y) => y.lastLogin - x.lastLogin);
  handle.signOutAll = (user) => { const a = USER.test(user) && read(user); if (!a) throw Error('No such account.'); a.tokens = []; write(a); };
  return handle;
}
