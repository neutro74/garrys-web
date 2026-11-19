#!/usr/bin/env node
// Garry's Web brand artwork, built from Garry's Mod's own branding so the two read as family:
//  - the lockup copies GMod's menu logo (garrysmod/gamemodes/sandbox/logo.png): a 96 px blue tile with a white Helvetica
//    "g" overlapping a dark translucent bar with a hairline border, lowercase name in Helvetica Bold. Measurements and
//    colours below were sampled from that file. The tile becomes a browser tab: a tab rises from its top edge and an
//    address bar sits across the top of the page.
//  - the hero banner's physgun beam is the game's own beam sprite (materials/sprites/physbeam_active_white.vtf) and glow
//    (sprites/glow04.vtf), drawn along a curve additively and tinted with the default physgun colour, as the game does.
//   node tools/brand/render.mjs [--animated | --preview <dir>]   (needs the game install: dist/gmod-web/game, and the Nimbus Sans font, a Helvetica clone)
// Output: web/brand/*.png (+ favicon.ico), including banner-animated.png (APNG: light running up the beam); --animated writes only that.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, ImageData } from '@napi-rs/canvas';
import { GameFs } from '../lib/vpk.mjs';
import { decodeVtf } from './vtf.mjs';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..'), out = path.join(repo, 'web/brand');
const gameDir = process.env.GMOD_GAME ?? path.join(repo, 'dist/gmod-web/game');
fs.mkdirSync(out, { recursive: true });
GlobalFonts.registerFromPath(process.env.BRAND_FONT ?? '/usr/share/fonts/urw-base35/NimbusSans-Bold.otf', 'Helv');
const FONT = (px) => `bold ${px}px Helv`;

// ---- GMod's palette (sampled from sandbox/logo.png) ----
const TILE = '#1194f0', TILE_TOP = '#219bf1', TILE_RIM = 'rgb(70,172,243)', BAR = 'rgba(0,0,0,0.4)', BAR_EDGE = 'rgba(154,154,154,0.4)';
const PHYSGUN = [0.3, 1.8, 2.1];   // cl_weaponcolor's default, the physgun beam tint (over 1: the beam burns toward white)

