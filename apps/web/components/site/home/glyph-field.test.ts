import { describe, expect, it } from 'vitest';
import {
  CELL,
  GLYPHS,
  atlasCell,
  beamAt,
  beamSpan,
  buildGrid,
  centredPen,
  randomGlyph,
} from './glyph-field';

describe('the hero glyph field', () => {
  it('shows only letters, lower and upper case', () => {
    expect(GLYPHS).toMatch(/^[a-zA-Z]+$/);
    expect(new Set(GLYPHS).size).toBe(52);
    expect(GLYPHS[randomGlyph(() => 0)]).toBe('a');
    expect(GLYPHS[randomGlyph(() => 0.9999)]).toBe('Z');
  });

  it('covers the field with whole cells, centred', () => {
    const grid = buildGrid(1000, 600, null);
    expect(grid.cols).toBe(Math.ceil(1000 / CELL.w));
    expect(grid.rows).toBe(Math.ceil(600 / CELL.h));
    expect(grid.mask).toHaveLength(grid.cols * grid.rows);
    expect(grid.ox).toBeCloseTo((1000 - grid.cols * CELL.w) / 2);
  });

  it('fades out at every edge and shows fully in between', () => {
    const { cols, rows, mask } = buildGrid(1200, 800, null);
    const at = (c: number, r: number) => mask[r * cols + c] ?? -1;
    expect(at(0, 0)).toBeLessThan(0.1);
    expect(at(cols - 1, 0)).toBeLessThan(0.1);
    expect(at(0, rows - 1)).toBeLessThan(0.1);
    expect(at(Math.floor(cols / 2), rows - 1)).toBeLessThan(0.1);
    expect(at(Math.floor(cols / 2), Math.floor(rows / 3))).toBeGreaterThan(0.9);
  });

  it('keeps clear of the hero words', () => {
    const clear = { x0: 400, y0: 200, x1: 800, y1: 400 };
    const { cols, mask, ox } = buildGrid(1200, 800, clear);
    const cellAt = (x: number, y: number) =>
      mask[Math.floor(y / CELL.h) * cols + Math.floor((x - ox) / CELL.w)] ?? -1;
    // Behind the words: nothing, out to the middle of each edge. The clear area
    // is an ellipse, so the field fades back in past the box's corners.
    expect(cellAt(600, 300)).toBe(0);
    expect(cellAt(410, 300)).toBeLessThan(0.1);
    expect(cellAt(790, 300)).toBeLessThan(0.1);
    expect(cellAt(600, 205)).toBeLessThan(0.1);
    expect(cellAt(600, 395)).toBeLessThan(0.1);
    expect(cellAt(150, 300)).toBeGreaterThan(0.9);
  });

  it('lights points between none and full, and moves with time', () => {
    const span = beamSpan(1200, 800);
    const samples: number[] = [];
    for (let t = 0; t < 60; t += 1.7)
      for (let x = 0; x <= 1200; x += 150)
        samples.push(beamAt(x, 300, t, span));
    for (const v of samples) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...samples)).toBeGreaterThan(0.9);
    expect(Math.min(...samples)).toBeLessThan(0.1);
    expect(beamAt(600, 300, 0, span)).not.toBeCloseTo(
      beamAt(600, 300, 5, span),
    );
  });

  it('lays the letter sheet out in whole pixels with a gap between cells', () => {
    for (const dpr of [1, 1.25, 1.5, 1.8, 2]) {
      const cell = atlasCell(dpr);
      expect(Number.isInteger(cell.w)).toBe(true);
      expect(Number.isInteger(cell.h)).toBe(true);
      expect(Number.isInteger(cell.stride)).toBe(true);
      expect(cell.stride).toBeGreaterThan(cell.w);
      // The last letter's cell starts exactly where the frames copy it from.
      expect((GLYPHS.length - 1) * cell.stride + cell.w).toBeLessThanOrEqual(
        GLYPHS.length * cell.stride,
      );
    }
  });

  it('puts each letter’s ink in the middle of its cell', () => {
    const w = 36;
    const h = 44;
    for (const ink of [
      { left: 0, right: 14, ascent: 18, descent: 0 }, // a capital
      { left: -2, right: 6, ascent: 19, descent: 0 }, // a narrow "l"
      { left: 1, right: 13, ascent: 13, descent: 6 }, // a "g" below the line
    ]) {
      const pen = centredPen(w, h, ink);
      const inkLeft = pen.x - ink.left;
      const inkRight = pen.x + ink.right;
      const inkTop = pen.y - ink.ascent;
      const inkBottom = pen.y + ink.descent;
      expect((inkLeft + inkRight) / 2).toBeCloseTo(w / 2);
      expect((inkTop + inkBottom) / 2).toBeCloseTo(h / 2);
    }
  });
});
