// The in-game overlay: chat (web/chat-app.js) over the running game, opened with Shift+Tab like Steam's. While it is open the
// game gets no input and the mouse is released; closing it gives both back. When it is closed, private messages, mentions and
// friend requests show as small notices in the corner (clicking one opens the overlay there).
import { mountChat, chatStyles } from './chat-app.js';
import { sharedHub } from './hub.js';
import { getProfile, cachedProfile, displayName } from './profiles.js';
import { voiceClient } from './voice-chat.js';
import { icon } from './derma.js';

// Voice keys while playing, as in Discord: Ctrl+Shift+M mutes the microphone, Ctrl+Shift+D deafens.
const voiceKey = (e) => (e.type === 'keydown' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey ? { KeyM: 'mute', KeyD: 'deafen' }[e.code] ?? null : null);
const isToggle = (e) => e.type === 'keydown' && e.shiftKey && (e.code === 'Tab' || e.key === 'Tab') && !e.ctrlKey && !e.altKey && !e.metaKey;

export function createOverlay({ input, activity, onOpenSave, onEditProfile, onJoinGame }) {
  const hub = sharedHub();
  if (!hub.url) return null;
  chatStyles();
  // A Derma window (web/derma.css) holding the chat app, over a dimmed game.
  const wrap = document.createElement('div'); wrap.className = 'gw-overlay dk'; wrap.hidden = true;
  const win = document.createElement('div'); win.className = 'dk-window'; win.setAttribute('role', 'dialog'); win.setAttribute('aria-label', 'Chat');
  win.innerHTML = `<div class="dk-title"><img src="${new URL('./brand/icon-32.png', import.meta.url).href}" alt="">Garry's Web · Chat<span class="dk-tinfo">Shift+Tab or Esc to return to the game</span><button type="button" class="dk-wbtn close" data-tip="Back to the game (Esc)" aria-label="Close"></button></div>`;
  const pad = document.createElement('div'); pad.className = 'gwc-pad';
  const app = document.createElement('div'); pad.append(app); win.append(pad); wrap.append(win);
  win.querySelector('.dk-wbtn').onclick = () => toggle(false);
  const toasts = document.createElement('div'); toasts.className = 'dk gw-toasts';
  const badge = document.createElement('div'); badge.className = 'dk gw-overlay-badge'; badge.hidden = true;
  // In a voice channel: who is there and who is talking, in the corner while the overlay is closed.
  const vhud = document.createElement('div'); vhud.className = 'dk gw-voicehud'; vhud.hidden = true;
  document.body.append(wrap, toasts, badge, vhud);
  const vc = voiceClient(hub);
  let open = false;
  const chat = mountChat(app, {
    hub, mode: 'overlay', onOpenSave, onJoinGame,
    onEditProfile: onEditProfile ?? (() => toast({ title: 'Profile', body: 'Edit your profile and sign in from the launcher (Quit → Profile).' })),
    onNotify: (n) => { if (!open) toast(n); updateBadge(); },
  });
  chat.visible(false);
  function updateBadge() {
    const n = chat.unreadCount(); badge.hidden = open || !n;
    badge.innerHTML = `<img class="si" src="${icon('comments')}" alt=""><span></span>`; badge.querySelector('span').textContent = `${n} new · Shift+Tab`;
  }
  function toggle(on = !open) {
    if (on === open) return;
    open = on; wrap.hidden = !on;
    input.send({ type: 'release' });   // keys held when the overlay opened would otherwise stay down in the game
    if (on) { if (document.pointerLockElement) document.exitPointerLock(); win.classList.remove('pop'); void win.offsetWidth; win.classList.add('pop'); chat.visible(true); requestAnimationFrame(() => chat.focus()); }
    else { chat.visible(false); document.activeElement?.blur?.(); input.relock(); }
    updateBadge(); drawVoice();
  }
  function drawVoice() {
    const ch = vc.channel();
    vhud.hidden = open || !vc.current || !ch;
    if (vhud.hidden) return;
    const row = (ic, text, cls = '') => { const r = document.createElement('div'); r.className = 'gw-vrow ' + cls; const i = document.createElement('img'); i.className = 'si'; i.alt = ''; i.src = icon(ic); const t = document.createElement('span'); t.textContent = text; r.append(i, t); return r; };
    const head = row('sound', ch.name, 'head');
    const me = document.createElement('small'); me.textContent = vc.deafened ? 'Deafened · Ctrl+Shift+D' : vc.muted ? 'Muted · Ctrl+Shift+M' : 'Ctrl+Shift+M mute'; head.append(me);
    const rows = (ch.members ?? []).slice(0, 8).map((m) => {
      const talking = vc.speaking.has(m.id), bad = vc.problems.has(m.id);
      return row(m.deafened ? 'sound_none' : m.muted ? 'sound_mute' : bad ? 'error' : talking ? 'sound' : 'bullet_green', displayName(cachedProfile(m.account), m.name), (talking ? 'talking' : '') + (bad ? ' bad' : ''));
    });
    if ((ch.members?.length ?? 0) > 8) rows.push(row('group', `and ${ch.members.length - 8} more`));
    vhud.replaceChildren(head, ...rows);
  }
  vc.on(drawVoice);
  // Voice keys work while playing (and in the overlay); they never reach the game.
  const voiceKeys = (e) => {
    const k = voiceKey(e); if (!k) return false;
    e.preventDefault?.();
    if (e.repeat || !vc.current) return true;
    if (k === 'mute') { if (vc.deafened) vc.setDeafened(false); else vc.setMuted(!vc.muted); toast({ title: vc.muted ? 'Microphone muted' : 'Microphone on', body: vc.channel()?.name ?? '' }); }
    else { vc.setDeafened(!vc.deafened); toast({ title: vc.deafened ? 'Deafened' : 'Undeafened', body: vc.deafened ? 'You hear nobody and nobody hears you.' : vc.channel()?.name ?? '' }); }
    return true;
  };
  // Called first by web/input.js for every page and menu-frame event.
  input.intercept = (e) => {
    if (isToggle(e)) { e.preventDefault?.(); if (!e.repeat) toggle(); return true; }
    if (voiceKeys(e)) return true;
    if (!open) return false;
    // Esc outside the overlay (the game's menu frames) closes it; inside, the chat may use it first (cancel a reply, a popup).
    if (e.type === 'keydown' && e.key === 'Escape' && !wrap.contains(e.target ?? null)) { e.preventDefault?.(); toggle(false); return true; }
    return true;   // everything else belongs to the overlay while it is open
  };
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); toggle(false); } });
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) toggle(false); });

  function toast({ title, body, open: go }) {
    const t = document.createElement('div'); t.className = 'gw-toast'; t.setAttribute('role', 'status');
    const ic = document.createElement('img'); ic.className = 'si'; ic.alt = ''; ic.src = icon('comment');
    const text = document.createElement('span'); const b = document.createElement('b'); b.textContent = title; const s = document.createElement('span'); s.textContent = body ?? '';
    const k = document.createElement('small'); k.textContent = 'Shift+Tab to open chat';
    text.append(b, s, k);
    t.append(ic, text);
    t.onclick = () => { t.remove(); toggle(true); go?.(); };
    toasts.append(t);
    while (toasts.childElementCount > 3) toasts.firstElementChild.remove();
    setTimeout(() => t.remove(), 7000);
  }
  // What the player is doing, for friends' lists: the hub keeps the latest.
  hub.connect();
  if (activity) hub.setActivity(activity);
  // A one-time reminder that chat is there.
  try { if (!localStorage.getItem('garrys-wasm.overlay-hint')) { localStorage.setItem('garrys-wasm.overlay-hint', '1'); setTimeout(() => toast({ title: 'Chat is in game too', body: 'Press Shift+Tab any time to chat, see friends and reply to messages.' }), 20000); } } catch { /* storage blocked */ }
  if (hub.account) getProfile(hub.account);
  drawVoice();
  return { toggle, toast, setActivity: (a) => hub.setActivity(a), get open() { return open; } };
}
