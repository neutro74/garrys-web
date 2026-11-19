// Launcher: the edition menu and the loading screen. It runs before the game starts, then hands over to main.js.
// main.js reports progress only by writing text into #status; this file reads that text (no changes to the boot path).
// Edition choice reaches the guest as the `edition` parameter (main.js merges globalThis.__launch into its params).
// Both screens copy the game's own pages (main menu: html/template/main.html; loading: html/loading.html) and use
// their stock images, so the launcher looks like the game it starts and nothing extra ships.

import { sharedHub, hubStatus, playerId, hubUrl, requestHubAccess, banCheck } from './hub.js';
import { mountChat, chatStyles, STATUS } from './chat-app.js';
import { myProfile, saveProfile, uploadImage, removeImage, resizeImage, avatarEl, imageUrl, displayName, nameHue, getProfile, cachedProfile } from './profiles.js';
import { dermaReady, icon } from './derma.js';
import { cropImage } from './crop.js';
import { dkConfirm, dkPrompt } from './modal.js';
import { openPicker, emojiNode } from './emote-picker.js';
import { prepareGameDir, syncCloud, gameDirName, stopWrites } from './cloud-sync.js';
import { listSaves, saveEntries, deleteSave, writeSaveEntries } from './local-saves.js';
import { shareSave, shareInfo, fetchShare, listShares, saveLink, shareThumb } from './save-share.js';
import { encodeBackup } from './storage.js';
import { account, login, register, logout, changePassword, sync, autoSync } from './account.js';
import { steamBox, steamAccount } from './steam-account.js';
import { gameSettings, setGameSettings, GRAPHICS, FPS, SLIDERS } from './game-settings.js';
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
  links: { server: 'https://discord.gg/gYAvvh4apA', profile: 'https://discordapp.com/users/827905760531841074' },
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
  ['Game settings', 'Options sets graphics (Low by default, kept on every start), frame rate, volume, sensitivity and field of view.'],
  ['Addon map pictures', 'Maps from addons show their own picture in Start New Game.'],
  ['Pings and automod', 'Mentions and replies wait in your inbox, @ suggests names, and automod keeps chat clean.'],
  ['A launcher of its own', 'One window in GMod\'s own Derma style, with tabs for playing, saves, chat, friends and versions.'],
  ['Chat, rebuilt', 'Channels, private messages, replies, pictures, mentions and edits. Press Shift+Tab in game to chat without leaving it.'],
  ['Friends', 'Add friends, see who is online and what they are playing, and message them from anywhere.'],
  ['Profiles', 'A picture, banner, name colour, about me and status, shown to everyone in chat.'],
  ['Saves everywhere', 'Signed in, your saves, dupes and game settings follow your account. Continue picks up your latest save.'],
  ['Share saves', 'Share any save as a link, or play what others shared, from Saves here or in game.'],
]
const CONTROLS = [
  ['W A S D', 'Move'], ['Space / Ctrl', 'Jump / crouch'], ['Shift', 'Sprint'], ['Q (hold)', 'Spawn menu'], ['C (hold)', 'Context menu'],
  ['E', 'Use'], ['F', 'Flashlight'], ['Z', 'Undo'], ['Mouse 1 / 2', 'Fire / alt fire, physgun grab / freeze'], ['Mouse wheel', 'Switch weapon'],
  ['Esc', 'Game menu (also releases the mouse)'], ['~', 'Console'], ['F11', 'Browser fullscreen'],
];

