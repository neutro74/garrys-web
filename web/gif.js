// Animated GIFs: reading the frames of one (WebCodecs ImageDecoder, where the browser has it) and writing a new one.
// Used to crop animated profile pictures and banners (web/crop.js) and by tools/brand/render.mjs for the animated banner.
// The encoder is plain JS over RGBA arrays, so it runs in the browser and in Node alike.
//   decodeGifFrames(blob, { maxFrames }) -> [{ image, delay }] | null   (image: a VideoFrame to draw; null when unsupported)
//   encodeGif(frames, w, h) -> Uint8Array                               (frames: [{ data: RGBA Uint8(Clamped)Array, delay ms }])

export async function decodeGifFrames(blob, { maxFrames = 300 } = {}) {
  if (typeof ImageDecoder === 'undefined') return null;
  try {
    if (!(await ImageDecoder.isTypeSupported('image/gif'))) return null;
    const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    const n = Math.min(dec.tracks.selectedTrack?.frameCount ?? 1, maxFrames), out = [];
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      out.push({ image, delay: Math.max(20, Math.round((image.duration ?? 100000) / 1000)) });
    }
    dec.close();
    return out;
  } catch { return null; }
}

// ---- Colour reduction: median cut over a 15-bit histogram, 255 colours plus one transparent index ----
// One palette for the whole animation (from every frame), so a changed patch is coloured and dithered exactly like the
// unchanged picture around it.
function palette(list) {
  const hist = new Uint32Array(32768);
  for (const rgba of list) for (let i = 0; i < rgba.length; i += 4) hist[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)]++;
  const used = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) used.push(k);
  if (!used.length) used.push(0);
  let boxes = [used];
  const ch = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  while (boxes.length < 255) {
    // split the box with the widest colour range (weighted by how many pixels it holds)
    let best = -1, bestScore = 0, bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      let n = 0; for (const k of b) n += hist[k];
      for (let c = 0; c < 3; c++) {
        let lo = 31, hi = 0; for (const k of b) { const v = ch(k, c); if (v < lo) lo = v; if (v > hi) hi = v; }
        const score = (hi - lo) * Math.sqrt(n);
        if (score > bestScore) { bestScore = score; best = i; bestCh = c; }
      }
    });
    if (best < 0) break;
    const b = boxes[best].sort((a, z) => ch(a, bestCh) - ch(z, bestCh));
    let total = 0; for (const k of b) total += hist[k];
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += hist[b[i]]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, b.slice(0, cut), b.slice(cut));
  }
  const colors = new Uint8Array(256 * 3), map = new Uint8Array(32768);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const k of b) { const c = hist[k]; r += (k >> 10) * c; g += ((k >> 5) & 31) * c; bl += (k & 31) * c; n += c; map[k] = i; }
    n = n || 1;
    const v = (x) => Math.min(255, Math.round((x / n) * 8 + 4));   // the middle of each 8-wide bucket
    colors[i * 3] = v(r); colors[i * 3 + 1] = v(g); colors[i * 3 + 2] = v(bl);
  });
  return { colors, map };
}

// ---- LZW, as GIF wants it (variable code width up to 12 bits) ----
function lzw(indices, minSize = 8) {
  const out = [], clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, next = eoi + 1, cur = 0, bits = 0;
  const put = (code) => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  let dict = new Map();
  put(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 4096 + k, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    put(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > 1 << size && size < 12) size++; }
    else { put(clear); dict = new Map(); size = minSize + 1; next = eoi + 1; }
    prefix = k;
  }
  put(prefix); put(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.47) * 10);
export function encodeGif(frames, w, h) {
  const bytes = [];
  const u16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
  const str = (s) => { for (const c of s) bytes.push(c.charCodeAt(0)); };
  const { colors, map } = palette(frames.map((f) => f.data));
  str('GIF89a'); u16(w); u16(h); bytes.push(0xf7, 0, 0);                            // global table of 256 colours
  for (let i = 0; i < 768; i++) bytes.push(colors[i]);
  bytes.push(0x21, 0xff, 11); str('NETSCAPE2.0'); bytes.push(3, 1, 0, 0, 0);        // loop forever
  const TRANSPARENT = 255;
  frames.forEach((f, n) => {
    const d = f.data, px = w * h;
    // Pixels that did not change since the previous frame become transparent, so they cost almost nothing and keep
    // exactly what is on screen. (Compared with the previous source frame, not with the dithered output, so nothing drifts.)
    let same = null;
    if (n > 0) {
      const prev = frames[n - 1].data; same = new Uint8Array(px);
      for (let p = 0; p < px; p++) {
        const i = p * 4;
        if (Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]) <= 6) same[p] = 1;
      }
    }
    const idx = new Uint8Array(px);
    for (let p = 0; p < px; p++) {
      if (same && same[p]) { idx[p] = TRANSPARENT; continue; }
      // A fixed 4x4 ordered dither before picking the colour: smooth gradients stay smooth, and it does not shimmer
      // from frame to frame the way error diffusion would.
      const i = p * 4, t = BAYER[((p / w | 0) & 3) * 4 + (p % w & 3)];
      const r = Math.max(0, Math.min(255, d[i] + t)), g = Math.max(0, Math.min(255, d[i + 1] + t)), b = Math.max(0, Math.min(255, d[i + 2] + t));
      const c = map[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
      idx[p] = c;
    }
    const delay = Math.max(2, Math.round((f.delay ?? 100) / 10));
    bytes.push(0x21, 0xf9, 4, (1 << 2) | 1); u16(delay); bytes.push(TRANSPARENT, 0);  // keep the frame, index 255 transparent
    bytes.push(0x2c); u16(0); u16(0); u16(w); u16(h); bytes.push(0);                  // uses the global table
    bytes.push(8);
    const data = lzw(idx);
    for (let i = 0; i < data.length; i += 255) { const part = data.slice(i, i + 255); bytes.push(part.length, ...part); }
    bytes.push(0);
  });
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
