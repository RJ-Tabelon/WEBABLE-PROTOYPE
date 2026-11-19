import { describe, expect, it } from 'vitest';

import { seededRandom } from './pointing';
import {
  createContrastStaircase,
  greyLevelWeber,
  nextReadingSize,
  quantizeWeber,
  readingSizeConfidence,
  summarizeReading,
  weberToGrey,
} from './reading';
import { visionSummarySchema } from './schema';
import type {
  ContrastTrial,
  PolarityTrial,
  ReadingSession,
  ReadingTrial,
} from './trials';

/* ------------------------------------------------------------------------ */
/* Simulated readers                                                          */
/* ------------------------------------------------------------------------ */

const RATIO = 0.536;
const WORDS = 10;
const T0 = 600;

type Reader = (fontPx: number) => number | 'cant';

/** Response time that yields `wpm` for a 10-word sentence after the 600 ms t0. */
const rtFor = (wpm: number) => T0 + (60_000 * WORDS) / wpm;

function trial(
  fontPx: number,
  reader: Reader,
  extra: Partial<ReadingTrial> = {},
): ReadingTrial {
  const r = reader(fontPx);
  return {
    fontPx,
    xHeightPx: fontPx * RATIO,
    words: WORDS,
    response: r === 'cant' ? 'cant' : 'true',
    correct: r !== 'cant',
    rtMs: r === 'cant' ? 4000 : rtFor(r),
    disturbed: false,
    ...extra,
  };
}

/** Drives the ladder walk with a reader until it stops. */
function walk(
  reader: Reader,
  startPx: number,
  maxFitPx: number,
): ReadingTrial[] {
  const trials: ReadingTrial[] = [];
  for (
    let px = nextReadingSize({ trials, startPx, maxFitPx });
    px !== null;
    px = nextReadingSize({ trials, startPx, maxFitPx })
  ) {
    trials.push(trial(px, reader));
    if (trials.length > 30) throw new Error('ladder did not stop');
  }
  return trials;
}

/** cal-vision.md 4.7 A: plateau ~265 wpm down to 12 px, 200 wpm at 9.5 px, 140 wpm at 7.6 px. */
const readerA: Reader = (px) => {
  if (px >= 40) return 255;
  if (px >= 25) return 270;
  if (px >= 15) return 265;
  if (px >= 11.5) return 262;
  if (px >= 9) return 200;
  if (px >= 7) return 140;
  return 'cant';
};

/** cal-vision.md 4.7 B: plateau ~150 wpm, 120 wpm at 48 px (0.8 MRS), 90 wpm at 38 px. */
const readerB: Reader = (px) => {
  if (px >= 55) return 150;
  if (px >= 45) return 120;
  if (px >= 35) return 90;
  return 'cant';
};

function session(
  ladder: ReadingTrial[],
  extra: Partial<ReadingSession> = {},
): ReadingSession {
  return {
    comfortPx: null,
    ladder,
    contrast: [],
    polarity: [],
    statedPolarity: null,
    overrides: {},
    referenceXHeightRatio: RATIO,
    displayLimited: false,
    durationSec: 60,
    ...extra,
  };
}

function polarityTrials(lightWpm: number, darkWpm: number): PolarityTrial[] {
  const make = (polarity: 'light' | 'dark', wpm: number): PolarityTrial => ({
    polarity,
    words: WORDS,
    rtMs: rtFor(wpm),
    correct: true,
  });
  return [
    make('light', lightWpm),
    make('dark', darkWpm),
    make('dark', darkWpm),
    make('light', lightWpm),
  ];
}

function hasNaN(value: unknown): boolean {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v,
  ).includes('"NaN"');
}

/* ------------------------------------------------------------------------ */

