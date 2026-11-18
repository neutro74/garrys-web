// Voice channels in the browser (hub/voice.mjs keeps the list): the microphone goes to everyone else in the channel over
// WebRTC, browser to browser, and their voices play here. The hub only passes the connection offers along. Without a relay
// (TURN) server some networks cannot connect directly; that person then shows as "can't connect" and others still hear
// each other.
//   const vc = voiceClient(hub)  (one per hub connection)
//   vc.join(id) / vc.leave() / vc.setMuted(b) / vc.setDeafened(b); vc.on(fn) for changes; vc.channels, vc.current,
//   vc.speaking (Set of connection ids), vc.problems (Map id -> text)
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
const clients = new WeakMap();
export function voiceClient(hub) {
  if (!clients.has(hub)) clients.set(hub, new VoiceClient(hub));
  return clients.get(hub);
}

class VoiceClient {
  constructor(hub) {
    this.hub = hub; this.channels = []; this.current = null; this.muted = false; this.deafened = false;
    this.peers = new Map(); this.speaking = new Set(); this.problems = new Map(); this.listeners = new Set();
    this.stream = null; this.ctx = null; this.meters = new Map(); this.timer = 0;
    hub.on('vc-list', (m) => { this.channels = m.channels ?? []; this.emit(); });
    hub.on('vc-joined', (m) => this.joined(m));
    hub.on('vc-left', () => this.stop());
    hub.on('vc-peer-left', (m) => this.dropPeer(m.id));
    hub.on('vc-signal', (m) => this.signal(m.from, m.data));
    hub.on('state', () => { if (hub.state !== 'online' && this.current) this.stop(); });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(); }
  channel(id = this.current) { return this.channels.find((c) => c.id === id) ?? null; }

  async join(id) {
    if (!this.stream) {
      try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch { throw Error('The microphone is blocked. Allow it for this site (the icon in the address bar) to use voice.'); }
      this.stream.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
      this.meter('me', this.stream);
    }
    this.hub.send({ t: 'vc-join', id });
  }
  leave() { this.hub.send({ t: 'vc-leave' }); this.stop(); }
  setMuted(on) { this.muted = on; this.stream?.getAudioTracks().forEach((t) => { t.enabled = !on && !this.deafened; }); this.sendState(); this.emit(); }
  setDeafened(on) {
    this.deafened = on; for (const p of this.peers.values()) p.audio.muted = on;
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !on && !this.muted; });
    this.sendState(); this.emit();
  }
  sendState() { if (this.current) this.hub.send({ t: 'vc-state', muted: this.muted || this.deafened, deafened: this.deafened }); }

  joined({ id, peers }) {
    for (const p of [...this.peers.keys()]) this.dropPeer(p);
    this.current = id; this.sendState();
    for (const p of peers) this.connect(p, true);   // the newcomer calls everyone already there
    this.emit();
  }
  stop() {
    for (const p of [...this.peers.keys()]) this.dropPeer(p);
    this.current = null;
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    this.meters.clear(); this.speaking.clear(); clearInterval(this.timer); this.timer = 0;
    this.ctx?.close().catch(() => {}); this.ctx = null;
    this.emit();
  }
  connect(id, initiator) {
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: ICE }), audio = new Audio();
    audio.autoplay = true; audio.muted = this.deafened;
    const peer = { pc, audio, initiator };
    this.peers.set(id, peer);
    // The caller adds the microphone now; the answering side adds it once the offer is in (so it rides the offered slot).
    if (initiator) this.addMic(peer);
    pc.onicecandidate = (e) => { if (e.candidate) this.hub.send({ t: 'vc-signal', to: id, data: { ice: e.candidate.toJSON() } }); };
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); this.meter(id, e.streams[0]); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.problems.set(id, "Can't connect (their network blocks direct voice)");
      else if (pc.connectionState === 'connected') this.problems.delete(id);
      this.emit();
    };
    if (initiator) pc.onnegotiationneeded = async () => {
      try { await pc.setLocalDescription(); this.hub.send({ t: 'vc-signal', to: id, data: { sdp: pc.localDescription.toJSON() } }); } catch { /* retried by the next negotiation */ }
    };
    return peer;
  }
  addMic(peer) { if (peer.mic) return; peer.mic = true; for (const t of this.stream?.getAudioTracks() ?? []) peer.pc.addTrack(t, this.stream); }
  async signal(from, data) {
    if (!this.current || !data) return;
    const peer = this.peers.get(from) ?? this.connect(from, false), pc = peer.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') { this.addMic(peer); await pc.setLocalDescription(); this.hub.send({ t: 'vc-signal', to: from, data: { sdp: pc.localDescription.toJSON() } }); }
      } else if (data.ice) await pc.addIceCandidate(data.ice).catch(() => {});
    } catch (e) { console.warn('[voice]', e.message); }
  }
  dropPeer(id) {
    const p = this.peers.get(id); if (!p) return;
    p.pc.close(); p.audio.srcObject = null; this.peers.delete(id);
    this.meters.delete(id); this.speaking.delete(id); this.problems.delete(id);
    this.emit();
  }
  // Who is talking: a level meter on each stream, checked a few times a second.
  meter(id, stream) {
    this.ctx ??= new AudioContext();
    this.ctx.resume().catch(() => {});
    const src = this.ctx.createMediaStreamSource(stream), an = this.ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    this.meters.set(id, { an, buf: new Float32Array(an.fftSize), hold: 0 });
    this.timer ||= setInterval(() => {
      let changed = false;
      for (const [k, m] of this.meters) {
        m.an.getFloatTimeDomainData(m.buf); let sum = 0; for (const v of m.buf) sum += v * v;
        const loud = Math.sqrt(sum / m.buf.length) > 0.02 && !(k === 'me' && (this.muted || this.deafened));
        if (loud) m.hold = 3; else if (m.hold) m.hold--;
        const key = k === 'me' ? this.hub.me?.id : k, on = m.hold > 0;
        if (on !== this.speaking.has(key)) { if (on) this.speaking.add(key); else this.speaking.delete(key); changed = true; }
      }
      if (changed) this.emit();
    }, 120);
  }
}