// ---- The tile, as a browser window ----
// GMod's rounded blue square, unchanged in outline, with a browser's top inside it: a darker tab strip holding the active tab
// (in the page's blue, flaring into the page as browsers draw the selected tab) and a background tab, then the address bar.
// Drawn in a 96-unit box like GMod's (origin = tile's top left); `s` scales it.
const R = 9;
function square(ctx, s) { ctx.beginPath(); ctx.roundRect(0, 0, 96 * s, 96 * s, R * s); }
function tab(ctx, s, x, w, top, bottom, flare) {
  const r = 4 * s;
  ctx.beginPath();
  ctx.moveTo((x - flare) * s, bottom * s);
  ctx.quadraticCurveTo(x * s, bottom * s, x * s, (bottom - flare) * s);
  ctx.lineTo(x * s, top * s + r); ctx.arcTo(x * s, top * s, x * s + r, top * s, r);
  ctx.lineTo((x + w) * s - r, top * s); ctx.arcTo((x + w) * s, top * s, (x + w) * s, top * s + r, r);
  ctx.lineTo((x + w) * s, (bottom - flare) * s);
  ctx.quadraticCurveTo((x + w) * s, bottom * s, (x + w + flare) * s, bottom * s);
  ctx.closePath();
}
function drawTile(ctx, x, y, s, { shadow = true, detail = true } = {}) {
  ctx.save(); ctx.translate(x, y);
  if (shadow) {   // GMod's tile sits on a soft black shadow (alpha 0.5 at the edge, gone in ~10 px)
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 14 * s; ctx.fillStyle = TILE; square(ctx, s); ctx.fill(); ctx.restore();
  }
  const grad = ctx.createLinearGradient(0, 0, 0, 96 * s);
  grad.addColorStop(0, TILE_TOP); grad.addColorStop(0.5, TILE); grad.addColorStop(1, '#1092ee');
  square(ctx, s); ctx.fillStyle = grad; ctx.fill();
  ctx.save(); square(ctx, s); ctx.clip();
  if (detail) {
    // a browser's top: a darker tab strip with a background tab, and the active tab, filled with the page's own gradient so
    // tab and page are one shape with no seam
    const strip = 17;
    ctx.fillStyle = '#075ca4'; ctx.fillRect(0, 0, 96 * s, strip * s);
    ctx.fillStyle = '#1a7fd0'; tab(ctx, s, 50, 30, 5, strip, 3); ctx.fill();
    ctx.fillStyle = grad; tab(ctx, s, 10, 38, 4, strip + 1, 4); ctx.fill();
  }
  // the banner's beam, faintly: a soft diagonal band of light across tile and tab alike
  const sheen = ctx.createLinearGradient(0, 96 * s, 96 * s, 0);
  sheen.addColorStop(0.25, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(160,240,255,0.22)'); sheen.addColorStop(0.75, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.fillStyle = sheen; ctx.fillRect(0, 0, 96 * s, 96 * s);
  ctx.restore();
  if (detail) {
    // the address bar: translucent white on the blue, with the lock dot
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.roundRect(8 * s, 21 * s, 80 * s, 7.5 * s, 3.75 * s); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(12.25 * s, 24.75 * s, 1.75 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 3 * s; ctx.strokeStyle = TILE_RIM; square(ctx, s); ctx.stroke();   // GMod's lighter rim
  ctx.restore();
  // the g, GMod's: white Helvetica Bold, filling the page below the toolbar
  ctx.fillStyle = '#fff'; ctx.font = FONT((detail ? 70 : 88) * s); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('g', 48.5 * s, (detail ? 72 : 74) * s);
  ctx.restore();
}

// ---- The lockup: GMod's logo.png layout (288 x 128) with "garry's web" ----
function lockup(scale = 1) {
  const c = createCanvas(288 * scale, 128 * scale), ctx = c.getContext('2d'), s = scale;
  ctx.fillStyle = BAR; ctx.beginPath(); ctx.roundRect(0.5 * s, 32.5 * s, 287 * s, 63 * s, 5 * s); ctx.fill();
  ctx.strokeStyle = BAR_EDGE; ctx.lineWidth = s; ctx.stroke();
  drawTile(ctx, 18 * s, 18 * s, s);
  ctx.fillStyle = '#fff'; ctx.font = FONT(23 * s); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.letterSpacing = `${-0.6 * s}px`;
  ctx.fillText("garry’s web", 141 * s, 69 * s);
  return c;
}

// ---- The physgun beam, from the game's own sprites ----
const game = new GameFs([path.join(gameDir, 'garrysmod'), path.join(gameDir, 'sourceengine')]);
function sprite(name, tint) {
  const t = decodeVtf(game.read(`materials/${name}.vtf`)), c = createCanvas(t.w, t.h), ctx = c.getContext('2d');
  const px = new Uint8ClampedArray(t.rgba.length);
  for (let i = 0; i < t.rgba.length; i += 4) {   // additive sprites: colour = texel * tint (alpha unused, as with $additive)
    const l = (t.rgba[i] + t.rgba[i + 1] + t.rgba[i + 2]) / 3 / 255;
    px[i] = Math.min(255, l * 255 * tint[0]); px[i + 1] = Math.min(255, l * 255 * tint[1]); px[i + 2] = Math.min(255, l * 255 * tint[2]); px[i + 3] = 255;
  }
  ctx.putImageData(new ImageData(px, t.w, t.h), 0, 0);
  return c;
}
const cubic = (p, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]); };
// The beam texture runs along its height; runs of rows are laid along the curve (one short run per segment, with smoothing),
// as the engine's beam renderer stretches the sprite along the beam.
function beam(ctx, pts, width, tex, { repeat = 2.2, alpha = 1, blur = 0 } = {}) {
  const N = 1400, rows = tex.height;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (blur) ctx.filter = `blur(${blur}px)`;
  for (let i = 0; i < N; i++) {
    const t = i / N, [x, y] = cubic(pts, t), [x2, y2] = cubic(pts, (i + 1) / N), ang = Math.atan2(y2 - y, x2 - x), seg = Math.hypot(x2 - x, y2 - y);
    const v0 = (t * repeat * rows) % rows, dv = Math.max(1, (repeat * rows) / N);
    const taper = Math.min(1, t * 10) * (0.7 + 0.3 * Math.min(1, (1 - t) * 5));
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang - Math.PI / 2);
    ctx.drawImage(tex, 0, Math.min(rows - dv, v0), tex.width, dv, -width * taper / 2, -0.6, width * taper, seg + 1.2);
    ctx.restore();
  }
  ctx.restore();
}
function glow(ctx, tex, x, y, size, alpha = 1) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha; ctx.drawImage(tex, x - size / 2, y - size / 2, size, size); ctx.restore();
}

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
// The banner: a stylised physgun beam (drawn here, not the game's sprite) filling the canvas on the diagonal, and the name
// level across its middle. The beam is built in its own frame: x along the beam, y across it. The corners the beam does not
// cover are a deeper blue of their own, so the outermost band and its glow read as beam rather than as background.
// t (0..1): a frame of the animated banner, a soft light travelling up inside the beam; null for the still banner.
function hero(W = 1600, H = 520, t = null, { text = true } = {}) {
  const c = createCanvas(W, H), ctx = c.getContext('2d'), rand = rng(7);
  // Outside the beam: one solid blue, no glow or gradient (the last step below keeps it so).
  const BG = '#0b3a7c';
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const ang = -Math.atan2(H * 1.15, W), L = Math.hypot(W, H) * 1.3;
  const inBeam = (fn, comp = 'lighter', blur = 0) => {
    ctx.save(); ctx.globalCompositeOperation = comp; if (blur) ctx.filter = `blur(${blur}px)`;
    ctx.translate(W / 2, H / 2); ctx.rotate(ang); fn(ctx); ctx.restore();
  };
  const band = (width, stops, blur = 0) => inBeam((g) => {
    const gr = g.createLinearGradient(0, -width / 2, 0, width / 2);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr; g.fillRect(-L / 2, -width / 2, L, width);
  }, 'lighter', blur);
  // Nested bands with crisp edges (flat, layered, each a shade lighter toward the core) that flare out along the beam:
  // narrow where it leaves the gun at the bottom left, wide at the top right. Each band is a wedge in the beam's frame.
  const wedge = (w0, w1, fill, { glow = 0, glowColor = '', edge = '' } = {}) => inBeam((g) => {
    g.beginPath(); g.moveTo(-L / 2, -w0 / 2); g.lineTo(L / 2, -w1 / 2); g.lineTo(L / 2, w1 / 2); g.lineTo(-L / 2, w0 / 2); g.closePath();
    if (glow) { g.shadowColor = glowColor; g.shadowBlur = glow; }
    g.fillStyle = typeof fill === 'function' ? fill(g) : fill; g.fill();
    if (edge) { g.shadowBlur = 0; g.strokeStyle = edge; g.lineWidth = 3; g.stroke(); }
  }, 'source-over');
  const along = (a, b) => (g) => { const gr = g.createLinearGradient(-L / 2, 0, L / 2, 0); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  wedge(H * 0.9, H * 3.2, along('#0c3f86', '#0f58b8'));
  wedge(H * 0.62, H * 2.2, along('#1474dd', '#1b8ef0'), { glow: 40, glowColor: 'rgba(30,150,255,0.8)' });
  wedge(H * 0.38, H * 1.35, along('#22b4ff', '#35c9ff'), { glow: 34, glowColor: 'rgba(60,210,255,0.9)' });
  wedge(H * 0.2, H * 0.72, along('#8ff0ff', '#b8f7ff'), { glow: 30, glowColor: 'rgba(150,240,255,1)' });
  wedge(H * 0.06, H * 0.26, '#ffffff', { glow: 26, glowColor: 'rgba(255,255,255,1)' });
  if (t !== null) inBeam((g) => {
    // inside the second band only, so it follows the beam's flare; it fades in and out at the ends of its run
    const w0 = H * 0.62, w1 = H * 2.2;
    g.beginPath(); g.moveTo(-L / 2, -w0 / 2); g.lineTo(L / 2, -w1 / 2); g.lineTo(L / 2, w1 / 2); g.lineTo(-L / 2, w0 / 2); g.closePath(); g.clip();
    const x = -L * 0.45 + t * L * 0.9, len = L * 0.11, a = 0.32 * Math.sin(Math.PI * t);
    const gr = g.createLinearGradient(x - len, 0, x + len, 0);
    gr.addColorStop(0, 'rgba(210,248,255,0)'); gr.addColorStop(0.5, `rgba(210,248,255,${a.toFixed(3)})`); gr.addColorStop(1, 'rgba(210,248,255,0)');
    g.fillStyle = gr; g.fillRect(x - len, -H * 2, len * 2, H * 4);
  }, 'lighter');

  // the name, level across the middle of the beam (left out for the loading-screen background, which has the logo over it)
  if (text) {
  ctx.font = FONT(200); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.letterSpacing = '-7px';
  const tx = W / 2, ty = H / 2 + 6, name = "garry’s web";
  ctx.save(); ctx.shadowColor = 'rgba(0,30,60,0.9)'; ctx.shadowBlur = 36; ctx.fillStyle = 'rgba(0,20,45,0.55)'; ctx.fillText(name, tx, ty + 8); ctx.restore();
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(6,38,74,0.85)'; ctx.strokeText(name, tx, ty); ctx.restore();
  ctx.save(); ctx.shadowColor = 'rgba(120,235,255,1)'; ctx.shadowBlur = 40; ctx.fillStyle = '#ffffff'; ctx.fillText(name, tx, ty); ctx.restore();
  }
  // Everything outside the outermost band goes back to the solid background, so no glow reaches the corners.
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H);
  ctx.translate(W / 2, H / 2); ctx.rotate(ang);
  const w0 = H * 0.9, w1 = H * 3.2;
  ctx.moveTo(-L / 2, -w0 / 2); ctx.lineTo(L / 2, -w1 / 2); ctx.lineTo(L / 2, w1 / 2); ctx.lineTo(-L / 2, w0 / 2); ctx.closePath();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = BG; ctx.fill('evenodd'); ctx.restore();
  return c;
}


