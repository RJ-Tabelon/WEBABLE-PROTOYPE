/**
 * The toolbar icon, drawn from geometry (design-final 10.4 and 11.3): an ink
 * tile (#1A1A17, radius 4 at 16 px) carrying the mark in paper (#FAFAF7), so
 * it reads on light and dark toolbars. Paused and off use a #7D7C73 tile with
 * two bars; can't-run uses the grey tile with the ring-and-slash glyph.
 *
 * public/icons/*.png are generated from this file; a unit test keeps them
 * identical (WEBABLE_WRITE_ICONS=1 regenerates them).
 */
export type IconKind = 'ink' | 'paused' | 'cant';

type RGB = readonly [number, number, number];
const INK: RGB = [0x1a, 0x1a, 0x17];
const GREY: RGB = [0x7d, 0x7c, 0x73];
const PAPER: RGB = [0xfa, 0xfa, 0xf7];

/** Sizes shipped: 16/24/32 for the toolbar, 48/128 for the extensions page and store. */
export const ICON_SIZES = [16, 24, 32, 48, 128] as const;

type Shape = (x: number, y: number) => boolean;

function segment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): Shape {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  return (x, y) => {
    const t =
      len2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const px = ax + t * dx - x;
    const py = ay + t * dy - y;
    return px * px + py * py <= r * r;
  };
}

function roundRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
): Shape {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + r, Math.min(x1 - r, x));
    const cy = Math.max(y0 + r, Math.min(y1 - r, y));
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
}

function ring(cx: number, cy: number, radius: number, w: number): Shape {
  return (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - radius) <= w / 2;
}

const any =
  (shapes: Shape[]): Shape =>
  (x, y) =>
    shapes.some((s) => s(x, y));

/** The glyph in icon pixels for a kind and size. */
function glyph(kind: IconKind, size: number): Shape {
  const u = size / 24; // the mark's 24-unit grid spans the tile
  const w = Math.max(1.5, size / 12);
  const r = w / 2;
  const L = (x1: number, y1: number, x2: number, y2: number): Shape =>
    segment(x1 * u, y1 * u, x2 * u, y2 * u, r);
  if (kind === 'ink') {
    return any([
      L(6, 8, 18, 8),
      L(6, 5, 6, 11),
      L(18, 5, 18, 11),
      L(6, 14, 18, 14),
      L(6, 18, 14, 18),
    ]);
  }
  // Status glyphs are on a 16 grid; centre them in the tile at 3/4 scale.
  const g = (size * 0.75) / 16;
  const off = (size - 16 * g) / 2;
  const P = (v: number): number => off + v * g;
  if (kind === 'paused') {
    const bw = Math.max(1.5, 2 * g);
    return any([
      roundRect(P(5), P(4), P(5) + bw, P(12), Math.min(bw / 2, 0.5 * g)),
      roundRect(P(11) - bw, P(4), P(11), P(12), Math.min(bw / 2, 0.5 * g)),
    ]);
  }
  const sw = Math.max(1.5, 1.75 * g);
  return any([
    ring(P(8), P(8), 6 * g, sw),
    segment(P(3.76), P(3.76), P(12.24), P(12.24), sw / 2),
  ]);
}

/** RGBA pixels (row-major, straight alpha) for one icon, 4x4 supersampled. */
export function renderIcon(kind: IconKind, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const tile = roundRect(0, 0, size, size, size / 4);
  const mark = glyph(kind, size);
  const base = kind === 'ink' ? INK : GREY;
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tileHits = 0;
      let markHits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S;
          const y = py + (sy + 0.5) / S;
          if (!tile(x, y)) continue;
          tileHits++;
          if (mark(x, y)) markHits++;
        }
      }
      const i = (py * size + px) * 4;
      if (tileHits === 0) continue;
      const m = markHits / tileHits;
      out[i] = Math.round(base[0] * (1 - m) + PAPER[0] * m);
      out[i + 1] = Math.round(base[1] * (1 - m) + PAPER[1] * m);
      out[i + 2] = Math.round(base[2] * (1 - m) + PAPER[2] * m);
      out[i + 3] = Math.round((tileHits / (S * S)) * 255);
    }
  }
  return out;
}

/** File name under public/icons for a kind and size (the ink set is the manifest icon set). */
export function iconFile(kind: IconKind, size: number): string {
  return kind === 'ink' ? `${size}.png` : `${kind}-${size}.png`;
}
