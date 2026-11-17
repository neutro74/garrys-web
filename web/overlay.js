// The in-game overlay: chat (web/chat-app.js) over the running game, opened with Shift+Tab like Steam's. While it is open the
// game gets no input and the mouse is released; closing it gives both back. When it is closed, private messages, mentions and
// friend requests show as small notices in the corner (clicking one opens the overlay there).
import { mountChat, chatStyles } from './chat-app.js';
import { sharedHub } from './hub.js';
import { getProfile, cachedProfile, avatarEl } from './profiles.js';

const isToggle = (e) => e.type === 'keydown' && e.shiftKey && (e.code === 'Tab' || e.key === 'Tab') && !e.ctrlKey && !e.altKey && !e.metaKey;

export function createOverlay({ input, activity, onOpenSave, onEditProfile }) {
  const hub = sharedHub();
  if (!hub.url) return null;
  chatStyles();
  const wrap = document.createElement('div'); wrap.className = 'gw-overlay'; wrap.hidden = true;
  const app = document.createElement('div'); wrap.append(app);
  const hint = document.createElement('div'); hint.className = 'gw-overlay-hint'; hint.textContent = 'Shift+Tab or Esc to return to the game';
  wrap.append(hint);
  const toasts = document.createElement('div'); toasts.className = 'gw-toasts';
  const badge = document.createElement('div'); badge.className = 'gw-overlay-badge'; badge.hidden = true;
  document.body.append(wrap, toasts, badge);
  let open = false;
  const chat = mountChat(app, {
    hub, mode: 'overlay', onClose: () => toggle(false), onOpenSave,
    onEditProfile: onEditProfile ?? (() => toast({ title: 'Profile', body: 'Edit your profile and sign in from the launcher (Quit → Profile).' })),
    onNotify: (n) => { if (!open) toast(n); updateBadge(); },
  });
  chat.visible(false);
  function updateBadge() { const n = chat.unreadCount(); badge.hidden = open || !n; badge.textContent = `${n} new · Shift+Tab`; }
  function toggle(on = !open) {
    if (on === open) return;
    open = on; wrap.hidden = !on;
    input.send({ type: 'release' });   // keys held when the overlay opened would otherwise stay down in the game
    if (on) { if (document.pointerLockElement) document.exitPointerLock(); chat.visible(true); requestAnimationFrame(() => chat.focus()); }
    else { chat.visible(false); document.activeElement?.blur?.(); input.relock(); }
    updateBadge();
  }
  // Called first by web/input.js for every page and menu-frame event.
  input.intercept = (e) => {
    if (isToggle(e)) { e.preventDefault?.(); if (!e.repeat) toggle(); return true; }
    if (!open) return false;
    // Esc outside the overlay (the game's menu frames) closes it; inside, the chat may use it first (cancel a reply, a popup).
    if (e.type === 'keydown' && e.key === 'Escape' && !wrap.contains(e.target ?? null)) { e.preventDefault?.(); toggle(false); return true; }
    return true;   // everything else belongs to the overlay while it is open
  };
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); toggle(false); } });
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) toggle(false); });

  function toast({ title, body, open: go, user }) {
    const t = document.createElement('div'); t.className = 'gw-toast'; t.setAttribute('role', 'status');
    const text = document.createElement('div'); const b = document.createElement('b'); b.textContent = title; const s = document.createElement('span'); s.textContent = body ?? '';
    const k = document.createElement('small'); k.textContent = 'Shift+Tab to open chat';
    text.append(b, s, k);
    if (user) t.append(avatarEl(cachedProfile(user), user, 36));
    t.append(text);
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
  return { toggle, toast, setActivity: (a) => hub.setActivity(a), get open() { return open; } };
}
