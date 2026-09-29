import { describe, expect, it } from 'vitest';

import { DEFAULT_SYSTEM_SIGNALS, defaultFitProfile } from '../profile/defaults';
import { benefitProbability, needLevels } from '../profile/needs';
import { fitProfileSchema, type FitProfile } from '../profile/schema';
import { CALIBRATION_VERSION } from '../versions';
import {
  contrastBand,
  deriveFitProfile,
  rateExceedanceProbability,
} from './fit';
import { seededRandom } from './pointing';
import {
  createContrastStaircase,
  nextReadingSize,
  summarizeReading,
} from './reading';
import type {
  AttentionSummary,
  CalibrationRecord,
  DeviceContext,
  MotorSummary,
  VisionSummary,
} from './schema';
import type {
  ContrastTrial,
  PolarityTrial,
  ReadingSession,
  ReadingTrial,
} from './trials';

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------ */

const DEVICE: DeviceContext = {
  class: 'laptop',
  input: 'mouse',
  dprBucket: 2,
  viewport: 'L',
  reducedMotion: false,
  colorScheme: 'light',
  moreContrast: false,
  forcedColors: false,
  rootFontPx: 16,
  zoom: 1,
};

function record(
  modules: CalibrationRecord['modules'],
  device: Partial<DeviceContext> = {},
): CalibrationRecord {
  return {
    version: CALIBRATION_VERSION,
    device: { ...DEVICE, ...device },
    modules,
    startedAt: '2026-09-29T10:00:00.000Z',
    completedAt: '2026-09-29T10:06:00.000Z',
  };
}

const RATIO = 0.536;
type Reader = (fontPx: number) => number | 'cant';
const rtFor = (wpm: number) => 600 + (60_000 * 10) / wpm;

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
    const r = reader(px);
    trials.push({
      fontPx: px,
      xHeightPx: px * RATIO,
      words: 10,
      response: r === 'cant' ? 'cant' : 'true',
      correct: r !== 'cant',
      rtMs: r === 'cant' ? 4000 : rtFor(r),
      disturbed: false,
    });
  }
  return trials;
}

/** Runs the real staircase against a step observer with the given log10 Weber threshold. */
function contrastTrials(
  thresholdLog: number,
  largePrint: boolean,
): ContrastTrial[] {
  const s = createContrastStaircase({ largePrint });
  const out: ContrastTrial[] = [];
  while (!s.done()) {
    const weber = s.next();
    const correct = Math.log10(weber) >= thresholdLog;
    s.update(correct);
    out.push({ weber, correct, cantSee: false });
  }
  return out;
}

function polarity(lightWpm: number, darkWpm: number): PolarityTrial[] {
  const t = (p: 'light' | 'dark', wpm: number): PolarityTrial => ({
    polarity: p,
    words: 10,
    rtMs: rtFor(wpm),
    correct: true,
  });
  return [
    t('light', lightWpm),
    t('dark', darkWpm),
    t('dark', darkWpm),
    t('light', lightWpm),
  ];
}

function readingSession(extra: Partial<ReadingSession>): ReadingSession {
  return {
    comfortPx: null,
    ladder: [],
    contrast: [],
    polarity: [],
    statedPolarity: null,
    overrides: {},
    referenceXHeightRatio: RATIO,
    displayLimited: false,
    durationSec: 70,
    ...extra,
  };
}

/** cal-vision.md 4.7 A. */
const exampleA: VisionSummary = summarizeReading(
  readingSession({
    comfortPx: 20,
    ladder: walk(
      (px) => (px >= 11.5 ? 262 : px >= 9 ? 200 : px >= 7 ? 140 : 'cant'),
      48,
      64,
    ),
    contrast: contrastTrials(-3, false),
    polarity: polarity(262, 262),
    statedPolarity: 'same',
  }),
);

