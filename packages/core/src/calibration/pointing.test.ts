import { describe, expect, it } from 'vitest';

import {
  isBlockAccepted,
  nextRingStep,
  POINTER_LADDER,
  ringDiameter,
  ringPositions,
  seededRandom,
  summarizePointing,
  type RingInput,
} from './pointing';
import { motorSummarySchema } from './schema';
import type {
  Point,
  PointerBlock,
  PointerTrial,
  PointingSession,
} from './trials';

/* ------------------------------------------------------------------------ */
/* A small seeded pointing simulator (cal-motor.md Appendix A model)          */
/* ------------------------------------------------------------------------ */

interface Pointer {
  /** Absolute precision floor, px. */
  sigmaA: number;
  /** Speed/accuracy slope. */
  c: number;
  /** Probability of a lapse (endpoint offset ~ N(0, 3W)). */
  lapse: number;
  /** Probability that the pointer slips while the button is held. */
  slip: number;
  slipPx: number;
  /** Probability of an accidental second press on the same target. */
  repeat: number;
}

const TYPICAL: Pointer = {
  sigmaA: 1.5,
  c: 0.15,
  lapse: 0.02,
  slip: 0,
  slipPx: 0,
  repeat: 0,
};

function gauss(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function sigmaAt(p: Pointer, w: number): number {
  return Math.sqrt(p.sigmaA ** 2 + (p.c * w) ** 2);
}

/** The ladder level a perfect measurement would recommend (true miss rate <= 8%). */
function trueSize(p: Pointer, input: RingInput): number {
  const ladder = input === 'touch' ? [32, 44, 56, 72, 96] : [...POINTER_LADDER];
  for (const l of ladder) {
    const s = Math.sqrt((1.15 * p.sigmaA) ** 2 + (p.c * l) ** 2);
    if (Math.exp(-(l * l) / (8 * s * s)) <= 0.08) return l;
  }
  return 96;
}

function simulateBlock(
  w: number,
  p: Pointer,
  random: () => number,
  opts: { trials?: number; diameter?: number; t0?: number } = {},
): PointerBlock {
  const n = opts.trials ?? 10;
  const ring = ringPositions(9, opts.diameter ?? 240);
  const trials: PointerTrial[] = [];
  let t = opts.t0 ?? 0;
  let prev: Point = ring[ring.length - 1] ?? { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    const target = ring[i % ring.length] ?? { x: 0, y: 0 };
    const lapsed = random() < p.lapse;
    const s = lapsed ? 3 * w : sigmaAt(p, w);
    const down = {
      x: target.x + s * gauss(random),
      y: target.y + s * gauss(random),
    };
    const slipped = random() < p.slip;
    const angle = 2 * Math.PI * random();
    const drift = slipped ? p.slipPx : 0.3;
    const up = {
      x: down.x + drift * Math.cos(angle),
      y: down.y + drift * Math.sin(angle),
    };
    const amplitude = Math.hypot(target.x - prev.x, target.y - prev.y);
    const moveMs =
      250 + 160 * Math.log2(amplitude / w + 1) + 60 * gauss(random);
    const tStart = t;
    const tDown = tStart + Math.max(150, moveMs);
    const pressMs = 90 + 40 * random();
    const hitDown = Math.hypot(down.x - target.x, down.y - target.y) <= w / 2;
    trials.push({
      targetPx: w,
      targetCenter: target,
      start: prev,
      tStart,
      tDown,
      tUp: tDown + pressMs,
      down,
      up,
      hitDown,
      hitUp: Math.hypot(up.x - target.x, up.y - target.y) <= w / 2,
      pressMs,
      pressPathMaxPx: drift,
      speedAtDown: hitDown ? 0.05 + 0.1 * random() : 0.05 + 0.2 * random(),
      extraPresses:
        random() < p.repeat
          ? [{ dtMs: 120 + 100 * random(), distPx: 1, sameTarget: true }]
          : [],
      pointerType: 'mouse',
      scored: i > 0,
    });
    t = tDown + pressMs;
    prev = target;
  }
  return { targetPx: w, trials };
}

function simulateSession(
  p: Pointer,
  seed: number,
  input: RingInput = 'pointer',
  extra: Partial<PointingSession> = {},
): PointingSession {
  const random = seededRandom(seed);
  const blocks: PointerBlock[] = [];
  for (
    let step = nextRingStep(input, blocks);
    step.nextPx !== null;
    step = nextRingStep(input, blocks)
  ) {
    blocks.push(simulateBlock(step.nextPx, p, random));
  }
  return {
    input: input === 'touch' ? 'touch' : 'mouse',
    blocks,
    holds: [],
    drags: [],
    returnBlock: null,
    chosenPx: null,
    express: false,
    durationSec: 70,
    ...extra,
  };
}

/** A block whose scored presses land at the given radii from the target centre. */
function blockAtRadii(w: number, radii: readonly number[]): PointerBlock {
  const center = { x: 0, y: 0 };
  const trials: PointerTrial[] = [0, ...radii].map((r, i) => ({
    targetPx: w,
    targetCenter: center,
    start: { x: -200, y: 0 },
    tStart: i * 1000,
    tDown: i * 1000 + 600,
    tUp: i * 1000 + 700,
    down: { x: r, y: 0 },
    up: { x: r, y: 0 },
    hitDown: r <= w / 2,
    hitUp: r <= w / 2,
    pressMs: 100,
    pressPathMaxPx: 0,
    speedAtDown: 0.1,
    extraPresses: [],
    pointerType: 'mouse',
    scored: i > 0,
  }));
  return { targetPx: w, trials };
}

const good = (w: number) =>
  blockAtRadii(
    w,
    Array.from({ length: 9 }, (_v, i) => 1 + (i % 3)),
  );
const bad = (w: number) => blockAtRadii(w, [1, 2, w, w, w, 3, w, 2, 1]);
const goodOneMiss = (w: number) => blockAtRadii(w, [1, 2, 3, 1, 2, 3, 1, 2, w]);

function hasNaN(value: unknown): boolean {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v,
  ).includes('"NaN"');
}

