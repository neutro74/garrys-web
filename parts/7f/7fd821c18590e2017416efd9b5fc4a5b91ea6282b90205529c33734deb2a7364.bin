// Admin panel (hub/admin.mjs): the launcher's Admin tab, shown only to admin accounts, drawn in Derma like the rest of the
// launcher. Sections for players, bans and mutes, chat, games, accounts, the hub itself, a terminal on the Pi, and the audit
// log. A signed-in admin account gets its admin session from the hub straight away (no code).
//   mountAdmin(el) -> { visible(on), destroy() }
import { hubHttp } from './library.js';
import { hubUrl } from './hub.js';
import { account, authHeaders } from './account.js';
import { loadEmotes } from './emote-picker.js';
import { icon } from './derma.js';
import { dkConfirm } from './modal.js';

const KEY = 'garrys-wasm.admin-token';
const ss = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* blocked */ } } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ago = (t) => { if (!t) return '—'; const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${s | 0}s ago` : s < 3600 ? `${(s / 60) | 0}m ago` : s < 86400 ? `${(s / 3600) | 0}h ago` : `${(s / 86400) | 0}d ago`; };
const when = (t) => (t ? new Date(t).toLocaleString() : 'never');
const size = (b) => (b > 1 << 30 ? `${(b / 2 ** 30).toFixed(1)} GB` : `${(b / 2 ** 20).toFixed(0)} MB`);
const dur = (s) => { s = s | 0; const d = (s / 86400) | 0, h = ((s % 86400) / 3600) | 0, m = ((s % 3600) / 60) | 0; return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };

async function api(path, { method = 'GET', body, admin = true } = {}) {
  const base = hubHttp(), a = account();
  const headers = { 'Content-Type': 'application/json' };
  if (a) Object.assign(headers, { Authorization: `Bearer ${a.token}`, 'X-User': a.user });
  if (admin && ss.get()) headers['X-Admin'] = ss.get();
  const r = await fetch(base + 'admin/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && admin) ss.set(null);
  if (!r.ok) throw Object.assign(Error(j.error ?? `Error ${r.status}`), { status: r.status });
  return j;
}
// Is the signed-in account an admin? (The launcher asks once to decide whether to show the entry.)
export async function isAdmin() {
  if (!hubHttp() || !account()) return false;
  try { return (await api('whoami', { admin: false })).admin; } catch { return false; }
}

const TABS = [['players', 'Players', 'group'], ['bans', 'Bans & mutes', 'delete'], ['chat', 'Chat', 'comments'], ['games', 'Games', 'controller'], ['accounts', 'Accounts', 'user'], ['emotes', 'Emojis & stickers', 'emoticon_smile'], ['hub', 'Hub', 'server'], ['term', 'Terminal', 'application_xp_terminal'], ['audit', 'Audit log', 'page_white_text']];
const DURATIONS = [['60', '1 hour'], ['1440', '1 day'], ['10080', '7 days'], ['43200', '30 days'], ['0', 'Forever']];

export function mountAdmin(el) {
  const ov = el;
  ov.innerHTML = `<div class="adm">
    <div class="adm-nav">${TABS.map(([k, l, ic]) => `<button type="button" class="dk-btn" data-tab="${k}"><img class="si" src="${icon(ic)}" alt="">${l}</button>`).join('')}<span class="adm-who dk-onGrey" data-who></span></div>
    <div class="adm-err" data-err hidden></div><div class="dk-panel adm-body" data-body></div></div>`;
  const $ = (q) => ov.querySelector(q), body = $('[data-body]');
  let tab = 'players', st = null, timer = null, term = null, shown = true, retried = false;
  for (const b of ov.querySelectorAll('[data-tab]')) b.onclick = () => { if (tab === 'term' && b.dataset.tab !== 'term') { term?.dispose(); term = null; } tab = b.dataset.tab; draw(); };
  $('[data-who]').textContent = account() ? `Signed in as ${account().user}` : '';

  // The hub hands a signed-in admin account its session; a session it no longer knows is replaced once.
  async function unlock() {
    body.textContent = 'Opening…';
    try { const r = await api('unlock', { method: 'POST', body: {}, admin: false }); ss.set(r.token); start(); }
    catch (e) { body.textContent = e.message; }
  }
  const unlockScreen = (msg) => { ss.set(null); if (!retried) { retried = true; unlock(); } else body.textContent = msg ?? 'The admin session ended.'; };
  async function refresh() {
    try { st = await api('state'); } catch (e) { if (e.status === 401) return unlockScreen(e.message); throw e; }
    retried = false;
    if (tab !== 'term' && tab !== 'emotes') draw();
  }
  function start() {
    refresh().catch((e) => { body.textContent = e.message; });
    clearInterval(timer); timer = setInterval(() => { if (shown && tab !== 'term' && !ov.querySelector('.adm-veil') && !(ov.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) && document.visibilityState === 'visible') refresh().catch(() => {}); }, 5000);
  }
  const errEl = $('[data-err]');
  const showErr = (m) => { errEl.textContent = m; errEl.hidden = !m; };
  const act = async (name, payload, after) => {
    showErr('');
    try { const r = await api(name, { method: 'POST', body: payload }); after?.(r); await refresh(); }
    catch (e) { if (e.status === 401) unlockScreen(e.message); else showErr(e.message); }
  };

  // Ban or mute someone: pick what to match (browser, address, account), how long and why.
  function dialog(kind, p) {
    const veil = document.createElement('div'); veil.className = 'adm-veil';
    const d = document.createElement('form'); d.className = 'dialog dk-window pop';
    // The hub refuses local and tunnel addresses (everyone behind the tunnel would share them).
    const local = (ip) => /^(127\.|::1$|::ffff:127\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|10\.|192\.168\.|fd7a:)/.test(ip ?? '');
    // An address many different browsers come from (a school, a VPN, or the tunnel itself) is left unticked: banning it
    // would also ban everyone else there.
    const sharers = (ip) => new Set([...st.online, ...st.recent].filter((x) => x.ip === ip).map((x) => x.device ?? x.id)).size;
    const opt = (k, label, v) => (!v ? '' : k === 'ip' && local(v) ? `<label class="off"><input type="checkbox" disabled> ${label} <code>${esc(v)}</code> <small>(local address, cannot be banned)</small></label>`
      : k === 'ip' && sharers(v) > 3 ? `<label><input type="checkbox" data-t="${k}"> ${label} <code>${esc(v)}</code> <small class="warn">shared by ${sharers(v)} browsers: banning it bans them all</small></label>`
      : `<label><input type="checkbox" data-t="${k}" checked> ${label} <code>${esc(v)}</code></label>`);
    d.innerHTML = `<div class="dk-title"><img class="si" src="${icon(kind === 'ban' ? 'delete' : 'sound_mute')}" alt="">${kind === 'ban' ? 'Ban' : 'Mute'} ${esc(p.name ?? p.account ?? p.ip ?? '')}<span class="dk-tinfo"></span><button type="button" class="dk-wbtn close" data-cancel aria-label="Cancel"></button></div><div class="dk-panel">
      <div class="opts">${opt('device', 'This browser', p.device)}${opt('ip', 'Internet address', p.ip)}${opt('account', 'Account', p.account)}</div>
      <label>For <select data-min>${DURATIONS.map(([v, l]) => `<option value="${v}" ${v === (kind === 'ban' ? '0' : '60') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Reason <input data-reason maxlength="200" placeholder="Shown to them"></label>
      <div class="row"><button class="btn-primary">${kind === 'ban' ? 'Ban' : 'Mute'}</button><button type="button" class="btn" data-cancel>Cancel</button></div>
      <p class="hint">${kind === 'ban' ? 'A ban disconnects them and blocks chat, games and the Workshop from what is ticked. Clearing the browser or changing network gets around one part; ticking several helps.' : 'Muted players can stay but cannot chat, message, rename or host.'}</p></div>`;
    veil.append(d); ov.querySelector('.adm').append(veil);
    for (const c of d.querySelectorAll('[data-cancel]')) c.onclick = () => veil.remove();
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) veil.remove(); });
    d.querySelector('[data-reason]').focus();
    d.onsubmit = (ev) => {
      ev.preventDefault();
      const target = {}; for (const c of d.querySelectorAll('[data-t]')) if (c.checked) target[c.dataset.t] = p[c.dataset.t];
      if (!Object.keys(target).length) return;
      act(kind, { target, minutes: +d.querySelector('[data-min]').value, reason: d.querySelector('[data-reason]').value, label: p.name ?? p.account ?? '' }, () => veil.remove());
    };
  }
  const who = (p) => `${esc(p.name ?? '')}${p.account ? ` <span class="acct">@${esc(p.account)}</span>` : ''}`;
  const ids = (p) => `<code title="Browser id">${esc(p.device ?? '—')}</code><br><code title="Address">${esc(p.ip ?? '—')}</code>`;
  const targetText = (e) => [e.device && `browser ${e.device}`, e.ip && `address ${e.ip}`, e.account && `account ${e.account}`].filter(Boolean).join(', ');

  const views = {
    players() {
      const row = (p, live) => `<tr><td>${who(p)}</td><td>${ids(p)}</td><td>${live ? esc(p.rooms.join(', ')) + `<br><small>since ${ago(p.since)}</small>` : `<small>${p.left ? 'left ' + ago(p.left) : 'seen ' + ago(p.last)}</small>`}</td>
        <td class="acts">${live ? `<button class="btn" data-kick="${esc(p.id)}">Kick</button>` : ''}<button class="btn" data-mute="${esc(p.id)}">Mute</button><button class="btn danger" data-ban="${esc(p.id)}">Ban</button></td></tr>`;
      // One row per player (same browser or address and name), the latest session.
      const gone = [], keyOf = (r) => `${r.device ?? r.ip}|${r.name}`, onlineKeys = new Set(st.online.map(keyOf));
      for (const r of st.recent) if (!st.online.some((o) => o.id === r.id) && !onlineKeys.has(keyOf(r)) && !gone.some((g) => keyOf(g) === keyOf(r))) gone.push(r);
      body.innerHTML = `<h3>Online now <small>${st.online.length}</small></h3>
        <table class="grid"><tr><th>Player</th><th>Browser / address</th><th>Rooms</th><th></th></tr>${st.online.map((p) => row(p, true)).join('') || '<tr><td colspan="4" class="none">Nobody is connected.</td></tr>'}</table>
        <h3>Recently seen <small>${gone.length}</small></h3>
        <table class="grid"><tr><th>Player</th><th>Browser / address</th><th>When</th><th></th></tr>${gone.map((p) => row(p, false)).join('') || '<tr><td colspan="4" class="none">No one yet since the hub started.</td></tr>'}</table>`;
      const find = (id) => st.online.find((p) => p.id === id) ?? st.recent.find((p) => p.id === id);
      for (const b of body.querySelectorAll('[data-kick]')) b.onclick = () => act('kick', { id: b.dataset.kick });
      for (const b of body.querySelectorAll('[data-mute]')) b.onclick = () => dialog('mute', find(b.dataset.mute));
      for (const b of body.querySelectorAll('[data-ban]')) b.onclick = () => dialog('ban', find(b.dataset.ban));
    },
    bans() {
      const list = (items, kind) => items.map((e) => `<tr><td><b>${esc(e.label || '—')}</b><br><small>${esc(targetText(e))}</small></td><td>${esc(e.reason || '—')}</td>
        <td><small>${e.until ? 'until ' + when(e.until) : 'forever'}<br>by ${esc(e.by)} ${ago(e.at)}</small></td><td class="acts"><button class="btn" data-un${kind}="${e.id}">${kind === 'ban' ? 'Unban' : 'Unmute'}</button></td></tr>`).join('');
      body.innerHTML = `<h3>Bans <small>${st.bans.length}</small></h3>
        <table class="grid"><tr><th>Who</th><th>Reason</th><th>How long</th><th></th></tr>${list(st.bans, 'ban') || '<tr><td colspan="4" class="none">No bans.</td></tr>'}</table>
        <h3>Mutes <small>${st.mutes.length}</small></h3>
        <table class="grid"><tr><th>Who</th><th>Reason</th><th>How long</th><th></th></tr>${list(st.mutes, 'mute') || '<tr><td colspan="4" class="none">No mutes.</td></tr>'}</table>
        <h3>Ban by hand</h3>
        <form class="inline" data-manual><input data-mv placeholder="Browser id, address or account"><select data-mk><option value="device">Browser id</option><option value="ip">Address</option><option value="account">Account</option></select>
          <button class="btn danger">Ban…</button></form>`;
      for (const b of body.querySelectorAll('[data-unban]')) b.onclick = () => act('unban', { id: b.dataset.unban });
      for (const b of body.querySelectorAll('[data-unmute]')) b.onclick = () => act('unmute', { id: b.dataset.unmute });
      body.querySelector('[data-manual]').onsubmit = (ev) => {
        ev.preventDefault(); const v = body.querySelector('[data-mv]').value.trim(); if (!v) return;
        dialog('ban', { [body.querySelector('[data-mk]').value]: v });
      };
    },
    chat() {
      const room = views.room ?? st.rooms[0].name, r = st.rooms.find((x) => x.name === room);
      body.innerHTML = `<form class="inline" data-ann><input data-text maxlength="400" placeholder="Announcement to everyone online (shown in chat)"><button class="btn-primary">Announce</button></form>
        <div class="row rooms">${st.rooms.map((x) => `<button type="button" class="btn ${x.name === room ? 'on' : ''}" data-room="${x.name}">#${x.name} <small>${x.users}</small></button>`).join('')}
          <button type="button" class="btn danger" data-clear>Clear #${esc(room)}</button></div>
        <div class="msgs">${r.messages.slice().reverse().map((m) => `<div><time>${new Date(m.at).toLocaleString()}</time> <b>${esc(m.from?.name)}</b>${m.from?.account ? ` <span class="acct">@${esc(m.from.account)}</span>` : ''} <span>${esc(m.text)}</span>
          ${m.id ? `<button class="btn mini" data-del="${esc(m.id)}" data-tip="Delete for everyone"><img class="si" src="${icon('delete')}" alt="Delete"></button>` : ''}</div>`).join('') || '<p class="none">No messages.</p>'}</div>`;
      for (const b of body.querySelectorAll('[data-room]')) b.onclick = () => { views.room = b.dataset.room; draw(); };
      for (const b of body.querySelectorAll('[data-del]')) b.onclick = () => act('delete', { room, id: b.dataset.del });
      body.querySelector('[data-clear]').onclick = async () => { if (await dkConfirm(`Hide every message in #${room} for everyone?`, { title: 'Clear channel', ok: 'Clear', danger: true })) act('clear', { room }); };
      body.querySelector('[data-ann]').onsubmit = (ev) => { ev.preventDefault(); const t = body.querySelector('[data-text]'); if (t.value.trim()) act('announce', { text: t.value }, () => { t.value = ''; }); };
    },
    games() {
      body.innerHTML = `<h3>Open games <small>${st.lobbies.length}</small></h3><table class="grid"><tr><th>Game</th><th>Host</th><th>Players</th><th></th></tr>
        ${st.lobbies.map((l) => `<tr><td><b>${esc(l.name)}</b><br><small>${esc(l.edition)} · ${esc(l.map || '?')} · ${esc(l.gamemode || '?')}${l.lan ? ' · LAN' : ''}${l.locked ? ' · password' : ''}</small></td>
          <td>${esc(l.hostName)}${l.hostAccount ? ` <span class="acct">@${esc(l.hostAccount)}</span>` : ''}<br><code>${esc(l.hostDevice ?? '—')}</code> <code>${esc(l.hostIp)}</code></td><td>${l.players}/${l.max}</td>
          <td class="acts"><button class="btn" data-close-lobby="${esc(l.id)}">Close</button><button class="btn danger" data-ban-host="${esc(l.id)}">Ban host</button></td></tr>`).join('') || '<tr><td colspan="4" class="none">No games are open.</td></tr>'}</table>`;
      for (const b of body.querySelectorAll('[data-close-lobby]')) b.onclick = () => act('close-lobby', { id: b.dataset.closeLobby });
      for (const b of body.querySelectorAll('[data-ban-host]')) b.onclick = () => { const l = st.lobbies.find((x) => x.id === b.dataset.banHost); dialog('ban', { name: l.hostName, device: l.hostDevice, ip: l.hostIp, account: l.hostAccount }); };
    },
    accounts() {
      body.innerHTML = `<h3>Accounts <small>${st.accounts.length}</small></h3><table class="grid"><tr><th>Account</th><th>Created</th><th>Last sign-in</th><th>Sessions</th><th></th></tr>
        ${st.accounts.map((a) => `<tr><td><b>${esc(a.user)}</b>${st.admins.includes(a.user) ? ' <small class="badge">admin</small>' : ''}</td><td><small>${when(a.created)}</small></td><td><small>${ago(a.lastLogin)}</small></td><td>${a.sessions}</td>
          <td class="acts"><button class="btn" data-signout="${esc(a.user)}">Sign out everywhere</button>${st.admins.includes(a.user) ? '' : `<button class="btn danger" data-ban-acct="${esc(a.user)}">Ban</button>`}</td></tr>`).join('')}</table>`;
      for (const b of body.querySelectorAll('[data-signout]')) b.onclick = async () => { if (await dkConfirm(`Sign ${b.dataset.signout} out on every device?`, { title: 'Sign out everywhere', ok: 'Sign out' })) act('signout-account', { user: b.dataset.signout }); };
      for (const b of body.querySelectorAll('[data-ban-acct]')) b.onclick = () => dialog('ban', { account: b.dataset.banAcct, name: b.dataset.banAcct });
    },
    hub() {
      const s = st.status;
      body.innerHTML = `<table class="facts">
          <tr><td>Hub running for</td><td>${dur(s.uptime)} <small>since ${when(s.started)}, Node ${esc(s.node)}</small></td></tr>
          <tr><td>Connected</td><td>${s.clients} in chat/lobbies, ${s.relays} game relays, ${s.pairs} paired games, ${s.lobbyCount} open games</td></tr>
          <tr><td>Hub memory</td><td>${size(s.rss)}</td></tr>
          <tr><td>Pi</td><td>load ${s.load.map((x) => x.toFixed(2)).join(' ')} · ${size(s.sysMem.total - s.sysMem.free)} of ${size(s.sysMem.total)} used${s.temp ? ` · ${s.temp.toFixed(1)} °C` : ''} · up ${dur(s.sysUptime)}</td></tr>
        </table>
        <div class="row"><button class="btn danger" data-restart>Restart hub</button><span class="hint">Everyone reconnects by themselves within a few seconds.</span></div>
        <h3>Hub log</h3><pre class="logbox">${st.log.slice().reverse().map((l) => `<span class="${l.level}">${new Date(l.at).toLocaleTimeString()} ${esc(l.text)}</span>`).join('\n') || 'Nothing yet.'}</pre>`;
      body.querySelector('[data-restart]').onclick = async () => { if (await dkConfirm('Restart the hub now? Everyone reconnects by themselves within a few seconds.', { title: 'Restart hub', ok: 'Restart', danger: true })) act('restart', {}, () => setTimeout(refresh, 4000)); };
    },
    // The server's own emojis and stickers (hub/emotes.mjs): everyone can use them in chat.
    async emotes() {
      const { list } = await loadEmotes(true);
      const url = (x) => `${hubHttp()}emotes/img/${x.file}`;
      const grid = (kind) => list.filter((x) => x.kind === kind).map((x) => `<div class="adm-emote ${kind}"><img src="${esc(url(x))}" crossorigin="anonymous" alt=""><b>${kind === 'emoji' ? ':' + esc(x.name) + ':' : esc(x.name)}</b><small>by ${esc(x.by)}</small><button class="btn mini" data-rm-emote="${esc(x.id)}" data-tip="Remove"><img class="si" src="${icon('delete')}" alt="Remove"></button></div>`).join('') || '<p class="none">None yet.</p>';
      body.innerHTML = `<h3>Add an emoji or sticker</h3>
        <form class="inline adm-emote-form" data-add-emote><select data-kind><option value="emoji">Emoji (shows in text as :name:)</option><option value="sticker">Sticker (sent on its own)</option></select>
          <input data-name maxlength="32" placeholder="name (letters, digits, _)" spellcheck="false"><button type="button" class="btn" data-file>Choose picture…</button><button class="btn-primary">Add</button></form>
        <p class="hint" data-emsg>PNG, GIF (animated is fine), WebP or JPEG. Emojis up to 256 KB, stickers up to 1 MB. Square pictures look best.</p>
        <h3>Emojis <small>${list.filter((x) => x.kind === 'emoji').length}</small></h3><div class="adm-emotes">${grid('emoji')}</div>
        <h3>Stickers <small>${list.filter((x) => x.kind === 'sticker').length}</small></h3><div class="adm-emotes">${grid('sticker')}</div>`;
      const form = body.querySelector('[data-add-emote]'), msg = body.querySelector('[data-emsg]'), nameIn = form.querySelector('[data-name]');
      let file = null;
      form.querySelector('[data-file]').onclick = () => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/gif,image/webp,image/jpeg';
        i.onchange = () => { file = i.files[0] ?? null; if (file) { form.querySelector('[data-file]').textContent = file.name.slice(0, 24); if (!nameIn.value) nameIn.value = file.name.replace(/\.[a-z]+$/i, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 32); } };
        i.click();
      };
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        if (!file) { msg.textContent = 'Choose a picture first.'; return; }
        msg.textContent = 'Uploading…';
        try {
          const r = await fetch(`${hubHttp()}emotes?` + new URLSearchParams({ kind: form.querySelector('[data-kind]').value, name: nameIn.value.trim().toLowerCase() }), { method: 'POST', headers: authHeaders(), body: file });
          const j = await r.json().catch(() => ({})); if (!r.ok) throw Error(j.error ?? `Error ${r.status}`);
          draw();
        } catch (e) { msg.textContent = e.message; }
      };
      for (const b of body.querySelectorAll('[data-rm-emote]')) b.onclick = async () => {
        if (!(await dkConfirm('Remove this for everyone? Messages that used it show it as removed.', { title: 'Remove', ok: 'Remove', danger: true }))) return;
        const r = await fetch(`${hubHttp()}emotes/${b.dataset.rmEmote}`, { method: 'DELETE', headers: authHeaders() });
        if (!r.ok) showErr((await r.json().catch(() => ({}))).error ?? `Error ${r.status}`); else draw();
      };
    },
    audit() {
      body.innerHTML = `<h3>Admin actions</h3><table class="grid"><tr><th>When</th><th>Who</th><th>What</th></tr>
        ${st.audit.map((a) => { const { at, who: w, action, ip, ...rest } = a; return `<tr><td><small>${when(at)}</small></td><td>${esc(w)}<br><code>${esc(ip ?? '')}</code></td><td><b>${esc(action)}</b> <small>${esc(Object.keys(rest).length ? JSON.stringify(rest) : '')}</small></td></tr>`; }).join('') || '<tr><td colspan="3" class="none">Nothing yet.</td></tr>'}</table>`;
    },
    async term() {
      if (term) return;
      body.innerHTML = `<div class="termwrap"><div class="termbar"><span data-tstate>Connecting…</span><button class="btn" data-reconnect hidden>Reconnect</button></div><div class="term" data-term></div></div>`;
      if (!document.querySelector('link[data-xterm]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./vendor/xterm/xterm.css', import.meta.url).href; l.dataset.xterm = ''; document.head.append(l); }
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('./vendor/xterm/xterm.mjs'), import('./vendor/xterm/addon-fit.mjs')]);
      const t = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace', theme: { background: '#1e1e1e' } });
      const fit = new FitAddon(); t.loadAddon(fit); t.open(body.querySelector('[data-term]')); fit.fit(); t.focus();
      const stateEl = body.querySelector('[data-tstate]'), again = body.querySelector('[data-reconnect]');
      let ws = null;
      const connect = () => {
        again.hidden = true; stateEl.textContent = 'Connecting…';
        ws = new WebSocket(hubUrl().replace(/\/?$/, '/admin/term')); ws.binaryType = 'arraybuffer';
        ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: ss.get(), rows: t.rows, cols: t.cols }));
        ws.onmessage = (e) => {
          if (typeof e.data !== 'string') return t.write(new Uint8Array(e.data));
          const m = JSON.parse(e.data);
          if (m.t === 'ready') stateEl.textContent = `Connected to ${m.target}`;
          else if (m.t === 'exit') stateEl.textContent = 'Session ended.';
          else if (m.t === 'error') { stateEl.textContent = m.error; if (/expired/.test(m.error)) unlockScreen(m.error); }
        };
        ws.onclose = () => { if (term === handle) { stateEl.textContent += ' (disconnected)'; again.hidden = false; } };
      };
      const send = (m) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); };
      t.onData((d) => send({ t: 'in', d }));
      t.onResize(({ rows, cols }) => send({ t: 'size', rows, cols }));
      const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } }); ro.observe(body.querySelector('[data-term]'));
      again.onclick = () => { t.reset(); connect(); };
      const handle = { dispose() { term = null; ro.disconnect(); ws?.close(); t.dispose(); } };
      term = handle;
      connect();
    },
  };
  function draw() {
    for (const b of ov.querySelectorAll('[data-tab]')) b.classList.toggle('down', b.dataset.tab === tab);
    ov.querySelector('.adm').classList.toggle('terminal', tab === 'term');
    if (!st && tab !== 'term') { body.textContent = 'Loading…'; return; }
    const keep = body.scrollTop;
    Promise.resolve(views[tab]()).catch((e) => { body.textContent = e.message; });
    body.scrollTop = keep;
  }
  if (ss.get()) start(); else unlock();
  return {
    visible(on) { shown = on; if (on && st && tab !== 'term') refresh().catch(() => {}); },
    destroy() { clearInterval(timer); term?.dispose(); term = null; ov.replaceChildren(); },
  };
}