/** cal-vision.md 4.7 B. */
const exampleB: VisionSummary = summarizeReading(
  readingSession({
    comfortPx: 48,
    ladder: walk(
      (px) => (px >= 55 ? 150 : px >= 45 ? 120 : px >= 35 ? 90 : 'cant'),
      96,
      100,
    ),
    contrast: contrastTrials(-1.2, true),
    polarity: polarity(120, 120 * 10 ** 0.12),
    statedPolarity: 'dark',
  }),
);

function motor(extra: Partial<MotorSummary> = {}): MotorSummary {
  return {
    status: 'measured',
    input: 'mouse',
    blocks: [
      { targetPx: 44, trials: 9, misses: 0, sigmaPx: 5, medianMoveMs: 700 },
      { targetPx: 32, trials: 9, misses: 1, sigmaPx: 4.6, medianMoveMs: 760 },
    ],
    recommendedPx: 44,
    recommendedConfidence: 0.62,
    precisionFloorPx: 2.1,
    slip: { presses: 30, slipOffs: 0, p95Px: 1.5, pressP90Ms: 140 },
    repeats: { count: 0, p95IntervalMs: 0 },
    flyBy: 0,
    hold: { jitterP95Px: 2, exits: 0 },
    drag: {
      attempts: 3,
      successes: 3,
      earlyReleases: 0,
      timeRatio: 1.2,
      skipped: false,
    },
    fatigue: false,
    chosenPx: null,
    express: false,
    durationSec: 70,
    ...extra,
  };
}

function focus(extra: Partial<AttentionSummary> = {}): AttentionSummary {
  return {
    status: 'measured',
    motionShown: true,
    stopMotionPressed: false,
    effects: { clutter: null, motion: null, guidance: null, chunking: null },
    decoyCapture: null,
    preferences: { still: null, clean: null, chunked: null, hierarchy: null },
    chips: [],
    durationSec: 80,
    ...extra,
  };
}

const derive = (
  modules: CalibrationRecord['modules'],
  opts: { device?: Partial<DeviceContext>; previous?: FitProfile } = {},
) =>
  deriveFitProfile({
    record: record(modules, opts.device),
    system: DEFAULT_SYSTEM_SIGNALS,
    ...(opts.previous ? { previous: opts.previous } : {}),
  });

function allConfidences(p: FitProfile): number[] {
  const out: number[] = [p.confidence];
  for (const section of [p.vision, p.motor, p.attention] as const) {
    for (const v of Object.values(section)) {
      if (
        v &&
        typeof v === 'object' &&
        'confidence' in v &&
        typeof v.confidence === 'number'
      )
        out.push(v.confidence);
    }
  }
  return out;
}

function hasNaN(value: unknown): boolean {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v,
  ).includes('"NaN"');
}

/* ------------------------------------------------------------------------ */

describe('rateExceedanceProbability (Jeffreys)', () => {
  it('matches the documented values for 5% with n = 30', () => {
    const expected = [0.08, 0.38, 0.7, 0.89, 0.97];
    expected.forEach((p, k) =>
      expect(rateExceedanceProbability(k, 30, 0.05)).toBeCloseTo(p, 1),
    );
    expect(rateExceedanceProbability(2, 30, 0.05)).toBeGreaterThanOrEqual(0.68);
    expect(rateExceedanceProbability(1, 30, 0.05)).toBeLessThan(0.7);
    expect(rateExceedanceProbability(0, 0, 0.05)).toBe(0);
  });
});

describe('contrastBand', () => {
  it('splits at 3% and 9% Weber', () => {
    expect(contrastBand(-1.9)).toBe('N');
    expect(contrastBand(Math.log10(0.03))).toBe('N');
    expect(contrastBand(-1.2)).toBe('M');
    expect(contrastBand(-0.8)).toBe('S');
  });
});

