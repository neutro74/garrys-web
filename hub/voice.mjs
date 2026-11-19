// Voice channels, like a Discord server's, with "Join to create" (the way Discord bots such as VoiceMaster do it): joining
// that channel makes a channel of your own, which you can rename, lock (private: only people you let in), give a user limit,
// kick from or hand over. It disappears when the last person leaves.
// The audio goes through the hub (any network that reaches chat can do voice; browser-to-browser links fail on many school
// and home networks): each member's page sends Opus frames as binary WebSocket messages on its chat connection, and the
// hub passes them to the others in the channel, prefixed with the sender: [u8 id length][id][the sender's frame].
// Frames from a muted member are dropped here; each sender is limited to about 6 KB/s (Opus voice needs 3-4).
// Messages from a client (signed-in accounts only):
//   {t:'vc-join', id}                 join a channel ('create' makes your own)
//   {t:'vc-leave'}
//   binary frames                     audio (Opus) while in a channel; see above
//   {t:'vc-signal', to, data}         (older pages) an offer/answer/ICE candidate for another member (by connection id)
//   {t:'vc-state', muted, deafened}
//   {t:'vc-edit', id, name?, locked?, limit?}   owner (or admin)
//   {t:'vc-allow', id, user}  {t:'vc-deny', id, user}  {t:'vc-kick', id, user}  {t:'vc-transfer', id, user}   owner (or admin)
// To clients: {t:'vc-list', channels}, {t:'vc-joined', id, peers}, {t:'vc-left'}, {t:'vc-signal', from, data},
//   {t:'vc-knock', id, user, name} (to the owner: someone wants into a locked channel), {t:'vc-denied', id, why}.
import crypto from 'node:crypto';

const FIXED = [['lounge', 'Lounge'], ['gaming', 'Gaming'], ['building', 'Building'], ['music', 'Music'], ['afk', 'AFK']];
const CREATE = 'create', MAX_TEMP = 50, MAX_PER_CHANNEL = 16;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

