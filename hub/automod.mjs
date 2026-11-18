// Automod: checks what players write before the hub keeps or passes it on: chat messages and edits, private messages, names
// and profile text. A message that breaks a rule is not posted; its writer is told why (only they see it). Repeat offences
// within a short time mute the account for a while. Admins are not checked. The rules and their settings are changed in the
// admin panel's Automod tab (hub/admin.mjs: GET state -> automod, POST /admin/automod {config}); hits are logged there.
//
//   const am = createAutomod({ dir, mute, isAdmin, accountAge });
//   am.check(c, text, { where: 'channel'|'dm'|'edit'|'name'|'profile' }) -> null | { rule, reason }
import fs from 'node:fs';
import path from 'node:path';

// The built-in word list: slurs, kept rot13 so the source does not read as a list of them. `strict` terms are also found with
// letters spread out or hidden in other characters ("n.i.g", "f a g g o t"); the rest only as whole words (word* = any ending).
const rot = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 84) % 26) + 97));
const BUILTIN = {
  strict: ['avttre', 'avttn', 'snttbg'].map(rot),
  words: ['avtt*', 'snt', 'sntf', 'snttbg*', 'snttvg*', 'ergneq*', 'genaal*', 'genaavr*', 'puvax*', 'fcvp', 'fcvpf', 'jrgonpx*', 'xvxr*', 'tbbx*', 'pbba', 'pbbaf', 'xlf'].map(rot),
  phrases: ['xvyy lbhefrys', 'xvyy hfrys', 'tb qvr', 'unat lbhefrys'].map(rot),
};
export const DEFAULTS = {
  enabled: true,
  words: { on: true, builtin: true, custom: [], allow: [] },    // custom: extra words (word* for any ending); allow: never blocked
  spam: { on: true, repeats: 3, seconds: 60 },                   // the same message this many times in this long
  caps: { on: true, min: 16, percent: 75 },                      // mostly capital letters, in a message with at least `min` letters
  mentions: { on: true, max: 5 },                                // more different @people than this in one message
  chars: { on: true, run: 15 },                                  // one character repeated this many times, or piles of accents
  links: { on: true, newMinutes: 60, scams: true, blocked: [] }, // links from accounts younger than this; fake Steam/Discord sites
  strikes: { on: true, count: 3, minutes: 10, muteMinutes: 10 }, // this many hits in `minutes` mutes the account
};
// Real sites whose names scams imitate; any other domain with these words in it is treated as fake.
const REAL = ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steamusercontent.com', 'steam.tv', 'discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media', 'discordstatus.com'];
const LOOKALIKE = /st[e3][a4@]m|c[o0]mm?un|d[i1l]sc[o0]rd|n[i1]tr[o0]/;

const CONFUSABLE = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'ı': 'i', 'ℓ': 'l' };
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e', '£': 'l' };
// Lower case, accents and look-alike letters removed, digits and symbols read as the letters they stand in for.
export function normalize(text) {
  return String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\x00-\x7f]/g, (c) => CONFUSABLE[c] ?? c)
    .replace(/[0-9@$!|+€£]/g, (c, i, s) => (/[a-z]/.test(s[i - 1] ?? '') || /[a-z]/.test(s[i + 1] ?? '') ? LEET[c] ?? c : c));
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (w) => new RegExp(`(?<![a-z])${escRe(w.trim().toLowerCase()).replace(/\\\*/g, '[a-z]*').replace(/ /g, '\\s+')}(?![a-z])`);
const strictRe = (w) => new RegExp(w.split('').map((ch) => `${escRe(ch)}+`).join(''));

