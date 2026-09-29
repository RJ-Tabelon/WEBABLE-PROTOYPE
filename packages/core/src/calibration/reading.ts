import type { VisionSummary } from './schema';
import type {
  ContrastTrial,
  PolarityTrial,
  ReadingSession,
  ReadingTrial,
} from './trials';

/**
 * Reading calibration (cal-vision.md 3-4): the MNREAD-style size ladder, the
 * QUEST+ contrast staircase and the reduction of a session to its summary.
 *
 * Conventions:
 * - `ReadingSession.ladder[0]` (and `LadderState.trials[0]`) is the practice
 *   sentence at the start size. It is always discarded from scoring.
 * - Sizes are log10 of the rendered x-height (CSS px) internally; the summary
 *   reports font px of the reference font (x-height / referenceXHeightRatio).
 * - Speeds are log10 words per minute, net of the simple response time t0.
 */

/** Text sizes step by 0.1 log10 (x1.26). */
export const READING_STEP_LOG = 0.1;
/** Scored ladder sentences before the ladder stops. */
export const READING_MAX_TRIALS = 12;
/** Ladder time budget. */
export const READING_MAX_MS = 40_000;
/** Smallest rendered x-height the ladder shows, CSS px. */
export const READING_MIN_XHEIGHT_PX = 4;
/** Default simple response time subtracted from reading times (cal-vision.md 2.2). */
export const DEFAULT_T0_MS = 600;
/** Reference sans x-height ratio used when a trial reports no rendered x-height. */
const FALLBACK_XHEIGHT_RATIO = 0.53;

/** On-plateau during the walk: within 0.1 log of the fastest speed so far. */
const WALK_PLATEAU_LOG = 0.1;
/** Scoring plateau: at least 80% of MRS (log10(0.8) = -0.097). */
const CPS_PLATEAU_LOG = 0.097;
/** MRS set: within 0.15 log of the running estimate. */
const MRS_BAND_LOG = 0.15;
/** Two-limb MAP fit priors (cal-vision.md 4.1). */
const SLOPE_PRIOR = 1.5;
const SLOPE_PRIOR_LOG_SD = 0.5;
const KNEE_PRIOR_SD = 0.35;
/** Plateau residual SD used for polarity SE (default, clamp). */
const RESIDUAL_SD_DEFAULT = 0.08;
const RESIDUAL_SD_MIN = 0.05;
const RESIDUAL_SD_MAX = 0.15;
/** Minimum net reading time and maximum speed of a valid trial. */
const MIN_READ_MS = 800;
const MAX_WPM = 900;
/** Bracket tolerance for rendered x-height rounding. */
const BRACKET_TOLERANCE = 0.03;
/** "No objective comparison" standard error for polarity. */
const POLARITY_NO_DATA_SE = 2;

/* ------------------------------------------------------------------------ */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((a, b) => a + b, 0) / values.length;
}

function middle(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] ?? 0)
    : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function clampT0(t0Ms: number | undefined): number {
  return clamp(t0Ms ?? DEFAULT_T0_MS, 300, 1200);
}

/**
 * log10 words per minute for a correctly answered, undisturbed sentence, or
 * null when the trial carries no valid speed (error, can't read, skim, disturbed).
 */
function readingSpeed(
  t: {
    words: number;
    rtMs: number;
    correct: boolean;
    disturbed?: boolean;
    response?: string;
  },
  t0Ms: number,
): number | null {
  if (t.disturbed || t.response === 'cant' || !t.correct) return null;
  const readMs = t.rtMs - t0Ms;
  if (!(readMs >= MIN_READ_MS) || !(t.words > 0)) return null;
  const wpm = (60_000 * t.words) / readMs;
  if (!Number.isFinite(wpm) || wpm > MAX_WPM) return null;
  return Math.log10(wpm);
}

function xHeightOf(t: ReadingTrial, ratio: number): number {
  const h = t.xHeightPx > 0 ? t.xHeightPx : t.fontPx * ratio;
  return Math.max(h, 0.01);
}

