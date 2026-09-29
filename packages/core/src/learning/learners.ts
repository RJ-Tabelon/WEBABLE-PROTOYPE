import {
  DIM_IDS,
  OP_CATALOG,
  OP_IDS,
  nearestLevel,
  type DimId,
  type OpId,
} from '../ops/catalog';
import type { PageCategory } from '../page/types';
import type { AnalysisLabel } from '../policy/types';
import type { FitProfile, NeedLevels, ParamSource } from '../profile/schema';
import { OP_LIBRARY_VERSION } from '../versions';
import {
  addCounts,
  clamp01,
  decayCounts,
  kalmanPoint as kalmanPointMath,
  predictDim,
  probitUpdate,
  subtractCounts,
  zeroCounts,
} from './math';
import { mergeLearningDeltas } from './merge';
import { K, W } from './params';
import {
  DIM_STRENGTH_SIGN,
  ENGINE_PRIOR,
  LAB_TO_WILD,
  PIN_THETA,
  PRIOR_RELEASE,
  SIGMA_CAL,
  SIGMA_WIDE,
  needForOp,
  populationPrior,
  priorCentre,
} from './priors';
import {
  cloneJson,
  defaultOpState,
  emptyDomainState,
  ensureDomainOp,
  ensureOp,
  isOpId,
  neutralDim,
  type DomainOpLocal,
} from './state';
import type {
  AdaptEvent,
  Counts,
  Day,
  DimState,
  DomainState,
  LearnDelta,
  OpState,
  UserLearningState,
} from './types';

export { labelApplicability, labelTableMeans, LABEL_ORDER } from './labels';
export {
  BASE_PRIOR,
  CATEGORY_ODDS,
  DIM_STRENGTH_SIGN,
  ENGINE_PRIOR,
  ENGINE_PRIOR_STRENGTH,
  OP_IMPL_VERSION,
  PIN_THETA,
  PRIOR_RELEASE,
  POPULATION_PRIOR,
  PRIOR_TABLE,
  needForOp,
  populationPrior,
  priorCentre,
} from './priors';
export type { DomainOpLocal } from './state';
export { emptyDomainState } from './state';

/** Integer day since epoch for a timestamp in ms. */
export function toDay(ms: number): Day {
  return Math.floor(ms / 86_400_000);
}

/** Exponential decay of counts to `now` with half-life K.H_DAYS. */
export function decay(c: Counts, now: Day): Counts {
  return decayCounts(c, now);
}

// ---------------------------------------------------------------------------
// Seeding from the fit profile
// ---------------------------------------------------------------------------

const EVIDENCE_SOURCES: ReadonlySet<ParamSource> = new Set([
  'measured',
  'stated',
  'override',
]);

/** The dimension of an op, or null for ops with a fixed or profile-derived level. */
export const opDim = (op: OpId): DimId | null => OP_CATALOG[op].dim;

/** Which dimension each op's intensity comes from (inverse of OP_CATALOG[op].dim). */
export const DIM_OP: Readonly<Record<DimId, OpId>> = Object.freeze(
  Object.fromEntries(
    OP_IDS.flatMap((op) =>
      OP_CATALOG[op].dim ? [[OP_CATALOG[op].dim, op]] : [],
    ),
  ) as Record<DimId, OpId>,
);

interface DimSeed {
  value: number;
  confidence: number;
  /** The seed is a calibration floor that implicit learning may not go below. */
  floor: boolean;
}

function dimSeeds(
  profile: FitProfile,
  needs: NeedLevels,
): Record<DimId, DimSeed> {
  const { vision, motor, attention } = profile;
  const textPx = vision.textMinPx.value;
  return {
    textPx: {
      value: textPx,
      confidence: vision.textMinPx.confidence,
      floor: EVIDENCE_SOURCES.has(vision.textMinPx.source),
    },
    // Zoom that brings 16 px body text up to the person's floor, within the reviewed range.
    zoom: {
      value: Math.min(2, Math.max(1, textPx / 16)),
      confidence: vision.textMinPx.confidence,
      floor: false,
    },
    lineHeight: {
      value: vision.lineHeight.value,
      confidence: vision.lineHeight.confidence,
      floor: false,
    },
    lineCh: {
      value: vision.maxLineCh.value,
      confidence: vision.maxLineCh.confidence,
      floor: false,
    },
    targetPx: {
      value: motor.minTargetPx.value,
      confidence: motor.minTargetPx.confidence,
      floor: EVIDENCE_SOURCES.has(motor.minTargetPx.source),
    },
    clickWindowMs: {
      value: motor.steadyClicks.value.windowMs,
      confidence: motor.steadyClicks.confidence,
      floor: false,
    },
    // Stronger dimming (lower opacity) the stronger the distraction need.
    dimOpacity: {
      value: 0.6 - 0.15 * needs.distraction,
      confidence: attention.distraction.confidence,
      floor: false,
    },
  };
}

