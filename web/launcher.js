// Launcher: the edition menu and the loading screen. It runs before the game starts, then hands over to main.js.
// main.js reports progress only by writing text into #status; this file reads that text (no changes to the boot path).
// Edition choice reaches the guest as the `edition` parameter (main.js merges globalThis.__launch into its params).
// Both screens copy the game's own pages (main menu: html/template/main.html; loading: html/loading.html) and use
// their stock images, so the launcher looks like the game it starts and nothing extra ships.

import { Hub, hubStatus, playerId } from './hub.js';
import { account, login, register, logout, changePassword, sync, autoSync } from './account.js';
import { steamBox, steamAccount } from './steam-account.js';
import { launchAddons, versions, getVersion, putVersion, removeVersion, newVersionId, libraryMeta, hasFile, downloadWorkshop, workshopDetails, hubJson, hubHttp, impact, shareVersion, fetchSharedVersion, wsName } from './library.js';

const root = document.getElementById('launcher');
const statusEl = document.getElementById('status');
const params = new URLSearchParams(location.search);
for (const k of ['__gmod_cdn_isolation']) params.delete(k);   // added by the CDN isolation reload, not a user choice
const game = (p) => new URL('../game/garrysmod/' + p, import.meta.url).href;
const brand = (p) => new URL('./brand/' + p, import.meta.url).href;   // Garry's Web artwork (tools/brand/render.mjs)
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const EDITIONS = {
  base: {
    item: 'Play Base Game', name: "Garry's Mod", short: 'Base Game', picture: 'backgrounds/piggo_flight_of_the_construct.jpg',
    blurb: () => 'The stock sandbox, exactly as shipped. Maps: <b>gm_construct</b> and <b>gm_flatgrass</b>.<br>Smallest download; your saves and settings stay in this browser.',
  },
  extended: {
    item: 'Play Extended', name: "Garry's Mod: Extended", short: 'Extended', picture: 'backgrounds/intruso_orangebox_race.jpg',
    games: ['Portal', 'Half-Life 2', 'Episode One', 'Episode Two', 'Lost Coast', 'Counter-Strike: Source', 'HL2: Deathmatch', 'Day of Defeat: Source'],
    addons: ['M9K weapons', 'simfphys cars', 'VJ Base NPCs + zombies', 'DrGBase', 'Wiremod', 'AdvDupe2', 'Improved Stacker', 'Precision Alignment', 'Ragdoll Mover', 'TFA Base', 'Lightsabers', 'Stranded', 'Prop Hunt', 'Murder', 'Zombie Survival', 'Hide and Seek', 'gm_bigcity', 'gm_fork'],
    blurb: (ext) => `Mounted: <b>${EDITIONS.extended.games.join(', ')}</b><br>Addons: ${EDITIONS.extended.addons.join(', ')}<br>${ext ? fmtSize(ext.bytes) + ' of extra content, ' : ''}streamed only as you play it.`,
  },
};
// The third news card: Garry's Web itself (not playable), with where to find the community and the author.
const ABOUT = {
  name: "Garry's Web", short: 'About Garry\'s Web', banner: true,
  links: { server: 'https://discord.gg/PDPSqSKtT', profile: 'https://discordapp.com/users/827905760531841074' },
  blurb: () => `Garry's Mod in your browser: build, play and chat together with nothing to install.<br>`
    + `Community: <a href="${ABOUT.links.server}" target="_blank" rel="noopener">Join the Discord server</a><br>`
    + `Made by <b>neutro74</b> · <a href="${ABOUT.links.profile}" target="_blank" rel="noopener">Discord profile</a>`,
};
const QUALITY = {
  // The engine always runs at the window size (or the resolution saved in Options), so menus, console and HUD stay
  // sharp; a preset only scales the 3D view (mat_viewportscale), which is where the GPU time goes.
  perf: { label: 'Performance', scale: 0.5, size: '3D at 50%' },
  std: { label: 'Standard', scale: 0.75, size: '3D at 75%' },
  sharp: { label: 'Sharp', scale: 1, size: '3D at full size' },
};

