// Generates the PWA PNG icons without dependencies: verde-casa background and three rising bars.
// Placeholder: the brand icon (the 31 circled on green) is pending in docs/manual-de-marca.md.
// Usage: pnpm --filter @meta31/web icons  (the PNGs are committed in public/)
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x23, 0x42, 0x36]; // verde-casa
const FG = [0xff, 0xff, 0xff];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** padding: fraction of the side left empty on each edge (maskable safe zone). */
function icon(size, padding) {
  const inner = size * (1 - 2 * padding);
  const barW = inner / 5;
  const bars = [0.4, 0.65, 0.9].map((h, i) => ({
    x0: size * padding + barW * (2 * i) + barW * 0.0,
    x1: size * padding + barW * (2 * i + 1),
    y0: size * padding + inner * (1 - h),
    y1: size * padding + inner,
  }));
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const on = bars.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
      const [r, g, bl] = on ? FG : BG;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = bl;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/', import.meta.url);
writeFileSync(new URL('pwa-192.png', out), icon(192, 0.2));
writeFileSync(new URL('pwa-512.png', out), icon(512, 0.2));
writeFileSync(new URL('pwa-maskable-512.png', out), icon(512, 0.28));
writeFileSync(new URL('apple-touch-icon.png', out), icon(180, 0.2));
console.log('Icons generated in apps/web/public/');
