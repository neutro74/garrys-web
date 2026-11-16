// Runs inside GMod's own menu pages (added by html-panels.js to asset:// documents). The browser build has no
// folders to drop files into, so the game's Addons and Saves pages get the missing controls in their sidebars,
// in the same markup as the entries around them:
//   Addons: one "Installed" view (bundled addons with on/off switches, .gma files added from this computer) in place of
//           the Workshop views, plus "Install addon from file…".
//   Saves:  "Import saves…" and "Export saves" next to "Open folder".
// Requests go to the page through window.__gmodHost (see the bridge in html-panels.js and menuHost in storage.js).

import { impact } from './library.js';

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
      lua(`if game.MountGMA then game.MountGMA("addons/${name}") end`);
      status.textContent = `Installed ${file.name}. It loads with the next map.`;
    } catch (e) { status.textContent = `Could not install ${file.name}: ${e.message}`; }
    load();
  });
  const fromLink = item('Install from Workshop link…', async () => {
    const text = prompt('Paste a Workshop link or item number (steamcommunity.com/sharedfiles/filedetails/?id=…):');
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
        if (!confirm(`Remove "${a.title}"? It is deleted from this browser.`)) return;
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
        : p.phase === 'installing' ? `${d.title}: installing…` : status.textContent;
    }, 700);
    try {
      const name = await host('workshop-install', { id: d.id, title: d.title });
      lua(`if game.MountGMA then game.MountGMA("addons/${name}") end`);
      status.textContent = `Installed ${d.title}. It loads with the next map.`;
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

function savesSidebar(page, ul) {
  const status = note();
  const anchor = [...ul.querySelectorAll('a')].find((a) => /OpenFolder/.test(a.getAttribute('ng-click') ?? ''))?.closest('li');
  const imp = item('Import saves…', async () => {
    const file = await pickFile('.gwb');
    if (!file) return;
    status.textContent = `Importing ${file.name}…`;
    try { const n = await host('import-saves', { bytes: await file.arrayBuffer() }); status.textContent = `Imported ${n} save${n === 1 ? '' : 's'}.`; refresh(page); } catch (e) { status.textContent = e.message; }
  });
  const exp = item('Export saves', async () => {
    try { const n = await host('export-saves'); status.textContent = `Exported ${n} save${n === 1 ? '' : 's'} to gmod-saves.gwb.`; } catch (e) { status.textContent = e.message; }
  });
  if (anchor) anchor.after(imp, exp, status); else ul.append(imp, exp, status);
  // "Open folder" has no meaning in a browser: point it at export instead of a Windows Explorer call.
  if (anchor) anchor.style.display = 'none';
}

// Multiplayer page: peer-to-peer play (web/p2p.js), found through the hub (web/lobby.js) or paired by invite codes.
// Online: "Host this game online" lists the running game; other players with the same edition see it here and click to join
// (the pages pair through the hub, then the game connects to the host). Invite codes still work without a hub, on a LAN.
async function serversSidebar(page, ul) {
  let p2pState;
  try { p2pState = await host('p2p-status'); } catch { return; }
  if (p2pState.disabled) return;   // experimental: only with ?mp=1
  const status = note();
  const connectWhenLinked = (check) => {
    let tries = 0;
    const t = setInterval(async () => {
      const ok = await check().catch(() => false);
      if (ok) { clearInterval(t); status.textContent = 'Linked. Connecting to the host…'; lua('RunConsoleCommand("connect","10.77.0.1")'); }
      else if (++tries > 60) { clearInterval(t); status.textContent = 'The link to the host did not come up. Try again.'; }
    }, 1000);
  };

  // ---- Online (hub) ----
  const online = [], gamesHead = document.createElement('li'), games = [];
  gamesHead.innerHTML = '<a class="notactive" style="pointer-events:none">Games online</a>';
  const hostItem = item('Host this game online…', async (a) => {
    try {
      const st = await host('lobby-status');
      if (st.hosting) { await host('lobby-unhost'); render(); return; }
      const name = prompt('Name of your game (shown to other players):', `${st.me}'s game`);
      if (name === null) return;
      await host('lobby-host', { name, max: 8 });
      status.textContent = 'Listed. Start a game with more than one player (Start New Game → Max Players) if you have not yet.';
      render();
    } catch (e) { status.textContent = e.message; }
  });
  let lastList = '';
  async function render() {
    let st;
    try { st = await host('lobby-status'); } catch (e) { status.textContent = e.message; return; }
    if (st.disabled) return;
    hostItem.firstChild.textContent = st.hosting ? `Stop listing “${st.hosting.name}”` : 'Host this game online…';
    const key = JSON.stringify(st.lobbies.map((l) => [l.id, l.name, l.players, l.max, l.map]));
    if (key !== lastList) {
      lastList = key;
      for (const li of games.splice(0)) li.remove();
      if (!st.lobbies.length) games.push(note(st.hub === 'online' ? 'No open games for this edition right now.' : 'Connecting to the game list…'));
      for (const l of st.lobbies) {
        const li = item(`${l.name}  (${l.players}/${l.max})`, async () => {
          try { await host('lobby-join', { id: l.id }); status.textContent = `Asking ${l.hostName} to join…`; connectWhenLinked(() => host('lobby-linked')); } catch (e) { status.textContent = e.message; }
        });
        li.title = `Hosted by ${l.hostName}${l.map ? ' on ' + l.map : ''}. Click to join.`;
        games.push(li);
      }
      gamesHead.after(...games);
    }
    if (st.note) status.textContent = st.note;
  }

  // ---- Invite codes (no hub needed; same network) ----
  const header = document.createElement('li');
  header.innerHTML = '<a class="notactive" style="pointer-events:none">Invite codes (same network)</a>';
  const field = (label, readonly = false) => {
    const li = document.createElement('li'), ta = document.createElement('textarea');
    li.className = 'wasm-note'; li.style.cssText = 'padding:2px 0 2px 8px;white-space:normal;font-size:11px;opacity:.9';
    ta.rows = 3; ta.readOnly = readonly; ta.placeholder = label; ta.style.cssText = 'width:92%;font-size:10px;word-break:break-all;resize:none';
    li.append(ta); return { li, ta };
  };
  const out = field('Your code appears here', true), reply = field('Paste the other player\'s code');
  out.li.hidden = reply.li.hidden = true;
  const show = (text) => { out.ta.value = text; out.li.hidden = !text; if (text) out.ta.select(); };
  const invite = item('Invite a player…', async () => {
    try { const r = await host('p2p-invite'); show(r.code); reply.li.hidden = false; reply.ta.placeholder = 'Paste their reply code, then press "Link player"'; status.textContent = `Send this code. They will be ${r.ip}.`; } catch (e) { status.textContent = e.message; }
  });
  const link = item('Link player (enter their reply)', async () => {
    try { await host('p2p-finish', { code: reply.ta.value }); reply.ta.value = ''; status.textContent = 'Linked.'; } catch (e) { status.textContent = e.message; }
  });
  const join = item('Join with an invite…', async () => {
    const code = reply.ta.value.trim();
    reply.li.hidden = false;
    if (!code) { reply.ta.placeholder = 'Paste the host\'s invite code here, then press this again'; status.textContent = 'Paste the invite code, then press Join again.'; return; }
    try {
      const r = await host('p2p-accept', { code }); reply.ta.value = ''; show(r); status.textContent = 'Send this reply code back to the host.';
      connectWhenLinked(async () => { const st = await host('p2p-status'); return st.role === 'guest' && st.peers.length > 0; });
    } catch (e) { status.textContent = e.message; }
  });
  const leave = item('Disconnect', async () => { try { await host('p2p-leave'); show(''); status.textContent = 'Disconnected.'; lua('RunConsoleCommand("disconnect")'); render(); } catch (e) { status.textContent = e.message; } });

  let hub = null;
  try { hub = await host('lobby-status'); } catch { /* no hub */ }
  if (hub && !hub.disabled) online.push(document.createElement('li'), gamesHead, hostItem);
  ul.append(...online, document.createElement('li'), header, invite, link, join, leave, out.li, reply.li, status);
  if (hub && !hub.disabled) { render(); const t = setInterval(() => { if (!page.isConnected) clearInterval(t); else render(); }, 2000); }
}

const done = new WeakSet();
function scan() {
  if (!window.__gmodHost) return;
  for (const [ctrl, add] of [['ControllerAddons', addonsSidebar], ['ControllerSaves', savesSidebar], ['ControllerServers', serversSidebar]]) {
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