const store = {
  get(k, d) { try { return localStorage.getItem('garrys-wasm.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('garrys-wasm.' + k, v); } catch { /* storage blocked */ } },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? Math.round(b / 1048576) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const sumTree = (n) => Object.values(n).reduce((a, v) => a + (typeof v === 'number' ? v : sumTree(v)), 0);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---- Backdrop ----------------------------------------------------------------------------------------------------
// The game's menu backgrounds (garrysmod/backgrounds), turning and growing as lua/menu/background.lua draws them.
// File names are "<author>_<title>"; authors with an underscore in the name are listed so the credit splits correctly.
const TWO_WORD_AUTHORS = ['alex_gem', 'shut_up', 'lemon_juice'];
function credit(file) {
  const stem = file.replace(/\.[a-z]+$/i, ''), two = TWO_WORD_AUTHORS.find((a) => stem.startsWith(a + '_'));
  const author = two ?? stem.split('_')[0], title = stem.slice(author.length + 1).split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  return { author, title };
}
async function backgroundList() {
  try {
    const r = await fetch(new URL('../game-index.json', import.meta.url));
    const files = (await r.json())?.garrysmod?.backgrounds ?? {};
    // JPEGs under ~2.2 MB: they arrive quickly, even while the engine is downloading.
    const list = Object.entries(files).filter(([n, s]) => /\.jpe?g$/i.test(n) && s < 2.3e6).map(([n]) => n);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  } catch { return []; }
}
class Backdrop {
  constructor(el) {
    this.el = el; this.files = []; this.at = 0; this.timer = 0; this.flip = false; this.stopped = false; this.onChange = () => {};
    this.slides = [0, 1].map(() => { const d = document.createElement('div'); d.className = 'slide'; el.append(d); return d; });
    this.fresh = 6;   // new pictures fetched at most; after that the ones already seen repeat (they are cached)
  }
  async start(files) {
    this.files = files;
    if (files.length) await this.next();
  }
  async next() {
    if (this.stopped || !this.files.length) return;
    const pool = Math.min(this.files.length, this.fresh), file = this.files[this.at++ % pool], url = game('backgrounds/' + file);
    try { const img = new Image(); img.src = url; await img.decode(); } catch { this.files.splice((this.at - 1) % pool, 1); return this.next(); }
    if (this.stopped) return;
    const slide = this.slides[+this.flip], old = this.slides[+!this.flip]; this.flip = !this.flip;
    slide.style.backgroundImage = `url("${url}")`;
    slide.className = 'slide';
    void slide.offsetWidth;   // restart the drift animation
    slide.className = `slide on ${reducedMotion ? '' : Math.random() < 0.5 ? 'drift-a' : 'drift-b'}`;
    old.classList.remove('on');
    this.current = file; this.onChange(credit(file));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), reducedMotion ? 30000 : 12000);
  }
  // The loading screen keeps whatever picture is showing (behind bg.png, as the stock screen shows the map) but
  // stops fetching new ones, so the engine download has the connection to itself.
  freeze() { clearTimeout(this.timer); this.stopped = true; }
  stop() {
    this.freeze();
    for (const s of this.slides) { s.style.backgroundImage = ''; s.className = 'slide'; }   // release the decoded pictures
  }
}

// What the host can run at all; shown on the menu rather than failing later with a blank page.
function problems() {
  const out = [];
  try { if (!document.createElement('canvas').getContext('webgl2')) out.push('WebGL 2 is not available, so the game cannot draw.'); } catch { out.push('WebGL 2 could not be checked.'); }
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) out.push('This page is not cross-origin isolated, which the game needs for threads. Reload it, or open it from its intended address.');
  if (typeof Worker === 'undefined' || !('storage' in navigator) || !navigator.storage.getDirectory) out.push('This browser lacks the file storage the game needs (OPFS). Use a current Chrome, Edge or Firefox.');
  return out;
}

async function extendedInfo() {
  try {
    const r = await fetch(new URL('../game-ext-index.json', import.meta.url), { cache: 'no-cache' });
    if (!r.ok) return null;
    return { bytes: sumTree(await r.json()) };
  } catch { return null; }
}

// ---- Main menu ---------------------------------------------------------------------------------------------------
// The left-hand list is the game's main menu list (bold white links, yellow when hovered); the card at the top right
// is its news box, here describing the edition under the pointer, with "What's new" under it; the smaller entries
// open panels in the card's place (chat, the files this browser keeps, controls). The bottom strip is its NavBar,
// with the graphics preset where the game has its gamemode chooser.
const WHATS_NEW = [
  ['Real servers', 'Sign in with Steam from Profile to join regular Garry\'s Mod servers in Find Multiplayer Game.'],
  ['Multiplayer', 'Start New Game with more than one player and friends find your game in the server list.'],
  ['Private chats', 'Message other players one to one from Chat; messages are kept.'],
  ['Discord', 'Join the community server from About.'],
  ['Game Versions', 'Make your own setup: an edition plus any Workshop addons. Share it as a link.'],
]
const CONTROLS = [
  ['W A S D', 'Move'], ['Space / Ctrl', 'Jump / crouch'], ['Shift', 'Sprint'], ['Q (hold)', 'Spawn menu'], ['C (hold)', 'Context menu'],
  ['E', 'Use'], ['F', 'Flashlight'], ['Z', 'Undo'], ['Mouse 1 / 2', 'Fire / alt fire, physgun grab / freeze'], ['Mouse wheel', 'Switch weapon'],
  ['Esc', 'Game menu (also releases the mouse)'], ['~', 'Console'], ['F11', 'Browser fullscreen'],
];
const ROOMS = [['general', 'General'], ['help', 'Help'], ['looking-for-game', 'Find a game'], ['off-topic', 'Off-topic']];
const nameColor = (s) => `hsl(${[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360} 70% 38%)`;
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Everything this browser keeps for the game: saves and addons in OPFS (written by storage-worker.js) and the downloaded
// game files in the service worker's cache.
async function opfsFiles() {
  const out = [];
  const walk = async (dir, p) => { for await (const [name, h] of dir.entries()) { if (h.kind === 'directory') await walk(h, `${p}/${name}`); else out.push({ path: `${p}/${name}`, size: (await h.getFile()).size }); } };
  const root = await navigator.storage.getDirectory();
  try { await walk(await root.getDirectoryHandle('garrys-wasm'), ''); } catch { /* nothing stored yet */ }
  // The addon library (library.js) lives beside it; its files count as addons.
  try { await walk(await root.getDirectoryHandle('garrys-wasm-library'), '/library'); } catch { /* none */ }
  return out;
}
async function gameCaches() {
  try { return (await caches.keys()).filter((k) => k.startsWith('garrys-wasm')); } catch { return []; }
}
async function filesPanel(el) {
  el.innerHTML = `<div class="panel-head"><img src="${game('html/img/creations.png')}" alt=""><span>Your files</span><a href="#" class="x" data-close title="Close">✕</a></div><div class="panel-body" data-body>Reading…</div>`;
  const body = el.querySelector('[data-body]');
  const render = async () => {
    const [files, cacheNames, est, persisted] = await Promise.all([opfsFiles(), gameCaches(),
      navigator.storage.estimate?.().catch(() => null), navigator.storage.persisted?.().catch(() => false)]);
    const sum = (f) => files.filter(f).reduce((a, x) => a + x.size, 0), count = (f) => files.filter(f).length;
    const saves = (x) => /\/garrysmod\/saves\/.*\.gms$/i.test(x.path), addons = (x) => /^\/library\/[^/]+\.gma$/i.test(x.path) || /\/garrysmod\/addons\/[^/]+\.gma$/i.test(x.path);
    const dupes = (x) => /\/garrysmod\/(dupes|data\/advdupe2)\//i.test(x.path), cfg = (x) => /\/garrysmod\/cfg\//i.test(x.path);
    let cached = 0; for (const n of cacheNames) { try { cached += (await (await caches.open(n)).keys()).length; } catch { /* ignored */ } }
    const used = est?.usage ?? 0, quota = est?.quota ?? 0;
    body.innerHTML = `
      <table class="facts">
        <tr><td>Saves</td><td>${count(saves)} <small>${fmtSize(sum(saves))}</small></td></tr>
        <tr><td>Addons (library)</td><td>${count(addons)} <small>${fmtSize(sum(addons))}</small></td></tr>
        <tr><td>Dupes</td><td>${count(dupes)} <small>${fmtSize(sum(dupes))}</small></td></tr>
        <tr><td>Settings</td><td>${count(cfg) ? 'saved' : 'defaults'}</td></tr>
        <tr><td>Downloaded game files</td><td>${cached ? `${cached} pieces` : 'none yet'}</td></tr>
        <tr><td>Space used</td><td>${fmtSize(used)}${quota ? ` <small>of ${fmtSize(quota)} allowed</small>` : ''}</td></tr>
        <tr><td>Protected from cleanup</td><td>${persisted ? 'yes' : 'no'}</td></tr>
      </table>
      <p class="hint">Saves and addons are managed from the game's own Saves and Addons pages (export, import, install, remove).</p>
      <div class="row">${persisted ? '' : '<button class="btn-primary" data-persist>Keep my files</button>'}${cached ? '<button class="btn" data-clear>Clear downloaded game files</button>' : ''}</div>
      <p class="hint" data-msg></p>`;
    const msg = body.querySelector('[data-msg]');
    body.querySelector('[data-persist]')?.addEventListener('click', async () => {
      const ok = await navigator.storage.persist?.().catch(() => false);
      msg.textContent = ok ? 'The browser will keep these files even when space runs low.' : 'The browser declined. Bookmarking or installing the page usually lets it agree.';
      if (ok) render();
    });
    body.querySelector('[data-clear]')?.addEventListener('click', async () => {
      if (!confirm('Delete the downloaded game files? They download again as you play. Saves, addons and settings are kept.')) return;
      for (const n of cacheNames) await caches.delete(n).catch(() => {});
      render();
    });
  };
  render();
}
function controlsPanel(el) {
  el.innerHTML = `<div class="panel-head"><img src="${game('html/img/settings.png')}" alt=""><span>Controls</span><a href="#" class="x" data-close title="Close">✕</a></div>
    <div class="panel-body"><table class="facts keys">${CONTROLS.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table>
    <p class="hint">Click the game to capture the mouse; Esc releases it. Key bindings can be changed in Options → Keyboard.</p></div>`;
}
// Profile: the player's name (used in chat and as the in-game name) and starting player colour. Models are picked in game.
const COLORS = [['#3d8bd9', 'Blue'], ['#d94040', 'Red'], ['#40a840', 'Green'], ['#e0b020', 'Yellow'], ['#9a50d0', 'Purple'], ['#e07a20', 'Orange'], ['#20b8b0', 'Teal'], ['#e0e0e0', 'White'], ['#303030', 'Black']];
const hexToVec = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
function accountBox(box, onChange) {
  const a = account();
  if (a) {
    box.innerHTML = `<div class="acct"><span>Signed in as <b>${esc(a.user)}</b>. Your versions, addon list and settings follow you to any browser.</span>
      <div class="row"><button class="btn" data-out>Sign out</button><button class="btn" data-pw>Change password</button></div><p class="hint" data-amsg></p></div>`;
    box.querySelector('[data-out]').onclick = async () => { await logout(); onChange(); };
    box.querySelector('[data-pw]').onclick = async () => {
      const old = prompt('Current password:'); if (old === null) return;
      const pass = prompt('New password (at least 6 characters):'); if (pass === null) return;
      try { await changePassword(old, pass); box.querySelector('[data-amsg]').textContent = 'Password changed. Other browsers are signed out.'; } catch (e) { box.querySelector('[data-amsg]').textContent = e.message; }
    };
    return;
  }
  box.innerHTML = `<div class="acct"><span>Sign in to keep your game versions, addon list and settings on every browser.</span>
    <form data-auth autocomplete="on"><input data-user name="username" autocomplete="username" maxlength="20" placeholder="Username" spellcheck="false">
      <input data-pass name="password" type="password" autocomplete="current-password" placeholder="Password">
      <button class="btn-primary" data-login>Sign in</button><button class="btn" type="button" data-register>Create account</button></form>
    <p class="hint" data-amsg></p></div>`;
  const msg = box.querySelector('[data-amsg]'), creds = () => [box.querySelector('[data-user]').value.trim(), box.querySelector('[data-pass]').value];
  const go = async (fn, done) => { msg.textContent = 'Working…'; try { const u = await fn(...creds()); msg.textContent = done(u); autoSync(); onChange(); } catch (e) { msg.textContent = e.message; } };
  box.querySelector('[data-auth]').onsubmit = (e) => { e.preventDefault(); go(login, (u) => `Signed in as ${u}.`); };
  box.querySelector('[data-register]').onclick = () => go(register, (u) => `Account ${u} created with this browser's settings.`);
}
function profilePanel(el, hub, onAccount = () => {}) {
  const color = store.get('playercolor-hex', '');
  el.innerHTML = `<div class="panel-head"><img src="${game('html/img/play.png')}" alt=""><span>Profile</span><a href="#" class="x" data-close title="Close">✕</a></div>
    <div class="panel-body">
      ${hubHttp() ? '<div data-account></div><div data-steam></div>' : ''}
      <label class="field"><span>Name</span><input data-name maxlength="24" autocomplete="nickname" spellcheck="false"></label>
      <p class="hint">Shown to other players in chat and in multiplayer games. 2 to 24 characters.</p>
      <div class="field"><span>Player colour</span><div class="swatches" role="radiogroup">${COLORS.map(([h, n]) => `<button type="button" role="radio" title="${n}" data-color="${h}" style="background:${h}"></button>`).join('')}
        <button type="button" role="radio" class="none" title="Keep the game's setting" data-color="">–</button></div></div>
      <p class="hint">Your player model, skin and weapon colour are chosen in game: hold <kbd>C</kbd> and pick <b>Player Model</b>.</p>
      <table class="facts"><tr><td>Player ID</td><td data-id></td></tr></table>
      <div class="row"><button class="btn-primary" data-save>Save</button></div><p class="hint" data-msg></p>
    </div>`;
  const $ = (q) => el.querySelector(q), input = $('[data-name]'), msg = $('[data-msg]');
  input.value = store.get('name', '') || hub.name;
  const sa = steamAccount(), id = sa ? Number(BigInt(sa.steamid) - 76561197960265728n) : +playerId();
  $('[data-id]').textContent = `STEAM_0:${id % 2}:${Math.floor(id / 2)}${sa ? ' (your Steam account)' : ''}`;
  let pick = color;
  const showPick = () => { for (const b of el.querySelectorAll('[data-color]')) b.setAttribute('aria-checked', String(b.dataset.color === pick)); };
  for (const b of el.querySelectorAll('[data-color]')) b.addEventListener('click', () => { pick = b.dataset.color; showPick(); });
  showPick();
  const save = () => {
    const n = input.value.replace(/[\u0000-\u001f"]/g, '').trim();
    if (n.length < 2) { msg.textContent = 'Pick a name of at least 2 characters.'; input.focus(); return; }
    store.set('name', n); hub.rename(n);
    store.set('playercolor-hex', pick); store.set('playercolor', pick ? hexToVec(pick) : '');
    msg.textContent = 'Saved. It applies the next time the game starts.';
  };
  $('[data-save]').addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  // Signing in or out changes the settings shown here (the account's replace this browser's): redraw.
  const steamEl = $('[data-steam]');
  if (steamEl) steamBox(steamEl, esc);
  const box = $('[data-account]');
  if (box) accountBox(box, () => { onAccount(); profilePanel(el, hub, onAccount); el.querySelector('[data-close]')?.addEventListener('click', (ev) => { ev.preventDefault(); onAccount('close'); }); });
  if (!account()) setTimeout(() => input.focus(), 50);
}
// Chat: the public rooms (kept on the hub, older messages load when scrolling up) and Private: one-to-one messages between
// Garry's Web accounts. Clicking a signed-in player's name in a room opens a private chat with them.
function chatPanel(el, hub) {
  el.innerHTML = `<div class="panel-head"><img src="${game('html/img/news.png')}" alt=""><span>Chat</span><small data-state></small><a href="#" class="x" data-close title="Close">✕</a></div>
    <div class="tabs" role="tablist">${ROOMS.map(([id, label]) => `<button role="tab" data-room="${id}">${label}<small data-count></small></button>`).join('')}<button role="tab" data-room="@private">Private</button></div>
    <div class="dmhead" data-dmhead hidden></div>
    <div class="log" data-log aria-live="polite"></div>
    <form class="say" data-say autocomplete="off">
      <input data-name maxlength="24" aria-label="Your name" title="Your name (click to change)">
      <input data-to maxlength="20" placeholder="Username" aria-label="Send to" hidden spellcheck="false">
      <input data-text maxlength="400" placeholder="Say something…" aria-label="Message">
      <button class="btn-primary">Send</button></form>`;
  const $ = (q) => el.querySelector(q), log = $('[data-log]'), text = $('[data-text]'), nameIn = $('[data-name]'), toIn = $('[data-to]'), stateEl = $('[data-state]'), dmHead = $('[data-dmhead]');
  const logs = new Map(ROOMS.map(([id]) => [id, []])), done = new Map(), users = new Map();
  const dmLogs = new Map(), dmDone = new Map(), unreadDm = new Set();
  let convos = [], peer = null, loadingOlder = false;
  let room = store.get('chat-room', 'general'); if (!logs.has(room) && room !== '@private') room = 'general';
  const priv = () => room === '@private';
  const line = (m) => {
    const d = document.createElement('div');
    if (m.sys) { d.className = 'sys'; d.textContent = m.sys; return d; }
    const t = document.createElement('time'), n = document.createElement('b'), s = document.createElement('span');
    const name = m.t === 'dm' ? (m.from === hub.account ? 'You' : m.from) : m.from.name;
    t.textContent = clock(m.at); n.textContent = name; n.style.color = nameColor(name); s.textContent = m.text;
    if (m.t !== 'dm' && m.from.account && m.from.account !== hub.account) { n.classList.add('who'); n.title = `Private chat with ${m.from.account}`; n.onclick = () => openDm(m.from.account); }
    if (m.t === 'dm' ? m.from === hub.account : hub.me && m.from.id === hub.me.id) d.className = 'mine';
    d.append(t, n, s); return d;
  };
  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const add = (r, m) => {
    const list = logs.get(r); if (!list) return;
    if (!list.length && r === room) log.replaceChildren();   // the room's empty-room note goes once something is said
    list.push(m);
    if (r === room) { const near = atBottom(); log.append(line(m)); if (near) log.scrollTop = log.scrollHeight; }
    else el.querySelector(`[data-room="${r}"]`)?.classList.add('unread');
  };
  const tabs = () => {
    for (const b of el.querySelectorAll('[data-room]')) {
      const on = b.dataset.room === room; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); if (on && !priv()) b.classList.remove('unread');
      const c = b.querySelector('[data-count]'); if (c) c.textContent = users.has(b.dataset.room) ? ` ${users.get(b.dataset.room).size}` : '';
    }
    el.querySelector('[data-room="@private"]').classList.toggle('unread', unreadDm.size > 0);
  };
  const show = () => {
    tabs();
    nameIn.hidden = priv(); toIn.hidden = !(priv() && !peer && hub.account);
    if (!priv()) {
      dmHead.hidden = true;
      const list = logs.get(room);
      log.replaceChildren(...(list.length ? list : [{ sys: `This is #${ROOMS.find(([id]) => id === room)[1]}. Messages are public and kept; be nice.` }]).map(line)); log.scrollTop = log.scrollHeight;
      log.title = users.has(room) ? `Here: ${[...users.get(room).values()].join(', ')}` : '';
    } else if (!hub.account) {
      dmHead.hidden = true;
      log.replaceChildren(line({ sys: 'Private chats are between Garry\'s Web accounts. Sign in or create one in Profile, then come back here.' }));
    } else if (!peer) {
      dmHead.hidden = true; log.title = '';
      log.replaceChildren(...(convos.length ? [] : [line({ sys: 'No private chats yet. Type a username below to start one, or click a name in a room.' })]));
      for (const c of convos) {
        const row = document.createElement('div'); row.className = 'convo' + (unreadDm.has(c.with) ? ' unread' : '');
        const n = document.createElement('b'), s = document.createElement('span'), t = document.createElement('time');
        n.textContent = c.with; n.style.color = nameColor(c.with); s.textContent = (c.last.from === hub.account ? 'You: ' : '') + c.last.text; t.textContent = clock(c.last.at);
        if (c.online) n.title = 'Online';
        row.append(n, s, t); row.onclick = () => openDm(c.with); log.append(row);
      }
    } else {
      dmHead.hidden = false;
      dmHead.innerHTML = `<a href="#" data-back>‹ Private chats</a> <b></b>`; dmHead.querySelector('b').textContent = peer;
      dmHead.querySelector('[data-back]').onclick = (ev) => { ev.preventDefault(); peer = null; hub.dms(); show(); };
      const list = dmLogs.get(peer) ?? [];
      log.replaceChildren(...(list.length ? list : [{ sys: dmLogs.has(peer) ? `Start your private chat with ${peer}. Only the two of you can read it.` : 'Loading…' }]).map(line)); log.scrollTop = log.scrollHeight;
    }
    state(hub.state);
  };
  function openDm(who) {
    room = '@private'; peer = who; unreadDm.delete(who); store.set('chat-room', room);
    if (!dmLogs.has(who)) hub.dmHistory(who);
    show(); text.focus();
  }
  const state = (s) => {
    stateEl.textContent = { connecting: 'connecting…', online: hub.online ? `${hub.online} online` : 'online', offline: 'offline, retrying…', off: '' }[s] ?? '';
    const ok = s === 'online' && (!priv() || !!hub.account);
    text.disabled = !ok;
    text.placeholder = s === 'off' ? 'Chat is not set up for this copy of the game.' : s !== 'online' ? 'Connecting to chat…'
      : priv() ? (!hub.account ? 'Sign in (Profile) for private chats' : peer ? `Message ${peer}` : 'Message') : `Message #${ROOMS.find(([id]) => id === room)[1]}`;
  };
  // Scrolling to the top loads older messages (rooms and private chats are both kept on the hub).
  log.addEventListener('scroll', () => {
    if (log.scrollTop > 20 || loadingOlder) return;
    if (!priv()) { const list = logs.get(room); if (!list?.length || done.get(room)) return; loadingOlder = true; hub.roomHistory(room, list[0].at); }
    else if (peer) { const list = dmLogs.get(peer); if (!list?.length || dmDone.get(peer)) return; loadingOlder = true; hub.dmHistory(peer, list[0].at); }
  });
  const prepend = (list, older) => {
    const h = log.scrollHeight; list.unshift(...older); show(); log.scrollTop = log.scrollHeight - h;
  };
  const offs = [
    hub.on('state', state),
    hub.on('welcome', (m) => { nameIn.value = m.name; state('online'); }),
    hub.on('authed', () => { if (hub.account) hub.dms(); show(); }),
    hub.on('room', (m) => { users.set(m.room, new Map(m.users.map((u) => [u.id, u.name]))); logs.set(m.room, m.history.slice()); done.set(m.room, m.history.length < 100); if (m.room === room) show(); else tabs(); }),
    hub.on('room-history', (m) => { loadingOlder = false; done.set(m.room, m.done); if (m.messages.length && logs.has(m.room)) { if (m.room === room) prepend(logs.get(m.room), m.messages); else logs.get(m.room).unshift(...m.messages); } }),
    hub.on('joined', (m) => { users.get(m.room)?.set(m.user.id, m.user.name); tabs(); }),
    hub.on('left', (m) => { users.get(m.room)?.delete(m.user.id); tabs(); }),
    hub.on('nick', (m) => { users.get(m.room)?.set(m.user.id, m.user.name); if (m.old !== m.user.name) add(m.room, { sys: `${m.old} is now ${m.user.name}` }); }),
    hub.on('msg', (m) => add(m.room, m)),
    hub.on('dms', (m) => { convos = m.list; for (const c of convos) if (c.last.from !== hub.account && c.last.at > +store.get(`dm-seen-${c.with}`, '0')) unreadDm.add(c.with); if (priv() && !peer) show(); else tabs(); }),
    hub.on('dm-history', (m) => {
      loadingOlder = false; dmDone.set(m.with, m.done);
      if (dmLogs.has(m.with) && m.messages.length && dmLogs.get(m.with).length) { if (peer === m.with) prepend(dmLogs.get(m.with), m.messages); else dmLogs.get(m.with).unshift(...m.messages); }
      else { dmLogs.set(m.with, m.messages.slice()); if (peer === m.with) show(); }
      const last = m.messages.at(-1); if (last && peer === m.with) store.set(`dm-seen-${m.with}`, String(last.at));
    }),
    hub.on('dm', (m) => {
      const other = m.from === hub.account ? m.to : m.from;
      if (dmLogs.has(other)) dmLogs.get(other).push(m);
      const c = convos.find((x) => x.with === other); if (c) c.last = m; else convos.unshift({ with: other, last: m });
      convos.sort((a, b) => b.last.at - a.last.at);
      if (priv() && peer === other) { const near = atBottom(); log.querySelector('.sys')?.remove(); log.append(line(m)); if (near) log.scrollTop = log.scrollHeight; store.set(`dm-seen-${other}`, String(m.at)); }
      else { if (m.from !== hub.account) unreadDm.add(other); if (priv() && !peer) show(); else tabs(); }
    }),
    hub.on('error', (m) => { loadingOlder = false; if (!priv()) add(room, { sys: m.error }); else { log.append(line({ sys: m.error })); log.scrollTop = log.scrollHeight; } }),
  ];
  for (const b of el.querySelectorAll('[data-room]')) b.addEventListener('click', () => {
    room = b.dataset.room; store.set('chat-room', room);
    if (priv()) { peer = null; hub.dms(); }
    show(); text.focus();
  });
  $('[data-say]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const t = text.value.trim(); if (!t) return;
    if (!priv()) { if (hub.say(room, t)) text.value = ''; return; }
    const to = peer ?? toIn.value.trim().toLowerCase();
    if (!to) { toIn.focus(); return; }
    if (hub.dm(to, t)) { text.value = ''; if (!peer) openDm(to); }
  });
  nameIn.value = hub.name;
  nameIn.addEventListener('change', () => { const n = nameIn.value.trim(); if (n.length >= 2) hub.rename(n); else nameIn.value = hub.name; });
  for (const [id] of ROOMS) hub.join(id);
  hub.connect(); if (hub.state === 'online') { hub.auth(); }
  show();
  setTimeout(() => text.focus(), 50);
  return () => { for (const off of offs) off(); };
}

// Game versions: an edition plus a chosen set of Workshop addons (and, for Extended, which bundled addons are left out),
// saved in this browser and shareable as a link. Playing one downloads any of its addons not yet in the library first.
const versionSize = (v) => v.addons.reduce((a, x) => a + (x.size || 0), 0);
const versionLine = (v) => `${EDITIONS[v.edition]?.short ?? v.edition} · ${v.addons.length} addon${v.addons.length === 1 ? '' : 's'}${versionSize(v) ? ' · ' + fmtSize(versionSize(v)) : ''}`;
const shareLink = (code) => `${location.origin}${location.pathname}?v=${code}`;
const badge = (bytes, count) => { const w = impact(bytes, { count }); return `<span class="weight" style="color:${w.color}" title="How much this may slow the game on this computer">${esc(w.label)}</span>`; };
async function bundledList() {
  try { return await (await fetch(new URL('../game/ext/wasm-addons.json', import.meta.url))).json(); } catch { return []; }
}
function versionsPanel(el, { ext, onPlay, highlight }) {
  let editing = null, results = [], searching = '', note = '';
  const draw = () => (editing ? drawEditor() : drawList());
  function drawList() {
    const list = versions();
    el.innerHTML = `<div class="panel-head"><img src="${game('html/img/games.png')}" alt=""><span>Game Versions</span><a href="#" class="x" data-close title="Close">✕</a></div>
      <div class="panel-body">
        <p class="hint">A version is an edition with your own choice of Workshop addons. Share one as a link and friends get the same setup.</p>
        <div class="vlist">${list.length ? list.map((v) => `<div class="vrow${v.id === highlight ? ' hl' : ''}" data-v="${v.id}">
          <div class="vinfo"><b>${esc(v.name)}</b>${v.author ? ` <small>by ${esc(v.author)}</small>` : ''}<div><small>${esc(versionLine(v))}</small> ${badge(versionSize(v), v.addons.length)}</div></div>
          <div class="vbtns"><button class="btn-primary" data-act="play">Play</button><button class="btn" data-act="edit">Edit</button>${hubHttp() ? '<button class="btn" data-act="share">Share</button>' : ''}<button class="btn" data-act="del" title="Delete">✕</button></div>
          <div class="vshare" hidden></div></div>`).join('') : '<p class="hint">No versions yet.</p>'}</div>
        <div class="row"><button class="btn-primary" data-new>New version</button>${hubHttp() ? '<button class="btn" data-import>Open a shared link…</button>' : ''}</div>
        <p class="hint" data-msg>${esc(note)}</p></div>`;
    el.querySelector('[data-new]').onclick = () => { editing = { id: newVersionId(), name: '', edition: ext ? 'extended' : 'base', addons: [], disabled: [], author: store.get('name', '') }; results = []; draw(); };
    el.querySelector('[data-import]')?.addEventListener('click', async () => {
      const text = prompt('Paste a shared version link or code:');
      const code = /(?:[?&]v=|^)([A-Za-z0-9_-]{4,16})\s*$/.exec(String(text ?? '').trim())?.[1];
      if (!code) return;
      try { const v = await importShared(code); highlight = v.id; note = `Added “${v.name}”.`; } catch (e) { note = e.message; }
      draw();
    });
    for (const row of el.querySelectorAll('[data-v]')) {
      const v = getVersion(row.dataset.v);
      row.querySelector('[data-act="play"]').onclick = () => onPlay(v);
      row.querySelector('[data-act="edit"]').onclick = () => { editing = structuredClone(v); results = []; draw(); };
      row.querySelector('[data-act="del"]').onclick = () => { if (confirm(`Delete “${v.name}”? Its addons stay in your library.`)) { removeVersion(v.id); draw(); } };
      row.querySelector('[data-act="share"]')?.addEventListener('click', async (e) => {
        const box = row.querySelector('.vshare'); box.hidden = false; box.textContent = 'Sharing…';
        try {
          const code = await shareVersion(v); putVersion({ ...getVersion(v.id), code });
          box.innerHTML = `<input readonly value="${esc(shareLink(code))}"><button class="btn" data-copy>Copy</button>`;
          box.querySelector('input').select();
          box.querySelector('[data-copy]').onclick = async (ev) => { try { await navigator.clipboard.writeText(shareLink(code)); ev.target.textContent = 'Copied'; } catch { ev.target.textContent = 'Select and copy'; } };
        } catch (err) { box.textContent = err.message; }
        e.target.disabled = true;
      });
    }
  }
  async function drawEditor() {
    const v = editing, total = versionSize(v), bundled = v.edition === 'extended' ? await bundledList() : [];
    const lib = Object.entries(libraryMeta()).filter(([n]) => !v.addons.some((a) => a.name === n));
    el.innerHTML = `<div class="panel-head"><img src="${game('html/img/games.png')}" alt=""><span>${v.name ? esc(v.name) : 'New version'}</span><a href="#" class="x" data-back title="Back">✕</a></div>
      <div class="panel-body">
        <label class="field"><span>Name</span><input data-name maxlength="48" value="${esc(v.name)}" placeholder="My mod pack"></label>
        <div class="field"><span>Edition</span><div class="seg">${(ext ? ['base', 'extended'] : ['base']).map((e) => `<button type="button" data-ed2="${e}" class="${v.edition === e ? 'on' : ''}">${EDITIONS[e].short}</button>`).join('')}</div></div>
        <div class="field top"><span>Addons</span><div class="addons">
          ${v.addons.length ? v.addons.map((a, i) => `<div class="arow"><span title="${esc(a.title || a.name)}">${esc(a.title || a.name)}</span><small>${a.size ? fmtSize(a.size) : ''}</small>${a.size ? badge(a.size, 1) : ''}<a href="#" data-rm="${i}" title="Remove">✕</a></div>`).join('') : '<small class="muted">None yet. Search the Workshop below.</small>'}
          <div class="total">${v.addons.length ? `Total ${fmtSize(total)} · ${badge(total, v.addons.length)}` : ''}</div></div></div>
        <div class="field top"><span>Add</span><div class="addons">
          <form data-search class="say" style="padding:0;background:none;border:0"><input data-q placeholder="Search the Workshop, or paste a link" value="${esc(searching)}"><button class="btn">Search</button></form>
          <div data-results>${results.map((d, i) => `<div class="arow"><img src="${esc(d.preview ? d.preview + (d.preview.includes('?') ? '&' : '?') + 'imw=48&imh=48&ima=fit' : '')}" crossorigin="anonymous" alt=""><span title="${esc(d.title)}">${esc(d.title)}</span><small>${fmtSize(d.size)}</small>${badge(d.size, 1)}${v.addons.some((a) => a.id === d.id) ? '<small>added</small>' : `<a href="#" data-add="${i}">Add</a>`}</div>`).join('')}</div>
          ${lib.length ? `<details><summary>From your library (${lib.length})</summary>${lib.map(([n, m]) => `<div class="arow"><span>${esc(m.title || n)}</span><small>${m.size ? fmtSize(m.size) : ''}</small><a href="#" data-lib="${esc(n)}">Add</a></div>`).join('')}</details>` : ''}
        </div></div>
        ${bundled.length ? `<details class="field top"><summary>Bundled Extended addons (${bundled.length - v.disabled.length} of ${bundled.length} on)</summary><div class="checks">${bundled.map((b) => `<label><input type="checkbox" data-bundled="${esc(b.name)}" ${v.disabled.includes(b.name) ? '' : 'checked'}> ${esc(b.title)}</label>`).join('')}</div></details>` : ''}
        <div class="row"><button class="btn-primary" data-save>Save</button><button class="btn" data-cancel>Cancel</button></div><p class="hint" data-msg>${esc(note)}</p></div>`;
    const $ = (q) => el.querySelector(q);
    $('[data-name]').oninput = (e) => { v.name = e.target.value; };
    for (const b of el.querySelectorAll('[data-ed2]')) b.onclick = () => { v.edition = b.dataset.ed2; draw(); };
    for (const a of el.querySelectorAll('[data-rm]')) a.onclick = (e) => { e.preventDefault(); v.addons.splice(+a.dataset.rm, 1); draw(); };
    for (const a of el.querySelectorAll('[data-add]')) a.onclick = (e) => { e.preventDefault(); const d = results[+a.dataset.add]; v.addons.push({ name: wsName(d.id), id: d.id, title: d.title, size: d.size }); draw(); };
    for (const a of el.querySelectorAll('[data-lib]')) a.onclick = (e) => { e.preventDefault(); const m = libraryMeta()[a.dataset.lib]; v.addons.push({ name: a.dataset.lib, id: m.id, title: m.title, size: m.size }); draw(); };
    for (const c of el.querySelectorAll('[data-bundled]')) c.onchange = () => { v.disabled = c.checked ? v.disabled.filter((n) => n !== c.dataset.bundled) : [...v.disabled, c.dataset.bundled]; };
    $('[data-search]').onsubmit = async (e) => {
      e.preventDefault();
      searching = $('[data-q]').value.trim(); note = '';
      if (!searching) return;
      const id = /(?:[?&]id=|^)(\d{6,20})$/.exec(searching)?.[1];
      $('[data-results]').innerHTML = '<small class="muted">Searching…</small>';
      try { results = id ? (await workshopDetails([id])).filter((d) => d.ok) : (await hubJson('ws/browse?' + new URLSearchParams({ q: searching }))).items.slice(0, 12); if (!results.length) note = 'Nothing found.'; }
      catch (err) { results = []; note = err.message; }
      draw();
    };
    $('[data-save]').onclick = () => {
      if (!v.name.trim()) { note = 'Give the version a name.'; draw(); return; }
      v.name = v.name.trim().slice(0, 48); putVersion(v); highlight = v.id; editing = null; note = `Saved “${v.name}”.`; draw();
    };
    $('[data-cancel]').onclick = $('[data-back]').onclick = (e) => { e.preventDefault(); editing = null; note = ''; draw(); };
  }
  draw();
}
// A shared version (code from a ?v= link): added to this browser's list once.
async function importShared(code) {
  const have = versions().find((x) => x.code === code);
  if (have) return have;
  return putVersion(await fetchSharedVersion(code));
}
// Before a version starts: fetch its addons that are not in the library yet, reporting through the loading screen's status.
async function fetchVersionAddons(v) {
  const missing = [];
  for (const a of v.addons) if (!(await hasFile(a.name))) missing.push(a);
  let i = 0;
  for (const a of missing) {
    i++;
    if (!a.id) { console.warn(`[versions] ${a.title || a.name} is not in this browser and has no Workshop id; skipped`); continue; }
    const label = a.title || `item ${a.id}`;
    try {
      await downloadWorkshop(a.id, { title: a.title, onProgress: (p) => {
        statusEl.textContent = `Downloading addons... (${i}/${missing.length}) ${label}${p.phase === 'transferring' && p.total ? ` ${Math.floor((100 * p.loaded) / p.total)}%` : p.phase === 'queued' ? ' (waiting)' : p.phase === 'downloading' ? ' (fetching from Steam)' : ''}`;
      } });
    } catch (e) { console.warn(`[versions] ${label}: ${e.message}`); }
  }
}

function menu(ext, backdrop, opts = {}) {
  return new Promise((resolve) => {
    const ids = ext ? ['base', 'extended'] : ['base'];
    let edition = ids.includes(store.get('edition')) ? store.get('edition') : 'base';
    let quality = store.get('quality', (navigator.hardwareConcurrency ?? 8) <= 4 ? 'perf' : 'sharp');
    if (!QUALITY[quality]) quality = 'std';
    const warn = problems(), single = ids.length === 1, hub = new Hub();
    // Garry's Web is a fan project: say so, and whose the game is.
    const legal = `Garry's Web is an unofficial fan project, not affiliated with Facepunch Studios or Valve. ${ext ? "Garry's Mod and the bundled games belong to Facepunch Studios and Valve; addons belong to their Workshop authors." : "Garry's Mod belongs to Facepunch Studios and Valve."}`;
    const extras = [['about', 'About'], ['versions', 'Game Versions'], ['profile', 'Profile'], ['chat', 'Chat'], ['files', 'Your Files'], ['controls', 'Controls'], ['fullscreen', 'Fullscreen']].filter(([k]) => k !== 'chat' || hub.url);

    const page = document.createElement('div');
    page.className = 'page';
    page.innerHTML = `
      <div class="options"><ul>
        <li class="logo"><img src="${brand('logo@2x.png')}" alt="Garry's Web" width="288" height="128"></li>
        <li class="gap"></li>
        ${ids.map((id) => `<li><a href="#" data-ed="${id}">${single ? 'Start Game' : EDITIONS[id].item}</a></li>`).join('')}
        ${versions().filter((v) => ids.includes(v.edition)).slice(-4).reverse().map((v) => `<li class="ver"><a href="#" data-gv="${v.id}">${esc(v.name)} <small>${esc(versionLine(v))}</small></a></li>`).join('')}
        <li class="gap small"></li>
        ${extras.map(([k, label]) => `<li class="sub"><a href="#" data-open="${k}">${label}${k === 'chat' ? '<small data-online></small>' : ''}</a></li>`).join('')}
        ${warn.length ? `<li class="gap"></li>${warn.map((w) => `<li><span class="note warn">${esc(w)}</span></li>`).join('')}` : ''}
      </ul></div>
      <div class="side">
        <div class="news"><div class="news_item" data-news><div><span data-news-title></span><font data-news-text></font></div></div>
          <div class="news_buttons">${[...ids, 'about'].reverse().map((id) => `<div data-pager="${id}" title="${esc((EDITIONS[id] ?? ABOUT).short)}"></div>`).join('')}</div>
          <div class="whatsnew"><div class="whatsnew_head"><img src="${game('html/img/whatsnew.png')}" alt="">What's new</div>
            <ul>${WHATS_NEW.map(([t, d]) => `<li><b>${esc(t)}</b> ${esc(d)}</li>`).join('')}</ul></div></div>
        <div class="panel" data-panel hidden></div>
      </div>`;
    const nav = document.createElement('div');
    nav.className = 'navbar';
    nav.innerHTML = `<div class="info"><div data-credit>&nbsp;</div><div class="legal">${esc(legal)}</div></div>
      <button class="button" data-gfx aria-haspopup="true"><img src="${game('html/img/settings.png')}" alt=""><span data-gfx-label></span></button>
      <ul class="popup" data-gfx-menu hidden>${Object.entries(QUALITY).map(([k, q]) => `<li tabindex="0" data-q="${k}"><img src="${game('html/img/settings.png')}" alt="">${q.label}<small>${q.size}</small></li>`).join('')}</ul>`;
    const version = document.createElement('div');
    version.className = 'version';
    version.textContent = "Garry's Web: Garry's Mod in your browser";
    root.append(page, nav, version);
    backdrop.onChange = (c) => { nav.querySelector('[data-credit]').innerHTML = `Background: “<b>${esc(c.title)}</b>” by ${esc(c.author)}`; };
    if (backdrop.current) backdrop.onChange(credit(backdrop.current));

    const $ = (q) => root.querySelector(q), popup = $('[data-gfx-menu]'), panelEl = $('[data-panel]'), newsEl = $('.news');
    // How many people are in chat, next to its menu entry (one status request, no socket until the panel opens).
    const onlineEl = $('[data-online]');
    const showOnline = (n) => { if (onlineEl) onlineEl.textContent = n ? ` ${n} online` : ''; };
    if (onlineEl) hubStatus(hub.url).then((s) => showOnline(s?.online));
    hub.on('welcome', (m) => showOnline(m.online));
    let panel = null, closePanel = null, card = edition;   // card: the news card shown (an edition, or 'about')
    const openPanel = (k) => {
      closePanel?.(); closePanel = null;
      if (k === 'about') { if (panel) openPanel(panel); showCard('about'); return; }
      if (k === 'fullscreen') {
        if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {});
        return;
      }
      panel = panel === k ? null : k;
      panelEl.hidden = !panel; newsEl.hidden = !!panel;
      for (const a of page.querySelectorAll('[data-open]')) a.classList.toggle('cur', a.dataset.open === panel);
      if (panel === 'chat') closePanel = chatPanel(panelEl, hub);
      else if (panel === 'versions') versionsPanel(panelEl, { ext, highlight: opts.highlight, onPlay: (v) => play(v.edition, v) });
      else if (panel === 'profile') profilePanel(panelEl, hub, (why) => { if (why === 'close') openPanel('profile'); else location.reload(); });
      else if (panel === 'files') filesPanel(panelEl);
      else if (panel === 'controls') controlsPanel(panelEl);
      panelEl.querySelector('[data-close]')?.addEventListener('click', (ev) => { ev.preventDefault(); openPanel(panel); });
    };
    const fsLabel = () => { const a = page.querySelector('[data-open="fullscreen"]'); if (a) a.textContent = document.fullscreenElement ? 'Leave Fullscreen' : 'Fullscreen'; };
    document.addEventListener('fullscreenchange', fsLabel);
    for (const a of page.querySelectorAll('[data-open]')) a.addEventListener('click', (ev) => { ev.preventDefault(); openPanel(a.dataset.open); });

    const render = () => {
      for (const a of page.querySelectorAll('[data-ed]')) a.classList.toggle('cur', a.dataset.ed === edition);
      for (const d of page.querySelectorAll('[data-pager]')) d.classList.toggle('selected', d.dataset.pager === card);
      for (const a of page.querySelectorAll('[data-open="about"]')) a.classList.toggle('cur', card === 'about');
      const e = card === 'about' ? ABOUT : EDITIONS[card];
      $('[data-news]').classList.toggle('banner', !!e.banner);
      $('[data-news]').style.backgroundImage = `url("${e.banner ? brand('banner.png') : game(e.picture)}")`;
      $('[data-news-title]').textContent = e.name;
      $('[data-news-text]').innerHTML = e.blurb(ext);
      const q = QUALITY[quality];
      $('[data-gfx-label]').textContent = `Graphics: ${q.label}`;
      for (const li of popup.children) li.classList.toggle('active', li.dataset.q === quality);
    };
    const setEdition = (id) => { if (id !== edition || card !== id) { edition = id; card = id; store.set('edition', id); render(); } };
    const showCard = (id) => { if (id === 'about') { card = id; render(); } else setEdition(id); };
    const setQuality = (q) => { if (q !== quality) { quality = q; store.set('quality', q); render(); } };
    const qs = Object.keys(QUALITY), cycle = (d) => setQuality(qs[(qs.indexOf(quality) + d + qs.length) % qs.length]);
    let went = false;
    const play = (id, gv = null) => {
      if (went) return;
      went = true; edition = id; if (!gv) store.set('edition', id);
      closePanel?.(); hub.close();
      document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', closePopup); document.removeEventListener('fullscreenchange', fsLabel);
      page.classList.add('leave'); nav.classList.add('leave'); version.remove();
      setTimeout(() => { page.remove(); nav.remove(); resolve({ edition, scale: QUALITY[quality].scale, version: gv }); }, reducedMotion ? 0 : 350);
    };
    for (const a of page.querySelectorAll('[data-gv]')) a.addEventListener('click', (ev) => { ev.preventDefault(); const v = getVersion(a.dataset.gv); if (v) play(v.edition, v); });
    if (opts.open) setTimeout(() => openPanel(opts.open), 0);
    for (const a of page.querySelectorAll('[data-ed]')) {
      a.addEventListener('click', (ev) => { ev.preventDefault(); play(a.dataset.ed); });
      a.addEventListener('pointerenter', () => setEdition(a.dataset.ed));
      a.addEventListener('focus', () => setEdition(a.dataset.ed));
    }
    for (const d of page.querySelectorAll('[data-pager]')) d.addEventListener('click', () => { if (panel) openPanel(panel); showCard(d.dataset.pager); });
    $('[data-gfx]').addEventListener('click', () => { popup.hidden = !popup.hidden; if (!popup.hidden) popup.querySelector('.active')?.focus(); });
    for (const li of popup.children) {
      const pick = () => { setQuality(li.dataset.q); popup.hidden = true; $('[data-gfx]').focus(); };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); pick(); } });
    }
    const closePopup = (ev) => { if (!popup.hidden && !popup.contains(ev.target) && !$('[data-gfx]').contains(ev.target)) popup.hidden = true; };
    document.addEventListener('pointerdown', closePopup);
    // Up/down (W/S) moves between the Play entries, left/right (A/D) changes the graphics preset, Enter plays.
    // Typing in a panel (chat) is left alone; Esc there closes the panel.
    const onKey = (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const k = ev.key, typing = /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(ev.target?.tagName) && panelEl.contains(ev.target);
      if (k === 'Escape') { if (!popup.hidden) popup.hidden = true; else if (panel) openPanel(panel); return; }
      if (typing || panelEl.contains(ev.target)) return;
      if (!popup.hidden) {
        if (k === 'ArrowUp' || k === 'ArrowDown') {
          ev.preventDefault();
          const items = [...popup.children], i = items.indexOf(document.activeElement);
          items[(i + (k === 'ArrowUp' ? -1 : 1) + items.length) % items.length].focus();
        }
        return;
      }
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'w' || k === 's') {
        ev.preventDefault();
        const id = ids[(ids.indexOf(edition) + (k === 'ArrowUp' || k === 'w' ? -1 : 1) + ids.length) % ids.length];
        page.querySelector(`[data-ed="${id}"]`).focus();
      } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd') {
        ev.preventDefault(); cycle(k === 'ArrowLeft' || k === 'a' ? -1 : 1);
      } else if (k === 'Enter' && !document.activeElement?.closest?.('.navbar, [data-open]')) {
        ev.preventDefault(); play(edition);
      }
    };
    document.addEventListener('keydown', onKey);
    render();
  });
}

