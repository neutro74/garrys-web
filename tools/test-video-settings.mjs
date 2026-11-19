#!/usr/bin/env node
// Graphics settings across starts: the first start and every later one must be on the launcher's quality (Low by
// default, web/game-settings.js). The engine keeps part of its video settings only in the registry, which the browser
// build does not keep, so a later start used to get the engine's high defaults for the GPU.
//   node tools/test-video-settings.mjs [--out run/video-settings]
// One capped browser (tools/lib/browser.mjs); the base game.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(arg('out', 'run/video-settings')); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const profile = path.resolve('run/video-settings-profile'); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const port = 8100 + Math.floor(Math.random() * 500);
const server = spawn('node', [path.join(repo, 'web/server.mjs'), '--port', String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 1500));
const browser = await launch({ width: 1280, height: 720, profile });
const done = async (code) => { await browser.close().catch(() => {}); server.kill(); process.exit(code); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MENU = `[...document.querySelectorAll('iframe')].map(f=>{try{return f.contentWindow}catch{return null}}).find(w=>w?.angular&&w.document.querySelector('[ng-view],.ng-scope'))`;
const until = async (expr, seconds) => { for (let t = 0; t < seconds; t += 2) { const v = await browser.eval(expr).catch(() => null); if (v) return v; await sleep(2000); } return null; };
const dataFile = (name) => `(async()=>{try{let d=await (await navigator.storage.getDirectory()).getDirectoryHandle('garrys-wasm');for(const p of ['overlay','garrysmod','data'])d=await d.getDirectoryHandle(p);return await (await (await d.getFileHandle('${name}')).getFile()).text();}catch{return null}})()`;
const MARK = 'video_' + Date.now().toString(36);
let n = 0;
const luaAsk = async (code) => { const f = `${MARK}_${n++}.txt`; await browser.eval(`(${MENU}).lua.Run(${JSON.stringify(`file.Write("${f}", tostring(${code}))`)})`).catch(() => {}); return until(dataFile(f), 20); };
const CVARS = ['mat_picmip', 'r_rootlod', 'mat_antialias', 'mat_forceaniso', 'mat_hdr_level', 'r_waterforceexpensive', 'mat_reducefillrate', 'r_shadowrendertotexture', 'mat_specular'];
const read = async () => JSON.parse(await luaAsk(`util.TableToJSON({ ${CVARS.map((c) => `${c} = GetConVarNumber("${c}")`).join(', ')} })`) ?? 'null');
// The lowest choices of Options -> Video -> Advanced.
const LOWEST = { mat_picmip: 2, r_rootlod: 2, mat_antialias: 0, mat_forceaniso: 1, mat_hdr_level: 0, r_waterforceexpensive: 0, mat_reducefillrate: 1, r_shadowrendertotexture: 0, mat_specular: 0 };
const bad = (v) => Object.entries(LOWEST).filter(([k, x]) => v?.[k] !== x).map(([k, x]) => `${k}=${v?.[k]} (want ${x})`);

let failed = false;
for (const start of ['first', 'second']) {
  if (start === 'first') await browser.goto(`http://127.0.0.1:${port}/?edition=base`);
  else { await browser.eval(`sessionStorage.setItem('garrys-wasm.resume', JSON.stringify({ edition: 'base' })); location.reload(); true`); await sleep(5000); }
  if (!await until(`!!(${MENU})`, 300)) { console.log(`FAIL ${start} start: no main menu`); await done(1); }
  await sleep(8000);
  const v = await read();
  console.log(`${start} start:`, JSON.stringify(v));
  const wrong = bad(v);
  if (wrong.length) { failed = true; console.log(`  NOT LOW: ${wrong.join(', ')}`); }
  await browser.screenshot(path.join(out, `${start}.png`)).catch(() => {});
  if (start === 'first') { await luaAsk(`(function() RunConsoleCommand("host_writeconfig") return true end)()`); await sleep(3000); }
}
console.log(failed ? 'FAIL' : 'PASS: low on the first start and after a restart');
await done(failed ? 1 : 0);