/* ------------------------------------------------------------------------ */
/* V2: reading ladder walk                                                    */
/* ------------------------------------------------------------------------ */

export interface LadderState {
  /** Every sentence shown so far, practice first. */
  trials: readonly ReadingTrial[];
  /** S0 = min(comfort x 10^0.3, maxFitPx), font px. */
  startPx: number;
  /** Largest font px that fits at least 13 characters per line (8 on the large-print path). */
  maxFitPx: number;
  /** Ladder time so far; defaults to the sum of trial response times. */
  elapsedMs?: number;
  /** Simple response time from the pointing module, ms (default 600, clamped 300-1200). */
  t0Ms?: number;
}

type WalkStatus = 'on' | 'off' | 'fail' | 'invalid';
type WalkPhase = 'coarse' | 'up' | 'mid' | 'below' | 'done';

/**
 * Next reading-ladder size, or null to stop (cal-vision.md 3, V2: coarse -0.2 log
 * steps while on plateau, then fine 0.1 steps to bracket; stop after 12 trials,
 * a "can't read" below plateau, the 4 px x-height floor, or 40 s).
 *
 * The walk is replayed from the trial list, so the function is stateless.
 * A disturbed or skimmed sentence is shown again at the same size.
 */
export function nextReadingSize(state: LadderState): number | null {
  const maxFit = Math.max(1, state.maxFitPx);
  const start = Math.min(Math.max(1, state.startPx), maxFit);
  const t0 = clampT0(state.t0Ms);
  const { trials } = state;
  if (trials.length === 0) return round(start);

  const scored = trials.slice(1);
  const elapsed =
    state.elapsedMs ?? trials.reduce((acc, t) => acc + Math.max(0, t.rtMs), 0);
  if (scored.length >= READING_MAX_TRIALS || elapsed >= READING_MAX_MS)
    return null;
  if (scored.length === 0) return round(start);

  const lastTrial = trials[trials.length - 1];
  const ratio =
    lastTrial && lastTrial.xHeightPx > 0 && lastTrial.fontPx > 0
      ? lastTrial.xHeightPx / lastTrial.fontPx
      : FALLBACK_XHEIGHT_RATIO;
  const kOf = (px: number) =>
    Math.round(Math.log10(start / Math.max(px, 0.01)) / READING_STEP_LOG);
  const sizeOf = (k: number) => start * 10 ** (-READING_STEP_LOG * k);
  const fits = (k: number) =>
    sizeOf(k) * ratio >= READING_MIN_XHEIGHT_PX - 1e-9;

  let phase: WalkPhase = 'coarse';
  let yMax = Number.NEGATIVE_INFINITY;
  let seenValid = false;
  let lastOnK = 0;
  let lastK = 0;
  let offK = 0;
  let offMild = false;
  let lastStatus: WalkStatus = 'invalid';

  for (const t of scored) {
    const k = kOf(t.fontPx);
    let status: WalkStatus;
    let y: number | null = null;
    if (t.disturbed) status = 'invalid';
    else if (t.response === 'cant' || !t.correct) status = 'fail';
    else {
      y = readingSpeed(t, t0);
      if (y === null) status = 'invalid';
      else {
        yMax = Math.max(yMax, y);
        status = y >= yMax - WALK_PLATEAU_LOG ? 'on' : 'off';
      }
    }
    lastStatus = status;
    lastK = k;
    if (status === 'invalid') continue;
    const firstValid = !seenValid;
    seenValid = true;

    switch (phase) {
      case 'coarse':
        if (firstValid && status === 'fail') phase = 'up';
        else if (status === 'on') lastOnK = k;
        else {
          offK = k;
          offMild =
            status === 'off' && y !== null && y >= yMax + Math.log10(0.5);
          // The skipped fine step only exists when the coarse step was 0.2 log.
          phase = offK - lastOnK >= 2 ? 'mid' : offMild ? 'below' : 'done';
        }
        break;
      case 'up':
        if (status !== 'fail') phase = 'done';
        break;
      case 'mid':
        phase = status === 'on' && offMild ? 'below' : 'done';
        break;
      case 'below':
      case 'done':
        phase = 'done';
        break;
    }
  }

  if (lastStatus === 'invalid') return round(sizeOf(lastK));

  switch (phase) {
    case 'done':
      return null;
    case 'up': {
      const next = sizeOf(lastK - 1);
      return next <= maxFit * (1 + 1e-9) ? round(next) : null;
    }
    case 'coarse': {
      if (fits(lastOnK + 2)) return round(sizeOf(lastOnK + 2));
      if (fits(lastOnK + 1)) return round(sizeOf(lastOnK + 1));
      return null;
    }
    case 'mid':
      return round(sizeOf(offK - 1));
    case 'below':
      return fits(offK + 1) ? round(sizeOf(offK + 1)) : null;
  }
}

