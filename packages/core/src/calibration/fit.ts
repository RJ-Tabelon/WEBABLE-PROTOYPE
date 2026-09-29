import { defaultFitProfile, type SystemSignals } from '../profile/defaults';
import { normCdf } from '../profile/needs';
import {
  fitProfileSchema,
  TARGET_LADDER,
  type AttentionFit,
  type ContrastFloor,
  type FitProfile,
  type LatentDim,
  type MotorFit,
  type ParamSource,
  type Polarity,
  type TargetPx,
  type VisionFit,
} from '../profile/schema';
import { DERIVATION_VERSION } from '../versions';
import { readingSizeConfidence } from './reading';
import type {
  AttentionSummary,
  CalibrationRecord,
  DeviceContext,
  MotorSummary,
  VisionSummary,
} from './schema';

export interface DeriveInput {
  record: CalibrationRecord;
  system: SystemSignals;
  /** The previous profile when recalibrating; its overrides are preserved. */
  previous?: FitProfile;
  now?: Date;
}

/**
 * Units: every size in the profile is in CSS px at 100% page zoom. Calibration
 * measures CSS px at the calibration zoom (`record.device.zoom`), so sizes are
 * multiplied by that zoom here; the extension divides by the page's own zoom.
 */

/* ------------------------------------------------------------------------ */
/* Constants (cal-vision.md 4, cal-motor.md 5.7, cal-attention.md 5-6)        */
/* ------------------------------------------------------------------------ */

/** Band edges on the log10 Weber threshold: 3% and 9%. */
const EDGE_N = Math.log10(0.03);
const EDGE_S = Math.log10(0.09);
/** Display uncertainty added to the posterior SD, plus a low-DPR penalty. */
const DISPLAY_SD = 0.1;
const LOW_DPR_SD = 0.05;
const CONTRAST_CONF_CAP = 0.85;
/** Size margin over the critical print size: +0.1 log, +0.2 log in band S. */
const SIZE_MARGIN = 0.1;
const SIZE_MARGIN_S = 0.2;
/** Polarity: an objective winner needs >= 0.08 log and z >= 1.64. */
const POLARITY_MIN_EFFECT = 0.08;
const POLARITY_Z = 1.64;
const POLARITY_WEAK_EFFECT = 0.04;
/** Confidence given to a value the person set explicitly. */
const OVERRIDE_CONFIDENCE = 0.9;
/** Confidence of a size the person picked in the comfort preview. */
const STATED_CONFIDENCE = 0.6;
/** Binary offers: Jeffreys posterior P(rate >= 5%) >= 0.70 (cal-motor.md 5.6). */
const OFFER_RATE = 0.05;
const OFFER_POSTERIOR = 0.7;
/** Attention priors on the benefit scale (defaults.ts uses the same values). */
const POPULATION_PRIOR = { mean: 0, sd: 0.35 } as const;
const SYSTEM_MOTION_PRIOR = { mean: 0.6, sd: 0.15 } as const;
/** Behaviour-only evidence can never reach "medium" (cal-attention.md 5). */
const BEHAVIOR_ONLY_CAP = 0.24;
/**
 * Indicator scales and SEs on the benefit scale. Proposal values pending the
 * pilot (cal-attention.md 8): a preference step is worth 0.12, a chip 0.25.
 */
const PREF_STEP = 0.12;
const PREF_SE = 0.15;
const PREF_SE_CHUNKED = 0.12;
const CHIP_X = 0.25;
const CHIP_SE = 0.25;
const NOTHING_SE = 0.35;
const STOP_MOTION_X = 0.5;
const STOP_MOTION_SE = 0.15;
const CAPTURE_SCALE = 0.4;
const CAPTURE_SE = 0.25;

/* ------------------------------------------------------------------------ */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((a, b) => a + b, 0) / values.length;
}

