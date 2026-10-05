/**
 * Renders the launcher icons from the same shapes as public/icon.svg.
 * Kept as a script (run `npm run icons`) so the PNGs stay reproducible
 * without pulling in an image toolchain.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../public');

const TEAL = [15, 118, 110, 255];
const LIGHT = [248, 250, 252, 255];
const MINT = [204, 251, 241, 255];

function render(size) {
  const s = size / 512;
  const pixels = Buffer.alloc(size * size * 4);

  const put = (x, y, colour) => {
    const offset = (y * size + x) * 4;
    pixels[offset] = colour[0];
    pixels[offset + 1] = colour[1];
    pixels[offset + 2] = colour[2];
    pixels[offset + 3] = colour[3];
  };

  const inRect = (x, y, x0, y0, x1, y1) => x >= x0 * s && x < x1 * s && y >= y0 * s && y < y1 * s;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let colour = TEAL;

      // Awning: a trapezium from (112,196) to (400,196).
      if (y >= 116 * s && y < 196 * s) {
        const progress = (y / s - 116) / 80;
        const left = 152 - 40 * progress;
        const right = 360 + 40 * progress;
        if (x >= left * s && x < right * s) colour = LIGHT;
      }

      if (inRect(x, y, 136, 208, 376, 396)) colour = MINT;
      if (inRect(x, y, 176, 300, 256, 396)) colour = TEAL;
      if (inRect(x, y, 288, 300, 360, 356)) colour = TEAL;

      put(x, y, colour);
    }
  }

  return encodePng(size, size, pixels);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

mkdirSync(publicDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(resolve(publicDir, `icon-${size}.png`), render(size));
}
console.log('Wrote icon-192.png and icon-512.png');