/* ------------------------------------------------------------------------ */

describe('ringPositions', () => {
  it('orders an odd ring so successive targets alternate across the circle', () => {
    const pts = ringPositions(9, 240);
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual({ x: 0, y: -120 });
    const keys = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(9);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) throw new Error('missing point');
      // A = D sin(4 pi / 9) ~= 0.985 D
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(
        240 * Math.sin((4 * Math.PI) / 9),
        0,
      );
    }
  });

  it('handles an even ring without repeating targets', () => {
    const pts = ringPositions(8, 200);
    expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(8);
    const first = pts[0];
    const second = pts[1];
    if (!first || !second) throw new Error('missing point');
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeCloseTo(
      200,
      5,
    );
  });
});

describe('ringDiameter', () => {
  it('follows the pointer and touch clamps', () => {
    expect(ringDiameter(1440, 900, 'pointer')).toBe(252);
    expect(ringDiameter(2560, 1440, 'pointer')).toBe(280);
    expect(ringDiameter(375, 667, 'pointer')).toBe(160);
    expect(ringDiameter(390, 844, 'touch')).toBe(120);
    expect(ringDiameter(1024, 768, 'touch')).toBe(230);
  });

  it('shrinks below the 1-D threshold on tiny viewports', () => {
    expect(ringDiameter(200, 200, 'pointer')).toBe(128);
    expect(ringDiameter(150, 300, 'pointer')).toBeLessThan(120);
    expect(ringDiameter(0, 0, 'touch')).toBe(0);
  });
});

