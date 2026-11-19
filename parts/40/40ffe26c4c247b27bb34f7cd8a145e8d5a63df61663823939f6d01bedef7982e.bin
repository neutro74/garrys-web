// Voice channels in the browser (hub/voice.mjs keeps the list). The audio goes through the hub, on the same connection as
// chat, so voice works wherever chat does (browser-to-browser links fail on many school and home networks):
//   microphone -> AudioWorklet (20 ms frames) -> Opus (WebCodecs AudioEncoder, 32 kbit/s) -> hub -> the others
//   each speaker's frames -> AudioDecoder -> a small jitter buffer per speaker -> mixed in an AudioWorklet -> speakers
// The echo canceller of getUserMedia hears what plays through the page's <audio> element, which is why playback ends there.
//   const vc = voiceClient(hub)  (one per hub connection)
//   vc.join(id) / vc.leave() / vc.setMuted(b) / vc.setDeafened(b); vc.on(fn) for changes; vc.channels, vc.current,
//   vc.speaking (Set of connection ids), vc.problems (Map id -> text)
const clients = new WeakMap();
export function voiceClient(hub) {
  if (!clients.has(hub)) clients.set(hub, new VoiceClient(hub));
  return clients.get(hub);
}
const RATE = 48000, FRAME_US = 20000, LOUD = 0.02;
export const voiceSupported = () => typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function' && typeof AudioWorkletNode === 'function';

class VoiceClient {
  constructor(hub) {
    this.hub = hub; this.channels = []; this.current = null; this.muted = false; this.deafened = false;
    this.speaking = new Set(); this.problems = new Map(); this.listeners = new Set();
    this.stream = null; this.ctx = null; this.encoder = null; this.decoders = new Map(); this.hold = new Map(); this.ts = 0;
    hub.on('vc-list', (m) => { this.channels = m.channels ?? []; this.pruneSpeakers(); this.emit(); });
    hub.on('vc-joined', (m) => { this.current = m.id; this.sendState(); this.emit(); });
    hub.on('vc-left', () => this.stop());
    hub.on('vc-peer-left', (m) => this.dropSpeaker(m.id));
    hub.on('binary', (buf) => this.incoming(buf));
    hub.on('state', () => { if (hub.state !== 'online' && this.current) this.stop(); });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(); }
  channel(id = this.current) { return this.channels.find((c) => c.id === id) ?? null; }

  async join(id) {
    if (!voiceSupported()) throw Error('This browser cannot do voice chat (it has no Opus audio encoder). Use a current Chrome or Edge.');
    if (!this.stream) {
      try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
      catch { throw Error('The microphone is blocked. Allow it for this site (the icon in the address bar) to use voice.'); }
      try { await this.startAudio(); } catch (e) { this.stop(); throw Error(`Voice could not start: ${e.message}`); }
    }
    this.hub.send({ t: 'vc-join', id });
  }
  leave() { this.hub.send({ t: 'vc-leave' }); this.stop(); }
  setMuted(on) { this.muted = on; this.sendState(); this.emit(); }
  setDeafened(on) {
    this.deafened = on;
    if (this.el) this.el.muted = on;
    if (on) for (const id of [...this.decoders.keys()]) this.dropSpeaker(id, false);
    this.sendState(); this.emit();
  }
  sendState() { if (this.current) this.hub.send({ t: 'vc-state', muted: this.muted || this.deafened, deafened: this.deafened }); }

