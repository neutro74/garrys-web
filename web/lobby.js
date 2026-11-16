// Lobbies: peer-to-peer games (web/p2p.js) found and paired through the hub (web/hub.js) instead of copied invite codes.
// The host lists its game; a joiner asks to join; the host's page answers with an invite (a WebRTC offer), the joiner's page
// replies, and the host completes the link. The hub only relays those codes; game traffic is peer to peer.
// Both ends live in the page (not the menu frame), so a game stays listed and joinable while the menu is closed.
import { Hub } from './hub.js';

export class Lobby {
  constructor(p2p, { edition }) {
    this.p2p = p2p; this.edition = edition; this.hub = new Hub(); this.lobbies = []; this.hosting = null; this.joining = null; this.note = '';
    this.hub.on('lobbies', (m) => { this.lobbies = m.lobbies.filter((l) => l.edition === edition && l.host !== this.hub.me?.id); });
    this.hub.on('hosting', (m) => { if (this.hosting) this.hosting.id = m.id; });
    this.hub.on('signal', (m) => this.signal(m.from, m.data ?? {}).catch((e) => { this.note = e.message; }));
    this.hub.on('error', (m) => { this.note = m.error; });
    p2p.onChange(() => this.refresh());
  }
  get available() { return !!this.hub.url; }
  connect() { if (this.hub.url && this.hub.state !== 'online' && this.hub.state !== 'connecting') { this.hub.connect(); this.hub.watchLobbies(true); } }
  refresh() { if (this.hosting) this.hub.host({ ...this.hosting.info, players: 1 + this.p2p.status().peers.length }); }
  status() {
    return { hub: this.hub.state, me: this.hub.me?.name ?? this.hub.name, lobbies: this.lobbies, hosting: this.hosting && { ...this.hosting.info, id: this.hosting.id },
      joining: this.joining && { id: this.joining.id, state: this.joining.state }, note: this.note, p2p: this.p2p.status() };
  }
  host({ name, map, gamemode, max }) {
    if (!this.available) throw Error('No hub is set up, so games cannot be listed. Use invite codes instead.');
    if (this.p2p.status().role === 'guest') throw Error('Leave the game you joined before hosting.');
    this.connect();
    this.hosting = { id: null, info: { name: String(name || `${this.hub.name}'s game`).slice(0, 48), map: String(map ?? ''), gamemode: String(gamemode ?? ''), edition: this.edition, max: max | 0 || 8, players: 1 } };
    this.hub.host(this.hosting.info);
    this.note = '';
    return this.status();
  }
  unhost() { this.hosting = null; this.hub.unhost(); return this.status(); }
  join(id) {
    const l = this.lobbies.find((x) => x.id === id);
    if (!l) throw Error('That game is no longer listed.');
    if (this.hosting) throw Error('Stop hosting before joining another game.');
    this.joining = { id, host: l.host, state: 'asking' };
    this.note = '';
    this.hub.signal(l.host, { kind: 'join', lobby: id, edition: this.edition });
    // The host has a few seconds to answer; a stale listing is dropped.
    setTimeout(() => { if (this.joining?.id === id && this.joining.state === 'asking') { this.joining = null; this.note = 'The host did not answer.'; } }, 15000);
    return this.status();
  }
  async signal(from, d) {
    if (d.kind === 'join' && this.hosting) {
      if (d.edition !== this.edition) return void this.hub.signal(from.id, { kind: 'refused', reason: `This game runs the ${this.edition} edition.` });
      if (1 + this.p2p.status().peers.length >= this.hosting.info.max) return void this.hub.signal(from.id, { kind: 'refused', reason: 'The game is full.' });
      const { code } = await this.p2p.createInvite();
      this.hub.signal(from.id, { kind: 'offer', code });
    } else if (d.kind === 'offer' && this.joining?.host === from.id) {
      this.joining.state = 'linking';
      const reply = await this.p2p.acceptInvite(d.code);
      this.hub.signal(from.id, { kind: 'answer', code: reply });
    } else if (d.kind === 'answer' && this.hosting) {
      await this.p2p.finishInvite(d.code);
    } else if (d.kind === 'refused' && this.joining?.host === from.id) {
      this.joining = null; this.note = d.reason ?? 'The host refused.';
    }
  }
  // Called by the menu once linked: the joiner is then told to connect to the host's virtual address.
  linked() { const st = this.p2p.status(); if (this.joining && st.role === 'guest' && st.peers.length) { this.joining.state = 'linked'; return true; } return false; }
  leave() { this.joining = null; this.unhost(); }
}
