// The launcher's Workshop tab: browse and search Garry's Mod Workshop items (through the hub, hub/workshop.mjs), see each
// one's picture, size, rating and how heavy it is for this device, and install it before starting the game; plus the
// addons this browser has (turn each on or off for the next start, or remove it). Installed addons load when the game
// starts (and in the main menu, so a map is in Start New Game; tools/lift/host/steam.mjs).
//   mountWorkshop(el) -> { visible(on), destroy() }
import { hubJson, workshopDetails, downloadWorkshop, libraryMeta, updateMeta, removeFromLibrary, wsName, impact } from './library.js';
import { icon } from './derma.js';
import { dkConfirm } from './modal.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const thumb = (url, px = 256) => (url ? url + (url.includes('?') ? '&' : '?') + `imw=${px}&imh=${px}&ima=fit&impolicy=Letterbox` : '');
const TYPES = [['', 'Everything', 'application_view_tile'], ['Map', 'Maps', 'map'], ['Weapon', 'Weapons', 'gun'], ['Tool', 'Tools', 'wrench'], ['Vehicle', 'Vehicles', 'car'],
  ['NPC', 'NPCs', 'user_gray'], ['Entity', 'Entities', 'bricks'], ['Gamemode', 'Gamemodes', 'joystick'], ['Model', 'Models', 'brick'], ['Effects', 'Effects', 'star']];
const SORTS = [['trending', 'Trending', 'star'], ['popular', 'Most popular', 'heart'], ['latest', 'Latest', 'arrow_down']];
const installs = new Map();   // id -> { phase, loaded, total, error } while downloading (kept across tab switches)

