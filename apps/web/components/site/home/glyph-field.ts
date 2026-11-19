/**
 * The hero's glyph field: a grid of letters on the page's own canvas colour,
 * with slow diagonal light beams. Letters inside a beam darken, sit on a faint
 * tile and change faster; letters outside barely show and change now and then.
 * The field clears behind the hero's words and fades at every edge, so the
 * promise always reads on plain white.
 *
 * This module is the drawing model only (no React), so the maths can be tested.
 */

/** Lower and upper case, the only characters the field shows. */
export const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Cell and type sizes in CSS px. Monospaced, so every cell is the same. */
export const CELL = { w: 18, h: 22, font: 12.5 } as const;

/** Letter opacity outside a beam, and the extra a beam adds at its centre. */
export const INK = { base: 0.07, beam: 0.34, tile: 0.05 } as const;

/**
 * Chance per frame (30 a second) that a letter changes. Every letter turns
 * over about once a second; inside a beam, several times a second.
 */
export const SCRAMBLE = { base: 0.035, beam: 0.3 } as const;

/** Beams travel along this angle (radians from the x axis). */
const ANGLE = (28 * Math.PI) / 180;
const COS = Math.cos(ANGLE);
const SIN = Math.sin(ANGLE);

/** Three beams of different widths and speeds, spread across one cycle. */
const BEAMS = [
  { phase: 0, sigma: 70, speed: 46 },
  { phase: 0.42, sigma: 46, speed: 38 },
  { phase: 0.71, sigma: 96, speed: 30 },
] as const;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FieldGrid {
  cols: number;
  rows: number;
  /** Left offset so the grid sits centred in the field. */
  ox: number;
  /** Per cell: how much of the field shows there (edges and the clear area). */
  mask: Float32Array;
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * The grid for a field of `width` x `height`, with the area behind the hero's
 * words (`clear`, in field coordinates) faded to nothing.
 */
export function buildGrid(
  width: number,
  height: number,
  clear: Box | null,
): FieldGrid {
  const cols = Math.max(1, Math.ceil(width / CELL.w));
  const rows = Math.max(1, Math.ceil(height / CELL.h));
  const ox = (width - cols * CELL.w) / 2;
  const mask = new Float32Array(cols * rows);
  // The clear area is an ellipse a little larger than the words' box.
  const cx = clear ? (clear.x0 + clear.x1) / 2 : 0;
  const cy = clear ? (clear.y0 + clear.y1) / 2 : 0;
  const rx = clear ? Math.max(1, ((clear.x1 - clear.x0) / 2) * 1.12) : 1;
  const ry = clear ? Math.max(1, ((clear.y1 - clear.y0) / 2) * 1.22) : 1;
  const bottomFade = Math.min(260, height * 0.4);
  for (let r = 0; r < rows; r++) {
    const y = r * CELL.h + CELL.h / 2;
    const vertical =
      smooth(0, 72, y) * (1 - smooth(height - bottomFade, height, y));
    for (let c = 0; c < cols; c++) {
      const x = ox + c * CELL.w + CELL.w / 2;
      const sides = smooth(0, 48, x) * (1 - smooth(width - 48, width, x));
      let open = 1;
      if (clear) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        open = smooth(0.82, 1.32, d);
      }
      mask[r * cols + c] = vertical * sides * open;
    }
  }
  return { cols, rows, ox, mask };
}

/**
 * How strongly the beams light a point at time `t` (seconds): 0 to 1. Beams
 * cross the whole field (`span` px along their direction) and wrap around.
 */
export function beamAt(x: number, y: number, t: number, span: number): number {
  const s = x * COS + y * SIN;
  const cycle = span + 400;
  let light = 0;
  for (const beam of BEAMS) {
    const centre =
      ((((beam.phase * cycle + beam.speed * t) % cycle) + cycle) % cycle) - 200;
    const d = (s - centre) / beam.sigma;
    light = Math.max(light, Math.exp(-0.5 * d * d));
  }
  return light;
}

/** The distance the beams travel to cross a field of this size. */
export function beamSpan(width: number, height: number): number {
  return width * COS + height * SIN;
}

/**
 * The letter sheet's layout in device pixels: every cell a whole number of
 * pixels, with a clear gap between cells so a wide letter can never show in
 * its neighbour's cell. Frames copy cell `i` from `x = i * stride`.
 */
export function atlasCell(dpr: number): {
  w: number;
  h: number;
  stride: number;
} {
  const w = Math.round(CELL.w * dpr);
  const h = Math.round(CELL.h * dpr);
  return { w, h, stride: w + 2 * Math.ceil(dpr) };
}

/** A letter's drawn ink, from `measureText` (left/right of the pen, up/down from the baseline). */
export interface Ink {
  left: number;
  right: number;
  ascent: number;
  descent: number;
}

/**
 * Where to put the pen (left-aligned, alphabetic baseline) so the letter's
 * ink sits in the middle of a `w` x `h` cell, across and down.
 */
export function centredPen(
  w: number,
  h: number,
  ink: Ink,
): { x: number; y: number } {
  const inkW = ink.left + ink.right;
  const inkH = ink.ascent + ink.descent;
  return { x: (w - inkW) / 2 + ink.left, y: (h - inkH) / 2 + ink.ascent };
}

/** A random index into GLYPHS. */
export function randomGlyph(random: () => number = Math.random): number {
  return Math.floor(random() * GLYPHS.length);
}
