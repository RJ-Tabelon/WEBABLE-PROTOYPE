import type { InputClass } from '../profile/schema';
import type { MotorSummary } from './schema';
import type {
  DragTrial,
  Point,
  PointerBlock,
  PointerTrial,
  PointingSession,
} from './trials';

/**
 * Pointing calibration (cal-motor.md 5.2-5.6).
 *
 * Everything here is pure and deterministic. Raw trials are reduced to the
 * bounded `MotorSummary`; nothing kinematic beyond the listed statistics is
 * computed, and no trial data survives the call.
 */

/** Pointer ladder (CSS px). Touch uses the same ladder but starts at 56. */
export const POINTER_LADDER = [24, 32, 44, 56, 72, 96] as const;

/** Targets on the ISO ring. Odd, so successive targets alternate across the circle. */
export const RING_TARGET_COUNT = 9;

/** Below this ring diameter the UI switches to a 1-D reciprocal pair (cal-motor.md 5.2). */
export const RING_MIN_DIAMETER = 120;

/** Geometry of the optional drag step (cal-motor.md 5.2, S4). */
export const DRAG_TASK = {
  tokenPx: 44,
  wellPx: 72,
  distancePx: { pointer: 200, touch: 160 },
} as const;

/** Scored trials a block needs before it can be accepted. */
const MIN_SCORED_TRIALS = 5;
/** sigma = median(r) / sqrt(2 ln 2) for an isotropic bivariate normal. */
const MEDIAN_RADIUS_TO_SIGMA = Math.sqrt(2 * Math.LN2);
/** Block acceptance: sigma * 1.15 <= W / 4.895 (5% circular miss radius plus 15% margin). */
const SIGMA_MARGIN = 1.15;
const FIVE_PERCENT_DIVISOR = 4.895;
/** Model acceptance for S*: predicted miss rate at most 8%. */
const MODEL_MAX_MISS = 0.08;
/** A tested level with at least a third of presses missed is never recommended. */
const GUARD_MISS_RATE = 1 / 3;
/** Speed/accuracy slope bounds and the prior used when only one size was tested. */
const C_MIN = 0.08;
const C_MAX = 0.3;
const C_PRIOR = 0.15;
/** Accidental repeat: another press within 500 ms, under 5 px away or on the same target. */
const REPEAT_WINDOW_MS = 500;
const REPEAT_RADIUS_PX = 5;
/** Fly-by threshold floor, px/ms. */
const FLY_BY_MIN_SPEED = 0.8;
/** Fatigue: return block slower by 30% with at least one miss. */
const FATIGUE_SLOWDOWN = 1.3;
const BOOTSTRAP_REPS = 200;
const DEFAULT_SEED = 0x5eed_a11;

export type RingInput = 'pointer' | 'touch';

/** Which ladder walk an input class uses. */
export function ringInputOf(input: InputClass): RingInput {
  return input === 'touch' ? 'touch' : 'pointer';
}

/* ------------------------------------------------------------------------ */
/* Deterministic randomness                                                   */
/* ------------------------------------------------------------------------ */

/** Mulberry32: small, fast, seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal deviate (Box-Muller) from a uniform source. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ------------------------------------------------------------------------ */
/* Small numeric helpers (kept private to avoid index re-export collisions)   */
/* ------------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Type-7 (linear interpolation) quantile of a sample; 0 for an empty sample. */
function quantile(values: readonly number[], q: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/* ------------------------------------------------------------------------ */
/* Geometry                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Target centres for an ISO 9241-411 multidirectional ring, in presentation
 * order, relative to the ring centre (CSS px, y down). Position 0 is at the
 * top; positions run clockwise. With an odd count the sequence alternates
 * across the circle (9 targets: 0, 5, 1, 6, 2, 7, 3, 8, 4), so every movement
 * spans nearly the full diameter.
 */
export function ringPositions(count: number, diameter: number): Point[] {
  const n = Math.max(2, Math.floor(count));
  const r = Math.max(0, diameter) / 2;
  const position = (i: number): Point => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: round(r * Math.cos(theta)), y: round(r * Math.sin(theta)) };
  };
  const order: number[] = [];
  if (n % 2 === 1) {
    const stride = (n + 1) / 2;
    for (let k = 0; k < n; k++) order.push((k * stride) % n);
  } else {
    const half = n / 2;
    for (let k = 0; k < n; k++)
      order.push(Math.floor(k / 2) + (k % 2 === 1 ? half : 0));
  }
  return order.map(position);
}

