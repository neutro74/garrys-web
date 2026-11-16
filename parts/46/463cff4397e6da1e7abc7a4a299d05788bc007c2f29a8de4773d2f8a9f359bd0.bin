// UI thread: shows the frames the guest worker presents and reports its progress. The guest itself runs in
// guest-worker.js (it blocks, so it cannot share a thread with the page).

const canvas = document.getElementById('screen');
const status = document.getElementById('status');
const params0 = new URLSearchParams(location.search);
// Rendering runs in its own worker that owns this canvas (web/render-worker.js); ?render=inline keeps it in the guest
// worker, which then sends finished frames here as pixels.
const inlineRender = params0.get('render') === 'inline';
const ctx = inlineRender ? canvas.getContext('2d', { alpha: false, desynchronized: true }) : null;
// The graphics context cannot be resumed once lost. Restart the page (saved settings persist); at most twice a minute so a
// context that keeps dying does not loop.
function contextLost() {
  status.textContent = 'Graphics context lost (out of GPU memory?). Restarting...';
  let recent = [];
  try { recent = JSON.parse(sessionStorage.getItem('garrys-wasm.context-lost') ?? '[]').filter((t) => Date.now() - t < 60000); } catch { /* storage blocked */ }
  if (recent.length >= 2) { status.textContent = 'Graphics context lost again. Lower the video settings or resolution (?res=640x360) and reload.'; return; }
  try { sessionStorage.setItem('garrys-wasm.context-lost', JSON.stringify([...recent, Date.now()])); } catch { /* ignored */ }
  setTimeout(() => location.reload(), 1500);
}
// ?perf=1: a small readout of where each second went, for judging whether a device is CPU- or GPU-bound without dev tools.
let perfEl = null;
function perfHud(m) {
  if (params0.get('perf') !== '1') return;
  if (!perfEl) {
    perfEl = document.createElement('div');
    perfEl.style.cssText = 'position:fixed;left:6px;top:6px;z-index:2147483647;pointer-events:none;font:12px/1.35 monospace;color:#fff;background:rgba(0,0,0,.65);padding:4px 7px;border-radius:4px;white-space:pre';
    document.body.append(perfEl);
  }
  const pct = (ms) => Math.max(0, Math.min(100, (100 * ms) / m.ms));
  const idle = pct(m.sleptMs), wait = pct(m.waitedMs), busy = Math.max(0, 100 - idle - wait), fps = (1000 * m.frames) / m.ms, t = window.__frameStats;
  const verdict = wait > 25 ? 'GPU/renderer-bound' : busy > 80 ? 'CPU-bound (game thread)' : 'keeping up';
  perfEl.textContent = `FPS ${fps.toFixed(1)}  ${input.w ?? '?'}x${input.h ?? '?'}\n` +
    `game thread: ${busy.toFixed(0)}% working, ${wait.toFixed(0)}% waiting on GPU, ${idle.toFixed(0)}% idle\n` +
    (window.__renderMs !== undefined ? `renderer thread: ${window.__renderMs.toFixed(1)} ms/frame applying ops\n` : '') +
    (t ? `renderer: p50 ${t.p50?.toFixed(0)} ms, p95 ${t.p95?.toFixed(0)} ms per frame\n` : '') + verdict;
}
let renderPort = null;
if (!inlineRender) {
  const rw = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' }), ch = new MessageChannel();
  const offscreen = canvas.transferControlToOffscreen();
  rw.postMessage({ type: 'init', canvas: offscreen, port: ch.port2 }, [offscreen, ch.port2]);
  rw.onmessage = ({ data: m }) => {
    if (m.type === 'context-lost') contextLost();
    else if (m.type === 'log') console.log(m.text);
    else if (m.type === 'gpu') { gpuBytes = { ...m.gpu, live: m.live, stats: m.stats, byFormat: m.byFormat }; window.__frameStats = m.timing; window.__renderMs = m.renderMs; window.__renderStats = m.stats; }
  };
  renderPort = ch.port1;
}
// The launcher (web/launcher.js) adds the chosen edition and graphics size; URL parameters still work for tests.
const params = { ...Object.fromEntries(new URLSearchParams(location.search)), ...(globalThis.__launch ?? {}) };
// Engine size: the window in device pixels (so a high-density screen is not upscaled and blurred), scaled down to fit
// within 1920x1080 with the window's shape kept. It follows the window on every start (launch-config.mjs).
// Multiplayer (server browser, hosting, joining) is on unless ?mp=0.
params.mp = params.mp === '0' ? '0' : '1';
function windowSize() {
  const dpr = Math.max(1, devicePixelRatio || 1), w = innerWidth * dpr, h = innerHeight * dpr, k = Math.min(1, 1920 / w, 1080 / h);
  return [Math.max(640, Math.round(w * k)) & ~1, Math.max(480, Math.round(h * k)) & ~1];   // GMod's chat font needs 480 lines
}
// A window that fills most of the screen is about to go (or is) fullscreen: the engine takes the screen's size, so
// fullscreen is sharp. The size is fixed once the game starts; in a smaller window the picture is scaled down a little.
function targetSize() {
  const dpr = Math.max(1, devicePixelRatio || 1), sw = screen?.width || 0, sh = screen?.height || 0;
  if (!sw || innerWidth < 0.9 * sw || innerHeight < 0.75 * sh) return windowSize();
  const k = Math.min(1, 1920 / (sw * dpr), 1080 / (sh * dpr));
  return [Math.round(sw * dpr * k) & ~1, Math.max(480, Math.round(sh * dpr * k)) & ~1];
}
params.win = targetSize().join('x');