  // ---- Audio ----
  async startAudio() {
    const ctx = this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(new URL('./voice-chat-worklet.js', import.meta.url));
    // Capture: 20 ms frames of the microphone, encoded to Opus and sent while not muted.
    const cap = new AudioWorkletNode(ctx, 'gw-vc-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    ctx.createMediaStreamSource(this.stream).connect(cap);
    this.encoder = new AudioEncoder({
      output: (chunk) => { const b = new Uint8Array(chunk.byteLength + 1); b[0] = 1; chunk.copyTo(b.subarray(1)); this.hub.sendBinary(b); },
      error: (e) => { console.warn('[voice] encoder', e.message); },
    });
    this.encoder.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration: FRAME_US, application: 'voip', complexity: 5 } });
    cap.port.onmessage = ({ data: { pcm, level } }) => {
      const talking = this.current && !this.muted && !this.deafened;
      this.level('me', talking ? level : 0);
      if (!talking || this.encoder.state !== 'configured') return;
      this.encoder.encode(new AudioData({ format: 'f32', sampleRate: RATE, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: this.ts, data: pcm }));
      this.ts += FRAME_US;
    };
    // Playback: the mixer worklet, played through an <audio> element (so the echo canceller hears it).
    this.play = new AudioWorkletNode(ctx, 'gw-vc-play', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const dest = ctx.createMediaStreamDestination();
    this.play.connect(dest);
    this.el = new Audio(); this.el.srcObject = dest.stream; this.el.muted = this.deafened; this.el.play().catch(() => {});
    await ctx.resume().catch(() => {});
  }
  // [u8 id length][sender connection id][u8 version][Opus frame]
  incoming(buf) {
    if (!this.current || this.deafened || !this.play) return;
    const b = new Uint8Array(buf), n = b[0];
    if (b.length < n + 3 || b[n + 1] !== 1) return;
    const id = new TextDecoder().decode(b.subarray(1, 1 + n)), frame = b.subarray(n + 2);
    let d = this.decoders.get(id);
    if (!d) {
      d = { dec: new AudioDecoder({ output: (a) => this.decoded(id, a), error: (e) => { console.warn('[voice] decoder', e.message); this.dropSpeaker(id); } }), ts: 0 };
      d.dec.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 });
      this.decoders.set(id, d);
    }
    if (d.dec.state !== 'configured' || d.dec.decodeQueueSize > 25) return;
    d.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: d.ts, data: frame }));
    d.ts += FRAME_US;
  }
  decoded(id, a) {
    const pcm = new Float32Array(a.numberOfFrames);
    try { a.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' }); } finally { a.close(); }
    let sum = 0; for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    this.level(id, Math.sqrt(sum / pcm.length));
    this.play?.port.postMessage({ id, pcm }, [pcm.buffer]);
  }
  // Who is talking: a frame above the threshold lights a speaker for a few frames.
  level(id, rms) {
    const key = id === 'me' ? this.hub.me?.id : id;
    if (!key) return;
    const h = rms > LOUD ? 12 : Math.max(0, (this.hold.get(key) ?? 0) - 1);
    this.hold.set(key, h);
    const on = h > 0;
    if (on !== this.speaking.has(key)) { if (on) this.speaking.add(key); else this.speaking.delete(key); this.emit(); }
  }
  dropSpeaker(id, notify = true) {
    const d = this.decoders.get(id);
    if (d) { try { d.dec.close(); } catch { /* closed */ } this.decoders.delete(id); }
    this.play?.port.postMessage({ id, drop: true });
    this.hold.delete(id); this.speaking.delete(id); this.problems.delete(id);
    if (notify) this.emit();
  }
  pruneSpeakers() {
    const here = new Set((this.channel()?.members ?? []).map((m) => m.id));
    for (const id of [...this.decoders.keys()]) if (!here.has(id)) this.dropSpeaker(id, false);
  }
  stop() {
    for (const id of [...this.decoders.keys()]) this.dropSpeaker(id, false);
    this.current = null;
    try { this.encoder?.close(); } catch { /* closed */ }
    this.encoder = null;
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    if (this.el) { this.el.srcObject = null; this.el = null; }
    this.play = null;
    this.ctx?.close().catch(() => {}); this.ctx = null;
    this.speaking.clear(); this.hold.clear(); this.ts = 0;
    this.emit();
  }
}