/**
 * Ring diameter in CSS px (cal-motor.md 5.2): clamp(round(0.28 * min side), 160, 280)
 * for pointers and clamp(round(0.30 * min side), 120, 260) for touch, never larger
 * than the space left once the largest target fits. A result below
 * `RING_MIN_DIAMETER` means the UI should use the 1-D reciprocal pair instead.
 */
export function ringDiameter(
  viewportW: number,
  viewportH: number,
  input: RingInput,
): number {
  const side = Math.max(0, Math.min(viewportW, viewportH));
  const [factor, lo, hi, largest] =
    input === 'touch' ? [0.3, 120, 260, 96] : [0.28, 160, 280, 72];
  const preferred = clamp(Math.round(factor * side), lo, hi);
  return Math.max(0, Math.min(preferred, Math.floor(side - largest)));
}

/* ------------------------------------------------------------------------ */
/* Per-block statistics                                                       */
/* ------------------------------------------------------------------------ */

interface BlockStats {
  targetPx: number;
  /** Scored presses. */
  scored: number;
  /** Scored presses that landed outside the target (press position decides). */
  misses: number;
  /** Press distances from the target centre within 2W (used for sigma). */
  radii: number[];
  /** Scored presses further than 2W away: counted, not deleted. */
  farPresses: number;
  /** Robust endpoint spread, or null when no press was within 2W. */
  sigmaPx: number | null;
  medianMoveMs: number;
}

function scoredTrials(block: PointerBlock): PointerTrial[] {
  return block.trials.filter((t) => t.scored);
}

function blockStats(block: PointerBlock): BlockStats {
  const w = block.targetPx;
  const scored = scoredTrials(block);
  const radii: number[] = [];
  let farPresses = 0;
  for (const t of scored) {
    const r = distance(t.down, t.targetCenter);
    if (!Number.isFinite(r)) continue;
    if (r > 2 * w) farPresses++;
    else radii.push(r);
  }
  return {
    targetPx: w,
    scored: scored.length,
    misses: scored.filter((t) => !t.hitDown).length,
    radii,
    farPresses,
    sigmaPx: radii.length > 0 ? median(radii) / MEDIAN_RADIUS_TO_SIGMA : null,
    medianMoveMs: median(scored.map((t) => t.tDown - t.tStart)),
  };
}

function allowedMisses(scored: number): number {
  return Math.max(1, Math.round(scored / 9));
}

/** cal-motor.md 5.2: accept W if misses <= 1 of 9 and sigma * 1.15 <= W / 4.895. */
function acceptStats(
  s: Pick<BlockStats, 'targetPx' | 'scored' | 'misses' | 'sigmaPx'>,
): boolean {
  if (s.scored < MIN_SCORED_TRIALS || s.sigmaPx === null) return false;
  return (
    s.misses <= allowedMisses(s.scored) &&
    s.sigmaPx * SIGMA_MARGIN <= s.targetPx / FIVE_PERCENT_DIVISOR
  );
}

/** Whether a completed ring block meets the acceptance rule. */
export function isBlockAccepted(block: PointerBlock): boolean {
  return acceptStats(blockStats(block));
}

/* ------------------------------------------------------------------------ */
/* Ladder walk                                                                */
/* ------------------------------------------------------------------------ */

export interface RingStep {
  /** Target size for the next block, or null when the walk is finished. */
  nextPx: number | null;
  /** Whether the block just completed was accepted (cal-motor.md 5.2 rule). */
  accepted: boolean | null;
}

const WALK: Record<RingInput, { start: number; rungs: readonly number[] }> = {
  pointer: { start: 44, rungs: [24, 32, 44, 56, 72] },
  touch: { start: 56, rungs: [32, 44, 56, 72, 96] },
};

/**
 * Adaptive ladder walk for the pointing ring (cal-motor.md 5.2).
 * Pointer: start 44; accepted -> 32 -> 24; rejected -> 56 -> 72.
 * Touch: start 56; accepted -> 44 (-> 32 only with 0 misses); rejected -> 72 -> 96.
 * Stop at the first rejection when descending or first acceptance when ascending; max 4 blocks
 * (express mode passes `maxBlocks: 2`).
 */
