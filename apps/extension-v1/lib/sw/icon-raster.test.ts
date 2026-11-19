import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { iconPaths } from './badge';
import { ICON_SIZES, iconFile, renderIcon, type IconKind } from './icon-raster';

const ICON_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
  'icons',
);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, crc]);
}

function encodePng(rgba: Uint8ClampedArray, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

function decodePng(file: Buffer): { size: number; rgba: Uint8Array } {
  let off = 8;
  let size = 0;
  const idat: Buffer[] = [];
  while (off < file.length) {
    const len = file.readUInt32BE(off);
    const type = file.toString('ascii', off + 4, off + 8);
    const data = file.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') size = data.readUInt32BE(0);
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    raw.copy(
      rgba,
      y * size * 4,
      y * (size * 4 + 1) + 1,
      (y + 1) * (size * 4 + 1),
    );
  return { size, rgba };
}

const KINDS: IconKind[] = ['ink', 'paused', 'cant'];

describe('toolbar icons', () => {
  if (process.env.WEBABLE_WRITE_ICONS === '1') {
    it('writes public/icons', () => {
      mkdirSync(ICON_DIR, { recursive: true });
      for (const kind of KINDS)
        for (const size of ICON_SIZES)
          writeFileSync(
            join(ICON_DIR, iconFile(kind, size)),
            encodePng(renderIcon(kind, size), size),
          );
    });
  }

  it('committed PNGs match the geometry', () => {
    for (const kind of KINDS) {
      for (const size of ICON_SIZES) {
        const file = join(ICON_DIR, iconFile(kind, size));
        expect(existsSync(file), file).toBe(true);
        const { size: s, rgba } = decodePng(readFileSync(file));
        expect(s).toBe(size);
        expect(
          Buffer.from(rgba).equals(Buffer.from(renderIcon(kind, size))),
        ).toBe(true);
      }
    }
  });

  it('the tile is ink with a paper mark, corners transparent', () => {
    const px = renderIcon('ink', 32);
    const at = (x: number, y: number) => [
      ...px.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4),
    ];
    expect(at(0, 0)[3]).toBeLessThan(128); // rounded corner
    expect(at(16, 30)).toEqual([0x1a, 0x1a, 0x17, 255]); // tile below the mark
    const markPixel = at(16, 10); // the dimension line at y = 8/24 * 32 ~ 10.7
    expect(markPixel[0]).toBeGreaterThan(200);
  });

  it('paused and can-not-run use the grey tile', () => {
    for (const kind of ['paused', 'cant'] as const) {
      const px = renderIcon(kind, 32);
      const i = (30 * 32 + 16) * 4;
      expect([...px.slice(i, i + 3)]).toEqual([0x7d, 0x7c, 0x73]);
    }
  });

  it('badge icon paths point at files that exist', () => {
    for (const kind of KINDS)
      for (const path of Object.values(iconPaths(kind)))
        expect(existsSync(join(ICON_DIR, '..', path))).toBe(true);
  });
});
