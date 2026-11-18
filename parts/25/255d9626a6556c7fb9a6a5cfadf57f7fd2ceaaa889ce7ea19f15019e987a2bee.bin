// Chat, organised like Discord and drawn in Derma (web/derma.css): channels by category and private chats on the left, messages in the middle, the people here on
// the right, and Friends as its own view. The same app runs in the launcher (a large window) and in game (the overlay that
// web/overlay.js opens with Shift+Tab). Everything goes through the shared hub connection (web/hub.js).
//   mountChat(root, { hub, mode, onClose, onNotify, onEditProfile, onOpenSave }) -> { destroy, open(target), focus, visible(on) }
import { hubHttp } from './library.js';
import { account, authHeaders } from './account.js';
import { getProfile, cachedProfile, forget, onProfiles, avatarEl, displayName, imageUrl, nameHue, resizeImage } from './profiles.js';
import { dermaReady, icon } from './derma.js';
import { voiceClient } from './voice-chat.js';
import { dkConfirm, dkPrompt } from './modal.js';
import { openPicker, loadEmotes, onEmotes, emojiUrl, stickerUrl, stickerName, emojiNode, savedGifs, saveGif } from './emote-picker.js';

const P = 'garrys-wasm.';
const ls = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch { /* blocked */ } },
};
const FALLBACK_CHANNELS = [
  { name: 'announcements', label: 'announcements', category: "Garry's Web", topic: 'News about Garry\'s Web.', readonly: true },
  { name: 'general', label: 'general', category: "Garry's Web", topic: 'Talk about anything Garry\'s Mod.' },
  { name: 'help', label: 'help', category: "Garry's Web", topic: 'Problems starting or playing? Ask here.' },
  { name: 'looking-for-game', label: 'looking-for-game', category: 'Play', topic: 'Find people to play with.' },
  { name: 'showcase', label: 'showcase', category: 'Play', topic: 'Show your builds, saves and screenshots.' },
  { name: 'off-topic', label: 'off-topic', category: 'Other', topic: 'Anything else.' },
];
export const STATUS = { online: ['Online', '#23a55a'], idle: ['Idle', '#f0b232'], dnd: ['Do Not Disturb', '#f23f43'], invisible: ['Invisible', '#80848e'], offline: ['Offline', '#80848e'] };
const BULLET = { online: 'bullet_green', idle: 'bullet_yellow', dnd: 'bullet_red', invisible: 'bullet_black', offline: 'bullet_black' };
const si = (name, tip) => { const i = document.createElement('img'); i.className = 'si'; i.alt = tip ?? ''; i.src = icon(name); return i; };
const GROUP_MS = 7 * 60e3;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const h = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of kids) if (k != null) e.append(k); return e; };
const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function dayOf(t) {
  const d = new Date(t), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
}
const stamp = (t) => { const d = dayOf(t); return d === 'Today' ? `Today at ${timeOf(t)}` : d === 'Yesterday' ? `Yesterday at ${timeOf(t)}` : `${new Date(t).toLocaleDateString()} ${timeOf(t)}`; };

// Messages from channels and private chats in one shape.
function norm(m) {
  const common = { id: m.id, text: m.text ?? '', at: m.at, reply: m.reply, attach: m.attach, sticker: m.sticker, edited: m.edited, everyone: m.everyone };
  if (m.t === 'dm') return { ...common, key: 'a:' + m.from, account: m.from, name: m.name || m.from };
  return { ...common, key: m.from?.key ?? 'x:' + (m.from?.id ?? ''), account: m.from?.account, name: m.from?.name ?? '?', sys: m.sys };
}