/* ------------------------------------------------------------------------ */
/* V3: contrast staircase                                                     */
/* ------------------------------------------------------------------------ */

/** Fixed-slope log-Weibull for 4AFC word identification (cal-vision.md 3, V3). */
const PSI_GAMMA = 0.25;
const PSI_LAMBDA = 0.02;
const PSI_BETA = 3.5;
const ALPHA_MIN = -3;
const ALPHA_MAX = 0;
const ALPHA_STEP = 0.01;
const STIMULUS_TOP = 0.9;
const STIMULUS_BOTTOM = 0.009;
const STIMULUS_STEP_LOG = 0.05;
const FIRST_STIMULUS = 0.5;
const MAX_SCORED_CONTRAST = 8;
const STOP_SD = 0.12;
const CEILING_WEBER = 0.02;
const CEILING_CORRECT = 3;

function srgbToLinear(level: number): number {
  const v = clamp(level, 0, 255) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Weber contrast of grey `level` (0-255) text on white, (Lbg - Lt) / Lbg. */
export function greyLevelWeber(level: number): number {
  return 1 - srgbToLinear(Math.round(level));
}

/** The grey level (0-254) whose Weber contrast on white is closest in log terms. */
function nearestGreyLevel(weber: number): number {
  const target = Math.log10(clamp(weber, greyLevelWeber(254), 1));
  let best = 0;
  let bestErr = Number.POSITIVE_INFINITY;
  for (let g = 0; g <= 254; g++) {
    const err = Math.abs(Math.log10(greyLevelWeber(g)) - target);
    if (err < bestErr) {
      bestErr = err;
      best = g;
    }
  }
  return best;
}

/** Hex colour (on #FFFFFF) whose sRGB grey gives the closest Weber contrast. */
export function weberToGrey(weber: number): string {
  const hex = nearestGreyLevel(weber)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `#${hex}${hex}${hex}`;
}

/** The Weber contrast actually displayed for a requested value after sRGB quantization. */
export function quantizeWeber(weber: number): number {
  return greyLevelWeber(nearestGreyLevel(weber));
}

/** Stimulus grid: 0.05 log steps from 0.9 to 0.009, quantized to grey levels, deduplicated. */
const STIMULI: readonly number[] = (() => {
  const levels = new Set<number>();
  const steps = Math.round(
    Math.log10(STIMULUS_TOP / STIMULUS_BOTTOM) / STIMULUS_STEP_LOG,
  );
  for (let k = 0; k <= steps; k++) {
    levels.add(nearestGreyLevel(STIMULUS_TOP * 10 ** (-STIMULUS_STEP_LOG * k)));
  }
  return [...levels].map(greyLevelWeber).sort((a, b) => b - a);
})();

const ALPHAS: readonly number[] = Array.from(
  { length: Math.round((ALPHA_MAX - ALPHA_MIN) / ALPHA_STEP) + 1 },
  (_v, i) => round(ALPHA_MIN + i * ALPHA_STEP, 4),
);

function psi(xLog: number, alpha: number): number {
  const p =
    PSI_GAMMA +
    (1 - PSI_GAMMA - PSI_LAMBDA) *
      (1 - Math.exp(-(10 ** (PSI_BETA * (xLog - alpha)))));
  return clamp(p, PSI_GAMMA, 1 - PSI_LAMBDA);
}

function entropy(p: Float64Array): number {
  let h = 0;
  for (const v of p) if (v > 0) h -= v * Math.log(v);
  return h;
}

interface Posterior {
  p: Float64Array;
  observe(weber: number, correct: boolean): void;
  moments(): { mean: number; sd: number };
}

function createPosterior(largePrint: boolean): Posterior {
  const mu = largePrint ? -1.1 : -1.4;
  const sigma = largePrint ? 0.6 : 0.5;
  const p = new Float64Array(ALPHAS.length);
  ALPHAS.forEach((a, i) => {
    p[i] = Math.exp(-0.5 * ((a - mu) / sigma) ** 2);
  });
  normalize(p);
  return {
    p,
    observe(weber, correct) {
      const x = Math.log10(clamp(weber, 1e-4, 1));
      for (let i = 0; i < p.length; i++) {
        const q = psi(x, ALPHAS[i] ?? 0);
        p[i] = (p[i] ?? 0) * (correct ? q : 1 - q);
      }
      normalize(p);
    },
    moments() {
      let m = 0;
      for (let i = 0; i < p.length; i++) m += (p[i] ?? 0) * (ALPHAS[i] ?? 0);
      let v = 0;
      for (let i = 0; i < p.length; i++)
        v += (p[i] ?? 0) * ((ALPHAS[i] ?? 0) - m) ** 2;
      return { mean: m, sd: Math.sqrt(Math.max(v, 0)) };
    },
  };
}

function normalize(p: Float64Array): void {
  let s = 0;
  for (const v of p) s += v;
  if (!(s > 0) || !Number.isFinite(s)) {
    p.fill(1 / p.length);
    return;
  }
  for (let i = 0; i < p.length; i++) p[i] = (p[i] ?? 0) / s;
}

/** QUEST+ placement: the stimulus with the lowest expected posterior entropy. */
function bestStimulus(prior: Float64Array): number {
  let best = STIMULI[0] ?? FIRST_STIMULUS;
  let bestH = Number.POSITIVE_INFINITY;
  const post = new Float64Array(prior.length);
  for (const w of STIMULI) {
    const x = Math.log10(w);
    let pc = 0;
    for (let i = 0; i < prior.length; i++)
      pc += (prior[i] ?? 0) * psi(x, ALPHAS[i] ?? 0);
    let h = 0;
    for (const correct of [true, false]) {
      const pr = correct ? pc : 1 - pc;
      if (pr <= 0) continue;
      for (let i = 0; i < prior.length; i++) {
        const q = psi(x, ALPHAS[i] ?? 0);
        post[i] = ((prior[i] ?? 0) * (correct ? q : 1 - q)) / pr;
      }
      h += pr * entropy(post);
    }
    if (h < bestH - 1e-12) {
      bestH = h;
      best = w;
    }
  }
  return best;
}

/** QUEST+-style contrast staircase with fixed slope (cal-vision.md 3, V3). */
export interface ContrastStaircase {
  /** Weber contrast (0..1) for the next word, already quantized to an sRGB grey. */
  next(): number;
  /** Record the answer to the word from the last `next()` ("can't see" counts as incorrect). */
  update(correct: boolean): void;
  done(): boolean;
  estimate(): {
    alphaLog: number;
    sd: number;
    ceiling: boolean;
    trials: number;
  };
}

/**
 * Trial 1 is an easy orientation word at Weber 0.5; it informs the posterior
 * but does not count toward the 8 scored trials. Prior on the log10 Weber
 * threshold: N(-1.4, 0.5), or N(-1.1, 0.6) on the large-print path.
 */
export function createContrastStaircase(opts: {
  largePrint: boolean;
}): ContrastStaircase {
  const posterior = createPosterior(opts.largePrint);
  let pending: number | null = null;
  let trials = 0;
  let ceilingHits = 0;

  const next = (): number => {
    if (pending === null) {
      pending =
        trials === 0
          ? quantizeWeber(FIRST_STIMULUS)
          : bestStimulus(posterior.p);
    }
    return pending;
  };

  return {
    next,
    update(correct) {
      const w = pending ?? next();
      posterior.observe(w, correct);
      if (correct && w <= CEILING_WEBER + 1e-9) ceilingHits++;
      trials++;
      pending = null;
    },
    done() {
      if (ceilingHits >= CEILING_CORRECT) return true;
      if (trials - 1 >= MAX_SCORED_CONTRAST) return true;
      return trials >= 2 && posterior.moments().sd < STOP_SD;
    },
    estimate() {
      const { mean: m, sd } = posterior.moments();
      return {
        alphaLog: round(clamp(m, ALPHA_MIN, ALPHA_MAX), 3),
        sd: round(clamp(sd, 0, 2), 3),
        ceiling: ceilingHits >= CEILING_CORRECT,
        trials,
      };
    },
  };
}

/** Replays recorded contrast trials through the same posterior (the summary path). */
function contrastEstimate(
  trials: readonly ContrastTrial[],
  largePrint: boolean,
): VisionSummary['contrast'] {
  const valid = trials.filter((t) => Number.isFinite(t.weber) && t.weber > 0);
  if (valid.length === 0) return null;
  const posterior = createPosterior(largePrint);
  let ceilingHits = 0;
  let cantSeeHigh = 0;
  for (const t of valid) {
    const correct = t.correct && !t.cantSee;
    posterior.observe(t.weber, correct);
    if (correct && t.weber <= CEILING_WEBER + 1e-9) ceilingHits++;
    if (t.cantSee && t.weber >= 0.3) cantSeeHigh++;
  }
  const { mean: m, sd } = posterior.moments();
  return {
    alphaLog: round(clamp(m, ALPHA_MIN, ALPHA_MAX), 3),
    sd: round(clamp(sd, 0, 2), 3),
    ceiling: ceilingHits >= CEILING_CORRECT,
    trials: Math.min(20, valid.length),
    cantSeeHigh: Math.min(20, cantSeeHigh),
  };
}

/* ------------------------------------------------------------------------ */
/* Summary: MRS, CPS, confidence inputs                                       */
/* ------------------------------------------------------------------------ */

interface LadderPoint {
  x: number;
  fontPx: number;
  y: number | null;
  failed: boolean;
}

interface SizeGroup {
  x: number;
  fontPx: number;
  ys: number[];
  failed: boolean;
}

export interface LadderAnalysis {
  /** log10 words per minute on the plateau, null without valid speeds. */
  yMrs: number | null;
  plateauPoints: number;
  residualSd: number;
  /** log10 x-height (CSS px) of the critical print size. */
  xCps: number | null;
  bracket: VisionSummary['bracket'];
  accuracy: number;
  /** Largest font px shown (the display-limited fallback). */
  maxShownPx: number | null;
}

/**
 * Robust MRS (cal-vision.md 4.1 step 1): start from the median of the three
 * fastest sentences, then iterate "median of speeds within 0.15 log of the
 * estimate" to convergence.
 */
function plateauSpeed(
  ys: readonly number[],
): { yMrs: number; set: number[] } | null {
  if (ys.length === 0) return null;
  const sorted = [...ys].sort((a, b) => b - a);
  let m = sorted.length >= 3 ? middle(sorted.slice(0, 3)) : (sorted[0] ?? 0);
  let set: number[] = [];
  for (let pass = 0; pass < 8; pass++) {
    const nextSet = ys.filter((y) => y >= m - MRS_BAND_LOG);
    const nextM = middle(nextSet);
    const stable = nextSet.length === set.length && Math.abs(nextM - m) < 1e-9;
    set = nextSet;
    m = nextM;
    if (stable) break;
  }
  return { yMrs: m, set };
}

/**
 * MAP two-limb fit y = yMRS - s * max(0, xc - x) with priors
 * ln s ~ N(ln 1.5, 0.5) and xc ~ N(x_comfort, 0.35), by grid search
 * (deterministic, no convergence issues on sparse ladders).
 */
function twoLimbCps(
  points: ReadonlyArray<{ x: number; y: number }>,
  yMrs: number,
  residualSd: number,
  xComfort: number | null,
): number | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.x);
  const lo = Math.min(...xs) - 0.3;
  const hi = Math.max(...xs) + 0.1;
  const slopes: number[] = [];
  for (let i = 0; i <= 80; i++)
    slopes.push(Math.exp(Math.log(0.3) + (i / 80) * Math.log(8 / 0.3)));
  let best: { xc: number; s: number } | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  const v = 2 * residualSd ** 2;
  for (let xc = lo; xc <= hi + 1e-9; xc += 0.0025) {
    const kneeCost =
      xComfort === null ? 0 : ((xc - xComfort) / KNEE_PRIOR_SD) ** 2 / 2;
    for (const s of slopes) {
      let cost =
        kneeCost +
        ((Math.log(s) - Math.log(SLOPE_PRIOR)) / SLOPE_PRIOR_LOG_SD) ** 2 / 2;
      for (const p of points) {
        const pred = yMrs - s * Math.max(0, xc - p.x);
        cost += (p.y - pred) ** 2 / v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = { xc, s };
      }
    }
  }
  if (!best) return null;
  return best.xc - Math.log10(1 / 0.8) / best.s;
}