export function nextRingStep(
  input: RingInput,
  completed: readonly PointerBlock[],
  options: { maxBlocks?: number } = {},
): RingStep {
  const walk = WALK[input];
  const maxBlocks = clamp(Math.floor(options.maxBlocks ?? 4), 1, 6);
  const last = completed.at(-1);
  const first = completed[0];
  if (!last || !first) return { nextPx: walk.start, accepted: null };

  const lastStats = blockStats(last);
  const accepted = acceptStats(lastStats);
  if (completed.length >= maxBlocks) return { nextPx: null, accepted };

  const descending = acceptStats(blockStats(first));
  const idx = walk.rungs.indexOf(last.targetPx);
  if (idx < 0) return { nextPx: null, accepted };

  if (descending) {
    if (!accepted) return { nextPx: null, accepted };
    if (input === 'touch' && last.targetPx <= 44 && lastStats.misses > 0) {
      return { nextPx: null, accepted };
    }
    return { nextPx: walk.rungs[idx - 1] ?? null, accepted };
  }
  if (accepted) return { nextPx: null, accepted };
  return { nextPx: walk.rungs[idx + 1] ?? null, accepted };
}

/* ------------------------------------------------------------------------ */
/* Precision model and recommended size                                       */
/* ------------------------------------------------------------------------ */

interface PrecisionModel {
  /** Absolute precision floor sigma_a, CSS px. */
  sigmaA: number;
  /** Speed/accuracy slope c. */
  c: number;
}

interface FitPoint {
  w: number;
  sigma: number;
  weight: number;
}

/**
 * Least-squares fit of sigma(W)^2 = sigma_a^2 + (c W)^2 with sigma_a^2 >= 0 and
 * c in [0.08, 0.30] (cal-motor.md 5.5 item 3). The problem is a convex QP in
 * (A = sigma_a^2, B = c^2), so the optimum is the unconstrained solution when
 * feasible and otherwise lies on one of the box edges; every candidate is
 * evaluated and the lowest weighted SSE wins.
 */
function fitPrecision(points: readonly FitPoint[]): PrecisionModel | null {
  const pts = points.filter(
    (p) => p.weight > 0 && Number.isFinite(p.sigma) && p.w > 0,
  );
  if (pts.length === 0) return null;
  const bLo = C_MIN ** 2;
  const bHi = C_MAX ** 2;
  const xs = pts.map((p) => p.w ** 2);
  const ys = pts.map((p) => p.sigma ** 2);
  const ws = pts.map((p) => p.weight);
  const sw = ws.reduce((a, b) => a + b, 0);
  const wsum = (f: (i: number) => number) =>
    pts.reduce((acc, _p, i) => acc + (ws[i] ?? 0) * f(i), 0);
  const x = (i: number) => xs[i] ?? 0;
  const y = (i: number) => ys[i] ?? 0;
  const sse = (a: number, b: number) => wsum((i) => (y(i) - a - b * x(i)) ** 2);

  const distinct = new Set(pts.map((p) => p.w)).size;
  if (distinct < 2) {
    const xm = wsum(x) / sw;
    const ym = wsum(y) / sw;
    let b = clamp(C_PRIOR ** 2, bLo, bHi);
    let a = ym - b * xm;
    if (a < 0) {
      a = 0;
      b = clamp(ym / Math.max(xm, 1e-9), bLo, bHi);
    }
    return { sigmaA: Math.sqrt(a), c: Math.sqrt(b) };
  }

  const candidates: Array<[number, number]> = [];
  const xm = wsum(x) / sw;
  const ym = wsum(y) / sw;
  const sxx = wsum((i) => (x(i) - xm) ** 2);
  const sxy = wsum((i) => (x(i) - xm) * (y(i) - ym));
  if (sxx > 0) {
    const b = sxy / sxx;
    const a = ym - b * xm;
    if (a >= 0 && b >= bLo && b <= bHi) candidates.push([a, b]);
  }
  const sxx0 = wsum((i) => x(i) ** 2);
  candidates.push([
    0,
    clamp(sxx0 > 0 ? wsum((i) => x(i) * y(i)) / sxx0 : bLo, bLo, bHi),
  ]);
  for (const b of [bLo, bHi]) candidates.push([Math.max(0, ym - b * xm), b]);

  let best: [number, number] = candidates[0] ?? [0, C_PRIOR ** 2];
  let bestErr = Number.POSITIVE_INFINITY;
  for (const cand of candidates) {
    const err = sse(cand[0], cand[1]);
    if (err < bestErr) {
      bestErr = err;
      best = cand;
    }
  }
  return { sigmaA: Math.sqrt(best[0]), c: Math.sqrt(best[1]) };
}

