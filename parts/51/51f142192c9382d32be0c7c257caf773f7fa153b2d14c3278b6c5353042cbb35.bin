// Runs inside GMod's own menu pages (added by html-panels.js to asset:// documents). The browser build has no
// folders to drop files into, so the game's Addons and Saves pages get the missing controls in their sidebars,
// in the same markup as the entries around them:
//   Addons: one "Installed" view (bundled addons with on/off switches, .gma files added from this computer) in place of
//           the Workshop views, plus "Install addon from file…".
//   Saves:  Share (instead of the Steam Workshop's Publish), community saves from other players, the account's cloud copy,
//           and import / export of save archives.
// Requests go to the page through window.__gmodHost (see the bridge in html-panels.js and menuHost in storage.js).

import { impact } from './library.js';
import { dkConfirm, dkPrompt, dkChoose, dkCopy } from './modal.js';

const host = (op, args) => window.__gmodHost(op, args);

function item(text, onClick, cls = '') {
  const li = document.createElement('li'), a = document.createElement('a');
  a.textContent = text; a.className = cls; a.href = '';
  a.addEventListener('click', (e) => { e.preventDefault(); onClick(a); });
  li.append(a);
  return li;
}
function note(text = '') {
  const li = document.createElement('li');
  li.className = 'wasm-note'; li.style.cssText = 'opacity:.75;font-size:11px;padding:2px 0 2px 8px;white-space:normal';
  li.textContent = text;
  return li;
}
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files[0] ?? null); input.remove(); }, { once: true });
    document.body.append(input); input.click();
  });
}
const scopeOf = (el) => window.angular?.element(el).scope();
const refresh = (page) => { const s = scopeOf(page); if (s?.Switch) s.$apply(() => s.Switch(s.Category, 0)); };
// Lua runs in the menu state; mounting makes an installed addon's content available without a restart.
const lua = (code) => { try { window.lua?.Run(code); } catch { /* not in engine */ } };
// An addon installed now: listed for web/live-addons.lua, which mounts it in the running game (server and client) and runs
// its Lua, as Workshop subscriptions do. In the menu, the next map picks it up the same way.
const liveMount = (name) => lua(`file.CreateDir("garrysweb") file.Write("garrysweb/mount.txt", (file.Read("garrysweb/mount.txt", "DATA") or "") .. "${String(name).replace(/[^\w.-]/g, '')}\\n")`);
let inGameNow = false;

// Addons page. GMod's own views need Steam, so they are replaced (in the page's own markup) by:
//   Installed: the addons bundled with the edition (each can be switched off; applied at the next start) and the .gma files
//              added to this browser (removable).
//   Workshop:  Trending / Most popular / Latest / search, served by the hub (hub/workshop.mjs); "Install" downloads the
//              item's .gma through the hub into this browser. "Install from Workshop link…" works without browsing.
const ADDON_TYPES = [['', 'All'], ['gamemode', 'Gamemodes'], ['map', 'Maps'], ['weapon', 'Weapons'], ['tool', 'Tools'], ['npc', 'NPCs'],
  ['entity', 'Entities'], ['vehicle', 'Vehicles'], ['effects', 'Effects'], ['model', 'Models'], ['servercontent', 'Content']];
const WS_TAG = { gamemode: 'Gamemode', map: 'Map', weapon: 'Weapon', tool: 'Tool', npc: 'NPC', entity: 'Entity', vehicle: 'Vehicle', effects: 'Effects', model: 'Model', servercontent: 'Servercontent' };
const WS_VIEWS = [['trending', 'Trending'], ['popular', 'Most popular'], ['latest', 'Latest']];
const niceSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids.filter((k) => k != null)); return e; };
const typeOfTags = (tags) => Object.keys(WS_TAG).find((k) => tags.some((t) => t.toLowerCase() === k)) ?? '';
const wsIdOf = (file) => /^ws-(\d+)[.-]/.exec(file ?? '')?.[1] ?? null;
const thumb = (url) => (url ? url + (url.includes('?') ? '&' : '?') + 'imw=180&imh=180&ima=fit&impolicy=Letterbox' : '');

