// Chat that is kept: every public room message and every private message, appended to one file per room or conversation
// (one JSON message per line) under WS_CACHE/chat. Recent messages are read from the end of the file; older ones by
// paging backwards ("before" a time), so a long history never has to be read whole.
import fs from 'node:fs';
import path from 'node:path';

const USER = /^[a-z0-9_]{3,20}$/, ROOM = /^[a-z0-9-]{1,40}$/;

export function createChatStore({ dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'chat') } = {}) {
  fs.mkdirSync(path.join(dir, 'rooms'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dm'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'pings'), { recursive: true });
  const roomFile = (room) => { if (!ROOM.test(room)) throw Error('Bad room.'); return path.join(dir, 'rooms', room + '.jsonl'); };
  const pair = (a, b) => [a, b].sort();
  const dmFile = (a, b) => { if (!USER.test(a) || !USER.test(b)) throw Error('Bad username.'); return path.join(dir, 'dm', pair(a, b).join('~') + '.jsonl'); };
  const append = (file, msg) => fs.appendFileSync(file, JSON.stringify(msg) + '\n');

  // Every line of a file from the newest back, as parsed objects, until fn returns true.
  function backwards(file, fn) {
    let fd;
    try { fd = fs.openSync(file, 'r'); } catch { return; }
    try {
      let end = fs.fstatSync(fd).size, carry = Buffer.alloc(0);
      while (end > 0) {
        const start = Math.max(0, end - 65536), buf = Buffer.alloc(end - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        let data = Buffer.concat([buf, carry]); const cut = start > 0 ? data.indexOf(10) : -1;
        carry = cut >= 0 ? data.subarray(0, cut) : Buffer.alloc(0);
        if (cut >= 0) data = data.subarray(cut + 1);
        const lines = data.toString('utf8').split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) { let m; try { m = JSON.parse(lines[i]); } catch { continue; } if (fn(m)) return; }
        end = start;
      }
    } finally { fs.closeSync(fd); }
  }
  // Up to n messages older than `before` (ms; Infinity for the newest), oldest first. Later marks (moderation, edits,
  // reactions) are met before the messages they change, since the file is read backwards, so the first one met is the latest.
  function page(file, n, before = Infinity) {
    const out = [], gone = new Set(), edits = new Map(), reacts = new Map();
    let cleared = false;
    backwards(file, (m) => {
      if (m.del) { gone.add(m.del); return false; }
      if (m.clear) { cleared = true; return true; }
      if (m.edit) { if (!edits.has(m.edit)) edits.set(m.edit, m); return false; }
      if (m.react) { const k = `${m.react}\u0000${m.emoji}\u0000${m.by}`; if (!reacts.has(k)) reacts.set(k, m); return false; }
      if (m.at < before && !gone.has(m.id)) out.push(m);
      return out.length >= n;
    });
    // Reactions grouped per message: { emoji: [who, ...] }.
    const byMsg = new Map();
    for (const r of reacts.values()) if (r.on) { const e = byMsg.get(r.react) ?? {}; (e[r.emoji] ??= []).push(r.by); byMsg.set(r.react, e); }
    for (const m of out) {
      const e = m.id && edits.get(m.id); if (e) { m.text = e.text; m.edited = e.at; }
      const r = m.id && byMsg.get(m.id); if (r) m.reactions = r;
    }
    return { messages: out.reverse(), done: cleared || out.length < n };
  }
  // One message by id (newest files first; looks back at most `limit` lines), with its current text, or null.
  function find(file, id, limit = 20000) {
    let found = null, seen = 0, deleted = false;
    backwards(file, (m) => {
      if (m.del === id) { deleted = true; return true; }
      if (m.clear) return true;
      if (m.id === id) { found = m; return true; }
      return ++seen > limit;
    });
    return deleted ? null : found;
  }

  return {
    saveRoom(room, msg) { append(roomFile(room), msg); },
    // Moderation: hide one message (by id) or everything said in the room so far. The file keeps them; reads skip them.
    deleteRoomMessage(room, id) { append(roomFile(room), { del: String(id), at: Date.now() }); },
    clearRoom(room) { append(roomFile(room), { clear: true, at: Date.now() }); },
    room(room, n = 100, before) { return page(roomFile(room), n, before); },
    findRoom(room, id) { return find(roomFile(room), String(id)); },
    findDm(a, b, id) { return find(dmFile(a, b), String(id)); },
    // Edits and reactions are appended marks, like deletions; reading applies them.
    markRoom(room, mark) { append(roomFile(room), { ...mark, at: Date.now() }); },
    markDm(a, b, mark) { append(dmFile(a, b), { ...mark, at: Date.now() }); },
    saveDm(a, b, msg) { append(dmFile(a, b), msg); },
    dm(a, b, n = 100, before) { return page(dmFile(a, b), n, before); },
    // Pings: someone @mentioned a player or answered them, kept so they still show after the player was away. @everyone
    // and @here from admins go to one shared list (every account reads it). `seen` is the time the player last looked.
    savePing(user, p) { if (USER.test(user)) append(path.join(dir, 'pings', user + '.jsonl'), p); },
    saveEveryone(p) { append(path.join(dir, 'pings', 'everyone.all.jsonl'), p); },
    pings(user, n = 50) {
      if (!USER.test(user)) return [];
      const out = [], take = (f, max) => backwards(path.join(dir, 'pings', f), (m) => { out.push(m); return out.length >= max; });
      take(user + '.jsonl', n); const mine = out.length; take('everyone.all.jsonl', mine + 20);
      return out.sort((a, b) => b.at - a.at).slice(0, n);
    },
    pingsSeen(user) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'pings', user + '.seen'), 'utf8')).at ?? 0; } catch { return 0; } },
    setPingsSeen(user, at) { if (USER.test(user)) fs.writeFileSync(path.join(dir, 'pings', user + '.seen'), JSON.stringify({ at: Math.min(Date.now(), +at || Date.now()) })); },
    // A player's conversations, newest first, each with its last message.
    conversations(user) {
      if (!USER.test(user)) return [];
      const out = [];
      for (const f of fs.readdirSync(path.join(dir, 'dm'))) {
        const m = /^([a-z0-9_]+)~([a-z0-9_]+)\.jsonl$/.exec(f);
        if (!m || (m[1] !== user && m[2] !== user)) continue;
        const last = page(path.join(dir, 'dm', f), 1).messages[0];
        if (last) out.push({ with: m[1] === user ? m[2] : m[1], last });
      }
      return out.sort((a, b) => b.last.at - a.last.at);
    },
  };
}