/**
 * Predicted miss rate for a circular target of diameter L:
 * exp(-L^2 / (8 sigma(L)^2)) with sigma(L)^2 = (1.15 sigma_a)^2 + (c L)^2.
 */
function predictedMiss(model: PrecisionModel, l: number): number {
  const s2 = (SIGMA_MARGIN * model.sigmaA) ** 2 + (model.c * l) ** 2;
  if (s2 <= 0) return 0;
  return Math.exp(-(l * l) / (8 * s2));
}

function ladderFor(input: RingInput): readonly number[] {
  return input === 'touch' ? [32, 44, 56, 72, 96] : POINTER_LADDER;
}

interface SizeChoice {
  px: number;
  model: PrecisionModel | null;
}

/**
 * S* (cal-motor.md 5.5 item 5): the smallest ladder level with predicted miss
 * <= 8% and no tested block at that level with >= 3/9 misses, combined with
 * the smallest level the walk accepted: the smaller of the two when they agree
 * within one level, otherwise the larger. When no level was accepted, S* is
 * the model's level.
 */
function chooseSize(
  stats: readonly BlockStats[],
  input: RingInput,
): SizeChoice | null {
  const usable = stats.filter((s) => s.scored > 0);
  if (usable.length === 0) return null;
  const ladder = ladderFor(input);
  const model = fitPrecision(
    usable
      .filter((s) => s.sigmaPx !== null)
      .map((s) => ({
        w: s.targetPx,
        sigma: s.sigmaPx ?? 0,
        weight: s.radii.length,
      })),
  );

  const guarded = (l: number) =>
    usable.some(
      (s) => s.targetPx === l && s.misses / s.scored >= GUARD_MISS_RATE - 1e-9,
    );
  const top = ladder[ladder.length - 1] ?? 96;
  let modelPx = top;
  if (model) {
    for (const l of ladder) {
      if (predictedMiss(model, l) <= MODEL_MAX_MISS && !guarded(l)) {
        modelPx = l;
        break;
      }
    }
  } else {
    // No press landed near any target: only the observed misses speak.
    const largest = Math.max(...usable.map((s) => s.targetPx));
    modelPx = ladder.find((l) => l > largest) ?? top;
  }

  // The walk only votes when it accepted a level directly. The block rule
  // inflates the whole spread (sigma * 1.15), so it is scale-free: a person
  // whose speed/accuracy slope c exceeds 1 / (4.895 * 1.15) = 0.178 is
  // rejected at every size, and only the model can place them.
  const accepted = usable.filter(acceptStats).map((s) => s.targetPx);
  if (accepted.length === 0) return { px: modelPx, model };
  const walkPx = Math.min(...accepted);

  const iw = ladder.indexOf(walkPx);
  const im = ladder.indexOf(modelPx);
  const agree = iw >= 0 && im >= 0 && Math.abs(iw - im) <= 1;
  const px = agree ? Math.min(walkPx, modelPx) : Math.max(walkPx, modelPx);
  return { px, model };
}

/**
 * Parametric bootstrap (cal-motor.md 5.6): each block's in-range presses are
 * redrawn from an isotropic normal with that block's robust spread, far
 * presses are kept, and S* is recomputed. Confidence is the share of
 * replicates that land on the chosen level.
 */