describe('deriveFitProfile: vision (cal-vision.md 4.7 worked examples)', () => {
  it('A, typical laptop reader: no size change, standard floor, no polarity', () => {
    const p = derive({ reading: exampleA });
    expect(p.vision.textMinPx.source).toBe('measured');
    expect(p.vision.textMinPx.value).toBeGreaterThanOrEqual(12);
    expect(p.vision.textMinPx.value).toBeLessThanOrEqual(14);
    expect(needLevels(p).text).toBe(0);
    expect(p.vision.textMinPx.confidence).toBeGreaterThanOrEqual(0.7);
    expect(p.vision.contrastFloor.value).toBe(4.5);
    expect(p.vision.contrastFloor.confidence).toBeGreaterThanOrEqual(0.5);
    expect(p.vision.polarity.value).toBe('none');
    expect(p.vision.fontWeightFloor.value).toBe(400);
    expect(p.vision.lineHeight.value).toBe(1.5);
    expect(p.modules.reading).toBe('measured');
  });

  it('B, large-print path: about 60 px, 7:1, bolder weight, more spacing, dark', () => {
    const p = derive({ reading: exampleB });
    expect(p.vision.textMinPx.value).toBeGreaterThanOrEqual(54);
    expect(p.vision.textMinPx.value).toBeLessThanOrEqual(66);
    expect(needLevels(p).text).toBe(2);
    expect(exampleB.contrast?.alphaLog ?? 0).toBeGreaterThan(-1.52);
    expect(exampleB.contrast?.alphaLog ?? 0).toBeLessThanOrEqual(-1.05);
    expect(p.vision.contrastFloor.value).toBe(7);
    expect(p.vision.fontWeightFloor.value).toBeGreaterThanOrEqual(500);
    expect(p.vision.lineHeight.value).toBe(1.8);
    expect(p.vision.wordSpacingEm.value).toBe(0.16);
    expect(p.vision.maxLineCh.value).toBe(70);
    expect(p.vision.polarity).toMatchObject({
      value: 'dark',
      source: 'measured',
      confidence: 0.8,
      stated: 'dark',
    });
    expect(p.vision.xHeightMinPx).toBeCloseTo(
      p.vision.textMinPx.value * RATIO,
      0,
    );
  });

  it('band S raises the margin, snaps contrast to maximum and offers dark on a weak lead', () => {
    const s: VisionSummary = {
      ...exampleB,
      contrast: { alphaLog: -0.7, sd: 0.12, ceiling: false, trials: 8 },
      polarity: { deltaLog: 0.05, se: 0.08, stated: null },
      largePrint: false,
    };
    const p = derive({ reading: s });
    expect(p.vision.contrastFloor.value).toBe(21);
    expect(p.vision.fontWeightFloor.value).toBe(600);
    expect(p.vision.polarity).toMatchObject({
      value: 'dark',
      confidence: 0.55,
    });
    const withMargin = Math.round((s.criticalPx ?? 0) * 10 ** 0.2);
    expect(p.vision.textMinPx.value).toBe(withMargin);
  });

  it('takes the higher-need band when the system asks for more contrast', () => {
    const p = derive({ reading: exampleA }, { device: { moreContrast: true } });
    expect(p.vision.contrastFloor).toMatchObject({
      value: 7,
      source: 'stated',
      confidence: 0.5,
      measured: 4.5,
      stated: 7,
    });
  });

  it('turns preview nudges into overrides and keeps the evidence', () => {
    const p = derive({
      reading: {
        ...exampleA,
        overrides: { textPx: 18, polarity: 'dark', moreSpacing: true },
      },
    });
    expect(p.vision.textMinPx).toMatchObject({
      value: 18,
      source: 'override',
      override: 18,
    });
    expect(p.vision.textMinPx.measured).toBeLessThan(16);
    expect(p.vision.polarity).toMatchObject({
      value: 'dark',
      source: 'override',
    });
    expect(p.vision.lineHeight).toMatchObject({
      value: 1.8,
      source: 'override',
    });
  });

  it('expresses sizes at 100% zoom', () => {
    const p = derive({ reading: exampleB }, { device: { zoom: 1.25 } });
    const q = derive({ reading: exampleB });
    expect(p.vision.textMinPx.value / q.vision.textMinPx.value).toBeCloseTo(
      1.25,
      1,
    );
  });
});

