import { describe, expect, it } from 'vitest';

import {
  BLACK,
  contrastRatio,
  formatRatio,
  luminance,
  oklchToRgb,
  over,
  parseColor,
  rgbaToCss,
  rgbToOklch,
  solveForeground,
  WHITE,
  type RGBA,
} from '../../../lib/engine/util/color';

describe('parseColor', () => {
  it('parses computed rgb/rgba in legacy and modern syntax', () => {
    expect(parseColor('rgb(153, 153, 153)')).toEqual([153, 153, 153, 1]);
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5]);
    expect(parseColor('rgb(18 32 64 / 50%)')).toEqual([18, 32, 64, 0.5]);
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
  });

  it('parses hex and color(srgb)', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#1a1a17')).toEqual([26, 26, 23, 1]);
    expect(parseColor('#00000080')?.[3]).toBeCloseTo(0.5, 2);
    expect(parseColor('color(srgb 1 0 0)')).toEqual([255, 0, 0, 1]);
  });

  it('returns null for unknown syntax without a fallback', () => {
    expect(parseColor('oklch(0.5 0.1 120)')).toBeNull();
  });
});

describe('WCAG 2 contrast', () => {
  it('matches known values', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio([153, 153, 153, 1], WHITE)).toBeCloseTo(2.85, 2);
    expect(contrastRatio([118, 118, 118, 1], WHITE)).toBeCloseTo(4.54, 2);
    // Design tokens: ink on canvas is 16.68 (design-final.md 6).
    expect(contrastRatio([26, 26, 23, 1], [250, 250, 247, 1])).toBeCloseTo(
      16.68,
      1,
    );
  });

  it('composites translucent foregrounds and backgrounds', () => {
    const half: RGBA = [0, 0, 0, 0.5];
    expect(over(half, WHITE)[0]).toBeCloseTo(127.5, 5);
    expect(contrastRatio(half, WHITE)).toBeCloseTo(
      contrastRatio(over(half, WHITE), WHITE),
      5,
    );
  });

  it('luminance is 0 for black and 1 for white', () => {
    expect(luminance(BLACK)).toBe(0);
    expect(luminance(WHITE)).toBeCloseTo(1, 10);
  });
});

describe('OKLCH solver', () => {
  it('round-trips sRGB through OKLCH', () => {
    for (const c of [
      [45, 106, 62, 1],
      [200, 30, 40, 1],
      [12, 99, 180, 1],
    ] as RGBA[]) {
      const { l, c: ch, h } = rgbToOklch(c);
      const back = oklchToRgb(l, ch, h);
      for (let i = 0; i < 3; i++)
        expect(Math.abs((back[i] ?? 0) - (c[i] ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it('reaches the target with the smallest lightness change, keeping hue', () => {
    const fg: RGBA = [120, 150, 200, 1]; // faint blue on white
    const s = solveForeground(fg, WHITE, 4.5);
    expect(s.reached).toBe(true);
    expect(s.ratio).toBeGreaterThanOrEqual(4.5);
    expect(s.ratio).toBeLessThan(4.9); // smallest change, not "go to black"
    const h0 = rgbToOklch(fg).h;
    const h1 = rgbToOklch(s.color).h;
    expect(Math.abs(h0 - h1)).toBeLessThan(6);
  });

  it('moves lighter on dark backgrounds', () => {
    const s = solveForeground([80, 80, 80, 1], [20, 20, 20, 1], 7);
    expect(s.reached).toBe(true);
    expect(luminance(s.color)).toBeGreaterThan(luminance([80, 80, 80, 1]));
  });

  it('leaves passing pairs alone and snaps to a pole at maximum', () => {
    const ok = solveForeground(BLACK, WHITE, 4.5);
    expect(ok.color).toEqual(BLACK);
    expect(solveForeground([150, 150, 150, 1], WHITE, 21).color).toEqual(BLACK);
    expect(
      solveForeground([150, 150, 150, 1], [10, 10, 10, 1], 21).color,
    ).toEqual(WHITE);
  });

  it('reports unreachable targets honestly', () => {
    const mid: RGBA = [118, 118, 118, 1];
    const s = solveForeground([120, 120, 120, 1], mid, 7);
    expect(s.reached).toBe(false);
  });
});

describe('formatting', () => {
  it('formats css and ratios', () => {
    expect(rgbaToCss([1, 2, 3, 1])).toBe('rgb(1 2 3)');
    expect(rgbaToCss([1, 2, 3, 0.5])).toBe('rgb(1 2 3 / 0.5)');
    expect(formatRatio(2.849)).toBe('2.8:1');
    expect(formatRatio(4.5)).toBe('4.5:1');
    expect(formatRatio(21)).toBe('21:1');
  });
});