export function mountWorkshop(el) {
  el.classList.add('gww');
  el.innerHTML = `
    <aside class="dk-tree gww-side">
      <form class="gww-search" data-search><input data-q placeholder="Search the Workshop" spellcheck="false" autocomplete="off"><button class="dk-btn" aria-label="Search"><img class="si" alt="" src="${icon('magnifier')}"></button></form>
      <div class="dk-node head">Browse</div>${SORTS.map(([k, l, ic]) => `<button type="button" class="dk-node kid" data-sort="${k}"><img class="si" alt="" src="${icon(ic)}"><span>${l}</span></button>`).join('')}
      <div class="dk-node head">Type</div>${TYPES.map(([k, l, ic]) => `<button type="button" class="dk-node kid" data-type="${k}"><img class="si" alt="" src="${icon(ic)}"><span>${l}</span></button>`).join('')}
      <div class="dk-node head">This browser</div><button type="button" class="dk-node kid" data-installed><img class="si" alt="" src="${icon('drive_disk')}"><span>Installed</span><b class="dk-badge" data-count hidden></b></button>
    </aside>
    <section class="gww-main">
      <div class="gww-head"><b data-title></b><small data-sub></small></div>
      <div class="gww-grid" data-grid></div>
      <div class="gww-foot" data-foot></div>
    </section>`;
  const $ = (q) => el.querySelector(q), grid = $('[data-grid]'), foot = $('[data-foot]');
  let view = { kind: 'browse', sort: 'trending', type: '', q: '' }, items = [], page = 1, total = 0, loading = false, gen = 0, shown = false;

  const have = (id) => !!libraryMeta()[wsName(id)];
  const count = () => { const n = Object.keys(libraryMeta()).length, b = $('[data-count]'); b.hidden = !n; b.textContent = n; };
  function nav() {
    for (const b of el.querySelectorAll('[data-sort]')) b.classList.toggle('on', view.kind === 'browse' && !view.q && b.dataset.sort === view.sort);
    for (const b of el.querySelectorAll('[data-type]')) b.classList.toggle('on', view.kind === 'browse' && b.dataset.type === view.type);
    $('[data-installed]').classList.toggle('on', view.kind === 'installed');
    count();
  }

  // ---- Browsing ----
  async function load(more = false) {
    if (loading && more) return;          // a new list replaces one still loading; "more" waits for it
    const my = ++gen;
    loading = true;
    if (!more) { page = 1; items = []; grid.replaceChildren(); grid.scrollTop = 0; }
    foot.textContent = 'Loading…';
    const typeName = TYPES.find((t) => t[0] === view.type)?.[1] ?? 'Everything';
    $('[data-title]').textContent = view.q ? `“${view.q}”` : `${SORTS.find((s) => s[0] === view.sort)[1]} · ${typeName}`;
    try {
      const q = new URLSearchParams({ sort: view.q ? 'search' : view.sort, page: String(page) });
      if (view.q) q.set('q', view.q);
      if (view.type) q.set('tag', view.type);
      const r = await hubJson('ws/browse?' + q);
      if (my !== gen) return;
      total = r.total ?? 0;
      const fresh = r.items.filter((i) => !items.some((x) => x.id === i.id));
      items.push(...fresh);
      for (const it of fresh) grid.append(card(it));
      $('[data-sub]').textContent = total ? `${total.toLocaleString()} items` : '';
      const moreLeft = r.items.length >= 20 && items.length < total;
      foot.replaceChildren();
      if (!items.length) foot.textContent = view.q ? 'Nothing found.' : 'Nothing here.';
      else if (moreLeft) { const b = h('button', 'dk-btn', 'Show more'); b.type = 'button'; b.onclick = () => { page++; load(true); }; foot.append(b); }
    } catch (e) {
      if (my !== gen) return;
      foot.textContent = e.status === 501 ? 'Workshop browsing is not set up on the server yet.' : e.message;
    } finally { if (my === gen) loading = false; }
  }
  const h = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of kids) if (k != null) e.append(k); return e; };
  const si = (name) => { const i = new Image(); i.className = 'si'; i.alt = ''; i.src = icon(name); return i; };
  let lazyOff = false;   // pictures in the details window and the Installed list load at once; the grid's as they scroll in
  // Workshop pictures as images with CORS (Steam allows it), which cross-origin isolated pages may show; CSS backgrounds may not be.
  const pic = (url, px, cls) => { const i = new Image(); i.className = cls; i.alt = ''; i.loading = px <= 256 && cls === 'gww-img' && !lazyOff ? 'lazy' : 'eager'; i.decoding = 'async'; i.crossOrigin = 'anonymous'; if (url) i.src = thumb(url, px); i.onerror = () => i.classList.add('none'); return i; };
  function card(it) {
    const c = h('div', 'gww-card dk-panel');
    c.dataset.id = it.id;
    const picBtn = h('button', 'gww-pic', pic(it.preview, 256, 'gww-img')); picBtn.type = 'button'; picBtn.setAttribute('aria-label', it.title);
    picBtn.onclick = () => details(it);
    const votes = it.up + it.down ? Math.round((100 * it.up) / (it.up + it.down)) : null, w = impact(it.size);
    c.append(picBtn, h('b', 'gww-name', it.title),
      h('small', 'gww-meta', `${size(it.size)}${it.subs ? ` · ${it.subs.toLocaleString()} subs` : ''}${votes !== null ? ` · ${votes}%` : ''}`),
      h('span', 'gww-weight', w.label), button(it));
    c.querySelector('.gww-weight').style.color = w.color;
    return c;
  }
  function button(it) {
    const st = installs.get(it.id), b = h('button', 'dk-btn gww-install');
    b.type = 'button'; b.dataset.install = it.id;
    if (have(it.id)) { b.append(si('accept'), 'Installed'); b.disabled = true; }
    else if (st) { b.disabled = true; b.append(si('arrow_down'), st.phase === 'transferring' && st.total ? `${Math.floor((100 * st.loaded) / st.total)}%` : st.phase === 'queued' ? 'Waiting…' : 'Fetching…'); }
    else { b.classList.add('blue'); b.append(si('arrow_down'), 'Install'); b.onclick = (e) => { e.stopPropagation(); install(it); }; }
    return b;
  }
  const refreshButtons = (id) => { for (const b of el.querySelectorAll(`[data-install="${CSS.escape(id)}"]`)) { const it = items.find((x) => x.id === id) ?? detailItem; if (it) b.replaceWith(button(it)); } };
  async function install(it) {
    installs.set(it.id, { phase: 'preparing', loaded: 0, total: it.size });
    refreshButtons(it.id);
    let last = 0;
    try {
      const name = await downloadWorkshop(it.id, { title: it.title, onProgress: (p) => { installs.set(it.id, p); if (Date.now() - last > 250) { last = Date.now(); refreshButtons(it.id); } } });
      updateMeta(name, { global: true, id: it.id, title: it.title, preview: it.preview ?? '', tags: it.tags ?? [] });
      note(`Installed ${it.title}. It loads when you start the game${it.tags?.includes('Map') ? '; its map is in Start New Game' : ''}.`);
    } catch (e) { note(`${it.title}: ${e.message}`, true); }
    installs.delete(it.id);
    refreshButtons(it.id); count();
  }

  // ---- One item, bigger ----
  let detailItem = null;
  function details(it) {
    detailItem = it;
    el.querySelector('.gww-detail')?.remove();
    const w = impact(it.size), votes = it.up + it.down ? Math.round((100 * it.up) / (it.up + it.down)) : null;
    const box = h('div', 'gww-detail');
    box.innerHTML = `<div class="dk-window pop" role="dialog" aria-label="${esc(it.title)}"><div class="dk-title"><img src="${icon('brick')}" alt="">${esc(it.title)}<span class="dk-tinfo"></span><button type="button" class="dk-wbtn close" data-x aria-label="Close"></button></div>
      <div class="dk-panel gww-dbody"><div class="gww-dpic" data-dpic></div>
        <div class="gww-dinfo"><div class="gww-dfacts"><span>${size(it.size)}</span>${it.subs ? `<span>${it.subs.toLocaleString()} subscribers</span>` : ''}${votes !== null ? `<span>${votes}% liked</span>` : ''}<span style="color:${w.color}">${esc(w.label)}</span></div>
          <div class="gww-tags">${(it.tags ?? []).filter((t) => t !== 'Addon').map((t) => `<span>${esc(t)}</span>`).join('')}</div>
          <p class="gww-desc">${esc(String(it.description ?? '').replace(/\[[^\]]+\]/g, '').slice(0, 1200)) || '<i>No description.</i>'}</p>
          <div class="gww-dbtns" data-btns><a class="dk-btn" target="_blank" rel="noopener" href="https://steamcommunity.com/sharedfiles/filedetails/?id=${esc(it.id)}"><img class="si" alt="" src="${icon('world')}">Open on Steam</a></div></div></div></div>`;
    box.querySelector('[data-btns]').prepend(button(it));
    lazyOff = true; box.querySelector('[data-dpic]').append(pic(it.preview, 512, 'gww-img')); lazyOff = false;
    const close = () => { box.remove(); detailItem = null; };
    box.querySelector('[data-x]').onclick = close;
    box.onclick = (e) => { if (e.target === box) close(); };
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    el.append(box);
    box.querySelector('.dk-wbtn').focus();
  }

  // ---- Installed ----
  async function installed() {
    ++gen; loading = false;
    $('[data-title]').textContent = 'Installed in this browser';
    const meta = libraryMeta(), names = Object.keys(meta).sort((a, b) => (meta[b].added ?? 0) - (meta[a].added ?? 0));
    $('[data-sub]').textContent = names.length ? `${names.length} addon${names.length === 1 ? '' : 's'} · ${size(names.reduce((s, n) => s + (meta[n].size ?? 0), 0))}` : '';
    grid.replaceChildren(); foot.replaceChildren();
    if (!names.length) { foot.textContent = 'Nothing installed yet. Browse the Workshop and press Install.'; return; }
    const ids = names.map((n) => meta[n].id).filter(Boolean);
    const info = ids.length && !names.every((n) => meta[n].preview !== undefined) ? await workshopDetails(ids.slice(0, 100)).catch(() => []) : [];
    for (const n of names) {
      const m = meta[n], d = info.find((x) => x.id === m.id), row = h('div', 'gww-row dk-panel');
      lazyOff = true; const rpic = h('span', 'gww-rpic', pic(m.preview || d?.preview, 128, 'gww-img')); lazyOff = false;
      const on = h('label', 'gww-on'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!m.global;
      box.onchange = () => { updateMeta(n, { global: box.checked }); note(box.checked ? `${m.title ?? n} loads when you start the game.` : `${m.title ?? n} stays installed but does not load.`); };
      on.append(box, ' Load in game');
      const rm = h('button', 'dk-btn', si('bin'), 'Remove'); rm.type = 'button';
      rm.onclick = async () => {
        if (!(await dkConfirm(`Remove ${m.title ?? n} from this browser?`, { title: 'Remove addon', ok: 'Remove', danger: true }))) return;
        const deleted = await removeFromLibrary(n);
        note(deleted ? `Removed ${m.title ?? n}.` : `${m.title ?? n} is kept because one of your versions uses it; it no longer loads by default.`);
        installed(); count();
      };
      row.append(rpic, h('span', 'gww-rinfo', h('b', null, m.title ?? n), h('small', null, `${size(m.size ?? 0)}${m.id ? ' · Workshop' : ' · from a file'}`)), on, rm);
      grid.append(row);
    }
  }

  // ---- Messages ----
  let noteTimer = 0;
  function note(text, bad = false) {
    let n = el.querySelector('.gww-note');
    if (!n) { n = h('div', 'gww-note'); el.append(n); }
    n.textContent = text; n.classList.toggle('bad', bad); n.hidden = false;
    clearTimeout(noteTimer); noteTimer = setTimeout(() => { n.hidden = true; }, 6000);
  }

  // ---- Wiring ----
  for (const b of el.querySelectorAll('[data-sort]')) b.onclick = () => { view = { ...view, kind: 'browse', sort: b.dataset.sort, q: '' }; $('[data-q]').value = ''; nav(); load(); };
  for (const b of el.querySelectorAll('[data-type]')) b.onclick = () => { view = { ...view, kind: 'browse', type: b.dataset.type }; nav(); load(); };
  $('[data-installed]').onclick = () => { view = { ...view, kind: 'installed' }; nav(); installed(); };
  $('[data-search]').onsubmit = (e) => { e.preventDefault(); const q = $('[data-q]').value.trim(); view = { ...view, kind: 'browse', q }; nav(); load(); };
  $('[data-q]').addEventListener('keydown', (e) => e.stopPropagation());
  grid.addEventListener('scroll', () => { if (view.kind === 'browse' && !loading && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 300 && foot.querySelector('button')) { page++; load(true); } });
  nav();
  return {
    visible(on) { if (on && !shown) { shown = true; load(); } else if (on && view.kind === 'installed') installed(); },
    destroy() { ++gen; el.replaceChildren(); },
  };
}
