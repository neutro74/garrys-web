// The launcher's Browser tab: web pages opened through the hub's web proxy (hub/proxy.mjs), in a frame, with an address bar,
// back/forward/reload and a start page with search. Pages come from the hub's address with their links rewritten, so sites
// that refuse to be framed, or that this page could not reach because of CORS, still open. Signed-in accounts only.
//   mountBrowser(el) -> { visible(on), destroy() }
import { hubHttp } from './library.js';
import { account, authHeaders } from './account.js';
import { icon } from './derma.js';

const P = 'garrys-wasm.';
const ls = { get(k, d) { try { const v = localStorage.getItem(P + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch { /* blocked */ } } };
const SEARCH = (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
const SHORTCUTS = [
  ['Garry\'s Mod wiki', 'https://wiki.facepunch.com/gmod/', 'book'],
  ['Steam Workshop', 'https://steamcommunity.com/app/4000/workshop/', 'world'],
  ['Wikipedia', 'https://en.wikipedia.org/', 'book_open'],
  ['DuckDuckGo', 'https://html.duckduckgo.com/html/', 'magnifier'],
  ['Hacker News', 'https://news.ycombinator.com/', 'newspaper'],
  ['Facepunch', 'https://facepunch.com/', 'group'],
];
// What was typed: an address (with or without https://) or something to search for.
function toUrl(text) {
  const t = text.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(t) || /^localhost\b/i.test(t)) return 'https://' + t;
  return SEARCH(t);
}

export function mountBrowser(el) {
  el.classList.add('gwb');
  el.innerHTML = `
    <div class="gwb-bar">
      <button type="button" class="dk-btn" data-back data-tip="Back (Alt+Left)" aria-label="Back"><img class="si" alt="" src="${icon('arrow_left')}"></button>
      <button type="button" class="dk-btn" data-fwd data-tip="Forward (Alt+Right)" aria-label="Forward"><img class="si" alt="" src="${icon('arrow_right')}"></button>
      <button type="button" class="dk-btn" data-reload data-tip="Reload (F5)" aria-label="Reload"><img class="si" alt="" src="${icon('arrow_refresh')}"></button>
      <button type="button" class="dk-btn" data-home data-tip="Start page" aria-label="Start page"><img class="si" alt="" src="${icon('house')}"></button>
      <form class="gwb-addr" data-addr autocomplete="off"><img class="si" alt="" data-lock src="${icon('world')}"><input data-url spellcheck="false" placeholder="Search or type an address" aria-label="Address"><button class="dk-btn blue">Go</button></form>
    </div>
    <div class="gwb-view">
      <div class="gwb-start" data-start></div>
      <iframe data-frame credentialless title="Web page" referrerpolicy="no-referrer" allow="fullscreen; autoplay; clipboard-write; encrypted-media; picture-in-picture"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation" hidden></iframe>
      <div class="gwb-loading" data-loading hidden><span></span></div>
    </div>
    <div class="gwb-status" data-status></div>`;
  const $ = (q) => el.querySelector(q);
  const frame = $('[data-frame]'), input = $('[data-url]'), start = $('[data-start]'), status = $('[data-status]'), loading = $('[data-loading]');
  let session = null, stack = [], at = -1, moving = false, current = null;

  async function proxySession() {
    if (session && session.expires - Date.now() > 60e3) return session;
    const r = await fetch(hubHttp() + 'proxy/session', { method: 'POST', headers: authHeaders() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error ?? `Error ${r.status}`);
    return (session = j);
  }
  const frameUrl = (s, url) => { const u = new URL(url); return hubHttp().replace(/\/$/, '') + s.prefix + u.protocol.slice(0, -1) + '/' + u.host + u.pathname + u.search + u.hash; };

  function drawStart(msg = '') {
    const signedIn = !!account();
    start.innerHTML = `<div class="gwb-home dk-panel">
      <h2><img class="si" alt="" src="${icon('world')}"> Browser</h2>
      ${signedIn ? `<form data-search class="gwb-search"><input data-q placeholder="Search the web" spellcheck="false" autocomplete="off"><button class="dk-btn blue">Search</button></form>
        <div class="gwb-shortcuts">${SHORTCUTS.map(([n, u, ic], i) => `<button type="button" class="dk-btn" data-sc="${i}"><img class="si" alt="" src="${icon(ic)}">${n}</button>`).join('')}</div>
        <p class="hint">Pages open through the Garry's Web server, so sites that normally refuse to open inside another page work here. Sign-ins on sites last until you close the launcher. Don't enter passwords you care about: the server passes everything along.</p>`
        : '<p>The browser is for Garry\'s Web accounts. Sign in on the <b>Profile</b> tab to use it.</p>'}
      ${msg ? `<p class="gwb-err"></p>` : ''}</div>`;
    if (msg) start.querySelector('.gwb-err').textContent = msg;
    start.querySelector('[data-search]')?.addEventListener('submit', (e) => { e.preventDefault(); const q = start.querySelector('[data-q]').value; if (q.trim()) go(SEARCH(q)); });
    for (const b of start.querySelectorAll('[data-sc]')) b.onclick = () => go(SHORTCUTS[+b.dataset.sc][1]);
    for (const i of start.querySelectorAll('input')) i.addEventListener('keydown', (e) => e.stopPropagation());
  }
  function showStart(msg) { frame.hidden = true; frame.src = 'about:blank'; start.hidden = false; loading.hidden = true; current = null; input.value = ''; status.textContent = ''; drawStart(msg); buttons(); }
  function buttons() { $('[data-back]').disabled = at <= 0 && !current; $('[data-fwd]').disabled = at >= stack.length - 1; }

  async function go(url, { push = true } = {}) {
    if (!url) return;
    if (!account()) { showStart(); return; }
    if (!hubHttp()) { showStart('This copy of the game has no server, so the browser cannot open pages.'); return; }
    let s;
    try { s = await proxySession(); } catch (e) { showStart(e.message); return; }
    try { new URL(url); } catch { showStart('That address is not valid.'); return; }
    if (push) { stack = stack.slice(0, at + 1); stack.push(url); at = stack.length - 1; }
    current = url; input.value = url; ls.set('browser-last', url);
    start.hidden = true; frame.hidden = false; loading.hidden = false;
    moving = true; frame.src = frameUrl(s, url);
    $('[data-lock]').src = icon(url.startsWith('https:') ? 'lock' : 'world');
    status.textContent = `Opening ${new URL(url).host}…`;
    buttons();
  }
  frame.addEventListener('load', () => { loading.hidden = true; if (current) status.textContent = new URL(current).host; });
  // The page reports where it is (links followed inside it) and keys meant for the browser.
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow || !e.data?.gwProxy) return;
    if (e.data.gwProxy === 'nav' && typeof e.data.url === 'string') {
      const url = e.data.url;
      if (url !== current) {
        if (moving && stack[at] === current) { /* our own navigation landed on a redirect */ stack[at] = url; }
        else { stack = stack.slice(0, at + 1); stack.push(url); at = stack.length - 1; }
        current = url; ls.set('browser-last', url);
      }
      moving = false;
      if (document.activeElement !== input) input.value = url;
      status.textContent = e.data.title ? `${e.data.title} · ${new URL(url).host}` : new URL(url).host;
      $('[data-lock]').src = icon(url.startsWith('https:') ? 'lock' : 'world');
      buttons();
    } else if (e.data.gwProxy === 'key') key(e.data);
  };
  addEventListener('message', onMsg);
  function key({ key: k, alt, ctrl }) {
    if (alt && k === 'ArrowLeft') back(); else if (alt && k === 'ArrowRight') fwd();
    else if (ctrl && k.toLowerCase() === 'l') { input.focus(); input.select(); } else if (k === 'F5') reload();
  }
  const back = () => { if (at > 0) { at--; go(stack[at], { push: false }); } else if (current) showStart(); };
  const fwd = () => { if (at < stack.length - 1) { at++; go(stack[at], { push: false }); } };
  const reload = () => { if (current) go(current, { push: false }); };
  $('[data-back]').onclick = back; $('[data-fwd]').onclick = fwd; $('[data-reload]').onclick = reload; $('[data-home]').onclick = () => showStart();
  $('[data-addr]').onsubmit = (e) => { e.preventDefault(); const u = toUrl(input.value); if (u) go(u); input.blur(); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { input.value = current ?? ''; input.blur(); } });
  input.addEventListener('focus', () => input.select());
  const onKey = (e) => { if (el.closest('[hidden]') || !el.isConnected) return;   // only while the Browser tab is showing
    if ((e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') || e.key === 'F5') { e.preventDefault(); key({ key: e.key, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey }); } };
  document.addEventListener('keydown', onKey);

  showStart();
  const last = ls.get('browser-last', null);
  if (last && account()) { input.value = last; }
  return {
    visible(on) { if (on && !current) setTimeout(() => (start.querySelector('[data-q]') ?? input).focus(), 0); },
    open: (url) => go(toUrl(url)),
    destroy() { removeEventListener('message', onMsg); document.removeEventListener('keydown', onKey); el.replaceChildren(); },
  };
}
