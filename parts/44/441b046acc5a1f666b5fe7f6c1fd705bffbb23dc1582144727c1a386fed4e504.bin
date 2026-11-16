// Winsock for the browser host: UDP sockets only (the Source engine's game traffic), over a virtual network.
//
// A packet addressed to this machine (127.x or the virtual address) is delivered to the local socket bound to that
// port. Anything else goes out through `g.netOut`, a ring read by the page (web/p2p.js), which relays it to the peer
// that owns the destination address over a WebRTC data channel. Packets from peers arrive on `g.netIn`.
// Without those rings (the default) only local delivery exists, so a listen server and its own client still work.
//
// Frames on both rings: [u8 type] then, for type 1 (datagram): u32 srcIp, u16 srcPort, u32 dstIp, u16 dstPort, payload;
// for type 2 (page -> guest, "you are address X"): u32 ip. Addresses are host-order numbers (a<<24|b<<16|c<<8|d).
// Streams (TCP) are not provided: the engine uses them only for rcon and the like, and they keep failing with WSAENETDOWN.

const WSAEWOULDBLOCK = 10035, WSAEINVAL = 10022, WSAEMSGSIZE = 10040, WSAEADDRINUSE = 10048, WSAENOTSOCK = 10038,
  WSAENETDOWN = 10050, WSAENOTCONN = 10057, WSAEAFNOSUPPORT = 10047;
const FIONBIO = 0x8004667e, FIONREAD = 0x4004667f;
const LOOPBACK = 0x7f000001, DEFAULT_IP = (10 << 24) | (77 << 16) | 1;      // 10.77.0.1
export const VIRTUAL_NET = (10 << 24) | (77 << 16);                          // 10.77.0.0/24
const ipStr = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const isLoopback = (ip) => (ip >>> 24) === 127;
const isBroadcast = (ip) => ip === 0xffffffff || (ip >>> 8) === (VIRTUAL_NET >>> 8) && (ip & 255) === 255;

function net(g) {
  return g.net ||= { dbg: !!globalThis.__env?.GUEST_DEBUG_NET, sockets: new Map(), next: 0x1c0, ephemeral: 49152, err: 0, myIp: DEFAULT_IP, hostent: 0, rx: null, stats: { sent: 0, received: 0, dropped: 0 } };
}
const fail = (g, code) => { net(g).err = code; return -1; };

