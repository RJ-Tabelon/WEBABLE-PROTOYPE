import { describe, expect, test } from 'vitest';
import { DEMO_FITS } from '../../src/fit/derive';
import { compressiveExponent, mapFontSize, planPageZoom, stepZoom } from '../../src/text/scale';
import { contrastRatio, contrastTarget, liftToRatio, parseColor, relativeLuminance, toOklch, type Rgba } from '../../src/color/contrast';
import { rng } from './fixtures';

const C = (s: string): Rgba => {
  const c = parseColor(s);
  if (!c) throw new Error(`unparsed ${s}`);
  return c;
};

describe('planPageZoom (round 3: zoom carries size, no residual map)', () => {
  test('a default fit changes nothing; small gaps (≤ 1.15×) change nothing', () => {
    expect(planPageZoom(DEMO_FITS.typical, 12)).toMatchObject({ zoom: 1, capped: false });
    expect(planPageZoom(DEMO_FITS.rosa, 22).zoom).toBe(1);
    expect(planPageZoom(DEMO_FITS.rosa, 20).zoom).toBe(1);
  });

  test('the smallest Chrome preset that reaches 93% of the person\'s size', () => {
    expect(planPageZoom(DEMO_FITS.rosa, 15).zoom).toBe(1.5); // 22.5 px
    expect(planPageZoom(DEMO_FITS.rosa, 13).zoom).toBe(1.75); // 22.75 px (1.5 would leave 19.5 px)
    expect(planPageZoom(DEMO_FITS.rosa, 14).zoom).toBe(1.5); // 21 px is within 93%
    expect(planPageZoom(DEMO_FITS.reader, 16).zoom).toBe(1.5); // 24 px
    expect(planPageZoom(DEMO_FITS.reader, 12)).toMatchObject({ zoom: 2, capped: false, effectiveBodyPx: 24 });
  });

  test('no viewport-width cap any more; capped at 200% (250% for large print) and says by how much', () => {
    const p = planPageZoom(DEMO_FITS.reader, 10);
    expect(p).toMatchObject({ zoom: 2, capped: true, shortPx: 4 });
    const large = { ...DEMO_FITS.reader, text: { ...DEMO_FITS.reader.text, bodyPx: 32, largePrint: true } };
    expect(planPageZoom(large, 13).zoom).toBe(2.5);
  });

  test('the person\'s own zoom is respected and never lowered; override wins', () => {
    expect(planPageZoom(DEMO_FITS.reader, 16, { ownZoom: 1.25 }).zoom).toBe(1.5);
    expect(planPageZoom(DEMO_FITS.reader, 16, { ownZoom: 1.75 }).zoom).toBe(1.75);
    const over = { ...DEMO_FITS.typical, text: { ...DEMO_FITS.typical.text, override: 30 } };
    expect(planPageZoom(over, 15).zoom).toBe(2);
  });

  test('A−/A+ steps move one Chrome preset from the fit\'s zoom', () => {
    expect(planPageZoom(DEMO_FITS.rosa, 15, { step: 1 })).toMatchObject({ zoom: 1.75, fitZoom: 1.5, step: 1 });
    expect(planPageZoom(DEMO_FITS.rosa, 15, { step: -2 }).zoom).toBe(1.1);
    expect(planPageZoom(DEMO_FITS.typical, 16, { step: 1 }).zoom).toBe(1.1);
    expect(stepZoom(2.5, 1)).toBe(2.5); // the person's ceiling
    expect(stepZoom(1.3, 1)).toBe(1.5); // a custom level starts at its nearest preset
    expect(stepZoom(0.5, -1)).toBe(0.5);
  });
});

describe('mapFontSize', () => {
  test('matches the brief: body 16 → 24 px', () => {
    const e = compressiveExponent(1.5);
    expect([12, 14, 16, 20, 24, 32, 40].map((s) => Math.round(mapFontSize(s, 16, 24, e) * 10) / 10)).toEqual([18, 21, 24, 28.2, 32.1, 39.5, 46.4]);
    const e40 = compressiveExponent(2.5);
    expect([12, 14, 16, 20, 24, 32, 40].map((s) => Math.round(mapFontSize(s, 16, 40, e40) * 10) / 10)).toEqual([30, 35, 40, 43.4, 46.4, 51.5, 55.9]);
  });

  test('property: monotone, never shrinks, headings never below body, identity without residual', () => {
    const r = rng(42);
    for (let t = 0; t < 400; t++) {
      const b = 10 + r() * 10;
      const k = 1 + r() * 2.5;
      const F = b * k;
      const e = compressiveExponent(k);
      const sizes = Array.from({ length: 40 }, () => 6 + r() * 90).sort((x, y) => x - y);
      const mapped = sizes.map((s) => mapFontSize(s, b, F, e));
      for (let i = 1; i < sizes.length; i++) expect(mapped[i]!).toBeGreaterThanOrEqual(mapped[i - 1]!);
      sizes.forEach((s, i) => {
        expect(mapped[i]!).toBeGreaterThanOrEqual(s);
        if (s >= b) expect(mapped[i]!).toBeGreaterThanOrEqual(F - 0.01);
        else expect(mapped[i]!).toBeLessThanOrEqual(F + 0.01);
      });
      expect(mapFontSize(b, b, F, e)).toBeCloseTo(F, 1);
      expect(mapFontSize(17, b, b, e)).toBe(17);
    }
  });
});