// Everything this browser keeps for the game: saves and addons in OPFS (written by storage-worker.js) and the downloaded
// game files in the service worker's cache.
async function opfsFiles() {
  const out = [];
  const walk = async (dir, p) => { for await (const [name, h] of dir.entries()) { if (h.kind === 'directory') await walk(h, `${p}/${name}`); else out.push({ path: `${p}/${name}`, size: (await h.getFile()).size }); } };
  const root = await navigator.storage.getDirectory();
  try { await walk(await root.getDirectoryHandle(gameDirName()), ''); } catch { /* nothing stored yet */ }
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
      if (!(await dkConfirm('Delete the downloaded game files? They download again as you play. Saves, addons and settings are kept.', { title: 'Clear downloaded files', ok: 'Delete', danger: true }))) return;
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
      const old = await dkPrompt('Your current password:', { title: 'Change password', password: true, ok: 'Next' }); if (old === null) return;
      const pass = await dkPrompt('Your new password (at least 6 characters):', { title: 'Change password', password: true, ok: 'Change' }); if (pass === null) return;
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
// Profile: the public profile other players see (picture, banner, display name, about me, status...) for accounts, then the
// in-game name and player colour, then the account and Steam sign-ins. A preview card shows the profile as chat will.
function previewCard(p, status) {
  const wrap = document.createElement('div'); wrap.className = 'dk pf-preview';
  const card = document.createElement('div'); card.className = 'gwc-card';
  const banner = document.createElement('div'); banner.className = 'gwc-banner';
  if (p.bannerImg) banner.style.backgroundImage = `url("${imageUrl(p.bannerImg)}")`; else banner.style.background = p.banner || p.accent || `hsl(${nameHue(p.user)} 35% 30%)`;
  const av = document.createElement('span'); av.className = 'gwc-av gwc-cardav'; av.append(avatarEl(p, p.user, 80));
  const dot = document.createElement('i'); dot.className = `gwc-dot s-${status === 'invisible' ? 'offline' : status}`; av.append(dot);
  const body = document.createElement('div'); body.className = 'gwc-cardbody';
  body.innerHTML = `<h3></h3><div class="gwc-handle"></div>${p.custom?.text || p.custom?.emoji ? '<div class="gwc-custom"></div>' : ''}${p.bio ? '<div class="gwc-sect">About me</div><p class="pf-bio"></p>' : ''}`;
  body.querySelector('h3').textContent = displayName(p, p.user);
  body.querySelector('.gwc-handle').textContent = `@${p.user}${p.pronouns ? ' · ' + p.pronouns : ''}`;
  if (body.querySelector('.gwc-custom')) body.querySelector('.gwc-custom').append(...(p.custom.emoji ? [emojiNode(p.custom.emoji, 18), ' '] : []), p.custom.text ?? '');
  if (p.bio) body.querySelector('.pf-bio').textContent = p.bio;
  card.append(banner, av, body); wrap.append(card);
  return wrap;
}
function profilePanel(el, hub, onAccount = () => {}) {
  const color = store.get('playercolor-hex', ''), signedIn = !!account();
  chatStyles();
  el.innerHTML = `<div class="panel-head"><img src="${game('html/img/play.png')}" alt=""><span>Profile</span><a href="#" class="x" data-close title="Close">✕</a></div>
    <div class="panel-body">
      ${hubHttp() ? '<div data-account></div>' : ''}
      ${signedIn ? `<div class="pf" data-pf><p class="hint">Loading your profile…</p></div>` : ''}
      <h4 class="pf-h">In game</h4>
      <label class="field"><span>Name</span><input data-name maxlength="24" autocomplete="nickname" spellcheck="false"></label>
      <p class="hint">Your name in multiplayer games${signedIn ? '' : ' and in chat'}. 2 to 24 characters.</p>
      <div class="field"><span>Player colour</span><div class="swatches" role="radiogroup">${COLORS.map(([h, n]) => `<button type="button" role="radio" title="${n}" data-color="${h}" style="background:${h}"></button>`).join('')}
        <button type="button" role="radio" class="none" title="Keep the game's setting" data-color="">–</button></div></div>
      <p class="hint">Your player model, skin and weapon colour are chosen in game: hold <kbd>C</kbd> and pick <b>Player Model</b>.</p>
      <table class="facts"><tr><td>Player ID</td><td data-id></td></tr></table>
      <div class="row"><button class="btn-primary" data-save>Save</button></div><p class="hint" data-msg></p>
      ${hubHttp() ? '<div data-steam></div>' : ''}
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
  const steamEl = $('[data-steam]');
  if (steamEl) steamBox(steamEl, esc);
  // Signing in or out changes the settings shown here (the account's replace this browser's): redraw.
  const box = $('[data-account]');
  if (box) accountBox(box, () => { onAccount(); profilePanel(el, hub, onAccount); el.querySelector('[data-close]')?.addEventListener('click', (ev) => { ev.preventDefault(); onAccount('close'); }); });
  if (!account()) { setTimeout(() => input.focus(), 50); return; }
  const pf = $('[data-pf]');
  myProfile().then((p) => publicProfile(pf, p, hub)).catch((e) => { pf.innerHTML = `<p class="hint"></p>`; pf.querySelector('p').textContent = e.message; });
}
function publicProfile(pf, p, hub) {
  let cur = structuredClone(p);
  pf.innerHTML = `<h4 class="pf-h">Your profile <small>what other players see in chat</small></h4>
    <div class="pf-grid"><div data-preview></div><div class="pf-fields">
      <div class="field"><span>Picture</span><div class="row"><button class="btn" type="button" data-up="avatar">Upload…</button><button class="btn" type="button" data-rm="avatar">Remove</button></div></div>
      <div class="field"><span>Banner</span><div class="row"><input type="color" data-k="banner" title="Banner colour"><button class="btn" type="button" data-up="banner">Image…</button><button class="btn" type="button" data-rm="banner">Remove</button></div></div>
      <div class="field"><span>Name colour</span><div class="row"><input type="color" data-k="accent" title="Colour of your name in chat"><button class="btn" type="button" data-clear="accent">Default</button></div></div>
      <label class="field"><span>Status</span><select data-k="status">${['online', 'idle', 'dnd', 'invisible'].map((x) => `<option value="${x}">${STATUS[x][0]}</option>`).join('')}</select></label>
    </div></div>
    <label class="field"><span>Display name</span><input data-k="display" maxlength="32" placeholder="${esc(p.user)}"></label>
    <label class="field"><span>Pronouns</span><input data-k="pronouns" maxlength="24" placeholder="optional"></label>
    <div class="field"><span>Custom status</span><div class="row pf-custom"><button type="button" class="dk-btn pf-emoji" data-emoji data-tip="Pick a status emoji"></button><input data-k="custom.text" maxlength="64" placeholder="What are you up to?"></div></div>
    <label class="field top"><span>About me</span><textarea data-k="bio" maxlength="300" rows="3" placeholder="A few words about yourself"></textarea></label>
    <label class="field"><span>Favourite</span><input data-k="favorite" maxlength="48" placeholder="Map, gamemode or addon"></label>
    <label class="field top"><span>Links</span><textarea data-k="links" rows="2" placeholder="Up to 4 https:// links, one per line"></textarea></label>
    <div class="row"><button class="btn-primary" type="button" data-pfsave>Save profile</button><span class="hint" data-pfmsg></span></div>`;
  const $ = (q) => pf.querySelector(q), msg = $('[data-pfmsg]');
  const get = (k) => k.split('.').reduce((o, x) => o?.[x], cur);
  const preview = () => $('[data-preview]').replaceChildren(previewCard(cur, cur.status));
  for (const f of pf.querySelectorAll('[data-k]')) {
    const k = f.dataset.k, v = get(k);
    f.value = k === 'links' ? (cur.links ?? []).join('\n') : f.type === 'color' ? (v || '#5865f2') : v ?? '';
    f.addEventListener('input', () => {
      const val = f.value;
      if (k === 'links') cur.links = val.split('\n').map((x) => x.trim()).filter(Boolean);
      else if (k.startsWith('custom.')) cur.custom = { ...(cur.custom ?? {}), [k.slice(7)]: val };
      else cur[k] = val;
      preview();
    });
  }
  for (const b of pf.querySelectorAll('[data-clear]')) b.onclick = () => { cur[b.dataset.clear] = ''; preview(); };
  // The status emoji: the chat picker's Emojis tab (Unicode, the server's emojis, GMod icons); clicking it again clears it.
  const emojiBtn = $('[data-emoji]');
  const showEmoji = () => { emojiBtn.replaceChildren(cur.custom?.emoji ? emojiNode(cur.custom.emoji, 16) : Object.assign(new Image(), { src: icon('emoticon_smile'), className: 'si', alt: '' })); };
  emojiBtn.onclick = () => {
    if (cur.custom?.emoji) { cur.custom = { ...cur.custom, emoji: '' }; showEmoji(); preview(); return; }
    const host = emojiBtn.closest('.dk-window') ?? document.body;
    openPicker(host, emojiBtn, { emojiOnly: true, onEmoji: (v) => { cur.custom = { ...(cur.custom ?? {}), emoji: v }; showEmoji(); preview(); } });
  };
  showEmoji();
  const wrap = async (fn) => { msg.textContent = 'Saving…'; try { const p2 = await fn(); cur = { ...cur, avatar: p2.avatar, bannerImg: p2.bannerImg }; msg.textContent = 'Saved.'; preview(); } catch (e) { msg.textContent = e.message; } };
  for (const b of pf.querySelectorAll('[data-up]')) b.onclick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    // Cropped first (web/crop.js; animated GIFs stay animated), then sent. The limits are the hub's (hub/profiles.mjs).
    i.onchange = async () => {
      const file = i.files[0]; if (!file) return;
      const kind = b.dataset.up;
      let blob;
      try { blob = await cropImage(file, kind === 'avatar' ? { w: 256, h: 256, limit: 500 * 1024, title: 'Crop your picture' } : { w: 960, h: 320, limit: 1.45 * 1048576, title: 'Crop your banner' }); }
      catch (e) { msg.textContent = e.message; return; }
      if (blob) wrap(() => uploadImage(kind, blob));
    };
    i.click();
  };
  for (const b of pf.querySelectorAll('[data-rm]')) b.onclick = () => wrap(() => removeImage(b.dataset.rm));
  $('[data-pfsave]').onclick = async () => {
    msg.textContent = 'Saving…';
    try {
      const saved = await saveProfile({ display: cur.display ?? '', pronouns: cur.pronouns ?? '', accent: cur.accent ?? '', banner: cur.banner ?? '', status: cur.status, bio: cur.bio ?? '',
        custom: cur.custom?.text || cur.custom?.emoji ? { text: cur.custom.text ?? '', emoji: cur.custom.emoji ?? '' } : null, favorite: cur.favorite ?? '', links: cur.links ?? [] });
      cur = structuredClone(saved); hub.myStatus = saved.status; msg.textContent = 'Saved. Everyone in chat sees it now.'; preview();
    } catch (e) { msg.textContent = e.message; }
  };
  preview();
}

// Saves: this player's saves (the account's when signed in, kept online through web/cloud-sync.js), each playable straight from
// here, shareable as a link, or downloadable; and the saves other players shared.
function savesPanel(el, { onPlaySave, highlight, sharedNote }) {
  let tab = 'mine', community = [], communityState = '', note = sharedNote ?? '';
  const urls = [];
  const free = () => { for (const u of urls.splice(0)) URL.revokeObjectURL(u); };
  const draw = async () => {
    free();
    el.innerHTML = `<div class="panel-head"><img src="${game('html/img/creations.png')}" alt=""><span>Saves</span><small data-cloud></small><a href="#" class="x" data-close title="Close">✕</a></div>
      <div class="tabs" role="tablist"><button role="tab" data-tab="mine">My saves</button><button role="tab" data-tab="community">Community</button></div>
      <div class="panel-body" data-body><p class="hint">Reading…</p></div>`;
    for (const b of el.querySelectorAll('[data-tab]')) { b.classList.toggle('on', b.dataset.tab === tab); b.onclick = () => { tab = b.dataset.tab; draw(); }; }
    el.querySelector('[data-close]')?.addEventListener('click', free);
    const body = el.querySelector('[data-body]'), cloudEl = el.querySelector('[data-cloud]');
    cloudEl.textContent = account() ? 'kept online for ' + account().user : 'this browser only';
    if (tab === 'community') return drawCommunity(body);
    const saves = await listSaves();
    body.innerHTML = `${note ? `<p class="note-box">${note}</p>` : ''}
      <p class="hint">${account() ? 'Your saves follow your account to any browser.' : 'Saves stay in this browser. Sign in (Profile) to keep them online and on every browser.'}
        Make saves in game from the spawn menu (<kbd>Q</kbd> → Saves) or the main menu.</p>
      <div class="savelist">${saves.length ? '' : '<p class="hint">No saves yet.</p>'}</div>
      <div class="row">${account() ? '<button class="btn" data-sync>Sync now</button>' : ''}<button class="btn" data-open>Open a shared save…</button></div><p class="hint" data-msg></p>`;
    const list = body.querySelector('.savelist'), msg = body.querySelector('[data-msg]');
    for (const sv of saves) {
      const row = document.createElement('div'); row.className = 'saverow' + (sv.file === highlight ? ' hl' : '');
      const img = document.createElement('img'); img.alt = ''; if (sv.thumb) { const u = URL.createObjectURL(sv.thumb); urls.push(u); img.src = u; } else img.className = 'nothumb';
      const info = document.createElement('div'); info.className = 'saveinfo';
      info.innerHTML = `<b></b><small>${new Date(sv.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${fmtSize(sv.size)}</small>`;
      info.querySelector('b').textContent = sv.name;
      const btns = document.createElement('div'); btns.className = 'vbtns';
      const btn = (label, cls, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; btns.append(b); return b; };
      btn('Play', 'btn-primary', () => onPlaySave(sv.file));
      if (hubHttp()) btn('Share', 'btn', async (e) => {
        if (!account()) { msg.textContent = 'Sign in (Profile) to share saves.'; return; }
        e.target.disabled = true; msg.textContent = `Sharing ${sv.name}…`;
        try { const r = await shareSave(await saveEntries(sv.file), { name: sv.name }); showLink(row, saveLink(r.code)); msg.textContent = ''; } catch (err) { msg.textContent = err.message; e.target.disabled = false; }
      });
      btn('Download', 'btn', async () => { const blob = encodeBackup((await saveEntries(sv.file)).map(([p, b]) => ['/overlay/garrysmod/' + p, b])); const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = `${sv.name}.gwb`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60e3); }).title = 'Download (import it from the game\'s Saves page)';
      btn('Delete', 'btn', async () => { if (!(await dkConfirm(`Delete the save “${sv.name}”?${account() ? ' It is removed from your account too.' : ''}`, { title: 'Delete save', ok: 'Delete', danger: true }))) return; await deleteSave(sv.file); draw(); }).title = 'Delete';
      row.append(img, info, btns);
      list.append(row);
    }
    body.querySelector('[data-sync]')?.addEventListener('click', async (e) => {
      e.target.disabled = true; msg.textContent = 'Syncing…';
      try { const r = await syncCloud({ mode: 'full', onProgress: (d, n) => { msg.textContent = `Syncing… ${d}/${n}`; } }); msg.textContent = `Up to date (${r.up} sent, ${r.down} received). ${fmtSize(r.used)} of ${fmtSize(r.quota)} used.`; setTimeout(draw, 1500); }
      catch (err) { msg.textContent = err.message; e.target.disabled = false; }
    });
    body.querySelector('[data-open]').onclick = async () => {
      const text = await dkPrompt('Paste a shared save link or code:', { title: 'Open a shared save', placeholder: 'https://… or code', ok: 'Open' });
      const code = /(?:[?&]save=|^)([A-Za-z0-9_-]{6,12})\s*$/.exec(String(text ?? '').trim())?.[1];
      if (!code) return;
      try { const file = await writeSaveEntries(await fetchShare(code)); highlight = file; note = 'Added the shared save to your saves.'; draw(); } catch (err) { msg.textContent = err.message; }
    };
    el.querySelector('.hl')?.scrollIntoView({ block: 'nearest' });
  };
  function showLink(row, link) {
    let box = row.querySelector('.vshare');
    if (!box) { box = document.createElement('div'); box.className = 'vshare'; row.append(box); }
    box.innerHTML = `<input readonly value="${esc(link)}"><button class="btn" data-copy>Copy</button>`;
    box.querySelector('input').select();
    box.querySelector('[data-copy]').onclick = async (ev) => { try { await navigator.clipboard.writeText(link); ev.target.textContent = 'Copied'; } catch { ev.target.textContent = 'Select and copy'; } };
  }
  async function drawCommunity(body) {
    body.innerHTML = `<form class="say" data-q style="padding:0;background:none;border:0;margin-bottom:8px"><input placeholder="Search shared saves" data-qi><button class="btn">Search</button></form><div class="savelist" data-list><p class="hint">Loading…</p></div><p class="hint" data-msg></p>`;
    const listEl = body.querySelector('[data-list]'), msg = body.querySelector('[data-msg]');
    const load = async (q = '') => {
      try { community = (await listShares({ sort: 'latest', q })).items; communityState = ''; } catch (e) { community = []; communityState = e.message; }
      listEl.replaceChildren();
      if (!community.length) { listEl.innerHTML = `<p class="hint">${esc(communityState || 'Nothing shared yet. Share one of your saves!')}</p>`; return; }
      for (const s of community) {
        const row = document.createElement('div'); row.className = 'saverow';
        const img = document.createElement('img'); img.alt = ''; img.crossOrigin = 'anonymous'; if (s.thumb) img.src = shareThumb(s.code); else img.className = 'nothumb';
        const info = document.createElement('div'); info.className = 'saveinfo'; info.innerHTML = '<b></b><small></small>';
        info.querySelector('b').textContent = s.name; info.querySelector('small').textContent = `${s.map ? s.map + ' · ' : ''}by ${s.author} · ${s.downloads} load${s.downloads === 1 ? '' : 's'}`;
        const btns = document.createElement('div'); btns.className = 'vbtns';
        const play = document.createElement('button'); play.className = 'btn-primary'; play.textContent = 'Play';
        play.onclick = async () => { play.disabled = true; try { onPlaySave(await writeSaveEntries(await fetchShare(s.code))); } catch (e) { msg.textContent = e.message; play.disabled = false; } };
        const add = document.createElement('button'); add.className = 'btn'; add.textContent = 'Add';
        add.onclick = async () => { try { highlight = await writeSaveEntries(await fetchShare(s.code)); note = `Added “${esc(s.name)}” to your saves.`; tab = 'mine'; draw(); } catch (e) { msg.textContent = e.message; } };
        btns.append(play, add); row.append(img, info, btns); listEl.append(row);
      }
    };
    body.querySelector('[data-q]').onsubmit = (e) => { e.preventDefault(); load(body.querySelector('[data-qi]').value.trim()); };
    load();
  }
  draw();
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
          <div class="vbtns"><button class="btn-primary" data-act="play">Play</button><button class="btn" data-act="edit">Edit</button>${hubHttp() ? '<button class="btn" data-act="share">Share</button>' : ''}<button class="btn" data-act="del">Delete</button></div>
          <div class="vshare" hidden></div></div>`).join('') : '<p class="hint">No versions yet.</p>'}</div>
        <div class="row"><button class="btn-primary" data-new>New version</button>${hubHttp() ? '<button class="btn" data-import>Open a shared link…</button>' : ''}</div>
        <p class="hint" data-msg>${esc(note)}</p></div>`;
    el.querySelector('[data-new]').onclick = () => { editing = { id: newVersionId(), name: '', edition: ext ? 'extended' : 'base', addons: [], disabled: [], author: store.get('name', '') }; results = []; draw(); };
    el.querySelector('[data-import]')?.addEventListener('click', async () => {
      const text = await dkPrompt('Paste a shared version link or code:', { title: 'Open a shared version', placeholder: 'https://… or code', ok: 'Open' });
      const code = /(?:[?&]v=|^)([A-Za-z0-9_-]{4,16})\s*$/.exec(String(text ?? '').trim())?.[1];
      if (!code) return;
      try { const v = await importShared(code); highlight = v.id; note = `Added “${v.name}”.`; } catch (e) { note = e.message; }
      draw();
    });
    for (const row of el.querySelectorAll('[data-v]')) {
      const v = getVersion(row.dataset.v);
      row.querySelector('[data-act="play"]').onclick = () => onPlay(v);
      row.querySelector('[data-act="edit"]').onclick = () => { editing = structuredClone(v); results = []; draw(); };
      row.querySelector('[data-act="del"]').onclick = async () => { if (await dkConfirm(`Delete “${v.name}”? Its addons stay in your library.`, { title: 'Delete version', ok: 'Delete', danger: true })) { removeVersion(v.id); draw(); } };
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
          ${v.addons.length ? v.addons.map((a, i) => `<div class="arow"><span title="${esc(a.title || a.name)}">${esc(a.title || a.name)}</span><small>${a.size ? fmtSize(a.size) : ''}</small>${a.size ? badge(a.size, 1) : ''}<a href="#" data-rm="${i}">Remove</a></div>`).join('') : '<small class="muted">None yet. Search the Workshop below.</small>'}
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
        statusEl.textContent = `Downloading addons... (${i}/${missing.length}) ${label}${p.phase === 'transferring' && p.total ? ` ${Math.floor((100 * p.loaded) / p.total)}%` : p.phase === 'queued' ? ' (waiting)' : p.phase === 'downloading' ? ' (fetching from Steam)' : p.phase === 'reconnecting' ? ' (reconnecting)' : ''}`;
      } });
    } catch (e) { console.warn(`[versions] ${label}: ${e.message}`); }
  }
}

// The menu is one Derma window (web/derma.js: GMod's own skin and Silkicons) with tabs, over the drifting backgrounds.
// Play has Continue, the editions, versions and quality; the other tabs hold the panels above and the chat app.
const releaseName = () => /\/(v\d+)\//.exec(location.pathname)?.[1] ?? 'dev';
function cat(title, iconName, { shut = false, badge = false } = {}) {
  const c = document.createElement('div'); c.className = 'dk-cat' + (shut ? ' shut' : '');
  c.innerHTML = `<button type="button" class="dk-cat-head"><img class="si" alt=""><span></span>${badge ? '<b class="dk-badge" hidden></b>' : ''}</button><div class="dk-cat-body"><div></div></div>`;
  c.querySelector('img').src = icon(iconName); c.querySelector('span').textContent = title;
  c.querySelector('.dk-cat-head').onclick = () => c.classList.toggle('shut');
  return { el: c, body: c.querySelector('.dk-cat-body > div'), title: c.querySelector('span') };
}

function menu(ext, backdrop, opts = {}) {
  return new Promise((resolve) => {
    const ids = ext ? ['base', 'extended'] : ['base'];
    let edition = ids.includes(store.get('edition')) ? store.get('edition') : 'base';
    let quality = store.get('quality', (navigator.hardwareConcurrency ?? 8) <= 4 ? 'perf' : 'sharp');
    if (!QUALITY[quality]) quality = 'std';
    const warn = problems(), hub = sharedHub();
    // Garry's Web is a fan project: say so, and whose the game is.
    const legal = `Garry's Web is an unofficial fan project, not affiliated with Facepunch Studios or Valve. ${ext ? "Garry's Mod and the bundled games belong to Facepunch Studios and Valve; addons belong to their Workshop authors." : "Garry's Mod belongs to Facepunch Studios and Valve."}`;
    const TABS = [['play', 'Play', 'controller'], ['saves', 'Saves', 'disk'], ...(hub.url ? [['workshop', 'Workshop', 'brick'], ['chat', 'Chat', 'comments'], ['friends', 'Friends', 'group']] : []),
      ['versions', 'Versions', 'package'], ['profile', 'Profile', 'user'], ['options', 'Options', 'cog']];

    const win = document.createElement('div');
    win.className = 'dk dk-window gwl-window' + (reducedMotion ? '' : ' pop');
    win.setAttribute('role', 'dialog'); win.setAttribute('aria-label', "Garry's Web");
    win.innerHTML = `
      <div class="dk-title"><img src="${brand('icon-32.png')}" alt="">Garry's Web
        <span class="dk-tinfo"><span data-credit></span><img class="si" src="${icon('bullet_green')}" alt="" data-onlinedot hidden><span data-online></span><span>· ${esc(releaseName())}</span></span>
        <button type="button" class="dk-wbtn maxi" data-fs data-tip="Fullscreen" aria-label="Fullscreen"></button></div>
      <div class="dk-sheet">
        <div class="dk-tabs" role="tablist">${TABS.map(([k, label, ic]) => `<button type="button" role="tab" class="dk-tab" data-tab="${k}"><img class="si" src="${icon(ic)}" alt="">${label}${k === 'chat' || k === 'friends' ? `<b class="dk-badge" data-badge="${k}" hidden></b>` : ''}</button>`).join('')}
          <button type="button" class="dk-btn gwl-me" data-me data-tip="Your profile"></button></div>
        <div class="dk-tabbody">${TABS.map(([k]) => `<section class="dk-page" data-page="${k}" role="tabpanel" hidden></section>`).join('')}</div>
      </div>`;
    root.append(win);
    const $ = (q) => win.querySelector(q), page = (k) => $(`[data-page="${k}"]`);

    // ---- Title bar and account button ----
    backdrop.onChange = (c) => { $('[data-credit]').textContent = `“${c.title}” by ${c.author} ·`; };
    if (backdrop.current) backdrop.onChange(credit(backdrop.current));
    const showOnline = (n) => { $('[data-online]').textContent = n ? `${n} online` : ''; $('[data-onlinedot]').hidden = !n; };
    if (hub.url) hubStatus(hub.url).then((s) => showOnline(s?.online));
    const fsBtn = $('[data-fs]');
    fsBtn.onclick = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); };
    const fsLabel = () => { fsBtn.dataset.tip = document.fullscreenElement ? 'Leave fullscreen' : 'Fullscreen'; };
    document.addEventListener('fullscreenchange', fsLabel);
    const drawMe = async () => {
      const a = account(), p = a ? await getProfile(a.user).catch(() => null) : null, st = hub.myStatus ?? p?.status ?? 'online';
      const dot = { online: 'bullet_green', idle: 'bullet_yellow', dnd: 'bullet_red', invisible: 'bullet_black' }[st] ?? 'bullet_green';
      $('[data-me]').innerHTML = a ? `<img class="si" src="${icon(dot)}" alt=""><img class="si" src="${icon('user')}" alt=""><span></span>` : `<img class="si" src="${icon('user_add')}" alt=""><span>Sign in</span>`;
      if (a) $('[data-me] span').textContent = displayName(p, a.user);
      $('[data-me]').dataset.tip = a ? `${STATUS[st]?.[0] ?? ''} · your profile` : 'Sign in to keep saves and chat with friends';
    };
    $('[data-me]').onclick = () => show('profile');
    drawMe();

    // ---- Tabs ----
    let tab = null, adminMount = null, workshop = null;
    const drawn = new Set();
    function show(k) {
      if (k === tab) { if (k === 'saves' || k === 'versions' || k === 'options') fill(k); return; }
      tab = k;
      for (const b of win.querySelectorAll('[data-tab]')) { b.classList.toggle('on', b.dataset.tab === k); b.setAttribute('aria-selected', String(b.dataset.tab === k)); }
      for (const p of win.querySelectorAll('[data-page]')) p.hidden = p.dataset.page !== k;
      if (k === 'chat' || k === 'friends') {
        ensureChat(); page(k).append(chatEl);
        chat.open(k === 'friends' ? { kind: 'friends', tab: hub.friends?.incoming?.length ? 'pending' : 'online' } : chat.lastRoom?.() ?? { kind: 'channel', id: 'general' });
        chat.visible(true); chat.focus();
      } else chat?.visible(false);
      if (k === 'admin') adminMount?.(); else admin?.visible(false);
      workshop?.visible(k === 'workshop');
      badges();
      if (!drawn.has(k) || k === 'saves' || k === 'options') fill(k);
    }
    function fill(k) {
      drawn.add(k);
      const el = page(k);
      if (k === 'play') return;
      if (k === 'options') return drawOptions(el);
      if (k === 'chat' || k === 'friends' || k === 'admin') return;
      // The Workshop tab (web/workshop-tab.js) is made once and kept, so its list and downloads survive tab switches.
      if (k === 'workshop') { if (!workshop) import('./workshop-tab.js').then(({ mountWorkshop }) => { workshop = mountWorkshop(el); workshop.visible(tab === 'workshop'); }); return; }
      el.replaceChildren(); const p = document.createElement('div'); p.className = 'panel gwl-panel'; el.append(p);
      if (k === 'saves') savesPanel(p, { highlight: opts.highlightSave, sharedNote: opts.sharedNote, onPlaySave: (file) => play(edition, null, file) });
      else if (k === 'versions') versionsPanel(p, { ext, highlight: opts.highlight, onPlay: (v) => play(v.edition, v) });
      else if (k === 'profile') profilePanel(p, hub, (why) => { if (why === 'close') fill('profile'); else relaunch('profile'); });
    }
    for (const b of win.querySelectorAll('[data-tab]')) b.onclick = () => show(b.dataset.tab);

    // ---- Play ----
    const playEl = page('play');
    playEl.innerHTML = `<div class="gwl-play">
      <div class="gwl-left">
        <div class="dk-panel gwl-cont" data-cont hidden></div>
        ${warn.length ? `<div class="dk-panel gwl-warn">${warn.map((w) => `<p><img class="si" src="${icon('error')}" alt=""> ${esc(w)}</p>`).join('')}</div>` : ''}
        <div class="gwl-games">${ids.map((id) => `<button type="button" class="gwl-game" data-ed="${id}"><span class="pic" style="background-image:url('${game(EDITIONS[id].picture)}')"></span>
          <span class="cap"><b>${esc(EDITIONS[id].name)}</b><span>${id === 'base' ? 'The stock sandbox · gm_construct, gm_flatgrass' : `${esc(EDITIONS.extended.games.slice(1, 5).join(', '))}, ${EDITIONS.extended.addons.length} addons`}</span><span class="dk-btn blue go">Play</span></span></button>`).join('')}</div>
        <div class="gwl-quality dk-onGrey"><img class="si" src="${icon('monitor')}" alt="">3D quality
          <span class="gwl-qbtns">${Object.entries(QUALITY).map(([k, q]) => `<button type="button" class="dk-btn" data-q="${k}">${q.label}</button>`).join('')}</span><small data-qnote></small></div>
      </div>
      <div class="gwl-right" data-right></div></div>`;
    const right = playEl.querySelector('[data-right]');
    // The Garry's Web banner (web/brand/banner.png) heads the column; it opens About.
    const banner = document.createElement('button'); banner.type = 'button'; banner.className = 'gwl-banner'; banner.dataset.tip = "About Garry's Web";
    banner.innerHTML = `<img src="${brand('banner.png')}" alt="Garry's Web">`; right.append(banner);
    // Friends who are online (signed in only), the player's game versions, what's new, about, controls.
    let friendsCat = null;
    if (hub.url && account()) { friendsCat = cat('Friends online', 'group', { badge: true }); right.append(friendsCat.el); }
    const vs = versions().filter((v) => ids.includes(v.edition)).slice(-5).reverse();
    if (vs.length) {
      const c = cat('Your game versions', 'package'); right.append(c.el);
      for (const v of vs) {
        const r = document.createElement('div'); r.className = 'dk-row'; r.innerHTML = '<img class="si" alt=""><span class="gwl-ell"></span><small></small><button type="button" class="dk-btn act">Play</button>';
        r.querySelector('img').src = icon('package'); r.querySelector('span').textContent = v.name; r.querySelector('small').textContent = versionLine(v);
        r.querySelector('button').onclick = () => play(v.edition, v); c.body.append(r);
      }
    }
    const news = cat("What's new", 'newspaper'); right.append(news.el);
    news.body.innerHTML = WHATS_NEW.map(([t, d]) => `<p class="dk-p"><b>${esc(t)}</b><span>${esc(d)}</span></p>`).join('');
    banner.onclick = () => openAbout();
    const keys = cat('Controls', 'keyboard', { shut: true }); right.append(keys.el);
    keys.body.innerHTML = CONTROLS.map(([k, v]) => `<div class="dk-row"><kbd>${esc(k)}</kbd><small>${esc(v)}</small></div>`).join('');

    const drawFriends = () => {
      if (!friendsCat) return;
      const f = hub.friends, on = f ? f.friends.filter((x) => (hub.presence?.get(x.user)?.status ?? 'offline') !== 'offline') : [];
      friendsCat.title.textContent = `Friends online (${on.length})`;
      const b = friendsCat.el.querySelector('.dk-badge'); b.hidden = !f?.incoming?.length; b.textContent = f?.incoming?.length ?? ''; b.dataset.tip = 'Friend requests';
      friendsCat.body.replaceChildren();
      if (!on.length) { const p = document.createElement('p'); p.className = 'dk-p'; p.innerHTML = `<span>${f ? 'Nobody online right now.' : 'Connecting…'}</span>`; friendsCat.body.append(p); }
      for (const x of on) {
        const pr = hub.presence.get(x.user), r = document.createElement('div'); r.className = 'dk-row';
        r.innerHTML = '<img class="si" alt=""><span class="gwl-ell"></span><small></small><button type="button" class="dk-btn act">Message</button>';
        r.querySelector('img').src = icon(pr.status === 'idle' ? 'bullet_yellow' : pr.status === 'dnd' ? 'bullet_red' : 'bullet_green');
        r.querySelector('span').textContent = displayName(cachedProfile(x.user), x.user); r.querySelector('small').textContent = pr.activity?.detail ?? '';
        r.querySelector('button').onclick = () => { show('chat'); chat.open({ kind: 'dm', with: x.user }); };
        friendsCat.body.append(r);
      }
    };
    const drawQuality = () => {
      for (const b of playEl.querySelectorAll('[data-q]')) b.classList.toggle('down', b.dataset.q === quality);
      playEl.querySelector('[data-qnote]').textContent = QUALITY[quality].size;
    };
    for (const b of playEl.querySelectorAll('[data-q]')) b.onclick = () => { quality = b.dataset.q; store.set('quality', quality); drawQuality(); };
    for (const b of playEl.querySelectorAll('[data-ed]')) b.onclick = () => play(b.dataset.ed);
    drawQuality();

    // Continue: the newest save, one click back into it.
    listSaves().then((saves) => {
      const sv = saves[0], box = playEl.querySelector('[data-cont]');
      if (!sv || went) return;
      box.hidden = false;
      box.innerHTML = `<div class="shot"></div><div class="gwl-cinfo"><div class="gwl-label">Continue where you left off</div><h1></h1>
        <div class="gwl-meta"><span><img class="si" src="${icon('disk')}" alt=""><span data-when></span></span><span><img class="si" src="${icon('controller')}" alt="">${esc(EDITIONS[edition].short)}</span></div>
        <div class="gwl-cbtns"><button type="button" class="dk-btn big blue" data-go><img class="si" src="${icon('controller')}" alt="">Continue</button><button type="button" class="dk-btn big" data-others><img class="si" src="${icon('disk')}" alt="">Other saves</button></div></div>`;
      box.querySelector('h1').textContent = sv.name;
      box.querySelector('[data-when]').textContent = new Date(sv.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      if (sv.thumb) { const u = URL.createObjectURL(sv.thumb); box.querySelector('.shot').style.backgroundImage = `url("${u}")`; }
      else box.querySelector('.shot').classList.add('none');
      box.querySelector('[data-go]').onclick = () => play(edition, null, sv.file);
      box.querySelector('[data-others]').onclick = () => show('saves');
    }).catch(() => {});

    // About: a small Derma window over the launcher (the banner opens it), closed by its buttons, Esc or a click outside.
    function openAbout() {
      if (root.querySelector('.gwl-about')) return;
      const veil = document.createElement('div'); veil.className = 'dk gwl-about';
      veil.innerHTML = `<div class="dk-window pop" role="dialog" aria-label="About Garry's Web"><div class="dk-title"><img src="${brand('icon-32.png')}" alt="">About Garry's Web<span class="dk-tinfo"></span>
          <button type="button" class="dk-wbtn close" data-x data-tip="Close (Esc)" aria-label="Close"></button></div>
        <div class="dk-panel"><img class="gwl-about-banner" src="${brand('banner.png')}" alt="Garry's Web"><p>${ABOUT.blurb()}</p><p class="gwl-legal">${esc(legal)}</p>
          <div class="gwl-cbtns"><a class="dk-btn blue" href="${ABOUT.links.server}" target="_blank" rel="noopener"><img class="si" src="${icon('comments')}" alt="">Join the Discord server</a><button type="button" class="dk-btn" data-x>Close</button></div></div></div>`;
      const close = () => { veil.remove(); document.removeEventListener('keydown', onEsc, true); banner.focus({ preventScroll: true }); };
      const onEsc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
      for (const x of veil.querySelectorAll('[data-x]')) x.onclick = close;
      veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
      document.addEventListener('keydown', onEsc, true);
      root.append(veil); veil.querySelector('.dk-btn.blue').focus({ preventScroll: true });
    }

    // ---- Options: the files this browser keeps, display, controls ----
    function drawOptions(el) {
      el.innerHTML = `<div class="gwl-options"><div class="gwl-col"><div class="panel gwl-panel gwl-game"><div class="panel-head"><img src="${icon('cog')}" alt=""><span>Game settings</span><small class="gwl-headnote">applied every time the game starts</small></div>
          <div class="panel-body">
            <div class="gwl-set"><b>Graphics</b><span class="gwl-seg" data-graphics>${Object.entries(GRAPHICS).map(([k, g]) => `<button type="button" class="dk-btn" data-v="${k}">${g.label}</button>`).join('')}</span><small data-gnote></small></div>
            <div class="gwl-set"><b>3D resolution</b><span class="gwl-seg" data-res>${Object.entries(QUALITY).map(([k, q]) => `<button type="button" class="dk-btn" data-v="${k}">${q.label}</button>`).join('')}</span><small data-rnote></small></div>
            <div class="gwl-set"><b>Frame rate</b><span class="gwl-seg" data-fps>${Object.entries(FPS).map(([k, f]) => `<button type="button" class="dk-btn" data-v="${k}">${f.label}</button>`).join('')}</span><small>Above 30 only helps on a fast computer.</small></div>
            ${[['volume', 'Volume'], ['sensitivity', 'Mouse sensitivity'], ['fov', 'Field of view']].map(([k, label]) => `<div class="gwl-set"><b>${label}</b><span class="gwl-slide"><input type="range" data-slider="${k}" min="${SLIDERS[k][0]}" max="${SLIDERS[k][1]}" step="${SLIDERS[k][2]}"><output data-out="${k}"></output><button type="button" class="dk-btn" data-reset="${k}" data-tip="Use the game's own setting">Reset</button></span></div>`).join('')}
            <label class="gwl-set gwl-check"><input type="checkbox" data-showfps> Show the frame rate in game</label>
            <p class="gwl-hint">Changes in the game's own Video options last until you quit; these are applied again at the next start.</p>
            <div class="row"><button type="button" class="dk-btn" data-fs2><img class="si" src="${icon('monitor')}" alt=""><span></span></button><button type="button" class="dk-btn" data-defaults>Restore defaults</button></div>
          </div></div><div class="panel gwl-panel" data-files></div></div>
        <div class="gwl-col"><div class="panel gwl-panel" data-controls></div></div></div>`;
      filesPanel(el.querySelector('[data-files]')); controlsPanel(el.querySelector('[data-controls]'));
      const $ = (q) => el.querySelector(q);
      const draw = () => {
        const s = gameSettings();
        for (const [sel, v] of [['[data-graphics]', s.graphics], ['[data-res]', quality], ['[data-fps]', s.fps]]) for (const b of el.querySelectorAll(`${sel} [data-v]`)) b.classList.toggle('down', b.dataset.v === v);
        $('[data-gnote]').textContent = GRAPHICS[s.graphics].note; $('[data-rnote]').textContent = QUALITY[quality].size;
        for (const k of Object.keys(SLIDERS)) {
          const v = s[k] ?? SLIDERS[k][3], set = s[k] != null;
          $(`[data-slider="${k}"]`).value = v;
          $(`[data-out="${k}"]`).textContent = set ? (k === 'volume' ? `${Math.round(v * 100)}%` : String(v)) : 'default';
          $(`[data-reset="${k}"]`).disabled = !set;
        }
        $('[data-showfps]').checked = s.showfps;
      };
      for (const b of el.querySelectorAll('[data-graphics] [data-v]')) b.onclick = () => { setGameSettings({ graphics: b.dataset.v }); draw(); };
      for (const b of el.querySelectorAll('[data-fps] [data-v]')) b.onclick = () => { setGameSettings({ fps: b.dataset.v }); draw(); };
      for (const b of el.querySelectorAll('[data-res] [data-v]')) b.onclick = () => { quality = b.dataset.v; store.set('quality', quality); drawQuality(); draw(); };
      for (const k of Object.keys(SLIDERS)) {
        $(`[data-slider="${k}"]`).oninput = (e) => { setGameSettings({ [k]: +e.target.value }); draw(); };
        $(`[data-reset="${k}"]`).onclick = () => { setGameSettings({ [k]: null }); draw(); };
      }
      $('[data-showfps]').onchange = (e) => { setGameSettings({ showfps: e.target.checked }); draw(); };
      $('[data-defaults]').onclick = () => { setGameSettings({ graphics: 'low', fps: '30', showfps: false, volume: null, sensitivity: null, fov: null }); draw(); };
      const b = $('[data-fs2]'), label = () => { b.querySelector('span').textContent = document.fullscreenElement ? 'Leave fullscreen' : 'Fullscreen'; };
      b.onclick = () => { fsBtn.click(); setTimeout(label, 300); }; label();
      draw();
    }

    // ---- Chat (web/chat-app.js), shared by the Chat and Friends tabs; it stays alive so notices keep coming ----
    let chat = null, chatEl = null;
    const toasts = document.createElement('div'); toasts.className = 'dk gw-toasts'; root.append(toasts);
    const toast = ({ title, body, open: go }) => {
      const t = document.createElement('button'); t.type = 'button'; t.className = 'gw-toast'; t.innerHTML = `<img class="si" src="${icon('comment')}" alt=""><span><b></b><span></span></span>`;
      t.querySelector('b').textContent = title; t.querySelector('span span').textContent = body ?? '';
      t.onclick = () => { t.remove(); show('chat'); go?.(); };
      toasts.append(t); while (toasts.childElementCount > 3) toasts.firstElementChild.remove();
      setTimeout(() => t.remove(), 7000);
    };
    function badges() {
      const n = chat?.unreadCount() ?? 0, req = hub.friends?.incoming?.length ?? 0;
      const c = $('[data-badge="chat"]'), f = $('[data-badge="friends"]');
      if (c) { c.hidden = !n || tab === 'chat'; c.textContent = n; }
      if (f) { f.hidden = !req; f.textContent = req; }
    }
    function ensureChat() {
      if (chat) return;
      chatEl = document.createElement('div');
      chat = mountChat(chatEl, { hub, mode: 'launcher',
        onNotify: (n) => { if (tab !== 'chat' && tab !== 'friends') toast(n); badges(); },
        onEditProfile: () => show('profile'),
        onOpenSave: (code) => openShared(code),
        // A friend's game: start in its edition and join it once the game's menu is up (web/menu-extras.js pending-join).
        onJoinGame: (g) => play(g.edition === 'extended' && ext ? 'extended' : 'base', null, null, g.id) });
      chat.visible(false);
    }
    // Banned while here: the ban screen (a signed-in page hears it at once; any page checks once a minute).
    const banTimer = setInterval(() => banCheck().then((b) => { if (b) location.reload(); }).catch(() => {}), 60e3);
    const hubOffs = [hub.on('banned', () => location.reload()), () => clearInterval(banTimer),
      hub.on('welcome', (m) => showOnline(m.online)), hub.on('friends', () => { drawFriends(); badges(); }), hub.on('presence', drawFriends), hub.on('presence-list', drawFriends),
      hub.on('my-status', drawMe), hub.on('profile', (m) => { if (m.user === account()?.user) drawMe(); })];
    // Signed in: connected from the start, so friends, private messages and notices arrive while the menu is open.
    if (hub.url && account()) { hub.setActivity({ kind: 'launcher', detail: 'In the launcher' }); hub.connect(); ensureChat(); drawFriends(); }

    // Admin accounts get an Admin tab (web/admin.js); the hub decides who is one.
    let admin = null;
    import('./admin.js').then(async ({ isAdmin, mountAdmin }) => {
      if (!(await isAdmin()) || !win.isConnected || went) return;
      const b = document.createElement('button'); b.type = 'button'; b.role = 'tab'; b.className = 'dk-tab'; b.dataset.tab = 'admin';
      b.innerHTML = `<img class="si" src="${icon('shield')}" alt="">Admin`;
      const pg = document.createElement('section'); pg.className = 'dk-page'; pg.dataset.page = 'admin'; pg.setAttribute('role', 'tabpanel'); pg.hidden = true;
      $('[data-me]').before(b); $('.dk-tabbody').append(pg); TABS.push(['admin', 'Admin', 'shield']);
      b.onclick = () => show('admin');
      adminMount = () => { if (!admin) admin = mountAdmin(pg); admin.visible(true); };
      if (opts.open === 'admin') show('admin');
    }).catch(() => {});

    let went = false;
    // Starting the game keeps the hub connection (the game runs in this same page and its overlay uses it), so a voice
    // channel, private messages and presence carry on without a reconnect; signing in or out starts it again.
    const teardown = ({ keepHub = false } = {}) => {
      went = true;
      chat?.destroy(); admin?.destroy(); workshop?.destroy(); for (const off of hubOffs) off(); if (!keepHub) hub.close();
      document.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', fsLabel);
      toasts.remove(); root.querySelector('.gwl-about')?.remove();
    };
    // save: 'saves/x.gms' to load as soon as the game's menu is up (Continue, Play on a save).
    const play = (id, gv = null, save = null, join = null) => {
      if (went) return;
      teardown({ keepHub: true }); edition = id; if (!gv) store.set('edition', id);
      win.classList.add('leave');
      setTimeout(() => { win.remove(); resolve({ edition, scale: QUALITY[quality].scale, version: gv, save, join }); }, reducedMotion ? 0 : 300);
    };
    // Signed in or out: the account's settings now apply, so the window is built again for it (no page reload).
    const relaunch = (open) => {
      if (went) return;
      teardown(); win.remove();
      resolve({ relaunch: true, open });
    };
    // A shared save (a ?save= link, or one posted in chat): added to this player's saves, then shown in Saves to play.
    async function openShared(code) {
      try {
        const [info, entries] = await Promise.all([shareInfo(code), fetchShare(code)]);
        const file = await writeSaveEntries(entries);
        opts.highlightSave = file; opts.sharedNote = `Added “${esc(info.name)}” by ${esc(info.author)}${info.map ? ` (${esc(info.map)})` : ''} to your saves. Press <b>Play</b> to start it.`;
      } catch (e) { opts.sharedNote = esc(e.message); }
      tab = null; show('saves');
    }
    // Ctrl+Tab / Ctrl+Shift+Tab or Ctrl+PageDown/PageUp switch tabs, as in a property sheet.
    const onKey = (ev) => {
      if (ev.target?.closest?.('.admin-overlay')) return;
      if (!ev.ctrlKey || !(ev.key === 'Tab' || ev.key === 'PageDown' || ev.key === 'PageUp')) return;
      ev.preventDefault();
      const keys = TABS.map(([k]) => k), d = ev.key === 'PageUp' || (ev.key === 'Tab' && ev.shiftKey) ? -1 : 1;
      show(keys[(keys.indexOf(tab) + d + keys.length) % keys.length]);
    };
    document.addEventListener('keydown', onKey);

    show(opts.open && TABS.some(([k]) => k === opts.open) ? opts.open : 'play');
    if (opts.sharedSave) openShared(opts.sharedSave);
    setTimeout(() => playEl.querySelector('[data-cont]:not([hidden]) [data-go], [data-ed]')?.focus({ preventScroll: true }), 450);
  });
}

