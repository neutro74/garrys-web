#!/usr/bin/env node
// Looks for cut-off and spilling text in the launcher, against a local hub (no game is started):
//   node tools/test-ui-audit.mjs [--out run/ui-audit] [--sizes 1366x768,1280x720,1024x600]
// Two players (the second in another browser context) who are friends and in a voice call together. At each window size,
// player one goes through every tab, the call, the popovers (status, notifications, inbox, profile card), a Workshop list
// (stubbed: a local hub has no Steam key) with its details window, the Admin tab, then the game's loading screen; each
// scene is screenshotted and every text cut by an ancestor that clips, or squeezed into an ellipsis, is listed. Exits 1 if any.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './lib/browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('out', 'run/ui-audit'));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const sizes = arg('sizes', '1366x768,1280x720,1024x600').split(',').map((s) => s.split('x').map(Number));
const HUB = 8790 + Math.floor(Math.random() * 50), WEB = HUB + 100;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-hub-'));
const suffix = String(Math.floor(Math.random() * 1e5)), user = 'auditor' + suffix, friend = 'friend' + suffix;
const hub = spawn(process.execPath, ['hub/hub.mjs'], { env: { ...process.env, PORT: String(HUB), HOST: '127.0.0.1', WS_CACHE: cache, ACCOUNT_ATTEMPTS: '50', ADMIN_USERS: user }, stdio: ['ignore', 'ignore', 'inherit'] });
const web = spawn(process.execPath, ['web/server.mjs', '--port', String(WEB)], { stdio: ['ignore', 'ignore', 'inherit'] });
process.env.BROWSER_ARGS = [process.env.BROWSER_ARGS, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'].filter(Boolean).join(' ');
let browser = null;
const done = async (code) => { await browser?.close().catch(() => {}); hub.kill(); web.kill(); fs.rmSync(cache, { recursive: true, force: true }); process.exit(code); };
process.on('SIGINT', () => done(130));
await new Promise((r) => setTimeout(r, 2000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expr, what, ms = 20000, b = browser) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) if (await b.eval(expr).catch(() => false)) return true;
  console.log(`FAIL: ${what}`); await b.screenshot(path.join(out, 'fail.png')); return done(1);
}

// In the page: every visible text node's box against the ancestors that clip it.
const AUDIT = `(() => {
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].map((c) => '.' + c).join('');
  const where = (e) => { const p = []; for (let x = e; x && x !== document.body && p.length < 4; x = x.parentElement) p.unshift(name(x)); return p.join(' > '); };
  const found = new Map();
  const add = (e, kind, text, by) => { const k = where(e) + kind; if (!found.has(k)) found.set(k, { kind, at: where(e), text: text.slice(0, 60), by: by && where(by) }); };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const text = n.textContent.replace(/\\s+/g, ' ').trim();
    const e = n.parentElement;
    if (!text || !e || e.closest('[hidden],script,style,template,#splash,.gwl-loadlog')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const box = r.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if (cs.webkitLineClamp !== 'none' && cs.webkitLineClamp) continue;   // a preview of a few lines ending in an ellipsis, on purpose
    for (let a = e; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.display === 'none' || +s.opacity === 0) break;
      const clipX = s.overflowX !== 'visible', clipY = s.overflowY !== 'visible';
      if (!clipX && !clipY) continue;
      const ab = a.getBoundingClientRect();
      // Scrolling boxes cut text on purpose (it scrolls into view): only text cut at the box's side across the scroll axis counts.
      const scrollX = s.overflowX === 'auto' || s.overflowX === 'scroll', scrollY = s.overflowY === 'auto' || s.overflowY === 'scroll';
      const cutX = clipX && !scrollX && (box.left < ab.left - 1 || box.right > ab.right + 1);
      const cutY = clipY && !scrollY && (box.top < ab.top - 1 || box.bottom > ab.bottom + 1) && box.top < ab.bottom && box.bottom > ab.top;
      if (cutX || cutY) { add(e, cutX ? 'cut-x' : 'cut-y', text, a); break; }
      if (scrollX || scrollY) break;
    }
    if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) add(e, 'ellipsis', text);
  }
  // Controls whose label does not fit (a button wider inside than out, or an input's placeholder).
  for (const e of document.querySelectorAll('button, .dk-button, select, input[placeholder]')) {
    if (e.closest('[hidden]') || !e.offsetParent) continue;
    if (e.matches('input')) {
      const c = document.createElement('canvas').getContext('2d'); const s = getComputedStyle(e); c.font = s.font;
      const room = e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      if (!e.value && c.measureText(e.placeholder).width > room + 1) add(e, 'placeholder', e.placeholder);
    } else if (e.scrollWidth > e.clientWidth + 1) add(e, 'control', e.textContent.trim() || e.value || '');
  }
  return [...found.values()];
})()`;