interface Param<T> {
  value: T;
  source: ParamSource;
  confidence: number;
  measured?: T;
  stated?: T;
  override?: T;
}

function param<T>(
  value: T,
  source: ParamSource,
  confidence: number,
  fields: { measured?: T; stated?: T; override?: T } = {},
): Param<T> {
  const p: Param<T> = {
    value,
    source,
    confidence: round(clamp(confidence, 0, 1)),
  };
  if (fields.measured !== undefined) p.measured = fields.measured;
  if (fields.stated !== undefined) p.stated = fields.stated;
  if (fields.override !== undefined) p.override = fields.override;
  return p;
}

/** Apply an explicit choice: it becomes the effective value; the evidence stays. */
function withOverride<T>(
  p: Param<T>,
  override: T | undefined,
  confidence = OVERRIDE_CONFIDENCE,
): Param<T> {
  if (override === undefined) return p;
  return {
    ...p,
    value: override,
    source: 'override',
    override,
    confidence: round(clamp(confidence, 0, 1)),
  };
}

/** A recalibration never erases what the person set: the previous override wins. */
function keepOverride<T>(next: Param<T>, prev: Param<T> | undefined): Param<T> {
  if (!prev || next.override !== undefined) return next;
  const prevOverride =
    prev.override ?? (prev.source === 'override' ? prev.value : undefined);
  if (prevOverride === undefined) return next;
  return withOverride(next, prevOverride, prev.confidence);
}

function snapTarget(px: number): TargetPx {
  let best: TargetPx = TARGET_LADDER[0];
  for (const l of TARGET_LADDER) {
    if (Math.abs(Math.log(l / px)) < Math.abs(Math.log(best / px))) best = l;
  }
  return best;
}

function ladderIndex(px: TargetPx): number {
  return TARGET_LADDER.indexOf(px);
}

/* ------------------------------------------------------------------------ */
/* Jeffreys posterior for binary offers                                       */
/* ------------------------------------------------------------------------ */

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9).
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0] ?? 1;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] ?? 0) / (z + i);
  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
  );
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * Jeffreys posterior probability that an event's true rate is at least `rate`
 * after k events in n opportunities: 1 - I_rate(k + 1/2, n - k + 1/2).
 * With n = 30 and rate 5%: k = 0 -> .08, 1 -> .38, 2 -> .70, 3 -> .89.
 */
export function rateExceedanceProbability(
  k: number,
  n: number,
  rate: number,
): number {
  if (!(n > 0)) return 0;
  const kk = clamp(Math.round(k), 0, n);
  return round(
    clamp(1 - regularizedBeta(clamp(rate, 0, 1), kk + 0.5, n - kk + 0.5), 0, 1),
    4,
  );
}

/* ------------------------------------------------------------------------ */
/* Vision                                                                     */
/* ------------------------------------------------------------------------ */

export type ContrastBand = 'N' | 'M' | 'S';

const BAND_FLOOR: Record<ContrastBand, ContrastFloor> = { N: 4.5, M: 7, S: 21 };
const BAND_RANK: Record<ContrastBand, number> = { N: 0, M: 1, S: 2 };

/**
 * Contrast band from the log10 Weber threshold (cal-vision.md 4.2), via the
 * contrast-reserve rule W_req = min(0.95, 10 x threshold): N (<= 3%) keeps the
 * 4.5:1 floor, M (3-9%) needs 7:1, S (> 9%) needs the maximum.
 */
export function contrastBand(alphaLog: number): ContrastBand {
  if (alphaLog <= EDGE_N) return 'N';
  if (alphaLog <= EDGE_S) return 'M';
  return 'S';
}