describe('block acceptance', () => {
  it('accepts tight blocks with at most one miss in nine', () => {
    expect(isBlockAccepted(good(44))).toBe(true);
    expect(isBlockAccepted(goodOneMiss(44))).toBe(true);
    expect(isBlockAccepted(bad(44))).toBe(false);
  });

  it('rejects a block with no misses when the spread is too wide (sigma condition)', () => {
    // Every press lands inside the 22 px radius, but sigma = 15 / 1.1774 = 12.7 > 7.8.
    const block = blockAtRadii(
      44,
      Array.from({ length: 9 }, () => 15),
    );
    expect(block.trials.filter((t) => t.scored).every((t) => t.hitDown)).toBe(
      true,
    );
    expect(isBlockAccepted(block)).toBe(false);
  });

  it('never accepts a block with too few scored presses', () => {
    expect(isBlockAccepted(blockAtRadii(44, [1, 1, 1]))).toBe(false);
  });
});

describe('nextRingStep: pointer', () => {
  it('starts at 44 and descends 44 -> 32 -> 24 while accepted', () => {
    expect(nextRingStep('pointer', [])).toEqual({ nextPx: 44, accepted: null });
    expect(nextRingStep('pointer', [good(44)])).toEqual({
      nextPx: 32,
      accepted: true,
    });
    expect(nextRingStep('pointer', [good(44), good(32)])).toEqual({
      nextPx: 24,
      accepted: true,
    });
    expect(nextRingStep('pointer', [good(44), good(32), good(24)])).toEqual({
      nextPx: null,
      accepted: true,
    });
  });

  it('stops at the first rejection when descending', () => {
    expect(nextRingStep('pointer', [good(44), bad(32)])).toEqual({
      nextPx: null,
      accepted: false,
    });
  });

  it('ascends 44 -> 56 -> 72 while rejected and stops at the first acceptance', () => {
    expect(nextRingStep('pointer', [bad(44)])).toEqual({
      nextPx: 56,
      accepted: false,
    });
    expect(nextRingStep('pointer', [bad(44), bad(56)])).toEqual({
      nextPx: 72,
      accepted: false,
    });
    expect(nextRingStep('pointer', [bad(44), bad(56), bad(72)])).toEqual({
      nextPx: null,
      accepted: false,
    });
    expect(nextRingStep('pointer', [bad(44), good(56)])).toEqual({
      nextPx: null,
      accepted: true,
    });
  });

  it('respects the block limit (express mode)', () => {
    expect(
      nextRingStep('pointer', [good(44), good(32)], { maxBlocks: 2 }).nextPx,
    ).toBeNull();
  });
});

describe('nextRingStep: touch', () => {
  it('starts at 56 and descends to 44, then 32 only after a clean 44', () => {
    expect(nextRingStep('touch', []).nextPx).toBe(56);
    expect(nextRingStep('touch', [good(56)]).nextPx).toBe(44);
    expect(nextRingStep('touch', [good(56), good(44)]).nextPx).toBe(32);
    expect(nextRingStep('touch', [good(56), goodOneMiss(44)])).toEqual({
      nextPx: null,
      accepted: true,
    });
    expect(
      nextRingStep('touch', [good(56), good(44), good(32)]).nextPx,
    ).toBeNull();
  });

  it('ascends 56 -> 72 -> 96', () => {
    expect(nextRingStep('touch', [bad(56)]).nextPx).toBe(72);
    expect(nextRingStep('touch', [bad(56), bad(72)]).nextPx).toBe(96);
    expect(
      nextRingStep('touch', [bad(56), bad(72), bad(96)]).nextPx,
    ).toBeNull();
  });
});