function seedDim(dim: DimId, seed: DimSeed, day: Day): DimState {
  const sigma =
    SIGMA_CAL[dim] +
    (SIGMA_WIDE - SIGMA_CAL[dim]) * (1 - clamp01(seed.confidence));
  const vCal = sigma * sigma;
  const m = Math.log(Math.max(seed.value, 1e-6));
  const state: DimState = {
    m,
    v: vCal + LAB_TO_WILD ** 2,
    t: day,
    mCal: m,
    vCal,
  };
  if (seed.floor) state.floor = m;
  return state;
}

/**
 * Need levels backed by evidence. `needLevels` quantises every area, including
 * ones still at their defaults (an unmeasured flat attention prior can cross a
 * low threshold). An area counts only when something other than a default set
 * it: a measurement, a stated or override value, learning, or an OS setting.
 * This keeps a tier-0 person on population priors (personalization.md 9):
 * auto only from explicit OS settings, offers only with friction.
 */
export function evidenceNeeds(
  profile: FitProfile,
  needs: NeedLevels,
): NeedLevels {
  const { vision, motor, attention } = profile;
  const set = (source: ParamSource) => source !== 'default';
  const seen = (dim: { confidence: number; sources: readonly string[] }) =>
    dim.confidence > 0 || dim.sources.length > 0;
  const evidence: Record<keyof NeedLevels, boolean> = {
    text: set(vision.textMinPx.source),
    contrast: set(vision.contrastFloor.source),
    spacing:
      set(vision.lineHeight.source) ||
      set(vision.wordSpacingEm.source) ||
      seen(attention.chunking),
    lineLength: set(vision.maxLineCh.source) || seen(attention.density),
    targets: set(motor.minTargetPx.source),
    clicks:
      set(motor.steadyClicks.source) ||
      set(motor.repeatGuard.source) ||
      set(motor.hoverGraceMs.source),
    motion: attention.systemReducedMotion || seen(attention.motion),
    distraction: seen(attention.distraction),
  };
  const out = { ...needs };
  for (const area of Object.keys(evidence) as Array<keyof NeedLevels>)
    if (!evidence[area]) out[area] = 0;
  return out;
}

/**
 * Where an op's authority comes from for this profile:
 * - 'system' when an explicit OS setting asks for it (reduced motion -> calm_motion, pause_media);
 * - 'profile' when one of the op's areas has need >= 1 in a way its applicability can use
 *   (steady_clicks needs the steady-clicks setting on; menu_grace needs a hover grace);
 * - 'none' otherwise.
 */
export function profileSource(
  op: OpId,
  profile: FitProfile,
  needs: NeedLevels,
): OpState['src'] {
  if (
    (op === 'calm_motion' || op === 'pause_media') &&
    profile.attention.systemReducedMotion
  )
    return 'system';
  const backed = evidenceNeeds(profile, needs);
  if (op === 'steady_clicks')
    return backed.clicks >= 1 && profile.motor.steadyClicks.value.on
      ? 'profile'
      : 'none';
  if (op === 'menu_grace')
    return backed.clicks >= 1 && profile.motor.hoverGraceMs.value > 0
      ? 'profile'
      : 'none';
  if (
    op === 'contrast' &&
    profile.vision.contrastFloor.source === 'system' &&
    backed.contrast >= 1
  )
    return 'system';
  return needForOp(op, backed) >= 1 ? 'profile' : 'none';
}

/**
 * Fresh learning state seeded from a fit profile: op sources ('profile' when the
 * profile's need levels switch the op on, 'system' for OS preferences) and
 * Learner B dimensions centred on profile values (mCal/vCal from calibration confidence).
 */
export function initialLearningState(
  profile: FitProfile,
  needs: NeedLevels,
  now: Day,
): UserLearningState {
  const ops = {} as Record<OpId, OpState>;
  for (const op of OP_IDS)
    ops[op] = {
      ...defaultOpState(op, now),
      src: profileSource(op, profile, needs),
    };
  const seeds = dimSeeds(profile, evidenceNeeds(profile, needs));
  const dims = {} as Record<DimId, DimState>;
  for (const dim of DIM_IDS) dims[dim] = seedDim(dim, seeds[dim], now);
  return {
    v: 1,
    libVer: OP_LIBRARY_VERSION,
    priorRelease: PRIOR_RELEASE,
    ops,
    dims,
    labels: {},
  };
}

