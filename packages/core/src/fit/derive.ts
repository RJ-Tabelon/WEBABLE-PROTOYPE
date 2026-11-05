// Owner: A2 (round 4: W, the 70-second warm-up).
// The warm-up's raw trials → the person's fit. Every threshold is computed here, in code (fitting brief round 4 §3);
// Jev never estimates psychometric quantities. Deterministic: the same raw input gives the same fit.
//
// It measures what the person can do on a page, never a condition: the text size they read fastest from, how faint
// grey text may get, how big click areas need to be, and whether busy or moving pages slow them down.
import type {
  BrowserSettings, ContrastBand, DimensionBelief, FitDimension, FitProfile, FitSummaryForModel, FittingRaw, InputClass,
  Polarity, StructureLevel,
} from '../types';
import { jeffreysAtLeast, mulberry32 } from './stats';

/* ------------------------------------------------------------------ */
/* Small numeric helpers                                               */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const half = (v: number): number => Math.round(v * 2) / 2;
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/* ------------------------------------------------------------------ */
/* Warm-up records kept in the saved fit (calibration)                 */
/* ------------------------------------------------------------------ */

/** Where a value in the fit came from. Same words as `DimensionBelief.source`, minus 'learned'. */
export type FitSource = Exclude<DimensionBelief['source'], 'learned'>;

export type WarmupBlock = 'read' | 'faint' | 'point' | 'find' | 'pick' | 'confirm';

/** One warm-up block, as it ran (fitting brief round 4 §6: active time, actions, trials at stop, skips). */
export interface WarmupBlockMetrics {
  block: WarmupBlock;
  /** done: ran to its stop rule. skipped: the person skipped it. prefilled: browser settings answered it. not_run: planned out. */
  status: 'done' | 'skipped' | 'prefilled' | 'not_run';
  /** Active time in the block (pauses and hidden-tab time excluded). */
  activeMs: number;
  /** Presses and key presses while the block was on screen. */
  actions: number;
  /** Scored trials (sentences, faint words, scored dot presses, searches, picks) at the stop. */
  trials: number;
  /** Which stop rule ended it: 'sd', 'max_trials', 'time', 'reversal', 'max_presses', 'ladder_end', 'ceiling', 'person'. */
  stop?: string;
}

/** The numbers we can quote about one warm-up session. Kept on the laptop, inside the saved fit. */
export interface WarmupMetrics {
  v: 'warmup.1';
  /** Active time from Start to "Use this fit", pauses excluded. */
  activeMs: number;
  actions: number;
  completed: boolean;
  blocks: WarmupBlockMetrics[];
  /** What the person changed on the last screen (corrections over the measurement). */
  corrections: { textSteps: number; colours: boolean; rows: string[] };
  /** Which browser settings shaped the plan, in plain words ('Default font 20 px', 'Reduce motion'). */
  settingsUsed: string[];
}

/** The saved fit's `calibration`, as the warm-up writes it (a superset of the contract's shape). */
export interface WarmupCalibration {
  version: string;
  durationSec: number;
  skipped: string[];
  sources?: Partial<Record<FitDimension, FitSource>>;
  warmup?: WarmupMetrics;
}

/* ------------------------------------------------------------------ */
/* Defaults and demo fits                                              */
/* ------------------------------------------------------------------ */

const FIT_VERSION = 'fit-1';
const WARMUP_VERSION = 'warmup-1';
const DEMO_DATE = '2026-10-23T09:00:00.000Z';

export function defaultFit(): FitProfile {
  return {
    v: 'fit.1',
    createdAt: new Date().toISOString(),
    inputClass: 'mouse',
    text: { bodyPx: 16, cpsPx: null, largePrint: false, conf: 0, source: 'default', override: null },
    contrast: { band: 'N', floor: 4.5 },
    polarity: { value: 'none', stated: null },
    weight: { floor: 400 },
    spacing: { lineHeight: 1.5, wordEm: 0, letterEm: 0 },
    measure: { targetCpl: 66, maxCpl: 75, minCpl: 13 },
    targets: { minPx: null, conf: 0 },
    clicks: { steady: { on: false, windowMs: 300, radiusPx: 10 }, debounce: false },
    attention: { motion: { p: 0.3, on: false }, clutter: { p: 0.25 }, structureLevel: 0 },
    // Population priors until the person's own baselines exist (live signals compare with these).
    baselines: { searchSecMedian: null, slipRate: 0.02, repeatRate: 0.01, missRate: 0.04 },
    calibration: { version: 'default', durationSec: 0, skipped: [] },
    layout: { column: 'auto' },
  };
}