async function addonsSidebar(page, ul) {
  // Hide the Steam-only entries and content (kept in the page so the game's own script keeps working).
  for (const li of [...ul.children].slice(1)) li.style.display = 'none';
  const content = page.querySelector('.ugc_content');
  for (const c of content?.children ?? []) c.style.display = 'none';

  let view = 'installed', filter = '', show = 'all', search = '', list = [], startedOff = null, wsItems = [], wsPage = 1, wsMore = false, wsState = '';
  const installing = new Set();
  const status = note();
  const link = (label, onClick) => { const li = el('li', { className: 'clickable' }), a = el('a', { href: '', textContent: label }); a.addEventListener('click', (e) => { e.preventDefault(); onClick(); }); li.append(a); return li; };
  const typeItems = ADDON_TYPES.map(([t, label]) => { const li = link(label, () => { filter = t; if (view === 'installed') render(); else browse(1); }); li.dataset.type = t; return li; });
  const showItems = [['all', 'Everything'], ['on', 'Enabled'], ['off', 'Disabled'], ['files', 'Added from files']].map(([k, label]) => { const li = link(label, () => { show = k; view = 'installed'; render(); }); li.dataset.show = k; return li; });
  const wsItemsNav = WS_VIEWS.map(([k, label]) => { const li = link(label, () => { view = k; search = ''; wsSearch.value = ''; browse(1); }); li.dataset.view = k; return li; });
  const searchBox = el('input', { type: 'text', className: 'search_bar', placeholder: 'Search installed' });
  searchBox.addEventListener('input', () => { search = searchBox.value.trim().toLowerCase(); render(); });
  const wsSearch = el('input', { type: 'text', className: 'search_bar', placeholder: 'Search the Workshop' });
  wsSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter' && wsSearch.value.trim()) { view = 'search'; browse(1); } });
  const installedHead = el('a', { href: '', textContent: 'Installed' });
  installedHead.addEventListener('click', (e) => { e.preventDefault(); view = 'installed'; render(); });
  const fromFile = item('Install addon from file…', async () => {
    const file = await pickFile('.gma');
    if (!file) return;
    status.textContent = `Installing ${file.name}…`;
    try {
      const name = await host('install-addon', { file });
      liveMount(name);
      status.textContent = inGameNow ? `Installed ${file.name}. It is ready to use now.` : `Installed ${file.name}.`;
    } catch (e) { status.textContent = `Could not install ${file.name}: ${e.message}`; }
    load();
  });
  const fromLink = item('Install from Workshop link…', async () => {
    const text = await dkPrompt('Paste a Workshop link or item number (steamcommunity.com/sharedfiles/filedetails/?id=…):', { title: 'Install from the Workshop', placeholder: 'https://steamcommunity.com/sharedfiles/filedetails/?id=…', ok: 'Install' });
    const id = /(?:[?&]id=|^)(\d{4,20})/.exec(String(text ?? '').trim())?.[1];
    if (!id) { if (text) status.textContent = 'That is not a Workshop link.'; return; }
    try { const [d] = await host('workshop-details', { ids: [id] }); if (!d?.ok) throw Error('That is not an available Garry\'s Mod Workshop item.'); install(d); } catch (e) { status.textContent = e.message; }
  });
  ul.append(
    el('li', {}, installedHead, el('ul', { className: 'submenu' }, ...typeItems, el('li', {}, searchBox))),
    el('li', { innerHTML: '&nbsp;' }), ...showItems,
    el('li', { innerHTML: '&nbsp;' }), el('li', {}, el('a', { className: 'notactive', textContent: 'Workshop', style: 'pointer-events:none;opacity:.7' })), ...wsItemsNav, el('li', {}, wsSearch),
    el('li', { innerHTML: '&nbsp;' }), fromLink, fromFile, status);

  // Content: the page's header and icon grid markup (css/Workshop.css).
  const title = el('span'), sub = el('small'), restart = el('a', { href: '', className: 'wasm-restart', textContent: 'Restart now' });
  restart.style.cssText = 'display:none;margin-left:10px;color:#ff5;font-size:13px;text-decoration:underline;cursor:pointer';
  restart.addEventListener('click', (e) => { e.preventDefault(); host('restart').catch(() => location.reload()); });
  const header = el('h1', { className: 'menuheader' }, title, ' ', sub, restart);
  const grid = el('workshopcontainer'), empty = el('workshopmessage'), more = el('a', { href: '', textContent: 'Load more' });
  more.style.cssText = 'display:block;margin:12px auto 20px;width:140px;text-align:center;padding:8px;border-radius:4px;background:#fff;color:#333;font-weight:bold;text-decoration:none';
  more.addEventListener('click', (e) => { e.preventDefault(); browse(wsPage + 1); });
  grid.style.cssText = 'overflow-y:auto;position:absolute;left:0;right:0;top:56px;bottom:0;display:block';
  const box = el('div', { className: 'wasm-addons' }, header, grid);
  box.style.cssText = 'position:absolute;inset:0';
  content?.append(box);

  const tile = ({ title: t, preview, size, kind, desc, off, controls, cross, weight }) => {
    const icon = el('workshopicon', { className: off ? 'disabled' : '' });
    icon.style.cssText = 'width:180px;height:180px;margin:6px';
    const img = el('img', { src: preview || '../img/localaddon.png', loading: 'lazy', alt: '' });
    if (cross) img.crossOrigin = 'anonymous';
    img.style.cssText = 'width:180px;height:180px;object-fit:cover';
    img.onerror = () => { img.onerror = null; img.removeAttribute('crossorigin'); img.src = '../img/localaddon.png'; };
    const pv = el('preview', {}, img, el('disabled'));
    pv.style.cssText = 'left:0;top:0;width:180px;height:180px';
    const right = el('right', {}, ...controls);
    icon.append(pv, el('name', {}, el('label', { textContent: t, title: t })), size ? el('size', { textContent: niceSize(size) }) : null,
      el('author', { textContent: kind }), weight ? el('votes', { textContent: weight.label, title: 'How much this addon may slow the game on this computer', style: `color:${weight.color}` }) : null,
      el('description', { textContent: desc }), el('controls', {}, el('left'), right));
    return icon;
  };
  const control = (text, fn) => { const c = el('control', { textContent: text }); c.addEventListener('click', fn); return c; };
  const kindOf = (type) => (type && ADDON_TYPES.find(([t]) => t === type)?.[1]?.replace(/s$/, '')) || 'Addon';
  const installedCard = (a) => tile({
    title: a.title, preview: a.preview, cross: a.cross, size: a.size, off: a.bundled && !a.enabled, weight: a.size ? impact(a.size) : null,
    kind: a.bundled ? kindOf(a.type) : a.wsid ? 'Workshop' : 'From file',
    desc: a.description || (a.bundled ? 'Bundled with this edition.' : a.file),
    controls: [a.bundled
      ? control(a.enabled ? 'Disable' : 'Enable', async () => { try { await host('set-addon-enabled', { name: a.name, enabled: !a.enabled }); a.enabled = !a.enabled; render(); } catch (e) { status.textContent = e.message; } })
      : control('Remove', async () => {
        if (!(await dkConfirm(`Remove "${a.title}"? It is deleted from this browser.`, { title: 'Remove addon', ok: 'Remove', danger: true }))) return;
        try { await host('remove-addon', { name: a.file }); status.textContent = `Removed ${a.title}. Restart the game to unload it.`; } catch (e) { status.textContent = e.message; }
        load();
      })],
  });
  const wsCard = (d) => {
    const have = list.some((a) => a.wsid === d.id), busy = installing.has(d.id);
    const votes = d.up + d.down ? `${Math.round((100 * d.up) / (d.up + d.down))}% liked · ` : '';
    return tile({ title: d.title, preview: thumb(d.preview), cross: true, size: d.size, kind: kindOf(typeOfTags(d.tags)), weight: impact(d.size),
      desc: `${votes}${d.subs ? d.subs.toLocaleString() + ' subscribers. ' : ''}${d.description}`,
      controls: [have ? el('control', { textContent: 'Installed', style: 'opacity:.6;cursor:default' }) : busy ? el('control', { textContent: 'Installing…', style: 'cursor:default' }) : control('Install', () => install(d))] });
  };

  async function install(d) {
    if (installing.has(d.id)) return;
    installing.add(d.id); render();
    const tick = setInterval(async () => {
      const p = await host('workshop-progress', { id: d.id }).catch(() => null);
      if (!p) return;
      status.textContent = p.phase === 'queued' ? `${d.title}: waiting for the download service${p.position > 1 ? ` (#${p.position})` : ''}…`
        : p.phase === 'downloading' || p.phase === 'preparing' ? `${d.title}: the service is fetching it from Steam…`
        : p.phase === 'transferring' ? `${d.title}: downloading ${p.total ? Math.floor((100 * p.loaded) / p.total) + '%' : niceSize(p.loaded)}`
        : p.phase === 'installing' ? `${d.title}: installing…`
        : p.phase === 'reconnecting' ? `${d.title}: lost the download service for a moment, reconnecting…` : status.textContent;
    }, 700);
    try {
      const name = await host('workshop-install', { id: d.id, title: d.title });
      liveMount(name);
      status.textContent = inGameNow ? `Installed ${d.title}. It is ready to use now.` : `Installed ${d.title}.`;
    } catch (e) { status.textContent = `${d.title}: ${e.message}`; }
    clearInterval(tick); installing.delete(d.id);
    await load();
  }
  async function browse(pageNo) {
    if (view === 'installed') return render();
    wsPage = pageNo; wsState = 'loading';
    if (pageNo === 1) wsItems = [];
    render();
    try {
      const r = await host('workshop-browse', { sort: view === 'search' ? 'search' : view, q: view === 'search' ? wsSearch.value.trim() : '', tag: WS_TAG[filter] ?? '', page: pageNo });
      wsItems = pageNo === 1 ? r.items : wsItems.concat(r.items.filter((i) => !wsItems.some((w) => w.id === i.id)));
      wsMore = r.items.length >= 20 && wsItems.length < r.total; wsState = '';
    } catch (e) { wsState = e.status === 501 ? 'Workshop browsing is not set up on the hub yet. "Install from Workshop link…" still works.' : e.message; }
    render();
  }
  function render() {
    const ws = view !== 'installed';
    installedHead.className = ws ? 'notactive' : 'active';
    for (const li of typeItems) li.firstChild.className = li.dataset.type === filter ? 'active' : 'notactive';
    for (const li of showItems) li.firstChild.className = !ws && li.dataset.show === show ? 'active' : 'notactive';
    for (const li of wsItemsNav) li.firstChild.className = li.dataset.view === view ? 'active' : 'notactive';
    // Installed addons are mounted at startup: a changed switch needs a restart.
    const nowOff = list.filter((a) => a.bundled && !a.enabled).map((a) => a.name).sort().join(',');
    restart.style.display = startedOff !== null && nowOff !== startedOff ? '' : 'none';
    if (ws) {
      title.textContent = view === 'search' ? `Workshop: “${wsSearch.value.trim()}”` : `Workshop: ${WS_VIEWS.find(([k]) => k === view)?.[1] ?? ''}`;
      sub.textContent = filter ? ADDON_TYPES.find(([t]) => t === filter)[1] : 'Garry\'s Mod addons, installed into this browser';
      empty.textContent = wsState === 'loading' ? 'Loading…' : wsState || 'Nothing found!';
      grid.replaceChildren(...(wsItems.length ? wsItems.map(wsCard) : [empty]), ...(wsItems.length && wsState === 'loading' ? [el('workshopmessage', { textContent: 'Loading…' })] : []), ...(wsMore && !wsState ? [more] : []));
      return;
    }
    const shown = list.filter((a) => (!filter || a.type === filter)
      && (show === 'all' || (show === 'on' && a.enabled) || (show === 'off' && !a.enabled) || (show === 'files' && !a.bundled))
      && (!search || a.title.toLowerCase().includes(search)));
    const on = list.filter((a) => a.enabled).length;
    title.textContent = 'Installed';
    sub.textContent = list.length ? `${on} of ${list.length} enabled${list.some((a) => a.bundled) ? ' · bundled addons can be switched off for a faster game' : ''}` : '';
    empty.textContent = list.length ? 'Nothing found!' : 'No addons yet. Install some from the Workshop or from a .gma file.';
    grid.replaceChildren(...(shown.length ? shown.map(installedCard) : [empty]));
  }
  async function load() {
    let bundled = { addons: [] }, files = [];
    try { [bundled, files] = await Promise.all([host('bundled-addons'), host('addons')]); } catch (e) { status.textContent = e.message; }
    list = [...bundled.addons.map((a) => ({ ...a, bundled: true })),
      ...files.map((f) => ({ title: f.title, file: f.file, size: f.size, type: f.type ?? '', description: f.description, enabled: true, bundled: false, wsid: f.wsid ?? wsIdOf(f.file) }))];
    list.sort((a, b) => a.title.localeCompare(b.title));
    startedOff ??= bundled.startedOff ?? '';
    // Pictures for addons installed from the Workshop (one request for all of them).
    const need = list.filter((a) => a.wsid && !a.preview);
    if (need.length) host('workshop-details', { ids: need.map((a) => a.wsid) }).then((ds) => { for (const d of ds) for (const a of need) if (a.wsid === d.id) { a.preview = thumb(d.preview); a.cross = true; } render(); }).catch(() => {});
    render();
  }
  load();
}

// Saves page. "My saves" stays the game's own view (Lua lists garrysmod/saves). Added around it:
//   - Share: the per-save "Publish" (a Steam Workshop upload) instead uploads the save to the hub and gives a link to send.
//   - Community saves: what other players shared (newest, most loaded, search, mine), with Load and Add to my saves; these
//     replace the Steam-only Workshop views.
//   - Cloud: whether this account's saves are kept online (web/cloud-sync.js), with Sync now.
//   - Import / export of save archives (.gwb) for moving saves by hand.
function savesSidebar(page, ul) {
  const status = note();
  const anchor = [...ul.querySelectorAll('a')].find((a) => /OpenFolder/.test(a.getAttribute('ng-click') ?? ''))?.closest('li');
  // The Steam Workshop sections (subscribed, trending...) cannot work here; the first entry (My saves) stays.
  const hideSteam = () => { for (const li of ul.querySelectorAll('li[ng-repeat]')) { const cat = scopeOf(li)?.cat; if (cat && cat !== 'local' && li.style.display !== 'none') li.style.display = 'none'; } };
  hideSteam(); new MutationObserver(hideSteam).observe(ul, { childList: true, subtree: true });
  const scope = scopeOf(page);
  const content = page.querySelector('.ugc_content') ?? page.querySelector('.page') ?? page;
  const views = [['latest', 'Newest'], ['popular', 'Most loaded'], ['mine', 'Shared by me']];
  let view = null, items = [], q = '', state = '';
  const box = el('div', { className: 'wasm-saves' }); box.style.cssText = 'position:absolute;inset:0;display:none;background:inherit;z-index:5';
  const title = el('span'), sub = el('small'), header = el('h1', { className: 'menuheader' }, title, ' ', sub);
  const grid = el('workshopcontainer'); grid.style.cssText = 'overflow-y:auto;position:absolute;left:0;right:0;top:56px;bottom:0;display:block';
  box.append(header, grid);
  content.style.position ||= 'relative';
  content.append(box);
  const showOwn = () => { view = null; box.style.display = 'none'; mark(); };
  const link = (label, fn) => { const li = el('li', { className: 'clickable' }), a = el('a', { href: '', textContent: label, className: 'notactive' }); a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); li.append(a); return li; };
  const navItems = views.map(([k, label]) => { const li = link(label, () => browse(k)); li.dataset.view = k; return li; });
  const search = el('input', { type: 'text', className: 'search_bar', placeholder: 'Search shared saves' });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { q = search.value.trim(); browse('search'); } });
  const mark = () => { for (const li of navItems) li.firstChild.className = li.dataset.view === view ? 'active' : 'notactive'; };
  // "My saves" (the game's own list) brings the page back from a community view.
  ul.addEventListener('click', (e) => { if (e.target.closest?.('a[ng-click*="Switch"]')) showOwn(); });
  const cloud = note('');
  const syncNow = item('Sync saves now', async () => {
    cloud.textContent = 'Syncing…';
    try { const r = await host('cloud-sync'); cloud.textContent = cloudText({ signedIn: true, ...r }); } catch (e) { cloud.textContent = e.message; }
  });
  const cloudText = (c) => !c.signedIn ? 'Sign in to a Garry\'s Web account (launcher → Profile) to keep saves online and on every browser.'
    : `Saves follow your account${c.user ? ` (${c.user})` : ''}.${c.at ? ` Last synced ${new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}${c.quota ? ` ${Math.round(c.used / 1048576)} of ${Math.round(c.quota / 1048576)} MB used.` : ''}`;
  host('cloud-status').then((c) => { cloud.textContent = cloudText(c); syncNow.style.display = c.signedIn ? '' : 'none'; }).catch(() => {});
  const openCode = item('Open a shared save…', async () => {
    const text = await dkPrompt('Paste a shared save link or code:', { title: 'Open a shared save', placeholder: 'https://… or code', ok: 'Open' });
    const code = /(?:[?&]save=|^)([A-Za-z0-9_-]{6,12})\s*$/.exec(String(text ?? '').trim())?.[1];
    if (!code) { if (text) status.textContent = 'That is not a shared save link.'; return; }
    add({ code, name: code }, false);
  });
  const imp = item('Import saves…', async () => {
    const file = await pickFile('.gwb');
    if (!file) return;
    status.textContent = `Importing ${file.name}…`;
    try { const n = await host('import-saves', { bytes: await file.arrayBuffer() }); status.textContent = `Imported ${n} save${n === 1 ? '' : 's'}.`; refresh(page); } catch (e) { status.textContent = e.message; }
  });
  const exp = item('Export saves', async () => {
    try { const n = await host('export-saves'); status.textContent = `Exported ${n} save${n === 1 ? '' : 's'} to gmod-saves.gwb.`; } catch (e) { status.textContent = e.message; }
  });
  const extra = [el('li', { innerHTML: '&nbsp;' }), el('li', {}, el('a', { className: 'notactive', textContent: 'Community saves', style: 'pointer-events:none;opacity:.7' })), ...navItems, el('li', {}, search),
    el('li', { innerHTML: '&nbsp;' }), openCode, imp, exp, status, el('li', { innerHTML: '&nbsp;' }), syncNow, cloud];
  if (anchor) anchor.after(...extra); else ul.append(...extra);
  // "Open folder" has no meaning in a browser.
  if (anchor) anchor.style.display = 'none';

  // Share replaces Publish: the save goes to the hub, the player gets a link (and it is listed for everyone unless they say no).
  const share = async (file) => {
    const info = file?.info ?? {};
    if (!info.file) return;
    const name = await dkPrompt('Name for the shared save:', { title: 'Share save', value: info.name ?? '', ok: 'Next' });
    if (name === null) return;
    const how = await dkChoose('Who can find it? Listed saves show under Community saves for everyone; unlisted ones only open with the link.', { title: 'Share save', choices: [['listed', 'List it for everyone'], ['link', 'Link only']] });
    if (how === null) return;
    const listed = how === 'listed';
    status.textContent = `Sharing ${name || info.name}…`;
    let map = '';
    try { map = await saveMap(info.file); } catch { /* unknown */ }
    try {
      const r = await host('save-share', { file: info.file, name, map, listed });
      status.textContent = '';
      dkCopy(`Anyone with this link can play “${r.name}”:`, r.link, { title: 'Save shared' });
    } catch (e) { status.textContent = e.message; }
  };
  if (scope) { scope.PublishLocal = share; scope.$applyAsync?.(); }
  // The game's own per-save button reads "Publish": say what it does here.
  new MutationObserver(() => { for (const c of page.querySelectorAll('control[ng-click^="PublishLocal"]')) if (c.textContent !== 'Share') c.textContent = 'Share'; })
    .observe(page, { childList: true, subtree: true, characterData: true });

  async function browse(k) {
    view = k; mark(); box.style.display = ''; state = 'loading'; items = []; render();
    try { const r = await host('save-shares', { sort: k === 'popular' ? 'popular' : 'latest', q: k === 'search' ? q : '', mine: k === 'mine' }); items = r.items; state = ''; }
    catch (e) { state = e.message; }
    render();
  }
  async function add(s, load) {
    status.textContent = `Getting ${s.name}…`;
    try {
      const file = await host('save-import-shared', { code: s.code });
      status.textContent = load ? `Loading ${s.name}…` : `Added “${s.name}” to My saves.`;
      if (load) lua(`RunConsoleCommand("gm_load", "${file.replace(/["\\]/g, '')}")`); else refresh(page);
    } catch (e) { status.textContent = e.message; }
  }
  function render() {
    title.textContent = view === 'search' ? `Community saves: “${q}”` : `Community saves: ${views.find(([k]) => k === view)?.[1] ?? ''}`;
    sub.textContent = 'Saves other Garry\'s Web players shared';
    if (state || !items.length) { grid.replaceChildren(el('workshopmessage', { textContent: state === 'loading' ? 'Loading…' : state || (view === 'mine' ? 'You have not shared any saves yet. Use Share on one of your saves.' : 'Nothing found!') })); return; }
    grid.replaceChildren(...items.map((s) => {
      const icon = el('workshopicon'); icon.style.cssText = 'width:180px;height:180px;margin:6px';
      const img = el('img', { src: s.thumbUrl || '../img/localaddon.png', loading: 'lazy', alt: '' }); img.crossOrigin = 'anonymous';
      img.style.cssText = 'width:180px;height:180px;object-fit:cover'; img.onerror = () => { img.onerror = null; img.removeAttribute('crossorigin'); img.src = '../img/localaddon.png'; };
      const pv = el('preview', {}, img); pv.style.cssText = 'left:0;top:0;width:180px;height:180px';
      const control = (t, fn) => { const c = el('control', { textContent: t }); c.addEventListener('click', fn); return c; };
      const controls = [control('Load', () => add(s, true)), control('Add', () => add(s, false)), control('Link', () => dkCopy(`Link to “${s.name}”:`, s.link, { title: 'Shared save' }))];
      if (s.mine) controls.push(control('Remove', async () => { if (!(await dkConfirm(`Stop sharing “${s.name}”?`, { title: 'Stop sharing', ok: 'Stop sharing', danger: true }))) return; try { await host('save-unshare', { code: s.code }); browse(view); } catch (e) { status.textContent = e.message; } }));
      icon.append(pv, el('name', {}, el('label', { textContent: s.name, title: s.name })), el('author', { textContent: `by ${s.author}` }),
        el('votes', { textContent: `${s.downloads} load${s.downloads === 1 ? '' : 's'}` }), el('description', { textContent: `${s.map ? 'Map: ' + s.map + '. ' : ''}${s.desc ?? ''}` }), el('controls', {}, el('left'), el('right', {}, ...controls)));
      return icon;
    }));
  }
}
// The map a save was made on, asked from the menu's Lua (GetSaveFileDetails); empty if it does not answer in time.
function saveMap(file) {
  return new Promise((resolve) => {
    const id = 'm' + Math.random().toString(36).slice(2);
    (window.__gwSaveInfo ??= {})[id] = (json) => { delete window.__gwSaveInfo[id]; try { resolve(JSON.parse(json).map ?? ''); } catch { resolve(''); } };
    lua(`local i = GetSaveFileDetails and GetSaveFileDetails("${file.replace(/["\\]/g, '')}") or {} if IsValid(pnlMainMenu) then pnlMainMenu:Call("window.__gwSaveInfo && __gwSaveInfo['${id}'] && __gwSaveInfo['${id}']('" .. string.JavascriptSafe(util.TableToJSON({ map = i.map or "" })) .. "')") end`);
    setTimeout(() => { if (window.__gwSaveInfo?.[id]) { delete window.__gwSaveInfo[id]; resolve(''); } }, 1500);
  });
}

