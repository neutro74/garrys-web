// Minimal VTF reader: the largest mip of the first frame as RGBA8. Used only to pull game sprites for brand artwork.
export function decodeVtf(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (String.fromCharCode(...b.subarray(0, 3)) !== 'VTF') throw Error('not a VTF');
  const w = dv.getUint16(16, true), h = dv.getUint16(18, true), fmt = dv.getInt32(52, true);
  const BPP = { 0: 4, 1: 4, 2: 3, 3: 3, 11: 4, 12: 4, 16: 4 };   // RGBA, ABGR, RGB, BGR, ARGB, BGRA, BGRX
  const size = fmt === 13 ? Math.max(1, w >> 2) * Math.max(1, h >> 2) * 8 : fmt === 14 || fmt === 15 ? Math.max(1, w >> 2) * Math.max(1, h >> 2) * 16 : w * h * (BPP[fmt] ?? 0);
  if (!size) throw Error(`unsupported VTF format ${fmt}`);
  const src = b.subarray(b.length - size), out = new Uint8Array(w * h * 4);
  if (BPP[fmt]) {
    const n = BPP[fmt];
    for (let i = 0; i < w * h; i++) {
      const p = src.subarray(i * n, i * n + n); let r, g, bb, a = 255;
      if (fmt === 0) [r, g, bb, a] = p; else if (fmt === 1) [a, bb, g, r] = p; else if (fmt === 2) [r, g, bb] = p; else if (fmt === 3) [bb, g, r] = p;
      else if (fmt === 11) [a, r, g, bb] = p; else if (fmt === 12) [bb, g, r, a] = p; else [bb, g, r] = p;
      out.set([r, g, bb, a], i * 4);
    }
    return { w, h, rgba: out };
  }
  const c565 = (v) => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31];
  const bw = Math.max(1, w >> 2), blk = fmt === 13 ? 8 : 16;
  for (let by = 0; by < Math.max(1, h >> 2); by++) for (let bx = 0; bx < bw; bx++) {
    const o = (by * bw + bx) * blk, co = fmt === 13 ? o : o + 8, a = new Array(16).fill(255);
    if (fmt === 14) for (let i = 0; i < 16; i++) a[i] = ((src[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
    if (fmt === 15) {
      const a0 = src[o], a1 = src[o + 1], al = [a0, a1];
      if (a0 > a1) for (let i = 1; i < 7; i++) al.push(((7 - i) * a0 + i * a1) / 7); else { for (let i = 1; i < 5; i++) al.push(((5 - i) * a0 + i * a1) / 5); al.push(0, 255); }
      let bits = 0n; for (let i = 0; i < 6; i++) bits |= BigInt(src[o + 2 + i]) << BigInt(8 * i);
      for (let i = 0; i < 16; i++) a[i] = al[Number((bits >> BigInt(3 * i)) & 7n)];
    }
    const v0 = src[co] | (src[co + 1] << 8), v1 = src[co + 2] | (src[co + 3] << 8), c0 = c565(v0), c1 = c565(v1);
    const pal = [c0, c1, ...(v0 > v1 || fmt !== 13 ? [c0.map((x, k) => (2 * x + c1[k]) / 3), c0.map((x, k) => (x + 2 * c1[k]) / 3)] : [c0.map((x, k) => (x + c1[k]) / 2), [0, 0, 0]])];
    const idx = src[co + 4] | (src[co + 5] << 8) | (src[co + 6] << 16) | (src[co + 7] << 24);
    for (let i = 0; i < 16; i++) {
      const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2); if (x >= w || y >= h) continue;
      const k = (idx >>> (2 * i)) & 3, c = pal[k], alpha = fmt === 13 && v0 <= v1 && k === 3 ? 0 : a[i];
      out.set([c[0], c[1], c[2], alpha], (y * w + x) * 4);
    }
  }
  return { w, h, rgba: out };
}