describe('deriveFitProfile: motor (cal-motor.md 5.7)', () => {
  it('uses S* when nothing was chosen', () => {
    const p = derive({ pointing: motor() });
    expect(p.motor.minTargetPx).toMatchObject({
      value: 44,
      source: 'measured',
      confidence: 0.62,
      measured: 44,
    });
    expect(p.modules.pointing).toBe('measured');
  });

  it('never denies more room than the person chose, and flags a choice two levels smaller', () => {
    expect(
      derive({ pointing: motor({ chosenPx: 56 }) }).motor.minTargetPx,
    ).toMatchObject({ value: 56, source: 'stated', stated: 56, measured: 44 });
    expect(
      derive({ pointing: motor({ chosenPx: 32 }) }).motor.minTargetPx,
    ).toMatchObject({ value: 32, source: 'stated' });
    expect(
      derive({ pointing: motor({ chosenPx: 24 }) }).motor.minTargetPx,
    ).toMatchObject({
      value: 24,
      source: 'override',
      override: 24,
      measured: 44,
    });
  });

  it('offers steady clicks from the slip-off posterior or a wide slip', () => {
    const off = derive({ pointing: motor() }).motor.steadyClicks;
    expect(off.value.on).toBe(false);
    const on = derive({
      pointing: motor({
        slip: { presses: 30, slipOffs: 3, p95Px: 7, pressP90Ms: 260 },
      }),
    }).motor.steadyClicks;
    expect(on.value).toEqual({ on: true, windowMs: 310, radiusPx: 10.5 });
    expect(on.confidence).toBeGreaterThanOrEqual(0.7);
    const wide = derive({
      pointing: motor({
        slip: { presses: 30, slipOffs: 0, p95Px: 12, pressP90Ms: 500 },
      }),
    }).motor.steadyClicks;
    expect(wide.value).toEqual({ on: true, windowMs: 400, radiusPx: 18 });
  });

  it('sets spacing to S + 2 x slip p95 unless steady clicks absorb the slip', () => {
    expect(
      derive({
        pointing: motor({
          slip: { presses: 30, slipOffs: 0, p95Px: 6, pressP90Ms: 150 },
        }),
      }).motor.targetSpacingPx.value,
    ).toBe(56);
    expect(
      derive({
        pointing: motor({
          slip: { presses: 30, slipOffs: 4, p95Px: 6, pressP90Ms: 150 },
        }),
      }).motor.targetSpacingPx.value,
    ).toBe(44);
  });

  it('offers the repeat guard with a window from the repeat intervals', () => {
    const p = derive({
      pointing: motor({ repeats: { count: 3, p95IntervalMs: 240 } }),
    });
    expect(p.motor.repeatGuard.value).toEqual({ on: true, windowMs: 340 });
    expect(derive({ pointing: motor() }).motor.repeatGuard.value).toEqual({
      on: false,
      windowMs: 400,
    });
  });

  it('grades drag difficulty', () => {
    const drag = (d: Partial<NonNullable<MotorSummary['drag']>>) =>
      derive({
        pointing: motor({
          drag: {
            attempts: 3,
            successes: 3,
            earlyReleases: 0,
            timeRatio: 1.2,
            skipped: false,
            ...d,
          },
        }),
      }).motor.drag.value;
    expect(drag({ skipped: true, attempts: 0, successes: 0 })).toBe('high');
    expect(drag({ successes: 1 })).toBe('high');
    expect(drag({ earlyReleases: 1, timeRatio: 2.4 })).toBe('high');
    expect(drag({ successes: 2 })).toBe('some');
    expect(drag({ timeRatio: 1.7 })).toBe('some');
    expect(drag({})).toBe('none');
  });

  it('sets hover grace from hold jitter, with low confidence, and not for touch', () => {
    const p700 = derive({
      pointing: motor({ hold: { jitterP95Px: 23, exits: 2 } }),
    }).motor.hoverGraceMs;
    expect(p700).toMatchObject({ value: 700, confidence: 0.25 });
    expect(
      derive({ pointing: motor({ hold: { jitterP95Px: 12, exits: 0 } }) }).motor
        .hoverGraceMs.value,
    ).toBe(400);
    const touch = derive({
      pointing: motor({ input: 'touch', hold: { jitterP95Px: 40, exits: 3 } }),
    });
    expect(touch.motor.hoverGraceMs.value).toBe(0);
    expect(touch.device.input).toBe('touch');
  });

  it('keeps defaults for keyboard users who skip pointing', () => {
    const p = derive(
      {
        pointing: motor({
          status: 'skipped',
          input: 'keyboard',
          recommendedPx: null,
        }),
      },
      { device: { input: 'keyboard' } },
    );
    expect(p.motor.minTargetPx).toEqual(defaultFitProfile().motor.minTargetPx);
    expect(p.motor.input).toBe('keyboard');
    expect(p.modules.pointing).toBe('skipped');
  });
});