describe('weberToGrey', () => {
  it('maps the documented end points of the stimulus grid', () => {
    expect(weberToGrey(0.9)).toBe('#595959');
    expect(weberToGrey(0.009)).toBe('#FEFEFE');
    expect(weberToGrey(1)).toBe('#000000');
  });

  it('never returns white and stays monotone', () => {
    expect(weberToGrey(0)).toBe('#FEFEFE');
    expect(weberToGrey(-1)).toBe('#FEFEFE');
    let last = 1.1;
    for (let w = 0.9; w > 0.009; w /= 1.12) {
      const q = quantizeWeber(w);
      expect(q).toBeLessThanOrEqual(last);
      last = q;
    }
  });

  it('computes sRGB Weber contrast on white', () => {
    expect(greyLevelWeber(255)).toBeCloseTo(0, 6);
    expect(greyLevelWeber(0)).toBeCloseTo(1, 6);
    expect(greyLevelWeber(253)).toBeCloseTo(0.0177, 3);
  });
});

describe('createContrastStaircase', () => {
  it('opens with an easy word and then places stimuli on the quantized grid', () => {
    const s = createContrastStaircase({ largePrint: false });
    expect(s.next()).toBeCloseTo(0.5, 1);
    expect(s.next()).toBe(s.next());
    s.update(true);
    for (let i = 0; i < 5; i++) {
      const w = s.next();
      expect(quantizeWeber(w)).toBeCloseTo(w, 10);
      s.update(true);
    }
  });

  it('stops within 1 + 8 trials and reports finite estimates', () => {
    const s = createContrastStaircase({ largePrint: true });
    let n = 0;
    while (!s.done()) {
      s.next();
      s.update(n % 3 !== 0);
      n++;
      expect(n).toBeLessThanOrEqual(9);
    }
    const e = s.estimate();
    expect(e.trials).toBe(n);
    expect(e.sd).toBeGreaterThan(0);
    expect(e.alphaLog).toBeGreaterThanOrEqual(-3);
    expect(e.alphaLog).toBeLessThanOrEqual(0);
  });

  it('reaches the ceiling for a reader who sees every word', () => {
    const s = createContrastStaircase({ largePrint: false });
    while (!s.done()) {
      s.next();
      s.update(true);
    }
    const e = s.estimate();
    expect(e.alphaLog).toBeLessThan(Math.log10(0.03));
  });

  it('recovers simulated thresholds to within 0.3 log in most runs', () => {
    const psi = (x: number, a: number) =>
      0.25 + 0.73 * (1 - Math.exp(-(10 ** (3.5 * (x - a)))));
    let close = 0;
    const runs = 60;
    for (let seed = 1; seed <= runs; seed++) {
      const random = seededRandom(seed);
      const truth = -2 + 1.4 * random();
      const s = createContrastStaircase({ largePrint: false });
      while (!s.done()) {
        const w = s.next();
        s.update(random() < psi(Math.log10(w), truth));
      }
      if (Math.abs(s.estimate().alphaLog - truth) <= 0.3) close++;
    }
    expect(close / runs).toBeGreaterThanOrEqual(0.7);
  });
});