async function signUp(b, name) {
  await b.goto(`http://127.0.0.1:${WEB}/?launcher=1&hub=ws://127.0.0.1:${HUB}`);
  await until(`!!document.querySelector('[data-tab="chat"]')`, `${name}: launcher`, 30000, b);
  await b.eval(`import('/web/account.js').then((m) => m.register(${JSON.stringify(name)}, 'secret12')).then(() => true)`);
  await b.goto(`http://127.0.0.1:${WEB}/?launcher=1`);
  await until(`document.querySelector('[data-me] span')?.textContent === ${JSON.stringify(name)}`, `${name}: signed in`, 20000, b);
}
const HUBJS = `(await import('/web/hub.js')).sharedHub()`;
browser = await launch({ width: sizes[0][0], height: sizes[0][1], gpu: false });
browser.on('Runtime.exceptionThrown', (p) => console.log(`[page] exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
await signUp(browser, user);
const B = await browser.newContextPage();
await signUp(B, friend);
// Friends, some chat (a long message among it), and both in the Lounge voice channel.
await browser.eval(`(async () => { const h = ${HUBJS}; h.send({ t: 'friend-add', user: ${JSON.stringify(friend)} }); return true; })()`);
await sleep(800);
await B.eval(`(async () => { const h = ${HUBJS}; h.send({ t: 'friend-accept', user: ${JSON.stringify(user)} }); return true; })()`);
for (const b of [browser, B]) {
  await b.eval(`document.querySelector('[data-tab="chat"]').click()`);
  await until(`[...document.querySelectorAll('.gwc-vc')].some((e) => e.textContent.includes('Lounge'))`, 'voice channels listed', 20000, b);
}
await B.eval(`(async () => { const h = ${HUBJS}; for (const text of ['hello there', '@${user} A much longer message to see how the lines wrap in the chat window, and averyveryverylongwordwithoutanyspacesthatshouldstillwrapinsidethebubbleproperly']) h.send({ t: 'say', room: 'general', text }); return true; })()`);
for (const b of [browser, B]) await b.eval(`[...document.querySelectorAll('.gwc-vc')].find((e) => e.textContent.includes('Lounge')).click()`);
await until(`(async () => (await import('/web/voice-chat.js')).voiceClient(${HUBJS}).channel()?.members.length === 2)()`, 'both in the call');
// The Workshop list, stubbed (the hub needs a Steam key for it): a few items with long titles and tags.
await browser.eval(`(() => {
  const real = window.fetch, item = (i) => ({ id: String(100000 + i), title: ['gm_bigcity', 'A Really Long Addon Title That Goes On And On For Ages (Updated 2024)', 'Wiremod', 'TFA Base Weapons Pack With Extras'][i % 4],
    preview: '', size: [120e6, 3e9, 40e6, 800e6][i % 4], subs: 1234567 * (i + 1), up: 900, down: 40, tags: ['Addon', 'Map', 'Build', 'Roleplay'], description: 'A description. '.repeat(40), author: 'someone' });
  window.fetch = (u, init) => String(u).includes('ws/browse') ? Promise.resolve(new Response(JSON.stringify({ total: 8, items: Array.from({ length: 8 }, (_, i) => item(i)) }), { headers: { 'content-type': 'application/json' } })) : real(u, init);
  return true; })()`);

const tab = (k) => `document.querySelector('.dk-tab[data-tab="${k}"]').click()`;
const click = (q) => `document.querySelector(${JSON.stringify(q)}).click()`;
const closeAll = `(() => { document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelector('.gww-detail [data-x]')?.click(); return true; })()`;
const scenes = [
  ['play', tab('play')], ['saves', tab('saves')], ['workshop', tab('workshop'), 2500],
  ['workshop-details', click('.gww-pic'), 1200],
  ['chat', `${tab('chat')}; ${click('[data-tab="chat"]')}`], ['chat-in-call', `[...document.querySelectorAll('.gwc-navitem')].find((e) => e.textContent.includes('general'))?.click()`],
  ['status-menu', click('.gwc-meinfo')], ['notif-menu', click('[data-notif]')], ['inbox', click('[data-inbox]')],
  ['profile-card', `[...document.querySelectorAll('.gwc-members .gwc-person, .gwc-members [data-user], .gwc-members button')].find((e) => e.textContent.includes(${JSON.stringify(friend)}))?.click()`],
  ['friends', tab('friends')], ['friends-all', `[...document.querySelectorAll('.gwc-tabs .dk-btn')].find((e) => e.textContent === 'All').click()`],
  ['versions', tab('versions')], ['profile', tab('profile')], ['options', tab('options')], ['admin', `document.querySelector('.dk-tab[data-tab="admin"]')?.click()`, 2500],
];
let problems = 0;
for (const [w, h] of sizes) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  for (const [name, act, wait = 1200] of scenes) {
    if (!name.match(/menu|inbox|card|details/)) await browser.eval(closeAll).catch(() => {});
    await browser.eval(act).catch((e) => console.log(`  (${name}: ${e.message})`));
    await sleep(wait);
    await browser.screenshot(path.join(out, `${w}x${h}-${name}.png`));
    const found = await browser.eval(AUDIT);
    problems += found.length;
    console.log(`== ${w}x${h} ${name}: ${found.length ? found.length + ' problem(s)' : 'ok'}`);
    for (const f of found) console.log(`  ${f.kind.padEnd(11)} "${f.text}"  at ${f.at}${f.by ? `  (cut by ${f.by})` : ''}`);
  }
}
// The page's own splash (web/index.html) with its longest line, the local network one.
{
  const msg = await browser.eval(`(async () => { const t = await (await fetch('/web/launcher.js')).text(); return t.match(/statusEl.textContent = '(Connecting[^']*Allow[^']*)'/)?.[1] ?? ''; })()`);
  await browser.eval(`(() => { const r = document.getElementById('launcher'); r.style.visibility = 'hidden'; document.body.classList.remove('launcher-ready'); document.getElementById('status').textContent = ${JSON.stringify(msg)}.replace(/\\'/g, "'"); return true; })()`);
  for (const [w, h] of sizes) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    await browser.screenshot(path.join(out, `${w}x${h}-splash.png`));
    const found = await browser.eval(AUDIT.replace(',#splash', ''));
    problems += found.length;
    console.log(`== ${w}x${h} splash: ${found.length ? found.length + ' problem(s)' : 'ok'}`);
    for (const f of found) console.log(`  ${f.kind.padEnd(11)} "${f.text}"  at ${f.at}${f.by ? `  (cut by ${f.by})` : ''}`);
  }
  await browser.eval(`(() => { document.getElementById('launcher').style.visibility = ''; document.body.classList.add('launcher-ready'); return true; })()`);
}
// Last, the game's loading screen (the download starts; the browser is closed a few seconds later).
if (!process.argv.includes('--no-loading')) {
  await browser.eval(closeAll); await browser.eval(tab('play')); await sleep(500);
  await browser.eval(click('.gwl-game[data-ed="base"]')).catch(() => browser.eval(click('.gwl-game')));
  await until(`!!document.querySelector('.gwl-loadwin')`, 'loading screen');
  await sleep(2500);
  for (const [w, h] of sizes) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await browser.screenshot(path.join(out, `${w}x${h}-loading.png`));
    const found = await browser.eval(AUDIT);
    problems += found.length;
    console.log(`== ${w}x${h} loading: ${found.length ? found.length + ' problem(s)' : 'ok'}`);
    for (const f of found) console.log(`  ${f.kind.padEnd(11)} "${f.text}"  at ${f.at}${f.by ? `  (cut by ${f.by})` : ''}`);
  }
}
console.log(`\n${problems} problem(s). Screenshots: ${out}`);
await done(problems ? 1 : 0);