// This browser's player identity: a random Steam account id (kept, so saves and bans stay with the player) and the name
// chosen in the launcher's chat, used in game (steam.mjs).
// Signed in to Steam (Profile, web/steam-account.js): the game uses the real SteamID, and real login tickets from the hub
// are kept ready in shared memory for the next server join: [i32 sequence][i32 length][ticket bytes].
const steamAcct = steamAccount();
if (steamAcct) params.steamid = accountId(steamAcct);
const steamTicketBuf = new SharedArrayBuffer(8 + 4096);
async function refreshSteamTicket() {
  try {
    const r = await steamTicket(); if (!r) return;
    const bytes = Uint8Array.from(atob(r.ticket), (c) => c.charCodeAt(0)), hdr = new Int32Array(steamTicketBuf, 0, 2);
    if (bytes.length > 4096) return;
    new Uint8Array(steamTicketBuf, 8, bytes.length).set(bytes); Atomics.store(hdr, 1, bytes.length); Atomics.add(hdr, 0, 1);
  } catch (e) { console.warn('Steam ticket:', e.message); }
}
if (steamAcct) { refreshSteamTicket(); setInterval(() => steamKeepalive().catch(() => {}), 60e3); }
try {
  let id = localStorage.getItem('garrys-wasm.steamid');
  if (!/^\d{1,10}$/.test(id ?? '')) { id = String(1e6 + Math.floor(Math.random() * 2e9)); localStorage.setItem('garrys-wasm.steamid', id); }
  params.steamid ??= id;
  params.name ??= localStorage.getItem('garrys-wasm.name') || `Player${id.slice(-4)}`;
  // The engine's player name comes from its name cvar (shown to other players); set it from the profile.
  const safe = String(params.name).replace(/[\u0000-\u001f"';]/g, '').trim().slice(0, 31);
  if (safe) params.cmd = `${params.cmd ?? ''} +name "${safe}"`.trim();
  // Player colour from the launcher's Profile (r g b, 0..1), applied like the in-game Player Model editor does.
  const color = localStorage.getItem('garrys-wasm.playercolor');
  if (/^[\d.]+ [\d.]+ [\d.]+$/.test(color ?? '')) params.cmd = `${params.cmd ?? ''} +cl_playercolor "${color}"`.trim();
} catch { /* storage blocked: the shim's defaults */ }
// Bundled addons switched off on the in-game Addons page (menu-extras.js); they are left out of the file tree at startup.
// A custom game version (launcher.js) fixes the edition, the bundled addons left out, and the library addons mounted.
const version = params.version ? getVersion(params.version) : null;
if (version) { params.edition = version.edition; params.disabledAddons = (version.disabled ?? []).join(','); }
try { params.disabledAddons ??= JSON.parse(localStorage.getItem('garrys-wasm.disabled-addons') ?? '[]').join(','); } catch { /* storage blocked */ }

import { GameAudio } from './audio.js';
import { createAudioRing } from '../tools/lift/host/waveout.mjs';
import { GameInput } from './input.js';
import { HtmlPanels } from './html-panels.js';
import { createRing, RingWriter } from '../tools/lift/host/ring.mjs';
import { openStorage, menuHost } from './storage.js';
import { getVersion, launchAddons, updateMeta } from './library.js';
import { autoSync } from './account.js';
autoSync();   // signed in: in-game changes (versions, addons) reach the account
import { P2P } from './p2p.js';
import { GameVoice } from './voice.js';
import { Lobby } from './lobby.js';
import { hubUrl } from './hub.js';
import { steamAccount, accountId, ticket as steamTicket, keepalive as steamKeepalive } from './steam-account.js';

const storage = await openStorage({ library: launchAddons(version) }).catch(e => { status.textContent = `Storage failed: ${e.message}`; throw e; });
// Addons older builds kept in memory were moved into the library: they stay in the plain edition's "my addons".
for (const m of storage.migrated) updateMeta(m.name, { title: m.name.replace(/\.gma$/, ''), size: m.size, global: true, added: Date.now() });
const session = { version, active: new Set(storage.library) };
const preferences = await storage.request('preferences');

const worker = new Worker(new URL('./guest-worker.js', import.meta.url), { type: 'module' });
let frames = 0;
const audioRing = createAudioRing(), audio = new GameAudio(audioRing);
const micRing = createRing(64 * 1024), voice = new GameVoice(micRing);
window.__audio = () => audio.stats();

// Page -> guest events for HTML panels; the guest polls them, so writes never block the page.
const htmlRing = createRing(8 * 1024 * 1024), htmlWriter = new RingWriter(htmlRing), enc = new TextEncoder();
const inputRing = createRing(256 * 1024), inputWriter = new RingWriter(inputRing);
const input = new GameInput(canvas, ev => { if (!inputWriter.tryWrite(enc.encode(JSON.stringify(ev)))) console.warn('input ring full'); });
// The engine starts active unless the page is hidden; visibility changes follow (web/input.js).
if (document.hidden) input.send({ type: 'focus', focused: false });
const panels = new HtmlPanels(document.body, canvas, (ev) => { if (!htmlWriter.tryWrite(enc.encode(JSON.stringify(ev)))) console.warn('html event ring full'); });
// Peer-to-peer play (web/p2p.js): packets between the engine's UDP sockets and WebRTC peers. Pairing is driven from the in-game
// Multiplayer page (menu-extras.js); both players must run the same edition.
const edition = params.edition === 'extended' ? 'extended' : 'base';
// With a hub, games are found and paired through it (web/lobby.js) and may cross the internet, so WebRTC also asks one public
// STUN server for this browser's public address; without a hub, pairing is by invite codes on the local network only.
const identity = params.steamid ? { steamid: String(76561197960265728n + BigInt(params.steamid)), name: String(params.name ?? 'Player') } : null;
const p2p = params.mp === '1' ? new P2P({ edition, internet: !!hubUrl(), identity }) : null;
const lobby = p2p ? new Lobby(p2p, { edition }) : null;
window.__p2p = p2p;
window.__lobby = lobby;
panels.host = menuHost(storage, p2p, { edition, lobby, session, startedOff: String(params.disabledAddons ?? '').split(',').filter(Boolean).sort().join(',') });
// Guest threads: workers ask the page to start them (a blocked worker cannot start one itself). Each thread
// worker announces 'thread-ready' and then receives its init data; it may ask for further threads in turn.
const threads = new Map();
function spawnThread(data) {
  const w = new Worker(new URL('../tools/lift/host/thread-worker.mjs', import.meta.url), { type: 'module' });
  threads.set(data.threadId, w);
  w.onmessage = (e) => {
    if (e.data?.type === 'thread-ready') w.postMessage(data);
    else threadRequest(e.data);
  };
  w.onerror = (e) => console.error(`[thread] worker ${data.threadId} failed: ${e.message}`);
}
function threadRequest(m) {
  if (m?.type === 'spawn-thread') { spawnThread(m.data); return true; }
  if (m?.type === 'terminate-thread') { threads.get(m.threadId)?.terminate(); threads.delete(m.threadId); return true; }
  return false;
}

panels.input = (ev, frame) => input.handle(ev, frame);
worker.onmessage = (e) => {
  const m = e.data;
  if (threadRequest(m)) return;
  if (m.type === 'perf') { perfHud(m); } else if (m.type === 'voice') { if (m.on) voice.start(); else voice.stop(); } else if (m.type === 'audio-memory') { audio.setMemory(m.memory); } else if (m.type === 'cursor') { input.cursor(m.hidden); } else if (m.type === 'frame') {
    const w = m.w, h = m.h;
    input.w = w; input.h = h;
    if (ctx && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
    // Opaque already: read from the alpha:false canvas (renderer.readFrameAsync).
    if (m.px) ctx.putImageData(new ImageData(new Uint8ClampedArray(m.px), w, h), 0, 0);
    panels.layout(m.html ?? [], w, h);
    if (m.gpu) gpuBytes = { ...m.gpu, live: m.live, stats: m.stats, byFormat: m.byFormat };
    if (++frames === 1) { status.textContent = ''; document.title = "Garry's Web"; }
  } else if (m.type === 'html') {
    panels.handle(m.m);
  } else if (m.type === 'status') {
    if (!frames) status.textContent = m.text;
    console.log(`[status] ${m.text}`);
  } else if (m.type === 'log') {
    console.log(m.text);
  } else if (m.type === 'steam-ticket-used') {
    refreshSteamTicket();
  } else if (m.type === 'quit') {
    // The game was quit: back to the launcher (the page without launch parameters; saved files are already in OPFS).
    try { sessionStorage.removeItem('garrys-wasm.resume'); } catch { /* storage blocked */ }
    status.textContent = 'Returning to the launcher...';
    Promise.race([storage.request('flush').catch(() => {}), new Promise((r) => setTimeout(r, 3000))]).then(() => location.replace(location.pathname));
  } else if (m.type === 'error') {
    status.textContent = m.text;
    console.error(m.text);
  }
};
worker.onerror = (e) => { status.textContent = `Worker failed: ${e.message}`; console.error(e); };
let gpuBytes = null;
worker.postMessage({ type: 'boot', env: params, netRings: p2p?.rings, micRing, steamTicket: steamAcct ? steamTicketBuf : null, cmdline: params.cmd ?? '', htmlRing, inputRing, audioRing, overlayBuffer: storage.buffer, saved: preferences.saved, renderPort }, renderPort ? [renderPort] : []);
window.__frames = () => frames;
// Diagnostics: a file the game wrote (e.g. a con_logfile), read from the overlay even while the engine keeps it open.
window.__readGameFile = async (p) => { const b = await storage.request('read-file', { path: '/overlay/garrysmod/' + p }); return b ? new TextDecoder().decode(b) : null; };
window.__gpu = () => gpuBytes;
// Test hook: what each HTML panel is showing and where.
window.__panels = () => [...panels.panels.values()].map((p) => ({ id: p.id, url: p.url, loaded: !!p.loaded, size: [p.w, p.h], style: p.frame.style.cssText, base: p.frame.contentDocument?.baseURI, bases: [...(p.frame.contentDocument?.querySelectorAll('base') ?? [])].map(b => b.getAttribute('href')) }));
