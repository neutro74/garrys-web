#!/usr/bin/env node
// Installing a map from the main menu, and the map loading screen's Cancel:
//   1. base game, main menu; Addons -> "Install addon from file…" with a map addon (gm_flatgrass under a new name)
//   2. the page says it shows after a restart and offers "Restart now"; after the restart the map is in the map list
//   3. start a map and press the loading dialog's Cancel (CANCEL_AT=x,y in game pixels; screenshots show where it is)
//   node tools/test-map-install.mjs [--out run/map-install]
// One capped browser (tools/lib/browser.mjs); the game is ~3 GB.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/browser.mjs';
import { writeGma } from '../ports/gmod/compat/addons.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(arg('out', 'run/map-install')); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const profile = path.resolve('run/map-install-profile'); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const MAP = 'gm_wasmtest';
const gmaFile = path.join(out, `${MAP}.gma`);
const bsp = fs.readFileSync(path.join(repo, 'dist/gmod-web-v46/game/garrysmod/maps/gm_flatgrass.bsp'));
fs.writeFileSync(gmaFile, writeGma({ name: 'Map Test', description: '{"description":"","type":"map","tags":["build"]}', files: new Map([[`maps/${MAP}.bsp`, bsp]]) }));

const port = 8100 + Math.floor(Math.random() * 500);
const server = spawn('node', [path.join(repo, 'web/server.mjs'), '--port', String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 1500));
const browser = await launch({ width: 1280, height: 720, profile });
const done = async (code) => { await browser.close().catch(() => {}); server.kill(); process.exit(code); };
const fail = async (msg) => { console.log(`FAIL ${msg}`); await shot('fail'); await done(1); };
let step = 0;
const shot = (name) => browser.screenshot(path.join(out, `${String(++step).padStart(2, '0')}-${name}.png`)).catch(() => {});
browser.on('Runtime.exceptionThrown', (p) => console.log(`[page] exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300)}`));
await browser.send('Page.setInterceptFileChooserDialog', { enabled: true });
let chooser = null;
browser.on('Page.fileChooserOpened', (p) => { chooser = p; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MENU = `[...document.querySelectorAll('iframe')].map(f=>{try{return f.contentWindow}catch{return null}}).find(w=>w?.angular&&w.document.querySelector('[ng-view],.ng-scope'))`;
const until = async (expr, seconds) => { for (let t = 0; t < seconds; t += 2) { const v = await browser.eval(expr).catch(() => null); if (v) return v; await sleep(2000); } return null; };
const gesture = (expression) => browser.send('Runtime.evaluate', { expression, userGesture: true, awaitPromise: true, returnByValue: true });
const dataFile = (name) => `(async()=>{try{let d=await (await navigator.storage.getDirectory()).getDirectoryHandle('garrys-wasm');for(const p of ['overlay','garrysmod','data'])d=await d.getDirectoryHandle(p);return await (await (await d.getFileHandle('${name}')).getFile()).text();}catch{return null}})()`;
const menuLua = (code) => browser.eval(`(${MENU}).lua.Run(${JSON.stringify(code)})`);
const MARK = 'maptest_' + Date.now().toString(36);
const luaAsk = async (name, code, seconds = 20) => { await menuLua(`file.Write("${MARK}_${name}.txt", tostring(${code}))`).catch(() => {}); return until(dataFile(`${MARK}_${name}.txt`), seconds); };

if (process.env.TEST_LOG) browser.on('Runtime.consoleAPICalled', (p) => { const t = p.args.map((a) => a.value ?? a.description).join(' '); if (new RegExp(process.env.TEST_LOG, 'i').test(t)) console.log(`[page] ${t.slice(0, 240)}`); });
await browser.goto(`http://127.0.0.1:${port}/?edition=base${process.env.QUERY ? '&' + process.env.QUERY : ''}`);
if (!await until(`!!(${MENU})`, 300)) await fail('main menu did not come up');
console.log('main menu up');
await sleep(4000);

// 1. Install the map from the main menu.
await browser.eval(`(${MENU}).location.hash = '#/addons/'`);
if (!await until(`[...(${MENU}).document.querySelectorAll('a')].some(a=>a.textContent.startsWith('Install addon from file'))`, 30)) await fail('no install link');
chooser = null;
await gesture(`[...(${MENU}).document.querySelectorAll('a')].find(a=>a.textContent.startsWith('Install addon from file')).click()`);
for (let i = 0; i < 20 && !chooser; i++) await sleep(250);
if (!chooser) await fail('file chooser did not open');
await browser.send('DOM.setFileInputFiles', { files: [gmaFile], backendNodeId: chooser.backendNodeId });
const said = await until(`(()=>{const t=[...(${MENU}).document.querySelectorAll('.wasm-note')].map(n=>n.textContent).join('|');return /Installed|Could not/.test(t)&&t})()`, 60);
console.log(`addons page says: ${said}`);
if (!/Start New Game/i.test(said ?? '')) await fail('no map notice');
console.log('right after install, addons/file-gm-wasmtest.gma visible to the game:', await luaAsk('vis', `file.Exists("addons/file-gm-wasmtest.gma", "GAME")`), 'listed:', await luaAsk('visl', `table.concat(select(1, file.Find("addons/*.gma", "GAME")) or {}, ",")`));
// No restart: the engine mounts it (Steam layer subscriptions + steamworks.ApplyAddons) and the map list refreshes.
let now = null;
for (let i = 0; i < 10 && now !== 'true'; i++) { await sleep(2000); now = await luaAsk('now' + i, `file.Exists("maps/${MAP}.bsp", "GAME")`, 10); }
const nowListed = await luaAsk('nowlist', `string.find(util.TableToJSON(GetMapList() or {}) or "", "${MAP}", 1, true) ~= nil`);
console.log(`without a restart: file ${now}, in GetMapList ${nowListed}`);
console.log('engine.GetAddons:', await luaAsk('getaddons0', `(function() local t = {} for _, a in ipairs(engine.GetAddons()) do t[#t + 1] = (a.title or "?") .. "/" .. tostring(a.mounted) .. "/" .. tostring(a.file) .. "/" .. tostring(a.wsid) end return table.concat(t, ";") end)()`));
await browser.eval(`(${MENU}).location.hash = '#/'`).catch(() => {});
await shot('installed');
if (now !== 'true' || nowListed !== 'true') console.log('NOT LISTED without a restart (going on to the restart check)');

// 2. After a restart it is mounted at start as well.
await browser.eval(`(async () => { sessionStorage.setItem('garrys-wasm.resume', JSON.stringify({ edition: 'base' })); location.reload(); })()`);
await sleep(5000);
if (!await until(`!!(${MENU})`, 300)) await fail('main menu did not come back after the restart');
await sleep(6000);
const exists = await luaAsk('after', `file.Exists("maps/${MAP}.bsp", "GAME")`);
const listed = await luaAsk('list', `string.find(util.TableToJSON(GetMapList() or {}) or "", "${MAP}", 1, true) ~= nil`);
console.log(`after restart: file ${exists}, in GetMapList ${listed}`);
console.log('launch addons (page):', await browser.eval(`import('/web/library.js').then((m) => JSON.stringify({ launch: m.launchAddons(null), meta: Object.fromEntries(Object.entries(m.libraryMeta()).map(([k, v]) => [k, { global: v.global, size: v.size }])) }))`).catch((e) => e.message));
console.log('addons dir:', await luaAsk('addons', `table.concat(select(1, file.Find("addons/*", "GAME")) or {}, ",")`));
console.log('engine.GetAddons:', await luaAsk('getaddons', `(function() local t = {} for _, a in ipairs(engine.GetAddons()) do t[#t + 1] = (a.title or "?") .. "/" .. tostring(a.mounted) .. "/" .. tostring(a.file) end return table.concat(t, ";") end)()`));
console.log('maps (GAME):', await luaAsk('maps', `table.concat(select(1, file.Find("maps/gm_*.bsp", "GAME")) or {}, ",")`));
console.log('menu MountGMA:', await luaAsk('mountgma', `game and game.MountGMA ~= nil`));
console.log('cache copy:', await luaAsk('cache', `(function() local f = select(1, file.Find("cache/workshop/*", "GAME")) or {} local t = {} for _, n in ipairs(f) do t[#t + 1] = n .. "=" .. tostring(file.Size("cache/workshop/" .. n, "GAME")) end return table.concat(t, ",") end)()`));
console.log('maps in the addon path:', await luaAsk('addonmaps', `table.concat(select(1, file.Find("maps/*", "Map Test")) or {}, ",")`));
await sleep(20000);
console.log('20 s later, maps (GAME):', await luaAsk('maps2', `table.concat(select(1, file.Find("maps/gm_*.bsp", "GAME")) or {}, ",")`));
if (exists !== 'true') await fail('the map is not mounted after the restart');

// 3. Load a map and watch the loading dialog; press Cancel at CANCEL_AT if given.
await menuLua(`RunConsoleCommand("map", "${MAP}")`);
const t0 = Date.now();
for (let i = 0; i < (process.env.CANCEL_AT ? 2 : 8); i++) { await sleep(1500); await shot(`loading-${i}`); }
if (process.env.CANCEL_AT) {
  const [x, y] = process.env.CANCEL_AT.split(',').map(Number);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) { await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(+(process.env.CLICK_GAP ?? 0)); }
  console.log(`clicked Cancel at ${x},${y} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (let i = 0; i < 6; i++) { await sleep(2500); await shot(`after-cancel-${i}`); }
  console.log(`in game after Cancel: ${await luaAsk('ingame', 'IsInGame()', 30)}`);
}
console.log(`screenshots: ${out}`);
await done(0);