function demoRosa(): FitProfile {
  const f = defaultFit();
  return {
    ...f,
    createdAt: DEMO_DATE,
    inputClass: 'mouse',
    text: { bodyPx: 22, cpsPx: 17.5, largePrint: false, conf: 0.74, source: 'measured', override: null },
    contrast: { band: 'M', floor: 7 },
    polarity: { value: 'none', stated: 'none' },
    weight: { floor: 500 },
    spacing: { lineHeight: 1.6, wordEm: 0, letterEm: 0 },
    measure: { targetCpl: 66, maxCpl: 75, minCpl: 13 },
    targets: { minPx: 56, conf: 0.62 },
    clicks: { steady: { on: true, windowMs: 320, radiusPx: 11 }, debounce: false },
    attention: { motion: { p: 0.78, on: true }, clutter: { p: 0.86 }, structureLevel: 2 },
    baselines: { searchSecMedian: 4.8, slipRate: 0.09, repeatRate: 0.04, missRate: 0.12 },
    calibration: { version: 'demo-rosa', durationSec: 124, skipped: [] },
  };
}

function demoTypical(): FitProfile {
  return { ...defaultFit(), createdAt: DEMO_DATE, calibration: { version: 'demo-typical', durationSec: 0, skipped: [] } };
}

function demoReader(): FitProfile {
  const f = defaultFit();
  return {
    ...f,
    createdAt: DEMO_DATE,
    inputClass: 'trackpad',
    text: { bodyPx: 24, cpsPx: 15.2, largePrint: false, conf: 0.7, source: 'measured', override: null },
    contrast: { band: 'S', floor: 15 },
    polarity: { value: 'none', stated: null },
    weight: { floor: 600 },
    // Word and letter spacing stay at the site's own (0 added) unless a future explicit setting asks for them.
    spacing: { lineHeight: 1.8, wordEm: 0, letterEm: 0 },
    measure: { targetCpl: 66, maxCpl: 75, minCpl: 13 },
    targets: { minPx: 44, conf: 0.55 },
    clicks: { steady: { on: false, windowMs: 300, radiusPx: 9 }, debounce: false },
    attention: { motion: { p: 0.31, on: false }, clutter: { p: 0.64 }, structureLevel: 1 },
    baselines: { searchSecMedian: 3.1, slipRate: 0.02, repeatRate: 0.01, missRate: 0.04 },
    calibration: { version: 'demo-reader', durationSec: 118, skipped: [] },
  };
}

/**
 * Three ready-made fits for the demo and the eval harness.
 * rosa: 22 px text, 56 px click areas, Steady Clicks, contrast band M, Calm view on busy pages, motion paused.
 * typical: defaults (nothing changes). reader: 24 px text, contrast band S, polarity left to the site, 44 px, structure 1.
 */
export const DEMO_FITS: { rosa: FitProfile; typical: FitProfile; reader: FitProfile } = {
  rosa: demoRosa(),
  typical: demoTypical(),
  reader: demoReader(),
};

/* ------------------------------------------------------------------ */
/* Browser settings → priors (fitting brief round 4 §1, layer 1)       */
/* ------------------------------------------------------------------ */

/**
 * The comfortable text size the person's own Chrome settings point to (CSS px at 100%): default font × default zoom,
 * or null when neither was changed from Chrome's 16 px at 100% (an untouched setting says nothing about need).
 */
export function textPriorPx(settings: BrowserSettings | null | undefined): number | null {
  if (!settings) return null;
  const font = settings.defaultFontPx != null && settings.defaultFontPx > 0 ? settings.defaultFontPx : 16;
  const zoom = settings.defaultZoom != null && settings.defaultZoom > 0 ? settings.defaultZoom : 1;
  const changed = Math.abs(font - 16) >= 0.5 || Math.abs(zoom - 1) >= 0.01;
  return changed ? r1(font * zoom) : null;
}

/* ------------------------------------------------------------------ */
/* Part R: Read — a grid posterior over the knee c and top speed M     */
/* ------------------------------------------------------------------ */
//
// Model (log10 units): reading speed y = M − 2.5·max(0, c − x) at text size x, with SD 0.10 per sentence. c is the
// critical print size: below it, speed falls. Each answer updates the posterior; the next size is the one whose
// predicted speed is least certain, never below c − 0.3 (no "Can't read" streaks). Stop at ≥ 4 scored and
// SD(c) < 0.08, or 8 scored, or 30 s. Body text = 10^(c + 0.06), at least 16 px.

/** One Read trial as the warm-up records it. `cant` marks "Can't read it" (the contract's `correct` is false then). */
export interface ReadTrial {
  px: number; // effective px at 100% zoom
  ms: number; // response time scaled to a 56-character sentence
  correct: boolean;
  cant?: boolean;
}

export const READ_RULES = {
  slope: 2.5,
  sd: 0.1,
  /** A small share of trials are lapses (a glance away): they must not drag the knee. */
  lapse: 0.05,
  priorSd: 0.35,
  marginLog: 0.06,
  minScored: 4,
  stopSd: 0.08,
  maxScored: 8,
  maxActiveMs: 30_000,
  /** Candidate sizes are 0.05 log apart (one Chrome zoom step is about 0.1). */
  candStep: 0.05,
  /** Never probe further below the current knee estimate than this. */
  belowKnee: 0.3,
} as const;

const SENTENCE_CHARS = 56;
const T0_SEC = 0.6;

