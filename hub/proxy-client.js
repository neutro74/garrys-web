// Runs first in every page opened through the hub's web proxy (hub/proxy.mjs). Pages load from the hub's address, so
// whatever they fetch, open or add later is sent through the proxy too: fetch, XMLHttpRequest, beacons, window.open, new
// <img>/<script>/<link>/<iframe>/... addresses, forms and history changes. It also tells the launcher's Browser tab
// (window.parent) which real address and title are showing, and passes on key presses it should handle.
(() => {
  const cfg = window.__gwProxy;
  if (!cfg || window.__gwProxyOn) return;
  window.__gwProxyOn = true;
  const { prefix } = cfg;
  // The real address of this page (the proxy path turned back into https://site/...).
  const real = () => {
    const m = /^\/p\/[A-Za-z0-9_-]+\/(https?)\/([^/]+)(\/.*)?$/.exec(location.pathname);
    return m ? `${m[1]}://${m[2]}${m[3] ?? '/'}${location.search}${location.hash}` : cfg.base;
  };
  const wrap = (raw) => {
    if (raw == null) return raw;
    const v = String(raw).trim();
    if (!v || /^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(v) || v.startsWith(prefix) || v.startsWith(location.origin + prefix)) return raw;
    let u;
    try { u = new URL(v, real()); } catch { return raw; }
    if (!/^https?:$/.test(u.protocol)) return raw;
    // Something that already points at the hub (the page's own scripts building /path) belongs to the site.
    if (u.origin === location.origin) { const r = new URL(real()); u = new URL(u.pathname + u.search + u.hash, r.origin); }
    return `${prefix}${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}${u.hash}`;
  };

  const ofetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      if (input instanceof Request) input = new Request(wrap(input.url), input);
      else input = wrap(input instanceof URL ? input.href : input);
    } catch { /* leave it */ }
    return ofetch.call(this, input, init);
  };
  const oopen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { return oopen.call(this, method, wrap(url), ...rest); };
  if (navigator.sendBeacon) { const ob = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (url, data) => ob(wrap(url), data); }
  const owin = window.open;
  window.open = function (url, target, features) { if (url) { location.href = wrap(url); return window; } return owin.call(this, url, target, features); };
  for (const k of ['pushState', 'replaceState']) {
    const o = history[k];
    history[k] = function (state, title, url) { const r = o.call(this, state, title, url == null ? url : wrap(url)); tell(); return r; };
  }
  if (window.Worker) { const OW = window.Worker; window.Worker = function (url, opts) { return new OW(wrap(url instanceof URL ? url.href : url), opts); }; window.Worker.prototype = OW.prototype; }

  // Addresses set on elements after the page loaded.
  const props = [[HTMLAnchorElement, 'href'], [HTMLAreaElement, 'href'], [HTMLLinkElement, 'href'], [HTMLImageElement, 'src'], [HTMLScriptElement, 'src'], [HTMLIFrameElement, 'src'],
    [HTMLSourceElement, 'src'], [HTMLMediaElement, 'src'], [HTMLEmbedElement, 'src'], [HTMLFormElement, 'action'], [HTMLInputElement, 'src'], [HTMLTrackElement, 'src']];
  if (window.HTMLVideoElement) props.push([HTMLVideoElement, 'poster']);
  for (const [C, p] of props) {
    const d = Object.getOwnPropertyDescriptor(C.prototype, p);
    if (!d?.set) continue;
    Object.defineProperty(C.prototype, p, { ...d, set(v) { d.set.call(this, wrap(v)); } });
  }
  const ATTR = /^(href|src|action|formaction|poster|data)$/i;
  const oset = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (ATTR.test(name) && !(this instanceof SVGElement && /^href$/i.test(name) && String(value).startsWith('#'))) value = wrap(value);
    if (/^srcset$/i.test(name)) value = String(value).split(',').map((p) => { const [u, ...w] = p.trim().split(/\s+/); return [wrap(u), ...w].join(' '); }).join(', ');
    if (/^target$/i.test(name) && /^_(top|parent|blank)$/i.test(value)) value = '_self';
    return oset.call(this, name, value);
  };
  // Links that would leave the frame stay in it.
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[target]');
    if (a && /^_(top|parent|blank)$/i.test(a.getAttribute('target'))) a.setAttribute('target', '_self');
  }, true);
  document.addEventListener('submit', (e) => { const f = e.target; if (f?.target && /^_(top|parent|blank)$/i.test(f.target)) f.target = '_self'; }, true);

  // Where we are, for the address bar.
  let told = 0;
  function tell() { clearTimeout(told); told = setTimeout(send, 80); }
  function send() {
    try { window.parent.postMessage({ gwProxy: 'nav', url: real(), title: document.title }, '*'); } catch { /* no parent */ }
  }
  if (window.parent !== window && window.parent === window.top) {
    addEventListener('DOMContentLoaded', tell); addEventListener('load', tell); addEventListener('hashchange', tell); addEventListener('popstate', tell);
    new MutationObserver(tell).observe(document.querySelector('title') ?? document.documentElement, { childList: true, subtree: !document.querySelector('title'), characterData: true });
    // Keys the launcher uses (Alt+Left/Right, Ctrl+L, F5) work while the page has focus.
    addEventListener('keydown', (e) => {
      const k = (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') || e.key === 'F5';
      if (k) { e.preventDefault(); window.parent.postMessage({ gwProxy: 'key', key: e.key, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey }, '*'); }
    }, true);
  }
})();
