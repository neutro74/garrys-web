#!/usr/bin/env node
// CPU profile of the guest worker (engine main thread plus its WebGL renderer) in a running map.
//   node tools/web-profile.mjs [--headed] [--query "cmd=+map gm_construct"] [--wait 150] [--seconds 15] [--profile run/profile-chrome]
//                              [--console "+menu"]   (a console command run through the menu just before recording)
// Waits until frames are being presented, records a V8 profile, and prints self time grouped by lifted DLL
// (wasm chunks carry the DLL name in their URL) and by JS function. The raw .cpuprofile goes to run/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const query = arg('query', 'cmd=' + encodeURIComponent('+map gm_construct'));
const wait = +arg('wait', 150), seconds = +arg('seconds', 15), minFrames=+arg('min-frames',300), warmup=+arg('warmup',0);
const output=arg('out','run/guest');
const port = 8100 + Math.floor(Math.random() * 500);
const server = spawn('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '../web/server.mjs'), '--port', String(port)], { stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise((r) => setTimeout(r, 1500));
const profile = path.resolve(arg('profile', 'run/profile-chrome')); fs.mkdirSync(profile, { recursive: true });
const browser = await launch({ width: 1280, height: 720, gpu: process.env.WEB_GPU !== '0', profile, headed: process.argv.includes('--headed') });
const done = async (code) => { await browser.close().catch(() => {}); server.kill(); process.exit(code); };
browser.on('Inspector.targetCrashed', () => { console.log('[profile] PAGE CRASHED'); done(2); });
browser.on('Runtime.consoleAPICalled',p=>{const s=p.args.map(a=>a.value??a.description).join(' ');if(s.includes('[host-counts]')||s.includes('[sleep]'))console.log(s);});
await browser.goto(`http://127.0.0.1:${port}/?${query}`);

const frames = async () => (await browser.eval('window.__frames?.() ?? 0')) || 0;
const t0 = Date.now();
let last = 0, steady = 0;
while ((Date.now() - t0) / 1000 < wait) {
  await new Promise((r) => setTimeout(r, 5000));
  const f = await frames();
  const rate = (f - last) / 5; last = f;
  console.log(`[profile] t=${((Date.now() - t0) / 1000).toFixed(0)}s frames=${f} (${rate.toFixed(1)}/s)`);
  if (f > minFrames && (Date.now()-t0)/1000 >= warmup && ++steady >= 3) break;
}
const worker = [...browser.sessions].find(([, t]) => /guest-worker/.test(t.url))?.[0];
if (!worker) { console.log('[profile] no guest worker session'); await done(1); }
await browser.send('Profiler.enable', {}, worker);
await browser.send('Profiler.setSamplingInterval', { interval: 200 }, worker);
const f0 = await frames();
const command = arg('console');
if (command) console.log('[profile] console:', await browser.eval(`(()=>{const f=[...document.querySelectorAll('iframe')].find(f=>{try{return typeof f.contentWindow.AddServer==='function'}catch{return false}});if(!f)return 'no menu';f.contentWindow.lua.Run('RunConsoleCommand(%s)', ${JSON.stringify(command)});return 'sent'})()`));
await browser.send('Profiler.start', {}, worker);
await new Promise((r) => setTimeout(r, seconds * 1000));
const { profile: prof } = await browser.send('Profiler.stop', {}, worker);
const f1 = await frames();
fs.mkdirSync('run', { recursive: true });
fs.writeFileSync(output+'.cpuprofile', JSON.stringify(prof));
await browser.screenshot(output+'-shot.png').catch(() => {});
console.log('[profile] frame timing:',JSON.stringify(await browser.eval('window.__frameStats ?? null')));
console.log('[profile] render thread ms/frame:',JSON.stringify(await browser.eval('window.__renderMs ?? null')),'stats:',JSON.stringify(await browser.eval('window.__renderStats ?? null')));

// Self time per node, from sample counts weighted by the time deltas.
const self = new Map();
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
for (let i = 0; i < prof.samples.length; i++) {
  const id = prof.samples[i], dt = prof.timeDeltas[i + 1] ?? 0;
  self.set(id, (self.get(id) ?? 0) + dt);
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const groups = new Map(), fns = new Map();
const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
for (const [id, us] of self) {
  const cf = byId.get(id).callFrame;
  const file = cf.url.replace(/^.*\//, '');
  const dll = /\.(c\d+|core)\.wasm/.test(file) || /wasm-function/.test(cf.functionName) ? 'wasm ' + (file.replace(/\.(c\d+|core)\.wasm.*$/, '') || '?') : (file || `(${cf.functionName || 'native'})`);
  add(groups, dll, us);
  if (!/^wasm /.test(dll)) add(fns, `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`, us);
  else add(fns, `${dll} ${cf.functionName}`, us);
}
const pct = (us) => `${(100 * us / total).toFixed(1).padStart(5)}%`;
console.log(`\n[profile] ${seconds}s, ${f1 - f0} frames (${((f1 - f0) / seconds).toFixed(1)} fps), ${(total / 1e3).toFixed(0)} ms sampled`);
console.log('--- by module ---');
for (const [k, v] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(pct(v), k);
console.log('--- top functions ---');
for (const [k, v] of [...fns].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(pct(v), k);
await done(0);