/** Scores the V2 ladder (cal-vision.md 4.1). */
export function analyzeLadder(
  ladder: readonly ReadingTrial[],
  opts: {
    referenceXHeightRatio: number;
    comfortPx: number | null;
    t0Ms?: number;
  },
): LadderAnalysis {
  const ratio = clamp(opts.referenceXHeightRatio, 0.3, 0.7);
  const t0 = clampT0(opts.t0Ms);
  const scored = ladder.slice(1).filter((t) => !t.disturbed);
  const points: LadderPoint[] = scored.map((t) => ({
    x: Math.log10(xHeightOf(t, ratio)),
    fontPx: t.fontPx,
    y: readingSpeed(t, t0),
    failed: t.response === 'cant' || !t.correct,
  }));
  const accuracy =
    scored.length === 0
      ? 0
      : scored.filter((t) => t.correct && t.response !== 'cant').length /
        scored.length;
  const maxShownPx =
    scored.length === 0 ? null : Math.max(...scored.map((t) => t.fontPx));

  const speeds = points.flatMap((p) => (p.y === null ? [] : [p.y]));
  const plateau = plateauSpeed(speeds);
  const empty: LadderAnalysis = {
    yMrs: null,
    plateauPoints: 0,
    residualSd: RESIDUAL_SD_DEFAULT,
    xCps: null,
    bracket: 'none',
    accuracy,
    maxShownPx,
  };
  if (!plateau) return empty;
  const { yMrs, set } = plateau;
  const residualSd =
    set.length >= 2
      ? clamp(
          Math.sqrt(
            set.reduce((a, y) => a + (y - yMrs) ** 2, 0) / (set.length - 1),
          ),
          RESIDUAL_SD_MIN,
          RESIDUAL_SD_MAX,
        )
      : RESIDUAL_SD_DEFAULT;

  // One entry per size (sizes repeat after retests and fine steps).
  const groups = new Map<number, SizeGroup>();
  for (const p of points) {
    if (p.y === null && !p.failed) continue; // skim: carries no information
    const key = Math.round(p.x * 100);
    const g = groups.get(key) ?? {
      x: p.x,
      fontPx: p.fontPx,
      ys: [],
      failed: false,
    };
    if (p.y !== null) g.ys.push(p.y);
    else g.failed = true;
    groups.set(key, g);
  }
  const sizes = [...groups.values()];
  const onPlateau = (g: SizeGroup) =>
    g.ys.some((y) => y >= yMrs - CPS_PLATEAU_LOG);
  const on = sizes.filter(onPlateau);
  if (on.length === 0)
    return { ...empty, yMrs, plateauPoints: set.length, residualSd };

  const xp = Math.min(...on.map((g) => g.x));
  const below = sizes.filter((g) => g.x < xp - 1e-9);
  const xo =
    below.length > 0 ? below.reduce((a, g) => (g.x > a.x ? g : a)) : null;

  let bracket: VisionSummary['bracket'] = 'none';
  if (xo) {
    const gap = xp - xo.x;
    if (gap <= READING_STEP_LOG + BRACKET_TOLERANCE) bracket = '0.1';
    else if (gap <= 2 * READING_STEP_LOG + BRACKET_TOLERANCE) bracket = '0.2';
  }

  let xCps = xp;
  if (xo && xo.ys.length > 0) {
    const yo = mean(xo.ys);
    const pGroup = on.find((g) => g.x === xp);
    const yp = pGroup ? Math.max(...pGroup.ys) : yMrs;
    const valid = points.flatMap((p) =>
      p.y === null ? [] : [{ x: p.x, y: p.y }],
    );
    const xComfort =
      opts.comfortPx !== null && opts.comfortPx > 0
        ? Math.log10(opts.comfortPx * ratio)
        : null;
    const fitted = twoLimbCps(valid, yMrs, residualSd, xComfort);
    if (fitted !== null && Number.isFinite(fitted)) {
      xCps = fitted;
    } else if (yp > yo) {
      xCps = xo.x + ((yMrs - CPS_PLATEAU_LOG - yo) * (xp - xo.x)) / (yp - yo);
    }
    xCps = clamp(xCps, xo.x, xp);
  }

  return {
    yMrs,
    plateauPoints: set.length,
    residualSd,
    xCps,
    bracket,
    accuracy,
    maxShownPx,
  };
}