export function createAutomod({ dir = path.join(process.env.WS_CACHE ?? './ws-cache', 'admin'), mute = () => {}, isAdmin = () => false, accountAge = () => Infinity } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'automod.json'), logFile = path.join(dir, 'automod.jsonl');
  const merge = (c) => Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, typeof d === 'object' ? { ...d, ...(c?.[k] ?? {}) } : c?.[k] ?? d]));
  let config; try { config = merge(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { config = merge({}); }
  let compiled = null;
  const compile = () => {
    const allow = new Set(config.words.allow.map((w) => w.trim().toLowerCase()).filter(Boolean));
    const keep = (w) => w && !allow.has(w);
    compiled = {
      words: [...(config.words.builtin ? [...BUILTIN.words, ...BUILTIN.phrases] : []), ...config.words.custom.map((w) => w.trim().toLowerCase())].filter(keep).map(wordRe),
      strict: (config.words.builtin ? BUILTIN.strict : []).filter(keep).map(strictRe),
      blocked: config.links.blocked.map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean),
    };
  };
  compile();

  const recent = new Map();   // author -> [{ text, at }] (repeats)
  const strikes = new Map();  // author -> [times]
  const log = [];
  try { for (const l of fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-200)) log.push(JSON.parse(l)); } catch { /* none yet */ }

  function badWords(text) {
    const n = normalize(text);
    if (compiled.words.some((r) => r.test(n))) return true;
    // Single letters with gaps between them ("f a g", "n.i.g.g.a") read as one word; any start, since "a" may come first.
    for (const run of n.match(/(?<![a-z])[a-z](?:[\s._\-*~'"`,]+[a-z](?![a-z])){2,}/g) ?? []) {
      const w = run.replace(/[^a-z]/g, '');
      for (let i = 0; i < Math.min(w.length - 2, 4); i++) if (compiled.words.some((r) => r.test(w.slice(i)))) return true;
    }
    const letters = n.replace(/[^a-z]/g, '');
    return compiled.strict.some((r) => r.test(letters));
  }
  function linkProblem(c, text) {
    const urls = [...String(text).matchAll(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/?#][^\s]*)?/gi)].filter((m) => /^https?:\/\//i.test(m[0]) || /\.(com|net|org|gg|ru|xyz|io|me|tk|ly|link|site|online|shop|store|app|info|co)\b/i.test(m[1]));
    if (config.links.scams && /\bfree\b.{0,30}\bnitro\b|\bnitro\b.{0,30}\b(free|gift)\b|\bsteam\b.{0,30}\bgift\b.{0,30}\bfree\b/i.test(text)) return 'That looks like a scam.';
    if (!urls.length) return null;
    const hosts = urls.map((m) => m[1].toLowerCase().replace(/^www\./, ''));
    if (hosts.some((h) => compiled.blocked.some((d) => h === d || h.endsWith('.' + d)))) return 'That site is not allowed here.';
    if (config.links.scams && hosts.some((h) => LOOKALIKE.test(h) && !REAL.some((d) => h === d || h.endsWith('.' + d)))) return 'That link looks like a fake Steam or Discord site.';
    if (config.links.newMinutes > 0 && c.account && accountAge(c.account) < config.links.newMinutes * 60e3) return `New accounts can post links after ${config.links.newMinutes} minutes.`;
    return null;
  }

  function rules(c, text, where) {
    const t = String(text ?? '');
    if (!t) return null;
    if (config.words.on && badWords(t)) return ['words', where === 'name' || where === 'profile' ? 'That contains a word that is not allowed.' : 'Your message contains a word that is not allowed here.'];
    if (where === 'name' || where === 'profile') return null;
    if (config.links.on) { const p = linkProblem(c, t); if (p) return ['links', p]; }
    if (config.mentions.on) { const who = new Set([...t.matchAll(/@([a-z0-9_]{3,20})\b/gi)].map((m) => m[1].toLowerCase())); if (who.size > config.mentions.max) return ['mentions', `Too many mentions in one message (at most ${config.mentions.max}).`]; }
    if (config.chars.on && (new RegExp(`(.)\\1{${Math.max(4, config.chars.run - 1)},}`, 'u').test(t.replace(/\s+/g, ' ')) || /\p{M}{4,}/u.test(t))) return ['chars', 'Too many repeated characters.'];
    if (config.caps.on && where !== 'dm') {
      const letters = t.replace(/https?:\/\/\S+|:[a-z0-9_]+:|@\w+/gi, '').replace(/[^\p{L}]/gu, ''), up = letters.replace(/[^\p{Lu}]/gu, '').length;
      if (letters.length >= config.caps.min && up * 100 >= letters.length * config.caps.percent) return ['caps', 'Please don\'t write in all capitals.'];
    }
    if (config.spam.on && where !== 'edit') {
      const who = c.account ?? c.id, now = Date.now(), n = normalize(t).replace(/\s+/g, ' ').trim();
      const list = (recent.get(who) ?? []).filter((x) => now - x.at < config.spam.seconds * 1e3);
      list.push({ text: n, at: now }); recent.set(who, list.slice(-20));
      if (list.filter((x) => x.text === n).length >= config.spam.repeats) return ['spam', 'You sent that already. Please don\'t repeat messages.'];
    }
    return null;
  }

  function check(c, text, { where = 'channel', room = null } = {}) {
    if (!config.enabled || isAdmin(c)) return null;
    const hit = rules(c, text, where);
    if (!hit) return null;
    const [rule, reason] = hit, now = Date.now();
    const entry = { at: now, rule, reason, where, room, account: c.account ?? null, name: c.name ?? null, ip: c.ip ?? null, device: c.device ?? null, text: String(text).slice(0, 200) };
    let muted = false;
    if (config.strikes.on && c.account && where !== 'name' && where !== 'profile') {   // only messages count as strikes
      const list = (strikes.get(c.account) ?? []).filter((t) => now - t < config.strikes.minutes * 60e3);
      list.push(now); strikes.set(c.account, list);
      if (list.length >= config.strikes.count) {
        strikes.delete(c.account); muted = true;
        try { mute({ account: c.account }, config.strikes.muteMinutes, `Automod: ${list.length} blocked messages in ${config.strikes.minutes} minutes`); } catch (e) { console.error('automod mute:', e.message); }
      }
    }
    entry.muted = muted;
    log.push(entry); if (log.length > 200) log.shift();
    try { fs.appendFileSync(logFile, JSON.stringify(entry) + '\n'); } catch { /* disk */ }
    return { rule, reason: muted ? `${reason} You are muted for ${config.strikes.muteMinutes} minutes for repeated blocked messages.` : reason, muted };
  }

  return {
    check,
    // Throws with the reason (for names and profile text).
    assert(c, text, where = 'profile') { const r = check(c, text, { where }); if (r) throw Object.assign(Error(r.reason), { status: 400 }); },
    config: () => config,
    setConfig(c) {
      const list = (v, n, len) => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/)).map((s) => String(s).trim().slice(0, len)).filter(Boolean).slice(0, n);
      const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
      const b = merge(c), d = DEFAULTS;
      config = {
        enabled: !!b.enabled,
        words: { on: !!b.words.on, builtin: !!b.words.builtin, custom: list(b.words.custom, 500, 60), allow: list(b.words.allow, 200, 60) },
        spam: { on: !!b.spam.on, repeats: num(b.spam.repeats, 2, 20, d.spam.repeats), seconds: num(b.spam.seconds, 5, 3600, d.spam.seconds) },
        caps: { on: !!b.caps.on, min: num(b.caps.min, 4, 400, d.caps.min), percent: num(b.caps.percent, 50, 100, d.caps.percent) },
        mentions: { on: !!b.mentions.on, max: num(b.mentions.max, 1, 50, d.mentions.max) },
        chars: { on: !!b.chars.on, run: num(b.chars.run, 5, 100, d.chars.run) },
        links: { on: !!b.links.on, newMinutes: num(b.links.newMinutes, 0, 10080, d.links.newMinutes), scams: !!b.links.scams, blocked: list(b.links.blocked, 200, 100) },
        strikes: { on: !!b.strikes.on, count: num(b.strikes.count, 1, 50, d.strikes.count), minutes: num(b.strikes.minutes, 1, 1440, d.strikes.minutes), muteMinutes: num(b.strikes.muteMinutes, 1, 10080, d.strikes.muteMinutes) },
      };
      const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(config, null, 1)); fs.renameSync(t, file);
      compile();
      return config;
    },
    // What a message would hit, without logging or striking (the admin panel's tester).
    test(text, where = 'channel') { const r = config.enabled ? rules({ account: null, id: 'test' }, text, where) : null; recent.delete('test'); return r ? { rule: r[0], reason: r[1] } : null; },
    log: () => log.slice().reverse(),
  };
}