describe('deriveFitProfile: attention (cal-attention.md 5-6)', () => {
  it('uses the system reduced-motion prior when focus is not run', () => {
    const p = derive({}, { device: { reducedMotion: true } });
    expect(p.attention.systemReducedMotion).toBe(true);
    expect(p.attention.motion).toMatchObject({
      mean: 0.6,
      sources: ['system'],
    });
    expect(needLevels(p).motion).toBe(2);
  });

  it('caps behaviour-only confidence low', () => {
    const p = derive({
      focus: focus({
        effects: {
          clutter: { value: 0.5, se: 0.17, n: 12 },
          motion: null,
          guidance: null,
          chunking: null,
        },
      }),
    });
    expect(p.attention.density.confidence).toBeLessThanOrEqual(0.24);
    expect(p.attention.density.mean).toBeGreaterThan(0.2);
    expect(p.attention.density.sources).toEqual(['behavior']);
  });

  it('shrinks toward the population and grows confidence with preference evidence', () => {
    const p = derive({
      focus: focus({
        stopMotionPressed: true,
        effects: {
          clutter: { value: 0.3, se: 0.17, n: 12 },
          motion: { value: 0.25, se: 0.17, n: 12 },
          guidance: null,
          chunking: null,
        },
        preferences: { still: 2, clean: 2, chunked: 1, hierarchy: -1 },
        chips: ['moving', 'busy'],
      }),
    });
    expect(p.attention.motion.mean).toBeGreaterThan(0.25);
    expect(benefitProbability(p.attention.motion)).toBeGreaterThan(0.9);
    expect(p.attention.motion.confidence).toBeGreaterThan(0.5);
    expect(p.attention.density.mean).toBeLessThan(0.3);
    expect(p.attention.guidance.mean).toBeLessThan(0);
    expect(p.modules.focus).toBe('measured');
  });

  it('pulls every dimension toward zero on "nothing got in my way"', () => {
    const p = derive({ focus: focus({ chips: ['nothing'] }) });
    for (const d of [
      'motion',
      'distraction',
      'density',
      'chunking',
      'guidance',
    ] as const) {
      expect(p.attention[d].mean).toBe(0);
      expect(p.attention[d].sd).toBeLessThan(0.35);
    }
    expect(needLevels(p).motion).toBe(1);
  });
});