/**
 * Re-seed an existing state after recalibration: keep counts, reset dimension means
 * toward the new calibration with its confidence, keep user blocks/pins.
 *
 * Following personalization.md 8: counts are kept at half weight (calibration
 * is newer evidence), each dimension moves to the new calibration plus half
 * of the learned deviation from the old one, variance resets to the new prior.
 */
export function reseedFromProfile(
  state: UserLearningState,
  profile: FitProfile,
  needs: NeedLevels,
  now: Day,
): UserLearningState {
  const fresh = initialLearningState(profile, needs, now);
  const out = cloneJson(state);
  out.libVer = OP_LIBRARY_VERSION;
  out.priorRelease = PRIOR_RELEASE;
  out.labels ??= {};
  for (const op of OP_IDS) {
    const prev = out.ops[op];
    if (!prev) {
      out.ops[op] = fresh.ops[op];
      continue;
    }
    const c = decayCounts(prev.c, now);
    prev.c = { s: c.s * 0.5, f: c.f * 0.5, t: c.t };
    if (prev.src !== 'pinned') prev.src = fresh.ops[op].src;
  }
  for (const dim of DIM_IDS) {
    const next = fresh.dims[dim];
    const prev = out.dims[dim];
    if (!prev) {
      out.dims[dim] = next;
      continue;
    }
    const deviation = prev.m - prev.mCal;
    const updated: DimState = {
      m: next.mCal + 0.5 * deviation,
      v: next.v,
      t: now,
      mCal: next.mCal,
      vCal: next.vCal,
    };
    if (next.floor !== undefined) updated.floor = next.floor;
    out.dims[dim] = updated;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Learner A: desirability
// ---------------------------------------------------------------------------

export interface DesirabilityContext {
  needs: NeedLevels;
  category: PageCategory;
  /** Calibration confidence, or null for an uncalibrated (tier 0) person. */
  profileConfidence: number | null;
}

/**
 * Beta prior for an op: centre p0 from the reviewed table, strength m0 = 4 + 6c.
 * Uncalibrated (tier 0): m0 = 2 and the population centre, unless an OS setting
 * or stated value already gives the op a need (then the need row applies).
 */
export function priorFor(
  op: OpId,
  ctx: DesirabilityContext,
): { a0: number; b0: number } {
  const tier0 = ctx.profileConfidence === null;
  const p0 =
    tier0 && needForOp(op, ctx.needs) === 0
      ? populationPrior(op, ctx.category)
      : priorCentre(op, ctx.needs, ctx.category);
  const m0 = tier0
    ? K.TIER0_M0
    : K.M0_BASE + K.M0_CONF * clamp01(ctx.profileConfidence ?? 0);
  return { a0: m0 * p0, b0: m0 * (1 - p0) };
}

/** Learner A: posterior mean desirability, personal and shrunk-to-domain (personalization.md 3, 11). */
export function desirability(
  u: UserLearningState,
  d: DomainState | undefined,
  op: OpId,
  ctx: DesirabilityContext,
  now: Day,
): { personal: number; mean: number } {
  const { a0, b0 } = priorFor(op, ctx);
  const P = decayCounts(u.ops[op]?.c ?? zeroCounts(now), now);
  const aP = a0 + P.s;
  const bP = b0 + P.f;
  const personal = aP / (aP + bP);
  const dop = d?.ops[op];
  const D = dop ? decayCounts(dop, now) : undefined;
  if (!D || D.s + D.f < 1e-6) return { personal, mean: personal };
  // Leave-one-out personal mean: the domain's own evidence is not counted twice.
  const aL = a0 + Math.max(0, P.s - D.s);
  const bL = b0 + Math.max(0, P.f - D.f);
  const pL = aL / (aL + bL);
  return { personal, mean: shrinkToDomain(pL, D) };
}

/** Domain posterior mean: kappa pseudo-observations at the (personal) centre plus the site's own counts. */
export function shrinkToDomain(centre: number, D: Counts): number {
  const a = K.KAPPA * centre + D.s;
  const b = K.KAPPA * (1 - centre) + D.f;
  return a / (a + b);
}

/** Desirability of a pinned op: PIN_THETA personally, demoted on a site only by that site's own undos. */
export function pinnedDesirability(
  d: DomainState | undefined,
  op: OpId,
  now: Day,
): number {
  const dop = d?.ops[op];
  const D = dop ? decayCounts(dop, now) : undefined;
  if (!D || D.s + D.f < 1e-6) return PIN_THETA;
  return shrinkToDomain(PIN_THETA, D);
}

// ---------------------------------------------------------------------------
// Engine channel
// ---------------------------------------------------------------------------

/** Engine reliability on this site from the verifier channel (never preference). */
export function engineReliability(
  d: DomainState | undefined,
  op: OpId,
  category: PageCategory,
  now: Day,
): number {
  const dop = d?.ops[op];
  if (dop?.skipUntil !== undefined && dop.skipUntil >= now) return 0;
  return verifierPassRate(d, op, category, now);
}

/** The engine Beta posterior mean alone, ignoring any skip window. */
export function verifierPassRate(
  d: DomainState | undefined,
  op: OpId,
  category: PageCategory,
  now: Day,
): number {
  const dop = d?.ops[op];
  const g = ENGINE_PRIOR[op][category];
  const e = dop?.e ? decayCounts(dop.e, now) : zeroCounts(now);
  return (g.a + e.s) / (g.a + g.b + e.s + e.f);
}

/**
 * True while a "Not now" on this site snoozes the op's offer (7 days). The
 * spec keeps one `skipUntil` for both the snooze and the engine gate; the
 * local `engineUntil` marker tells them apart. A snooze silences offers only.
 */
export function offerSnoozed(
  d: DomainState | undefined,
  op: OpId,
  now: Day,
): boolean {
  const dop = d?.ops[op];
  return (
    dop?.skipUntil !== undefined &&
    dop.skipUntil >= now &&
    !engineSkipped(d, op, now)
  );
}

/** True when a fast or "don't want" undo on this site demoted the op to offers here. */
export function demotedHere(d: DomainState | undefined, op: OpId): boolean {
  return (d?.ops[op] as DomainOpLocal | undefined)?.demoted === true;
}

/** True when the op is paused on this site because the verifier rejected it twice within a week. */
export function engineSkipped(
  d: DomainState | undefined,
  op: OpId,
  now: Day,
): boolean {
  const dop = d?.ops[op] as DomainOpLocal | undefined;
  return dop?.engineUntil !== undefined && dop.engineUntil >= now;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Undo weight by time since the change became visible (personalization.md 4). */
export function undoWeight(dtApplyMs: number | undefined): number {
  if (dtApplyMs === undefined || !Number.isFinite(dtApplyMs)) return W.undoMed;
  if (dtApplyMs < K.UNDO_FAST_MS) return W.undoFast;
  if (dtApplyMs < K.UNDO_MED_MS) return W.undoMed;
  return W.undoLate;
}

/** Natural value of an op's level (the reviewed ladder), clamped into range. */
export function levelValue(op: OpId, level: number | undefined): number {
  const levels = OP_CATALOG[op].levels;
  const i = Math.max(0, Math.min(levels.length - 1, Math.round(level ?? 0)));
  return levels[i] ?? levels[0] ?? 1;
}

/** Convert a direction in level-index terms (+1 = next, stronger level) to natural-value terms. */
function valueDirection(dim: DimId, indexDir: 1 | -1): 1 | -1 {
  return DIM_STRENGTH_SIGN[dim] > 0 ? indexDir : indexDir === 1 ? -1 : 1;
}

const MAX_EXCEPTIONS = 500;
const LABEL_SUCCESS_KEEP_MS = 300_000;
const SILENCE_DWELL_MS = 60_000;

class EventContext {
  readonly deltas: LearnDelta[] = [];
  private n = 0;
  private readonly idBase: string;

  constructor(
    readonly u: UserLearningState,
    readonly d: DomainState,
    readonly ev: AdaptEvent,
    readonly day: Day,
  ) {
    const safe =
      String(ev.id)
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 56) || 'event';
    this.idBase = safe.length >= 6 ? safe : `ev-${safe.padEnd(4, '0')}`;
  }

  private push(delta: Omit<LearnDelta, 'v' | 'deltaId' | 'day'>): void {
    this.deltas.push({
      v: 1,
      deltaId: `${this.idBase}:${this.n}`,
      day: this.day,
      ...delta,
    });
    this.n += 1;
  }

  /** Learner A credit to personal (scaled) and domain counts, with a domain-free delta. */
  credit(s: number, f: number, personalScale = 1): void {
    if (s <= 0 && f <= 0) return;
    const op = this.ev.op;
    const o = ensureOp(this.u, op, this.day);
    o.c = addCounts(o.c, s * personalScale, f * personalScale, this.day);
    const dop = ensureDomainOp(this.d, op, this.day);
    Object.assign(dop, addCounts(dop, s, f, this.day));
    const ds = s * personalScale;
    const df = f * personalScale;
    this.push({ op, ...(ds > 0 ? { ds } : {}), ...(df > 0 ? { df } : {}) });
  }

  /** Local-only reversal of an earlier credit (the synced delta cannot be negative). */
  uncredit(s: number, f: number): void {
    const op = this.ev.op;
    const o = ensureOp(this.u, op, this.day);
    o.c = subtractCounts(o.c, s, f, this.day);
    const dop = ensureDomainOp(this.d, op, this.day);
    Object.assign(dop, subtractCounts(dop, s, f, this.day));
  }

  label(label: AnalysisLabel, s: number, f: number): void {
    if (s <= 0 && f <= 0) return;
    const op = this.ev.op;
    const byLabel = (this.u.labels[op] ??= {
      clear: zeroCounts(this.day),
      likely: zeroCounts(this.day),
      unsure: zeroCounts(this.day),
    });
    byLabel[label] = addCounts(byLabel[label], s, f, this.day);
    this.push({ label: { op, label, s, f } });
  }

  unlabel(label: AnalysisLabel, s: number, f: number): void {
    const byLabel = this.u.labels[this.ev.op];
    if (!byLabel) return;
    byLabel[label] = subtractCounts(byLabel[label], s, f, this.day);
  }

  opFlags(flags: Pick<LearnDelta, 'accepts' | 'src' | 'blocked'>): void {
    this.push({ op: this.ev.op, ...flags });
  }

  observation(dim: DimId, obs: NonNullable<LearnDelta['obs']>): void {
    this.push({ dim, obs });
  }
}

function engineOutcome(ctx: EventContext, pass: boolean): void {
  const { d, ev, day } = ctx;
  const dop = ensureDomainOp(d, ev.op, day);
  if (pass) {
    if (dop.passDay === day) return; // at most one pass credit per (op, site, day)
    dop.passDay = day;
    dop.e = addCounts(dop.e ?? zeroCounts(day), 1, 0, day);
    return;
  }
  dop.e = addCounts(dop.e ?? zeroCounts(day), 0, 1, day);
  const recent = (dop.rejects ?? []).filter((r) => r > day - K.ENGINE_WINDOW_D);
  recent.push(day);
  if (recent.length >= K.ENGINE_REJECTS) {
    dop.skipUntil = Math.max(dop.skipUntil ?? -Infinity, day + K.ENGINE_SKIP_D);
    dop.engineUntil = day + K.ENGINE_SKIP_D;
    delete dop.rejects;
  } else {
    dop.rejects = recent;
  }
}

/** Learner B update for an episode or chip, in natural units, with a domain offset (7.4). */
function kalmanFromEvent(
  ctx: EventContext,
  dim: DimId,
  naturalValue: number,
): void {
  const { u, d, day } = ctx;
  const current = u.dims[dim] ?? neutralDim(naturalValue, day);
  const predicted = predictDim(current, day, LAB_TO_WILD);
  const offset = (d.dims[dim] ??= { d: 0, v: K.DOMAIN_TAU ** 2 });
  const z = Math.log(Math.max(naturalValue, 1e-6));
  const result = kalmanPointMath(predicted, z, K.R, offset);
  u.dims[dim] = result.dim;
  if (result.offset) d.dims[dim] = result.offset;
  ctx.observation(dim, {
    kind: 'point',
    value: z - (result.offset?.d ?? 0),
    r: K.R,
  });
}

function probitFromEvent(
  ctx: EventContext,
  dim: DimId,
  naturalAt: number,
  valueDir: 1 | -1,
): void {
  const { u, d, day } = ctx;
  const current = u.dims[dim] ?? neutralDim(naturalAt, day);
  const predicted = predictDim(current, day, LAB_TO_WILD);
  const off = d.dims[dim]?.d ?? 0;
  const c = Math.log(Math.max(naturalAt, 1e-6));
  u.dims[dim] = probitUpdate(predicted, c, valueDir, K.R, off);
  ctx.observation(dim, {
    kind: valueDir > 0 ? 'gt' : 'lt',
    value: c - off,
    r: K.R,
  });
}

/** The default preference and label credit for an undo with no reason chip (personalization.md 4; ai-architecture.md 10). */
function defaultUndoCredit(ev: AdaptEvent): { a: number; label: number } {
  const w = undoWeight(ev.dtApplyMs);
  const split =
    ev.aiLabel !== undefined &&
    OP_CATALOG[ev.op].usesPageAnalysis &&
    w === W.undoFast;
  // A fast undo of a page-analysis target is ambiguous: half preference, half wrong target.
  return split ? { a: 0.5 * w, label: 0.5 * w } : { a: w, label: 0 };
}

function routeReason(
  ctx: EventContext,
  reason: NonNullable<AdaptEvent['reason']>,
  prior: { a: number; label: number },
): void {
  const { d, ev } = ctx;
  // Only "don't want" is a preference; any demotion from the default undo is lifted for the other reasons.
  if (reason !== 'dont_want') delete ensureDomainOp(d, ev.op, ctx.day).demoted;
  switch (reason) {
    case 'dont_want': {
      // Explicit judgement: preference F totals 1.0; any label share moves back to preference.
      if (prior.label > 0 && ev.aiLabel)
        ctx.unlabel(ev.aiLabel, 0, prior.label);
      ctx.credit(0, Math.max(0, W.explicitNeg - prior.a));
      ensureDomainOp(d, ev.op, ctx.day).demoted = true;
      return;
    }
    case 'too_much':
    case 'too_little': {
      // Intensity, not preference.
      ctx.uncredit(0, prior.a);
      if (prior.label > 0 && ev.aiLabel)
        ctx.unlabel(ev.aiLabel, 0, prior.label);
      const dim = opDim(ev.op);
      if (!dim) return;
      const indexDir: 1 | -1 = reason === 'too_much' ? -1 : 1;
      probitFromEvent(
        ctx,
        dim,
        levelValue(ev.op, ev.level),
        valueDirection(dim, indexDir),
      );
      return;
    }
    case 'broke_page': {
      // Engine failure: never preference, never the label table.
      ctx.uncredit(0, prior.a);
      if (prior.label > 0 && ev.aiLabel)
        ctx.unlabel(ev.aiLabel, 0, prior.label);
      engineOutcome(ctx, false);
      return;
    }
    case 'needed_that': {
      // A wrong target, not a preference: label table F and a component exception.
      ctx.uncredit(0, prior.a);
      if (ev.aiLabel)
        ctx.label(ev.aiLabel, 0, Math.max(0, W.explicitNeg - prior.label));
      if (ev.componentKey) {
        const list = (d.exceptions ??= []);
        if (!list.includes(ev.componentKey)) {
          list.push(ev.componentKey);
          if (list.length > MAX_EXCEPTIONS)
            list.splice(0, list.length - MAX_EXCEPTIONS);
        }
      }
      return;
    }
  }
}

/**
 * Apply one local event to personal + domain state (personalization.md 4, 11 onEvent).
 * Returns domain-free deltas to queue for sync.
 *
 * Routing: preference (Learner A), intensity (Learner B), the label table,
 * component exceptions, hard rules, or the engine channel, one target per
 * signal. Verifier outcomes touch only the engine channel. Inputs are not
 * mutated.
 *
 * Undo reason chips: prefer sending one 'undo' event that already carries
 * `reason` (the SW can hold the undo for the chip's 8 s window). A separate
 * 'undo_reason' event must repeat the undo's `dtApplyMs` and `aiLabel`; its
 * reversal of the default undo credit is exact locally, but a delta that was
 * already queued cannot be withdrawn (deltas are non-negative G-counters).
 */
export function applyEvent(
  u: UserLearningState,
  d: DomainState,
  ev: AdaptEvent,
): { user: UserLearningState; domain: DomainState; deltas: LearnDelta[] } {
  const user = cloneJson(u);
  user.labels ??= {};
  const domain = cloneJson(d ?? emptyDomainState(toDay(ev.t)));
  const day = toDay(ev.t);
  if (!isOpId(ev.op)) return { user, domain, deltas: [] };

  domain.t = Math.max(domain.t ?? day, day);
  const ctx = new EventContext(user, domain, ev, day);
  const o = ensureOp(user, ev.op, day);

  // Library change: an op's implementation changed materially -> halve its counts.
  if (Number.isFinite(ev.opVer) && ev.opVer > o.opVer) {
    const c = decayCounts(o.c, day);
    o.c = { s: c.s * 0.5, f: c.f * 0.5, t: c.t };
    o.opVer = ev.opVer;
  }

  switch (ev.kind) {
    case 'applied':
    case 'offered':
    case 'offer_ignored':
    case 'intensity_change':
      // No learning: exposure is not evidence, ignoring an offer is not a negative,
      // and intensity bursts are learned once per episode.
      break;

    case 'rating':
      if (ev.rating === 'helped') {
        ctx.credit(W.explicitPos, 0);
        delete ensureDomainOp(domain, ev.op, day).demoted;
      } else if (ev.rating === 'not_helped') {
        ctx.credit(0, W.explicitNeg);
      }
      break;

    case 'undo': {
      ensureDomainOp(domain, ev.op, day).sessionOff = ev.tabSession;
      if (ev.reason) {
        routeReason(ctx, ev.reason, { a: 0, label: 0 });
        break;
      }
      const credit = defaultUndoCredit(ev);
      ctx.credit(0, credit.a);
      if (credit.label > 0 && ev.aiLabel)
        ctx.label(ev.aiLabel, 0, credit.label);
      if (undoWeight(ev.dtApplyMs) === W.undoFast)
        ensureDomainOp(domain, ev.op, day).demoted = true;
      break;
    }

    case 'undo_reason': {
      if (!ev.reason) break;
      ensureDomainOp(domain, ev.op, day).sessionOff = ev.tabSession;
      routeReason(ctx, ev.reason, defaultUndoCredit(ev));
      break;
    }

    case 'episode_end': {
      const abandoned =
        ev.kept === false || (ev.toLevel !== undefined && ev.toLevel < 0);
      if (abandoned) {
        // Turned off: an undo timed from the first action of the episode.
        const dop = ensureDomainOp(domain, ev.op, day);
        dop.sessionOff = ev.tabSession;
        ctx.credit(0, undoWeight(ev.dtApplyMs));
        if (undoWeight(ev.dtApplyMs) === W.undoFast) dop.demoted = true;
        break;
      }
      const dim = opDim(ev.op);
      if (!dim) break;
      const settled =
        ev.settledValue ??
        (ev.toLevel !== undefined ? levelValue(ev.op, ev.toLevel) : undefined);
      if (
        (ev.keptMs ?? 0) >= K.SETTLE_KEEP_MS &&
        settled !== undefined &&
        settled > 0
      ) {
        kalmanFromEvent(ctx, dim, settled);
        ctx.credit(W.adjustKeep, 0);
      } else if (ev.dir === 1 || ev.dir === -1) {
        // Cut short: one censored observation relative to the starting value.
        probitFromEvent(
          ctx,
          dim,
          levelValue(ev.op, ev.fromLevel ?? ev.level),
          valueDirection(dim, ev.dir),
        );
      }
      break;
    }

    case 'offer_accepted':
      o.accepts += 1;
      o.dismissStreak = 0;
      delete ensureDomainOp(domain, ev.op, day).demoted;
      ctx.opFlags({ accepts: 1 });
      // Preference credit comes at session end if the change was kept.
      break;

    case 'offer_dismissed': {
      ctx.credit(0, W.dismiss);
      const dop = ensureDomainOp(domain, ev.op, day);
      dop.skipUntil = Math.max(
        dop.skipUntil ?? -Infinity,
        day + K.DISMISS_COOLDOWN_D,
      );
      o.dismissStreak += 1;
      if (o.dismissStreak >= K.DISMISS_STREAK) {
        o.offerCooldownUntil = Math.max(
          o.offerCooldownUntil,
          day + K.GLOBAL_COOLDOWN_D,
        );
        o.dismissStreak = 0;
      }
      break;
    }

    case 'session_end': {
      if (ev.kept !== true) break;
      const kept = ev.keptMs;
      if (
        ev.acceptedThisSession &&
        (kept === undefined || kept >= K.SETTLE_KEEP_MS)
      ) {
        ctx.credit(W.acceptKept, 0);
      } else if (
        ev.autoApplied &&
        ev.visibleEffect &&
        (kept === undefined || kept >= SILENCE_DWELL_MS)
      ) {
        domain.silenceDay ??= {};
        if (domain.silenceDay[ev.op] !== day) {
          domain.silenceDay[ev.op] = day;
          ctx.credit(W.silence, 0);
        }
      }
      // Label outcome: kept >= 5 min with no negative chip (ai-architecture.md 10).
      if (ev.aiLabel && kept !== undefined && kept >= LABEL_SUCCESS_KEEP_MS)
        ctx.label(ev.aiLabel, 1, 0);
      break;
    }

    case 'manual_on':
      if (o.blocked) {
        delete o.blocked;
        ctx.opFlags({ blocked: false });
      }
      ctx.credit(W.manualOn, 0);
      delete ensureDomainOp(domain, ev.op, day).demoted;
      break;

    case 'site_disable': {
      ensureDomainOp(domain, ev.op, day).block = true;
      ctx.credit(
        0,
        W.siteBlockDomainF,
        W.siteBlockPersonalF / W.siteBlockDomainF,
      );
      break;
    }

    case 'site_enable': {
      const dop = domain.ops[ev.op];
      if (dop) delete dop.block;
      break;
    }

    case 'global_disable':
      if (!o.blocked) {
        o.blocked = true;
        ctx.opFlags({ blocked: true });
      }
      break;

    case 'promotion_answer':
      if (ev.answer === 'yes') {
        o.src = 'pinned';
        ctx.opFlags({ src: 'pinned' });
      } else if (ev.answer === 'no') {
        o.askAfter = Math.max(o.askAfter, day + K.ASK_COOLDOWN_D);
      }
      break;

    case 'verifier':
      // Engine facts only: never preference, never the label table, never synced.
      engineOutcome(ctx, ev.pass === true);
      break;
  }

  return { user, domain, deltas: ctx.deltas };
}

/**
 * Whether to ask "Always do this?" now (personalization.md 5.2): the op is not
 * already auto-eligible, personal desirability >= 0.70, at least 3 accepts,
 * and no ask in the last 60 days. The caller also checks the accepts came from
 * at least 2 sites and counts the question against the offer budget.
 */
export function promotionDue(
  u: UserLearningState,
  op: OpId,
  ctx: DesirabilityContext,
  now: Day,
): boolean {
  const o = u.ops[op];
  if (!o || o.blocked || o.src !== 'none') return false;
  if (o.accepts < K.MIN_ACCEPTS || now < o.askAfter) return false;
  return desirability(u, undefined, op, ctx, now).personal >= K.TAU_PROMOTE;
}

// ---------------------------------------------------------------------------
// Learner B: intensity
// ---------------------------------------------------------------------------

/** Learner B: nearest reviewed level for an op with hysteresis (personalization.md 7.5). */
export function chooseLevel(
  u: UserLearningState,
  d: DomainState | undefined,
  op: OpId,
  currentLevel: number | null,
  now: Day,
): number {
  const levels = OP_CATALOG[op].levels;
  const clampLevel = (l: number) =>
    Math.max(0, Math.min(levels.length - 1, Math.round(l)));
  const dim = opDim(op);
  const s = dim ? u.dims[dim] : undefined;
  if (!dim || !s) return clampLevel(currentLevel ?? 0);
  void now;
  const dom = d?.dims[dim];
  const off = dom && dom.v < 0.7 * K.DOMAIN_TAU ** 2 ? dom.d : 0;
  let target = s.m + off;
  // Safety floor: implicit learning never goes below the calibration floor.
  if (s.floor !== undefined && DIM_STRENGTH_SIGN[dim] > 0)
    target = Math.max(target, s.floor);
  const best = nearestLevel(op, Math.exp(target));
  if (currentLevel === null || !Number.isFinite(currentLevel)) return best;
  const cur = clampLevel(currentLevel);
  const dist = (i: number) => Math.abs(Math.log(levels[i]!) - target);
  return dist(best) + K.HYST < dist(cur) ? best : cur;
}

/** Learner B estimate for a dimension in natural units (e.g. 18.4 px). */
export function dimensionEstimate(
  u: UserLearningState,
  dim: DimId,
): { value: number; sd: number } {
  const s = u.dims[dim];
  if (!s) return { value: Number.NaN, sd: Number.NaN };
  const value = Math.exp(s.m);
  return { value, sd: value * Math.sqrt(Math.max(0, s.v)) };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Merge domain-free deltas into canonical state (G-counter for counts; Kalman
 * observations replayed in day order). Idempotent: deltas already applied
 * (by deltaId) are ignored. Used by the extension before pushing with
 * optimistic concurrency. Pass this device's `local` state to carry over its
 * non-additive bookkeeping (cooldowns, ask dates) with max semantics.
 */
export function mergeDeltas(
  base: UserLearningState,
  deltas: readonly LearnDelta[],
  applied: ReadonlySet<string>,
  local?: UserLearningState,
): UserLearningState {
  return mergeLearningDeltas(base, deltas, applied, local);
}
