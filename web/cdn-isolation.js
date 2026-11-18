// CDN hosts (StaticDelivr) cannot send COOP/COEP, so the package-root service worker (cdn-sw.js) adds them.
// A page the worker does not control yet (the first visit, or a hard reload, which bypasses service workers) registers it
// and reloads itself once; resolves true when the page is cross-origin isolated. The address stays clean, so reloading or
// sharing the link works like any other page. The loop guard is a timestamp in session storage (one automatic reload per
// RETRY_MS); only when session storage is blocked does a marker go in the address instead, removed again on arrival.
const PARAM = '__gmod_cdn_isolation';
const RETRY_MS = 10_000;

export async function ensureCdnIsolation() {
  const here = new URL(location.href), marked = here.searchParams.has(PARAM);
  if (marked) { here.searchParams.delete(PARAM); history.replaceState(history.state, '', here.href); }
  if (globalThis.crossOriginIsolated) return true;
  if (!navigator.serviceWorker) return false;
  const root = new URL('../', import.meta.url);
  const key = `garrys-wasm.cdn-isolation:${root.pathname}`;
  let last = 0, storage = true;
  try { last = +(sessionStorage.getItem(key) ?? 0) || 0; } catch { storage = false; }
  if (storage ? Date.now() - last < RETRY_MS : marked) return false;
  try {
    await navigator.serviceWorker.register(new URL('../cdn-sw.js', import.meta.url).href, { scope: root.href });
    await navigator.serviceWorker.ready;
  } catch { return false; }
  if (storage) {
    try { sessionStorage.setItem(key, String(Date.now())); location.reload(); return false; } catch { /* fall through to the marker */ }
  }
  here.searchParams.set(PARAM, '1');
  location.replace(here.href);
  return false;
}