function bootstrapConfidence(
  stats: readonly BlockStats[],
  input: RingInput,
  chosen: number,
  seed: number,
  reps: number,
): number {
  const random = seededRandom(seed);
  let agree = 0;
  for (let rep = 0; rep < reps; rep++) {
    const replicate = stats.map((s): BlockStats => {
      const sigma = Math.max(s.sigmaPx ?? s.targetPx, 0.25);
      const radii: number[] = [];
      let insideMisses = 0;
      for (let i = 0; i < s.radii.length; i++) {
        const r = Math.hypot(
          sigma * gaussian(random),
          sigma * gaussian(random),
        );
        radii.push(r);
        if (r > s.targetPx / 2) insideMisses++;
      }
      return {
        ...s,
        radii,
        misses: Math.min(s.scored, insideMisses + s.farPresses),
        sigmaPx:
          radii.length > 0 ? median(radii) / MEDIAN_RADIUS_TO_SIGMA : null,
      };
    });
    if (chooseSize(replicate, input)?.px === chosen) agree++;
  }
  return reps > 0 ? agree / reps : 0;
}

/* ------------------------------------------------------------------------ */
/* Session summary                                                            */
/* ------------------------------------------------------------------------ */

function snapToLadder(px: number): number {
  let best: number = POINTER_LADDER[0];
  for (const l of POINTER_LADDER) {
    if (Math.abs(Math.log(l / px)) < Math.abs(Math.log(best / px))) best = l;
  }
  return best;
}

function slipPx(t: PointerTrial): number {
  const d = distance(t.up, t.down);
  return Number.isFinite(d) ? d : 0;
}

function dragSummary(
  drags: PointingSession['drags'],
  blocks: readonly BlockStats[],
  input: RingInput,
  ringPresses: readonly PointerTrial[],
): MotorSummary['drag'] {
  if (drags === 'skipped') {
    return {
      attempts: 0,
      successes: 0,
      earlyReleases: 0,
      timeRatio: null,
      skipped: true,
    };
  }
  if (drags.length === 0) return null;
  const attempts = Math.min(10, drags.length);
  const used: DragTrial[] = drags.slice(0, attempts);
  // R_drag = median drag time / median pointing time at the nearest index of difficulty.
  const dragId = Math.log2(DRAG_TASK.distancePx[input] / DRAG_TASK.wellPx + 1);
  let timeRatio: number | null = null;
  const withTimes = blocks.filter((b) => b.scored > 0 && b.medianMoveMs > 0);
  if (withTimes.length > 0) {
    const idOf = (b: BlockStats) => {
      const amps = ringPresses
        .filter((t) => t.targetPx === b.targetPx)
        .map((t) => distance(t.start, t.targetCenter));
      const a = median(amps) || DRAG_TASK.distancePx[input];
      return Math.log2(a / b.targetPx + 1);
    };
    const nearest = withTimes.reduce((best, b) =>
      Math.abs(idOf(b) - dragId) < Math.abs(idOf(best) - dragId) ? b : best,
    );
    const dragMs = median(used.map((d) => d.moveMs));
    if (dragMs > 0 && nearest.medianMoveMs > 0) {
      timeRatio = round(clamp(dragMs / nearest.medianMoveMs, 0, 50));
    }
  }
  return {
    attempts,
    successes: used.filter((d) => d.success).length,
    earlyReleases: used.filter((d) => d.earlyRelease).length,
    timeRatio,
    skipped: false,
  };
}

export interface PointingSummaryOptions {
  /** Seed for the bootstrap; the default makes every summary reproducible. */
  seed?: number;
  /** Bootstrap replicates (default 200). */
  bootstrapReps?: number;
}

function skippedSummary(session: PointingSession): MotorSummary {
  return {
    status: 'skipped',
    input: session.input,
    blocks: [],
    recommendedPx: null,
    recommendedConfidence: 0,
    precisionFloorPx: null,
    slip: { presses: 0, slipOffs: 0, p95Px: 0, pressP90Ms: 0 },
    repeats: { count: 0, p95IntervalMs: 0 },
    flyBy: 0,
    hold: null,
    drag: null,
    fatigue: false,
    chosenPx: session.chosenPx === null ? null : snapToLadder(session.chosenPx),
    express: session.express,
    durationSec: round(clamp(session.durationSec, 0, 3600), 1),
  };
}

