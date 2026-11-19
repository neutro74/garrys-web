// Audio worklets for voice channels (web/voice-chat.js).
//   gw-vc-capture: the microphone in 20 ms frames (960 samples at 48 kHz) for the Opus encoder, with the frame's level.
//   gw-vc-play:    the voices of the others, each from its own little queue (a jitter buffer), mixed to the speakers.
const FRAME = 960;
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(FRAME); this.at = 0; }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.at++] = ch[i];
      if (this.at === FRAME) {
        let sum = 0; for (let k = 0; k < FRAME; k++) sum += this.buf[k] * this.buf[k];
        this.port.postMessage({ pcm: this.buf, level: Math.sqrt(sum / FRAME) }, [this.buf.buffer]);
        this.buf = new Float32Array(FRAME); this.at = 0;
      }
    }
    return true;
  }
}
// Each speaker: a queue of decoded frames. Playback starts once 60 ms are buffered (smooths network jitter); a queue that
// grows past 300 ms (the network caught up in a burst) drops its oldest audio so the delay stays short.
const START = 2880, MAX = 14400;
class Play extends AudioWorkletProcessor {
  constructor() {
    super(); this.q = new Map();
    this.port.onmessage = (e) => {
      const { id, pcm, drop } = e.data;
      if (drop) { this.q.delete(id); return; }
      let s = this.q.get(id); if (!s) this.q.set(id, s = { chunks: [], off: 0, have: 0, playing: false });
      s.chunks.push(pcm); s.have += pcm.length;
      while (s.have - s.off > MAX && s.chunks.length > 1) { const c = s.chunks.shift(); s.have -= c.length; s.off = 0; }
    };
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] ?? out[0], n = L.length;
    L.fill(0); if (R !== L) R.fill(0);
    for (const s of this.q.values()) {
      if (!s.playing) { if (s.have - s.off < START) continue; s.playing = true; }
      let i = 0;
      while (i < n && s.chunks.length) {
        const c = s.chunks[0], take = Math.min(n - i, c.length - s.off);
        for (let k = 0; k < take; k++) { const v = c[s.off + k]; L[i + k] += v; if (R !== L) R[i + k] += v; }
        i += take; s.off += take;
        if (s.off >= c.length) { s.chunks.shift(); s.have -= c.length; s.off = 0; }
      }
      if (!s.chunks.length) { s.playing = false; s.have = 0; s.off = 0; }   // ran dry: buffer up again before resuming
    }
    for (let i = 0; i < n; i++) { L[i] = Math.max(-1, Math.min(1, L[i])); if (R !== L) R[i] = Math.max(-1, Math.min(1, R[i])); }
    return true;
  }
}
registerProcessor('gw-vc-capture', Capture);
registerProcessor('gw-vc-play', Play);
