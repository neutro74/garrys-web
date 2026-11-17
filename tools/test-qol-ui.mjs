#!/usr/bin/env node
// Launcher UI check for accounts, profiles, chat, friends and saves, against a local hub (no game is started).
//   node tools/test-qol-ui.mjs [--out run/qol-ui]
// Two browsers sign up as two players; screenshots of each step land in --out. Exits non-zero on the first failed check.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './lib/browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('out', 'run/qol-ui'));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const HUB = 8790 + Math.floor(Math.random() * 50), WEB = HUB + 100;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'qol-hub-'));
const hub = spawn(process.execPath, ['hub/hub.mjs'], { env: { ...process.env, PORT: String(HUB), HOST: '127.0.0.1', WS_CACHE: cache }, stdio: ['ignore', 'ignore', 'inherit'] });
const web = spawn(process.execPath, ['web/server.mjs', '--port', String(WEB)], { stdio: ['ignore', 'ignore', 'inherit'] });
const browsers = [];
const done = async (code) => { for (const b of browsers) await b.close().catch(() => {}); hub.kill(); web.kill(); fs.rmSync(cache, { recursive: true, force: true }); process.exit(code); };
process.on('SIGINT', () => done(130));
await new Promise((r) => setTimeout(r, 2000));

let step = 0;
const check = (ok, what) => { if (!ok) { console.log(`FAIL: ${what}`); return done(1); } console.log(`ok: ${what}`); };
async function until(b, expr, what, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await b.eval(expr).catch((e) => ({ error: e.message }));
    if (v && !v.error) return v;
    if (Date.now() - t0 > ms) { await shot(b, 'fail'); return check(false, `${what} (timed out: ${JSON.stringify(v)})`); }
    await new Promise((r) => setTimeout(r, 250));
  }
}
const shot = (b, name) => b.screenshot(path.join(out, `${String(++step).padStart(2, '0')}-${b.label}-${name}.png`));
const click = (b, sel) => b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
const type = (b, sel, text) => b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const enter = (b, sel) => b.eval(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);