// Multiplayer: GMod's own server browser, Start New Game and Join, with the browser's networking behind them.
// The menu's Lua asks `serverlist.Query` / `PingServer` / `PlayerList` for servers; in this build those are answered here:
//   - Garry's Web games: games other players started with Start New Game (Max Players above 1), listed through the hub
//     (web/lobby.js). They get stand-in addresses 10.78.x.y; joining one pairs the two pages peer to peer (WebRTC), then
//     connects to the host's virtual address 10.77.0.1.
//   - Real Garry's Mod servers: Steam's server list for the game, fetched and pinged by the hub (hub/servers.mjs). Their game
//     traffic goes through the hub's UDP relay (web/p2p.js), since a browser cannot send UDP.
// Favourites and history are kept by the menu's Lua in data/garrysweb_servers.txt.
const LUA_BRIDGE = `
if not serverlist or not pnlMainMenu then return end
GW = GW or { q = {}, n = 0, cb = {} }
local function js(s) if IsValid(pnlMainMenu) then pnlMainMenu:Call(s) end end
local FILE = "garrysweb_servers.txt"
local function load() GW.saved = GW.saved or util.JSONToTable(file.Read(FILE, "DATA") or "") or { fav = {}, hist = {} } return GW.saved end
local function save() file.Write(FILE, util.TableToJSON(GW.saved)) end
local function list(t) local o = {} for k in pairs(t) do o[#o + 1] = k end return util.TableToJSON(o) end
function serverlist.Query(data)
  GW.n = GW.n + 1 GW.q[GW.n] = data
  local s = load()
  local extra = data.Type == "favorite" and list(s.fav) or data.Type == "history" and list(s.hist) or "[]"
  js("window.__gwQuery && __gwQuery(" .. GW.n .. ", '" .. string.JavascriptSafe(data.Type or "internet") .. "', " .. extra .. ")")
end
function GW.Rows(id, json)
  local d = GW.q[tonumber(id)] if not d then return end
  for _, r in ipairs(util.JSONToTable(json) or {}) do
    local ok, more
    if r.failed then ok, more = pcall(d.CallbackFailed, r.address)
    else ok, more = pcall(d.Callback, r.ping, r.name, r.desc, r.map, r.players, r.max, r.bots, r.pass, r.lastplayed or 0, r.address, r.gm, r.ws or "0", false, r.ver, r.ver, r.loc or "", r.gmc or "") end
    if ok and more == false then GW.q[tonumber(id)] = nil return end
  end
end
function GW.Done(id) local d = GW.q[tonumber(id)] GW.q[tonumber(id)] = nil if d and d.Finished then pcall(d.Finished) end end
function serverlist.PingServer(addr, cb) GW.n = GW.n + 1 GW.cb[GW.n] = cb js("window.__gwPing && __gwPing(" .. GW.n .. ", '" .. string.JavascriptSafe(addr) .. "')") end
function serverlist.PlayerList(addr, cb) GW.n = GW.n + 1 GW.cb[GW.n] = cb js("window.__gwPlayers && __gwPlayers(" .. GW.n .. ", '" .. string.JavascriptSafe(addr) .. "')") end
function GW.Ping(id, json)
  local cb = GW.cb[tonumber(id)] GW.cb[tonumber(id)] = nil if not cb then return end
  local r = util.JSONToTable(json)
  if not r then return pcall(cb) end
  pcall(cb, r.ping, r.name, r.desc, r.map, r.players, r.max, r.bots, r.pass, 0, r.address, r.gm, r.ws or "0", false, r.ver, r.ver, r.loc or "", r.gmc or "")
end
function GW.Players(id, json) local cb = GW.cb[tonumber(id)] GW.cb[tonumber(id)] = nil if cb then pcall(cb, util.JSONToTable(json) or {}) end end
function serverlist.IsServerFavorite(addr) return load().fav[addr] == true end
function serverlist.AddServerToFavorites(addr) load().fav[addr] = true save() end
function serverlist.RemoveServerFromFavorites(addr) load().fav[addr] = nil save() end
GW.joinReal = GW.joinReal or JoinServer
function JoinServer(addr)
  addr = tostring(addr) load().hist[addr] = true save() GW.last = addr
  if addr:sub(1, 6) == "10.78." then js("window.__gwJoin && __gwJoin('" .. string.JavascriptSafe(addr) .. "')") return end
  -- Servers outside Garry's Web check each player's Steam login with Valve: the page decides (signed in to Steam or not).
  js("window.__gwJoinReal && __gwJoinReal('" .. string.JavascriptSafe(addr) .. "')")
end
function GW.DoJoinReal(addr) if GW.joinReal then GW.joinReal(addr) else RunConsoleCommand("connect", addr) end end
function serverlist.IsCurrentServerFavorite() return GW.last ~= nil and load().fav[GW.last] == true end
-- Shown by the menu page (a Derma popup would sit behind the server browser's HTML, out of sight).
function GW.Message(text, title) js("window.__gwMessage && __gwMessage('" .. string.JavascriptSafe(text) .. "', '" .. string.JavascriptSafe(title or "Multiplayer") .. "')") end
hook.Add("StartGame", "garrysweb", function() timer.Simple(0.5, function() js("window.__gwStarted && __gwStarted('" .. string.JavascriptSafe(engine.ActiveGamemode() or "") .. "', '" .. string.JavascriptSafe(GetConVarString("hostname") or "") .. "', " .. GetConVarNumber("sv_lan") .. ")") end) end)
timer.Create("garrysweb_ingame", 2, 0, function() js("window.__gwInGame && __gwInGame(" .. tostring(IsInGame()) .. ", '" .. string.JavascriptSafe(GetConVarString("host_map") or "") .. "')") end)
`;