function contrastConfidence(
  c: NonNullable<VisionSummary['contrast']>,
  band: ContrastBand,
  dprBucket: number,
): number {
  const sigma =
    Math.sqrt(c.sd ** 2 + DISPLAY_SD ** 2) + (dprBucket < 1.5 ? LOW_DPR_SD : 0);
  const lo =
    band === 'N' ? Number.NEGATIVE_INFINITY : band === 'M' ? EDGE_N : EDGE_S;
  const hi =
    band === 'N' ? EDGE_N : band === 'M' ? EDGE_S : Number.POSITIVE_INFINITY;
  const cdf = (edge: number) =>
    edge === Number.POSITIVE_INFINITY
      ? 1
      : edge === Number.NEGATIVE_INFINITY
        ? 0
        : normCdf((edge - c.alphaLog) / sigma);
  let conf = cdf(hi) - cdf(lo);
  // The low-contrast reading probe (V4b) is not part of this battery, so a
  // threshold within one SD of an edge is always "near an edge, no probe".
  const nearEdge =
    Math.min(Math.abs(c.alphaLog - EDGE_N), Math.abs(c.alphaLog - EDGE_S)) <
    sigma;
  if (nearEdge) conf *= 0.9;
  if (c.ceiling) conf *= 0.8;
  return clamp(conf, 0, CONTRAST_CONF_CAP);
}

function derivePolarity(
  s: VisionSummary,
  band: ContrastBand | null,
): Param<Polarity> | null {
  const pol = s.polarity;
  if (!pol) return null;
  const stated: Polarity | null =
    pol.stated === 'light' || pol.stated === 'dark'
      ? pol.stated
      : pol.stated === 'same'
        ? 'none'
        : null;
  const hasObjective = pol.se < 2;
  const winner =
    hasObjective &&
    Math.abs(pol.deltaLog) >= POLARITY_MIN_EFFECT &&
    Math.abs(pol.deltaLog) / Math.max(pol.se, 1e-6) >= POLARITY_Z;
  const objective: Polarity | null = winner
    ? pol.deltaLog > 0
      ? 'dark'
      : 'light'
    : null;
  const statedSide = stated === 'light' || stated === 'dark' ? stated : null;
  const fields = {
    ...(objective ? { measured: objective } : {}),
    ...(stated ? { stated } : {}),
  };

  if (objective && statedSide) {
    return objective === statedSide
      ? param(objective, 'measured', 0.8, fields)
      : param<Polarity>('none', 'measured', 0.4, fields);
  }
  if (objective) return param(objective, 'measured', 0.6, fields);
  // Band S: dark ahead but below significance matches the scatter pattern; offer dark.
  if (
    band === 'S' &&
    hasObjective &&
    pol.deltaLog >= POLARITY_WEAK_EFFECT &&
    statedSide !== 'light'
  ) {
    return param<Polarity>('dark', 'measured', 0.55, {
      ...fields,
      measured: 'dark',
    });
  }
  if (statedSide) return param(statedSide, 'stated', 0.5, fields);
  if (hasObjective)
    return param<Polarity>('none', 'measured', 0.6, {
      ...fields,
      measured: 'none',
    });
  if (stated === 'none') return param<Polarity>('none', 'stated', 0.6, fields);
  return null;
}

/**
 * Vision section from a measured reading summary. Parameters the summary
 * cannot speak to (a skipped contrast step, no usable ladder) keep `base`;
 * parameters it decides are re-derived from `defaults`, so a recalibration
 * never inherits a stale derived value.
 */