export function createVoice({ clients, isAdmin, log = console.log }) {
  // id -> { id, name, kind: 'fixed'|'temp', owner, locked, limit, allowed: Set<account>, knocks: Map<account,name>, members: Set<conn> }
  const channels = new Map(FIXED.map(([id, name]) => [id, { id, name, kind: 'fixed', owner: null, locked: false, limit: 0, allowed: new Set(), knocks: new Map(), members: new Set() }]));
  const where = new Map();   // conn -> channel id
  const state = new Map();   // conn -> { muted, deafened }

  const view = (ch) => ({ id: ch.id, name: ch.name, kind: ch.kind, owner: ch.owner, locked: ch.locked, limit: ch.limit,
    members: [...ch.members].map((c) => ({ id: c.id, name: c.name, account: c.account, ...(state.get(c) ?? {}) })) });
  const list = () => [...[...channels.values()].filter((c) => c.kind === 'fixed').map(view), { id: CREATE, name: 'Join to create', kind: 'create', members: [] },
    ...[...channels.values()].filter((c) => c.kind === 'temp').map(view)];
  let pending = 0;
  const broadcast = () => { if (pending) return; pending = setTimeout(() => { pending = 0; const msg = { t: 'vc-list', channels: list() }; for (const c of clients()) if (c.name) c.send(msg); }, 50); };
  const sendList = (c) => c.send({ t: 'vc-list', channels: list() });
  const memberBy = (ch, account) => [...ch.members].find((c) => c.account === account);
  const canManage = (c, ch) => ch.kind === 'temp' && (ch.owner === c.account || isAdmin(c.account));

  // Audio from a member: to everyone else in the channel (their pages decode and play it).
  const AUDIO_RATE = 6144, AUDIO_BURST = 16384, MAX_FRAME = 1500;
  function relay(c, b) {
    const ch = channels.get(where.get(c)); if (!ch || b.length < 2 || b.length > MAX_FRAME) return;
    const st = state.get(c); if (st?.muted || st?.deafened) return;
    const now = Date.now(), r = c.vcRate ??= { budget: AUDIO_BURST, at: now };
    r.budget = Math.min(AUDIO_BURST, r.budget + ((now - r.at) * AUDIO_RATE) / 1000); r.at = now;
    if (r.budget < b.length) return;
    r.budget -= b.length;
    const id = Buffer.from(c.id, 'latin1'), out = Buffer.concat([Buffer.from([id.length]), id, b]);
    for (const m of ch.members) if (m !== c && !state.get(m)?.deafened) m.sendBinary(out);
  }
  // switching: moving straight into another channel (the page keeps its microphone and audio running).
  function leave(c, switching = false) {
    const id = where.get(c); if (!id) return;
    where.delete(c); state.delete(c); c.onBinary = null;
    const ch = channels.get(id);
    if (ch) {
      ch.members.delete(c);
      for (const m of ch.members) m.send({ t: 'vc-peer-left', id: c.id });
      if (ch.kind === 'temp') {
        if (!ch.members.size) channels.delete(id);
        else if (ch.owner === c.account) ch.owner = [...ch.members][0].account;   // the next person in charge
      }
    }
    if (!switching) c.send({ t: 'vc-left' });
    broadcast();
  }
  function join(c, ch) {
    if (where.get(c) === ch.id) return;
    leave(c, true);
    if (ch.limit && ch.members.size >= ch.limit && !isAdmin(c.account)) throw Error(`${ch.name} is full.`);
    if (ch.members.size >= MAX_PER_CHANNEL) throw Error(`${ch.name} is full.`);
    const peers = [...ch.members].map((m) => m.id);
    ch.members.add(c); where.set(c, ch.id); state.set(c, { muted: false, deafened: false });
    c.onBinary = (b) => relay(c, b);
    c.send({ t: 'vc-joined', id: ch.id, peers });
    broadcast();
  }

  function handle(c, m) {
    if (!String(m.t).startsWith('vc-')) return false;
    if (!c.account) throw Error('Sign in to a Garry\'s Web account (Profile) to use voice channels.');
    switch (m.t) {
      case 'vc-list': sendList(c); return true;
      case 'vc-join': {
        if (m.id === CREATE) {
          if ([...channels.values()].filter((x) => x.kind === 'temp').length >= MAX_TEMP) throw Error('Too many voice channels right now. Join one of the others.');
          const mine = [...channels.values()].find((x) => x.kind === 'temp' && x.owner === c.account);
          if (mine) return join(c, mine), true;   // one channel each: back into your own
          const ch = { id: 't' + crypto.randomBytes(4).toString('hex'), name: `${c.name}'s channel`.slice(0, 32), kind: 'temp', owner: c.account, locked: false, limit: 0, allowed: new Set(), knocks: new Map(), members: new Set() };
          channels.set(ch.id, ch); log(`voice: ${c.account} made ${ch.id}`);
          join(c, ch); return true;
        }
        const ch = channels.get(String(m.id ?? ''));
        if (!ch) throw Error('That voice channel is gone.');
        if (ch.locked && ch.owner !== c.account && !ch.allowed.has(c.account) && !isAdmin(c.account)) {
          ch.knocks.set(c.account, c.name);
          const owner = memberBy(ch, ch.owner); owner?.send({ t: 'vc-knock', id: ch.id, user: c.account, name: c.name });
          c.send({ t: 'vc-denied', id: ch.id, why: `${ch.name} is private. ${owner ? 'The owner was asked to let you in.' : ''}`.trim() });
          return true;
        }
        join(c, ch); return true;
      }
      case 'vc-leave': leave(c); return true;
      case 'vc-signal': {
        const ch = channels.get(where.get(c)); if (!ch) return true;
        const to = [...ch.members].find((x) => x.id === m.to);
        if (to && JSON.stringify(m.data ?? null).length < 20000) to.send({ t: 'vc-signal', from: c.id, data: m.data });
        return true;
      }
      case 'vc-state': { if (!where.has(c)) return true; state.set(c, { muted: !!m.muted, deafened: !!m.deafened }); broadcast(); return true; }
    }
    const ch = channels.get(String(m.id ?? ''));
    if (!ch) throw Error('That voice channel is gone.');
    if (!canManage(c, ch)) throw Error('Only the channel\'s owner can do that.');
    const who = String(m.user ?? '').toLowerCase();
    switch (m.t) {
      case 'vc-edit':
        if (m.name !== undefined) { const n = clean(m.name, 32); if (n.length >= 2) ch.name = n; }
        if (m.locked !== undefined) ch.locked = !!m.locked;
        if (m.limit !== undefined) ch.limit = Math.max(0, Math.min(MAX_PER_CHANNEL, m.limit | 0));
        if (ch.locked) for (const x of ch.members) if (x.account) ch.allowed.add(x.account);   // locking keeps whoever is in
        break;
      case 'vc-allow': {
        ch.allowed.add(who); ch.knocks.delete(who);
        for (const x of clients()) if (x.account === who) x.send({ t: 'vc-invited', id: ch.id, name: ch.name, by: c.name });
        break;
      }
      case 'vc-deny': ch.knocks.delete(who); ch.allowed.delete(who); break;
      case 'vc-kick': { ch.allowed.delete(who); const x = memberBy(ch, who); if (x) { leave(x); x.send({ t: 'vc-denied', id: ch.id, why: `You were removed from ${ch.name}.` }); } break; }
      case 'vc-transfer': if (memberBy(ch, who)) ch.owner = who; else throw Error('They need to be in the channel.'); break;
      default: throw Error(`Unknown request ${m.t}`);
    }
    broadcast();
    return true;
  }
  return { handle, leave, sendList };
}
