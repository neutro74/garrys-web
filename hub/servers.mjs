// Real Garry's Mod servers for the browser build: the list, and a UDP relay to play on them.
//
// List: Steam's master list for app 4000 (IGameServersService/GetServerList, needs STEAM_KEY), refreshed every 5 minutes,
// then every server is asked for A2S_INFO from here. That gives what the master list lacks (description, password flag,
// real player counts) and the round trip from this machine, which is the part of the ping a relayed player pays on top
// of their own trip to the hub.
//   GET /servers                 -> { at, servers: [[addr, name, map, players, max, bots, gm, workshop, loc, gmcat, ver,
//                                                    desc, pass, ping]...] }
//   GET /servers/info?addr=ip:p  -> one server, asked now (for "find server at address"); it is then allowed through the relay
//   GET /servers/players?addr=   -> [{ name, score, time }]
//
// Relay (WebSocket /udp, binary frames). A browser cannot send UDP, so game packets travel over the WebSocket and leave
// from here. Page -> hub: [u16 local port][u32 ip][u16 port][payload]; hub -> page: [u32 ip][u16 port][u16 local port][payload].
// Only addresses known to be Garry's Mod servers (listed, or answering A2S_INFO as garrysmod) are reachable, so this cannot
// be used to send traffic anywhere else, and each connection has a bandwidth cap.
import dgram from 'node:dgram';
import zlib from 'node:zlib';

const LIST_MS = 300e3, KEY = process.env.STEAM_KEY ?? '';
const RELAY = { perConnBytesPerSec: 1 << 20, sockets: 4, idleMs: 120e3 };
const A2S_INFO = Buffer.concat([Buffer.from([255, 255, 255, 255, 0x54]), Buffer.from('Source Engine Query\0')]);
const ipNum = (s) => s.split('.').reduce((a, b) => ((a << 8) | (+b & 255)) >>> 0, 0);
const ipStr = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const splitAddr = (a) => { const m = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(String(a ?? '')); return m ? { ip: m[1], port: +m[2] } : null; };
const publicIp = (ip) => { const [a, b] = ip.split('.').map(Number); return !(a === 10 || a === 127 || a === 0 || a >= 224 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b < 32) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b < 128)); };

function parseInfo(b) {
  let at = 6;
  const str = () => { const e = b.indexOf(0, at); const s = b.toString('utf8', at, e < 0 ? b.length : e); at = e < 0 ? b.length : e + 1; return s; };
  const name = str(), map = str(), folder = str(), game = str();
  const appid = b.readUInt16LE(at); at += 2;
  const players = b[at++], max = b[at++], bots = b[at++]; at += 2;
  const pass = b[at++] === 1; at++;
  const version = str();
  return { name, map, folder, game, appid, players, max, bots, pass, version };
}