function deriveVision(
  base: VisionFit,
  defaults: VisionFit,
  s: VisionSummary,
  device: DeviceContext,
  moreContrast: boolean,
): VisionFit {
  const zoom = clamp(device.zoom, 0.25, 5);
  const root = device.rootFontPx;
  const toProfilePx = (fontPx: number) =>
    Math.round(clamp(fontPx * zoom, 12, 96));
  const vision: VisionFit = { ...base };

  // Contrast floor (4.2), with the stated "more contrast" system preference as a tie-break.
  let band: ContrastBand | null = null;
  if (s.contrast) {
    // Two or more "I can't see a word" answers at high contrast go straight to the maximum band.
    band = (s.contrast.cantSeeHigh ?? 0) >= 2 ? 'S' : contrastBand(s.contrast.alphaLog);
    const floor = BAND_FLOOR[band];
    const conf = contrastConfidence(s.contrast, band, device.dprBucket);
    const stated: ContrastFloor | undefined = moreContrast ? 7 : undefined;
    vision.contrastFloor =
      stated !== undefined && BAND_RANK[band] === 0
        ? param<ContrastFloor>(stated, 'stated', 0.5, {
            measured: floor,
            stated,
          })
        : param<ContrastFloor>(floor, 'measured', conf, {
            measured: floor,
            ...(stated ? { stated } : {}),
          });
  }

  // Minimum text size (4.1): CPS + 0.1 log (0.2 in band S); display-limited keeps what fits.
  const margin = band === 'S' ? SIZE_MARGIN_S : SIZE_MARGIN;
  const statedPx = s.comfortPx !== null ? toProfilePx(s.comfortPx) : undefined;
  if (s.criticalPx !== null) {
    const fontPx = s.displayLimited
      ? s.criticalPx
      : s.criticalPx * 10 ** margin;
    const value = toProfilePx(fontPx);
    vision.textMinPx = param(value, 'measured', readingSizeConfidence(s), {
      measured: value,
      ...(statedPx !== undefined ? { stated: statedPx } : {}),
    });
  } else if (statedPx !== undefined) {
    vision.textMinPx = param(statedPx, 'stated', 0.3, { stated: statedPx });
  }
  if (s.overrides.textPx !== undefined) {
    vision.textMinPx = withOverride(
      vision.textMinPx,
      toProfilePx(s.overrides.textPx),
    );
  }

  // Polarity (4.3).
  const polarity = derivePolarity(s, band);
  if (polarity) vision.polarity = polarity;
  if (s.overrides.polarity !== undefined) {
    vision.polarity = withOverride(vision.polarity, s.overrides.polarity);
  }

  // Weight floor (4.4): 400 for everyone; bolder in bands M and S.
  if (band === 'N') vision.fontWeightFloor = defaults.fontWeightFloor;
  if (band === 'M')
    vision.fontWeightFloor = param<400 | 500 | 600>(500, 'measured', 0.5, {
      measured: 500,
    });
  if (band === 'S')
    vision.fontWeightFloor = param<400 | 500 | 600>(600, 'measured', 0.5, {
      measured: 600,
    });

  // Spacing and line length (4.5): priors, raised on the large-print path or band M/S.
  const largePrint = s.largePrint || vision.textMinPx.value >= 2 * root;
  vision.lineHeight = defaults.lineHeight;
  vision.wordSpacingEm = defaults.wordSpacingEm;
  vision.maxLineCh = defaults.maxLineCh;
  if (largePrint || band === 'S') {
    vision.lineHeight = param(1.8, 'measured', 0.35, { measured: 1.8 });
    vision.wordSpacingEm = param(0.16, 'measured', 0.35, { measured: 0.16 });
  } else if (band === 'M') {
    vision.lineHeight = param(1.6, 'measured', 0.35, { measured: 1.6 });
  }
  if (largePrint)
    vision.maxLineCh = param(70, 'measured', 0.4, { measured: 70 });
  if (s.overrides.moreSpacing === true) {
    vision.lineHeight = withOverride(
      vision.lineHeight,
      Math.max(vision.lineHeight.value, 1.8),
    );
    vision.wordSpacingEm = withOverride(
      vision.wordSpacingEm,
      Math.max(vision.wordSpacingEm.value, 0.16),
    );
  } else if (s.overrides.moreSpacing === false) {
    vision.lineHeight = withOverride(vision.lineHeight, 1.5);
    vision.wordSpacingEm = withOverride(vision.wordSpacingEm, 0);
  }

  const ratio = clamp(s.referenceXHeightRatio, 0.3, 0.7);
  vision.xHeightMinPx = round(clamp(vision.textMinPx.value * ratio, 4, 60), 1);
  return vision;
}