/** log10 wpm for one sentence time (56-character standard), or null when it cannot be a reading speed. */
export function readSpeed(ms: number): number | null {
  const reading = ms / 1000 - T0_SEC;
  if (!Number.isFinite(reading) || reading <= 0) return null;
  const wpm = (60 * (SENTENCE_CHARS / 6)) / reading;
  if (wpm > 900) return null; // faster than anyone reads: an accidental press
  return Math.log10(wpm);
}

const C_GRID: number[] = Array.from({ length: 125 }, (_, i) => Math.round((0.9 + 0.01 * i) * 1000) / 1000);
const M_GRID: number[] = Array.from({ length: 65 }, (_, j) => Math.round((1.6 + 0.02 * j) * 1000) / 1000);
const M_PRIOR = Math.log10(240);
const M_PRIOR_SD = 0.25;
const LAPSE_DENSITY = 0.5; // uniform over two log10 units of speed
const NORM = 1 / (READ_RULES.sd * Math.sqrt(2 * Math.PI));

export class ReadPosterior {
  /** log posterior, index i * M_GRID.length + j. */
  private readonly logp: Float64Array;
  private w: Float64Array | null = null;
  private scored = 0;

  /** `priorPx`: the comfortable size the person's settings point to (null: no prior on the knee). */
  constructor(priorPx: number | null = null) {
    const nC = C_GRID.length;
    const nM = M_GRID.length;
    this.logp = new Float64Array(nC * nM);
    const cPrior = priorPx != null && priorPx > 0 ? Math.log10(priorPx) - READ_RULES.marginLog : null;
    for (let i = 0; i < nC; i++) {
      const c = C_GRID[i] as number;
      const pc = cPrior == null ? 0 : -0.5 * ((c - cPrior) / READ_RULES.priorSd) ** 2;
      for (let j = 0; j < nM; j++) {
        const m = M_GRID[j] as number;
        this.logp[i * nM + j] = pc - 0.5 * ((m - M_PRIOR) / M_PRIOR_SD) ** 2;
      }
    }
  }

  get n(): number {
    return this.scored;
  }

  /** Add one scored trial. */
  add(t: ReadTrial): void {
    if (!(t.px > 0) || !Number.isFinite(t.px)) return;
    const x = Math.log10(t.px);
    const nM = M_GRID.length;
    const y = t.correct && !t.cant ? readSpeed(t.ms) : null;
    for (let i = 0; i < C_GRID.length; i++) {
      const c = C_GRID[i] as number;
      const below = Math.max(0, c - x);
      if (t.cant) {
        // Can't read it: most likely below acuity, about 0.25 log under the knee (soft).
        const l = Math.log(sigmoid((c - 0.25 - x) / 0.05) + 1e-6);
        for (let j = 0; j < nM; j++) this.logp[i * nM + j] = (this.logp[i * nM + j] as number) + l;
      } else if (!t.correct) {
        // A wrong answer is weak evidence that the size is near or under the knee.
        const l = Math.log(0.5 + 0.5 * sigmoid((c - x) / 0.1) + 1e-9);
        for (let j = 0; j < nM; j++) this.logp[i * nM + j] = (this.logp[i * nM + j] as number) + l;
      } else if (y != null) {
        for (let j = 0; j < nM; j++) {
          const pred = (M_GRID[j] as number) - READ_RULES.slope * below;
          const z = (y - pred) / READ_RULES.sd;
          const dens = (1 - READ_RULES.lapse) * NORM * Math.exp(-0.5 * z * z) + READ_RULES.lapse * LAPSE_DENSITY;
          this.logp[i * nM + j] = (this.logp[i * nM + j] as number) + Math.log(dens);
        }
      }
    }
    this.scored += 1;
    this.w = null;
  }

  private weights(): Float64Array {
    if (this.w) return this.w;
    let mx = -Infinity;
    for (const v of this.logp) if (v > mx) mx = v;
    const w = new Float64Array(this.logp.length);
    let z = 0;
    for (let k = 0; k < w.length; k++) {
      const e = Math.exp((this.logp[k] as number) - mx);
      w[k] = e;
      z += e;
    }
    for (let k = 0; k < w.length; k++) w[k] = (w[k] as number) / z;
    this.w = w;
    return w;
  }

  private marginalC(): number[] {
    const w = this.weights();
    const nM = M_GRID.length;
    return C_GRID.map((_, i) => {
      let s = 0;
      for (let j = 0; j < nM; j++) s += w[i * nM + j] as number;
      return s;
    });
  }

  /** Posterior mean of the knee c (log10 px). */
  mean(): number {
    const pc = this.marginalC();
    return pc.reduce((a, p, i) => a + p * (C_GRID[i] as number), 0);
  }

  /** Posterior SD of the knee (log10). */
  sd(): number {
    const pc = this.marginalC();
    const m = pc.reduce((a, p, i) => a + p * (C_GRID[i] as number), 0);
    return Math.sqrt(pc.reduce((a, p, i) => a + p * ((C_GRID[i] as number) - m) ** 2, 0));
  }