export function createServers({ log = () => {} } = {}) {
  let list = new Map(), at = 0, body = null, gz = null;       // addr -> server
  const allowed = new Map();                                // addr -> expiry, for addresses checked on demand
  const sock = dgram.createSocket('udp4');
  const waiting = new Map();                                // addr -> { sent, resolve, kind }
  sock.on('message', (msg, rinfo) => {
    const addr = `${rinfo.address}:${rinfo.port}`, w = waiting.get(addr);
    if (!w || msg.length < 5 || msg.readInt32LE(0) !== -1) return;
    const type = msg[4];
    w.rtt ??= Date.now() - w.sent;
    if (type === 0x41 && msg.length >= 9) {               // challenge: ask again with it
      const ch = msg.subarray(5, 9);
      sock.send(w.kind === 'info' ? Buffer.concat([A2S_INFO, ch]) : Buffer.concat([Buffer.from([255, 255, 255, 255, 0x55]), ch]), rinfo.port, rinfo.address);
      return;
    }
    if (w.kind === 'info' && type === 0x49) { waiting.delete(addr); try { w.resolve({ ...parseInfo(msg), ping: w.rtt }); } catch { w.resolve(null); } }
    if (w.kind === 'players' && type === 0x44) {
      waiting.delete(addr);
      const out = []; let p = 6;
      try {
        for (let i = 0, n = msg[5]; i < n && p < msg.length; i++) {
          p++; const e = msg.indexOf(0, p); const name = msg.toString('utf8', p, e); p = e + 1;
          out.push({ name, score: msg.readInt32LE(p), time: msg.readFloatLE(p + 4) }); p += 8;
        }
      } catch { /* truncated */ }
      w.resolve(out);
    }
  });
  sock.bind(0);
  function ask(addr, kind, ms = 2500) {
    const a = splitAddr(addr);
    if (!a || !publicIp(a.ip)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const prev = waiting.get(addr); if (prev) prev.resolve(null);
      waiting.set(addr, { sent: Date.now(), resolve, kind });
      sock.send(kind === 'info' ? A2S_INFO : Buffer.from([255, 255, 255, 255, 0x55, 255, 255, 255, 255]), a.port, a.ip);
      setTimeout(() => { if (waiting.get(addr)?.resolve === resolve) { waiting.delete(addr); resolve(null); } }, ms);
    });
  }

  const tag = (tags, k) => (` ${tags} `.match(new RegExp(` ${k}:(\\S+)`)) ?? [])[1] ?? '';
  async function refresh() {
    if (!KEY) return;
    try {
      const r = await fetch(`https://api.steampowered.com/IGameServersService/GetServerList/v1/?key=${KEY}&limit=20000&filter=%5Cappid%5C4000`);
      const servers = (await r.json()).response?.servers ?? [];
      const next = new Map();
      for (const s of servers) {
        if (s.gamedir !== 'garrysmod' || !splitAddr(s.addr)) continue;
        const old = list.get(s.addr), t = s.gametype ?? '';
        next.set(s.addr, { addr: s.addr, name: s.name, map: s.map, players: s.players, max: s.max_players, bots: s.bots, gm: tag(t, 'gm'), ws: tag(t, 'gmws'),
          loc: tag(t, 'loc'), gmc: tag(t, 'gmc'), ver: s.version, desc: old?.desc ?? '', pass: old?.pass ?? false, ping: old?.ping ?? 0 });
      }
      list = next; at = Date.now(); publish();
      log(`servers: ${list.size} listed`);
      // Ask each one directly, a few hundred a second, for the details and the round trip.
      const addrs = [...list.keys()];
      for (let i = 0; i < addrs.length; i += 40) {
        await Promise.all(addrs.slice(i, i + 40).map(async (addr) => {
          const info = await ask(addr, 'info', 2000), s = list.get(addr);
          if (!s) return;
          if (!info) { s.ping = s.ping || 0; return; }
          Object.assign(s, { desc: info.game, pass: info.pass, players: info.players, max: info.max, bots: info.bots, map: info.map || s.map, ping: info.ping });
        }));
        if (i % 1000 === 0) publish();   // pings show up as they come in
      }
      publish();
    } catch (e) { log(`servers: refresh failed: ${e.message}`); }
  }
  function publish() {
    const rows = [...list.values()].map((s) => [s.addr, s.name, s.map, s.players, s.max, s.bots, s.gm, s.ws, s.loc, s.gmc, s.ver, s.desc, s.pass ? 1 : 0, s.ping]);
    body = Buffer.from(JSON.stringify({ at, servers: rows })); gz = zlib.gzipSync(body);
  }
  refresh(); setInterval(refresh, LIST_MS).unref();
  const known = (addr) => list.has(addr) || (allowed.get(addr) ?? 0) > Date.now();

  async function handle(req, res, { headers = {} }) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/servers' && !url.pathname.startsWith('/servers/')) return false;
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
    if (url.pathname === '/servers') {
      if (!body) return json(503, { error: KEY ? 'The server list is loading. Try again in a moment.' : 'This hub has no Steam key, so it cannot list servers.' }), true;
      const zip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...(zip ? { 'Content-Encoding': 'gzip' } : {}), ...headers });
      res.end(zip ? gz : body); return true;
    }
    const addr = url.searchParams.get('addr') ?? '', a = splitAddr(addr);
    if (!a || !publicIp(a.ip)) return json(400, { error: 'Give an address like 1.2.3.4:27015.' }), true;
    if (url.pathname === '/servers/info') {
      const info = await ask(addr, 'info');
      if (!info) return json(404, { error: 'No server answered at that address.' }), true;
      if (info.folder !== 'garrysmod') return json(404, { error: 'That is not a Garry\'s Mod server.' }), true;
      allowed.set(addr, Date.now() + 6 * 3600e3);
      return json(200, { addr, ...info }), true;
    }
    if (url.pathname === '/servers/players') return json(200, (known(addr) && await ask(addr, 'players')) || []), true;
    return json(404, { error: 'Not found' }), true;
  }

  // One relay session per WebSocket: a UDP socket per local port the game uses (normally one).
  function relay(conn) {
    const socks = new Map();      // local port -> dgram socket
    let budget = RELAY.perConnBytesPerSec, last = Date.now(), seen = Date.now();
    const refill = () => { const now = Date.now(); budget = Math.min(RELAY.perConnBytesPerSec, budget + ((now - last) / 1000) * RELAY.perConnBytesPerSec); last = now; };
    const idle = setInterval(() => { if (Date.now() - seen > RELAY.idleMs) conn.close(1000); }, 15e3);
    conn.onBinary = (b) => {
      if (b.length < 9) return;
      seen = Date.now(); refill();
      if (budget < b.length) return;          // over the cap: drop, as a congested link would
      budget -= b.length;
      const local = b.readUInt16BE(0), ip = ipStr(b.readUInt32BE(2)), port = b.readUInt16BE(6), addr = `${ip}:${port}`;
      if (!known(addr)) return;
      let s = socks.get(local);
      if (!s) {
        if (socks.size >= RELAY.sockets) return;
        s = dgram.createSocket('udp4'); socks.set(local, s);
        s.on('message', (msg, r) => {
          if (!known(`${r.address}:${r.port}`)) return;
          const out = Buffer.alloc(8 + msg.length);
          out.writeUInt32BE(ipNum(r.address), 0); out.writeUInt16BE(r.port, 4); out.writeUInt16BE(local, 6); msg.copy(out, 8);
          conn.sendBinary(out);
        });
        s.on('error', () => {});
        s.bind(0);
      }
      s.send(b.subarray(8), port, ip);
    };
    conn.onClose = () => { clearInterval(idle); for (const s of socks.values()) s.close(); socks.clear(); };
  }
  return { handle, relay };
}