// ---- Loading screen --------------------------------------------------------------------------------------------
// Boot messages from guest-worker.js (and their order) become a progress value. The last stage, the engine's own startup,
// has no measurable total, so it eases toward 99% and completes when the first frame arrives.
const STAGES = ['Loading the engine', 'Reading game files', 'Loading game code', 'Starting the game'];
function phase(text) {
  let m;
  if (/^Starting\.\.\./.test(text)) return [0, 0, 'Preparing'];
  if ((m = /^Downloading addons\.\.\. \((\d+)\/(\d+)\) (.*)$/.exec(text))) return [1 + 5 * ((m[1] - 1) / m[2]), 0, `Addon ${m[1]} of ${m[2]}: ${m[3]}`];
  if (/^Loading host/.test(text)) return [2, 0, 'Engine host'];
  if (/^Indexing game files/.test(text)) return [6, 1, 'Game file index'];
  if (/^Indexing bundled/.test(text)) return [9, 1, 'Bundled games and addons'];
  if (/^Loading fonts/.test(text)) return [12, 1, 'Fonts'];
  if (/^Creating guest/.test(text)) return [15, 2, 'Creating the virtual machine'];
  if ((m = /^Loading (.+?)\.\.\. \((\d+)\/(\d+)\)/.exec(text))) return [15 + 55 * (m[2] / m[3]), 2, `${m[1]} (${m[2]} of ${m[3]})`];
  if ((m = /^Initializing (.+?)\.\.\./.exec(text))) return [72, 2, `Initializing ${m[1]}`];
  if (/^Starting the game/.test(text)) return [80, 3, 'Sandbox'];
  return null;
}
const ERROR = /fail|error|lost|unavailable|not part of|not found|isolation|exception|out of memory|\bat \w+/i;
// A plain-language reading of common failures, shown above the raw message.
function advice(text) {
  if (/out of memory|allocation|RangeError.*memory|Array buffer/i.test(text)) return 'The browser ran out of memory. Close other tabs, pick the Performance graphics preset and try again.';
  if (/isolation|SharedArrayBuffer/i.test(text)) return 'The page could not enable the isolation the game needs for threads. Reload it; if that does not help, open it from its original address.';
  if (/context lost|webgl/i.test(text)) return 'The graphics driver dropped the game. Pick the Performance preset, or close other graphics-heavy tabs.';
  if (/storage|opfs/i.test(text)) return 'The browser refused file storage. Private windows and some privacy settings block it.';
  if (/fetch|network|404|not found/i.test(text)) return 'A game file could not be downloaded. Check the connection and reload.';
  return 'Something went wrong while starting. Reloading usually helps; the details below say what failed.';
}
// loading.html's own rule: dark at night (19:00 to 07:00) on old browsers, otherwise when the system is dark, and
// always for Spooktober (15 October to 5 November).
function darkLoading() {
  const d = new Date(), halloween = (d.getMonth() === 9 && d.getDate() >= 15) || (d.getMonth() === 10 && d.getDate() <= 5);
  return halloween || matchMedia('(prefers-color-scheme: dark)').matches;
}

