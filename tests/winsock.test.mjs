import test from 'node:test';
import assert from 'node:assert/strict';
import { installWinsock } from '../tools/lift/host/winsock.mjs';
import { createRing, RingReader, RingWriter } from '../tools/lift/host/ring.mjs';

function guest() {
  const mem = new ArrayBuffer(1 << 16), g = { u8: new Uint8Array(mem), dv: new DataView(mem), brk: 0x8000,
    alloc(n) { const p = this.brk; this.brk += n; return p; }, readStr(p) { let s = ''; while (this.u8[p]) s += String.fromCharCode(this.u8[p++]); return s; } };
  const S = {}; installWinsock(S);
  const call = (n, ...a) => S[`ws2_32.dll!${n}`].fn.apply({ g }, a);
  return { g, call };
}
const addr = (g, p, ip, port) => { g.u8.fill(0, p, p + 16); g.dv.setUint16(p, 2, true); g.dv.setUint16(p + 2, port); g.dv.setUint32(p + 4, ip); };
const LO = 0x7f000001;

test('loopback datagrams reach the bound socket, with the sender address', () => {
  const { g, call } = guest();
  const srv = call('socket', 2, 2, 17), cli = call('socket', 2, 2, 17);
  addr(g, 100, 0, 27015); assert.equal(call('bind', srv, 100, 16), 0);
  addr(g, 120, LO, 27015); g.u8.set([1, 2, 3, 4], 200);
  assert.equal(call('sendto', cli, 200, 4, 0, 120, 16), 4);
  assert.equal(call('recvfrom', srv, 300, 64, 0, 400, 500), 4);
  assert.deepEqual([...g.u8.subarray(300, 304)], [1, 2, 3, 4]);
  assert.equal(g.dv.getUint32(404), LO);                       // from 127.0.0.1
  assert.ok(g.dv.getUint16(402) >= 49152);                     // the client was auto-bound to an ephemeral port
});

test('an empty non-blocking socket reports WSAEWOULDBLOCK; select sees only ready sockets', () => {
  const { g, call } = guest();
  const a = call('socket', 2, 2, 17), b = call('socket', 2, 2, 17);
  g.dv.setUint32(600, 1, true); assert.equal(call('ioctlsocket', a, 0x8004667e, 600), 0);
  addr(g, 100, 0, 27016); call('bind', a, 100, 16);
  assert.equal(call('recvfrom', a, 300, 64, 0, 0, 0), -1);
  assert.equal(call('WSAGetLastError'), 10035);
  addr(g, 120, LO, 27016); call('sendto', b, 200, 1, 0, 120, 16);
  g.dv.setUint32(700, 2, true); g.dv.setUint32(704, a, true); g.dv.setUint32(708, b, true);   // fd_set {a, b}
  g.dv.setInt32(800, 0, true); g.dv.setInt32(804, 0, true);                                      // zero timeout
  assert.equal(call('select', 0, 700, 0, 0, 800), 1);
  assert.equal(g.dv.getUint32(700, true), 1); assert.equal(g.dv.getUint32(704, true), a);
  assert.equal(call('__WSAFDIsSet', a, 700), 1); assert.equal(call('__WSAFDIsSet', b, 700), 0);
});

test('a second bind to the same UDP port is refused; streams are not offered', () => {
  const { g, call } = guest();
  const a = call('socket', 2, 2, 17), b = call('socket', 2, 2, 17);
  addr(g, 100, 0, 27015); assert.equal(call('bind', a, 100, 16), 0);
  assert.equal(call('bind', b, 100, 16), -1); assert.equal(call('WSAGetLastError'), 10048);
  assert.equal(call('socket', 2, 1, 6), -1);
});