/* ------------------------------------------------------------------------ */
/* Motor                                                                      */
/* ------------------------------------------------------------------------ */

function deriveDrag(
  d: NonNullable<MotorSummary['drag']>,
): 'none' | 'some' | 'high' {
  if (d.skipped) return 'high';
  const failures = Math.max(0, d.attempts - d.successes);
  const r = d.timeRatio;
  if (failures >= 2 || (d.earlyReleases > 0 && r !== null && r > 2))
    return 'high';
  if (failures >= 1 || (r !== null && r >= 1.5)) return 'some';
  return 'none';
}

function deriveMotor(base: MotorFit, m: MotorSummary, zoom: number): MotorFit {
  const motor: MotorFit = { ...base, input: m.input };
  if (m.recommendedPx === null) return motor;
  const z = clamp(zoom, 0.25, 5);
  const star = snapTarget(m.recommendedPx * z);
  const conf = m.recommendedConfidence;

  // Minimum target (5.7): never deny more room than the person picked.
  const chosen = m.chosenPx === null ? null : snapTarget(m.chosenPx * z);
  if (chosen === null || chosen === star) {
    motor.minTargetPx = param<TargetPx>(star, 'measured', conf, {
      measured: star,
      ...(chosen !== null ? { stated: chosen } : {}),
    });
  } else if (ladderIndex(star) - ladderIndex(chosen) >= 2) {
    motor.minTargetPx = param<TargetPx>(
      chosen,
      'override',
      OVERRIDE_CONFIDENCE,
      {
        measured: star,
        stated: chosen,
        override: chosen,
      },
    );
  } else {
    motor.minTargetPx = param<TargetPx>(
      chosen,
      'stated',
      Math.max(conf, STATED_CONFIDENCE),
      {
        measured: star,
        stated: chosen,
      },
    );
  }

  // Steady clicks: offer when slip-offs are likely >= 5% or slips are large for the target.
  const slipP = rateExceedanceProbability(
    m.slip.slipOffs,
    m.slip.presses,
    OFFER_RATE,
  );
  const bySpread = m.slip.presses > 0 && m.slip.p95Px >= 0.25 * star;
  const steadyOn = slipP >= OFFER_POSTERIOR || bySpread;
  const steady = {
    on: steadyOn,
    windowMs: Math.round(clamp(m.slip.pressP90Ms + 50, 200, 400)),
    radiusPx: round(clamp(1.5 * m.slip.p95Px, 6, Math.min(48, star / 2)), 1),
  };
  motor.steadyClicks = param(
    steady,
    'measured',
    steadyOn
      ? clamp(Math.max(slipP, bySpread ? 0.6 : 0), 0, 0.9)
      : clamp(1 - slipP, 0, 0.85),
    { measured: steady },
  );

  // Repeat guard: same element, window from the observed repeat intervals.
  const repeatP = rateExceedanceProbability(
    m.repeats.count,
    m.slip.presses,
    OFFER_RATE,
  );
  const repeat = {
    on: repeatP >= OFFER_POSTERIOR,
    windowMs:
      m.repeats.count > 0
        ? Math.round(clamp(m.repeats.p95IntervalMs + 100, 300, 600))
        : base.repeatGuard.value.windowMs,
  };
  motor.repeatGuard = param(
    repeat,
    'measured',
    repeat.on ? clamp(repeatP, 0, 0.9) : clamp(1 - repeatP, 0, 0.85),
    { measured: repeat },
  );

  // Spacing: centre-to-centre = 2 x (S/2 + slip p95 when steady clicks are off).
  const s = motor.minTargetPx.value;
  const spacing = Math.round(
    clamp(s + 2 * (steadyOn ? 0 : m.slip.p95Px), 0, 160),
  );
  motor.targetSpacingPx = param(
    spacing,
    'measured',
    motor.minTargetPx.confidence,
    { measured: spacing },
  );

  if (m.drag) {
    const level = deriveDrag(m.drag);
    motor.drag = param(level, 'measured', 0.5, { measured: level });
  }

  // Hover grace: low confidence by design (path measures are unreliable in one session).
  if (m.hold && m.input !== 'touch') {
    const rj = m.hold.jitterP95Px;
    const grace: 0 | 400 | 700 =
      rj >= 0.5 * star ? 700 : rj >= 0.25 * star ? 400 : 0;
    motor.hoverGraceMs = param(grace, 'measured', 0.25, { measured: grace });
  }
  return motor;
}

