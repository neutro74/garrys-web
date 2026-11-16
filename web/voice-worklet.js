// Microphone capture for voice chat (web/voice.js): mono, resampled to 16 kHz, encoded as G.711 mu-law, and written as
// frames into a ring the guest reads (tools/lift/host/ring.mjs layout: Int32 head, tail; data from byte 16; [u32 len][bytes]).
const RATE = 16000;
function ulaw(s) {
  let x = Math.max(-1, Math.min(1, s)) * 32635, sign = 0;
  if (x < 0) { x = -x; sign = 0x80; }
  x += 132;
  let exp = 7;
  for (let mask = 0x4000; (x & mask) === 0 && exp > 0; mask >>= 1) exp--;
  return ~(sign | (exp << 4) | ((x >> (exp + 3)) & 0x0f)) & 0xff;
}
class Mic extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sab = options.processorOptions.ring;
    this.ctl = new Int32Array(sab, 0, 4); this.data = new Uint8Array(sab, 16); this.cap = this.data.length;
    this.step = sampleRate / RATE; this.pos = 0; this.out = new Uint8Array(640); this.n = 0; this.on = true;
    this.port.onmessage = (e) => { this.on = !!e.data.on; };
  }
  flush() {
    const need = 4 + this.n, head = Atomics.load(this.ctl, 0), tail = Atomics.load(this.ctl, 1);
    if (this.cap - (head - tail) >= need) {   // full ring (the game is not reading): drop, voice is real time
      const put = (pos, bytes) => { const i = pos % this.cap, first = Math.min(bytes.length, this.cap - i); this.data.set(bytes.subarray(0, first), i); if (first < bytes.length) this.data.set(bytes.subarray(first), 0); };
      put(head, new Uint8Array(new Uint32Array([this.n]).buffer)); put(head + 4, this.out.subarray(0, this.n));
      Atomics.store(this.ctl, 0, head + need);
    }
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch || !this.on) return true;
    for (; this.pos < ch.length; this.pos += this.step) {
      this.out[this.n++] = ulaw(ch[Math.floor(this.pos)]);
      if (this.n === this.out.length) this.flush();   // 40 ms frames
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor('gmod-mic', Mic);