  /** The next size to show (effective px): the most predictive variance among sizes ≥ c − 0.3 within [minPx, maxPx]. */
  nextPx(minPx: number, maxPx: number): number {
    const lo = Math.log10(Math.max(1, minPx));
    const hi = Math.log10(Math.max(minPx, maxPx));
    const cm = this.mean();
    const cands: number[] = [];
    for (let x = lo; x <= hi + 1e-9; x += READ_RULES.candStep) cands.push(x);
    let ok = cands.filter((x) => x >= cm - READ_RULES.belowKnee);
    if (!ok.length) ok = [hi];
    const w = this.weights();
    const nM = M_GRID.length;
    let best = ok[0] as number;
    let bestV = -Infinity;
    for (const x of ok) {
      let m1 = 0;
      let m2 = 0;
      for (let i = 0; i < C_GRID.length; i++) {
        const below = READ_RULES.slope * Math.max(0, (C_GRID[i] as number) - x);
        for (let j = 0; j < nM; j++) {
          const p = w[i * nM + j] as number;
          if (p < 1e-12) continue;
          const pred = (M_GRID[j] as number) - below;
          m1 += p * pred;
          m2 += p * pred * pred;
        }
      }
      const v = m2 - m1 * m1;
      if (v > bestV + 1e-12) {
        bestV = v;
        best = x;
      }
    }
    return Math.round(10 ** best * 10) / 10;
  }

  /** The brief's stop rule, given the scored trials so far and their active time. */
  shouldStop(activeMs: number): 'sd' | 'max_trials' | 'time' | null {
    if (this.scored >= READ_RULES.minScored && this.sd() < READ_RULES.stopSd) return 'sd';
    if (this.scored >= READ_RULES.maxScored) return 'max_trials';
    if (activeMs >= READ_RULES.maxActiveMs) return 'time';
    return null;
  }
}

/** Comfortable body px from a knee estimate: 10^(c + 0.06), never below the 16 px web default. */
export function bodyPxFromKnee(c: number): number {
  return half(clamp(10 ** (c + READ_RULES.marginLog), 16, 96));
}

interface ReadingResult {
  bodyPx: number;
  cpsPx: number | null;
  conf: number;
  source: 'measured' | 'stated' | 'default';
  largePrint: boolean;
}

function readingSize(raw: NonNullable<FittingRaw['reading']>, priorPx: number | null): ReadingResult {
  const fallback = (): ReadingResult =>
    priorPx != null && priorPx >= 16.5
      ? { bodyPx: half(clamp(priorPx, 16, 96)), cpsPx: null, conf: 0.35, source: 'stated', largePrint: priorPx >= 32 }
      : { bodyPx: 16, cpsPx: null, conf: 0, source: 'default', largePrint: false };

  const trials = (raw.ladder as ReadTrial[]).filter((t) => t.px > 0 && Number.isFinite(t.px));
  // Fewer than 3 answers cannot place a knee: keep what the settings say (or the default).
  if (trials.length < 3) return fallback();
  const post = new ReadPosterior(priorPx);
  for (const t of trials) post.add(t);
  const c = post.mean();
  const s = post.sd();
  const bodyPx = bodyPxFromKnee(c);
  return {
    bodyPx,
    cpsPx: r1(10 ** c),
    conf: r2(clamp(0.9 - (s - 0.05) * 5, 0.2, 0.9)),
    source: 'measured',
    largePrint: bodyPx >= 32,
  };
}

/* ------------------------------------------------------------------ */
/* Part R: Faint — QUEST+ posterior over the faint-text threshold      */
/* ------------------------------------------------------------------ */

/** Band edges on the log Weber threshold: N up to −1.52, M up to −1.05, S above. */
const BAND_EDGES = { NM: -1.52, MS: -1.05 } as const;

/**
 * QUEST+ posterior over the log Weber threshold from every faint-word trial (fixed slope). The band is the strongest
 * one whose posterior is ≥ 0.35: it leans to more contrast, because too little contrast costs more than too much.
 */