describe('deriveFitProfile: modules, recalibration and invariants', () => {
  it('keeps defaults for skipped modules and reports zero confidence', () => {
    const p = derive({
      reading: { ...exampleA, status: 'skipped', comfortPx: null },
      pointing: motor({ status: 'skipped', recommendedPx: null }),
      focus: focus({ status: 'skipped' }),
    });
    const d = defaultFitProfile(
      DEFAULT_SYSTEM_SIGNALS,
      new Date('2026-09-29T10:06:00.000Z'),
    );
    expect(p.vision).toEqual(d.vision);
    expect(p.motor).toEqual(d.motor);
    expect(p.attention).toEqual(d.attention);
    expect(p.confidence).toBe(0);
    expect(p.modules).toEqual({
      reading: 'skipped',
      pointing: 'skipped',
      focus: 'skipped',
    });
    expect(p.createdAt).toBe('2026-09-29T10:06:00.000Z');
    expect(p.calibrationVersion).toBe(CALIBRATION_VERSION);
  });

  it('keeps a comfortable size chosen before skipping the reading tasks as stated', () => {
    const p = derive({
      reading: { ...exampleA, status: 'skipped', comfortPx: 24 },
      pointing: motor({ status: 'skipped', recommendedPx: null }),
      focus: focus({ status: 'skipped' }),
    });
    expect(p.vision.textMinPx.source).toBe('stated');
    expect(p.vision.textMinPx.value).toBe(24);
    expect(p.vision.textMinPx.stated).toBe(24);
    expect(p.modules.reading).toBe('skipped');
  });

  it('preserves every override on recalibration while updating the evidence', () => {
    const first = derive({
      reading: exampleA,
      pointing: motor(),
      focus: focus(),
    });
    const previous: FitProfile = {
      ...first,
      vision: {
        ...first.vision,
        textMinPx: {
          ...first.vision.textMinPx,
          value: 24,
          source: 'override',
          override: 24,
          confidence: 0.9,
        },
        polarity: {
          value: 'dark',
          source: 'override',
          override: 'dark',
          confidence: 0.9,
        },
        maxLineCh: {
          value: 62,
          source: 'override',
          override: 62,
          confidence: 0.9,
        },
      },
      motor: {
        ...first.motor,
        minTargetPx: {
          value: 56,
          source: 'override',
          override: 56,
          confidence: 0.9,
        },
        steadyClicks: {
          value: { on: true, windowMs: 300, radiusPx: 10 },
          source: 'override',
          override: { on: true, windowMs: 300, radiusPx: 10 },
          confidence: 0.9,
        },
      },
      attention: {
        ...first.attention,
        motion: { mean: 1, sd: 0.1, confidence: 0.9, sources: ['override'] },
      },
    };
    const next = derive(
      {
        reading: exampleB,
        pointing: motor({ recommendedPx: 32 }),
        focus: focus({ chips: ['nothing'] }),
      },
      { previous },
    );
    expect(next.vision.textMinPx).toMatchObject({
      value: 24,
      source: 'override',
      override: 24,
    });
    expect(next.vision.textMinPx.measured).toBeGreaterThanOrEqual(54);
    expect(next.vision.polarity).toMatchObject({
      value: 'dark',
      source: 'override',
    });
    expect(next.vision.maxLineCh).toMatchObject({
      value: 62,
      source: 'override',
      measured: 70,
    });
    expect(next.motor.minTargetPx).toMatchObject({
      value: 56,
      source: 'override',
      measured: 32,
    });
    expect(next.motor.steadyClicks.value.on).toBe(true);
    expect(next.attention.motion).toEqual(previous.attention.motion);
    // Values that were not overridden follow the new measurement.
    expect(next.vision.contrastFloor.value).toBe(7);
  });

  it('carries modules that were not rerun from the previous profile', () => {
    const previous = derive({ reading: exampleB });
    const next = derive({ pointing: motor() }, { previous });
    expect(next.vision).toEqual(previous.vision);
    expect(next.modules).toEqual({
      reading: 'measured',
      pointing: 'measured',
      focus: 'not_run',
    });
    expect(next.confidence).toBeGreaterThan(0);
  });

  it('reverts derived values that a new reading no longer supports', () => {
    const previous = derive({ reading: exampleB });
    const next = derive({ reading: exampleA }, { previous });
    expect(next.vision.lineHeight.value).toBe(1.5);
    expect(next.vision.maxLineCh.value).toBe(80);
    expect(next.vision.fontWeightFloor.value).toBe(400);
  });

  it('is deterministic', () => {
    const modules = {
      reading: exampleB,
      pointing: motor(),
      focus: focus({ chips: ['busy'] }),
    };
    expect(derive(modules)).toEqual(derive(modules));
  });

  it('always parses, keeps confidence in [0, 1] and never produces NaN (seeded fuzz)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const random = seededRandom(seed);
      const pick = <T>(xs: readonly T[]): T =>
        xs[Math.floor(random() * xs.length)] as T;
      const maybe = <T>(v: T): T | null => (random() < 0.3 ? null : v);
      const effect = () =>
        maybe({
          value: 4 * random() - 2,
          se: 0.01 + random(),
          n: Math.floor(20 * random()),
        });
      const ladder = [24, 32, 44, 56, 72, 96] as const;
      const reading: VisionSummary = {
        status: pick(['measured', 'skipped'] as const),
        comfortPx: maybe(8 + 150 * random()),
        criticalPx: maybe(4 + 150 * random()),
        bracket: pick(['0.1', '0.2', 'none'] as const),
        plateauPoints: Math.floor(10 * random()),
        accuracy: random(),
        largePrint: random() < 0.3,
        displayLimited: random() < 0.2,
        contrast: maybe({
          alphaLog: -3 * random(),
          sd: 2 * random(),
          ceiling: random() < 0.3,
          trials: Math.floor(10 * random()),
        }),
        polarity: maybe({
          deltaLog: 4 * random() - 2,
          se: 2 * random(),
          stated: pick(['light', 'dark', 'same', null] as const),
        }),
        overrides:
          random() < 0.3
            ? {
                textPx: 8 + 190 * random(),
                polarity: pick(['light', 'dark', 'none'] as const),
              }
            : {},
        referenceXHeightRatio: 0.3 + 0.4 * random(),
        durationSec: 90,
      };
      const pointing = motor({
        status: pick(['measured', 'skipped'] as const),
        input: pick(['mouse', 'trackpad', 'touch', 'other'] as const),
        recommendedPx: maybe(pick(ladder)),
        recommendedConfidence: random(),
        chosenPx: maybe(pick(ladder)),
        slip: {
          presses: Math.floor(60 * random()),
          slipOffs: Math.floor(10 * random()),
          p95Px: 60 * random(),
          pressP90Ms: 2000 * random(),
        },
        repeats: {
          count: Math.floor(8 * random()),
          p95IntervalMs: 2000 * random(),
        },
        hold: maybe({
          jitterP95Px: 80 * random(),
          exits: Math.floor(5 * random()),
        }),
        drag: maybe({
          attempts: 3,
          successes: Math.floor(4 * random()),
          earlyReleases: Math.floor(3 * random()),
          timeRatio: maybe(10 * random()),
          skipped: random() < 0.2,
        }),
      });
      const focusSummary = focus({
        status: pick(['measured', 'skipped'] as const),
        motionShown: random() < 0.7,
        stopMotionPressed: random() < 0.2,
        effects: {
          clutter: effect(),
          motion: effect(),
          guidance: effect(),
          chunking: effect(),
        },
        decoyCapture: maybe(random()),
        preferences: {
          still: maybe(pick([-2, -1, 0, 1, 2])),
          clean: maybe(pick([-2, -1, 0, 1, 2])),
          chunked: maybe(pick([-2, -1, 0, 1, 2])),
          hierarchy: maybe(pick([-2, -1, 0, 1, 2])),
        },
        chips: [
          pick([
            'moving',
            'busy',
            'long_text',
            'unclear_action',
            'nothing',
          ] as const),
        ],
      });
      const device: Partial<DeviceContext> = {
        reducedMotion: random() < 0.3,
        moreContrast: random() < 0.3,
        zoom: 0.5 + 2 * random(),
        dprBucket: pick([1, 1.5, 2, 3]),
        rootFontPx: 12 + 12 * random(),
      };
      const first = derive(
        { reading, pointing, focus: focusSummary },
        { device },
      );
      const second = derive(
        { reading: { ...reading, status: 'measured' } },
        { device, previous: first },
      );
      for (const p of [first, second]) {
        expect(() => fitProfileSchema.parse(p)).not.toThrow();
        expect(hasNaN(p)).toBe(false);
        for (const c of allConfidences(p)) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
