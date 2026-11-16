// Optional Steam sign-in, for playing on real Garry's Mod servers (they check each player's Steam login with Valve).
//
// The player approves a QR login in the Steam mobile app (steam-session); no password passes through here. The resulting
// refresh token is stored encrypted with a random key that only the player's browser holds, so the files on this machine
// cannot be used without it. When the browser asks for a ticket it sends the key; the token is decrypted in memory, a
// Steam session is logged on "playing" Garry's Mod (steam-user), and an auth session ticket for app 4000 is returned for
// the game to send to the server. The session stays logged on while the browser keeps calling /steam/keepalive.
//
//   POST /steam/qr                  -> { id, url, svg }           start a QR login
//   GET  /steam/qr?id=              -> { state, key?, steamid?, name? }   waiting | done | failed (key only once)
//   POST /steam/ticket   { key }    -> { ticket (base64), steamid }
//   POST /steam/keepalive { key }   -> {}
//   POST /steam/logout   { key }    -> {}                         forgets the token
//
// The Steam packages are loaded on first use, so the rest of the hub runs without them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const APP = 4000, QR_MS = 5 * 60e3, IDLE_MS = 4 * 60e3;

export function createSteamLogin({ dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'steam'), log = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let libs = null;
  const load = async () => libs ??= {
    session: await import('steam-session'),
    SteamUser: (await import('steam-user')).default,
    QR: (await import('qrcode')).default,
  };
  const pending = new Map();   // qr id -> { session, state, ip, at, result }
  const live = new Map();      // key hash -> { client, steamid, seen, ready }
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const file = (key) => path.join(dir, sha('file:' + key) + '.json');
  const cipherKey = (key) => crypto.createHash('sha256').update('enc:' + key).digest();
  function save(key, data) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', cipherKey(key), iv);
    const body = Buffer.concat([c.update(JSON.stringify(data)), c.final()]);
    const tmp = file(key) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), body: body.toString('base64') }), { mode: 0o600 });
    fs.renameSync(tmp, file(key));
  }
  function open(key) {
    try {
      const f = JSON.parse(fs.readFileSync(file(key), 'utf8'));
      const d = crypto.createDecipheriv('aes-256-gcm', cipherKey(key), Buffer.from(f.iv, 'base64'));
      d.setAuthTag(Buffer.from(f.tag, 'base64'));
      return JSON.parse(Buffer.concat([d.update(Buffer.from(f.body, 'base64')), d.final()]).toString('utf8'));
    } catch { return null; }
  }
  const validKey = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(k);

  async function startQr(ip) {
    for (const [id, p] of pending) if (Date.now() - p.at > QR_MS) { p.session?.cancelLoginAttempt?.(); pending.delete(id); }
    if (pending.size >= 50 || [...pending.values()].filter((p) => p.ip === ip).length >= 3) throw Object.assign(Error('Too many sign-ins in progress. Wait a few minutes.'), { status: 429 });
    const { session: S, QR } = await load();
    const session = new S.LoginSession(S.EAuthTokenPlatformType.SteamClient);
    session.loginTimeout = QR_MS;
    const id = crypto.randomBytes(12).toString('base64url'), p = { session, state: 'waiting', ip, at: Date.now() };
    pending.set(id, p);
    session.on('authenticated', () => {
      const key = crypto.randomBytes(32).toString('base64url'), steamid = session.steamID.getSteamID64();
      save(key, { refreshToken: session.refreshToken, steamid, name: session.accountName });
      p.state = 'done'; p.result = { key, steamid, name: session.accountName };
      log(`steam: signed in ${steamid}`);
    });
    session.on('timeout', () => { p.state = 'failed'; p.error = 'The sign-in timed out. Start again.'; });
    session.on('error', (e) => { p.state = 'failed'; p.error = `Steam refused the sign-in (${e.message}).`; });
    const r = await session.startWithQR();
    session.on('remoteInteraction', () => { p.state = 'scanned'; });
    return { id, url: r.qrChallengeUrl, svg: await QR.toString(r.qrChallengeUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
  }
  function qrStatus(id) {
    const p = pending.get(id);
    if (!p) return { state: 'failed', error: 'That sign-in is no longer open. Start again.' };
    if (p.state === 'done') { pending.delete(id); return { state: 'done', ...p.result }; }
    return { state: p.state, error: p.error };
  }

  // One logged-on Steam session per signed-in player, kept while their browser checks in.
  async function session(key) {
    const h = sha(key);
    let s = live.get(h);
    if (s) { s.seen = Date.now(); return s.ready; }
    const data = open(key);
    if (!data) throw Object.assign(Error('Not signed in to Steam on this hub. Sign in again.'), { status: 401 });
    const { SteamUser } = await load();
    const client = new SteamUser({ autoRelogin: true, renewRefreshTokens: true });
    s = { client, steamid: data.steamid, seen: Date.now() };
    s.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(Error('Steam did not answer the sign-in. Try again.'), { status: 504 })), 30e3);
      client.once('loggedOn', () => { clearTimeout(t); client.gamesPlayed([APP]); resolve(s); });
      client.once('error', (e) => {
        clearTimeout(t); live.delete(h);
        if (/InvalidPassword|AccessDenied|Expired|Revoked/i.test(e.message)) fs.rmSync(file(key), { force: true });
        reject(Object.assign(Error(`Steam sign-in failed (${e.message}). Sign in again.`), { status: 401 }));
      });
    });
    client.on('refreshToken', (t) => save(key, { ...data, refreshToken: t }));
    live.set(h, s);
    client.logOn({ refreshToken: data.refreshToken });
    return s.ready;
  }
  setInterval(() => {
    for (const [h, s] of live) if (Date.now() - s.seen > IDLE_MS) { live.delete(h); try { s.client.logOff(); } catch { /* gone */ } }
  }, 30e3).unref();

  async function ticket(key) {
    const s = await session(key);
    const { sessionTicket } = await s.client.createAuthSessionTicket(APP);
    return { ticket: sessionTicket.toString('base64'), steamid: s.steamid };
  }
  function logout(key) {
    const h = sha(key), s = live.get(h);
    if (s) { live.delete(h); try { s.client.logOff(); } catch { /* gone */ } }
    fs.rmSync(file(key), { force: true });
  }

  const json = (res, code, obj, headers) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
  async function body(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 4096) throw Object.assign(Error('Too large.'), { status: 413 }); } return s ? JSON.parse(s) : {}; }
  return async function handle(req, res, { ip, headers = {} }) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/steam/')) return false;
    const h = { ...headers, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' };
    if (req.method === 'OPTIONS') { res.writeHead(204, h).end(); return true; }
    try {
      const route = `${req.method} ${url.pathname}`;
      if (route === 'POST /steam/qr') return json(res, 200, await startQr(ip), h), true;
      if (route === 'GET /steam/qr') return json(res, 200, qrStatus(url.searchParams.get('id') ?? ''), h), true;
      const b = req.method === 'POST' ? await body(req) : {};
      if (!validKey(b.key)) return json(res, 400, { error: 'Missing sign-in key.' }, h), true;
      if (route === 'POST /steam/ticket') return json(res, 200, await ticket(b.key), h), true;
      if (route === 'POST /steam/keepalive') { await session(b.key); return json(res, 200, {}, h), true; }
      if (route === 'POST /steam/logout') { logout(b.key); return json(res, 200, {}, h), true; }
      json(res, 404, { error: 'Not found' }, h);
    } catch (e) { json(res, e.status ?? 500, { error: String(e.message ?? e) }, h); }
    return true;
  };
}