const png = (c, name) => fs.writeFileSync(path.join(out, name), c.toBuffer('image/png'));
// The animated banner as APNG (full colour; GIF's 256 colours band the glows). Frames after the first carry only the
// rectangle that changed. Half size: it is never shown wider than a few hundred pixels.
function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function zdata(rgba, w, x0, y0, cw, ch) {
  const raw = Buffer.alloc((cw * 4 + 1) * ch);
  for (let y = 0; y < ch; y++) { raw[y * (cw * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + ((y0 + y) * w + x0) * 4, cw * 4).copy(raw, y * (cw * 4 + 1) + 1); }
  return zlib.deflateSync(raw, { level: 9 });
}
function heroApng(W = 640, H = 208, n = 36, delayMs = 60, holdMs = 1800, { srcW = 1600, srcH = 520, text = true } = {}) {
  const small = createCanvas(W, H), g = small.getContext('2d'), frames = [];
  for (let i = 0; i <= n; i++) { g.clearRect(0, 0, W, H); g.drawImage(hero(srcW, srcH, i === n ? null : i / n, { text }), 0, 0, W, H); frames.push(Buffer.from(g.getImageData(0, 0, W, H).data)); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4); parts.push(chunk('acTL', actl));
  let seq = 0;
  frames.forEach((f, i) => {
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (i > 0) {   // the changed rectangle
      const prev = frames[i - 1]; x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; if (f[o] !== prev[o] || f[o + 1] !== prev[o + 1] || f[o + 2] !== prev[o + 2]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, fc = Buffer.alloc(26);
    fc.writeUInt32BE(seq++, 0); fc.writeUInt32BE(cw, 4); fc.writeUInt32BE(ch, 8); fc.writeUInt32BE(x0, 12); fc.writeUInt32BE(y0, 16);
    fc.writeUInt16BE(i === frames.length - 1 ? holdMs : delayMs, 20); fc.writeUInt16BE(1000, 22); fc[24] = 0; fc[25] = 0;   // keep, replace
    parts.push(chunk('fcTL', fc));
    const z = zdata(f, W, x0, y0, cw, ch);
    if (i === 0) parts.push(chunk('IDAT', z));
    else { const sq = Buffer.alloc(4); sq.writeUInt32BE(seq++); parts.push(chunk('fdAT', Buffer.concat([sq, z]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
// --preview <dir>: only the banner (still and animated) into another folder, to look at before replacing the real ones.
const pv = process.argv.indexOf('--preview');
if (pv > 0) { const d = process.argv[pv + 1]; fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'banner.png'), hero().toBuffer('image/png')); fs.writeFileSync(path.join(d, 'banner-animated.png'), heroApng()); console.log('wrote', d); process.exit(0); }
// --background [dir]: the loading-screen background: the banner's beam with no text, 16:9 (web/brand/background.jpg).
const bg = process.argv.indexOf('--background');
if (bg > 0) {
  const d = process.argv[bg + 1] && !process.argv[bg + 1].startsWith('--') ? process.argv[bg + 1] : out;
  fs.mkdirSync(d, { recursive: true });
  // A JPEG (no transparency needed, a fraction of a PNG's size); the light running up the beam is animated by the page in CSS.
  fs.writeFileSync(path.join(d, 'background.jpg'), hero(1920, 1080, null, { text: false }).toBuffer('image/jpeg', { quality: 0.9 }));
  console.log('wrote background.jpg to', d); process.exit(0);
}
if (process.argv.includes('--animated')) { fs.writeFileSync(path.join(out, 'banner-animated.png'), heroApng()); console.log('wrote banner-animated.png'); process.exit(0); }
png(lockup(1), 'logo.png');
png(lockup(2), 'logo@2x.png');
png(lockup(4), 'logo@4x.png');
// 16 px: the scaled drawing loses the tab strip and reads as GMod's own icon, so this size is drawn on the pixel grid: a dark
// strip along the top with the active tab (page blue, joined to the page) and a background tab, then a smaller g.
function icon16() {
  const c = createCanvas(16, 16), ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 16); grad.addColorStop(0, TILE_TOP); grad.addColorStop(0.5, TILE); grad.addColorStop(1, '#1092ee');
  ctx.beginPath(); ctx.roundRect(0, 0, 16, 16, 2.5); ctx.fillStyle = grad; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = '#075ca4'; ctx.fillRect(0, 0, 16, 4);
  ctx.fillStyle = '#3a9be6'; ctx.fillRect(9, 1, 5, 3);
  ctx.fillStyle = TILE_TOP; ctx.fillRect(2, 1, 6, 4);
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = FONT(13); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText('g', 8, 13);
  return c;
}
for (const size of [512, 256, 192, 180, 64, 32]) {
  const c = createCanvas(size, size), ctx = c.getContext('2d'), s = (size / 96) * (size <= 32 ? 0.98 : 0.86);
  drawTile(ctx, (size - 96 * s) / 2, (size - 96 * s) / 2 + (size <= 32 ? 0 : size * 0.02), s, { shadow: size > 32, detail: size >= 32 });
  png(c, `icon-${size}.png`);
}
png(icon16(), 'icon-16.png');
png(hero(), 'banner.png');
fs.writeFileSync(path.join(out, 'banner-animated.png'), heroApng());
// favicon.ico: 16 and 32 px PNG images in an ICO container
const ico = (files) => {
  const imgs = files.map((f) => fs.readFileSync(path.join(out, f))), head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach((b, i) => { const sz = +files[i].match(/(\d+)/)[1], e = 6 + 16 * i; head[e] = sz; head[e + 1] = sz; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12); off += b.length; });
  return Buffer.concat([head, ...imgs]);
};
fs.writeFileSync(path.join(out, 'favicon.ico'), ico(['icon-16.png', 'icon-32.png']));
console.log('wrote', fs.readdirSync(out).join(' '));