async function serverBrowser() {
  // Only the main menu document (menu.html, where the server browser lives); other game pages run in other Lua states.
  if (window.__gwBridge || !window.lua?.Run || typeof window.AddServer !== 'function') return;
  window.__gwBridge = true;
  let p2p;
  try { p2p = await host('p2p-status'); } catch { return; }
  if (p2p.disabled) return;
  host('lobby-status').catch(() => {});   // connects to the hub's game list early
  const run = (fmt, ...args) => { try { window.lua?.Run(fmt, ...args.map(String)); } catch { /* not in engine */ } };
  run(LUA_BRIDGE.replaceAll('%', '%%'));
  const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '');
  const ourVer = () => String(window.GMOD_VERSION_INT ?? '');
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  // A message box in the menu page, over the server browser, in the menu's own look.
  const message = (text, title = 'Multiplayer') => {
    document.getElementById('gw-message')?.remove();
    const back = document.createElement('div'); back.id = 'gw-message';
    back.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'max-width:440px;margin:16px;background:#fff;color:#333;border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,.6);font:14px Helvetica,Arial,sans-serif;overflow:hidden';
    const h = document.createElement('div'); h.textContent = clean(title);
    h.style.cssText = 'padding:10px 14px;background:#2d8fe0;color:#fff;font-weight:bold;font-size:15px';
    const t = document.createElement('div'); t.textContent = clean(text); t.style.cssText = 'padding:14px;line-height:1.45';
    const ok = document.createElement('button'); ok.textContent = 'OK';
    ok.style.cssText = 'display:block;margin:0 14px 14px auto;padding:6px 22px;border:0;border-radius:3px;background:#2d8fe0;color:#fff;font:bold 14px Helvetica,Arial,sans-serif;cursor:pointer';
    ok.onclick = () => back.remove();
    box.append(h, t, ok); back.appendChild(box); document.body.appendChild(back);
  };
  window.__gwMessage = message;
  // Real servers need a real Steam login (Profile -> Sign in with Steam in the launcher, web/steam-account.js).
  // This frame is credentialless (its own empty storage), so the page answers whether the game started signed in.
  window.__gwJoinReal = async (address) => {
    const signedIn = await host('steam-signed-in').catch(() => false);
    if (!signedIn) {
      message("This server is not a Garry's Web game. Servers like it check that every player is signed in to Steam with a copy of Garry's Mod. To join them, quit to the launcher, open Profile and choose Sign in with Steam (optional). Garry's Web games can be joined without it.", "Steam sign-in needed");
      return;
    }
    notice('Connecting with your Steam account...'); setTimeout(() => notice(''), 6000);
    run('GW.DoJoinReal(%s)', String(address));
  };

  // Garry's Web games get stable stand-in addresses for the browser's lists.
  const fake = new Map(), byFake = new Map();
  const addrOf = (id) => { if (!fake.has(id)) { const n = fake.size + 1, a = `10.78.${n >> 8}.${n & 255}:27015`; fake.set(id, a); byFake.set(a, id); } return fake.get(id); };
  const lobbyRow = (l) => ({ ping: 30, name: clean(l.name), desc: cap(l.gamemode) || 'Sandbox', map: clean(l.map) || 'gm_flatgrass', players: l.players | 0, max: l.max | 0,
    bots: 0, pass: false, address: addrOf(l.id), gm: clean(l.gamemode) || 'sandbox', ws: '0', ver: ourVer(), loc: '', gmc: 'other', lan: !!l.lan });

  // Real servers from the hub, cached for half a minute. The ping shown is the hub's own trip to the server plus this
  // browser's trip to the hub, which is what relayed traffic takes.
  let cache = null, hubMs = 60;
  async function realServers() {
    if (cache && Date.now() - cache.at < 30e3) return cache.rows;
    const t0 = performance.now();
    const j = await host('server-list');
    hubMs = Math.max(10, Math.round((performance.now() - t0) / 4));
    const rows = j.servers.map(([address, name, map, players, max, bots, gm, ws, loc, gmc, ver, desc, pass, ping]) => ({
      address, name: clean(name), map: clean(map), players, max, bots, gm: clean(gm) || 'unknown', ws: ws || '0', loc: clean(loc), gmc: clean(gmc) || 'none',
      ver: String(ver).replace(/\D/g, ''), desc: clean(desc) || cap(gm), pass: !!pass, ping: ping ? ping + hubMs : 999 }));
    cache = { at: Date.now(), rows };
    return rows;
  }
  async function lobbies() {
    try {
      for (let i = 0; ; i++) {      // the first list arrives a moment after the hub connects
        const st = await host('lobby-status');
        if (st.disabled) return [];
        if (st.listed || i >= 20) return st.lobbies;
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch { return []; }
  }
  async function one(address) {
    const id = byFake.get(address);
    if (id) { const l = (await lobbies()).find((x) => x.id === id); return l ? lobbyRow(l) : null; }
    const known = (await realServers().catch(() => [])).find((r) => r.address === address);
    if (known) return known;
    try {
      const i = await host('server-info', { addr: address });
      return { address, name: clean(i.name), map: clean(i.map), players: i.players, max: i.max, bots: i.bots, gm: 'unknown', ws: '0', ver: String(i.version).replace(/\D/g, ''),
        desc: clean(i.game), pass: !!i.pass, ping: i.ping + hubMs, loc: '', gmc: 'none' };
    } catch { return null; }
  }
  const send = (id, rows) => { for (let i = 0; i < rows.length; i += 250) run('GW.Rows(%s, %s)', id, JSON.stringify(rows.slice(i, i + 250))); };

  window.__gwQuery = async (id, type, addrs) => {
    try {
      if (type === 'internet') {
        send(id, (await lobbies()).filter((l) => !l.lan).map(lobbyRow));
        send(id, await realServers().catch((e) => { message(e.message, 'Server list'); return []; }));
      } else if (type === 'lan') send(id, (await lobbies()).filter((l) => l.lan).map(lobbyRow));
      else if (addrs?.length) {
        const rows = await Promise.all(addrs.map(async (a) => (await one(a)) ?? { failed: true, address: a }));
        send(id, rows);
      }
    } finally { run('GW.Done(%s)', id); }
  };
  window.__gwPing = async (id, address) => { const r = await one(address).catch(() => null); run('GW.Ping(%s, %s)', id, r ? JSON.stringify(r) : ''); };
  window.__gwPlayers = async (id, address) => {
    let list = [];
    if (!byFake.has(address)) list = await host('server-players', { addr: address }).catch(() => []);
    run('GW.Players(%s, %s)', id, JSON.stringify(list.map((p) => ({ name: clean(p.name), score: p.score | 0, time: +p.time || 0 }))));
  };
  // A small notice over the server browser while a join links up; GMod's own loading screen takes over once connected.
  const notice = (text) => {
    let el = document.getElementById('gw-joining');
    if (!text) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'gw-joining';
      el.style.cssText = 'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:10000;padding:10px 18px;border-radius:4px;background:rgba(0,0,0,.82);color:#fff;font:14px Helvetica,Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.5);pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = text;
  };
  window.__gwJoin = async (address) => {
    const id = byFake.get(address);
    if (!id) { message('That game is no longer listed. Refresh the list and try again.', "Couldn't join"); return; }
    return joinLobby(id);
  };
  // A friend's game, by its id (the Join button in chat). Just after the game started the list may still be coming in.
  window.__gwJoinLobby = async (id) => {
    for (let i = 0; i < 30 && !(await lobbies().catch(() => [])).some((l) => l.id === id); i++) await new Promise((r) => setTimeout(r, 500));
    return joinLobby(id);
  };
  const joinLobby = async (id) => {
    const started = Date.now();
    const name = (await lobbies().catch(() => [])).find((l) => l.id === id)?.name ?? 'the game';
    notice(`Joining ${clean(name)}...`);
    const fail = (text) => { notice(''); message(text, "Couldn't join"); };
    try {
      await host('lobby-join', { id });
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await host('lobby-linked').catch(() => false)) { notice('Connected. Loading the game...'); setTimeout(() => notice(''), 4000); run('RunConsoleCommand("connect", "10.77.0.1")'); return; }
        const st = await host('lobby-status').catch(() => null);
        if (st && !st.joining) { fail(st.note || 'The host did not answer.'); return; }
        if (Date.now() - started > 7000) notice(`Joining ${clean(name)}... (no direct route, going through the Garry's Web server)`);
      }
      fail('The connection to the host did not come up. Check that the host is still in the game, then try again.');
    } catch (e) { fail(e.message); }
  };
  // Start New Game with more than one player slot lists the game; "Local Server" keeps it to the same network.
  let listed = false, starting = 0;
  window.__gwStarted = (gamemode, hostname, svLan) => {
    const root = window.angular?.element(document.body).injector?.().get('$rootScope');
    const max = +(root?.MaxPlayers ?? 1);
    if (max <= 1) { if (listed) { host('lobby-unhost').catch(() => {}); listed = false; } return; }
    starting = Date.now();
    host('lobby-host', { name: (hostname && hostname !== "Garry's Mod" ? clean(hostname) : '') || undefined, map: clean(root?.Map), gamemode: clean(gamemode), max, lan: svLan === 1 })
      .then(() => { listed = true; }).catch((e) => message(e.message, 'Hosting'));
  };
  // Also tells friends what the player is doing (the map, or the main menu), when that changes.
  let lastActivity = '';
  window.__gwInGame = (inGame, map = '') => {
    inGameNow = !!inGame;
    if (!inGame && listed && Date.now() - starting > 60e3) { listed = false; host('lobby-unhost').catch(() => {}); }
    const now = `${inGame}|${map}`;
    if (now !== lastActivity) { lastActivity = now; host('activity', { inGame: !!inGame, map: String(map).replace(/\.bsp$/i, '') }).catch(() => {}); }
  };
}

// A save chosen in the launcher (Continue, or Play on a save) is loaded as soon as a menu that can run Lua is up.
let askedSave = false;
function pendingSave() {
  if (askedSave || !window.lua?.Run) return;
  askedSave = true;
  host('pending-save').then((f) => { if (f) setTimeout(() => lua(`RunConsoleCommand("gm_load", "${f.replace(/["\\]/g, '')}")`), 1500); }).catch(() => {});
  // A friend's game picked in the launcher's chat (Join): joined once the menu is up.
  host('pending-join').then((id) => { if (id) setTimeout(() => window.__gwJoinLobby?.(id), 1000); }).catch(() => {});
}
const done = new WeakSet();
function scan() {
  if (!window.__gmodHost) return;
  pendingSave();
  serverBrowser();
  for (const [ctrl, add] of [['ControllerAddons', addonsSidebar], ['ControllerSaves', savesSidebar]]) {
    for (const page of document.querySelectorAll(`[ng-controller="${ctrl}"]`)) {
      const ul = page.querySelector('.options > ul');
      if (!ul || done.has(page)) continue;
      done.add(page);
      add(page, ul);
    }
  }
}
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
scan();