function contrastBand(raw: NonNullable<FittingRaw['reading']>, largePrint: boolean): { band: ContrastBand; alpha: number | null } {
  const trials = raw.faint.filter((t) => Number.isFinite(t.contrast));
  if (!trials.length) return { band: 'N', alpha: null };
  // On a white stage: L_text = 1.05 / CR − 0.05, Weber W = 1 − L_text.
  const weber = (cr: number): number => clamp(1 - (1.05 / Math.max(cr, 1) - 0.05), 0.001, 1);
  const beta = 3.5;
  const gamma = 0.25;
  const lambda = 0.02;
  const mu = largePrint ? -1.1 : -1.4;
  const sigma = largePrint ? 0.6 : 0.5;
  const grid: number[] = [];
  for (let a = -2.3; a <= -0.1 + 1e-9; a += 0.02) grid.push(a);
  const logPost = grid.map((a) => -0.5 * ((a - mu) / sigma) ** 2);
  for (const t of trials) {
    const x = Math.log10(weber(t.contrast));
    grid.forEach((a, i) => {
      const p = gamma + (1 - gamma - lambda) * (1 - Math.exp(-(10 ** (beta * (x - a)))));
      logPost[i] = (logPost[i] as number) + Math.log(t.correct ? p : 1 - p);
    });
  }
  const mx = Math.max(...logPost);
  const w = logPost.map((l) => Math.exp(l - mx));
  const z = w.reduce((a, b) => a + b, 0);
  const alpha = grid.reduce((acc, a, i) => acc + a * (w[i] as number), 0) / z;
  let pM = 0;
  let pS = 0;
  grid.forEach((a, i) => {
    const p = (w[i] as number) / z;
    if (a > BAND_EDGES.MS) pS += p;
    else if (a > BAND_EDGES.NM) pM += p;
  });

  const ceiling = trials.filter((t) => t.correct && weber(t.contrast) <= 0.02).length >= 3;
  const cantSee = trials.filter((t) => !t.correct && weber(t.contrast) >= 0.3).length >= 2;
  if (ceiling) return { band: 'N', alpha };
  if (cantSee) return { band: 'S', alpha };
  if (pS >= 0.35) return { band: 'S', alpha };
  if (pM + pS >= 0.35) return { band: 'M', alpha };
  return { band: 'N', alpha };
}

/** Light or dark is the person's own choice on the last screen (pre-selected from their system colours). */
function polarityOf(raw: NonNullable<FittingRaw['reading']>): { value: Polarity; stated: Polarity | null } {
  const stated = raw.polarity.stated;
  return { value: stated === 'light' || stated === 'dark' ? stated : 'none', stated };
}

/* ------------------------------------------------------------------ */
/* Part P: pointing                                                    */
/* ------------------------------------------------------------------ */

const MOUSE_LADDER = [24, 32, 44, 56, 72, 96];
const TOUCH_LADDER = [44, 56, 72, 96];

type Press = { dx: number; dy: number; hit: boolean; slipped: boolean };

function scored(presses: Press[]): Press[] {
  // Round-2 blocks were 1 + 8 and the first click only positioned the pointer. The warm-up records scored presses only.
  return presses.length > 8 ? presses.slice(1) : presses;
}

function blockPasses(sizePx: number, presses: Press[]): boolean {
  const n = presses.length;
  if (!n) return false;
  const misses = presses.filter((p) => !p.hit).length;
  const allowed = n >= 8 ? Math.floor(n / 8) : n >= 5 ? 1 : 0;
  const W = sizePx;
  const r = presses.map((p) => Math.hypot(p.dx, p.dy)).filter((d) => d <= 2 * W);
  const sigmaHat = r.length ? median(r) / 1.1774 : W; // all fly-bys: treat as very spread
  const sigmaAbs = Math.sqrt(Math.max(0, sigmaHat ** 2 - (0.16 * W) ** 2));
  const sigmaEff = Math.sqrt((1.15 * sigmaAbs) ** 2 + (0.16 * W) ** 2);
  const pMiss = Math.exp(-(W * W) / (8 * sigmaEff * sigmaEff));
  return misses <= allowed && pMiss <= 0.08;
}

function minTarget(blocks: Array<{ sizePx: number; presses: Press[] }>, ladder: number[]): number | null {
  const tested = blocks.filter((b) => b.presses.length > 0);
  if (!tested.length) return null;
  const results = tested.map((b) => ({ size: b.sizePx, pass: blockPasses(b.sizePx, b.presses) }));
  const failed = results.filter((x) => !x.pass).map((x) => x.size);
  const maxFailed = failed.length ? Math.max(...failed) : -Infinity;
  // The smallest passing level with no failure above it (a pass below a failure is not trusted).
  const passed = results.filter((x) => x.pass && x.size > maxFailed).map((x) => x.size);
  if (passed.length) return Math.min(...passed);
  const above = ladder.find((l) => l > maxFailed);
  return above ?? ladder[ladder.length - 1] ?? 96;
}

function pointingFit(
  raw: NonNullable<FittingRaw['pointing']>,
  inputClass: InputClass,
): { minPx: number | null; conf: number; missRate: number | null; ring: Press[] } {
  const ladder = inputClass === 'touch' ? TOUCH_LADDER : MOUSE_LADDER;
  const blocks = raw.blocks.map((b) => ({ sizePx: b.sizePx, presses: scored(b.presses) }));
  const ring = blocks.flatMap((b) => b.presses);
  const sStar = minTarget(blocks, ladder);
  if (sStar == null) return { minPx: null, conf: 0, missRate: null, ring };

  // Bootstrap: 200 resamples of press points within blocks; conf = share that lands on the same S*.
  let seed = 2166136261;
  for (const p of ring) seed = Math.imul(seed ^ Math.round(p.dx * 10 + p.dy * 7 + (p.hit ? 1 : 0)), 16777619);
  const rnd = mulberry32(seed);
  let same = 0;
  const B = 200;
  for (let i = 0; i < B; i++) {
    const re = blocks.map((b) => ({
      sizePx: b.sizePx,
      presses: b.presses.map(() => b.presses[Math.floor(rnd() * b.presses.length)] as Press),
    }));
    if (minTarget(re, ladder) === sStar) same++;
  }
  const atStar = blocks.find((b) => b.sizePx === sStar)?.presses ?? ring;
  const missRate = atStar.length ? atStar.filter((p) => !p.hit).length / atStar.length : null;
  return { minPx: sStar, conf: r2(same / B), missRate, ring };
}