describe('contrast', () => {
  test('WCAG ratios for the brief\'s known pairs', () => {
    const pairs: Array<[string, string, number]> = [
      ['#111111', '#ffffff', 18.88], ['#EDEDED', '#121212', 16.0], ['#767676', '#fff', 4.54], ['#595959', '#fff', 7.0],
      ['#999', '#fff', 2.85], ['#1A1A17', '#FAFAF7', 16.68], ['#000', '#fff', 21], ['#fff', '#fff', 1],
    ];
    for (const [a, b, want] of pairs) expect(Math.round(contrastRatio(C(a), C(b)) * 100) / 100).toBeCloseTo(want, 2);
    expect(contrastRatio(C('#fff'), C('#767676'))).toBeCloseTo(contrastRatio(C('#767676'), C('#fff')), 10);
    expect(relativeLuminance(C('#fff'))).toBeCloseTo(1, 10);
  });

  test('parses what computed styles return', () => {
    expect(C('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(C('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(C('rgb(10 20 30 / 25%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(C('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(C('#11223380').a).toBeCloseTo(128 / 255, 5);
    expect(C('transparent').a).toBe(0);
    expect(C('White')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    const g = C('hsl(120 100% 25%)');
    expect([Math.round(g.r), Math.round(g.g), Math.round(g.b)]).toEqual([0, 128, 0]);
    for (const red of ['oklch(0.6279 0.2577 29.23)', 'lab(54.29 80.8 69.89)', 'color(srgb 1 0 0)', 'color(display-p3 1 0 0)', 'oklab(0.6279 0.2248 0.1258)']) {
      const c = C(red);
      expect(Math.round(c.r), red).toBeGreaterThanOrEqual(250);
      expect(Math.round(c.g), red).toBeLessThanOrEqual(3);
      expect(Math.round(c.b), red).toBeLessThanOrEqual(3);
    }
    for (const bad of ['', 'currentcolor', 'inherit', 'rgb(1,2)', '#12', 'url(x)', 'linear-gradient(red, blue)']) expect(parseColor(bad), bad).toBeNull();
  });

  test('liftToRatio reaches the target, moves lightness only (hue kept), and leaves passing colours alone', () => {
    expect(liftToRatio(C('#999'), C('#fff'), 7)).toBe('#595959');
    expect(liftToRatio(C('#111'), C('#fff'), 7)).toBe('#111111');
    const r = rng(9);
    for (let t = 0; t < 300; t++) {
      const fg: Rgba = { r: r() * 255, g: r() * 255, b: r() * 255, a: r() < 0.2 ? 0.5 + r() * 0.5 : 1 };
      const bg: Rgba = { r: r() * 255, g: r() * 255, b: r() * 255, a: 1 };
      const target = [3, 4.5, 7, 15][Math.floor(r() * 4)]!;
      const out = C(liftToRatio(fg, bg, target));
      const lb = relativeLuminance(bg);
      const achievable = Math.max((lb + 0.05) / 0.05, 1.05 / (lb + 0.05));
      if (achievable >= target) expect(contrastRatio(out, bg)).toBeGreaterThanOrEqual(target - 1e-9);
      const before = toOklch(fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 } : fg);
      const after = toOklch(out);
      // Hue survives whenever both colours still carry visible chroma.
      if (before.C > 0.06 && after.C > 0.06) {
        const dh = Math.abs(((after.H - before.H + 540) % 360) - 180);
        expect(dh).toBeLessThan(12);
      }
    }
  });

  test('contrast targets by band and text size', () => {
    expect(contrastTarget(4.5, 16)).toBe(4.5);
    expect(contrastTarget(4.5, 24)).toBe(3);
    expect(contrastTarget(7, 16)).toBe(7);
    expect(contrastTarget(7, 19, 700)).toBe(4.5);
    expect(contrastTarget(15, 16)).toBe(15);
    expect(contrastTarget(15, 30)).toBe(7);
  });
});
