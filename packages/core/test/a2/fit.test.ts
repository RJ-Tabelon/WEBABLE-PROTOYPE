import { describe, expect, test } from 'vitest';
import type { FittingRaw } from '../../src/types';
import { DEMO_FITS, defaultFit, deriveFit, describeFit, summarizeFitForModel } from '../../src/fit/derive';
import { incompleteBeta, jeffreysAtLeast } from '../../src/fit/stats';

/** Sentence time for a reading speed (56-character sentences, 0.6 s decision time). */
const msAt = (wpm: number): number => Math.round((560 / wpm + 0.6) * 1000);

const press = (dx: number, dy: number, size: number, slipped = false) => ({ dx, dy, hit: Math.hypot(dx, dy) <= size / 2, slipped });
/** 1 positioning press + 8 scored presses at radius r (one at rFar). */
function block(size: number, r: number, rFar = r, slips = 0) {
  const angles = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return {
    sizePx: size,
    presses: angles.map((a, i) => {
      const rr = i === 8 ? rFar : r;
      return press(rr * Math.cos(a), rr * Math.sin(a), size, i > 0 && i <= slips);
    }),
  };
}

function rawBase(): FittingRaw {
  return {
    inputClass: 'mouse',
    durationSec: 117.4,
    skipped: [],
    reading: null,
    pointing: null,
    finding: null,
    allPresses: [],
  };
}

describe('statistics', () => {
  test('Jeffreys P(slip rate ≥ 5%) matches the brief for n = 24 and n = 40', () => {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    expect([0, 1, 2, 3].map((k) => r2(jeffreysAtLeast(k, 24, 0.05)))).toEqual([0.11, 0.49, 0.79, 0.94]);
    expect([2, 3, 4].map((k) => r2(jeffreysAtLeast(k, 40, 0.05)))).toEqual([0.55, 0.78, 0.92]);
    expect(incompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 10);
  });
});

