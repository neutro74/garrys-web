// Optional Steam sign-in (hub/steam-login.mjs), needed only to play on real Garry's Mod servers: they check every player's
// Steam login with Valve. The browser keeps the key that unlocks this player's Steam session on the hub; nothing else
// about the Steam account is stored here except its SteamID and account name for display.
import { hubHttp } from './library.js';

const K = 'garrys-wasm.steam';
export const BASE_ID = 76561197960265728n;
export function steamAccount() {
  try { const a = JSON.parse(localStorage.getItem(K) ?? 'null'); return a && /^\d{17}$/.test(a.steamid) && a.key ? a : null; } catch { return null; }
}
// Signed out is written as {"out":1} rather than removed, so the account's other browsers (web/account.js) sign out too.
const setAccount = (a) => { try { localStorage.setItem(K, JSON.stringify(a ?? { out: 1 })); } catch { /* blocked */ } };
// The 32-bit account id the game uses (steam.mjs builds the 64-bit SteamID from it).
export const accountId = (a) => String(BigInt(a.steamid) - BASE_ID);

async function call(path, body) {
  const base = hubHttp();
  if (!base) throw Error('Steam sign-in needs the Garry\'s Web server, and none is set up for this copy of the game.');
  let r;
  try { r = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' } : { cache: 'no-store' }); }
  catch { throw Error('The Garry\'s Web server is not reachable right now.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && body?.key) setAccount(null);
  if (!r.ok) throw Object.assign(Error(j.error ?? `Error ${r.status}`), { status: r.status });
  return j;
}
export const startQr = () => call('steam/qr', {});
export async function pollQr(id) {
  const r = await call('steam/qr?id=' + encodeURIComponent(id));
  if (r.state === 'done') setAccount({ key: r.key, steamid: r.steamid, name: r.name });
  return r;
}
export async function signOut() { const a = steamAccount(); setAccount(null); if (a) await call('steam/logout', { key: a.key }).catch(() => {}); }
export async function ticket() { const a = steamAccount(); if (!a) return null; return call('steam/ticket', { key: a.key }); }
export async function keepalive() { const a = steamAccount(); if (a) await call('steam/keepalive', { key: a.key }); }

// The Profile panel's Steam box.
export function steamBox(box, esc) {
  const a = steamAccount();
  if (a) {
    box.innerHTML = `<div class="acct"><span>Steam: signed in as <b>${esc(a.name)}</b>. You can join regular Garry's Mod servers from <b>Find Multiplayer Game</b>.</span>
      <div class="row"><button class="btn" data-sout>Sign out of Steam</button></div><p class="hint">Signing out removes the sign-in from the Garry's Web server too.</p></div>`;
    box.querySelector('[data-sout]').onclick = async () => { await signOut(); steamBox(box, esc); };
    return;
  }
  box.innerHTML = `<div class="acct"><span><b>Steam (optional).</b> Sign in with a Steam account that owns Garry's Mod to also play on regular Garry's Mod servers.
      You approve it in the Steam mobile app; your password is never typed here.</span>
    <div class="row"><button class="btn" data-sin>Sign in with Steam</button></div><div data-qr></div><p class="hint" data-smsg></p></div>`;
  const msg = box.querySelector('[data-smsg]'), qr = box.querySelector('[data-qr]');
  box.querySelector('[data-sin]').onclick = async (ev) => {
    ev.target.disabled = true; msg.textContent = 'Starting…';
    let s;
    try { s = await startQr(); } catch (e) { msg.textContent = e.message; ev.target.disabled = false; return; }
    qr.innerHTML = `<div class="steam-qr">${s.svg}</div>
      <div class="row"><a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener" data-open>Open sign-in</a><button class="btn" type="button" data-copy>Copy link</button></div>`;
    qr.querySelector('[data-copy]').onclick = async (e) => {
      try { await navigator.clipboard.writeText(s.url); e.target.textContent = 'Copied'; } catch { prompt('Copy this link:', s.url); }
    };
    msg.textContent = 'Scan the code with the Steam mobile app (Steam Guard → scan), or open the link on your phone, then approve.';
    const poll = async () => {
      if (!box.isConnected) return;
      let r;
      try { r = await pollQr(s.id); } catch (e) { msg.textContent = e.message; return; }
      if (r.state === 'done') return steamBox(box, esc);
      if (r.state === 'failed') { msg.textContent = r.error ?? 'The sign-in did not complete.'; qr.innerHTML = ''; ev.target.disabled = false; return; }
      if (r.state === 'scanned') msg.textContent = 'Scanned. Approve the sign-in in the Steam app.';
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 2000);
  };
}
