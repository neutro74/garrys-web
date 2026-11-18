// Emojis, stickers and GIFs for chat: what each one is, how it is drawn, and the picker (a small Derma window with GIFs,
// Stickers and Emojis tabs, like Discord's). Sources:
//  - the server's own emojis and stickers, uploaded by admins (hub/emotes.mjs, GET /emotes);
//  - GMod's art from the game files (web/emotes/packs.js): Silkicons and flags as emojis, entity and prop icons as stickers;
//  - Steam emoticons we ship (web/emotes/steam.js: Steam's own and those of GMod and its games);
//  - app and developer logos (web/emotes/dev.js: VS Code, GitHub, Lua, Linux, Unity...; Devicon, MIT);
//  - Unicode emoji (web/emotes/unicode.js);
//  - GIFs: the player's saved ones, ones posted in chat, GIPHY search through the hub (GET /gifs, which keeps the key and the
//    hourly limit), uploads and links (copied onto the hub by POST /chat/import).
// In text an image emoji is written :name: (server emojis first, then Steam emoticons, then Silkicons; flags as :flag_xx:).
// A sticker is c:<id> (server), e:<name> (entity) or p:<name> (prop).
import { hubHttp } from './library.js';
import { icon } from './derma.js';
import { PACKS } from './emotes/packs.js';
import { UNICODE } from './emotes/unicode.js';
import { STEAM } from './emotes/steam.js';
import { DEV } from './emotes/dev.js';
import { authHeaders } from './account.js';