/* ------------------------------------------------------------------------ */
/* Attention                                                                  */
/* ------------------------------------------------------------------------ */

type LatentSource = LatentDim['sources'][number];

interface Indicator {
  x: number;
  se: number;
  loading: number;
  source: LatentSource;
}

/**
 * Normal-normal shrinkage (cal-attention.md 5) with a linear-Gaussian
 * measurement model x_j = lambda_j * theta + e_j, e_j ~ N(0, SE_j^2).
 * Confidence = 1 - posterior sd / population sd; behaviour-only evidence is capped low.
 */
function shrink(
  prior: { mean: number; sd: number },
  priorSources: readonly LatentSource[],
  indicators: readonly Indicator[],
): LatentDim {
  let precision = 1 / prior.sd ** 2;
  let weighted = prior.mean / prior.sd ** 2;
  for (const ind of indicators) {
    if (!Number.isFinite(ind.x) || !(ind.se > 0) || !(ind.loading > 0))
      continue;
    precision += ind.loading ** 2 / ind.se ** 2;
    weighted += (ind.loading * ind.x) / ind.se ** 2;
  }
  const sd = Math.sqrt(1 / precision);
  let confidence = clamp(1 - sd / POPULATION_PRIOR.sd, 0, 1);
  const kinds = new Set(indicators.map((i) => i.source));
  if (
    priorSources.length === 0 &&
    kinds.size > 0 &&
    [...kinds].every((k) => k === 'behavior')
  ) {
    confidence = Math.min(confidence, BEHAVIOR_ONLY_CAP);
  }
  const sources = [
    ...new Set<LatentSource>([
      ...priorSources,
      ...indicators.map((i) => i.source),
    ]),
  ].slice(0, 6);
  return {
    mean: round(clamp(weighted / precision, -1, 2)),
    sd: round(clamp(sd, 0, 2)),
    confidence: round(confidence),
    sources,
  };
}

function flatDim(): LatentDim {
  return {
    mean: POPULATION_PRIOR.mean,
    sd: POPULATION_PRIOR.sd,
    confidence: 0,
    sources: [],
  };
}

function systemMotionDim(): LatentDim {
  return {
    mean: SYSTEM_MOTION_PRIOR.mean,
    sd: SYSTEM_MOTION_PRIOR.sd,
    confidence: 0.6,
    sources: ['system'],
  };
}

function pref(value: number | null, se = PREF_SE, loading = 1): Indicator[] {
  return value === null
    ? []
    : [{ x: PREF_STEP * value, se, loading, source: 'preference' }];
}

function behavior(
  e: { value: number; se: number } | null,
  loading = 1,
): Indicator[] {
  return e === null
    ? []
    : [{ x: e.value, se: Math.max(e.se, 0.05), loading, source: 'behavior' }];
}

