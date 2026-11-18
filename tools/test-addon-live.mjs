#!/usr/bin/env node
// Does an addon installed while playing work straight away, like Garry's Mod's own Workshop subscriptions?
//   1. base game, gm_construct
//   2. in the map: Addons page -> "Install addon from file…" with a generated .gma (a material + client/server autorun Lua)
//   3. checks, from Lua: the addon's content is visible to the game (file.Exists in GAME), its autorun ran (data files)
//   node tools/test-addon-live.mjs [--headed] [--wait 60]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/browser.mjs';
import { writeGma } from '../ports/gmod/compat/addons.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve('run/addon-live'); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
const profile = path.resolve('run/addon-live-profile'); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
const MARK = 'wasm_live_' + Date.now().toString(36);
const gmaFile = path.join(work, 'live_proof.gma');
fs.writeFileSync(gmaFile, writeGma({
  name: 'Live Proof Addon',
  files: new Map([
    [`materials/${MARK}/test.vmt`, '"UnlitGeneric" { "$basetexture" "color/white" }'],
    [`lua/autorun/server/${MARK}_sv.lua`, `file.Write("${MARK}_server.txt", "server " .. os.time())
timer.Simple(3, function() file.Write("${MARK}_weapon.txt", tostring(weapons.Get("${MARK}_gun") ~= nil)) end)`],
    [`lua/autorun/client/${MARK}_cl.lua`, `file.Write("${MARK}_client.txt", "client " .. os.time())`],
    [`lua/weapons/${MARK}_gun.lua`, `SWEP.PrintName = "Live Proof Gun" SWEP.Spawnable = true SWEP.Base = "weapon_base"`],
  ]),
}));

