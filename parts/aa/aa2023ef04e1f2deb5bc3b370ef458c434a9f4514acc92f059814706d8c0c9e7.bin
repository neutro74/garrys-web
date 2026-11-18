// Derma: the launcher, chat and in-game overlay are drawn with GMod's own Derma skin and Silkicons, straight from the game's
// files (nothing extra ships). The skin texture (materials/gwenskin/GModDefault.png) is cut into its pieces here, using the
// rectangles from lua/skins/default.lua, and each piece becomes a CSS variable (--dk-<name>) that web/derma.css uses as a
// border-image. Until the skin arrives (or if it cannot), derma.css falls back to flat colours in the same places.
//   dermaReady() -> Promise (resolves when the variables are set, or after it gave up)
//   icon('user') -> URL of materials/icon16/user.png
const asset = (p) => new URL('../asset/garrysmod/' + p, import.meta.url).href;
export const icon = (name) => asset(`materials/icon16/${name}.png`);
export const gameFile = (p) => new URL('../game/garrysmod/' + p, import.meta.url).href;

// name: [x, y, w, h] in the 512x512 texture (GWEN.CreateTextureBorder / CreateTextureNormal arguments).
const PIECES = {
  window: [0, 0, 127, 127], 'window-off': [128, 0, 127, 127],
  close: [32, 448, 31, 24], 'close-h': [64, 448, 31, 24], 'close-d': [96, 448, 31, 24],
  mini: [128, 448, 31, 24], 'mini-h': [160, 448, 31, 24], maxi: [224, 448, 31, 24], 'maxi-h': [256, 448, 31, 24],
  button: [480, 0, 31, 31], 'button-h': [480, 32, 31, 31], 'button-dead': [480, 64, 31, 31], 'button-d': [480, 96, 31, 31],
  panel: [256, 0, 63, 63], 'panel-bright': [320, 0, 63, 63], 'panel-dark': [256, 64, 63, 63], 'panel-hl': [320, 64, 63, 63],
  tree: [256, 128, 127, 127], textbox: [0, 150, 127, 21], 'textbox-f': [0, 172, 127, 21], 'textbox-off': [0, 194, 127, 21],
  tabctl: [0, 256, 127, 127], 'tab-on': [0, 384, 63, 31], 'tab-off': [128, 384, 63, 31], tabbar: [128, 352, 127, 31],
  menu: [128, 192, 127, 63], 'menu-h': [128, 256, 127, 31], sel: [384, 32, 31, 31],
  'cat-outer': [256, 384, 63, 63], 'cat-head': [320, 352, 63, 31], tooltip: [384, 64, 31, 31],
  'list-bg': [256, 256, 63, 127], 'prog-back': [384, 0, 31, 31], 'prog-front': [416, 0, 31, 31],
  check: [464, 32, 15, 15], 'check-on': [448, 32, 15, 15], radio: [464, 64, 15, 15], 'radio-on': [448, 64, 15, 15],
  combo: [384, 336, 127, 31], 'combo-h': [384, 368, 127, 31],
};

// Tooltips ([data-tip] inside .dk): one element on the page itself, fixed to the screen, so no scrolling list or window can
// cut it off. Above the item, or below it when there is no room; always inside the window.
function tooltips() {
  const tip = document.createElement('div'); tip.className = 'dk dk-tooltip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let on = null, timer = 0;
  const hide = () => { clearTimeout(timer); on = null; tip.hidden = true; };
  const show = (el) => {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2)), y = r.top - h - 6 >= 4 ? r.top - h - 6 : Math.min(innerHeight - h - 4, r.bottom + 6);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('.dk [data-tip], .dk[data-tip]');
    if (el === on) return;
    hide();
    if (!el || !el.dataset.tip) return;
    on = el; timer = setTimeout(() => { if (on === el && el.isConnected) show(el); }, 250);
  }, true);
  for (const ev of ['pointerdown', 'scroll', 'keydown', 'blur']) addEventListener(ev, hide, true);
}

let ready = null;
export function dermaReady() {
  if (ready) return ready;
  tooltips();
  if (!document.querySelector('link[data-derma]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./derma.css', import.meta.url).href; l.dataset.derma = '';
    document.head.append(l);
  }
  ready = (async () => {
    try {
      const img = new Image(); img.src = asset('materials/gwenskin/gmoddefault.png'); await img.decode();
      const c = document.createElement('canvas'), g = c.getContext('2d'), rootStyle = document.documentElement.style;
      for (const [name, [x, y, w, h]] of Object.entries(PIECES)) {
        c.width = w; c.height = h; g.clearRect(0, 0, w, h); g.drawImage(img, x, y, w, h, 0, 0, w, h);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        rootStyle.setProperty(`--dk-${name}`, `url("${URL.createObjectURL(blob)}")`);
      }
      document.documentElement.classList.add('dk-ready');
    } catch (e) { console.warn('[derma] skin unavailable, using flat colours:', e?.message ?? e); }
  })();
  return ready;
}