/** Reduce a pointing session to its persisted summary (cal-motor.md 5.5-5.6). */
export function summarizePointing(
  session: PointingSession,
  options: PointingSummaryOptions = {},
): MotorSummary {
  const input = ringInputOf(session.input);
  const ringBlocks = session.blocks.slice(0, 6);
  const stats = ringBlocks.map(blockStats);
  if (session.input === 'keyboard' || !stats.some((s) => s.scored > 0)) {
    return skippedSummary(session);
  }

  const choice = chooseSize(stats, input);
  const recommendedPx = choice ? snapToLadder(choice.px) : null;
  const recommendedConfidence =
    choice && recommendedPx !== null
      ? bootstrapConfidence(
          stats,
          input,
          choice.px,
          options.seed ?? DEFAULT_SEED,
          Math.max(0, Math.floor(options.bootstrapReps ?? BOOTSTRAP_REPS)),
        )
      : 0;

  // Every press: ring (scored or not), return block and the clicks after holds.
  const ringPresses = ringBlocks.flatMap((b) => b.trials);
  const presses: PointerTrial[] = [
    ...ringPresses,
    ...(session.returnBlock?.trials ?? []),
    ...session.holds.flatMap((h) => (h.click ? [h.click] : [])),
  ];

  const slipOffs = presses.filter((t) => t.hitDown && !t.hitUp).length;
  const repeatIntervals = presses.flatMap((t) =>
    t.extraPresses
      .filter(
        (e) =>
          e.dtMs >= 0 &&
          e.dtMs < REPEAT_WINDOW_MS &&
          (e.distPx < REPEAT_RADIUS_PX || e.sameTarget),
      )
      .map((e) => e.dtMs),
  );
  const hitSpeeds = presses.filter((t) => t.hitDown).map((t) => t.speedAtDown);
  const vHi = Math.max(FLY_BY_MIN_SPEED, 3 * median(hitSpeeds));
  const flyBy = presses.filter((t) => !t.hitDown && t.speedAtDown > vHi).length;

  const hold =
    session.holds.length > 0
      ? {
          jitterP95Px: round(
            clamp(median(session.holds.map((h) => h.jitterP95Px)), 0, 400),
          ),
          exits: clamp(
            session.holds.reduce(
              (acc, h) => acc + Math.max(0, Math.floor(h.exits)),
              0,
            ),
            0,
            50,
          ),
        }
      : null;

  let fatigue = false;
  const ret = session.returnBlock;
  if (ret && ret.trials.length > 0) {
    const retTrials = ret.trials.some((t) => t.scored)
      ? scoredTrials(ret)
      : ret.trials;
    const firstSame = stats.find(
      (s) => s.targetPx === ret.targetPx && s.scored > 0,
    );
    const retMs = median(retTrials.map((t) => t.tDown - t.tStart));
    if (firstSame && firstSame.medianMoveMs > 0) {
      const slowdown = retMs / firstSame.medianMoveMs;
      fatigue =
        slowdown > FATIGUE_SLOWDOWN && retTrials.some((t) => !t.hitDown);
    }
  }

  return {
    status: 'measured',
    input: session.input,
    blocks: stats.map((s) => ({
      targetPx: clamp(s.targetPx, 8, 160),
      trials: clamp(s.scored, 0, 20),
      misses: clamp(s.misses, 0, 20),
      sigmaPx: round(clamp(s.sigmaPx ?? 0, 0, 200)),
      medianMoveMs: Math.round(clamp(s.medianMoveMs, 0, 20000)),
    })),
    recommendedPx,
    recommendedConfidence: round(clamp(recommendedConfidence, 0, 1), 3),
    precisionFloorPx: choice?.model
      ? round(clamp(choice.model.sigmaA, 0, 100))
      : null,
    slip: {
      presses: clamp(presses.length, 0, 200),
      slipOffs: clamp(slipOffs, 0, 200),
      p95Px: round(clamp(quantile(presses.map(slipPx), 0.95), 0, 400)),
      pressP90Ms: Math.round(
        clamp(
          quantile(
            presses.map((t) => t.pressMs),
            0.9,
          ),
          0,
          5000,
        ),
      ),
    },
    repeats: {
      count: clamp(repeatIntervals.length, 0, 200),
      p95IntervalMs: Math.round(
        clamp(quantile(repeatIntervals, 0.95), 0, 2000),
      ),
    },
    flyBy: clamp(flyBy, 0, 200),
    hold,
    drag: dragSummary(session.drags, stats, input, ringPresses),
    fatigue,
    chosenPx: session.chosenPx === null ? null : snapToLadder(session.chosenPx),
    express: session.express,
    durationSec: round(clamp(session.durationSec, 0, 3600), 1),
  };
}