describe('summarizePointing on simulated sessions', () => {
  const ladder = [...POINTER_LADDER] as number[];

  /**
   * The population of cal-motor.md Appendix A: sigma_a from 0.5 to 14 px,
   * c ~ U(0.12, 0.20), 4% lapses. The adaptive walk with 9 scored presses per
   * block places people within one ladder level most of the time, and its
   * errors lean toward larger targets (the cheap direction).
   */
  it.each(['pointer', 'touch'] as const)(
    'places a simulated population within one level (%s)',
    (input) => {
      const random = seededRandom(99);
      let within = 0;
      let under = 0;
      let n = 0;
      for (const sigmaA of [0.5, 1, 2, 3, 4, 6, 8, 10, 12, 14]) {
        for (let seed = 1; seed <= 40; seed++) {
          const pointer = {
            ...TYPICAL,
            sigmaA,
            c: 0.12 + 0.08 * random(),
            lapse: 0.04,
          };
          const summary = summarizePointing(
            simulateSession(pointer, seed * 7 + sigmaA * 100, input),
            { bootstrapReps: 0 },
          );
          const got = ladder.indexOf(summary.recommendedPx ?? 96);
          const truth = ladder.indexOf(trueSize(pointer, input));
          n++;
          if (Math.abs(got - truth) <= 1) within++;
          if (got < truth) under++;
        }
      }
      expect(within / n).toBeGreaterThanOrEqual(0.6);
      expect(under / n).toBeLessThanOrEqual(0.2);
    },
  );

  it('keeps typical pointers small and never jumps them to the top of the ladder', () => {
    const sizes: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const summary = summarizePointing(simulateSession(TYPICAL, seed), {
        bootstrapReps: 0,
      });
      sizes.push(summary.recommendedPx ?? 96);
    }
    sizes.sort((a, b) => a - b);
    expect(sizes[Math.floor(sizes.length / 2)]).toBeLessThanOrEqual(32);
    expect(Math.max(...sizes)).toBeLessThan(96);
  });

  it('gives large targets to imprecise pointers', () => {
    let large = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const summary = summarizePointing(
        simulateSession({ ...TYPICAL, sigmaA: 14, c: 0.2 }, seed),
        { bootstrapReps: 0 },
      );
      if ((summary.recommendedPx ?? 0) >= 72) large++;
    }
    expect(large / 40).toBeGreaterThanOrEqual(0.9);
  });

  it('recommends larger targets as the precision floor grows', () => {
    const meanIndex = (sigmaA: number) => {
      let total = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const summary = summarizePointing(
          simulateSession({ ...TYPICAL, sigmaA }, seed),
          { bootstrapReps: 0 },
        );
        total += ladder.indexOf(summary.recommendedPx ?? 96);
      }
      return total / 30;
    };
    const means = [1, 4, 8, 14].map(meanIndex);
    for (let i = 1; i < means.length; i++)
      expect(means[i]).toBeGreaterThan(means[i - 1] ?? 0);
  });

  it('produces schema-valid, finite summaries with confidence in [0, 1]', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const pointer = {
        ...TYPICAL,
        sigmaA: 1 + (seed % 12),
        slip: (seed % 4) * 0.05,
        slipPx: 8,
        repeat: 0.05,
      };
      const input: RingInput = seed % 3 === 0 ? 'touch' : 'pointer';
      const summary = summarizePointing(simulateSession(pointer, seed, input), {
        bootstrapReps: 40,
      });
      expect(() => motorSummarySchema.parse(summary)).not.toThrow();
      expect(summary.recommendedConfidence).toBeGreaterThanOrEqual(0);
      expect(summary.recommendedConfidence).toBeLessThanOrEqual(1);
      expect(hasNaN(summary)).toBe(false);
      if (input === 'touch')
        expect(summary.recommendedPx).toBeGreaterThanOrEqual(32);
    }
  });

  it('is deterministic: the seeded bootstrap gives identical summaries', () => {
    const session = simulateSession({ ...TYPICAL, sigmaA: 6 }, 7);
    expect(summarizePointing(session)).toEqual(summarizePointing(session));
  });

  it('fits a precision floor that grows with the true floor', () => {
    const floor = (sigmaA: number) =>
      summarizePointing(simulateSession({ ...TYPICAL, sigmaA, lapse: 0 }, 11), {
        bootstrapReps: 0,
      }).precisionFloorPx ?? 0;
    expect(floor(12)).toBeGreaterThan(floor(1));
  });
});

