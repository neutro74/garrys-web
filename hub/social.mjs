// Friends between Garry's Web accounts: requests, accepted friends and blocks, one small file per account under
// WS_CACHE/social. The chat socket (hub.mjs) drives it and tells both players when something changes.
import fs from 'node:fs';
import path from 'node:path';

const USER = /^[a-z0-9_]{3,20}$/, MAX = 500;

export function createSocial({ dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'social') } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const cache = new Map();
  const empty = () => ({ friends: [], incoming: [], outgoing: [], blocked: [] });
  const read = (u) => {
    if (!USER.test(u)) throw Error('Bad username.');
    if (!cache.has(u)) { let s = empty(); try { s = { ...s, ...JSON.parse(fs.readFileSync(path.join(dir, u + '.json'), 'utf8')) }; } catch { /* none yet */ } cache.set(u, s); }
    return cache.get(u);
  };
  const write = (u) => { const f = path.join(dir, u + '.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(read(u))); fs.renameSync(f + '.tmp', f); };
  const drop = (list, x) => { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); };
  const add = (list, x) => { if (!list.includes(x)) { if (list.length >= MAX) throw Error('That list is full.'); list.push(x); } };
  return {
    get: (u) => read(u),
    isFriend: (a, b) => read(a).friends.includes(b),
    blocks: (a, b) => read(a).blocked.includes(b),   // a has blocked b
    // Returns what happened: 'sent', 'accepted' (they had asked already) or 'already'.
    request(a, b) {
      if (a === b) throw Error('That is you.');
      const A = read(a), B = read(b);
      if (A.friends.includes(b)) return 'already';
      if (B.blocked.includes(a) || A.blocked.includes(b)) throw Error('You cannot add this player.');
      if (A.incoming.includes(b)) return this.accept(a, b);
      add(A.outgoing, b); add(B.incoming, a); write(a); write(b); return 'sent';
    },
    accept(a, b) {
      const A = read(a), B = read(b);
      if (!A.incoming.includes(b)) throw Error('There is no request from that player.');
      drop(A.incoming, b); drop(B.outgoing, a); add(A.friends, b); add(B.friends, a); write(a); write(b); return 'accepted';
    },
    // Removing a friend, declining a request or cancelling one's own request.
    remove(a, b) {
      const A = read(a), B = read(b);
      for (const [x, y] of [[A.friends, b], [A.incoming, b], [A.outgoing, b], [B.friends, a], [B.incoming, a], [B.outgoing, a]]) drop(x, y);
      write(a); write(b);
    },
    block(a, b) { if (a === b) throw Error('That is you.'); this.remove(a, b); add(read(a).blocked, b); write(a); },
    unblock(a, b) { drop(read(a).blocked, b); write(a); },
  };
}