describe('nextReadingSize', () => {
  it('opens with a practice sentence and a first scored sentence at the start size', () => {
    expect(nextReadingSize({ trials: [], startPx: 40, maxFitPx: 60 })).toBe(40);
    expect(
      nextReadingSize({
        trials: [trial(40, readerA)],
        startPx: 40,
        maxFitPx: 60,
      }),
    ).toBe(40);
    expect(nextReadingSize({ trials: [], startPx: 80, maxFitPx: 60 })).toBe(60);
  });

  it('walks worked example A: coarse steps, then the skipped fine step', () => {
    const sizes = walk(readerA, 48, 64).map((t) => t.fontPx);
    expect(sizes).toEqual([48, 48, 30.29, 19.11, 12.06, 7.61, 9.58]);
  });

  it('walks worked example B, confirming the knee one step below', () => {
    const sizes = walk(readerB, 96, 100).map((t) => t.fontPx);
    expect(sizes).toEqual([96, 96, 60.57, 38.22, 48.11, 30.36]);
  });

  it('stops after a clear failure below the plateau without the confirming step', () => {
    const reader: Reader = (px) => (px >= 20 ? 250 : 'cant');
    const sizes = walk(reader, 48, 64).map((t) => t.fontPx);
    expect(sizes).toEqual([48, 48, 30.29, 19.11, 24.06]);
  });

  it('steps up from an unreadable start until a sentence is read, within the display', () => {
    const reader: Reader = (px) => (px >= 60 ? 140 : 'cant');
    expect(walk(reader, 40, 70).map((t) => t.fontPx)).toEqual([
      40, 40, 50.36, 63.4,
    ]);
    expect(walk(reader, 40, 50).map((t) => t.fontPx)).toEqual([40, 40]);
  });

  it('respects the 4 px x-height floor', () => {
    const reader: Reader = () => 250;
    const sizes = walk(reader, 12, 20).map((t) => t.fontPx);
    // 12 px -> 7.57 px would render a 4.06 px x-height; 6.01 px would not.
    expect(sizes).toEqual([12, 12, 7.57]);
    expect(Math.min(...sizes) * RATIO).toBeGreaterThanOrEqual(4);
  });

  it('shows a disturbed sentence again at the same size', () => {
    const trials = [
      trial(48, readerA),
      trial(48, readerA),
      trial(30.29, readerA, { disturbed: true }),
    ];
    expect(nextReadingSize({ trials, startPx: 48, maxFitPx: 64 })).toBe(30.29);
  });

  it('stops at 12 scored sentences or 40 s', () => {
    const many = Array.from({ length: 13 }, () =>
      trial(48, readerA, { disturbed: true }),
    );
    expect(
      nextReadingSize({ trials: many, startPx: 48, maxFitPx: 64 }),
    ).toBeNull();
    const two = [trial(48, readerA), trial(48, readerA)];
    expect(
      nextReadingSize({
        trials: two,
        startPx: 48,
        maxFitPx: 64,
        elapsedMs: 41_000,
      }),
    ).toBeNull();
  });
});