describe('deriveFit', () => {
  test('nothing measured → defaults, no condition words, deterministic apart from the timestamp', () => {
    const f = deriveFit(rawBase());
    const d = defaultFit();
    expect({ ...f, createdAt: '', calibration: null }).toEqual({ ...d, createdAt: '', calibration: null });
    expect(f.calibration).toEqual({ version: 'fit-1', durationSec: 117, skipped: [] });
  });

  test('typical reader: plateau down to ~12 px → body stays at 16 px, contrast band N', () => {
    const raw = rawBase();
    raw.reading = {
      seedPx: 24,
      ladder: [
        { px: 48, ms: msAt(250), correct: true },
        { px: 30.3, ms: msAt(256), correct: true },
        { px: 19.1, ms: msAt(246), correct: true },
        { px: 12, ms: msAt(240), correct: true },
        { px: 7.6, ms: msAt(140), correct: true },
        { px: 9.5, ms: msAt(170), correct: true },
      ],
      faint: [0.5, 0.2, 0.087, 0.044, 0.027, 0.018, 0.009].map((w, i) => ({ contrast: 1.05 / (1.05 - w), correct: i < 6 })),
      polarity: { lightMs: [msAt(240), msAt(250)], darkMs: [msAt(245), msAt(238)], stated: 'none' },
    };
    const f = deriveFit(raw);
    expect(f.text.source).toBe('measured');
    expect(f.text.cpsPx).toBeGreaterThan(9);
    expect(f.text.cpsPx).toBeLessThan(12.5);
    expect(f.text.bodyPx).toBe(16);
    expect(f.text.conf).toBeGreaterThan(0.4);
    expect(f.text.conf).toBeLessThanOrEqual(0.9);
    expect(f.contrast).toEqual({ band: 'N', floor: 4.5 });
    expect(f.polarity.value).toBe('none');
    expect(f.weight.floor).toBe(400);
    expect(f.spacing).toEqual({ lineHeight: 1.5, wordEm: 0, letterEm: 0 });
  });

  test('a reader who slows below ~30 px gets large text, band S widens the margin and adds weight and spacing', () => {
    const raw = rawBase();
    raw.reading = {
      seedPx: 32,
      ladder: [
        { px: 64, ms: msAt(180), correct: true },
        { px: 40, ms: msAt(176), correct: true },
        { px: 25, ms: msAt(120), correct: true },
        { px: 32, ms: msAt(165), correct: true },
        { px: 20, ms: msAt(60), correct: true },
      ],
      faint: [
        { contrast: 1.05 / (1.05 - 0.5), correct: true },
        { contrast: 1.05 / (1.05 - 0.45), correct: false },
        { contrast: 1.05 / (1.05 - 0.6), correct: false },
        { contrast: 1.05 / (1.05 - 0.3), correct: false },
      ],
      polarity: { lightMs: [msAt(120), msAt(125)], darkMs: [msAt(190), msAt(200)], stated: 'dark' },
    };
    const f = deriveFit(raw);
    expect(f.text.largePrint).toBe(true);
    expect(f.text.bodyPx).toBeGreaterThanOrEqual(30);
    expect(f.text.bodyPx).toBeLessThanOrEqual(56);
    expect(f.contrast.band).toBe('S');
    expect(f.contrast.floor).toBe(15);
    expect(f.weight.floor).toBe(600);
    expect(f.spacing.lineHeight).toBe(1.8);
    expect(f.measure.minCpl).toBe(8);
    // Dark measured faster and stated: dark.
    expect(f.polarity).toEqual({ value: 'dark', stated: 'dark' });
  });

  test('light or dark is the person\'s own choice (round 4: no measured polarity sentences)', () => {
    const raw = rawBase();
    raw.reading = {
      seedPx: null, ladder: [], faint: [],
      polarity: { lightMs: [msAt(120), msAt(125)], darkMs: [msAt(200), msAt(210)], stated: 'light' },
    };
    expect(deriveFit(raw).polarity).toEqual({ value: 'light', stated: 'light' });
    raw.reading.polarity.stated = 'none';
    expect(deriveFit(raw).polarity.value).toBe('none');
  });

  test('seed only (ladder skipped) → stated size', () => {
    const raw = rawBase();
    raw.reading = { seedPx: 26, ladder: [], faint: [], polarity: { lightMs: [], darkMs: [], stated: null } };
    const f = deriveFit(raw);
    expect(f.text).toMatchObject({ bodyPx: 26, source: 'stated', cpsPx: null });
  });

  test('pointing: precise mouse passes at 24 px; a spread of ~12 px fails 44 and passes 56', () => {
    const precise = rawBase();
    precise.pointing = { blocks: [block(44, 3), block(32, 3), block(24, 2.5)] };
    expect(deriveFit(precise).targets.minPx).toBe(24);

    const spread = rawBase();
    spread.pointing = { blocks: [block(44, 12, 26), block(56, 12), block(72, 12)] };
    const f = deriveFit(spread);
    expect(f.targets.minPx).toBe(56);
    expect(f.targets.conf).toBeGreaterThan(0);
    expect(f.targets.conf).toBeLessThanOrEqual(1);

    const none = rawBase();
    none.pointing = { blocks: [block(44, 20, 40), block(56, 25, 50), block(72, 30, 60)] };
    expect(deriveFit(none).targets.minPx).toBe(96);
  });

  test('Steady Clicks at ≥ 2 slip-offs in 24 ring presses; keyboard users get no pointing values', () => {
    const slips = rawBase();
    slips.pointing = { blocks: [block(44, 3, 3, 1), block(32, 3, 3, 1), block(24, 2, 2, 1)] };
    const f = deriveFit(slips);
    expect(f.clicks.steady.on).toBe(true);
    expect(f.clicks.steady.radiusPx).toBeGreaterThanOrEqual(6);

    const one = rawBase();
    one.pointing = { blocks: [block(44, 3, 3, 1), block(32, 3), block(24, 2)] };
    expect(deriveFit(one).clicks.steady.on).toBe(false);

    const kb = rawBase();
    kb.inputClass = 'keyboard';
    kb.pointing = { blocks: [block(44, 3)] };
    const k = deriveFit(kb);
    expect(k.targets).toEqual({ minPx: null, conf: 0 });
    expect(k.clicks.steady.on).toBe(false);
  });

  test('repeat debounce needs ≥ 3 repeats over ≥ 30 presses', () => {
    const raw = rawBase();
    raw.allPresses = Array.from({ length: 40 }, (_, i) => ({ slipped: false, repeat: i % 12 === 0 }));
    expect(deriveFit(raw).clicks.debounce).toBe(true);
    raw.allPresses = Array.from({ length: 40 }, (_, i) => ({ slipped: false, repeat: i === 3 }));
    expect(deriveFit(raw).clicks.debounce).toBe(false);
  });

  test('finding: busy pages much slower + chips + preferring calm → structure 2 and motion paused', () => {
    const raw = rawBase();
    const trials = [false, true].flatMap((clutter) => [false, true].flatMap((motion) => [0, 1].map((rep) => ({
      clutter, motion, found: true, ms: (clutter ? 6000 : 2000) + (motion ? 1500 : 0) + rep * 100,
    }))));
    raw.finding = { trials, preferredCalm: 2, gotInWay: ['Moving things', 'Too much on the page'] };
    const f = deriveFit(raw);
    expect(f.attention.structureLevel).toBe(2);
    expect(f.attention.motion.on).toBe(true);
    expect(f.attention.clutter.p).toBeGreaterThan(0.8);
    expect(f.baselines.searchSecMedian).toBeGreaterThan(2);

    const calm = rawBase();
    calm.finding = { trials: trials.map((t) => ({ ...t, ms: 2200 })), preferredCalm: 0, gotInWay: ['Nothing'] };
    const g = deriveFit(calm);
    expect(g.attention.structureLevel).toBe(0);
    expect(g.attention.motion.on).toBe(false);
  });
});