describe('summarizePointing statistics', () => {
  it('counts slip-offs, repeats and fly-by presses', () => {
    const random = seededRandom(3);
    const block = simulateBlock(44, TYPICAL, random);
    const trials = block.trials.map((t, i): PointerTrial => {
      if (i === 2 || i === 4) {
        // Pressed on target, released 30 px away: a slip-off.
        return {
          ...t,
          down: t.targetCenter,
          hitDown: true,
          up: { x: t.targetCenter.x + 30, y: t.targetCenter.y },
          hitUp: false,
        };
      }
      if (i === 5)
        return {
          ...t,
          extraPresses: [
            { dtMs: 180, distPx: 2, sameTarget: true },
            { dtMs: 900, distPx: 2, sameTarget: true },
          ],
        };
      if (i === 6)
        return {
          ...t,
          hitDown: false,
          down: { x: t.targetCenter.x + 200, y: t.targetCenter.y },
          speedAtDown: 3,
        };
      return {
        ...t,
        down: t.targetCenter,
        up: t.targetCenter,
        hitDown: true,
        hitUp: true,
      };
    });
    const summary = summarizePointing({
      input: 'mouse',
      blocks: [{ targetPx: 44, trials }],
      holds: [],
      drags: 'skipped',
      returnBlock: null,
      chosenPx: 50,
      express: false,
      durationSec: 30,
    });
    expect(summary.slip.slipOffs).toBe(2);
    expect(summary.slip.presses).toBe(trials.length);
    expect(summary.slip.p95Px).toBeGreaterThan(20);
    expect(summary.repeats.count).toBe(1);
    expect(summary.repeats.p95IntervalMs).toBe(180);
    expect(summary.flyBy).toBe(1);
    expect(summary.drag).toEqual({
      attempts: 0,
      successes: 0,
      earlyReleases: 0,
      timeRatio: null,
      skipped: true,
    });
    expect(summary.chosenPx).toBe(56);
    expect(summary.blocks[0]?.misses).toBe(1);
  });

  it('summarizes holds, drags and the fatigue check', () => {
    const random = seededRandom(5);
    const first = simulateBlock(44, { ...TYPICAL, lapse: 0 }, random);
    const slowReturn: PointerBlock = {
      targetPx: 44,
      trials: simulateBlock(44, { ...TYPICAL, lapse: 0 }, random, {
        trials: 5,
      }).trials.map((t, i) => ({
        ...t,
        tDown: t.tStart + 3000,
        hitDown: i !== 2,
        scored: true,
      })),
    };
    const summary = summarizePointing({
      input: 'trackpad',
      blocks: [first],
      holds: [
        { jitterP95Px: 2, exits: 0 },
        { jitterP95Px: 4, exits: 1 },
      ],
      drags: [
        { success: true, earlyRelease: false, regrabs: 0, moveMs: 1500 },
        { success: false, earlyRelease: true, regrabs: 1, moveMs: 2600 },
        { success: true, earlyRelease: false, regrabs: 0, moveMs: 1800 },
      ],
      returnBlock: slowReturn,
      chosenPx: null,
      express: false,
      durationSec: 80,
    });
    expect(summary.hold).toEqual({ jitterP95Px: 3, exits: 1 });
    expect(summary.drag?.attempts).toBe(3);
    expect(summary.drag?.successes).toBe(2);
    expect(summary.drag?.earlyReleases).toBe(1);
    expect(summary.drag?.timeRatio).toBeGreaterThan(1);
    expect(summary.fatigue).toBe(true);
  });

  it('skips keyboard sessions and sessions without blocks', () => {
    const base: PointingSession = {
      input: 'keyboard',
      blocks: [],
      holds: [],
      drags: 'skipped',
      returnBlock: null,
      chosenPx: null,
      express: false,
      durationSec: 5,
    };
    const summary = summarizePointing(base);
    expect(summary.status).toBe('skipped');
    expect(summary.recommendedPx).toBeNull();
    expect(() => motorSummarySchema.parse(summary)).not.toThrow();
    expect(summarizePointing({ ...base, input: 'mouse' }).status).toBe(
      'skipped',
    );
  });
});