function loading(sel, backdrop) {
  backdrop.freeze();
  const ed = sel.version ? { ...EDITIONS[sel.edition], name: sel.version.name, short: `${EDITIONS[sel.edition].short} + ${sel.version.addons.length} addons` } : EDITIONS[sel.edition], qual = Object.values(QUALITY).find((q) => q.scale === sel.scale) ?? QUALITY.std;
  const el = document.createElement('div');
  el.className = `loadscreen${darkLoading() ? ' dark' : ''}`;
  el.innerHTML = `<div id="background"></div>
    <div id="container"><img id="logo" src="${brand('icon-256.png')}" alt="" width="149" height="149"><div><div class="walk">:v</div></div></div>
    <div class="server_info"><div class="mapimg" style="background-image:url('${game(ed.picture)}')"></div>
      <div class="text"><div>${esc(ed.name)}</div><div data-map>Loading</div><div class="small" data-detail>${esc(ed.short)} · ${esc(qual.label)} graphics</div></div></div>
    <div class="spambox" data-spam aria-hidden="true"></div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Loading"><div class="progress_text" data-text></div><div class="progressbar"><div class="inner" data-bar></div></div></div>`;
  root.append(el);
  const $ = (q) => el.querySelector(q), bar = $('[data-bar]'), text = $('[data-text]'), mapEl = $('[data-map]'), detail = $('[data-detail]'), spam = $('[data-spam]'), prog = $('.progress');
  let value = 0, step = 0, failed = false, finished = false, last = '';
  const t0 = performance.now(), elapsed = () => fmtTime((performance.now() - t0) / 1000);
  const show = () => {
    const v = Math.min(100, value);
    bar.style.width = `${Math.max(0.2, v)}%`; prog.setAttribute('aria-valuenow', String(Math.floor(v)));
    text.textContent = failed ? `Stopped after ${elapsed()}` : finished ? 'Ready' : `${STAGES[step]}... ${Math.floor(v)}% · ${elapsed()}`;
    if (!failed) mapEl.textContent = finished ? 'Ready' : STAGES[step];
  };
  const log = (line) => {
    if (line === last) return;
    last = line;
    const d = document.createElement('div'); d.textContent = line; spam.append(d);
    while (spam.childElementCount > 40) spam.firstElementChild.remove();
  };
  // Engine startup after "Starting the game": creep toward 99% so the bar always looks alive.
  const tick = setInterval(() => {
    if (failed) return;
    if (step === 3 && value < 99) value += (99 - value) * 0.012;
    show();
  }, 500);
  const fail = (msg) => {
    if (failed) return;
    failed = true; el.classList.add('failed'); show();
    const box = document.createElement('div');
    box.className = 'whiterounded'; box.setAttribute('role', 'alert');
    box.innerHTML = `<h3>Couldn't start the game</h3><p>${esc(advice(msg))}</p><pre>${esc(msg)}</pre>
      <div class="row"><button class="btn-primary" data-reload>Reload</button><button class="btn" data-menu>Back to Main Menu</button><button class="btn" data-copy>Copy details</button></div>`;
    el.append(box);
    box.querySelector('[data-reload]').onclick = () => location.reload();
    box.querySelector('[data-menu]').onclick = () => location.assign(location.pathname + '?launcher=1');
    box.querySelector('[data-copy]').onclick = async (ev) => {
      try { await navigator.clipboard.writeText(`${msg}\n\n${navigator.userAgent}`); ev.target.textContent = 'Copied'; } catch { ev.target.textContent = 'Copy failed'; }
    };
    box.querySelector('[data-reload]').focus();
  };
  const done = () => {
    if (finished) return;
    finished = true; value = 100; show(); log(`Started in ${elapsed()}`);
    clearInterval(tick); obs.disconnect();
    setTimeout(() => {
      root.classList.add('fade');
      setTimeout(() => { backdrop.stop(); root.remove(); }, 650);
    }, reducedMotion ? 0 : 200);
  };
  const onText = (raw) => {
    const line = raw.trim();
    if (!line) { if (!failed) done(); return; }
    if (failed) return;
    const p = phase(line);
    if (p) { value = Math.max(value, p[0]); step = Math.max(step, p[1]); detail.textContent = p[2]; log(line); show(); return; }
    if (ERROR.test(line)) fail(line); else { detail.textContent = line; log(line); }
  };
  const obs = new MutationObserver(() => onText(statusEl.textContent));
  obs.observe(statusEl, { childList: true, characterData: true, subtree: true });
  show(); onText(statusEl.textContent);
  return { fail };
}