async function player(label, user) {
  const b = await launch({ width: 1366, height: 768, gpu: false });
  b.label = label; browsers.push(b);
  b.on('Runtime.consoleAPICalled', (p) => { const t = p.args.map((a) => a.value ?? a.description).join(' '); if (/^\[launcher\]/.test(t)) console.log(`[${label}] ${t}`); });
  b.on('Runtime.exceptionThrown', (p) => console.log(`[${label}] exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
  await b.goto(`http://127.0.0.1:${WEB}/?launcher=1&hub=ws://127.0.0.1:${HUB}`);
  await until(b, `!!document.querySelector('[data-open="profile"]')`, `${label}: launcher menu`);
  await b.eval(`import('/web/account.js').then((m) => m.register(${JSON.stringify(user)}, 'secret12')).then(() => true)`);
  await b.goto(`http://127.0.0.1:${WEB}/?launcher=1`);
  await until(b, `!!document.querySelector('.me-chip b') && document.querySelector('.me-chip b').textContent !== 'Not signed in'`, `${label}: signed in, chip shows the account`);
  return b;
}

const suffix = String(Math.floor(Math.random() * 1e5));
const A = await player('ann', 'ann' + suffix), B = await player('ben', 'ben' + suffix);
const ann = 'ann' + suffix, ben = 'ben' + suffix;
await shot(A, 'menu');

// Profile: the editor loads, a display name and bio save and show in the preview card.
await click(A, '[data-open="profile"]');
await until(A, `!!document.querySelector('[data-pfsave]')`, 'profile editor');
await type(A, '[data-k="display"]', 'Ann the Builder');
await type(A, '[data-k="bio"]', 'I build castles on gm_construct.');
await type(A, '[data-k="custom.text"]', 'Building');
await click(A, '[data-pfsave]');
await until(A, `/Saved/.test(document.querySelector('[data-pfmsg]').textContent)`, 'profile saved');
check(await A.eval(`document.querySelector('.pf-preview h3').textContent === 'Ann the Builder'`), 'preview card shows the display name');
await shot(A, 'profile');

// Chat: Ann posts in #general; Ben sees it with Ann's display name, replies and reacts.
await click(A, '[data-open="chat"]');
await until(A, `document.querySelector('[data-text]') && !document.querySelector('[data-text]').disabled`, 'chat ready (ann)');
await type(A, '[data-text]', `Hello from ${ann}! **bold** and @${ben}`);
await enter(A, '[data-text]');
await until(A, `[...document.querySelectorAll('.gwc-msg .gwc-text')].some((e) => e.textContent.includes('Hello from'))`, 'ann sees her message');
await click(B, '[data-open="chat"]');
await until(B, `[...document.querySelectorAll('.gwc-msg')].some((e) => e.textContent.includes('Hello from') && e.querySelector('.gwc-name')?.textContent === 'Ann the Builder')`, 'ben sees it under Ann\'s display name', 20000);
check(await B.eval(`!!document.querySelector('.gwc-msg.mentioned strong')`), 'mention highlighted and **bold** rendered');
await B.eval(`[...document.querySelectorAll('.gwc-msg')].find((e) => e.textContent.includes('Hello from')).querySelector('.gwc-msgtools button').click()`);
await until(A, `!!document.querySelector('.gwc-rx')`, 'ann sees ben\'s reaction');
await shot(B, 'chat');

// Friends: Ben sends a request from the Friends view; Ann accepts it from Pending.
await click(B, '.gwc-navitem');   // Friends is the first entry
await until(B, `!!document.querySelector('.gwc-tabs')`, 'friends view');
await B.eval(`[...document.querySelectorAll('.gwc-tabs button')].find((b) => b.textContent === 'Add friend').click()`);
await type(B, '.gwc-addfriend input', ann);
await B.eval(`document.querySelector('.gwc-addfriend').requestSubmit()`);
await until(A, `/Pending \\(1\\)/.test(document.querySelector('.gwc-tabs')?.textContent ?? '') || !!document.querySelector('.gwc-navitem .gwc-badge')`, 'ann gets the request');
await A.eval(`document.querySelector('.gwc-navitem').click()`);
await until(A, `[...document.querySelectorAll('.gwc-frow .gwc-btn')].some((b) => b.textContent === 'Accept')`, 'pending list shows Accept');
await A.eval(`[...document.querySelectorAll('.gwc-frow .gwc-btn')].find((b) => b.textContent === 'Accept').click()`);
await B.eval(`[...document.querySelectorAll('.gwc-tabs button')].find((b) => b.textContent === 'Online').click()`);
await until(B, `[...document.querySelectorAll('.gwc-frow')].some((r) => r.textContent.includes('Ann the Builder'))`, 'ben sees Ann online in friends');
await shot(B, 'friends');

// Private message: Ben messages Ann from the friends list; Ann gets it in Direct messages.
await B.eval(`[...document.querySelectorAll('.gwc-frow .gwc-btn')].find((b) => b.textContent === 'Message').click()`);
await until(B, `!document.querySelector('[data-text]').disabled`, 'dm composer');
await type(B, '[data-text]', 'psst, want to build?');
await enter(B, '[data-text]');
await until(A, `[...document.querySelectorAll('.gwc-dm')].some((e) => e.classList.contains('unread') || e.querySelector('.gwc-badge'))`, 'ann sees an unread private chat');
await A.eval(`document.querySelector('.gwc-dm').click()`);
await until(A, `[...document.querySelectorAll('.gwc-msg .gwc-text')].some((e) => e.textContent.includes('psst'))`, 'ann reads the private message');
await shot(A, 'dm');

// Saves: a save written to the account's folder is listed, shares as a link, and Ben can add it from that link.
await A.eval(`document.querySelector('[data-close]')?.click()`);
await A.eval(`(async () => { const m = await import('/web/local-saves.js'); await m.writeSaveEntries([['/overlay/garrysmod/saves/castle.gms', new TextEncoder().encode('GMSV fake save')]]); return true; })()`);
await A.eval(`document.querySelector('.gw-overlay')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
await A.eval(`(() => { const o = document.querySelector('.gw-overlay'); if (o) o.hidden = true; return true; })()`);
await click(A, '[data-open="saves"]');
await until(A, `[...document.querySelectorAll('.saverow b')].some((e) => e.textContent === 'castle')`, 'saves panel lists the save');
await A.eval(`[...document.querySelectorAll('.saverow')].find((r) => r.textContent.includes('castle')).querySelectorAll('.vbtns button')[1].click()`);
const link = await until(A, `document.querySelector('.vshare input')?.value`, 'share link shown');
check(/\?save=[A-Za-z0-9_-]{6,12}$/.test(link), `share link looks right (${link})`);
await shot(A, 'saves');
const code = link.split('save=')[1];
await B.goto(`http://127.0.0.1:${WEB}/?launcher=1&save=${code}`);
await until(B, `[...document.querySelectorAll('.saverow b')].some((e) => e.textContent.includes('castle (shared'))`, 'ben opened the link and has the save', 20000);
await shot(B, 'shared-save');

console.log(`\nAll checks passed. Screenshots: ${out}`);
await done(0);
