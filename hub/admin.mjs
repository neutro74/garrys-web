// Admin panel backend: bans (by IP, browser or account), mutes, chat moderation, lobby control, hub status, and a terminal
// on the Pi. Only accounts listed in ADMIN_USERS (default "neutro74") can use it, and only after unlocking with a code
// from an authenticator app; the app's secret is created on the Pi itself (`node admin.mjs enroll <user>`), so knowing an
// admin's password is not enough to enroll a new authenticator.
//
//   GET  /admin/whoami                 (account token)  -> {admin, enrolled}
//   POST /admin/unlock {code}          (account token)  -> {token, expires}      then every call sends X-Admin: <token>
//   POST /admin/lock
//   GET  /admin/state                                   -> status, online and recent players, bans, mutes, lobbies, log...
//   POST /admin/<action> {...}                          -> ban, unban, mute, unmute, kick, delete, clear, announce,
//                                                          close-lobby, signout-account, restart
//   WebSocket /admin/term: first text frame {t:'auth', token}, then {t:'in', d} / {t:'size', rows, cols}; output arrives as
//   binary frames. It runs hub/term-pty.py, which opens ssh to ADMIN_SSH_TARGET (default davidc@127.0.0.1) in a pty.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const STATE_DIR = path.join(process.env.WS_CACHE ?? './ws-cache', 'admin');
const ADMINS = new Set((process.env.ADMIN_USERS ?? 'neutro74').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const SSH_TARGET = process.env.ADMIN_SSH_TARGET ?? 'davidc@127.0.0.1';
const SESSION_MAX = 8 * 3600e3, SESSION_IDLE = 3600e3;
const USER = /^[a-z0-9_]{3,20}$/;

// ---- TOTP (RFC 6238: SHA-1, 6 digits, 30 s) -------------------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32encode = (buf) => { let bits = 0, v = 0, out = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(v << (5 - bits)) & 31]; return out; };
const b32decode = (s) => { let bits = 0, v = 0; const out = []; for (const ch of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
function hotp(key, counter) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(c).digest(), o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const totpFile = (u) => path.join(STATE_DIR, 'totp', u + '.json');
const readTotp = (u) => { try { return JSON.parse(fs.readFileSync(totpFile(u), 'utf8')); } catch { return null; } };

// ---- Small persistent stores ----------------------------------------------------------------------------------------
function jsonStore(name, init) {
  const f = path.join(STATE_DIR, name);
  let v; try { v = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { v = init; }
  return { get: () => v, set: (nv) => { v = nv; const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, f); } };
}

// The last lines the hub printed, for the Hub tab (journalctl needs root; this needs nothing).
const logRing = [];
for (const k of ['log', 'error', 'warn']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => {
    orig(...a);
    logRing.push({ at: Date.now(), level: k, text: a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 2000) });
    if (logRing.length > 300) logRing.shift();
  };
}

export function createAdmin({ accounts, hub }) {
  fs.mkdirSync(path.join(STATE_DIR, 'totp'), { recursive: true, mode: 0o700 });
  const bans = jsonStore('bans.json', []), mutes = jsonStore('mutes.json', []);
  const auditFile = path.join(STATE_DIR, 'audit.jsonl');
  const sessions = new Map();          // sha(token) -> {user, at, seen}
  const fails = new Map();             // user -> [timestamps] of wrong codes
  const lastCounter = new Map();       // user -> last accepted TOTP step (a code works once)
  const recent = [];                   // players seen lately (newest last)
  const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
  const now = () => Date.now();
  const live = (list) => list.filter((x) => !x.until || x.until > now());
  const audit = (who, action, detail) => { try { fs.appendFileSync(auditFile, JSON.stringify({ at: now(), who, action, ...detail }) + '\n'); } catch { /* disk */ } };
  const auditTail = (n = 100) => { try { return fs.readFileSync(auditFile, 'utf8').trim().split('\n').slice(-n).map((l) => JSON.parse(l)).reverse(); } catch { return []; } };

  // Does a ban/mute entry cover this player? An entry names any of ip, device (the browser's player id) and account.
  const covers = (e, p) => (e.ip && e.ip === p.ip) || (e.device && e.device === p.device) || (e.account && e.account === p.account);
  const banned = (p) => live(bans.get()).find((e) => covers(e, p)) ?? null;
  const muted = (p) => live(mutes.get()).find((e) => covers(e, p)) ?? null;
  const banInfo = (b) => ({ reason: b.reason || '', until: b.until || 0 });

  // Players: the hub reports joins and changes; the list keeps the last 300 for the Players tab.
  const seen = (c) => {
    let r = recent.find((x) => x.id === c.id);
    if (!r) { r = { id: c.id, first: now() }; recent.push(r); if (recent.length > 300) recent.shift(); }
    Object.assign(r, { name: c.name, ip: c.ip, device: c.device ?? null, account: c.account ?? null, last: now(), left: c.closed ? now() : null });
  };

  const verifyCode = (u, code) => {
    const t = readTotp(u); if (!t || !/^\d{6}$/.test(String(code))) return false;
    const key = b32decode(t.secret), step = Math.floor(now() / 30e3);
    for (const w of [0, -1, 1]) {
      const c = step + w;
      if (c > (lastCounter.get(u) ?? 0) && crypto.timingSafeEqual(Buffer.from(hotp(key, c)), Buffer.from(String(code)))) { lastCounter.set(u, c); return true; }
    }
    return false;
  };
  const accountOf = (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    return m ? accounts.verify(req.headers['x-user'], m[1]) : null;
  };
  const session = (token) => {
    if (!token) return null;
    const s = sessions.get(sha(token));
    if (!s || now() - s.at > SESSION_MAX || now() - s.seen > SESSION_IDLE || !ADMINS.has(s.user)) { if (s) sessions.delete(sha(token)); return null; }
    s.seen = now(); return s;
  };

  const json = (res, code, obj, h) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }); res.end(JSON.stringify(obj)); };
  async function body(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 64 * 1024) throw Error('Too large.'); } return s ? JSON.parse(s) : {}; }
  const minutes = (m) => (+m > 0 ? now() + Math.min(+m, 525600 * 10) * 60e3 : 0);
  const target = (t = {}) => {
    const e = {};
    if (t.ip) {
      e.ip = String(t.ip).slice(0, 64);
      // If the tunnel ever stops passing the player's address, everyone shares one of these: banning it would ban everybody.
      if (/^(127\.|::1$|::ffff:127\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|10\.|192\.168\.|fd7a:)/.test(e.ip)) throw Error(`${e.ip} is a local or tunnel address (shared by everyone behind it), not a player's. Ban by browser id or account instead.`);
    }
    if (t.device) e.device = String(t.device).slice(0, 32);
    if (t.account) { const a = String(t.account).toLowerCase(); if (!USER.test(a)) throw Error('Bad account name.'); e.account = a; }
    if (!e.ip && !e.device && !e.account) throw Error('Name an IP address, browser id or account.');
    return e;
  };

  function state() {
    const mem = process.memoryUsage();
    return {
      status: {
        uptime: process.uptime(), started: now() - process.uptime() * 1e3, node: process.version, rss: mem.rss, heap: mem.heapUsed,
        load: os.loadavg(), sysMem: { total: os.totalmem(), free: os.freemem() }, sysUptime: os.uptime(), temp: cpuTemp(), ...hub.counts(),
      },
      online: hub.clients().map((c) => ({ id: c.id, name: c.name, ip: c.ip, device: c.device ?? null, account: c.account ?? null, rooms: [...c.rooms], since: c.since })),
      recent: recent.slice().reverse(),
      bans: live(bans.get()), mutes: live(mutes.get()),
      lobbies: hub.lobbies(),
      accounts: accounts.list(),
      rooms: hub.roomNames(),
      log: logRing.slice(-200),
      audit: auditTail(),
      admins: [...ADMINS], sshTarget: SSH_TARGET,
    };
  }
  const cpuTemp = () => { try { return +fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8') / 1000; } catch { return null; } };

  const actions = {
    ban(b, who) {
      const e = { id: crypto.randomBytes(5).toString('hex'), ...target(b.target), reason: String(b.reason ?? '').slice(0, 200), until: minutes(b.minutes), by: who, at: now(), label: String(b.label ?? '').slice(0, 40) };
      bans.set([...live(bans.get()), e]);
      const n = hub.kickWhere((p) => covers(e, p), { t: 'banned', ...banInfo(e) });
      return { ban: e, kicked: n };
    },
    unban(b) { bans.set(live(bans.get()).filter((e) => e.id !== b.id)); return {}; },
    mute(b, who) {
      const e = { id: crypto.randomBytes(5).toString('hex'), ...target(b.target), reason: String(b.reason ?? '').slice(0, 200), until: minutes(b.minutes || 60), by: who, at: now(), label: String(b.label ?? '').slice(0, 40) };
      mutes.set([...live(mutes.get()), e]); return { mute: e };
    },
    unmute(b) { mutes.set(live(mutes.get()).filter((e) => e.id !== b.id)); return {}; },
    kick(b) { return { kicked: hub.kickWhere((p) => p.id === String(b.id), { t: 'kicked', reason: String(b.reason ?? '').slice(0, 200) }) }; },
    delete(b) { hub.deleteMessage(String(b.room), String(b.id)); return {}; },
    clear(b) { hub.clearRoom(String(b.room)); return {}; },
    announce(b) { const text = String(b.text ?? '').trim().slice(0, 400); if (!text) throw Error('Write a message.'); return { sent: hub.announce(text) }; },
    'close-lobby'(b) { hub.closeLobby(String(b.id)); return {}; },
    'signout-account'(b) { accounts.signOutAll(String(b.user ?? '').toLowerCase()); return {}; },
    restart(b, who) { setTimeout(() => { console.log(`admin: restart requested by ${who}`); process.exit(0); }, 300); return { restarting: true }; },   // systemd starts it again
  };

  const handle = async (req, res, { ip, headers = {} }) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/admin/')) return false;
    const h = { ...headers, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User, X-Admin', 'Access-Control-Allow-Methods': 'GET, POST' };
    if (req.method === 'OPTIONS') { res.writeHead(204, h).end(); return true; }
    try {
      const route = url.pathname.slice('/admin/'.length);
      if (route === 'whoami') { const u = accountOf(req); return json(res, 200, { admin: !!u && ADMINS.has(u), enrolled: !!u && ADMINS.has(u) && !!readTotp(u) }, h), true; }
      if (route === 'unlock' && req.method === 'POST') {
        const u = accountOf(req);
        if (!u || !ADMINS.has(u)) return json(res, 403, { error: 'Not an admin account.' }, h), true;
        if (!readTotp(u)) return json(res, 403, { error: 'No authenticator is set up for this account yet. It is set up on the Pi.' }, h), true;
        const f = (fails.get(u) ?? []).filter((t) => now() - t < 900e3);
        if (f.length >= 5) return json(res, 429, { error: 'Too many wrong codes. Wait 15 minutes.' }, h), true;
        const b = await body(req);
        if (!verifyCode(u, String(b.code ?? '').replace(/\s/g, ''))) { fails.set(u, [...f, now()]); audit(u, 'unlock-failed', { ip }); return json(res, 401, { error: 'Wrong code.' }, h), true; }
        fails.delete(u);
        const token = crypto.randomBytes(32).toString('base64url');
        sessions.set(sha(token), { user: u, at: now(), seen: now() });
        audit(u, 'unlock', { ip });
        return json(res, 200, { token, expires: now() + SESSION_MAX }, h), true;
      }
      const s = session(req.headers['x-admin']);
      if (!s) return json(res, 401, { error: 'Admin session expired. Unlock again.' }, h), true;
      if (route === 'lock') { sessions.delete(sha(req.headers['x-admin'])); return json(res, 200, {}, h), true; }
      if (route === 'state' && req.method === 'GET') return json(res, 200, state(), h), true;
      const act = actions[route];
      if (!act || req.method !== 'POST') return json(res, 404, { error: 'No such admin action.' }, h), true;
      const b = await body(req), r = act(b, s.user);
      audit(s.user, route, { ip, ...b });
      return json(res, 200, r, h), true;
    } catch (e) { json(res, 400, { error: String(e.message ?? e) }, h); }
    return true;
  };

  // The terminal: a WebSocket (Conn from hub.mjs) that must sign in with an admin session before anything runs.
  const terms = new Set();
  handle.terminal = (c) => {
    let proc = null;
    const timer = setTimeout(() => { if (!proc) c.close(1008); }, 10e3);
    c.onText = (text) => {
      let m; try { m = JSON.parse(text); } catch { return; }
      if (!proc) {
        const s = m.t === 'auth' && session(m.token);
        if (!s) { c.send({ t: 'error', error: 'Admin session expired. Unlock again.' }); return c.close(1008); }
        if (terms.size >= 3) { c.send({ t: 'error', error: 'Three terminals are already open.' }); return c.close(1008); }
        clearTimeout(timer);
        const key = path.join(STATE_DIR, 'id_ed25519');
        proc = spawn('python3', [fileURLToPath(new URL('./term-pty.py', import.meta.url)), key, path.join(STATE_DIR, 'known_hosts'), SSH_TARGET, String(m.rows | 0 || 24), String(m.cols | 0 || 80)],
          { stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME ?? STATE_DIR, TERM: 'xterm-256color', LANG: 'C.UTF-8' } });
        terms.add(c); audit(s.user, 'terminal-open', { ip: c.ip });
        // Lots of output at once (cat on a big file): pause the shell until the socket drains rather than drop bytes.
        proc.stdout.on('data', (d) => {
          c.sendBinary(d);
          if (c.socket.writableLength > 1 << 20) { proc.stdout.pause(); c.socket.once('drain', () => proc.stdout.resume()); }
        });
        proc.stderr.on('data', (d) => c.sendBinary(d));
        proc.on('exit', (code) => { terms.delete(c); c.send({ t: 'exit', code }); setTimeout(() => c.close(1000), 200); });
        proc.on('error', (e) => c.send({ t: 'error', error: e.message }));
        c.send({ t: 'ready', target: SSH_TARGET });
        return;
      }
      if (m.t === 'in' && typeof m.d === 'string') proc.stdin.write(m.d);
      else if (m.t === 'size') proc.stdio[3].write(`${Math.max(2, Math.min(500, m.rows | 0))} ${Math.max(2, Math.min(1000, m.cols | 0))}\n`);
    };
    c.onClose = () => { clearTimeout(timer); terms.delete(c); if (proc && proc.exitCode === null) proc.kill('SIGHUP'); };
  };

  handle.banned = banned;
  handle.muted = muted;
  handle.banInfo = banInfo;
  handle.seen = seen;
  return handle;
}

// Enroll an authenticator, on the Pi: WS_CACHE=/var/lib/gmod-hub node admin.mjs enroll neutro74 [--force]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, user, flag] = process.argv.slice(2);
  if (cmd !== 'enroll' || !USER.test(String(user))) { console.error('usage: node admin.mjs enroll <user> [--force]'); process.exit(2); }
  fs.mkdirSync(path.join(STATE_DIR, 'totp'), { recursive: true, mode: 0o700 });
  if (readTotp(user) && flag !== '--force') { console.error(`${user} already has an authenticator (use --force to replace it).`); process.exit(1); }
  const secret = b32encode(crypto.randomBytes(20));
  fs.writeFileSync(totpFile(user), JSON.stringify({ secret, at: Date.now() }), { mode: 0o600 });
  console.log(`otpauth://totp/${encodeURIComponent("Garry's Web")}:${user}?secret=${secret}&issuer=${encodeURIComponent("Garry's Web")}&digits=6&period=30`);
}