// ---- Loading screen --------------------------------------------------------------------------------------------
// Boot messages from guest-worker.js (and their order) become a progress value. The last stage, the engine's own startup,
// has no measurable total, so it eases toward 99% and completes when the first frame arrives.
const STAGES = ['Loading the engine', 'Reading game files', 'Loading game code', 'Starting the game'];
const STAGE_TICKS = ['Engine', 'Game files', 'Game code', 'Start'];
function phase(text) {
  let m;
  if (/^Starting\.\.\./.test(text)) return [0, 0, 'Preparing'];
  if (/^Syncing your saves/.test(text)) return [0.5, 0, 'Bringing your saves from your account'];
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
  // The Garry's Web beam (web/brand/background.jpg, with the light running up it: .gw-light in web/index.html) and a Derma
  // window over it: the edition, what is happening, a DProgress bar, the
  // four stages ticked off as they finish, the log, and Cancel.
  dermaReady();
  const el = document.createElement('div');
  el.className = 'loadscreen gwl-load dk';
  el.innerHTML = `<div class="gwl-loadbg"><div class="gw-light"></div></div>
    <div class="dk-window gwl-loadwin" role="dialog" aria-label="Starting ${esc(ed.name)}">
      <div class="dk-title"><img src="${brand('icon-32.png')}" alt="">${esc(ed.name)}<span class="dk-tinfo" data-time></span><button type="button" class="dk-wbtn close" data-cancel data-tip="Cancel" aria-label="Cancel"></button></div>
      <div class="dk-panel gwl-loadbody">
        <div class="gwl-loadhead"><span class="pic" style="background-image:url('${game(ed.picture)}')"></span>
          <div><b data-map>Starting ${esc(ed.name)}...</b><span data-detail>${esc(ed.short)} · ${esc(qual.label)} graphics</span></div><b class="pct" data-pct>0%</b></div>
        <div class="dk-bar" data-prog role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Loading"><div data-bar></div></div>
        <ol class="gwl-steps" data-steps>${STAGE_TICKS.map((t, i) => `<li data-step="${i}" title="${esc(STAGES[i])}"><img class="si" alt="" src="${icon('bullet_white')}"><span>${esc(t)}</span></li>`).join('')}</ol>
        <div class="gwl-loadlog" data-spam aria-hidden="true"></div>
        <div class="gwl-loadfoot"><span class="dk-say" data-text></span><button type="button" class="dk-btn" data-cancel><img class="si" alt="" src="${icon('cross')}">Cancel</button></div>
      </div>
    </div>`;
  root.append(el);
  for (const b of el.querySelectorAll('[data-cancel]')) b.onclick = () => location.assign(location.pathname + '?launcher=1');
  const pct = el.querySelector('[data-pct]'), timeEl = el.querySelector('[data-time]'), steps = [...el.querySelectorAll('[data-step]')];
  const tickSteps = (cur, fin) => steps.forEach((li, i) => { const st = fin || i < cur ? 'done' : i === cur ? 'now' : ''; if (li.dataset.state !== st) { li.dataset.state = st; li.querySelector('img').src = icon(st === 'done' ? 'tick' : st === 'now' ? 'bullet_go' : 'bullet_white'); } });
  const $ = (q) => el.querySelector(q), bar = $('[data-bar]'), text = $('[data-text]'), mapEl = $('[data-map]'), detail = $('[data-detail]'), spam = $('[data-spam]'), prog = $('[data-prog]');
  let value = 0, step = 0, failed = false, finished = false, last = '';
  const t0 = performance.now(), elapsed = () => fmtTime((performance.now() - t0) / 1000);
  const show = () => {
    const v = Math.min(100, value);
    bar.style.width = `${Math.max(0.2, v)}%`; prog.setAttribute('aria-valuenow', String(Math.floor(v)));
    text.textContent = failed ? `Stopped after ${elapsed()}` : finished ? 'Ready' : `Step ${step + 1} of ${STAGES.length}`;
    pct.textContent = `${Math.floor(v)}%`; timeEl.textContent = elapsed();
    if (!failed) { mapEl.textContent = finished ? 'Ready' : `${STAGES[step]}...`; tickSteps(step, finished); }
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
    mapEl.textContent = 'Could not start';
    // The error in a Derma message box over the loading window.
    const box = document.createElement('div');
    box.className = 'dk-window gwl-loaderr pop'; box.setAttribute('role', 'alertdialog');
    box.innerHTML = `<div class="dk-title"><img src="${icon('error')}" alt="">Couldn't start the game<span class="dk-tinfo"></span><button type="button" class="dk-wbtn close" data-menu aria-label="Close"></button></div>
      <div class="dk-panel"><p>${esc(advice(msg))}</p><pre>${esc(msg)}</pre>
      <div class="gwl-loadfoot"><button type="button" class="dk-btn blue" data-reload><img class="si" alt="" src="${icon('arrow_refresh')}">Reload</button><button type="button" class="dk-btn" data-menu>Back to Main Menu</button><button type="button" class="dk-btn" data-copy><img class="si" alt="" src="${icon('page_copy')}">Copy details</button></div></div>`;
    el.append(box);
    box.querySelector('[data-reload]').onclick = () => location.reload();
    for (const b of box.querySelectorAll('[data-menu]')) b.onclick = () => location.assign(location.pathname + '?launcher=1');
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

// ---- Banned ------------------------------------------------------------------------------------------------------
function banScreen(ban) {
  document.body.classList.add('launcher-ready');
  root.hidden = false;
  dermaReady();
  const until = ban.until ? new Date(ban.until).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' }) : null;
  root.innerHTML = `<div class="loadscreen gwl-load dk"><div class="gwl-loadbg"><div class="gw-light"></div></div>
    <div class="dk-window gwl-loadwin gwl-ban" role="alertdialog" aria-label="Banned">
      <div class="dk-title"><img src="${icon('delete')}" alt="">Banned from Garry's Web<span class="dk-tinfo"></span></div>
      <div class="dk-panel gwl-loadbody"><b class="gwl-banhead">You are banned from Garry's Web.</b>
        ${ban.reason ? `<p>Reason: <b></b></p>` : ''}
        <p>${until ? `The ban ends on ${esc(until)}.` : 'This ban does not end.'}</p>
        <p class="dk-say">While it lasts you cannot play, chat, use voice, the Workshop, your account or your saves here.</p>
        <div class="gwl-loadfoot"><button type="button" class="dk-btn" data-again><img class="si" alt="" src="${icon('arrow_refresh')}">Check again</button></div></div></div></div>`;
  if (ban.reason) root.querySelector('.gwl-ban p b').textContent = ban.reason;
  root.querySelector('[data-again]').onclick = () => location.reload();
}

// ---- Start -----------------------------------------------------------------------------------------------------
async function start() {
  // Ask for access to the server while the splash is still up (see requestHubAccess); a prompt then comes now, not mid-menu.
  if (hubUrl()) {
    statusEl.textContent = 'Connecting to the server...';
    await requestHubAccess({ onWait: () => { statusEl.textContent = 'Connecting to the server... If your browser asks about devices on your local network, choose Allow.'; } });
  }
  // Banned (by address, browser or account): a ban screen, and nothing else opens (no launcher, no game).
  const ban = await banCheck().catch(() => null);
  if (ban) { banScreen(ban); return; }
  document.body.classList.add('launcher-ready');
  root.hidden = false;
  root.innerHTML = '<div class="backdrop"></div><div class="vignette"></div>';
  const backdrop = new Backdrop(root.querySelector('.backdrop'));
  // Any explicit parameter (tests, bookmarks such as ?edition=extended&res=640x360) skips the menu; ?launcher=1 forces it.
  const forced = params.get('launcher') === '1'; params.delete('launcher');
  // ?v=<code>: a shared game version, added to this browser's list and shown in the menu (not a reason to skip it).
  const shared = params.get('v'); params.delete('v');
  // ?save=<code>: a shared save (web/save-share.js), added to this player's saves and shown in Saves.
  const sharedSave = params.get('save'); params.delete('save');
  if (sharedSave) history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
  const explicit = !forced && [...params.keys()].filter((k) => k !== 'hub').length > 0;
  let opts = sharedSave && /^[A-Za-z0-9_-]{6,12}$/.test(sharedSave) ? { sharedSave } : {};
  let resume = null;
  try { resume = JSON.parse(sessionStorage.getItem('garrys-wasm.resume') ?? 'null'); sessionStorage.removeItem('garrys-wasm.resume'); } catch { /* storage blocked */ }
  // The menu's backgrounds, skin and edition info start loading now, alongside the account sync below rather than after it.
  const showMenu = !explicit && !resume;
  const pictures = showMenu ? backgroundList().then((l) => backdrop.start(l)) : null;
  const skin = showMenu ? dermaReady() : null, ext = showMenu ? extendedInfo() : null;
  if (shared) {
    try { const v = await importShared(shared); opts = { open: 'versions', highlight: v.id }; } catch (e) { console.warn('[versions]', e.message); opts = { open: 'versions' }; }
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
  }
  // Signed in: bring this browser's settings up to date with the account first (briefly; offline is fine).
  if (account()) { await Promise.race([sync().catch((e) => console.warn('[account]', e.message)), new Promise((r) => setTimeout(r, 4000))]); autoSync(); }
  // The account's game files: its own folder in this browser, brought in step with the cloud while the menu is open
  // (and again for the new account after signing in or out from the menu).
  const syncFiles = () => prepareGameDir().then(() => (account() ? syncCloud({ mode: 'full' }) : null))
    .then((r) => { if (r && !r.skipped) try { localStorage.setItem('garrys-wasm.cloud-last', JSON.stringify({ at: Date.now(), used: r.used, quota: r.quota })); } catch { /* blocked */ } })
    .catch((e) => console.warn('[cloud]', e.message));
  let files = syncFiles();
  let sel;
  if (resume && !explicit) {
    sel = { edition: resume.edition === 'extended' ? 'extended' : 'base', ...(resume.scale ? { scale: +resume.scale } : {}), version: resume.version ? getVersion(resume.version) : null };
  } else if (explicit) {
    sel = { edition: params.get('edition') === 'extended' ? 'extended' : 'base', ...(params.has('scale') ? { scale: +params.get('scale') } : {}) };
  } else {
    statusEl.textContent = '';
    // Give the first picture and the skin a moment so the menu does not open onto black or unskinned; never wait long.
    await Promise.race([Promise.all([pictures, skin]), new Promise((r) => setTimeout(r, 1500))]);
    sel = await menu(await ext, backdrop, opts);
    while (sel.relaunch) {
      if (account()) autoSync();
      files = files.then(syncFiles);
      sel = await menu(await ext, backdrop, { open: sel.open });
    }
  }
  statusEl.textContent = 'Starting...';
  const ui = loading(sel, backdrop);
  // The game must not open the folder while the cloud sync still writes to it (a first sign-in on a new browser).
  let synced = false; files.then(() => { synced = true; });
  await Promise.race([files, new Promise((r) => setTimeout(r, 400))]);
  if (!synced) { statusEl.textContent = 'Syncing your saves...'; await Promise.race([files, new Promise((r) => setTimeout(r, 30000))]); statusEl.textContent = 'Starting...'; }
  stopWrites();
  if (sel.save) try { sessionStorage.setItem('garrys-wasm.load-save', sel.save); } catch { /* storage blocked */ }
  if (sel.join) try { sessionStorage.setItem('garrys-wasm.join-lobby', sel.join); } catch { /* storage blocked */ }
  // The addons this launch mounts (a version's, or the player's own) that this browser does not have yet are fetched first.
  const own = sel.version ?? { addons: launchAddons(null).map((name) => ({ name, ...libraryMeta()[name] })) };
  if (own.addons.length) await fetchVersionAddons(own).catch((e) => console.warn('[versions]', e.message));
  globalThis.__launch = { edition: sel.edition, ...(sel.scale ? { scale: String(sel.scale) } : {}), ...(sel.version ? { version: sel.version.id } : {}) };
  try { await import('./main.js'); } catch (e) { ui.fail(`${e?.stack || e}`); }
}
start().catch((e) => { statusEl.textContent = `Launcher failed: ${e?.message ?? e}`; document.body.classList.remove('launcher-ready'); root.hidden = true; import('./main.js'); });