const port = 8100 + Math.floor(Math.random() * 500);
const server = spawn('node', [path.join(repo, 'web/server.mjs'), '--port', String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 1500));
const browser = await launch({ width: 1280, height: 720, profile, headed: process.argv.includes('--headed') });
const done = async (code) => { await browser.close().catch(() => {}); server.kill(); process.exit(code); };
const fail = async (msg) => { console.log(`FAIL ${msg}`); await done(1); };
browser.on('Runtime.exceptionThrown', (p) => console.log(`[page] exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
if (process.env.TEST_LOG) browser.on('Runtime.consoleAPICalled', (p) => { const t = p.args.map((a) => a.value ?? a.description).join(' '); if (new RegExp(process.env.TEST_LOG).test(t)) console.log(`[page] ${t}`); });
await browser.send('Page.setInterceptFileChooserDialog', { enabled: true });
let chooser = null;
browser.on('Page.fileChooserOpened', (p) => { chooser = p; });
await browser.goto(`http://127.0.0.1:${port}/?edition=base`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MENU = `[...document.querySelectorAll('iframe')].map(f=>{try{return f.contentWindow}catch{return null}}).find(w=>w?.angular&&w.document.querySelector('[ng-view],.ng-scope'))`;
const until = async (what, expr, seconds) => {
  for (let t = 0; t < seconds; t += 2) { const v = await browser.eval(expr).catch(() => null); if (v) return v; await sleep(2000); }
  return null;
};
const gesture = (expression) => browser.send('Runtime.evaluate', { expression, userGesture: true, awaitPromise: true, returnByValue: true });
// A file the game wrote under garrysmod/data, read back from OPFS (the account-less game folder).
const dataFile = (name) => `(async()=>{try{let d=await (await navigator.storage.getDirectory()).getDirectoryHandle('garrys-wasm');for(const p of ['overlay','garrysmod','data'])d=await d.getDirectoryHandle(p);return await (await (await d.getFileHandle('${name}')).getFile()).text();}catch{return null}})()`;
const menuLua = (code) => browser.eval(`(${MENU}).lua.Run(${JSON.stringify(code)})`);

if (!await until('main menu', `!!(${MENU})`, 300)) await fail('main menu did not come up');
console.log('main menu up');
await menuLua('RunConsoleCommand("map", "gm_construct")');
const t0 = Date.now();
// In game: the menu Lua says so through a data file.
let inGame = null;
for (let i = 0; i < 90 && !inGame; i++) {
  await sleep(4000);
  await menuLua(`file.Write("${MARK}_ingame.txt", tostring(IsInGame()))`).catch(() => {});
  inGame = /true/.test(await browser.eval(dataFile(`${MARK}_ingame.txt`)).catch(() => '') ?? '');
}
if (!inGame) await fail('the map did not load');
console.log(`in game after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await sleep(5000);

// Install while playing, from the game's own Addons page.
await browser.eval(`(${MENU}).location.hash = '#/addons/'`);
if (!await until('Install addon link', `[...(${MENU}).document.querySelectorAll('a')].some(a=>a.textContent.startsWith('Install addon from file'))`, 30)) await fail('no install link');
chooser = null;
await gesture(`[...(${MENU}).document.querySelectorAll('a')].find(a=>a.textContent.startsWith('Install addon from file')).click()`);
for (let i = 0; i < 20 && !chooser; i++) await sleep(250);
if (!chooser) await fail('file chooser did not open');
await browser.send('DOM.setFileInputFiles', { files: [gmaFile], backendNodeId: chooser.backendNodeId });
const installed = await until('install status', `(()=>{const t=[...(${MENU}).document.querySelectorAll('.wasm-note')].map(n=>n.textContent).join('|');return /Installed|Could not/.test(t)&&t})()`, 40);
console.log(`addons page says: ${installed}`);
if (!/Installed/.test(installed ?? '')) await fail('addon not installed');
const ti = Date.now();

// Probe (PROBE=1): what the menu's Lua has, and whether mounting through the server's Lua makes the content visible.
if (process.env.PROBE) {
  await menuLua(`file.Write("${MARK}_probe.txt", "menu MountGMA=" .. tostring(game and game.MountGMA ~= nil) .. " exists=" .. tostring(file.Exists("addons/live_proof.gma", "GAME")) .. "/" .. tostring(file.Exists("addons/live_proof.gma", "MOD")))`);
  console.log('probe:', await until('probe', dataFile(`${MARK}_probe.txt`), 20));
  await menuLua(`local f, d = file.Find("addons/*", "GAME") local f2 = file.Find("addons/*", "BASE_PATH") file.Write("${MARK}_find.txt", "GAME files=" .. table.concat(f or {}, ",") .. " dirs=" .. table.concat(d or {}, ",") .. " | BASE=" .. table.concat(f2 or {}, ",") .. " | data=" .. tostring(file.Exists("data/${MARK}_probe.txt", "GAME")))`);
  console.log('find:', await until('find', dataFile(`${MARK}_find.txt`), 20));
  await menuLua(`RunConsoleCommand("lua_run", 'file.Write("${MARK}_luarun.txt", "server lua_run ok")')`);
  console.log('lua_run:', await until('lua_run', dataFile(`${MARK}_luarun.txt`), 15));
  await menuLua(`RunConsoleCommand("lua_run", 'local ok, files = game.MountGMA("addons/live_proof.gma") file.Write("${MARK}_svmount.txt", tostring(ok) .. " " .. tostring(files and #files))')`);
  console.log('server mount:', await until('server mount', dataFile(`${MARK}_svmount.txt`), 20));
}
if (process.env.PROBE2) {
  const opfsRead = (parts) => browser.eval(`(async()=>{try{let d=await (await navigator.storage.getDirectory()).getDirectoryHandle('garrys-wasm');const p=${JSON.stringify(parts)};const last=p.pop();for(const x of p)d=await d.getDirectoryHandle(x);return (await (await d.getFileHandle(last)).getFile()).text().then(t=>t.slice(0,120));}catch(e){return 'ERR '+e.name}})()`);
  console.log('lua file in OPFS:', await opfsRead(['overlay', 'garrysmod', 'lua', 'autorun', 'garrysweb_live_addons.lua']));
  console.log('mount.txt in OPFS:', await opfsRead(['overlay', 'garrysmod', 'data', 'garrysweb', 'mount.txt']));
  await menuLua(`file.Write("${MARK}_luafile.txt", tostring(file.Exists("lua/autorun/garrysweb_live_addons.lua", "GAME")) .. " " .. tostring(file.Exists("autorun/garrysweb_live_addons.lua", "LUA")) .. " mount=" .. tostring(file.Read("garrysweb/mount.txt", "DATA")))`);
  console.log('game sees:', await until('luafile', dataFile(`${MARK}_luafile.txt`), 15));
}
console.log('live mount (server):', await until('live server', dataFile('garrysweb/live_server.txt').replace("for(const p of ['overlay','garrysmod','data'])", "for(const p of ['overlay','garrysmod','data','garrysweb'])").replace("getFileHandle('garrysweb/live_server.txt')", "getFileHandle('live_server.txt')"), 20));
console.log('live mount (client):', await until('live client', dataFile('garrysweb/live_client.txt').replace("for(const p of ['overlay','garrysmod','data'])", "for(const p of ['overlay','garrysmod','data','garrysweb'])").replace("getFileHandle('garrysweb/live_client.txt')", "getFileHandle('live_client.txt')"), 10));
// What works now, without changing map.
const waitSec = +arg('wait', 30);
await sleep(3000);
await menuLua(`file.Write("${MARK}_content.txt", tostring(file.Exists("materials/${MARK}/test.vmt", "GAME")))`);
const content = await until('content check', dataFile(`${MARK}_content.txt`), 20);
console.log(`content visible to the game: ${content}`);
const sv = await until('server autorun', dataFile(`${MARK}_server.txt`), waitSec);
const cl = await until('client autorun', dataFile(`${MARK}_client.txt`), 10);
console.log(`server autorun ran: ${!!sv}${sv ? ` (${((Date.now() - ti) / 1000).toFixed(0)} s after install)` : ''}`);
console.log(`client autorun ran: ${!!cl}`);
const weapon = await until('weapon registered', dataFile(`${MARK}_weapon.txt`), 15);
console.log(`its weapon is registered: ${weapon}`);
let ws = true;
// WS=<id>: also a real Workshop item, downloaded through the hub's service, from "Install from Workshop link…".
if (process.env.WS) {
  await browser.eval(`[...(${MENU}).document.querySelectorAll('a')].find(a=>a.textContent.startsWith('Install from Workshop link')).click()`);
  if (!await until('link dialog', `!!(${MENU}).document.querySelector('.dk-modal input')`, 15)) await fail('no Workshop link dialog');
  await browser.eval(`(()=>{const d=(${MENU}).document, i=d.querySelector('.dk-modal input'); i.value='https://steamcommunity.com/sharedfiles/filedetails/?id=${process.env.WS}'; d.querySelector('.dk-modal form').requestSubmit(); return 1})()`);
  const st = await until('workshop install', `(()=>{const t=[...(${MENU}).document.querySelectorAll('.wasm-note')].map(n=>n.textContent).join('|');return /Installed .*ready|: (?!.*(fetching|downloading|waiting|installing))/.test(t)&&t})()`, 240);
  console.log(`Workshop install says: ${st}`);
  const live = await until('workshop live mount', `(async()=>{const t=await ${dataFile('garrysweb/live_server.txt').replace("for(const p of ['overlay','garrysmod','data'])", "for(const p of ['overlay','garrysmod','data','garrysweb'])").replace("getFileHandle('garrysweb/live_server.txt')", "getFileHandle('live_server.txt')")};return t&&t.includes('${process.env.WS}')&&t})()`, 30);
  console.log(`Workshop item mounted live: ${live}`);
  ws = !!live;
}
await browser.screenshot(path.join(work, 'after-install.png'));
const ok = content === 'true' && sv && cl && weapon === 'true' && ws;
console.log(ok ? 'ALL PASS' : 'NOT INSTANT');
await done(ok ? 0 : 2);