/* ------------------------------------------------------------------ */
/* Part F: Find and Pick                                               */
/* ------------------------------------------------------------------ */

const FIND_TIMEOUT_SEC = 12;

function chip(gotInWay: string[], re: RegExp): boolean {
  return gotInWay.some((c) => re.test(c.toLowerCase()));
}

/** Geometric mean of search times in seconds (a search that ran out counts as the full 12 s). */
function searchGeo(trials: Array<{ ms: number; found: boolean }>): number | null {
  if (!trials.length) return null;
  const ys = trials.map((t) => Math.log(t.found ? clamp(t.ms, 100, FIND_TIMEOUT_SEC * 1000) / 1000 : FIND_TIMEOUT_SEC));
  return Math.exp(mean(ys));
}

/**
 * Pick decides: preferring the calm page → Calm view offered (level 1); preferring it and also stopping the moving parts,
 * or searching busy pages ≥ 1.5× slower than calm ones → Calm view opens on busy pages (level 2). Moving parts are
 * paused only when the person pressed Stop (or said moving things got in the way, in the round-2 flow).
 */
function attentionFit(raw: FittingRaw['finding']): {
  motionOn: boolean; motionP: number; clutterP: number; structureLevel: StructureLevel; searchSecMedian: number | null;
  busyRatio: number | null;
} {
  if (!raw) return { motionOn: false, motionP: 0.3, clutterP: 0.25, structureLevel: 0, searchSecMedian: null, busyRatio: null };
  const chips = raw.gotInWay ?? [];
  const trials = raw.trials ?? [];
  const found = trials.filter((t) => t.found);
  const searchSecMedian = found.length ? r1(median(found.map((t) => t.ms / 1000))) : null;

  const busy = searchGeo(trials.filter((t) => t.clutter));
  const calm = searchGeo(trials.filter((t) => !t.clutter));
  const busyRatio = busy != null && calm != null && calm > 0 ? r2(busy / calm) : null;
  const moving = searchGeo(trials.filter((t) => t.motion));
  const still = searchGeo(trials.filter((t) => !t.motion));
  const movingRatio = moving != null && still != null && still > 0 ? moving / still : null;

  const choseCalm = (raw.preferredCalm ?? 0) >= 1;
  const stopped = chip(chips, /stop/);
  const saidMoving = chip(chips, /mov|motion|animat/);
  const saidBusy = chip(chips, /too much|busy|clutter|crowd/);
  const slowBusy = busyRatio != null && busyRatio >= 1.5;

  const structureLevel: StructureLevel = choseCalm ? (stopped || slowBusy ? 2 : 1) : 0;
  const motionOn = stopped || saidMoving;
  const motionP = stopped ? 0.9 : saidMoving ? 0.8 : movingRatio != null && movingRatio >= 1.5 ? 0.5 : 0.3;
  const clutterP =
    structureLevel === 2 ? 0.86 : structureLevel === 1 ? 0.7 : saidBusy || slowBusy ? 0.45 : 0.25;
  return { motionOn, motionP: r2(motionP), clutterP: r2(clutterP), structureLevel, searchSecMedian, busyRatio };
}

/* ------------------------------------------------------------------ */
/* deriveFit                                                           */
/* ------------------------------------------------------------------ */

export interface DeriveOptions {
  /** What the person already chose in Chrome and the OS. Sets the text prior and floor, and fixes motion and colours. */
  settings?: BrowserSettings | null;
  /** The warm-up session's numbers, saved in `calibration.warmup`. */
  metrics?: WarmupMetrics | null;
}

/**
 * Raw warm-up trials → FitProfile. Units: `reading.ladder[].px` are effective CSS px at 100% zoom (stimulus px × the
 * page's zoom); `faint[].contrast` is the WCAG ratio shown on white; `pointing` press offsets are CSS px from the
 * target centre. `reading.seedPx`, when set, is the comfortable size the person stated (round 2) and acts as the prior;
 * otherwise the prior comes from the browser settings (default font × default zoom, when changed).
 */
