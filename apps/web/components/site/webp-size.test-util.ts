import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

/** The site's pictures live in apps/web/public; their paths start at the site root. */
export const publicFile = (src: string) =>
  new URL(`../../public${src}`, import.meta.url);

/** Width and height from a lossy or lossless WebP header. */
export function webpSize(file: URL): { width: number; height: number } {
  const b = readFileSync(file);
  expect(b.toString('ascii', 0, 4)).toBe('RIFF');
  expect(b.toString('ascii', 8, 12)).toBe('WEBP');
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ')
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return {
    width: 1 + b.readUIntLE(24, 3),
    height: 1 + b.readUIntLE(27, 3),
  };
}