const asset = (p) => new URL('../asset/garrysmod/' + p, import.meta.url).href;
const SILK = new Set(PACKS.silk), FLAGS = new Set(PACKS.flags), STEAMS = new Set(Object.values(STEAM).flat());
const steamUrl = (n) => new URL(`./emotes/steam/${n}.png`, import.meta.url).href;
const DEVS = new Set(Object.values(DEV).flat()), devUrl = (n) => new URL(`./emotes/dev/${n}.png`, import.meta.url).href;
const ls = {
  get(k, d) { try { const v = localStorage.getItem('garrys-wasm.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('garrys-wasm.' + k, JSON.stringify(v)); } catch { /* blocked */ } },
};

// ---- The server's own emojis and stickers ----
let custom = { emoji: new Map(), sticker: new Map(), list: [] }, loading = null;
const listeners = new Set();
export function onEmotes(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function loadEmotes(force = false) {
  if (loading && !force) return loading;
  if (!hubHttp()) return Promise.resolve(custom);
  loading = fetch(hubHttp() + 'emotes', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { items: [] })).then(({ items }) => {
    custom = { emoji: new Map(), sticker: new Map(), list: items };
    for (const x of items) custom[x.kind].set(x.kind === 'emoji' ? x.name : x.id, x);
    for (const fn of listeners) fn();
    return custom;
  }).catch(() => custom);
  return loading;
}
const customUrl = (x) => `${hubHttp()}emotes/img/${x.file}`;

// :name: -> picture URL, or null when it is not an emoji (the text then stays as typed).
export function emojiUrl(name) {
  const n = String(name).toLowerCase();
  if (custom.emoji.has(n)) return customUrl(custom.emoji.get(n));
  if (STEAMS.has(n)) return steamUrl(n);
  if (DEVS.has(n)) return devUrl(n);
  if (SILK.has(n)) return icon(n);
  if (n.startsWith('flag_') && FLAGS.has(n.slice(5))) return asset(`materials/flags16/${n.slice(5)}.png`);
  return null;
}
export function stickerUrl(s) {
  const [kind, name] = String(s ?? '').split(':');
  if (kind === 'c') { const x = custom.sticker.get(name); return x ? customUrl(x) : null; }
  if (kind === 'e' && PACKS.entities.includes(name)) return asset(`materials/entities/${name}.png`);
  if (kind === 'p' && PACKS.props[name]) return asset(`materials/spawnicons/models/${PACKS.props[name]}.png`);
  return null;
}
export const stickerName = (s) => { const [kind, name] = String(s ?? '').split(':'); return kind === 'c' ? custom.sticker.get(name)?.name ?? 'sticker' : name.replace(/_/g, ' '); };
// A custom status's emoji (Unicode, or :name:) as a node.
export function emojiNode(token, size = 16) {
  const m = /^:([a-z0-9_]{1,40}):$/i.exec(token ?? ''), url = m && emojiUrl(m[1]);
  if (!url) return document.createTextNode(token ?? '');
  const i = new Image(); i.src = url; i.alt = token; i.title = token; i.className = 'gw-emo'; i.style.width = i.style.height = size + 'px'; i.draggable = false;
  return i;
}

// ---- GIFs the player saved (synced with the account like other settings) ----
export const savedGifs = () => ls.get('gif-saved', []);
export function saveGif(a, on = true) {
  const list = savedGifs().filter((x) => x.name !== a.name);
  if (on) list.unshift({ name: a.name, w: a.w ?? 0, h: a.h ?? 0 });
  ls.set('gif-saved', list.slice(0, 120));
}
const recentEmoji = () => ls.get('emoji-recent', []);
const useEmoji = (v) => ls.set('emoji-recent', [v, ...recentEmoji().filter((x) => x !== v)].slice(0, 32));

// ---- The picker ----
// openPicker(anchor, { tab, onEmoji(text), onSticker(value), onGif(attach), onUpload(), postedGifs(), emojiOnly })
// It sits above the anchor inside `host` (the chat root, positioned), and closes on Esc, outside clicks or a pick.
let openOne = null;
export function openPicker(host, anchor, opts) {
  openOne?.close();
  // On the page itself, fixed to the screen, so no window or scrolling list can cover or cut it.
  const el = document.createElement('div'); el.className = 'dk dk-window gw-picker pop';
  const tabs = opts.emojiOnly ? [['emoji', 'Emojis', 'emoticon_smile']] : [['gif', 'GIFs', 'film'], ['sticker', 'Stickers', 'note'], ['emoji', 'Emojis', 'emoticon_smile']];
  let tab = opts.emojiOnly ? 'emoji' : opts.tab ?? ls.get('picker-tab', 'emoji');
  el.innerHTML = `<div class="dk-title"><img class="si" src="${icon('emoticon_smile')}" alt="">${opts.emojiOnly ? 'Pick an emoji' : 'GIFs, stickers and emojis'}<span class="dk-tinfo"></span><button type="button" class="dk-wbtn close" data-x aria-label="Close"></button></div>
    <div class="dk-tabs gw-picker-tabs">${tabs.map(([k, l, ic]) => `<button type="button" class="dk-tab" data-t="${k}"><img class="si" src="${icon(ic)}" alt="">${l}</button>`).join('')}</div>
    <div class="dk-tabbody gw-picker-body"><div class="gw-picker-search"><input type="search" placeholder="Search" data-q aria-label="Search"></div><div class="gw-picker-grid" data-grid></div><div class="gw-picker-foot" data-foot></div></div>`;
  document.body.append(el);
  const $ = (q) => el.querySelector(q), grid = $('[data-grid]'), q = $('[data-q]'), foot = $('[data-foot]');
  // Place it above the anchor, kept inside the host.
  // Above the anchor, right-aligned to it; below it when there is no room; always inside the window.
  const place = () => {
    const a = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    const x = Math.max(4, Math.min(a.right - w, innerWidth - w - 4)), y = a.top - h - 6 >= 4 ? a.top - h - 6 : Math.max(4, Math.min(innerHeight - h - 4, a.bottom + 6));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  };
  const section = (title) => { const h = document.createElement('div'); h.className = 'gw-picker-sect'; h.textContent = title; grid.append(h); const g = document.createElement('div'); g.className = 'gw-picker-items'; grid.append(g); return g; };
  const tile = (parent, cls, url, label, pick, extra) => {
    // No tooltip (the list would clip it): the footer names what is under the pointer, as Discord's does.
    const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.setAttribute('aria-label', label);
    if (!cls.startsWith('gw-pg')) { b.onpointerenter = () => { foot.dataset.hint ??= foot.textContent; foot.textContent = label; }; b.onpointerleave = () => { foot.textContent = foot.dataset.hint ?? ''; }; }
    if (url) { const i = new Image(); i.loading = 'lazy'; i.decoding = 'async'; i.alt = label; i.src = url; i.draggable = false; if (url.startsWith(hubHttp() || '\u0000')) i.crossOrigin = 'anonymous'; b.append(i); }
    else b.textContent = label;
    b.onclick = (e) => pick(e); extra?.(b); parent.append(b); return b;
  };
  const match = (s) => !q.value || s.toLowerCase().includes(q.value.trim().toLowerCase().replace(/^:|:$/g, ''));
  const keepOpen = (e) => e.shiftKey;   // shift-click picks several emojis

  function drawEmoji() {
    grid.replaceChildren(); delete foot.dataset.hint; foot.textContent = 'Shift-click to pick several.';
    const pickText = (text, e) => { useEmoji(text); opts.onEmoji(text); if (!keepOpen(e)) close(); };
    const recent = recentEmoji().filter(match);
    if (recent.length && !q.value) {
      const g = section('Recently used');
      for (const v of recent) { const m = /^:(.+):$/.exec(v); if (m) { const u = emojiUrl(m[1]); if (u) tile(g, 'gw-pe img', u, v, (e) => pickText(v, e)); } else tile(g, 'gw-pe', null, v, (e) => pickText(v, e)); }
    }
    const server = [...custom.emoji.values()].filter((x) => match(x.name));
    if (server.length) { const g = section("This server's emojis"); for (const x of server) tile(g, 'gw-pe img', customUrl(x), `:${x.name}:`, (e) => pickText(`:${x.name}:`, e)); }
    for (const [set, names] of Object.entries(STEAM)) {
      const list = names.filter((n) => match(n) || match(set)); if (!list.length) continue;
      const g = section(`Steam: ${set}`); for (const n of list) tile(g, 'gw-pe img', steamUrl(n), `:${n}:`, (e) => pickText(`:${n}:`, e));
    }
    for (const [set, names] of Object.entries(DEV)) {
      const list = names.filter((n) => match(n) || match(set) || match('dev & apps logos')); if (!list.length) continue;
      const g = section(`Dev & apps: ${set}`); for (const n of list) tile(g, 'gw-pe img', devUrl(n), `:${n}:`, (e) => pickText(`:${n}:`, e));
    }
    for (const [title, list] of UNICODE) {
      const items = list.filter(([, n]) => match(n)); if (!items.length) continue;
      const g = section(title);
      for (const [ch, n] of items) tile(g, 'gw-pe', null, ch, (e) => pickText(ch, e)).onpointerenter = () => { foot.dataset.hint ??= foot.textContent; foot.textContent = `${ch}  ${n}`; };
    }
    const silk = PACKS.silk.filter(match);
    if (silk.length) { const g = section("GMod icons"); for (const n of silk) tile(g, 'gw-pe img px', icon(n), `:${n}:`, (e) => pickText(`:${n}:`, e)); }
    const flags = PACKS.flags.filter((n) => match('flag_' + n));
    if (flags.length) { const g = section('Flags'); for (const n of flags) tile(g, 'gw-pe img px', asset(`materials/flags16/${n}.png`), `:flag_${n}:`, (e) => pickText(`:flag_${n}:`, e)); }
    if (!grid.childElementCount) grid.innerHTML = '<p class="gw-picker-none">Nothing matches.</p>';
  }
  function drawSticker() {
    grid.replaceChildren(); delete foot.dataset.hint; foot.textContent = 'Click a sticker to send it.';
    const send = (v) => { opts.onSticker(v); close(); };
    const server = [...custom.sticker.values()].filter((x) => match(x.name));
    if (server.length) { const g = section("This server's stickers"); for (const x of server) tile(g, 'gw-ps', customUrl(x), x.name, () => send('c:' + x.id)); }
    const props = Object.keys(PACKS.props).filter(match);
    if (props.length) { const g = section('Props'); for (const n of props) tile(g, 'gw-ps', stickerUrl('p:' + n), n.replace(/_/g, ' '), () => send('p:' + n)); }
    const ents = PACKS.entities.filter(match);
    if (ents.length) { const g = section('Spawn menu'); for (const n of ents) tile(g, 'gw-ps', stickerUrl('e:' + n), n.replace(/_/g, ' '), () => send('e:' + n)); }
    if (!grid.childElementCount) grid.innerHTML = '<p class="gw-picker-none">Nothing matches.</p>';
  }
  // GIFs: with no search, the saved ones, those posted in chat and GIPHY's trending; a search asks GIPHY (through the hub,
  // which caches answers and keeps to the key's hourly limit). Searching waits for a pause in typing, to spend fewer calls.
  const gifPages = new Map();   // query -> { items, more, offset }
  async function giphy(qs, more = false) {
    const page = gifPages.get(qs);
    if (page && !more) return page;
    const offset = more ? page.offset + 24 : 0;
    const r = await fetch(`${hubHttp()}gifs?` + new URLSearchParams({ q: qs, offset }), { headers: authHeaders() });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Error(j.error ?? `Error ${r.status}`);
    const next = { items: [...(more ? page.items : []), ...j.items], more: j.more, offset };
    gifPages.set(qs, next); return next;
  }
  function drawGif() {
    grid.replaceChildren(); delete foot.dataset.hint;
    const url = (a) => `${hubHttp()}chat/img/${a.name}`, send = (a) => { opts.onGif({ name: a.name, w: a.w, h: a.h }); close(); };
    const saved = savedGifs(), qs = q.value.trim();
    const star = (a) => (b) => { const s = document.createElement('span'); s.className = 'gw-pg-star' + (saved.some((x) => x.name === a.name) ? ' on' : ''); s.style.backgroundImage = `url("${icon('star')}")`; s.title = 'Save or unsave'; s.onclick = (e) => { e.stopPropagation(); const on = !s.classList.contains('on'); saveGif(a, on); s.classList.toggle('on', on); }; b.append(s); };
    const sendGiphy = async (g, b) => { b.classList.add('busy'); try { await opts.onLink(g.url); close(); } catch (e) { b.classList.remove('busy'); foot.querySelector('[data-link]').placeholder = e.message; } };
    const giphySection = (title, query) => {
      const g = section(title), status = document.createElement('p'); status.className = 'gw-picker-hint'; status.textContent = 'Loading…'; g.append(status);
      const fill = (more) => giphy(query, more).then((page) => {
        status.remove(); g.querySelector('.gw-pg-more')?.remove();
        g.querySelectorAll('.gw-pg').forEach((x) => x.remove());
        for (const it of page.items) tile(g, 'gw-pg', it.preview, it.title || 'GIF', (e) => sendGiphy(it, e.currentTarget));
        if (!page.items.length) { status.textContent = 'No GIFs found.'; g.append(status); }
        if (page.more) { const m = document.createElement('button'); m.type = 'button'; m.className = 'dk-btn gw-pg-more'; m.textContent = 'More'; m.onclick = () => { m.disabled = true; fill(true); }; g.append(m); }
      }).catch((e) => { status.textContent = e.message; });
      fill(false);
    };
    if (qs) giphySection(`GIPHY: ${qs}`, qs);
    else {
      if (saved.length) { const g = section('Your saved GIFs'); for (const a of saved) tile(g, 'gw-pg', url(a), 'GIF', () => send(a), star(a)); }
      const posted = (opts.postedGifs?.() ?? []).filter((a) => !saved.some((x) => x.name === a.name));
      if (posted.length) { const g = section('Posted in chat'); for (const a of posted.slice(0, 30)) tile(g, 'gw-pg', url(a), 'GIF', () => send(a), star(a)); }
      giphySection('Trending on GIPHY', '');
    }
    foot.innerHTML = `<button type="button" class="dk-btn" data-up><img class="si" src="${icon('picture_add')}" alt="">Upload</button><input data-link placeholder="or paste a GIF link (https://…)" aria-label="GIF link"><button type="button" class="dk-btn blue" data-add><img class="si" src="${icon('link')}" alt="">Send</button><span class="gw-giphy">Powered by GIPHY</span>`;
    foot.querySelector('[data-up]').onclick = () => { close(); opts.onUpload(); };
    const link = foot.querySelector('[data-link]'), add = foot.querySelector('[data-add]');
    const go = async () => {
      const u = link.value.trim(); if (!u) return;
      add.disabled = true;
      try { const a = await opts.onLink(u); if (a) { saveGif(a, true); close(); } } catch (e) { link.value = ''; link.placeholder = e.message; } finally { add.disabled = false; }
    };
    add.onclick = go; link.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(); } };
  }
  const draw = () => {
    for (const b of el.querySelectorAll('[data-t]')) b.classList.toggle('on', b.dataset.t === tab);
    q.placeholder = tab === 'gif' ? 'Search GIPHY' : 'Search';
    if (tab === 'emoji') drawEmoji(); else if (tab === 'sticker') drawSticker(); else drawGif();
    grid.scrollTop = 0;
  };
  for (const b of el.querySelectorAll('[data-t]')) b.onclick = () => { tab = b.dataset.t; if (!opts.emojiOnly) ls.set('picker-tab', tab); q.value = ''; draw(); q.focus(); };
  let timer = 0;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, tab === 'gif' ? 700 : 120); });
  q.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey, true);
  $('[data-x]').onclick = () => close();
  const offEmotes = onEmotes(() => { if (el.isConnected) draw(); });
  function close() { offEmotes(); el.remove(); document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); if (openOne?.el === el) openOne = null; opts.onClose?.(); }
  openOne = { el, close };
  loadEmotes();
  draw(); place(); q.focus();
  return openOne;
}