// ---- ring frames ----
function pump(g) {
  const st = net(g);
  if (!g.netIn) return;
  if (!st.rx) { st.rx = g.netIn; }
  for (let f; (f = st.rx.read());) {
    if (f[0] === 2 && f.length >= 5) { st.myIp = new DataView(f.buffer, f.byteOffset).getUint32(1) >>> 0; continue; }
    // a player's name from the peer-to-peer layer: [3][steam id, u64 big-endian][utf-8 name], for steam.mjs
    if (f[0] === 3 && f.length >= 9) { (g.steamNames ||= new Map()).set(new DataView(f.buffer, f.byteOffset).getBigUint64(1), new TextDecoder().decode(f.subarray(9))); continue; }
    if (f[0] !== 1 || f.length < 13) continue;
    const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
    deliver(st, { ip: dv.getUint32(1) >>> 0, port: dv.getUint16(5) }, dv.getUint32(7) >>> 0, dv.getUint16(11), f.subarray(13));
  }
}
// GUEST_DEBUG_NET=1: connectionless packets (the connect handshake: q challenge request, A challenge, k connect, B accept,
// 9 reject, T/U/V queries) and every dropped datagram are logged with addresses.
// Split packets: int32 -2, int32 sequence, uint16 (piece number << 8 | piece count), uint16 split size.
const kind = (b) => {
  if (b.length >= 5 && b[0] === 255 && b[1] === 255 && b[2] === 255 && b[3] === 255) return `'${String.fromCharCode(b[4])}'`;
  if (b.length >= 12 && b[0] === 0xfe && b[1] === 0xff && b[2] === 0xff && b[3] === 0xff) { const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), id = dv.getUint16(8, true); return `split seq=${dv.getInt32(4, true)} ${id >> 8}/${id & 255} size=${dv.getUint16(10, true)}`; }
  return 'netchan';
};
function trace(st, what, from, toIp, toPort, bytes) {
  if (!st.dbg || !st.log) return;
  const k = kind(bytes);
  if (k === 'netchan' && what !== 'DROP') { st.netchan = (st.netchan ?? 0) + 1; if (st.netchan % 200) return; }
  st.log(`[net] ${what} ${ipStr(from.ip)}:${from.port} -> ${ipStr(toIp)}:${toPort} ${k} ${bytes.length}b${k === 'netchan' && what !== 'DROP' ? ` (#${st.netchan})` : ''}`);
}
function deliver(st, from, dstIp, dstPort, bytes) {
  let hit = false;
  for (const s of st.sockets.values()) {
    if (s.type !== 2 || !s.bound || s.bound.port !== dstPort) continue;
    // A socket bound to this machine's address keeps receiving after pairing changes that address (the engine binds at
    // startup, before a joiner is given 10.77.0.N), so "this machine" matches whatever the address is now.
    if (s.bound.ip && s.bound.ip !== dstIp && !isBroadcast(dstIp) && !(s.bound.ip !== LOOPBACK && dstIp === st.myIp)) continue;
    if (s.queue.length < 512) s.queue.push({ from, bytes: bytes.slice() });
    else { st.stats.queueFull = (st.stats.queueFull ?? 0) + 1; if (st.dbg && st.log && (st.stats.queueFull & (st.stats.queueFull - 1)) === 0) st.log(`[net] SOCKET QUEUE FULL x${st.stats.queueFull}`); }
    hit = true;
  }
  if (hit) { st.stats.received++; trace(st, 'rx', from, dstIp, dstPort, bytes); }
  else { st.stats.dropped++; trace(st, 'DROP', from, dstIp, dstPort, bytes); if (st.dbg && st.log) st.log(`[net]   bound: ${[...st.sockets.values()].filter((x) => x.bound).map((x) => `${ipStr(x.bound.ip)}:${x.bound.port}`).join(' ')}`); }
}
function sendOut(g, srcIp, srcPort, dstIp, dstPort, bytes) {
  if (!g.netOut) return;
  const f = new Uint8Array(13 + bytes.length), dv = new DataView(f.buffer);
  f[0] = 1; dv.setUint32(1, srcIp); dv.setUint16(5, srcPort); dv.setUint32(7, dstIp); dv.setUint16(11, dstPort); f.set(bytes, 13);
  if (!g.netOut.tryWrite(f)) {     // UDP: a full ring drops the datagram (counted; logged with GUEST_DEBUG_NET)
    const st = net(g); st.stats.outFull = (st.stats.outFull ?? 0) + 1;
    if (st.dbg && st.log && (st.stats.outFull & (st.stats.outFull - 1)) === 0) st.log(`[net] OUT RING FULL x${st.stats.outFull}`);
  }
}

// ---- sockaddr_in ----
function readAddr(g, p, len) {
  if (!p || len < 8 || g.dv.getUint16(p, true) !== 2) return null;
  return { port: g.dv.getUint16(p + 2), ip: g.dv.getUint32(p + 4) >>> 0 };
}
function writeAddr(g, p, a) {
  g.u8.fill(0, p, p + 16); g.dv.setUint16(p, 2, true); g.dv.setUint16(p + 2, a.port); g.dv.setUint32(p + 4, a.ip >>> 0);
}
const sock = (g, h) => net(g).sockets.get(h >>> 0);

function bindSocket(g, s, ip, port) {
  const st = net(g);
  if (!port) { do { port = st.ephemeral++; if (st.ephemeral > 65000) st.ephemeral = 49152; } while ([...st.sockets.values()].some((o) => o.bound?.port === port)); }
  else if ([...st.sockets.values()].some((o) => o !== s && o.type === 2 && o.bound?.port === port)) return false;
  s.bound = { ip, port };
  return true;
}

function sendDatagram(g, s, bytes, to) {
  const st = net(g);
  if (!s.bound) bindSocket(g, s, 0, 0);
  const srcIp = isLoopback(to.ip) ? LOOPBACK : st.myIp;
  st.stats.sent++;
  st.log ??= g.log?.bind(g);
  trace(st, 'tx', { ip: isLoopback(to.ip) ? LOOPBACK : st.myIp, port: s.bound.port }, to.ip, to.port, bytes);
  if (isLoopback(to.ip) || to.ip === st.myIp) deliver(st, { ip: srcIp, port: s.bound.port }, to.ip, to.port, bytes);
  else sendOut(g, st.myIp, s.bound.port, to.ip, to.port, bytes);
}

function waitReadable(g, sockets, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    pump(g);
    if (sockets.some((s) => s.queue.length)) return true;
    if (Date.now() >= deadline) return false;
    if (g.netIn) Atomics.wait(g.netIn.ctl, 0, Atomics.load(g.netIn.ctl, 0), Math.min(5, deadline - Date.now()));   // wakes when a frame lands
    else return false;
  }
}

export function installWinsock(SHIMS) {
  // Per-call counters and time spent waiting, logged every few seconds (GUEST_DEBUG_NET=1) to find blocking calls.
  const WS = (name, arity, fn) => {
    SHIMS[`ws2_32.dll!${name}`] = { arity, pop: 4 * arity, fn: function (...args) {
      const st = net(this.g);
      if (!st.dbg) return fn.apply(this, args);
      const t = performance.now(), r = fn.apply(this, args), dt = performance.now() - t, c = (st.calls ||= {})[name] ||= { n: 0, ms: 0, fail: 0 };
      c.n++; c.ms += dt; if (r === -1) c.fail++;
      if (!st.logAt || t - st.logAt > 3000) { if (st.logAt) this.g.log(`[ws2] ${Object.entries(st.calls).map(([k, v]) => `${k}:${v.n}/${v.ms.toFixed(0)}ms/${v.fail}f`).join(' ')}`); st.logAt = t; st.calls = {}; }
      return r;
    } };
  };
  WS('socket', 3, function (af, type) {
    const g = this.g, st = net(g);
    if ((af | 0) !== 2) return fail(g, WSAEAFNOSUPPORT);
    if ((type | 0) !== 2) return fail(g, WSAENETDOWN);        // no streams
    const h = st.next; st.next += 4;
    st.sockets.set(h, { type: 2, bound: null, peer: null, queue: [], nonblocking: false });
    return h;
  });
  WS('closesocket', 1, function (h) { net(this.g).sockets.delete(h >>> 0); return 0; });
  WS('ioctlsocket', 3, function (h, cmd, argp) {
    const g = this.g, s = sock(g, h);
    if (!s) return fail(g, WSAENOTSOCK);
    if ((cmd >>> 0) === FIONBIO) { s.nonblocking = g.dv.getUint32(argp, true) !== 0; return 0; }
    if ((cmd >>> 0) === FIONREAD) { pump(g); g.dv.setUint32(argp, s.queue[0]?.bytes.length ?? 0, true); return 0; }
    return 0;
  });
  WS('bind', 3, function (h, addr, len) {
    const g = this.g, s = sock(g, h), a = readAddr(g, addr, len);
    if (!s) return fail(g, WSAENOTSOCK);
    if (!a) return fail(g, WSAEINVAL);
    return bindSocket(g, s, a.ip, a.port) ? 0 : fail(g, WSAEADDRINUSE);
  });
  WS('connect', 3, function (h, addr, len) {
    const g = this.g, s = sock(g, h), a = readAddr(g, addr, len);
    if (!s) return fail(g, WSAENOTSOCK);
    if (!a) return fail(g, WSAEINVAL);
    s.peer = a; if (!s.bound) bindSocket(g, s, 0, 0);
    return 0;
  });
  WS('listen', 2, function () { return fail(this.g, WSAENETDOWN); });
  WS('accept', 3, function () { return fail(this.g, WSAENETDOWN); });
  WS('getsockname', 3, function (h, addr, lenp) {
    const g = this.g, s = sock(g, h);
    if (!s) return fail(g, WSAENOTSOCK);
    writeAddr(g, addr, { ip: s.bound?.ip || net(g).myIp, port: s.bound?.port ?? 0 }); g.dv.setUint32(lenp, 16, true);
    return 0;
  });
  WS('getpeername', 3, function (h, addr, lenp) {
    const g = this.g, s = sock(g, h);
    if (!s) return fail(g, WSAENOTSOCK);
    if (!s.peer) return fail(g, WSAENOTCONN);
    writeAddr(g, addr, s.peer); g.dv.setUint32(lenp, 16, true);
    return 0;
  });
  WS('setsockopt', 5, function () { return 0; });
  WS('getsockopt', 5, function (h, level, opt, val, lenp) {
    const g = this.g;
    if (val && lenp && g.dv.getUint32(lenp, true) >= 4) { g.dv.setUint32(val, 0, true); g.dv.setUint32(lenp, 4, true); }
    return 0;
  });
  WS('sendto', 6, function (h, buf, len, flags, to, tolen) {
    const g = this.g, s = sock(g, h), a = readAddr(g, to, tolen);
    if (!s) return fail(g, WSAENOTSOCK);
    if (!a) return fail(g, WSAEINVAL);
    sendDatagram(g, s, g.u8.slice(buf, buf + len), a);
    return len;
  });
  WS('send', 4, function (h, buf, len) {
    const g = this.g, s = sock(g, h);
    if (!s) return fail(g, WSAENOTSOCK);
    if (!s.peer) return fail(g, WSAENOTCONN);
    sendDatagram(g, s, g.u8.slice(buf, buf + len), s.peer);
    return len;
  });
  const receive = (g, s, buf, len, from, fromlenp) => {
    pump(g);
    if (!s.queue.length && !s.nonblocking) waitReadable(g, [s], 50);
    const p = s.queue.shift();
    if (!p) return fail(g, WSAEWOULDBLOCK);
    const n = Math.min(len, p.bytes.length);
    g.u8.set(p.bytes.subarray(0, n), buf);
    if (from) { writeAddr(g, from, p.from); if (fromlenp) g.dv.setUint32(fromlenp, 16, true); }
    return n < p.bytes.length ? fail(g, WSAEMSGSIZE) : n;
  };
  WS('recvfrom', 6, function (h, buf, len, flags, from, fromlenp) {
    const g = this.g, s = sock(g, h);
    return s ? receive(g, s, buf, len, from, fromlenp) : fail(g, WSAENOTSOCK);
  });
  WS('recv', 4, function (h, buf, len) {
    const g = this.g, s = sock(g, h);
    return s ? receive(g, s, buf, len, 0, 0) : fail(g, WSAENOTSOCK);
  });
  // fd_set is u32 count + u32 handles[64]. Readable = has a queued datagram; every socket is writable; nothing errors.
  WS('select', 5, function (nfds, rd, wr, ex, tv) {
    const g = this.g, st = net(g);
    const members = (p) => { if (!p) return []; const n = g.dv.getUint32(p, true); return Array.from({ length: n }, (_, i) => g.dv.getUint32(p + 4 + 4 * i, true)); };
    const set = (p, hs) => { if (!p) return; g.dv.setUint32(p, hs.length, true); hs.forEach((v, i) => g.dv.setUint32(p + 4 + 4 * i, v, true)); };
    const reads = members(rd), writes = members(wr);
    const ms = tv ? g.dv.getInt32(tv, true) * 1000 + Math.floor(g.dv.getInt32(tv + 4, true) / 1000) : 50;
    const objs = reads.map((h) => st.sockets.get(h)).filter(Boolean);
    const ready = () => reads.filter((h) => st.sockets.get(h)?.queue.length);
    pump(g);
    if (!writes.length && !ready().length && ms > 0) waitReadable(g, objs, Math.min(ms, 200));
    const r = ready();
    set(rd, r); set(wr, writes); set(ex, []);
    return r.length + writes.length;
  });
  SHIMS['ws2_32.dll!__WSAFDIsSet'] = { arity: 2, pop: 8, fn: function (h, p) {
    const g = this.g, n = g.dv.getUint32(p, true);
    for (let i = 0; i < n; i++) if (g.dv.getUint32(p + 4 + 4 * i, true) === (h >>> 0)) return 1;
    return 0;
  } };
  WS('gethostname', 2, function (buf, len) {
    const g = this.g, name = 'gamebox';
    if (len < name.length + 1) return fail(g, WSAEINVAL);
    for (let i = 0; i < name.length; i++) g.u8[buf + i] = name.charCodeAt(i);
    g.u8[buf + name.length] = 0;
    return 0;
  });
  // hostent for the machine itself, localhost and dotted addresses; any other name does not resolve.
  WS('gethostbyname', 1, function (namePtr) {
    const g = this.g, st = net(g), name = g.readStr(namePtr).toLowerCase().replace(/^"(.*)"$/, '$1');
    let ip = null;
    if (name === 'gamebox' || name === '') ip = st.myIp; else if (name === 'localhost') ip = LOOPBACK;
    else { const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(name); if (m) ip = (((+m[1] << 24) | (+m[2] << 16) | (+m[3] << 8) | +m[4]) >>> 0); }
    if (ip === null) { st.err = 11001; return 0; }
    st.hostent ||= g.alloc(64);
    const h = st.hostent;                  // {h_name, h_aliases, h_addrtype, h_length, h_addr_list} followed by its data
    g.u8.fill(0, h, h + 64);
    g.dv.setUint32(h, h + 48, true);       // name -> "gamebox"
    g.dv.setUint32(h + 4, h + 40, true);   // aliases -> empty list
    g.dv.setUint16(h + 8, 2, true); g.dv.setUint16(h + 10, 4, true);
    g.dv.setUint32(h + 12, h + 32, true);  // addr_list -> [h+44, null]
    g.dv.setUint32(h + 32, h + 44, true);
    g.dv.setUint32(h + 44, ip, false);     // the address, network byte order
    for (let i = 0; i < 7; i++) g.u8[h + 48 + i] = 'gamebox'.charCodeAt(i);
    return h;
  });
  // getaddrinfo: the engine resolves every address with it (connect 10.77.0.1 included). Same names as gethostbyname; the result
  // is one ADDRINFOA (32 bytes on x86) followed by its sockaddr_in, in one heap block that freeaddrinfo releases.
  WS('getaddrinfo', 4, function (nodePtr, servicePtr, hints, out) {
    // The engine passes connect's argument as typed; RunConsoleCommand("connect", ip) arrives quoted, so quotes are dropped.
    const g = this.g, st = net(g), name = nodePtr ? g.readStr(nodePtr).toLowerCase().replace(/^"(.*)"$/, '$1') : null;
    if (st.dbg) g.log?.(`[net] getaddrinfo(${name}, ${servicePtr ? g.readStr(servicePtr) : null}, hints ${hints ? [0, 4, 8, 12].map((o) => g.dv.getInt32(hints + o, true)).join('/') : '-'})`);
    const flags = hints ? g.dv.getInt32(hints, true) : 0;
    let ip = null;
    if (name === null) ip = flags & 1 ? 0 : LOOPBACK;          // AI_PASSIVE: any address, else loopback
    else if (name === 'gamebox' || name === '') ip = st.myIp; else if (name === 'localhost') ip = LOOPBACK;
    else { const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(name); if (m && m.slice(1).every((x) => +x < 256)) ip = (((+m[1] << 24) | (+m[2] << 16) | (+m[3] << 8) | +m[4]) >>> 0); }
    if (ip === null) { st.err = 11001; return 11001; }       // WSAHOST_NOT_FOUND
    const port = servicePtr ? (parseInt(g.readStr(servicePtr), 10) || 0) & 0xffff : 0;
    const a = g.alloc(48);
    g.u8.fill(0, a, a + 48);
    g.dv.setInt32(a + 4, 2, true);                           // ai_family AF_INET
    if (hints) { g.dv.setInt32(a + 8, g.dv.getInt32(hints + 8, true), true); g.dv.setInt32(a + 12, g.dv.getInt32(hints + 12, true), true); }
    g.dv.setUint32(a + 16, 16, true);                        // ai_addrlen
    g.dv.setUint32(a + 24, a + 32, true);                    // ai_addr
    g.dv.setUint16(a + 32, 2, true);                         // sin_family
    g.dv.setUint16(a + 34, port, false);                     // sin_port, network order
    g.dv.setUint32(a + 36, ip, false);                       // sin_addr, network order
    g.dv.setUint32(out, a, true);
    return 0;
  });
  WS('freeaddrinfo', 1, function (p) { if (p) try { this.g.free(p); } catch { /* not ours */ } return 0; });
  SHIMS['ws2_32.dll!WSAIoctl'] = { arity: 9, pop: 36, fn: function () { return 0; } };
  SHIMS['ws2_32.dll!WSAGetLastError'] = { arity: 0, pop: 0, fn: function () { return net(this.g).err; } };
  SHIMS['ws2_32.dll!WSASetLastError'] = { arity: 1, pop: 4, fn: function (e) { net(this.g).err = e | 0; return 0; } };
}

// The page's view, for diagnostics: addresses and counters.
export const describe = (g) => { const st = net(g); return { ip: ipStr(st.myIp), sockets: st.sockets.size, ...st.stats }; };