function deriveAttention(
  a: AttentionSummary,
  reducedMotion: boolean,
): Omit<AttentionFit, 'systemReducedMotion'> {
  const chip = (
    id: AttentionSummary['chips'][number],
    x = CHIP_X,
    se = CHIP_SE,
  ): Indicator[] =>
    a.chips.includes(id) ? [{ x, se, loading: 1, source: 'chips' }] : [];
  const nothing = chip('nothing', 0, NOTHING_SE);
  const capture = (loading: number, se: number): Indicator[] =>
    a.decoyCapture === null
      ? []
      : [
          {
            x: CAPTURE_SCALE * a.decoyCapture,
            se,
            loading,
            source: 'behavior',
          },
        ];
  const { clutter, motion, guidance, chunking } = a.effects;

  const motionPrior = reducedMotion ? SYSTEM_MOTION_PRIOR : POPULATION_PRIOR;
  const motionSources: LatentSource[] = reducedMotion ? ['system'] : [];
  return {
    motion: shrink(motionPrior, motionSources, [
      ...(a.stopMotionPressed
        ? [
            {
              x: STOP_MOTION_X,
              se: STOP_MOTION_SE,
              loading: 1,
              source: 'preference' as const,
            },
          ]
        : []),
      ...(a.motionShown ? pref(a.preferences.still) : []),
      ...(a.motionShown ? behavior(motion) : []),
      ...chip('moving'),
      ...nothing,
    ]),
    distraction: shrink(
      POPULATION_PRIOR,
      [],
      [
        ...capture(1, CAPTURE_SE),
        // Without motion trials the "moving" factor is the static-salience contrast.
        ...behavior(motion, a.motionShown ? 0.5 : 1),
        ...behavior(clutter, 0.5),
        ...pref(a.preferences.clean, PREF_SE, 0.5),
        ...chip('busy', 0.2, 0.3),
        ...nothing,
      ],
    ),
    density: shrink(
      POPULATION_PRIOR,
      [],
      [
        ...behavior(clutter),
        ...pref(a.preferences.clean),
        ...chip('busy'),
        ...nothing,
      ],
    ),
    chunking: shrink(
      POPULATION_PRIOR,
      [],
      [
        ...pref(a.preferences.chunked, PREF_SE_CHUNKED),
        ...behavior(chunking),
        ...chip('long_text'),
        ...nothing,
      ],
    ),
    guidance: shrink(
      POPULATION_PRIOR,
      [],
      [
        ...behavior(guidance),
        ...capture(1, 0.3),
        ...pref(a.preferences.hierarchy),
        ...chip('unclear_action'),
        ...nothing,
      ],
    ),
  };
}

const DIMS = [
  'motion',
  'distraction',
  'density',
  'chunking',
  'guidance',
] as const;

/* ------------------------------------------------------------------------ */
/* Profile                                                                    */
/* ------------------------------------------------------------------------ */

function keepVisionOverrides(
  next: VisionFit,
  prev: VisionFit | undefined,
): VisionFit {
  if (!prev) return next;
  return {
    ...next,
    textMinPx: keepOverride(next.textMinPx, prev.textMinPx),
    contrastFloor: keepOverride(next.contrastFloor, prev.contrastFloor),
    polarity: keepOverride(next.polarity, prev.polarity),
    fontWeightFloor: keepOverride(next.fontWeightFloor, prev.fontWeightFloor),
    lineHeight: keepOverride(next.lineHeight, prev.lineHeight),
    wordSpacingEm: keepOverride(next.wordSpacingEm, prev.wordSpacingEm),
    letterSpacingEm: keepOverride(next.letterSpacingEm, prev.letterSpacingEm),
    maxLineCh: keepOverride(next.maxLineCh, prev.maxLineCh),
  };
}

function keepMotorOverrides(
  next: MotorFit,
  prev: MotorFit | undefined,
): MotorFit {
  if (!prev) return next;
  return {
    ...next,
    minTargetPx: keepOverride(next.minTargetPx, prev.minTargetPx),
    targetSpacingPx: keepOverride(next.targetSpacingPx, prev.targetSpacingPx),
    steadyClicks: keepOverride(next.steadyClicks, prev.steadyClicks),
    repeatGuard: keepOverride(next.repeatGuard, prev.repeatGuard),
    drag: keepOverride(next.drag, prev.drag),
    hoverGraceMs: keepOverride(next.hoverGraceMs, prev.hoverGraceMs),
  };
}

