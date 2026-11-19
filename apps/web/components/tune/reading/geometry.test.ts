import { describe, expect, it } from 'vitest';

import {
  boxWidthPx,
  comfortStartPx,
  ladderStartPx,
  linesAt,
  maxFitHeightPx,
  maxFitPx,
  MIN_CHARS_LARGE_PRINT,
  stepComfort,
  tuneChromeScale,
  wordCount,
} from './geometry';

describe('reading geometry', () => {
  it('starts the comfortable size at max(1.5 x default, 24 px)', () => {
    expect(comfortStartPx(16)).toBe(24);
    expect(comfortStartPx(20)).toBe(30);
    expect(comfortStartPx(12)).toBe(24);
  });

  it('steps by 0.1 log within bounds', () => {
    expect(stepComfort(24, 1, { minPx: 10, maxPx: 120 })).toBeCloseTo(30.2, 1);
    expect(stepComfort(24, -1, { minPx: 10, maxPx: 120 })).toBeCloseTo(19.1, 1);
    expect(stepComfort(110, 1, { minPx: 10, maxPx: 120 })).toBe(120);
    expect(stepComfort(11, -1, { minPx: 10, maxPx: 120 })).toBe(10);
  });

  it('fits at least 13 characters (8 on large print) in 90% of the width', () => {
    expect(maxFitPx(650, 0.5)).toBe(90);
    expect(maxFitPx(650, 0.5, MIN_CHARS_LARGE_PRINT)).toBeCloseTo(146.3, 1);
  });

  it('sizes the box at about 22 characters and never wider than the space', () => {
    expect(boxWidthPx(20, 0.5, 600)).toBe(220);
    expect(boxWidthPx(80, 0.5, 600)).toBe(600);
  });

  it('starts the ladder 0.3 log above comfortable, capped at S_fit', () => {
    expect(ladderStartPx(24, 200)).toBeCloseTo(47.9, 1);
    expect(ladderStartPx(24, 40)).toBe(40);
  });

  it('scales the chrome only past the starting size, up to 2x', () => {
    expect(tuneChromeScale(24, 16)).toBe(1);
    expect(tuneChromeScale(18, 16)).toBe(1);
    expect(tuneChromeScale(30, 16)).toBe(1.25);
    expect(tuneChromeScale(120, 16)).toBe(2);
    expect(tuneChromeScale(36, 24)).toBe(1);
    expect(tuneChromeScale(Number.NaN, 16)).toBe(1);
  });

  it('sets a 55-60 character sentence in 3 lines of the 22-character box', () => {
    const box = boxWidthPx(24, 0.5, 800);
    expect(linesAt(24, 0.5, box)).toBe(3);
    // A narrow stage takes more lines.
    expect(linesAt(24, 0.5, 150)).toBeGreaterThan(3);
  });

  it('keeps a sentence inside the stage it is given, so the answers stay in view', () => {
    const fit = (heightPx: number, widthPx: number) =>
      maxFitHeightPx({
        heightPx,
        widthPx,
        advanceEm: 0.5,
        lineHeight: 1.3,
        maxPx: 120,
      });
    for (const [h, w] of [
      [296, 656],
      [96, 1062],
      [128, 326],
    ] as const) {
      const px = fit(h, w);
      const lines = linesAt(px, 0.5, boxWidthPx(px, 0.5, w));
      expect(lines * px * 1.3).toBeLessThanOrEqual(h);
    }
    // More room never gives a smaller size; no room at all changes nothing.
    expect(fit(296, 656)).toBeGreaterThanOrEqual(fit(96, 656));
    expect(fit(0, 656)).toBe(120);
    // Padding around the text (the light and dark boxes) counts against the room.
    expect(
      maxFitHeightPx({
        heightPx: 200,
        widthPx: 600,
        advanceEm: 0.5,
        lineHeight: 1.3,
        maxPx: 120,
        insetBlockPx: 32,
        insetInlinePx: 40,
      }),
    ).toBeLessThan(fit(200, 600));
  });

  it('counts words', () => {
    expect(wordCount('  Most people open their front doors. ')).toBe(6);
  });
});
