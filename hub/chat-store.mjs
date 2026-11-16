// Chat that is kept: every public room message and every private message, appended to one file per room or conversation
// (one JSON message per line) under WS_CACHE/chat. Recent messages are read from the end of the file; older ones by
// paging backwards ("before" a time), so a long history never has to be read whole.
import fs from 'node:fs';
import path from 'node:path';

const USER = /^[a-z0-9_]{3,20}$/, ROOM = /^[a-z0-9-]{1,40}$/;

export function createChatStore({ dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'chat') } = {}) {
  fs.mkdirSync(path.join(dir, 'rooms'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dm'), { recursive: true });
  const roomFile = (room) => { if (!ROOM.test(room)) throw Error('Bad room.'); return path.join(dir, 'rooms', room + '.jsonl'); };
  const pair = (a, b) => [a, b].sort();
  const dmFile = (a, b) => { if (!USER.test(a) || !USER.test(b)) throw Error('Bad username.'); return path.join(dir, 'dm', pair(a, b).join('~') + '.jsonl'); };
  const append = (file, msg) => fs.appendFileSync(file, JSON.stringify(msg) + '\n');

  // Up to n messages older than `before` (ms; Infinity for the newest), oldest first, read backwards in 64 KB blocks.
  function page(file, n, before = Infinity) {
    let fd;
    try { fd = fs.openSync(file, 'r'); } catch { return { messages: [], done: true }; }
    try {
      const size = fs.fstatSync(fd).size, out = [];
      let end = size, carry = Buffer.alloc(0);
      while (end > 0 && out.length < n) {
        const start = Math.max(0, end - 65536), buf = Buffer.alloc(end - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        let data = Buffer.concat([buf, carry]), cut = start > 0 ? data.indexOf(10) : -1;
        carry = cut >= 0 ? data.subarray(0, cut) : Buffer.alloc(0);
        if (cut >= 0) data = data.subarray(cut + 1);
        const lines = data.toString('utf8').split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
          try { const m = JSON.parse(lines[i]); if (m.at < before) out.push(m); } catch { /* a torn line */ }
        }
        end = start;
      }
      return { messages: out.reverse(), done: out.length < n };
    } finally { fs.closeSync(fd); }
  }

  return {
    saveRoom(room, msg) { append(roomFile(room), msg); },
    room(room, n = 100, before) { return page(roomFile(room), n, before); },
    saveDm(a, b, msg) { append(dmFile(a, b), msg); },
    dm(a, b, n = 100, before) { return page(dmFile(a, b), n, before); },
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