function polaritySummary(
  trials: readonly PolarityTrial[],
  stated: ReadingSession['statedPolarity'],
  residualSd: number,
  t0Ms: number,
): VisionSummary['polarity'] {
  const ys = (p: 'light' | 'dark') =>
    trials
      .filter((t) => t.polarity === p)
      .flatMap((t) => {
        const y = readingSpeed(t, t0Ms);
        return y === null ? [] : [y];
      });
  const dark = ys('dark');
  const light = ys('light');
  if (dark.length === 0 || light.length === 0) {
    return trials.length === 0 && stated === null
      ? null
      : { deltaLog: 0, se: POLARITY_NO_DATA_SE, stated };
  }
  const se = residualSd * Math.sqrt(1 / dark.length + 1 / light.length);
  return {
    deltaLog: round(clamp(mean(dark) - mean(light), -2, 2), 3),
    se: round(clamp(se, 0, 2), 3),
    stated,
  };
}

export interface ReadingSummaryOptions {
  /** The browser's default font size (1rem in CSS px). Default 16. */
  rootFontPx?: number;
  /** Simple response time from the pointing module, ms. Default 600. */
  t0Ms?: number;
}

/** Whether V1's comfortable size puts the person on the large-print path (>= 2x default). */
export function isLargePrint(
  comfortPx: number | null,
  rootFontPx = 16,
): boolean {
  return comfortPx !== null && comfortPx >= 2 * rootFontPx;
}