describe('demo fits and views', () => {
  test('DEMO_FITS carry the values the demo relies on', () => {
    const { rosa, typical, reader } = DEMO_FITS;
    expect(rosa.text.bodyPx).toBe(22);
    expect(rosa.targets.minPx).toBe(56);
    expect(rosa.clicks.steady.on).toBe(true);
    expect(rosa.contrast.band).toBe('M');
    expect(rosa.attention.structureLevel).toBe(2);
    expect(rosa.attention.motion.on).toBe(true);
    expect(typical.text.source).toBe('default');
    expect(reader.text.bodyPx).toBe(24);
    expect(reader.contrast.band).toBe('S');
    expect(reader.polarity.value).toBe('none');
    expect(reader.targets.minPx).toBe(44);
    expect(reader.attention.structureLevel).toBe(1);
  });

  test('summarizeFitForModel gives coarse levels only', () => {
    expect(summarizeFitForModel(DEMO_FITS.rosa)).toEqual({
      text_need: 'large', target_need: 'large', clutter_tolerance: 'low', structure_level: 2, motion: 'reduce', polarity: 'none',
    });
    expect(summarizeFitForModel(DEMO_FITS.typical)).toEqual({
      text_need: 'none', target_need: 'none', clutter_tolerance: 'high', structure_level: 0, motion: 'fine', polarity: 'none',
    });
    expect(summarizeFitForModel(DEMO_FITS.reader).target_need).toBe('some');
  });

  test('describeFit: real values, plain words, no condition or score words', () => {
    const rows = describeFit(DEMO_FITS.rosa);
    expect(rows.find((r) => r.label === 'Text size')).toEqual({ label: 'Text size', from: '16 px', to: '22 px' });
    expect(rows.find((r) => r.label === 'Click areas')).toEqual({ label: 'Click areas', from: '24 px', to: '56 px' });
    expect(rows.find((r) => r.label === 'Busy pages')?.to).toBe('Calm view opens');
    expect(describeFit(DEMO_FITS.typical).find((r) => r.label === 'Text size')?.to).toBe('No change');
    const all = JSON.stringify([DEMO_FITS.rosa, DEMO_FITS.typical, DEMO_FITS.reader].map(describeFit)).toLowerCase();
    for (const w of ['accessib', 'disab', 'impair', 'vision', 'tremor', 'score', 'result', 'normal', 'test']) expect(all).not.toContain(w);
  });
});