export function deriveFit(raw: FittingRaw, opts: DeriveOptions = {}): FitProfile {
  const base = defaultFit();
  const settings = opts.settings ?? null;
  const inputClass = raw.inputClass;
  const skipped = [...new Set(raw.skipped ?? [])];
  const sources: Partial<Record<FitDimension, FitSource>> = {};

  const seed = raw.reading?.seedPx != null && raw.reading.seedPx > 0 ? raw.reading.seedPx : null;
  const priorPx = seed ?? textPriorPx(settings);

  // Reading: contrast band first (large print widens the prior), then size, then light or dark.
  let text = base.text;
  let band: ContrastBand = 'N';
  let polarity = base.polarity;
  const faintTrials = raw.reading?.faint.length ?? 0;
  if (raw.reading) {
    band = contrastBand(raw.reading, priorPx != null && priorPx >= 32).band;
    const rs = readingSize(raw.reading, priorPx);
    text = { bodyPx: rs.bodyPx, cpsPx: rs.cpsPx, largePrint: rs.largePrint, conf: rs.conf, source: rs.source, override: null };
    polarity = polarityOf(raw.reading);
  } else if (priorPx != null && priorPx >= 16.5) {
    text = { ...text, bodyPx: half(clamp(priorPx, 16, 96)), largePrint: priorPx >= 32, conf: 0.35, source: 'stated' };
  }
  sources.text_size = text.source === 'measured' ? 'warmup' : text.source === 'stated' ? (seed != null ? 'warmup' : 'setting') : 'default';
  // The person's minimum font size is a floor the text never goes below.
  const minFont = settings?.minFontPx ?? 0;
  if (minFont > text.bodyPx) {
    text = { ...text, bodyPx: half(clamp(minFont, 16, 96)), largePrint: minFont >= 32 };
    if (text.source === 'default') {
      text = { ...text, source: 'stated', conf: 0.35 };
      sources.text_size = 'setting';
    }
  }
  sources.contrast = faintTrials ? 'warmup' : 'default';
  if (settings?.forcedColors) {
    // The system's own colours win: WebAble leaves colours alone.
    band = 'N';
    sources.contrast = 'setting';
  } else if (settings?.contrastMore && band === 'N') {
    band = 'M';
    sources.contrast = 'setting';
  }
  const floor = band === 'S' ? 15 : band === 'M' ? 7 : 4.5;
  const weightFloor = band === 'S' ? 600 : band === 'M' ? 500 : 400;
  // Word and letter spacing are never added by default: stretched word gaps broke real pages (round 3), and the
  // evidence for them is a subset benefit only (research-fitting §8.3). Only a future explicit setting sets them.
  const spacing = {
    lineHeight: band === 'S' || text.largePrint ? 1.8 : band === 'M' ? 1.6 : 1.5,
    wordEm: 0,
    letterEm: 0,
  };
  if (settings?.forcedColors) polarity = { value: 'none', stated: polarity.stated };

  // Pointing (keyboard, switch and voice users skip it: stored as null, never as a default).
  let targets: FitProfile['targets'] = { minPx: null, conf: 0 };
  let ring: Press[] = [];
  let missRate: number | null = null;
  if (raw.pointing && inputClass !== 'keyboard') {
    const pf = pointingFit(raw.pointing, inputClass);
    targets = { minPx: pf.minPx, conf: pf.conf };
    ring = pf.ring;
    missRate = pf.missRate;
  }
  sources.targets = targets.minPx != null ? 'warmup' : 'default';

  // Click stability from every press: Steady Clicks when P(slip rate ≥ 5%) ≥ 0.70.
  const presses = raw.allPresses ?? [];
  const slipK = ring.length >= 8 ? ring.filter((p) => p.slipped).length : presses.filter((p) => p.slipped).length;
  const slipN = ring.length >= 8 ? ring.length : presses.length;
  const steadyOn = inputClass !== 'touch' && inputClass !== 'keyboard' && slipN >= 8 && jeffreysAtLeast(slipK, slipN, 0.05) >= 0.7;
  const repK = presses.filter((p) => p.repeat).length;
  const debounce = inputClass !== 'keyboard' && presses.length >= 30 && repK >= 3;
  const S = targets.minPx;
  const radiusPx = S ? Math.round(clamp(S / 5, 6, S / 2)) : 10;
  sources.steady_clicks = raw.pointing && inputClass !== 'keyboard' ? 'warmup' : 'default';

  const att = attentionFit(raw.finding);
  let motion = { p: att.motionP, on: att.motionOn };
  sources.motion = raw.finding ? 'warmup' : 'default';
  if (settings?.reducedMotion) {
    // Reduce motion is honoured as set; it is never inferred.
    if (!motion.on) sources.motion = 'setting';
    motion = { p: Math.max(motion.p, 0.95), on: true };
  }
  sources.clutter = raw.finding ? 'warmup' : 'default';
  sources.colors = settings?.forcedColors ? 'setting' : polarity.stated != null ? 'warmup' : 'default';

  const allSlips = presses.length ? presses.filter((p) => p.slipped).length / presses.length : null;
  const calibration: WarmupCalibration = {
    version: opts.metrics ? WARMUP_VERSION : FIT_VERSION,
    durationSec: Math.max(0, Math.round(raw.durationSec ?? 0)),
    skipped,
  };
  if (opts.metrics || opts.settings) calibration.sources = sources;
  if (opts.metrics) calibration.warmup = opts.metrics;
  return {
    v: 'fit.1',
    createdAt: new Date().toISOString(),
    inputClass,
    text,
    contrast: { band, floor },
    polarity,
    weight: { floor: weightFloor },
    spacing,
    measure: { targetCpl: 66, maxCpl: 75, minCpl: text.largePrint ? 8 : 13 },
    targets,
    clicks: { steady: { on: steadyOn, windowMs: 300, radiusPx }, debounce },
    attention: { motion, clutter: { p: att.clutterP }, structureLevel: att.structureLevel },
    baselines: {
      searchSecMedian: att.searchSecMedian,
      slipRate: r2(allSlips ?? (slipN ? slipK / slipN : base.baselines.slipRate)),
      repeatRate: r2(presses.length ? repK / presses.length : base.baselines.repeatRate),
      missRate: r2(missRate ?? base.baselines.missRate),
    },
    calibration,
    layout: { column: 'auto' },
  };
}

