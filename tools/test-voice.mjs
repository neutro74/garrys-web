#!/usr/bin/env node
// Voice channels between two players, against a local hub (no game is started):
//   node tools/test-voice.mjs [--out run/voice]
// One browser with Chromium's fake microphone (a test tone); the second player is a separate browser context in it. Both
// sign up, join the Lounge channel and must hear each other talking. Then the in-game overlay (web/overlay.js) is made in
// the first page on the same connection, as when the game starts: its voice HUD must show the channel and Ctrl+Shift+M /
// Ctrl+Shift+D must mute and deafen.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './lib/browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('out', 'run/voice'));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const HUB = 8790 + Math.floor(Math.random() * 50), WEB = HUB + 100;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-hub-'));
const hub = spawn(process.execPath, ['hub/hub.mjs'], { env: { ...process.env, PORT: String(HUB), HOST: '127.0.0.1', WS_CACHE: cache, ACCOUNT_ATTEMPTS: '50' }, stdio: ['ignore', 'ignore', 'inherit'] });
const web = spawn(process.execPath, ['web/server.mjs', '--port', String(WEB)], { stdio: ['ignore', 'ignore', 'inherit'] });
process.env.BROWSER_ARGS = [process.env.BROWSER_ARGS, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'].filter(Boolean).join(' ');
let browser = null;
const done = async (code) => { await browser?.close().catch(() => {}); hub.kill(); web.kill(); fs.rmSync(cache, { recursive: true, force: true }); process.exit(code); };
process.on('SIGINT', () => done(130));
await new Promise((r) => setTimeout(r, 2000));

const check = (ok, what) => { if (!ok) { console.log(`FAIL: ${what}`); return done(1); } console.log(`ok: ${what}`); };
async function until(b, expr, what, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await b.eval(expr).catch((e) => ({ error: e.message }));
    if (v && !v.error) return v;
    if (Date.now() - t0 > ms) { await b.screenshot(path.join(out, `${b.label}-fail.png`)); return check(false, `${what} (timed out: ${JSON.stringify(v)})`); }
    await new Promise((r) => setTimeout(r, 250));
  }
}
const VC = `(await import('/web/voice-chat.js')).voiceClient((await import('/web/hub.js')).sharedHub())`;
async function player(label, user) {
  const b = browser ? await browser.newContextPage() : (browser = await launch({ width: 1280, height: 720, gpu: false }));
  b.label = label;
  b.on('Runtime.exceptionThrown', (p) => console.log(`[${label}] exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
  await b.goto(`http://127.0.0.1:${WEB}/?launcher=1&hub=ws://127.0.0.1:${HUB}`);
  await until(b, `!!document.querySelector('[data-tab="chat"]')`, `${label}: launcher`);
  await b.eval(`import('/web/account.js').then((m) => m.register(${JSON.stringify(user)}, 'secret12')).then(() => true)`);
  await b.goto(`http://127.0.0.1:${WEB}/?launcher=1`);
  await until(b, `document.querySelector('[data-me] span')?.textContent === ${JSON.stringify(user)}`, `${label}: signed in`);
  await b.eval(`document.querySelector('[data-tab="chat"]').click()`);
  await until(b, `[...document.querySelectorAll('.gwc-vc')].some((e) => e.textContent.includes('Lounge'))`, `${label}: voice channels listed`);
  return b;
}
const suffix = String(Math.floor(Math.random() * 1e5));
const A = await player('amy', 'amy' + suffix), B = await player('bob', 'bob' + suffix);
for (const b of [A, B]) await b.eval(`[...document.querySelectorAll('.gwc-vc')].find((e) => e.textContent.includes('Lounge')).click()`);
await until(A, `(async () => { const vc = ${VC}; return vc.current && [...vc.peers.values()].some((p) => p.pc.connectionState === 'connected'); })()`, 'amy is connected to bob');
await until(B, `(async () => { const vc = ${VC}; return vc.current && [...vc.peers.values()].some((p) => p.pc.connectionState === 'connected'); })()`, 'bob is connected to amy');
// The fake microphone plays a tone, so each side should see the other talking.
await until(A, `(async () => { const vc = ${VC}; const me = (await import('/web/hub.js')).sharedHub().me.id; return [...vc.speaking].some((id) => id !== me); })()`, 'amy hears bob talking');
await until(B, `(async () => { const vc = ${VC}; const me = (await import('/web/hub.js')).sharedHub().me.id; return [...vc.speaking].some((id) => id !== me); })()`, 'bob hears amy talking');
await A.screenshot(path.join(out, 'amy-voice.png'));

// The game's overlay on the same connection: the HUD shows the channel; the voice keys mute and deafen. The overlay takes the
// game's input object and sets input.intercept on it (web/input.js calls that first for every event).
await A.eval(`(async () => { const m = await import('/web/overlay.js'); const input = { send() {}, relock() {} }; m.createOverlay({ input }); window.__ovIntercept = input.intercept; return true; })()`);
await until(A, `!document.querySelector('.gw-voicehud').hidden && document.querySelector('.gw-voicehud').textContent.includes('Lounge')`, 'voice HUD shows the channel');
await A.screenshot(path.join(out, 'amy-hud.png'));
const press = (code) => A.eval(`window.__ovIntercept({ type: 'keydown', code: '${code}', key: '${code.slice(3).toLowerCase()}', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false, preventDefault() {} })`);
await press('KeyM');
check(await A.eval(`(async () => (${VC}).muted)()`), 'Ctrl+Shift+M mutes');
await until(B, `(async () => { const vc = ${VC}; const me = (await import('/web/hub.js')).sharedHub().me.id; return vc.channel()?.members.some((m) => m.muted && m.id !== me); })()`, 'bob sees amy muted');
await press('KeyM');
check(await A.eval(`(async () => !(${VC}).muted)()`), 'Ctrl+Shift+M unmutes');
await press('KeyD');
check(await A.eval(`(async () => (${VC}).deafened)()`), 'Ctrl+Shift+D deafens');
await A.screenshot(path.join(out, 'amy-deafened.png'));
console.log(`\nAll checks passed. Screenshots: ${out}`);
await done(0);