// Text with **bold**, *italic*, `code`, links and @mentions, built as DOM nodes (never as HTML).
const TOKENS = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\bhttps?:\/\/[^\s<>"]+)|(@[a-z0-9_]{3,20}\b)|(\|\|[^|\n]+\|\|)|(:[a-z0-9_]{1,40}:)/gi;
function richText(text, me, everyone = null) {
  const out = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(TOKENS)) {
    if (m.index > last) out.append(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.append(h('code', null, t.slice(1, -1)));
    else if (m[2]) out.append(h('strong', null, t.slice(2, -2)));
    else if (m[3]) out.append(h('em', null, t.slice(1, -1)));
    else if (m[4]) { const a = h('a', null, t); a.href = t; a.target = '_blank'; a.rel = 'noopener noreferrer'; out.append(a); }
    else if (m[5]) {   // @someone shows their display name (click for their card); @everyone/@here only count from admins
      const u = t.slice(1).toLowerCase();
      if (u === 'everyone' || u === 'here') { out.append(everyone ? h('span', 'gwc-mention all', t) : t); last = m.index + t.length; continue; }
      const p = cachedProfile(u), s = h('span', 'gwc-mention' + (me && u === me ? ' me' : ''), '@' + (p ? displayName(p, u) : u));
      s.dataset.user = u; s.title = '@' + u; out.append(s);
    }
    else if (m[6]) { const s = h('span', 'gwc-spoiler', t.slice(2, -2)); s.title = 'Spoiler: click to show'; s.onclick = () => s.classList.add('shown'); out.append(s); }
    else if (m[7]) {   // :name: emojis; an unknown name stays as typed
      const url = emojiUrl(t.slice(1, -1));
      if (url) { const i = new Image(); i.alt = t; i.title = t; i.className = 'gw-emo'; i.draggable = false; if (url.startsWith(hubHttp() || '\u0000')) i.crossOrigin = 'anonymous'; i.src = url; out.append(i); } else out.append(t);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.append(text.slice(last));
  return out;
}
// A message of only emojis (up to 12) shows them large, as Discord does.
const onlyEmoji = (text) => { const t = text.trim(); return !!t && t.length < 200 && /^(?:\s*(?::[a-z0-9_]{1,40}:|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*))+\s*$/u.test(t) && (t.match(/:[a-z0-9_]+:|\p{Extended_Pictographic}/gu) ?? []).length <= 12; };
const mentionRe = (u) => new RegExp(`(?<![\\w\`])@${u}\\b`, 'i');
// A short "pling" for pings (no sound file to load).
let audioCtx = null;
function pingSound() {
  try {
    audioCtx ??= new AudioContext();
    const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.4);
  } catch { /* no audio */ }
}
const shareCode = (text) => /[?&]save=([A-Za-z0-9_-]{6,12})\b/.exec(text)?.[1] ?? null;

// The app's stylesheet, added to the page once (relative to this module, so it also works from the CDN).
export function chatStyles() {
  dermaReady();
  if (document.querySelector('link[data-gwc]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./chat-app.css', import.meta.url).href; l.dataset.gwc = '';
  document.head.append(l);
}

export function mountChat(root, { hub, mode = 'launcher', onClose = null, onNotify = () => {}, onEditProfile = () => {}, onOpenSave = null, onJoinGame = null } = {}) {
  chatStyles();
  root.classList.add('dk', 'gwc', 'gwc-' + mode);
  root.innerHTML = `
    <aside class="gwc-side">
      <header class="gwc-server"><img class="si" alt="" data-ic="world"><span>Garry's Web</span><small data-online></small></header>
      <nav class="gwc-nav" data-nav></nav>
      <div class="gwc-vbar" data-vbar hidden></div>
      <footer class="gwc-me" data-me></footer>
    </aside>
    <section class="gwc-main">
      <header class="gwc-head"><span class="gwc-title" data-title></span><span class="gwc-topic" data-topic></span><span class="gwc-tools">
        <button type="button" class="dk-btn" data-notif data-tip="Notification settings" aria-label="Notification settings"><img class="si" alt="" data-ic="bell"></button>
        <button type="button" class="dk-btn gwc-inboxbtn" data-inbox data-tip="Mentions and replies" aria-label="Mentions"><img class="si" alt="" data-ic="email_open"><span class="gwc-badge" data-inboxn hidden></span></button>
        <button type="button" class="dk-btn" data-members data-tip="Show or hide the people here" aria-label="People"><img class="si" alt="" data-ic="group"></button>
        ${onClose ? '<button type="button" class="dk-wbtn close" data-close data-tip="Close (Esc)" aria-label="Close"></button>' : ''}</span></header>
      <div class="gwc-body"><div class="gwc-scroll" data-scroll><div class="gwc-log" data-log aria-live="polite"></div></div><aside class="gwc-members" data-memberlist></aside></div>
      <div class="gwc-typing" data-typing></div>
      <form class="gwc-compose" data-compose autocomplete="off">
        <div class="gwc-suggest dk-menu" data-suggest hidden role="listbox"></div>
        <div class="gwc-replybar" data-replybar hidden></div>
        <div class="gwc-inputrow">
          <button type="button" class="dk-btn" data-attach data-tip="Add a picture" aria-label="Add a picture"><img class="si" alt="" data-ic="picture"></button>
          <textarea data-text rows="1" maxlength="400" aria-label="Message"></textarea>
          <button type="button" class="dk-btn gwc-pick" data-pick="gif" data-tip="GIFs" aria-label="GIFs"><img class="si" alt="" data-ic="film"></button>
          <button type="button" class="dk-btn gwc-pick" data-pick="sticker" data-tip="Stickers" aria-label="Stickers"><img class="si" alt="" data-ic="note"></button>
          <button type="button" class="dk-btn gwc-pick" data-pick="emoji" data-tip="Emojis" aria-label="Emojis"><img class="si" alt="" data-ic="emoticon_smile"></button>
          <button type="submit" class="dk-btn blue" data-send><img class="si" alt="" data-ic="comment">Send</button>
        </div>
      </form>
    </section>
    <div class="gwc-pop" data-pop hidden></div>
    <div class="gwc-wall" data-wall hidden><div class="dk-window gwc-wallbox"><div class="dk-title"><img class="si" alt="" data-ic="lock"><span>Chat needs an account</span></div>
      <div class="dk-panel"><p>Chat, private messages and friends are for Garry's Web accounts, so everyone you talk to has a name that is really theirs and moderation can work.</p>
      <p>Making one takes a few seconds and keeps your saves and settings with you too.</p><button type="button" class="dk-btn blue" data-wallgo><img class="si" alt="" data-ic="user_add">Sign in or create an account</button></div></div></div>`;
  const $ = (q) => root.querySelector(q);
  for (const i of root.querySelectorAll('[data-ic]')) i.src = icon(i.dataset.ic);
  const nav = $('[data-nav]'), logEl = $('[data-log]'), scroll = $('[data-scroll]'), text = $('[data-text]'), pop = $('[data-pop]');
  pop.classList.add('dk'); document.body.append(pop);   // pop-ups live on the page itself, above everything (removed in destroy)
  const memberList = $('[data-memberlist]'), typingEl = $('[data-typing]'), replyBar = $('[data-replybar]'), suggest = $('[data-suggest]');
  // Chat is for accounts only (the hub refuses guests too): without one, a wall asks to sign in.
  const drawWall = () => { $('[data-wall]').hidden = !!account(); };
  $('[data-wallgo]').onclick = () => onEditProfile();
  drawWall();

  // ---- State ----
  const logs = new Map(), done = new Map(), members = new Map(), typing = new Map(), mentions = new Map();
  let convos = [], view = ls.get('chat-view', { kind: 'channel', id: 'general' }), replyTo = null, editing = null, showMembers = ls.get('chat-members', mode !== 'overlay'), loadingOlder = false, shown = true;
  const read = ls.get('chat-read', {});
  // Notifications per channel or private chat: 'all' messages, only 'mentions' (and answers), or 'none'; muted ones also stay
  // quiet in the sidebar. Channels default to mentions, private chats to everything. Sounds can be turned off.
  const notif = ls.get('chat-notify', {}), mutedK = ls.get('chat-muted', {}), noEveryone = ls.get('chat-noeveryone', {});
  let sounds = ls.get('chat-sound', true), replyPing = ls.get('chat-replyping', true);
  const level = (k) => notif[k] ?? (k.startsWith('d:') ? 'all' : 'mentions');
  const saveNotif = () => { ls.set('chat-notify', notif); ls.set('chat-muted', mutedK); ls.set('chat-noeveryone', noEveryone); };
  const newSince = new Map();   // conversation -> its read time when it was opened (the "New" line)
  const keyOf = (v = view) => (v.kind === 'channel' ? 'c:' + v.id : v.kind === 'dm' ? 'd:' + v.with : 'friends');
  const whereOf = (v = view) => (v.kind === 'channel' ? { room: v.id } : { with: v.with });
  const channels = () => (hub.roomList?.length && hub.roomList[0].category ? hub.roomList : FALLBACK_CHANNELS);
  const channel = (id) => channels().find((c) => c.name === id);
  if (view.kind === 'channel' && !channel(view.id)) view = { kind: 'channel', id: 'general' };
  if (view.kind === 'dm' && !account()) view = { kind: 'channel', id: 'general' };
  const myAccount = () => hub.account ?? null;
  const myKey = () => hub.me?.key ?? null;
    const lastAt = (k) => logs.get(k)?.at(-1)?.at ?? 0;
  const unread = (k) => lastAt(k) > (read[k] ?? 0) && logs.get(k)?.at(-1)?.key !== myKey();
  const markRead = (k = keyOf()) => { if (k === 'friends') return; const t = lastAt(k); if (t > (read[k] ?? 0)) { read[k] = t; ls.set('chat-read', read); } mentions.delete(k); drawInboxBadge(); };
  // Does this message ping me? @me, an answer to my message (with its ping on), or an admin's @everyone/@here.
  const pingsMe = (m) => {
    const me = myAccount(); if (!me || m.key === myKey()) return false;
    return mentionRe(me).test(m.text ?? '') || (m.reply?.account === me && m.reply.ping) || (!!m.everyone && !noEveryone[keyOf()]);
  };
  // Mentions in a channel: the hub's kept pings (hub.pings) newer than the last time that channel was read.
  const pingCount = (k) => {
    if (!k.startsWith('c:')) return mentions.get(k) ?? 0;
    const room = k.slice(2), since = read[k] ?? 0;
    return (hub.pings ?? []).filter((p) => p.room === room && p.at > since && !(p.kind !== 'mention' && p.kind !== 'reply' && noEveryone[k])).length;
  };
  // A message is only "seen" when the chat is on screen and the window has focus.
  const looking = () => shown && document.visibilityState === 'visible';
  const presence = (u) => (u ? hub.presence?.get(u) ?? { user: u, status: 'offline' } : null);

  // ---- Sidebar ----
  function drawNav() {
    const frag = document.createDocumentFragment();
    const friendsBtn = h('button', 'gwc-navitem' + (view.kind === 'friends' ? ' on' : ''), si('group'), h('span', 'gwc-label', 'Friends'));
    const pending = hub.friends?.incoming?.length ?? 0;
    if (pending) friendsBtn.append(h('span', 'gwc-badge', String(pending)));
    friendsBtn.onclick = () => open({ kind: 'friends', tab: pending ? 'pending' : 'online' });
    frag.append(friendsBtn);
    let cat = null;
    for (const c of channels()) {
      if (c.category !== cat) { cat = c.category; frag.append(h('div', 'gwc-cat', si(cat === 'Play' ? 'controller' : cat === 'Other' ? 'folder' : 'world'), h('span', null, cat))); }
      const k = 'c:' + c.name, b = h('button', 'gwc-navitem gwc-chan' + (view.kind === 'channel' && view.id === c.name ? ' on' : '') + (unread(k) && !mutedK[k] ? ' unread' : '') + (mutedK[k] ? ' muted' : ''), si(c.readonly ? 'sound' : 'comments'), h('span', 'gwc-label', c.label ?? c.name));
      if (mutedK[k]) b.append(si('sound_mute', 'Muted'));
      const n = pingCount(k); if (n) b.append(h('span', 'gwc-badge', String(n)));
      b.onclick = () => open({ kind: 'channel', id: c.name });
      b.oncontextmenu = (e) => { e.preventDefault(); notifMenu(k, b); };
      frag.append(b);
    }
    drawVoice(frag);
    const dmHead = h('div', 'gwc-cat gwc-dmcat', si('email'), h('span', null, 'Private messages'));
    if (myAccount()) { const add = h('button', 'gwc-add', '+'); add.title = 'Start a private chat'; add.onclick = async () => { const u = await dkPrompt('Who do you want to message? (their Garry\'s Web username)', { title: 'New private chat', placeholder: 'username', ok: 'Message' }); if (u?.trim()) open({ kind: 'dm', with: u.trim().toLowerCase().replace(/^@/, '') }); }; dmHead.append(add); }
    frag.append(dmHead);
    for (const c of convos) {
      const k = 'd:' + c.with, p = cachedProfile(c.with);
      const b = h('button', 'gwc-navitem gwc-dm' + (view.kind === 'dm' && view.with === c.with ? ' on' : '') + (unread(k) || (c.unread && !(read[k] >= c.last.at)) ? ' unread' : ''));
      b.append(si(BULLET[presence(c.with).status] ?? 'bullet_black'), h('span', 'gwc-label', displayName(p, c.with)));
      if (mutedK[k]) { b.classList.add('muted'); b.append(si('sound_mute', 'Muted')); }
      if (mentions.get(k)) b.append(h('span', 'gwc-badge', String(mentions.get(k))));
      b.onclick = () => open({ kind: 'dm', with: c.with });
      b.oncontextmenu = (e) => { e.preventDefault(); notifMenu(k, b); };
      frag.append(b);
    }
    nav.replaceChildren(frag);
    const n = hub.presence?.size ?? 0; $('[data-online]').textContent = hub.state === 'online' ? `${hub.online ?? 0} here${n ? ` · ${n} signed in` : ''}` : hub.state === 'connecting' ? 'connecting…' : hub.state === 'banned' ? 'banned' : 'offline';
    drawMe();
  }
  // A custom status: its emoji (Unicode or :name:) and text; `fallback` when there is none.
  function statusBits(p, fallback, size = 14) {
    const out = [];
    if (p?.custom?.emoji) out.push(emojiNode(p.custom.emoji, size), ' ');
    if (p?.custom?.text) out.push(p.custom.text);
    return out.length ? out : [fallback];
  }
  // ---- Voice channels (web/voice-chat.js, hub/voice.mjs) ----
  const vc = voiceClient(hub);
  const canManage = (ch) => ch?.kind === 'temp' && (ch.owner === myAccount() || hub.isAdmin);
  function drawVoice(frag) {
    if (!vc.channels.length) return;
    frag.append(h('div', 'gwc-cat', si('sound'), h('span', null, 'Voice')));
    for (const ch of vc.channels) {
      const here = vc.current === ch.id, b = h('button', 'gwc-navitem gwc-vc' + (here ? ' on' : '') + (ch.kind === 'create' ? ' create' : ''),
        si(ch.kind === 'create' ? 'add' : ch.locked ? 'lock' : 'sound'), h('span', 'gwc-label', ch.name));
      if (ch.limit) b.append(h('small', 'gwc-vlimit', `${ch.members.length}/${ch.limit}`));
      if (canManage(ch)) { const g = h('span', 'gwc-vgear', si('cog')); g.dataset.tip = 'Channel settings'; g.onclick = (e) => { e.stopPropagation(); voiceSettings(ch.id); }; b.append(g); }
      b.dataset.tip = ch.kind === 'create' ? 'Join to make a voice channel of your own' : here ? 'You are here' : ch.locked ? 'Private: the owner lets people in' : 'Join voice';
      b.onclick = () => joinVoice(ch.id);
      frag.append(b);
      for (const m of ch.members ?? []) {
        const talking = vc.speaking.has(m.id), row = h('div', 'gwc-vmember' + (talking ? ' talking' : ''),
          si(m.deafened ? 'sound_none' : m.muted ? 'sound_mute' : talking ? 'sound' : 'bullet_green'), h('span', 'gwc-label', displayName(cachedProfile(m.account), m.name)));
        if (ch.owner && m.account === ch.owner) row.append(si('key', 'Owner'));
        if (vc.problems.has(m.id)) { row.classList.add('bad'); row.dataset.tip = vc.problems.get(m.id); }
        frag.append(row);
      }
    }
  }
  async function joinVoice(id) {
    if (!myAccount()) { sysNote('Sign in to a Garry\'s Web account (Profile) to use voice channels.'); return; }
    if (vc.current === id) return;
    try { await vc.join(id); } catch (e) { sysNote(e.message); }
  }
  function drawVoiceBar() {
    const bar = $('[data-vbar]'), ch = vc.channel();
    bar.hidden = !vc.current;
    if (!vc.current) { bar.replaceChildren(); return; }
    const btn = (ic, tip, fn, on) => { const b = h('button', 'dk-btn' + (on ? ' down' : ''), si(ic)); b.type = 'button'; b.dataset.tip = tip; b.onclick = fn; return b; };
    bar.replaceChildren(h('span', 'gwc-vinfo', h('b', null, 'Voice connected'), h('small', null, ch?.name ?? '')),
      btn(vc.muted ? 'sound_mute' : 'sound', vc.muted ? 'Unmute' : 'Mute', () => vc.setMuted(!vc.muted), vc.muted),
      btn('sound_none', vc.deafened ? 'Undeafen' : 'Deafen (hear nobody)', () => vc.setDeafened(!vc.deafened), vc.deafened),
      ...(canManage(ch) ? [btn('cog', 'Channel settings', () => voiceSettings(ch.id))] : []),
      btn('telephone_delete', 'Leave voice', () => vc.leave()));
  }
  // The owner's window for a "Join to create" channel: name, private, user limit, who is in, who asked to join, invites.
  const knocks = new Map();   // channel id -> Map(account -> name)
  function voiceSettings(id) {
    document.querySelector('.gwc-vset')?.remove();
    const ch = vc.channels.find((c) => c.id === id); if (!ch) return;
    const w = h('div', 'dk dk-window pop gwc-vset'); w.setAttribute('role', 'dialog');
    const draw = () => {
      const cur = vc.channels.find((c) => c.id === id); if (!cur) { w.remove(); return; }
      w.innerHTML = `<div class="dk-title"><img class="si" alt="" src="${icon('sound')}"><span></span><span class="dk-tinfo"></span><button type="button" class="dk-wbtn close" data-x aria-label="Close"></button></div>
        <div class="dk-panel"><label class="gwc-vfield"><span>Name</span><input data-name maxlength="32"></label>
          <label class="gwc-vfield"><span>Private</span><input type="checkbox" data-locked> <small>only people you let in can join</small></label>
          <label class="gwc-vfield"><span>User limit</span><input type="number" min="0" max="16" data-limit> <small>0 = no limit</small></label>
          <div class="gwc-vsect">In the channel</div><div data-members></div>
          <div class="gwc-vsect" data-khead>Asked to join</div><div data-knocks></div>
          <div class="gwc-vsect">Let someone in</div><form class="gwc-vfield" data-inv><input data-user maxlength="20" placeholder="username" spellcheck="false"><button class="dk-btn">Allow</button></form>
          <div class="gwc-cardbtns"><button type="button" class="dk-btn blue" data-save>Save</button><button type="button" class="dk-btn" data-x>Close</button></div></div>`;
      w.querySelector('.dk-title span').textContent = `${cur.name} settings`;
      w.querySelector('[data-name]').value = cur.name; w.querySelector('[data-locked]').checked = cur.locked; w.querySelector('[data-limit]').value = cur.limit || 0;
      const mem = w.querySelector('[data-members]');
      for (const m of cur.members) {
        const row = h('div', 'dk-row', si(m.account === cur.owner ? 'key' : 'user'), h('span', 'gwc-label', displayName(cachedProfile(m.account), m.name)));
        if (m.account !== cur.owner) {
          const k = h('button', 'dk-btn', 'Kick'); k.type = 'button'; k.onclick = () => hub.send({ t: 'vc-kick', id, user: m.account });
          const o = h('button', 'dk-btn', 'Make owner'); o.type = 'button'; o.onclick = () => hub.send({ t: 'vc-transfer', id, user: m.account });
          row.append(o, k);
        }
        mem.append(row);
      }
      const kn = w.querySelector('[data-knocks]'), list = [...(knocks.get(id) ?? new Map())];
      w.querySelector('[data-khead]').hidden = !list.length;
      for (const [u, name] of list) {
        const row = h('div', 'dk-row', si('user_add'), h('span', 'gwc-label', `${name} (@${u})`));
        const ok = h('button', 'dk-btn blue', 'Let in'); ok.type = 'button'; ok.onclick = () => { hub.send({ t: 'vc-allow', id, user: u }); knocks.get(id)?.delete(u); draw(); };
        const no = h('button', 'dk-btn', 'Ignore'); no.type = 'button'; no.onclick = () => { hub.send({ t: 'vc-deny', id, user: u }); knocks.get(id)?.delete(u); draw(); };
        row.append(ok, no); kn.append(row);
      }
      w.querySelector('[data-inv]').onsubmit = (e) => { e.preventDefault(); const u = w.querySelector('[data-user]').value.trim().toLowerCase().replace(/^@/, ''); if (u) { hub.send({ t: 'vc-allow', id, user: u }); w.querySelector('[data-user]').value = ''; } };
      w.querySelector('[data-save]').onclick = () => { hub.send({ t: 'vc-edit', id, name: w.querySelector('[data-name]').value, locked: w.querySelector('[data-locked]').checked, limit: +w.querySelector('[data-limit]').value || 0 }); w.remove(); };
      for (const x of w.querySelectorAll('[data-x]')) x.onclick = () => w.remove();
      for (const i of w.querySelectorAll('input')) i.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    };
    draw(); document.body.append(w);
    w.redraw = draw;
  }
  function withDot(av, status) { const w = h('span', 'gwc-av'); w.append(av, h('i', 'gwc-dot s-' + (status ?? 'offline'))); return w; }
  function drawMe() {
    const el = $('[data-me]'), a = myAccount(), p = a ? cachedProfile(a) : null, st = a ? hub.myStatus ?? 'online' : 'online';
    const info = h('span', 'gwc-meinfo', h('b', null, a ? displayName(p, a) : hub.name), h('small', null, ...(a ? statusBits(p, STATUS[st][0]) : ['Guest · not signed in'])));
    const av = withDot(avatarEl(p, hub.name, 32), a ? st : 'online');
    const status = h('button', 'dk-btn', si(BULLET[a ? st : 'online'])); status.dataset.tip = 'Set your status';
    status.onclick = (e) => { if (!a) return onEditProfile(); statusMenu(e.currentTarget); };
    const gear = h('button', 'dk-btn', si('cog')); gear.dataset.tip = a ? 'Edit your profile' : 'Sign in'; gear.onclick = () => onEditProfile();
    av.style.cursor = 'pointer'; av.onclick = (e) => (a ? profileCard(a, e.currentTarget) : onEditProfile());
    el.replaceChildren(av, info, status, gear);
  }
  function statusMenu(anchor) {
    const list = h('div', 'dk-menu');
    for (const s of ['online', 'idle', 'dnd', 'invisible']) {
      const b = h('button', null, si(BULLET[s]), STATUS[s][0]);
      if (s === 'invisible') b.title = 'You appear offline but can still chat';
      b.onclick = () => { hub.setStatus(s); closePop(); drawNav(); };
      list.append(b);
    }
    openPop(list, anchor);
  }

  // ---- Messages ----
  function head() {
    const t = $('[data-title]'), tp = $('[data-topic]');
    if (view.kind === 'channel') { const c = channel(view.id); t.textContent = c?.label ?? view.id; tp.textContent = c?.topic ?? ''; }
    else if (view.kind === 'dm') { const p = cachedProfile(view.with); t.textContent = displayName(p, view.with); tp.textContent = presence(view.with).activity?.detail ?? STATUS[presence(view.with).status]?.[0] ?? ''; }
    else { t.textContent = 'Friends'; tp.textContent = ''; }
    root.classList.toggle('gwc-nomembers', !showMembers || view.kind === 'friends');
    $('[data-title]').prepend(si(view.kind === 'channel' ? 'comments' : view.kind === 'dm' ? 'user' : 'group'));
    $('[data-members]').hidden = view.kind === 'friends';
    $('[data-notif]').hidden = view.kind === 'friends';
  }
  function placeholder() {
    const c = view.kind === 'channel' ? channel(view.id) : null;
    const ok = hub.state === 'online' && (view.kind === 'channel' ? !(c?.readonly && !hub.isAdmin) : !!myAccount());
    text.disabled = !ok || view.kind === 'friends';
    text.placeholder = hub.state === 'off' ? 'Chat is not set up for this copy of the game.' : hub.state === 'banned' ? 'You are banned from chat.'
      : hub.state !== 'online' ? 'Connecting to chat…' : c?.readonly && !hub.isAdmin ? 'Only admins post here.'
      : view.kind === 'channel' ? `Message #${c?.label ?? view.id}` : view.kind === 'dm' ? `Message @${displayName(cachedProfile(view.with), view.with)}` : '';
    $('[data-compose]').hidden = view.kind === 'friends';
    $('[data-attach]').hidden = !myAccount();
  }
  const atBottom = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
  function drawLog({ keep = false } = {}) {
    if (view.kind === 'friends') { drawFriends(); return; }
    const k = keyOf(), list = logs.get(k), was = atBottom(), fromBottom = scroll.scrollHeight - scroll.scrollTop;
    const frag = document.createDocumentFragment();
    if (!list) frag.append(h('div', 'gwc-empty', 'Loading…'));
    else {
      if (done.get(k)) {
        const intro = h('div', 'gwc-intro');
        if (view.kind === 'channel') { const c = channel(view.id); intro.append(h('h2', null, `Welcome to #${c?.label ?? view.id}!`), h('p', null, `${c?.topic ?? ''} Messages here are public and kept; be nice.`)); }
        else { const p = cachedProfile(view.with); intro.append(avatarEl(p, view.with, 72), h('h2', null, displayName(p, view.with)), h('p', null, `This is the beginning of your private chat with @${view.with}. Only the two of you can read it.`)); }
        frag.append(intro);
      }
      let prev = null, day = '', newShown = false;
      const since = newSince.get(k) ?? Infinity;
      for (const m of list) {
        const d = dayOf(m.at);
        if (d !== day) { day = d; frag.append(h('div', 'gwc-day', h('span', null, d))); prev = null; }
        if (!newShown && !m.sys && m.at > since && m.key !== myKey()) { newShown = true; frag.append(h('div', 'gwc-newline', h('span', null, 'New'))); prev = null; }
        frag.append(msgEl(m, prev && !m.sys && !prev.sys && prev.key === m.key && m.at - prev.at < GROUP_MS && !m.reply));
        prev = m;
      }
    }
    logEl.replaceChildren(frag);
    if (keep) scroll.scrollTop = scroll.scrollHeight - fromBottom;
    else if (was || !keep) scroll.scrollTop = scroll.scrollHeight;
    if (looking() && atBottom()) markRead();
  }
  function msgEl(m, compact) {
    if (m.sys) return h('div', 'gwc-sys' + (m.cls ? ' ' + m.cls : ''), m.sys);
    const row = h('div', 'gwc-msg' + (compact ? ' compact' : '') + (m.key === myKey() ? ' mine' : ''));
    row.dataset.id = m.id ?? '';
    const me = myAccount();
    if (pingsMe(m)) row.classList.add('mentioned');
    const p = m.account ? cachedProfile(m.account) : null;
    if (m.account && !p) getProfile(m.account).then((x) => { if (x) scheduleRedraw(); });
    if (m.reply) {
      const r = h('div', 'gwc-replyto', si('arrow_undo'), h('b', null, m.reply.name), ' ', String(m.reply.text ?? '').slice(0, 100) || '(picture)');
      r.onclick = () => { const t = logEl.querySelector(`[data-id="${CSS.escape(m.reply.id)}"]`); if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); } };
      row.append(r);
    }
    if (compact) row.append(h('time', 'gwc-side-time', timeOf(m.at)));
    else {
      const av = avatarEl(p, m.name, 32); av.classList.add('gwc-msgav'); av.onclick = (e) => profileCard(m.account, e.currentTarget, m.name);
      const name = h('b', 'gwc-name', displayName(p, m.name)); name.onclick = (e) => profileCard(m.account, e.currentTarget, m.name);
      name.style.color = p?.accent || `hsl(${nameHue(m.account ?? m.name)} 65% 38%)`;
      const top = h('div', 'gwc-top', name);
      if (!m.account) top.append(h('span', 'gwc-tag', 'guest'));
      top.append(h('time', null, stamp(m.at)));
      row.append(av, top);
    }
    const body = h('div', 'gwc-text');
    if (m.text) { body.append(richText(m.text, me, m.everyone)); if (onlyEmoji(m.text)) body.classList.add('jumbo'); }
    if (m.edited) body.append(h('small', 'gwc-edited', ' (edited)'));
    row.append(body);
    for (const a of m.attach ?? []) {
      const url = `${hubHttp()}chat/img/${a.name}`, img = new Image(); img.src = url; img.alt = 'Picture'; img.loading = 'lazy'; img.crossOrigin = 'anonymous';
      if (a.w && a.h) { const k = Math.min(1, 360 / a.w, 280 / a.h); img.width = Math.round(a.w * k); img.height = Math.round(a.h * k); }
      const link = h('a', 'gwc-pic', img); link.href = url; link.target = '_blank'; link.rel = 'noopener'; row.append(link);
      if (/\.gif$/.test(a.name)) {   // GIFs can be saved to the picker's GIF tab
        const saved = savedGifs().some((x) => x.name === a.name), star = h('button', 'gwc-gifstar' + (saved ? ' on' : ''), si('star'));
        star.type = 'button'; star.dataset.tip = saved ? 'Saved to your GIFs' : 'Save to your GIFs';
        star.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const on = !star.classList.contains('on'); saveGif(a, on); star.classList.toggle('on', on); star.dataset.tip = on ? 'Saved to your GIFs' : 'Save to your GIFs'; };
        link.append(star);
      }
    }
    if (m.sticker) {
      const url = stickerUrl(m.sticker);
      if (url) { const img = new Image(); img.src = url; img.alt = img.title = stickerName(m.sticker); img.className = 'gwc-sticker'; img.loading = 'lazy'; if (url.startsWith(hubHttp() || '\u0000')) img.crossOrigin = 'anonymous'; row.append(img); }
      else row.append(h('div', 'gwc-sys', 'A sticker that was removed.'));
    }
    const code = shareCode(m.text);
    if (code) row.append(shareEmbed(code));
    if (m.id) row.append(toolbar(m));
    return row;
  }
  function toolbar(m) {
    const bar = h('div', 'gwc-msgtools'), mine = m.key === myKey(), canDel = mine || (view.kind === 'channel' && hub.isAdmin);
    const btn = (ic, title, fn) => { const b = h('button', 'dk-btn', si(ic, title)); b.dataset.tip = title; b.type = 'button'; b.onclick = (e) => { e.stopPropagation(); fn(e.currentTarget); }; bar.append(b); };
    btn('arrow_undo', 'Reply', () => { replyTo = m; editing = null; drawReplyBar(); text.focus(); });
    if (mine) btn('pencil', 'Edit', () => startEdit(m));
    btn('page_copy', 'Copy text', () => navigator.clipboard?.writeText(m.text).catch(() => {}));
    if (canDel) btn('delete', 'Delete', async () => { if (await dkConfirm('Delete this message for everyone?', { title: 'Delete message', ok: 'Delete', danger: true })) hub.remove(whereOf(), m.id); });
    return bar;
  }
  function shareEmbed(code) {
    const card = h('div', 'gwc-embed', h('span', 'gwc-embedtag', si('disk'), ' Shared save'), h('b', null, 'Loading…'));
    const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.crossOrigin = 'anonymous'; img.src = `${hubHttp()}share/${code}/thumb`; img.onerror = () => img.remove();
    card.prepend(img);
    fetch(`${hubHttp()}share/${code}`).then((r) => (r.ok ? r.json() : null)).then((s) => {
      card.querySelector('b').textContent = s ? s.name : 'This share was removed.';
      if (!s) return;
      card.append(h('small', null, `${s.map || 'unknown map'} · by ${s.author} · ${s.downloads} download${s.downloads === 1 ? '' : 's'}`));
      if (onOpenSave) { const b = h('button', 'dk-btn blue', si('controller'), mode === 'overlay' ? 'Add to my saves' : 'Play this save'); b.type = 'button'; b.onclick = () => onOpenSave(code, s); card.append(b); }
    }).catch(() => {});
    return card;
  }
  let redrawTimer = 0;
  const scheduleRedraw = () => { if (!redrawTimer) redrawTimer = requestAnimationFrame(() => { redrawTimer = 0; drawLog({ keep: true }); drawNav(); drawMembers(); head(); }); };

  // ---- People here / friends ----
  function personRow(u, name, status, activity) {
    const p = u ? cachedProfile(u) : null;
    if (u && !p) getProfile(u).then((x) => { if (x) scheduleRedraw(); });
    const row = h('button', 'gwc-person' + (status === 'offline' ? ' off' : ''));
    row.append(si(BULLET[status] ?? 'bullet_green'), h('span', 'gwc-pinfo', h('b', null, displayName(p, name)), h('small', null, ...(activity?.detail ? [activity.detail] : statusBits(p, u ? '' : 'guest')))));
    row.onclick = (e) => profileCard(u, e.currentTarget, name);
    return row;
  }
  function drawMembers() {
    if (!showMembers || view.kind === 'friends') { memberList.replaceChildren(); return; }
    const frag = document.createDocumentFragment();
    if (view.kind === 'dm') { frag.append(profilePanel(view.with)); memberList.replaceChildren(frag); return; }
    const here = [...(members.get(view.id)?.values() ?? [])], accountsHere = new Map(), guests = [];
    for (const u of here) { if (u.account) accountsHere.set(u.account, u); else guests.push(u); }
    const groups = { online: [], idle: [], dnd: [] };
    for (const [acct, u] of accountsHere) { const pr = presence(acct); (groups[pr.status] ?? groups.online).push([acct, u.name, pr]); }
    const section = (title, list) => { if (!list.length) return; frag.append(h('div', 'gwc-cat', h('span', null, `${title} (${list.length})`))); for (const [acct, name, pr] of list) frag.append(personRow(acct, name, pr.status, pr.activity)); };
    section('Online', groups.online); section('Idle', groups.idle); section('Do not disturb', groups.dnd);
    if (guests.length) { frag.append(h('div', 'gwc-cat', h('span', null, `Guests (${guests.length})`))); for (const g of guests) frag.append(personRow(null, g.name, 'online', null)); }
    memberList.replaceChildren(frag);
  }
  function profilePanel(u, name) {
    const p = u ? cachedProfile(u) : null, pr = presence(u);
    if (u && !p) getProfile(u).then((x) => { if (x) scheduleRedraw(); });
    const card = h('div', 'gwc-card dk-window');
    const banner = h('div', 'gwc-banner');
    if (p?.bannerImg) banner.style.backgroundImage = `url("${imageUrl(p.bannerImg)}")`; else banner.style.background = p?.banner || p?.accent || `hsl(${nameHue(u ?? name ?? '')} 35% 30%)`;
    const av = withDot(avatarEl(p, name ?? u, 80), u ? pr.status : 'online'); av.classList.add('gwc-cardav');
    card.append(banner, av);
    const body = h('div', 'gwc-cardbody', h('h3', null, displayName(p, name ?? u)), h('div', 'gwc-handle', u ? `@${u}${p?.pronouns ? ' · ' + p.pronouns : ''}` : 'Guest (no account)'));
    if (p?.custom?.text || p?.custom?.emoji) body.append(h('div', 'gwc-custom', ...statusBits(p, '', 20)));
    const act = pr?.activity;
    if (act?.kind === 'launcher') body.append(h('div', 'gwc-activity quiet', si('application'), h('span', null, 'In the launcher')));
    else if (act?.detail) body.append(h('div', 'gwc-activity', h('small', null, 'Playing Garry\'s Web'), h('b', null, act.kind === 'game' ? act.map || 'A map' : act.kind === 'menu' ? 'Main menu' : act.detail), act.edition ? h('span', null, act.edition) : null));
    if (p?.bio) body.append(h('div', 'gwc-sect', 'About me'), h('p', 'gwc-bio', p.bio));
    if (p?.favorite) body.append(h('div', 'gwc-sect', 'Favourite map or mode'), h('p', null, p.favorite));
    if (p?.links?.length) { const l = h('div', 'gwc-links'); for (const url of p.links) { const a = h('a', null, url.replace(/^https:\/\/(www\.)?/, '').slice(0, 40)); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; l.append(a); } body.append(h('div', 'gwc-sect', 'Links'), l); }
    if (p?.since) body.append(h('div', 'gwc-sect', 'Member since'), h('p', null, new Date(p.since).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })));
    const me = myAccount();
    if (u && me && u !== me) {
      const f = hub.friends ?? {}, row = h('div', 'gwc-cardbtns');
      const btn = (label, fn, cls = 'dk-btn') => { const b = h('button', cls, label); b.type = 'button'; b.onclick = () => { fn(); closePop(); }; row.append(b); };
      btn('Message', () => open({ kind: 'dm', with: u }), 'dk-btn blue');
      const isFriend = f.friends?.some((x) => x.user === u);
      if (isFriend && onJoinGame) row.append(joinButton(u, closePop));
      if (isFriend) btn('Remove friend', async () => (await dkConfirm(`Remove ${u} from your friends?`, { title: 'Remove friend', ok: 'Remove', danger: true })) && hub.friend('friend-remove', u));
      else if (f.incoming?.includes(u)) btn('Accept friend request', () => hub.friend('friend-accept', u));
      else if (f.outgoing?.includes(u)) btn('Request sent', () => hub.friend('friend-remove', u));
      else btn('Add friend', () => hub.friend('friend-add', u));
      if (f.blocked?.includes(u)) btn('Unblock', () => hub.friend('unblock', u)); else btn('Block', async () => (await dkConfirm(`Block ${u}? You will not see their private messages or requests.`, { title: 'Block', ok: 'Block', danger: true })) && hub.friend('block', u));
      body.append(row);
    } else if (u && u === me) {
      const b = h('button', 'dk-btn blue', 'Edit profile'); b.type = 'button'; b.onclick = () => { closePop(); onEditProfile(); }; body.append(h('div', 'gwc-cardbtns', b));
    }
    card.append(body);
    return card;
  }
  // Join a friend's game (one they host, listed on the hub): the launcher starts the game and joins; in game it joins now.
  function joinButton(u, after = () => {}) {
    const g = presence(u)?.game, b = h('button', 'dk-btn blue gwc-join', si('controller'), 'Join game');
    b.type = 'button';
    const full = g && g.max && g.players >= g.max;
    b.disabled = !g || full || g.locked;
    b.dataset.tip = !g ? `${displayName(cachedProfile(u), u)} is not hosting a game right now` : full ? `${g.name} is full (${g.players}/${g.max})` : g.locked ? `${g.name} is password protected` : `${g.name}${g.map ? ' · ' + g.map : ''} · ${g.players}/${g.max} players · ${g.edition === 'extended' ? 'Extended' : 'Garry\'s Mod'}`;
    b.onclick = () => { if (!b.disabled) { after(); onJoinGame(g, u); } };
    return b;
  }
  function profileCard(u, anchor, name) { openPop(profilePanel(u, name), anchor, 'card'); }
  function drawFriends() {
    const f = hub.friends ?? { friends: [], incoming: [], outgoing: [], blocked: [] }, tab = view.tab ?? 'online';
    const wrap = h('div', 'gwc-friends');
    const tabs = h('div', 'gwc-tabs');
    for (const [id, label] of [['online', 'Online'], ['all', 'All'], ['pending', `Pending${f.incoming.length ? ` (${f.incoming.length})` : ''}`], ['blocked', 'Blocked'], ['add', 'Add friend']]) {
      const b = h('button', 'dk-btn' + (tab === id ? ' down' : '') + (id === 'add' ? ' blue' : ''), label); b.type = 'button'; b.onclick = () => open({ kind: 'friends', tab: id }); tabs.append(b);
    }
    wrap.append(tabs);
    if (!myAccount()) { wrap.append(h('p', 'gwc-hint', 'Friends are between Garry\'s Web accounts. Sign in or create one in your profile.')); logEl.replaceChildren(wrap); return; }
    const row = (u, ...buttons) => {
      const pr = presence(u), r = personRow(u, u, pr.status, pr.activity);
      const box = h('div', 'gwc-frow'); box.append(r);
      for (const [label, fn, cls] of buttons) { const b = h('button', 'dk-btn' + (cls === 'primary' ? ' blue' : ''), label); b.type = 'button'; b.onclick = fn; box.append(b); }
      return box;
    };
    if (tab === 'add') {
      const form = h('form', 'gwc-addfriend');
      form.innerHTML = '<p>Add a friend by their Garry\'s Web username.</p><div><input name="u" maxlength="20" placeholder="username" spellcheck="false" autocomplete="off"><button class="dk-btn blue">Send friend request</button></div><p class="gwc-hint" data-fmsg></p>';
      form.onsubmit = (e) => { e.preventDefault(); const u = form.u.value.trim().toLowerCase().replace(/^@/, ''); if (!u) return; hub.friend('friend-add', u); form.querySelector('[data-fmsg]').textContent = `Friend request sent to ${u} (if that account exists).`; form.u.value = ''; };
      wrap.append(form); logEl.replaceChildren(wrap); setTimeout(() => form.u.focus(), 0); return;
    }
    let list = [];
    if (tab === 'online') list = f.friends.filter((x) => presence(x.user).status !== 'offline').map((x) => { const r = row(x.user, ['Message', () => open({ kind: 'dm', with: x.user }), 'primary']); if (onJoinGame && presence(x.user).game) r.append(joinButton(x.user)); return r; });
    if (tab === 'all') list = f.friends.map((x) => row(x.user, ['Message', () => open({ kind: 'dm', with: x.user }), 'primary'], ['Remove', async () => (await dkConfirm(`Remove ${x.user} from your friends?`, { title: 'Remove friend', ok: 'Remove', danger: true })) && hub.friend('friend-remove', x.user)]));
    if (tab === 'pending') list = [...f.incoming.map((u) => row(u, ['Accept', () => hub.friend('friend-accept', u), 'primary'], ['Ignore', () => hub.friend('friend-remove', u)])),
      ...f.outgoing.map((u) => row(u, ['Cancel request', () => hub.friend('friend-remove', u)]))];
    if (tab === 'blocked') list = f.blocked.map((u) => row(u, ['Unblock', () => hub.friend('unblock', u)]));
    const titles = { online: 'Online', all: 'All friends', pending: 'Pending', blocked: 'Blocked' };
    wrap.append(h('div', 'gwc-cat', h('span', null, `${titles[tab]} (${list.length})`)));
    if (!list.length) wrap.append(h('p', 'gwc-hint', tab === 'online' ? 'No friends online right now.' : tab === 'all' ? 'No friends yet. Add someone by username, or click a name in a channel.' : tab === 'pending' ? 'No pending requests.' : 'Nobody is blocked.'));
    wrap.append(...list);
    logEl.replaceChildren(wrap);
  }

  // ---- Pings: the inbox of mentions and answers, jumping to a message, notification settings ----
  const unseenPings = () => (hub.pings ?? []).filter((p) => p.at > (hub.pingsSeenAt ?? 0) && p.at > (read['c:' + p.room] ?? 0) && !((p.kind === 'everyone' || p.kind === 'here') && noEveryone['c:' + p.room])).length;
  function drawInboxBadge() { const n = unseenPings(), b = $('[data-inboxn]'); b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); }
  function openInbox(anchor) {
    const box = h('div', 'gwc-inbox dk-window'), list = (hub.pings ?? []).slice(0, 40), seen = hub.pingsSeenAt ?? 0;
    const top = h('div', 'dk-title', si('email_open'), h('span', null, 'Mentions and replies'));
    const all = h('button', 'dk-btn', 'Mark all read'); all.type = 'button';
    all.onclick = () => { for (const c of channels()) { const k = 'c:' + c.name; read[k] = Math.max(read[k] ?? 0, Date.now()); } ls.set('chat-read', read); hub.pingsSeen(); closePop(); drawNav(); drawInboxBadge(); };
    top.append(all);
    const body = h('div', 'dk-panel gwc-inboxlist');
    if (!myAccount()) body.append(h('p', 'gwc-hint', 'Sign in to see your mentions.'));
    else if (!list.length) body.append(h('p', 'gwc-hint', 'Nothing yet. When someone @mentions you or answers one of your messages, it shows up here, even if you were away.'));
    for (const p of list) {
      const from = p.from ?? {}, prof = from.account ? cachedProfile(from.account) : null;
      if (from.account && !prof) getProfile(from.account).then(() => { if (!pop.hidden && pop.contains(box)) openInbox(anchor); });
      const row = h('button', 'gwc-inboxrow' + (p.at > seen && p.at > (read['c:' + p.room] ?? 0) ? ' new' : '')); row.type = 'button';
      const what = p.kind === 'reply' ? 'answered you' : p.kind === 'mention' ? 'mentioned you' : `@${p.kind}`;
      row.append(avatarEl(prof, from.name ?? '?', 32), h('span', 'gwc-inboxtext',
        h('span', 'gwc-inboxtop', h('b', null, displayName(prof, from.name ?? '?')), ` ${what} in `, h('b', null, `#${channel(p.room)?.label ?? p.room}`), h('time', null, stamp(p.at))),
        h('span', 'gwc-inboxmsg', richText(String(p.text ?? '').slice(0, 160), myAccount(), p.kind === 'everyone' || p.kind === 'here'))));
      row.onclick = () => { closePop(); jumpTo({ kind: 'channel', id: p.room }, p.id); };
      body.append(row);
    }
    box.append(top, body);
    openPop(box, anchor, 'inbox');
    hub.pingsSeen(); drawInboxBadge();
  }
  // Open a conversation at one message: older pages are fetched until it turns up (up to ten pages back).
  let jump = null;
  function jumpTo(target, id) {
    open(target); jump = { k: keyOf(), id, tries: 0 }; tryJump();
  }
  function tryJump() {
    if (!jump || keyOf() !== jump.k) { jump = null; return; }
    const el = logEl.querySelector(`[data-id="${CSS.escape(jump.id)}"]`);
    if (el) { jump = null; el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); return; }
    const list = logs.get(jump.k), first = list?.find((m) => !m.sys);
    if (!list) return;   // not loaded yet: tried again when it is
    if (done.get(jump.k) || !first || jump.tries++ >= 10) { jump = null; sysNote('That message is no longer here.'); return; }
    loadingOlder = true;
    if (view.kind === 'channel') hub.roomHistory(view.id, first.at); else hub.dmHistory(view.with, first.at);
  }
  // Right-click a channel or private chat (or the bell above the messages): how it notifies.
  function notifMenu(k, anchor) {
    const menu = h('div', 'dk-menu gwc-notif'), isCh = k.startsWith('c:');
    const item = (label, on, fn, ic) => { const b = h('button', on ? 'on' : null, si(ic ?? (on ? 'tick' : 'bullet_white')), label); b.type = 'button'; b.onclick = () => { fn(); saveNotif(); closePop(); drawNav(); drawInboxBadge(); }; menu.append(b); };
    item('Mark as read', false, () => { read[k] = Math.max(read[k] ?? 0, lastAt(k), Date.now()); ls.set('chat-read', read); mentions.delete(k); }, 'accept');
    menu.append(h('div', 'gwc-menuhead', 'Notify me about'));
    const lv = level(k);
    item('All messages', lv === 'all', () => { notif[k] = 'all'; });
    item(isCh ? 'Only @mentions and answers' : 'Messages (default)', isCh ? lv === 'mentions' : lv === 'all', () => { notif[k] = isCh ? 'mentions' : 'all'; });
    item('Nothing', lv === 'none', () => { notif[k] = 'none'; });
    menu.append(h('div', 'gwc-menuhead', 'This ' + (isCh ? 'channel' : 'chat')));
    item(mutedK[k] ? 'Unmute' : 'Mute (no notices, greyed out)', !!mutedK[k], () => { if (mutedK[k]) delete mutedK[k]; else mutedK[k] = true; }, 'sound_mute');
    if (isCh) item('Ignore @everyone and @here', !!noEveryone[k], () => { if (noEveryone[k]) delete noEveryone[k]; else noEveryone[k] = true; });
    menu.append(h('div', 'gwc-menuhead', 'Everywhere'));
    item('Notification sounds', sounds, () => { sounds = !sounds; ls.set('chat-sound', sounds); if (sounds) pingSound(); }, sounds ? 'sound' : 'sound_mute');
    if (hub.myStatus === 'dnd') menu.append(h('div', 'gwc-menunote', 'Do Not Disturb is on: no notices or sounds anywhere until you change your status.'));
    openPop(menu, anchor);
  }
  $('[data-inbox]').onclick = (e) => openInbox(e.currentTarget);
  $('[data-notif]').onclick = (e) => { if (view.kind !== 'friends') notifMenu(keyOf(), e.currentTarget); };
  // A mention in a message opens that person's card.
  logEl.addEventListener('click', (e) => { const m = e.target.closest?.('.gwc-mention[data-user]'); if (m) profileCard(m.dataset.user, m, m.dataset.user); });

  // ---- Popovers ----
  function openPop(content, anchor, kind = 'menu') {
    pop.className = 'dk gwc-pop gwc-pop-' + kind; pop.replaceChildren(content); pop.hidden = false;
    const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = r.right + 8, y = r.top;
    if (x + pw > innerWidth - 8) x = Math.max(8, r.left - pw - 8);
    y = Math.max(8, Math.min(y, innerHeight - ph - 8));
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function closePop() { pop.hidden = true; pop.replaceChildren(); }
  const onDocDown = (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest?.('.gwc-msgtools, [data-me] .dk-btn, [data-inbox], [data-notif]')) closePop(); };
  document.addEventListener('pointerdown', onDocDown, true);

  // ---- Composing ----
  function drawReplyBar() {
    replyBar.hidden = !replyTo && !editing;
    if (editing) replyBar.replaceChildren(h('span', null, si('pencil'), ' Editing message · Esc to cancel'), cancelBtn());
    else if (replyTo) {
      const items = [h('span', null, si('arrow_undo'), ' Replying to ', h('b', null, displayName(replyTo.account ? cachedProfile(replyTo.account) : null, replyTo.name)))];
      // Channels only (a private chat always tells the other person): ping the author of the message, or not.
      if (view.kind === 'channel' && replyTo.account && replyTo.account !== myAccount()) {
        const t = h('button', 'dk-btn gwc-rping' + (replyPing ? ' down' : ''), replyPing ? '@ On' : '@ Off'); t.type = 'button';
        t.dataset.tip = replyPing ? `${displayName(cachedProfile(replyTo.account), replyTo.name)} gets a ping. Click to answer quietly.` : 'Answering without a ping. Click to ping them.';
        t.onclick = () => { replyPing = !replyPing; ls.set('chat-replyping', replyPing); drawReplyBar(); text.focus(); };
        items.push(t);
      }
      replyBar.replaceChildren(...items, cancelBtn());
    }
  }
  function cancelBtn() { const b = h('button', 'dk-btn', 'Cancel'); b.type = 'button'; b.onclick = () => { if (editing) text.value = ''; replyTo = editing = null; drawReplyBar(); autosize(); }; return b; }
  function startEdit(m) { editing = m; replyTo = null; text.value = m.text; drawReplyBar(); autosize(); text.focus(); }
  const autosize = () => { text.style.height = 'auto'; text.style.height = Math.min(160, text.scrollHeight) + 'px'; };
  // ---- @ suggestions: people here, friends, private chats, recent writers and (asked from the hub) any account ----
  let sugg = { list: [], at: 0, q: null, start: 0 };
  const found = new Map();   // prefix -> usernames from the hub
  function people() {
    const out = new Map(), add = (u, name) => { if (u && u !== myAccount() && !out.has(u)) out.set(u, name ?? u); };
    if (view.kind === 'channel') for (const x of members.get(view.id)?.values() ?? []) add(x.account, x.name);
    if (view.kind === 'dm') add(view.with);
    for (const m of [...(logs.get(keyOf()) ?? [])].reverse()) add(m.account, m.name);
    for (const f of hub.friends?.friends ?? []) add(f.user);
    for (const c of convos) add(c.with);
    for (const u of hub.presence?.keys() ?? []) add(u);
    for (const list of found.values()) for (const u of list) add(u);
    return out;
  }
  function updateSuggest() {
    const upto = text.value.slice(0, text.selectionStart ?? text.value.length), m = /(^|[\s(])@([a-z0-9_]{0,20})$/i.exec(upto);
    if (!m || text.disabled || !myAccount()) return closeSuggest();
    const q = m[2].toLowerCase(), list = [];
    if (q.length >= 1 && !found.has(q)) { found.set(q, []); hub.findUsers(q); }
    for (const [u, name] of people()) {
      const p = cachedProfile(u), dn = displayName(p, name ?? u).toLowerCase();
      if (u.startsWith(q) || dn.startsWith(q) || (q.length >= 2 && dn.includes(q))) list.push({ u, p, name: name ?? u, rank: u.startsWith(q) ? 0 : dn.startsWith(q) ? 1 : 2 });
    }
    list.sort((a, b) => a.rank - b.rank || (presence(b.u).status !== 'offline') - (presence(a.u).status !== 'offline') || a.u.localeCompare(b.u));
    const out = list.slice(0, 8);
    if (hub.isAdmin && view.kind === 'channel') for (const w of ['everyone', 'here']) if (w.startsWith(q)) out.push({ u: w, special: true });
    if (!out.length) return closeSuggest();
    if (sugg.q !== q) sugg.at = 0;
    sugg = { list: out, at: Math.min(sugg.at, out.length - 1), q, start: upto.length - m[2].length - 1 };
    suggest.replaceChildren(h('div', 'gwc-suggesthead', q ? `People matching @${q}` : 'Mention someone'), ...out.map((x, i) => {
      const b = h('button', i === sugg.at ? 'on' : null); b.type = 'button'; b.setAttribute('role', 'option');
      if (x.special) b.append(si('bell'), h('b', null, '@' + x.u), h('small', null, x.u === 'everyone' ? 'Ping every account' : 'Ping everyone online in this channel'));
      else { const av = withDot(avatarEl(x.p, x.name, 20), presence(x.u).status); b.append(av, h('b', null, displayName(x.p, x.name)), h('small', null, '@' + x.u)); if (!x.p) getProfile(x.u).then((p) => { if (p && !suggest.hidden) updateSuggest(); }); }
      b.onpointerdown = (e) => { e.preventDefault(); pickSuggest(i); };
      return b;
    }));
    suggest.hidden = false;
  }
  function pickSuggest(i = sugg.at) {
    const x = sugg.list[i]; if (!x) return;
    const end = text.selectionStart ?? text.value.length, ins = '@' + x.u + ' ';
    text.value = text.value.slice(0, sugg.start) + ins + text.value.slice(end);
    const at = sugg.start + ins.length; text.setSelectionRange(at, at); closeSuggest(); autosize(); text.focus();
  }
  function closeSuggest() { suggest.hidden = true; suggest.replaceChildren(); sugg.list = []; sugg.q = null; }
  text.addEventListener('input', () => { autosize(); updateSuggest(); if (text.value && view.kind !== 'friends' && !editing) hub.typing(whereOf()); });
  text.addEventListener('click', updateSuggest);
  text.addEventListener('blur', () => setTimeout(closeSuggest, 100));
  text.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();   // the launcher menu leaves typing alone; Esc may still close the window
    if (!suggest.hidden && sugg.list.length) {
      const n = sugg.list.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugg.at = (sugg.at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; updateSuggest(); return; }
      // Enter sends when the name is already typed out in full; otherwise it (and Tab) picks the highlighted person.
      if (e.key === 'Enter' && !e.shiftKey && sugg.list[sugg.at]?.u === sugg.q) closeSuggest();
      else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pickSuggest(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSuggest(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'Escape' && (replyTo || editing)) { e.preventDefault(); e.stopPropagation(); if (editing) text.value = ''; replyTo = editing = null; drawReplyBar(); autosize(); }
    else if (e.key === 'ArrowUp' && !text.value) { const mine = [...(logs.get(keyOf()) ?? [])].reverse().find((m) => m.key === myKey() && m.id); if (mine) { e.preventDefault(); startEdit(mine); } }
  });
  text.addEventListener('keyup', (e) => e.stopPropagation());
  let lastSent = null;   // given back to the composer if automod refuses it
  function send(attach, sticker) {
    const t = sticker ? '' : text.value.trim();
    if (!t && !attach && !sticker) return;
    if (editing) { if (t && t !== editing.text) hub.edit(whereOf(), editing.id, t); editing = null; }
    else {
      const extra = { ...(replyTo?.id ? { reply: replyTo.id, ...(replyPing ? {} : { replyPing: false }) } : {}), ...(attach ? { attach } : {}), ...(sticker ? { sticker } : {}) };
      const ok = view.kind === 'channel' ? hub.say(view.id, t, extra) : hub.dm(view.with, t, extra);
      if (!ok) return;
      lastSent = { k: keyOf(), text: t }; newSince.delete(keyOf());
      replyTo = null;
    }
    if (sticker) { drawReplyBar(); return; }   // what was being typed stays
    text.value = ''; drawReplyBar(); autosize();
  }
  $('[data-compose]').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  async function upload(file) {
    if (!file || !/^image\//.test(file.type)) return;
    sysNote('Uploading picture…');
    try {
      const { blob, w, h: ht } = await resizeImage(file, { max: 1600, keepGifUnder: 3.5 * 1048576 });
      const r = await fetch(hubHttp() + 'chat/upload', { method: 'POST', headers: authHeaders(), body: blob });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error ?? `Error ${r.status}`);
      send([{ name: j.name, w, h: ht }]);
    } catch (e) { sysNote(e.message); }
  }
  $('[data-attach]').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => upload(i.files[0]); i.click(); };
  // GIFs, stickers and emojis (web/emote-picker.js).
  const insert = (s) => { const a = text.selectionStart ?? text.value.length, b = text.selectionEnd ?? a, pad = a && !/\s$/.test(text.value.slice(0, a)) ? ' ' : ''; text.value = text.value.slice(0, a) + pad + s + ' ' + text.value.slice(b); const at = a + pad.length + s.length + 1; text.setSelectionRange(at, at); autosize(); text.focus(); };
  const postedGifs = () => { const seen = new Map(); for (const list of logs.values()) for (const m of list) for (const a of m.attach ?? []) if (/\.gif$/.test(a.name)) seen.set(a.name, a); return [...seen.values()].reverse(); };
  async function importLink(url) {
    const r = await fetch(hubHttp() + 'chat/import', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Error(j.error ?? `Error ${r.status}`);
    const a = { name: j.name, w: 0, h: 0 }; send([a]); return a;
  }
  for (const b of root.querySelectorAll('[data-pick]')) b.onclick = () => {
    if (text.disabled) return;
    if (b.dataset.pick !== 'emoji' && !myAccount()) { sysNote('Sign in to a Garry\'s Web account to post GIFs and stickers.'); return; }
    openPicker(root, b, { tab: b.dataset.pick, onEmoji: insert, onSticker: (v) => send(null, v), onGif: (a) => send([a]), onUpload: () => $('[data-attach]').click(), onLink: importLink, postedGifs });
  };
  text.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files ?? [])].find((x) => /^image\//.test(x.type)); if (f && myAccount()) { e.preventDefault(); upload(f); } });
  function sysNote(msg, cls) { const k = keyOf(); if (k === 'friends') return; (logs.get(k) ?? logs.set(k, []).get(k)).push({ sys: msg, cls, at: Date.now(), key: 'sys' }); drawLog(); }

  // ---- Navigation ----
  function open(target) {
    // Private chats need an account. The page's own sign-in counts (the hub confirms it a moment after connecting).
    if (target.kind === 'dm' && !account()) { onEditProfile(); return; }
    view = target; ls.set('chat-view', view.kind === 'friends' ? { kind: 'friends', tab: view.tab } : view);
    if (view.kind !== 'friends') { const k = keyOf(); if (unread(k)) newSince.set(k, read[k] ?? 0); else newSince.delete(k); }
    closeSuggest();
    replyTo = editing = null; drawReplyBar(); closePop();
    if (view.kind === 'dm') { getProfile(view.with).then(() => { head(); drawNav(); }); if (!logs.has(keyOf())) hub.dmHistory(view.with); }
    if (view.kind === 'friends') hub.send({ t: 'friends' });
    head(); placeholder(); drawNav(); drawLog(); drawMembers(); drawTyping();
    if (view.kind !== 'friends') text.focus({ preventScroll: true });
  }
  function drawTyping() {
    const t = typing.get(keyOf()), now = Date.now();
    const names = t ? [...t].filter(([, until]) => until > now).map(([n]) => n) : [];
    typingEl.textContent = !names.length ? '' : names.length === 1 ? `${names[0]} is typing…` : names.length < 4 ? `${names.join(', ')} are typing…` : 'Several people are typing…';
  }
  const typingTimer = setInterval(drawTyping, 1500);

  // ---- Hub events ----
  const keyFor = (m) => (m.room !== undefined ? 'c:' + m.room : 'd:' + (m.with ?? (m.from === hub.account ? m.to : m.from)));
  const findMsg = (k, id) => logs.get(k)?.find((x) => x.id === id);
  const notify = (k, title, body, icon) => {
    if (hub.myStatus === 'dnd' || mutedK[k] || level(k) === 'none') return;
    if (looking() && keyOf() === k) return;
    if (sounds) pingSound();
    onNotify({ title, body, icon, open: () => { const v = k.startsWith('c:') ? { kind: 'channel', id: k.slice(2) } : { kind: 'dm', with: k.slice(2) }; open(v); } });
  };
  const offs = [
    hub.on('state', () => { placeholder(); drawNav(); }),
    hub.on('welcome', () => { placeholder(); drawNav(); }),
    hub.on('authed', () => { drawWall(); if (hub.account) { hub.dms(); getProfile(hub.account).then(drawMe); } placeholder(); drawNav(); drawLog(); }),
    hub.on('rooms', () => drawNav()),
    hub.on('room', (m) => {
      members.set(m.room, new Map(m.users.map((u) => [u.id, u])));
      logs.set('c:' + m.room, m.history.map(norm)); done.set('c:' + m.room, m.history.length < 100);
      if (view.kind === 'channel' && view.id === m.room) { drawLog(); drawMembers(); if (jump) tryJump(); }
      drawNav();
    }),
    hub.on('room-history', (m) => {
      loadingOlder = false; const k = 'c:' + m.room; done.set(k, m.done);
      if (m.messages.length) logs.get(k)?.unshift(...m.messages.map(norm));
      if (keyOf() === k) { drawLog({ keep: true }); if (jump) tryJump(); }
    }),
    hub.on('joined', (m) => { members.get(m.room)?.set(m.user.id, m.user); if (view.id === m.room) drawMembers(); }),
    hub.on('left', (m) => { members.get(m.room)?.delete(m.user.id); if (view.id === m.room) drawMembers(); }),
    hub.on('nick', (m) => { members.get(m.room)?.set(m.user.id, m.user); if (view.id === m.room) drawMembers(); }),
    hub.on('msg', (m) => {
      const k = 'c:' + m.room, n = norm(m);
      (logs.get(k) ?? logs.set(k, []).get(k)).push(n);
      typing.get(k)?.delete(m.from.name);
      // Pings come separately (hub 'ping'); a channel set to all messages tells about every one.
      if (level(k) === 'all' && n.key !== myKey() && !pingsMe(n)) notify(k, `${displayName(n.account ? cachedProfile(n.account) : null, n.name)} in #${channel(m.room)?.label ?? m.room}`, n.text || '(picture)');
      if (keyOf() === k) { const near = atBottom(); drawLog(); if (!near && n.key !== myKey()) scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight - 200; if (near || n.key === myKey()) scroll.scrollTop = scroll.scrollHeight; }
      drawNav(); drawTyping();
    }),
    hub.on('ping', (m) => {
      const k = 'c:' + m.room, who = displayName(m.from?.account ? cachedProfile(m.from.account) : null, m.from?.name ?? '?'), where = `#${channel(m.room)?.label ?? m.room}`;
      if ((m.kind === 'everyone' || m.kind === 'here') && noEveryone[k]) return;
      if (looking() && keyOf() === k && atBottom()) { markRead(k); hub.pingsSeen(); }
      notify(k, m.kind === 'reply' ? `${who} answered you in ${where}` : m.kind === 'mention' ? `${who} mentioned you in ${where}` : `${who} pinged @${m.kind} in ${where}`, m.text);
      drawNav(); drawInboxBadge();
    }),
    hub.on('pings', () => { drawNav(); drawInboxBadge(); }),
    hub.on('pings-seen', () => drawInboxBadge()),
    hub.on('found-users', (m) => { found.set(m.q, m.users); for (const u of m.users) getProfile(u); if (!suggest.hidden || document.activeElement === text) updateSuggest(); }),
    // Automod refused a message: say why, and give back what was written.
    hub.on('automod', (m) => {
      sysNote(`Automod: ${m.reason} Only you can see this.`, 'automod');
      if (lastSent && lastSent.k === keyOf() && !text.value && m.text) { text.value = m.text; autosize(); text.focus(); }
    }),
    hub.on('edited', (m) => { const x = findMsg(keyFor(m), m.id); if (x) { x.text = m.text; x.edited = m.edited; if (keyOf() === keyFor(m)) drawLog({ keep: true }); } }),
    hub.on('msg-deleted', (m) => { const k = keyFor(m), l = logs.get(k); if (!l) return; const i = l.findIndex((x) => x.id === m.id); if (i >= 0) { l.splice(i, 1); if (keyOf() === k) drawLog({ keep: true }); } }),
    hub.on('room-cleared', (m) => { logs.set('c:' + m.room, []); done.set('c:' + m.room, true); if (keyOf() === 'c:' + m.room) drawLog(); }),
    hub.on('typing', (m) => {
      const k = m.room !== undefined ? 'c:' + m.room : 'd:' + m.with, name = m.user?.account ? displayName(cachedProfile(m.user.account), m.user.name) : m.user?.name;
      if (!name || m.user?.key === myKey()) return;
      (typing.get(k) ?? typing.set(k, new Map()).get(k)).set(name, Date.now() + 6000);
      if (keyOf() === k) drawTyping();
    }),
    hub.on('notice', (m) => { for (const c of channels()) { const k = 'c:' + c.name; logs.get(k)?.push({ sys: `Announcement: ${m.text}`, at: m.at ?? Date.now(), key: 'sys' }); } drawLog(); onNotify({ title: 'Announcement', body: m.text }); }),
    hub.on('banned', (m) => { sysNote(`You are banned from chat${m.until ? ' until ' + new Date(m.until).toLocaleString() : ''}${m.reason ? ': ' + m.reason : ''}.`); placeholder(); }),
    hub.on('kicked', (m) => sysNote(`You were removed from chat${m.reason ? ': ' + m.reason : ''}.`)),
    hub.on('dms', (m) => { convos = m.list.map((c) => ({ ...c, unread: c.last.from !== hub.account })); for (const c of convos) getProfile(c.with); drawNav(); }),
    hub.on('dm-history', (m) => {
      loadingOlder = false; const k = 'd:' + m.with, msgs = m.messages.map(norm);
      if (logs.has(k) && logs.get(k).length && msgs.length) logs.get(k).unshift(...msgs); else logs.set(k, msgs);
      done.set(k, m.done);
      if (keyOf() === k) { drawLog({ keep: logs.get(k).length > msgs.length }); if (jump) tryJump(); }
    }),
    hub.on('dm', (m) => {
      const other = m.from === hub.account ? m.to : m.from, k = 'd:' + other, n = norm(m);
      if (logs.has(k)) logs.get(k).push(n);
      typing.get(k)?.clear();
      const c = convos.find((x) => x.with === other); if (c) c.last = m; else convos.unshift({ with: other, last: m });
      convos.sort((a, b) => b.last.at - a.last.at);
      if (m.from !== hub.account) { mentions.set(k, (looking() && keyOf() === k) ? 0 : (mentions.get(k) ?? 0) + 1); if (level(k) !== 'none') notify(k, displayName(cachedProfile(other), m.name), m.text || '(picture)'); }
      if (keyOf() === k) { const near = atBottom(); drawLog(); if (near || m.from === hub.account) scroll.scrollTop = scroll.scrollHeight; }
      drawNav(); drawTyping();
    }),
    hub.on('friends', () => { drawNav(); if (view.kind === 'friends') drawFriends(); }),
    hub.on('friend-request', (m) => { onNotify({ title: 'Friend request', body: `${m.name} (@${m.from}) wants to be friends.`, open: () => open({ kind: 'friends', tab: 'pending' }) }); }),
    hub.on('friend-accepted', (m) => onNotify({ title: 'New friend', body: `@${m.user} accepted your friend request.`, open: () => open({ kind: 'dm', with: m.user }) })),
    hub.on('presence', () => { drawNav(); drawMembers(); if (view.kind === 'friends') drawFriends(); if (view.kind === 'dm') head(); }),
    hub.on('presence-list', () => { drawNav(); drawMembers(); }),
    hub.on('my-status', () => drawMe()),
    hub.on('profile', (m) => { forget(m.user); getProfile(m.user).then(scheduleRedraw); }),
    hub.on('emotes', () => loadEmotes(true)),
    hub.on('vc-denied', (m) => sysNote(m.why)),
    hub.on('vc-knock', (m) => {
      (knocks.get(m.id) ?? knocks.set(m.id, new Map()).get(m.id)).set(m.user, m.name);
      document.querySelector('.gwc-vset')?.redraw?.();
      onNotify({ title: 'Someone wants to join your voice channel', body: `${m.name} (@${m.user}) asked to join.`, open: () => voiceSettings(m.id) });
    }),
    hub.on('vc-invited', (m) => onNotify({ title: 'Voice invite', body: `${m.by} let you into ${m.name}. Click to join.`, open: () => joinVoice(m.id) })),
    hub.on('error', (m) => { loadingOlder = false; sysNote(m.error); }),
  ];
  const offProfiles = onProfiles(() => scheduleRedraw()), offEmotes = onEmotes(() => scheduleRedraw());
  const offVoice = vc.on(() => { drawNav(); drawVoiceBar(); document.querySelector('.gwc-vset')?.redraw?.(); });
  loadEmotes();
  // Scrolling to the top loads older messages; reaching the bottom marks the conversation read.
  scroll.addEventListener('scroll', () => {
    if (atBottom() && looking()) { const k = keyOf(); if (unread(k) || mentions.get(k)) { markRead(k); drawNav(); } }
    if (scroll.scrollTop > 40 || loadingOlder || view.kind === 'friends') return;
    const k = keyOf(), list = logs.get(k);
    if (!list?.length || done.get(k)) return;
    const first = list.find((m) => !m.sys); if (!first) return;
    loadingOlder = true;
    if (view.kind === 'channel') hub.roomHistory(view.id, first.at); else hub.dmHistory(view.with, first.at);
  });
  $('[data-members]').onclick = () => { showMembers = !showMembers; ls.set('chat-members', showMembers); head(); drawMembers(); };
  if (onClose) $('[data-close]').onclick = () => onClose();
  const onKey = (e) => { if (e.key === 'Escape' && shown && !pop.hidden) { e.preventDefault(); e.stopPropagation(); closePop(); } };
  root.addEventListener('keydown', onKey);
  const onVis = () => { if (looking() && atBottom()) { markRead(); drawNav(); } };
  document.addEventListener('visibilitychange', onVis);

  for (const c of channels()) hub.join(c.name);
  hub.connect();
  if (hub.state === 'online') { hub.auth(); hub.send({ t: 'presence' }); for (const c of channels()) hub.send({ t: 'join', room: c.name }); }
  if (account()) getProfile(account().user).then(drawMe);
  open(view);
  return {
    destroy() { for (const off of offs) off(); offProfiles(); offEmotes(); offVoice(); pop.remove(); document.querySelector('.gwc-vset')?.remove(); document.querySelector('.gw-picker')?.remove(); clearInterval(typingTimer); document.removeEventListener('pointerdown', onDocDown, true); document.removeEventListener('visibilitychange', onVis); root.replaceChildren(); },
    open,
    lastRoom() { return view.kind === 'friends' ? null : view; },
    focus() { if (view.kind !== 'friends') text.focus({ preventScroll: true }); },
    // The overlay hides the app rather than destroying it, so unread counts keep going.
    visible(on) { shown = on; if (on) { drawLog({ keep: true }); scroll.scrollTop = scroll.scrollHeight; markRead(); drawNav(); } },
    unreadCount() { let n = 0; for (const [k, v] of mentions) if (k.startsWith('d:')) n += v; for (const c of channels()) n += pingCount('c:' + c.name); return n; },
  };
}