// ---- Start -----------------------------------------------------------------------------------------------------
async function start() {
  document.body.classList.add('launcher-ready');
  root.hidden = false;
  root.innerHTML = '<div class="backdrop"></div><div class="gradient"></div>';
  const backdrop = new Backdrop(root.querySelector('.backdrop'));
  // Any explicit parameter (tests, bookmarks such as ?edition=extended&res=640x360) skips the menu; ?launcher=1 forces it.
  const forced = params.get('launcher') === '1'; params.delete('launcher');
  // ?v=<code>: a shared game version, added to this browser's list and shown in the menu (not a reason to skip it).
  const shared = params.get('v'); params.delete('v');
  const explicit = !forced && [...params.keys()].filter((k) => k !== 'hub').length > 0;
  let opts = {};
  if (shared) {
    try { const v = await importShared(shared); opts = { open: 'versions', highlight: v.id }; } catch (e) { console.warn('[versions]', e.message); opts = { open: 'versions' }; }
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
  }
  // Signed in: bring this browser's settings up to date with the account first (briefly; offline is fine).
  if (account()) { await Promise.race([sync().catch((e) => console.warn('[account]', e.message)), new Promise((r) => setTimeout(r, 4000))]); autoSync(); }
  let sel, resume = null;
  try { resume = JSON.parse(sessionStorage.getItem('garrys-wasm.resume') ?? 'null'); sessionStorage.removeItem('garrys-wasm.resume'); } catch { /* storage blocked */ }
  if (resume && !explicit) {
    sel = { edition: resume.edition === 'extended' ? 'extended' : 'base', ...(resume.scale ? { scale: +resume.scale } : {}), version: resume.version ? getVersion(resume.version) : null };
  } else if (explicit) {
    sel = { edition: params.get('edition') === 'extended' ? 'extended' : 'base', ...(params.has('scale') ? { scale: +params.get('scale') } : {}) };
  } else {
    statusEl.textContent = '';
    const pictures = backgroundList().then((l) => backdrop.start(l)), ext = extendedInfo();
    // Give the first picture a moment so the menu does not open onto black; never wait long for it.
    await Promise.race([pictures, new Promise((r) => setTimeout(r, 900))]);
    sel = await menu(await ext, backdrop, opts);
  }
  statusEl.textContent = 'Starting...';
  const ui = loading(sel, backdrop);
  // The addons this launch mounts (a version's, or the player's own) that this browser does not have yet are fetched first.
  const own = sel.version ?? { addons: launchAddons(null).map((name) => ({ name, ...libraryMeta()[name] })) };
  if (own.addons.length) await fetchVersionAddons(own).catch((e) => console.warn('[versions]', e.message));
  globalThis.__launch = { edition: sel.edition, ...(sel.scale ? { scale: String(sel.scale) } : {}), ...(sel.version ? { version: sel.version.id } : {}) };
  try { await import('./main.js'); } catch (e) { ui.fail(`${e?.stack || e}`); }
}
start().catch((e) => { statusEl.textContent = `Launcher failed: ${e?.message ?? e}`; document.body.classList.remove('launcher-ready'); root.hidden = true; import('./main.js'); });