/** Reduce a reading session to its persisted summary (cal-vision.md 4). */
export function summarizeReading(
  session: ReadingSession,
  options: ReadingSummaryOptions = {},
): VisionSummary {
  const root = clamp(options.rootFontPx ?? 16, 8, 64);
  const t0 = clampT0(options.t0Ms);
  const ratio = Number.isFinite(session.referenceXHeightRatio)
    ? clamp(session.referenceXHeightRatio, 0.3, 0.7)
    : FALLBACK_XHEIGHT_RATIO;
  const comfortPx =
    session.comfortPx !== null && Number.isFinite(session.comfortPx)
      ? clamp(session.comfortPx, 8, 200)
      : null;

  const ladder = analyzeLadder(session.ladder, {
    referenceXHeightRatio: ratio,
    comfortPx,
    t0Ms: t0,
  });
  const noPlateau = ladder.xCps === null;
  const displayLimited =
    session.displayLimited || (noPlateau && ladder.maxShownPx !== null);

  let criticalPx: number | null = null;
  if (ladder.xCps !== null) criticalPx = 10 ** ladder.xCps / ratio;
  else if (displayLimited && ladder.maxShownPx !== null)
    criticalPx = ladder.maxShownPx;

  const largePrint =
    isLargePrint(comfortPx, root) ||
    (criticalPx !== null && criticalPx * 10 ** READING_STEP_LOG >= 2 * root);
  const contrast = contrastEstimate(
    session.contrast,
    isLargePrint(comfortPx, root),
  );
  const polarity = polaritySummary(
    session.polarity,
    session.statedPolarity,
    ladder.residualSd,
    t0,
  );

  const hasLadder = session.ladder.length > 1;
  const measured =
    hasLadder ||
    contrast !== null ||
    (polarity !== null && session.polarity.length > 0);

  const overrides: VisionSummary['overrides'] = {};
  if (
    session.overrides.textPx !== undefined &&
    Number.isFinite(session.overrides.textPx)
  ) {
    overrides.textPx = round(clamp(session.overrides.textPx, 8, 200), 1);
  }
  if (session.overrides.polarity !== undefined)
    overrides.polarity = session.overrides.polarity;
  if (session.overrides.moreSpacing !== undefined)
    overrides.moreSpacing = session.overrides.moreSpacing;

  return {
    status: measured ? 'measured' : 'skipped',
    disturbed: session.ladder.some((t) => t.disturbed),
    comfortPx: comfortPx === null ? null : round(comfortPx, 1),
    criticalPx:
      criticalPx === null ? null : round(clamp(criticalPx, 4, 200), 2),
    bracket: displayLimited && noPlateau ? 'none' : ladder.bracket,
    plateauPoints: Math.min(20, ladder.plateauPoints),
    accuracy: round(clamp(ladder.accuracy, 0, 1), 3),
    largePrint,
    displayLimited,
    contrast,
    polarity,
    overrides,
    referenceXHeightRatio: round(ratio, 4),
    durationSec: round(clamp(session.durationSec, 0, 3600), 1),
  };
}

/**
 * Size confidence (cal-vision.md 4.1): min(0.9, q_n * q_b * q_v * q_c).
 * `summary.disturbed` applies the 0.7 factor for zoom or visibility events.
 */
export function readingSizeConfidence(
  summary: VisionSummary,
  disturbed = summary.disturbed ?? false,
): number {
  if (summary.criticalPx === null) return 0;
  const qn = Math.min(1, summary.plateauPoints / 3);
  const qb = summary.displayLimited
    ? 0.5
    : summary.bracket === '0.1'
      ? 1
      : summary.bracket === '0.2'
        ? 0.8
        : 0.5;
  const qv =
    clamp((summary.accuracy - 0.5) / 0.4, 0, 1) * (disturbed ? 0.7 : 1);
  let qc = 0.85;
  if (summary.comfortPx !== null) {
    const gap = Math.abs(Math.log10(summary.comfortPx / summary.criticalPx));
    qc = gap <= 0.2 ? 1 : gap <= 0.35 ? 0.85 : 0.7;
  }
  return round(clamp(Math.min(0.9, qn * qb * qv * qc), 0, 1), 3);
}