function moduleStatus(
  summary: { status: 'measured' | 'skipped' } | undefined,
  previous: FitProfile['modules'][keyof FitProfile['modules']] | undefined,
): FitProfile['modules'][keyof FitProfile['modules']] {
  if (summary?.status === 'measured') return 'measured';
  if (previous === 'measured') return 'measured';
  return summary?.status ?? previous ?? 'not_run';
}

/**
 * Pure, deterministic, versioned derivation of the fit profile from
 * calibration summaries (cal-motor.md 5.7, cal-vision.md 4, cal-attention.md 5-6).
 * Skipped modules keep defaults (or the previous profile's values).
 */
export function deriveFitProfile(input: DeriveInput): FitProfile {
  const { record, previous } = input;
  const device = record.device;
  const now = input.now ?? new Date(record.completedAt ?? record.startedAt);
  const reducedMotion = device.reducedMotion || input.system.reducedMotion;
  const signals: SystemSignals = {
    reducedMotion,
    colorScheme: device.colorScheme,
    moreContrast: device.moreContrast || input.system.moreContrast,
    forcedColors: device.forcedColors || input.system.forcedColors,
    deviceClass: device.class,
    input: device.input,
  };
  const defaults = defaultFitProfile(signals, now);
  const base = previous ?? defaults;
  const { reading, pointing, focus } = record.modules;

  // Vision
  let vision: VisionFit = base.vision;
  if (reading?.status === 'measured') {
    vision = keepVisionOverrides(
      deriveVision(
        base.vision,
        defaults.vision,
        reading,
        device,
        signals.moreContrast,
      ),
      previous?.vision,
    );
  }

  // Motor
  let motor: MotorFit = {
    ...base.motor,
    input: pointing?.input ?? device.input,
  };
  if (pointing?.status === 'measured') {
    motor = keepMotorOverrides(
      deriveMotor(base.motor, pointing, device.zoom),
      previous?.motor,
    );
  }

  // Attention
  let attention: AttentionFit;
  if (focus?.status === 'measured') {
    const derived = deriveAttention(focus, reducedMotion);
    const prevAttention = previous?.attention;
    const merged = { ...derived };
    for (const dim of DIMS) {
      const prev = prevAttention?.[dim];
      if (prev?.sources.includes('override')) merged[dim] = prev;
    }
    attention = { ...merged, systemReducedMotion: reducedMotion };
  } else {
    attention = { ...base.attention, systemReducedMotion: reducedMotion };
    const onlySystem = (d: LatentDim) => d.sources.every((s) => s === 'system');
    if (onlySystem(attention.motion))
      attention.motion = reducedMotion ? systemMotionDim() : flatDim();
  }

  const modules: FitProfile['modules'] = {
    reading: moduleStatus(reading, previous?.modules.reading),
    pointing: moduleStatus(pointing, previous?.modules.pointing),
    focus: moduleStatus(focus, previous?.modules.focus),
  };

  const parts: number[] = [];
  if (modules.reading === 'measured')
    parts.push(
      mean([vision.textMinPx.confidence, vision.contrastFloor.confidence]),
    );
  if (modules.pointing === 'measured') parts.push(motor.minTargetPx.confidence);
  if (modules.focus === 'measured')
    parts.push(mean(DIMS.map((d) => attention[d].confidence)));

  const profile: FitProfile = {
    v: 1,
    derivationVersion: DERIVATION_VERSION,
    calibrationVersion: record.version,
    createdAt: now.toISOString(),
    device: { class: device.class, input: motor.input },
    modules,
    vision,
    motor,
    attention,
    confidence: round(clamp(mean(parts), 0, 1)),
  };
  return fitProfileSchema.parse(profile);
}
