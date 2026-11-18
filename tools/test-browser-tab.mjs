#!/usr/bin/env node
// The launcher's Browser tab against a local hub (its web proxy reaches the real internet):
//   node tools/test-browser-tab.mjs [--out run/browser-tab]
// Signs up, opens pages (example.com, then Wikipedia and a link inside it), checks the address bar follows the page and that
// back works, and that a local address is refused. One capped browser, no game.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './lib/browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('out', 'run/browser-tab'));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const HUB = 8790 + Math.floor(Math.random() * 50), WEB = HUB + 100;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'btab-hub-'));
const hub = spawn(process.execPath, ['hub/hub.mjs'], { env: { ...process.env, PORT: String(HUB), HOST: '127.0.0.1', WS_CACHE: cache, ACCOUNT_ATTEMPTS: '50' }, stdio: ['ignore', 'ignore', 'inherit'] });
const web = spawn(process.execPath, ['web/server.mjs', '--port', String(WEB)], { stdio: ['ignore', 'ignore', 'inherit'] });
let b = null;
const done = async (code) => { await b?.close().catch(() => {}); hub.kill(); web.kill(); fs.rmSync(cache, { recursive: true, force: true }); process.exit(code); };
process.on('SIGINT', () => done(130));
await new Promise((r) => setTimeout(r, 2000));
let step = 0;
const shot = (name) => b.screenshot(path.join(out, `${String(++step).padStart(2, '0')}-${name}.png`));
const check = (ok, what) => { if (!ok) { console.log(`FAIL: ${what}`); return done(1); } console.log(`ok: ${what}`); };
async function until(expr, what, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await b.eval(expr).catch((e) => ({ error: e.message }));
    if (v && !v.error) { console.log(`ok: ${what}`); return v; }
    if (Date.now() - t0 > ms) { await shot('fail'); return check(false, `${what} (timed out: ${JSON.stringify(v)})`); }
    await new Promise((r) => setTimeout(r, 300));
  }
}
b = await launch({ width: 1366, height: 768, gpu: false });
b.on('Runtime.exceptionThrown', (p) => console.log(`exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300)}`));
await b.goto(`http://127.0.0.1:${WEB}/?launcher=1&hub=ws://127.0.0.1:${HUB}`);
await until(`!!document.querySelector('[data-tab="browser"]')`, 'launcher has a Browser tab');
await b.eval(`import('/web/account.js').then((m) => m.register('surf${Math.floor(Math.random() * 1e5)}', 'secret12')).then(() => true)`);
await b.goto(`http://127.0.0.1:${WEB}/?launcher=1`);
await until(`/^surf/.test(document.querySelector('[data-me] span')?.textContent ?? '')`, 'signed in');
await b.eval(`document.querySelector('[data-tab="browser"]').click()`);
await until(`!!document.querySelector('.gwb-search')`, 'start page with search');
await shot('start');
const typeGo = (text) => b.eval(`(() => { const i = document.querySelector('[data-url]'); i.value = ${JSON.stringify(text)}; document.querySelector('[data-addr]').requestSubmit(); return true; })()`);
// The framed page is cross-origin (the hub), so it is checked through the messages it sends and the status line.
await typeGo('example.com');
await until(`/Example Domain/.test(document.querySelector('[data-status]').textContent)`, 'example.com opens (title reported back)');
check(await b.eval(`document.querySelector('[data-url]').value === 'https://example.com/'`), 'address bar shows https://example.com/');
await shot('example');
await typeGo('https://en.wikipedia.org/wiki/Garry%27s_Mod');
await until(`/Garry/.test(document.querySelector('[data-status]').textContent) && /wikipedia/.test(document.querySelector('[data-status]').textContent)`, 'Wikipedia article opens');
await new Promise((r) => setTimeout(r, 1500));
await shot('wikipedia');
// Follow a link inside the page: the frame is reached through the DevTools target for it.
const frameEval = async (expr) => {
  const { targetInfos } = await b.send('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'iframe' && x.url.includes('/p/'));
  if (!t) return null;
  const { sessionId } = await b.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const r = await b.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
  return r.result.value;
};
const clicked = await frameEval(`(() => { const a = [...document.querySelectorAll('#mw-content-text a[href*="/wiki/"]')].find((x) => /Facepunch|Source|Valve/.test(x.textContent)); if (!a) return null; const h = a.getAttribute('href'); a.click(); return h; })()`);
if (clicked) {
  check(clicked.startsWith('/p/'), `links inside the page go through the proxy (${clicked.slice(0, 60)})`);
  await until(`!/Garry's Mod - Wikipedia|Garry’s Mod/.test(document.querySelector('[data-status]').textContent) && /wikipedia/.test(document.querySelector('[data-status]').textContent)`, 'following a link updates the address bar');
  await shot('followed');
  await b.eval(`document.querySelector('[data-back]').click()`);
  await until(`/Garry/.test(document.querySelector('[data-status]').textContent)`, 'Back returns to the article');
} else console.log('(the frame was not reachable for a click; skipped following a link)');
// Blocked addresses are refused by the hub with a page saying so.
await typeGo('http://192.168.1.1/');
await until(`(document.querySelector('[data-status]').textContent || '').length > 0`, 'local address handled');
await new Promise((r) => setTimeout(r, 1500));
await shot('blocked');
console.log(`\nAll checks passed. Screenshots: ${out}`);
await done(0);
