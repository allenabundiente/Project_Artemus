// Renders the canonical sprite grids (src/game/sprites.ts) into PNG files
// under public/sprites/, ready to be swapped for hand-drawn art later.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SPRITES, renderGrid } from '../src/game/spriteGrids.js';
import { AVATAR_GRIDS } from '../src/game/avatarGrids.js';

// --- minimal PNG encoder ----------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >> 1) : c >> 1;
  CRC_TABLE[n] = c;
}
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >> 8);
  return c ^ 0xffffffff;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  out.set(len, 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = new Uint8Array(4);
  const tag = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  new DataView(crc.buffer).setUint32(0, crc32(new Uint8Array(tag)));
  out.set(crc, 8 + data.length);
  return out;
}

function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // filter byte 0 per scanline
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    raw.set(rgba.slice(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    Buffer.from(sig),
    Buffer.from(chunk('IHDR', ihdr)),
    Buffer.from(chunk('IDAT', idat)),
    Buffer.from(chunk('IEND', new Uint8Array(0))),
  ]);
}

// --- generate ---------------------------------------------------------------

const allSprites = [...SPRITES, ...AVATAR_GRIDS];
const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/sprites');
fs.mkdirSync(outDir, { recursive: true });

for (const sprite of allSprites) {
  const { width, height, rgba } = renderGrid(sprite.grid);
  const png = encodePng(width, height, rgba);
  fs.writeFileSync(path.join(outDir, `${sprite.name}.png`), png);
  console.log(`wrote ${sprite.name}.png (${width}x${height}, ${png.length}b)`);
}

// Manifest: every sprite slot the engine can use, with the grid-derived size
// and the grid fallback flag. Hand-drawn replacements in public/sprites/ should
// keep the SAME dimensions; add brand-new slots by appending here.
const manifest: Record<string, { width: number; height: number; gridFallback: boolean }> = {};
for (const sprite of allSprites) {
  const { width, height } = renderGrid(sprite.grid);
  manifest[sprite.name] = { width, height, gridFallback: true };
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote manifest.json (${Object.keys(manifest).length} slots)`);
console.log(`done -> ${outDir}`);