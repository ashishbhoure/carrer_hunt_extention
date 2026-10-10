// Generates simple brand icons (navy→violet rounded square + white paper-plane glyph) with no dependencies.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };

function inTri(px, py, a, b, c) {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const p = [px, py], d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
      let inside = true;
      if (cx < r && cy < r) inside = (r - cx - 0.5) ** 2 + (r - cy - 0.5) ** 2 <= r * r;
      if (!inside) { raw.writeUInt32BE(0, i); continue; }
      const t = (x + y) / (2 * size);
      let col = [Math.round(20 + 100 * t), Math.round(40 + 40 * t), Math.round(110 + 110 * t)];
      const s = size;
      const plane = inTri(x, y, [s * 0.2, s * 0.5], [s * 0.8, s * 0.22], [s * 0.62, s * 0.78]) && !inTri(x, y, [s * 0.44, s * 0.52], [s * 0.8, s * 0.22], [s * 0.5, s * 0.64]);
      if (plane) col = [255, 255, 255];
      raw[i] = col[0]; raw[i + 1] = col[1]; raw[i + 2] = col[2]; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync(new URL("../public/icons/", import.meta.url), { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(new URL(`../public/icons/icon${s}.png`, import.meta.url), icon(s));
console.log("icons written");