/**
 * Where each part of a saved fit came from, for the passive fit's precedence (person > warm-up > learned > settings >
 * default) and for "From your warm-up" / "From your browser settings" labels. Fits saved before round 4 carry no
 * sources: anything measured or set counts as the warm-up, the rest as default.
 */
export function fitSources(fit: FitProfile): Partial<Record<FitDimension, FitSource>> {
  const saved = (fit.calibration as WarmupCalibration | undefined)?.sources;
  if (saved) return { ...saved };
  const def = defaultFit();
  const demo = /^demo-/.test(fit.calibration?.version ?? '');
  const any = (changed: boolean): FitSource => (demo || changed ? 'warmup' : 'default');
  return {
    text_size: fit.text.override != null ? 'person' : any(fit.text.source !== 'default'),
    contrast: any(fit.contrast.band !== def.contrast.band),
    targets: any(fit.targets.minPx != null),
    steady_clicks: any(fit.clicks.steady.on),
    motion: any(fit.attention.motion.on),
    clutter: any(fit.attention.structureLevel > 0),
    colors: any(fit.polarity.value !== 'none'),
  };
}

/* ------------------------------------------------------------------ */
/* Views of a fit                                                      */
/* ------------------------------------------------------------------ */

const effectiveBody = (fit: FitProfile): number => fit.text.override ?? fit.text.bodyPx;

/** Coarse, diagnosis-free levels a generative model may see. */
export function summarizeFitForModel(fit: FitProfile): FitSummaryForModel {
  const F = effectiveBody(fit);
  const T = fit.targets.minPx;
  const level = fit.attention.structureLevel;
  return {
    text_need: fit.text.largePrint || F >= 22 ? 'large' : F >= 18 ? 'some' : 'none',
    target_need: T == null || T <= 24 ? 'none' : T >= 56 ? 'large' : 'some',
    clutter_tolerance: level === 2 || fit.attention.clutter.p >= 0.8 ? 'low' : level === 1 || fit.attention.clutter.p >= 0.6 ? 'medium' : 'high',
    structure_level: level,
    motion: fit.attention.motion.on ? 'reduce' : 'fine',
    polarity: fit.polarity.value,
  };
}

const px = (v: number): string => `${Math.round(v * 2) / 2} px`;

/** Rows for the "Your fit" card: what WebAble changes, from the usual web page to this fit. */
export function describeFit(fit: FitProfile): Array<{ label: string; from: string; to: string }> {
  const F = effectiveBody(fit);
  const T = fit.targets.minPx;
  const level = fit.attention.structureLevel;
  const noChange = 'No change';
  return [
    { label: 'Text size', from: '16 px', to: F > 16.5 ? px(F) : noChange },
    {
      label: 'Faint text',
      from: 'Site colours',
      to: fit.contrast.band === 'S' ? 'Strongest contrast' : fit.contrast.band === 'M' ? 'Lifted to 7:1' : 'Lifted to 4.5:1',
    },
    { label: 'Text weight', from: 'Site weight', to: fit.weight.floor >= 600 ? 'Semibold' : fit.weight.floor >= 500 ? 'Medium' : noChange },
    { label: 'Light or dark', from: 'Site colours', to: fit.polarity.value === 'dark' ? 'Dark pages' : fit.polarity.value === 'light' ? 'Light pages' : noChange },
    { label: 'Click areas', from: '24 px', to: T != null && T > 24 ? px(T) : noChange },
    { label: 'Steady clicks', from: 'Off', to: fit.clicks.steady.on ? 'On' : noChange },
    { label: 'Repeat clicks', from: 'Each one counts', to: fit.clicks.debounce ? 'Quick repeats ignored' : noChange },
    { label: 'Moving things', from: 'Moving', to: fit.attention.motion.on ? 'Paused' : noChange },
    { label: 'Busy pages', from: 'As the site shows them', to: level === 2 ? 'Calm view opens' : level === 1 ? 'Calm view offered' : noChange },
  ];
}
