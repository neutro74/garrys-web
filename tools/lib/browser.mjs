// Chromium (headless unless asked) over the DevTools protocol: enough to open a page, read its console and
// take screenshots.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Browsers this process started, closed when it ends however it ends: each runs in its own systemd scope, so one left behind
// by a script stopped with Ctrl+C or `timeout` would otherwise keep running (and keep its memory) indefinitely.
const live = new Map();   // child process -> temporary profile dir (or null)
function killAll() {
  for (const [proc, dir] of live) { try { proc.kill('SIGKILL'); } catch { /* gone */ } if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* busy */ } }
  live.clear();
}
let hooked = false;
function hookExit() {
  if (hooked) return; hooked = true;
  process.on('exit', killAll);
  for (const [sig, n] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) process.on(sig, () => { killAll(); process.exit(128 + n); });
}
export async function launch({ width = 1280, height = 720, gpu = false, webgpu = false, profile, headed = false } = {}) {
  const dir = profile ?? fs.mkdtempSync(path.join(os.tmpdir(), 'gamebox-chrome-'));
  // A killed Chromium leaves its singleton lock behind and the next launch refuses the profile.
  if (profile) for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(path.join(dir, f), { force: true });
  const args = [
    ...(headed ? [] : ['--headless=new']),
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    ...(gpu || webgpu ? ['--enable-gpu'] : ['--use-angle=swiftshader']),
    ...(webgpu ? ['--enable-unsafe-webgpu'] : []),
    ...(process.env.BROWSER_ARGS ? process.env.BROWSER_ARGS.split(' ') : []),
    'about:blank',
  ];
  // Each test browser gets its own systemd scope with a memory cap, so running out of memory kills the test, not
  // the unit that launched it (from an editor tunnel that is the whole tunnel). BROWSER_MEM sets the cap (default
  // 4G); BROWSER_NO_SCOPE=1 runs it directly (e.g. inside a scope the caller already limits).
  const scoped = !process.env.BROWSER_NO_SCOPE && fs.existsSync('/usr/bin/systemd-run');
  const executable = process.env.BROWSER_CPUS ? ['taskset', '-c', process.env.BROWSER_CPUS, 'chromium-browser'] : ['chromium-browser'];
  const quota = process.env.BROWSER_CPU_QUOTA ? ['-p', `CPUQuota=${process.env.BROWSER_CPU_QUOTA}`] : [];
  const proc = scoped
    ? spawn('systemd-run', ['--user', '--scope', '--quiet', '-p', `MemoryMax=${process.env.BROWSER_MEM || '4G'}`, '-p', `MemorySwapMax=${process.env.BROWSER_CPU_QUOTA ? '0' : '512M'}`, ...quota, '--', ...executable, ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    : spawn(executable[0], [...executable.slice(1), ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  hookExit(); live.set(proc, profile ? null : dir);
  proc.on('exit', () => live.delete(proc));
  const wsUrl = await new Promise((resolve, reject) => {
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\S+)/);
      if (m) resolve(m[1]);
    });
    proc.on('exit', (code) => reject(new Error(`chromium exited ${code}: ${err.slice(-2000)}`)));
  });
  // BROWSER_STDERR=1 forwards Chromium's own log (crash and out-of-memory reasons end up there).
  if (process.env.BROWSER_STDERR) proc.stderr.on('data', (d) => process.stderr.write(`[chromium-stderr] ${d}`));
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);

  await send('Page.enable');
  await send('Runtime.enable');
  // Workers (the engine runs in pthreads) report their console through attached sessions.
  const sessions = new Map();   // sessionId -> target info, for per-worker queries
  on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    sessions.set(sessionId, targetInfo);
    if (targetInfo.type === 'worker') send('Runtime.enable', {}, sessionId).catch(() => {});
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
    send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
  });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  on('Target.detachedFromTarget', ({ sessionId }) => sessions.delete(sessionId));

  return {
    send,
    on,
    sessions,
    // JS heap in use per isolate: [{ url, usedMB }], the page first.
    async heaps() {
      const out = [];
      const page = await send('Runtime.getHeapUsage').catch(() => null);
      if (page) out.push({ url: 'page', usedMB: page.usedSize / 1048576 });
      for (const [id, t] of sessions) {
        const h = await send('Runtime.getHeapUsage', {}, id).catch(() => null);
        if (h) out.push({ url: t.url.replace(/^.*\//, ''), usedMB: h.usedSize / 1048576 });
      }
      return out;
    },
    async goto(url) {
      await send('Page.navigate', { url });
    },
    async screenshot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return r.result.value;
    },
    async close() {
      try { ws.close(); } catch {}
      proc.kill('SIGTERM');
      await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
      if (!profile) try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    },
  };
}
