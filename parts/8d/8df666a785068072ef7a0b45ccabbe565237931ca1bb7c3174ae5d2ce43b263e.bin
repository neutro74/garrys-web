// Cropping a profile picture or banner before it is uploaded: a small Derma window where the picture is dragged and zoomed
// under a fixed frame (square for a picture, 3:1 for a banner). Animated GIFs keep moving: every frame is cropped and a new
// GIF is written (web/gif.js), made smaller (size, then frame rate) until it fits the hub's limit.
//   cropImage(file, { w, h, limit, title }) -> Promise<Blob | null>   (null: cancelled)
import { decodeGifFrames, encodeGif } from './gif.js';
import { dermaReady, icon } from './derma.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tick = () => new Promise((r) => setTimeout(r, 0));
const dims = (img) => [img.displayWidth ?? img.width, img.displayHeight ?? img.height];

export async function cropImage(file, { w, h, limit, title = 'Crop picture' }) {
  dermaReady();
  const isGif = file.type === 'image/gif';
  let frames = isGif ? await decodeGifFrames(file) : null;
  if (isGif && !frames && file.size <= limit) return file;   // this browser cannot read GIF frames: upload it as it is
  if (frames?.length === 1) { frames = null; }
  let still;
  try { still = frames ? frames[0].image : await createImageBitmap(file); } catch { throw Error('That picture could not be read.'); }
  const [sw, sh] = dims(still), aspect = w / h, animated = !!frames;

  return new Promise((resolve) => {
    const veil = document.createElement('div'); veil.className = 'dk gw-crop';
    veil.innerHTML = `<div class="dk-window pop" role="dialog" aria-label="${esc(title)}">
      <div class="dk-title"><img class="si" src="${icon('picture')}" alt="">${esc(title)}<span class="dk-tinfo"></span><button type="button" class="dk-wbtn close" data-cancel aria-label="Cancel"></button></div>
      <div class="dk-panel">
        <div class="gw-crop-stage" data-stage><canvas data-canvas></canvas><div class="gw-crop-frame" data-frame></div></div>
        <div class="gw-crop-row"><img class="si" src="${icon('zoom_out')}" alt="Zoom out"><input type="range" min="1" max="4" step="0.01" value="1" data-zoom aria-label="Zoom"><img class="si" src="${icon('zoom_in')}" alt="Zoom in"></div>
        <p class="gw-crop-note" data-note>Drag to move, scroll or use the slider to zoom.${animated ? ` Animated GIF (${frames.length} frames): it stays animated.` : ''}</p>
        <div class="gw-crop-row"><button type="button" class="dk-btn blue" data-save><img class="si" src="${icon('accept')}" alt="">Save</button><button type="button" class="dk-btn" data-cancel>Cancel</button></div>
      </div></div>`;
    document.body.append(veil);
    const $ = (q) => veil.querySelector(q), stage = $('[data-stage]'), canvas = $('[data-canvas]'), frameEl = $('[data-frame]'), zoomEl = $('[data-zoom]'), note = $('[data-note]');
    const SW = stage.clientWidth, SH = stage.clientHeight, dpr = devicePixelRatio || 1;
    canvas.width = SW * dpr; canvas.height = SH * dpr; canvas.style.width = SW + 'px'; canvas.style.height = SH + 'px';
    const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.imageSmoothingQuality = 'high';
    // The frame: as large as fits with a margin, centred.
    let bw = SW * 0.88, bh = bw / aspect; if (bh > SH * 0.88) { bh = SH * 0.88; bw = bh * aspect; }
    const bx = (SW - bw) / 2, by = (SH - bh) / 2;
    Object.assign(frameEl.style, { left: bx + 'px', top: by + 'px', width: bw + 'px', height: bh + 'px' });
    const cover = Math.max(bw / sw, bh / sh);
    let zoom = 1, cx = 0, cy = 0;   // image centre offset from the frame centre, in stage pixels
    const k = () => cover * zoom;
    const clamp = () => {
      const iw = sw * k(), ih = sh * k();
      cx = Math.max(-(iw - bw) / 2, Math.min((iw - bw) / 2, cx)); cy = Math.max(-(ih - bh) / 2, Math.min((ih - bh) / 2, cy));
    };
    let current = still, raf = 0, playing = animated, fi = 0, nextAt = 0;
    const draw = () => {
      const iw = sw * k(), ih = sh * k();
      g.clearRect(0, 0, SW, SH);
      g.drawImage(current, SW / 2 + cx - iw / 2, SH / 2 + cy - ih / 2, iw, ih);
    };
    const loop = (t) => {
      if (!playing) return;
      if (t >= nextAt) { fi = (fi + 1) % frames.length; current = frames[fi].image; nextAt = t + frames[fi].delay; draw(); }
      raf = requestAnimationFrame(loop);
    };
    if (animated) raf = requestAnimationFrame(loop);
    draw();

    let drag = null;
    stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx, cy }; stage.setPointerCapture(e.pointerId); stage.classList.add('grab'); });
    stage.addEventListener('pointermove', (e) => { if (!drag) return; cx = drag.cx + e.clientX - drag.x; cy = drag.cy + e.clientY - drag.y; clamp(); draw(); });
    const up = () => { drag = null; stage.classList.remove('grab'); };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    const setZoom = (z) => { const old = k(); zoom = Math.max(1, Math.min(4, z)); cx *= k() / old; cy *= k() / old; clamp(); zoomEl.value = String(zoom); draw(); };
    stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
    zoomEl.addEventListener('input', () => setZoom(+zoomEl.value));

    const done = (blob) => {
      playing = false; cancelAnimationFrame(raf);
      for (const f of frames ?? []) f.image.close?.();
      if (!frames) still.close?.();
      veil.remove(); document.removeEventListener('keydown', onKey, true);
      resolve(blob);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    for (const b of veil.querySelectorAll('[data-cancel]')) b.onclick = () => done(null);

    // The part of the picture under the frame, in the picture's own pixels.
    const source = () => {
      const iw = sw * k(), ih = sh * k(), ix = SW / 2 + cx - iw / 2, iy = SH / 2 + cy - ih / 2;
      return [(bx - ix) / k(), (by - iy) / k(), bw / k(), bh / k()];
    };
    $('[data-save]').onclick = async () => {
      const btns = veil.querySelectorAll('button'); for (const b of btns) b.disabled = true;
      playing = false; cancelAnimationFrame(raf);
      const [x, y, cw, ch] = source();
      try {
        if (!animated) {
          const tw = Math.min(w, Math.round(cw)), th = Math.round(tw / aspect);
          const c = new OffscreenCanvas(tw, th), cg = c.getContext('2d'); cg.imageSmoothingQuality = 'high';
          cg.drawImage(still, x, y, cw, ch, 0, 0, tw, th);
          let blob = await c.convertToBlob({ type: 'image/webp', quality: 0.88 });
          if (blob.type !== 'image/webp') blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
          return done(blob);
        }
        // Animated and left as it was (the frame covers the whole picture): the original file, untouched, if it fits.
        if (x <= 1 && y <= 1 && cw >= sw - 2 && ch >= sh - 2 && file.size <= limit) return done(file);
        // Animated: try the full size first, then smaller sizes and fewer frames until the GIF fits.
        const base = Math.min(w, Math.round(cw));
        for (const [scale, step] of [[1, 1], [0.8, 1], [0.8, 2], [0.62, 2], [0.5, 2], [0.5, 3], [0.4, 4]]) {
          const tw = Math.max(32, Math.round(base * scale)), th = Math.max(16, Math.round(tw / aspect));
          const c = new OffscreenCanvas(tw, th), cg = c.getContext('2d', { willReadFrequently: true }); cg.imageSmoothingQuality = 'high';
          const out = [];
          for (let i = 0; i < frames.length; i += step) {
            let delay = 0; for (let j = i; j < Math.min(i + step, frames.length); j++) delay += frames[j].delay;
            cg.clearRect(0, 0, tw, th); cg.drawImage(frames[i].image, x, y, cw, ch, 0, 0, tw, th);
            out.push({ data: cg.getImageData(0, 0, tw, th).data, delay });
            if (i % 8 === 0) { note.textContent = `Making the GIF (${tw}×${th})… ${Math.round((100 * i) / frames.length)}%`; await tick(); }
          }
          note.textContent = `Making the GIF (${tw}×${th})…`; await tick();
          const bytes = encodeGif(out, tw, th);
          if (bytes.length <= limit) return done(new Blob([bytes], { type: 'image/gif' }));
        }
        throw Error('This GIF is too long or too detailed to fit, even made smaller. Try a shorter one.');
      } catch (e) {
        note.textContent = e.message; for (const b of btns) b.disabled = false;
        if (animated) { playing = true; raf = requestAnimationFrame(loop); }
      }
    };
  });
}
