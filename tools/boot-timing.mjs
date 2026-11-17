#!/usr/bin/env node
// How long the game takes to start, stage by stage: every boot status line with the time it appeared, up to the first frame.
//   WEB_GPU=1 node tools/boot-timing.mjs [--cold] [--query "edition=base"] [--timeout 600]
// --cold uses a fresh browser profile (no compiled-wasm cache, nothing downloaded); otherwise run/boot-profile is reused.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const cold = process.argv.includes('--cold'), query = arg('query', 'edition=base'), limit = +arg('timeout', 600);
// --cdn dist/cdn-clean: a CDN package (service worker, hashed parts) served as plain files, as the CDN does; its page is web/index.html.
const cdnDir = arg('cdn', null), page = cdnDir ? 'web/index.html' : '';
// Chromebook-like: BROWSER_CPUS=0,2 BROWSER_CPU_QUOTA=77% BROWSER_MEM=2560M (tools/lib/browser.mjs; see tools/bench-chromebook.sh).
// A repeat visit needs the same origin (port) and profile as the first, or its caches start empty: --port and --profile.
const port = +arg('port', 0) || 8600 + Math.floor(Math.random() * 300);
const profile = path.resolve(cold ? `run/boot-profile-cold-${process.pid}` : arg('profile', 'run/boot-profile'));
if (cold) fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const server = cdnDir
  ? spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', path.resolve(cdnDir)], { stdio: ['ignore', 'ignore', 'ignore'] })
  : spawn('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), '../web/server.mjs'), '--port', String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise((r) => setTimeout(r, 1500));
const browser = await launch({ width: 1280, height: 720, gpu: process.env.WEB_GPU === '1', profile });
const t0 = Date.now(), marks = [];
const stamp = (s) => { const t = (Date.now() - t0) / 1000; marks.push([t, s]); console.log(`${t.toFixed(1).padStart(6)}s  ${s}`); };
browser.on('Runtime.consoleAPICalled', (p) => {
  const text = p.args.map((a) => a.value ?? a.description).join(' ');
  if (text.startsWith('[status] ')) stamp(text.slice(9));
});
const finish = async (code) => { await browser.close().catch(() => {}); server.kill(); if (cold) { await new Promise((r) => setTimeout(r, 1500)); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { console.log(`(left ${profile})`); } } process.exit(code); };
browser.on('Inspector.targetCrashed', () => { stamp('PAGE CRASHED'); finish(2); });
await browser.goto(`http://127.0.0.1:${port}/${page}?${query}`);
for (;;) {
  await new Promise((r) => setTimeout(r, 250));
  const frames = await browser.eval('window.__frames?.() ?? 0').catch(() => 0);
  if (frames > 0 && !marks.some(([, s]) => s === 'first frame')) stamp('first frame');
  // The main menu is GMod's HTML page (menu.html); it is usable once that panel has loaded.
  const menu = await browser.eval("JSON.stringify((window.__panels?.() ?? []).filter(p => /menu/.test(p.url) && p.loaded).length)").catch(() => '0');
  if (+menu > 0) { stamp('main menu loaded'); break; }
  if ((Date.now() - t0) / 1000 > limit) { stamp('timed out'); await finish(1); }
}
// Stage totals: the time from each status line to the next.
const stages = new Map();
for (let i = 0; i < marks.length - 1; i++) {
  const key = marks[i][1].replace(/ \(\d+\/\d+\)$/, '').replace(/^Loading .*\.\.\.$/, 'Loading modules').replace(/^Initializing .*/, 'Initializing modules');
  stages.set(key, (stages.get(key) ?? 0) + marks[i + 1][0] - marks[i][0]);
}
console.log('\nBy stage:');
for (const [k, v] of [...stages].sort((a, b) => b[1] - a[1])) console.log(`${v.toFixed(1).padStart(7)}s  ${k}`);
await finish(0);