describe('summarizeReading', () => {
  it('reproduces worked example A: CPS about 10 px, no size change, bracketed at 0.1', () => {
    const s = summarizeReading(
      session(walk(readerA, 48, 64), {
        comfortPx: 20,
        polarity: polarityTrials(262, 262),
        statedPolarity: 'same',
      }),
    );
    expect(s.status).toBe('measured');
    expect(s.criticalPx).not.toBeNull();
    expect(s.criticalPx ?? 0).toBeGreaterThan(9.2);
    expect(s.criticalPx ?? 0).toBeLessThan(11.2);
    expect((s.criticalPx ?? 0) * 10 ** 0.1).toBeLessThan(16);
    expect(s.bracket).toBe('0.1');
    expect(s.plateauPoints).toBeGreaterThanOrEqual(3);
    expect(s.accuracy).toBe(1);
    expect(s.largePrint).toBe(false);
    expect(s.displayLimited).toBe(false);
    expect(Math.abs(s.polarity?.deltaLog ?? 1)).toBeLessThan(0.01);
    expect(readingSizeConfidence(s)).toBeGreaterThanOrEqual(0.7);
    expect(() => visionSummarySchema.parse(s)).not.toThrow();
  });

  it('reproduces worked example B: CPS about 48 px on the large-print path', () => {
    const s = summarizeReading(
      session(walk(readerB, 96, 100), {
        comfortPx: 48,
        polarity: polarityTrials(120, 120 * 10 ** 0.12),
        statedPolarity: 'dark',
      }),
    );
    expect(s.criticalPx ?? 0).toBeGreaterThan(43);
    expect(s.criticalPx ?? 0).toBeLessThan(52);
    expect(s.largePrint).toBe(true);
    expect(s.bracket).toBe('0.1');
    expect(s.polarity?.deltaLog ?? 0).toBeCloseTo(0.12, 2);
    expect(s.polarity?.se ?? 1).toBeLessThan(0.12 / 1.64);
    expect(s.polarity?.stated).toBe('dark');
  });

  it('treats an unreadable ladder as display-limited and keeps the largest size shown', () => {
    const reader: Reader = () => 'cant';
    const s = summarizeReading(session(walk(reader, 40, 50)));
    expect(s.displayLimited).toBe(true);
    expect(s.criticalPx).toBe(40);
    expect(s.bracket).toBe('none');
    expect(s.accuracy).toBe(0);
    expect(readingSizeConfidence(s)).toBe(0);
  });

  it('marks an empty session as skipped', () => {
    const s = summarizeReading(session([]));
    expect(s.status).toBe('skipped');
    expect(s.criticalPx).toBeNull();
    expect(s.contrast).toBeNull();
    expect(s.polarity).toBeNull();
    expect(() => visionSummarySchema.parse(s)).not.toThrow();
  });

  it('keeps a stated polarity without an objective comparison', () => {
    const s = summarizeReading(session([], { statedPolarity: 'dark' }));
    expect(s.polarity).toEqual({ deltaLog: 0, se: 2, stated: 'dark' });
  });

  it('replays contrast trials through the staircase posterior', () => {
    const contrast: ContrastTrial[] = [
      0.5, 0.2, 0.1, 0.05, 0.03, 0.02, 0.0177, 0.0089,
    ].map((weber) => ({
      weber,
      correct: true,
      cantSee: false,
    }));
    const s = summarizeReading(session([], { contrast }));
    expect(s.status).toBe('measured');
    expect(s.contrast?.ceiling).toBe(true);
    expect(s.contrast?.alphaLog ?? 0).toBeLessThan(-1.52);
    const blind = summarizeReading(
      session([], {
        contrast: contrast.map((t) => ({
          ...t,
          correct: false,
          cantSee: true,
        })),
      }),
    );
    expect(blind.contrast?.alphaLog ?? -3).toBeGreaterThan(-1.05);
  });

  it('carries preview nudges as overrides', () => {
    const s = summarizeReading(
      session([], {
        overrides: { textPx: 22.333, polarity: 'dark', moreSpacing: true },
      }),
    );
    expect(s.overrides).toEqual({
      textPx: 22.3,
      polarity: 'dark',
      moreSpacing: true,
    });
  });

  it('always produces schema-valid, finite summaries (seeded fuzz)', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const random = seededRandom(seed);
      const knee = 4 + 60 * random();
      const mrs = 80 + 300 * random();
      const reader: Reader = (px) => {
        if (random() < 0.05) return 'cant';
        const speed =
          px >= knee ? mrs : mrs * (px / knee) ** (1 + 2 * random());
        return speed < 20 ? 'cant' : speed * (0.9 + 0.2 * random());
      };
      const start = 10 + 80 * random();
      const ladder = walk(reader, start, start * (1 + random())).map((t) =>
        random() < 0.05 ? { ...t, disturbed: true } : t,
      );
      const s = summarizeReading(
        session(ladder, {
          comfortPx: random() < 0.2 ? null : 8 + 100 * random(),
          polarity:
            random() < 0.5
              ? polarityTrials(100 + 200 * random(), 100 + 200 * random())
              : [],
          contrast: Array.from({ length: Math.floor(9 * random()) }, () => ({
            weber: quantizeWeber(10 ** (-2 + 2 * random())),
            correct: random() < 0.7,
            cantSee: random() < 0.1,
          })),
          statedPolarity: random() < 0.5 ? null : 'light',
        }),
        { rootFontPx: 12 + 12 * random(), t0Ms: 300 + 900 * random() },
      );
      expect(() => visionSummarySchema.parse(s)).not.toThrow();
      expect(hasNaN(s)).toBe(false);
      const conf = readingSizeConfidence(s);
      expect(conf).toBeGreaterThanOrEqual(0);
      expect(conf).toBeLessThanOrEqual(0.9);
    }
  });
});