test('packets for other addresses leave through the ring; packets from the ring are delivered', () => {
  const { g, call } = guest();
  const out = createRing(4096), inn = createRing(4096);
  g.netOut = new RingWriter(out); g.netIn = new RingReader(inn);
  const s = call('socket', 2, 2, 17); addr(g, 100, 0, 27005); call('bind', s, 100, 16);
  addr(g, 120, (10 << 24) | (77 << 16) | 2, 27015); g.u8.set([9, 8, 7], 200);
  call('sendto', s, 200, 3, 0, 120, 16);
  const f = new RingReader(out).read(), dv = new DataView(f.buffer, f.byteOffset);
  assert.equal(f[0], 1); assert.equal(dv.getUint16(5), 27005); assert.equal(dv.getUint32(7), (10 << 24) | (77 << 16) | 2); assert.equal(dv.getUint16(11), 27015);
  assert.deepEqual([...f.subarray(13)], [9, 8, 7]);
  const w = new RingWriter(inn), pkt = new Uint8Array(13 + 2), pd = new DataView(pkt.buffer);
  pkt[0] = 1; pd.setUint32(1, (10 << 24) | (77 << 16) | 2); pd.setUint16(5, 27015); pd.setUint32(7, (10 << 24) | (77 << 16) | 1); pd.setUint16(11, 27005); pkt.set([5, 6], 13);
  w.write(pkt);
  assert.equal(call('recvfrom', s, 300, 64, 0, 400, 500), 2);
  assert.equal(g.dv.getUint32(404), (10 << 24) | (77 << 16) | 2);
});

test('gethostbyname resolves the machine and dotted addresses only', () => {
  const { g, call } = guest();
  g.u8.set([...'gamebox\0'].map((c) => c.charCodeAt(0)), 50);
  const h = call('gethostbyname', 50), list = g.dv.getUint32(h + 12, true), first = g.dv.getUint32(list, true);
  assert.equal(g.dv.getUint32(first), (10 << 24) | (77 << 16) | 1);
  g.u8.set([...'nowhere.example\0'].map((c) => c.charCodeAt(0)), 50);
  assert.equal(call('gethostbyname', 50), 0);
});

test('getaddrinfo resolves dotted addresses with the service port; names it cannot know fail', () => {
  const { g, call } = guest();
  g.u8.set(new TextEncoder().encode('10.77.0.1\0'), 100); g.u8.set(new TextEncoder().encode('27015\0'), 120);
  assert.equal(call('getaddrinfo', 100, 120, 0, 140), 0);
  const ai = g.dv.getUint32(140, true), sa = g.dv.getUint32(ai + 24, true);
  assert.equal(g.dv.getInt32(ai + 4, true), 2); assert.equal(g.dv.getUint32(ai + 16, true), 16);
  assert.equal(g.dv.getUint16(sa, true), 2); assert.equal(g.dv.getUint16(sa + 2), 27015); assert.equal(g.dv.getUint32(sa + 4), 0x0a4d0001);
  g.u8.set(new TextEncoder().encode('example.com\0'), 100);
  assert.equal(call('getaddrinfo', 100, 0, 0, 140), 11001);
});

test('getaddrinfo accepts a quoted address (RunConsoleCommand quotes connect\'s argument)', () => {
  const { g, call } = guest();
  g.u8.set(new TextEncoder().encode('"10.77.0.1"\0'), 100);
  assert.equal(call('getaddrinfo', 100, 0, 0, 140), 0);
  assert.equal(g.dv.getUint32(g.dv.getUint32(g.dv.getUint32(140, true) + 24, true) + 4), 0x0a4d0001);
});

test('a socket bound to the old machine address still receives after the address changes (pairing)', () => {
  const { g, call } = guest();
  const srv = call('socket', 2, 2, 17);
  addr(g, 100, 0x0a4d0001, 27005); assert.equal(call('bind', srv, 100, 16), 0);   // bound while this machine was 10.77.0.1
  g.net.myIp = 0x0a4d0002;                                                          // then paired as 10.77.0.2
  const cli = call('socket', 2, 2, 17);
  addr(g, 120, 0x0a4d0002, 27005); g.u8.set([7], 200);
  call('sendto', cli, 200, 1, 0, 120, 16);
  assert.equal(call('recvfrom', srv, 300, 64, 0, 0, 0), 1);
});
