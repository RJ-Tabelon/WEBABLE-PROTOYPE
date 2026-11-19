import { ruleVerdict, isFeedLike } from '../decide/verdict';
import {
  chooseLevel,
  demotedHere,
  desirability,
  engineReliability,
  evidenceNeeds,
  levelValue,
  offerSnoozed,
  pinnedDesirability,
  toDay,
  verifierPassRate,
} from '../learning/learners';
import { labelApplicability } from '../learning/labels';
import { clamp01, decayCounts, logit, sigmoid } from '../learning/math';
import { FRICTION_LR, K } from '../learning/params';
import type {
  DomainState,
  SiteRule,
  UserLearningState,
} from '../learning/types';
import {
  OP_CATALOG,
  OP_IDS,
  RETIRED_OPS,
  nearestLevel,
  type OpId,
} from '../ops/catalog';
import {
  DIMMABLE_ROLES,
  type PageSignals,
  type RegionRole,
} from '../page/types';
import type { FitProfile, NeedLevels } from '../profile/schema';
import { TEXT_RESIDUAL_MIN } from '../triage/triage';
import type { TriageKind, TriageNeed, TriageVerdict } from '../triage/types';
import {
  autoplaySources,
  contrastFailures,
  LINE_HEIGHT_SLACK,
  LINE_LENGTH_SLACK_CH,
  MIN_REGION_AREA_PCT,
  motionSources,
  READING_GUIDE_MIN_CHARS,
  SMALL_TEXT_MIN_SHARE,
  smallText,
  STICKY_BAND_SHARE,
  stickyBandShare,
  targetKey,
  targetsBelow,
} from './measure';
import type {
  AdaptationPlan,
  DecisionMode,
  DecisionSource,
  DecisionTrace,
  PlannedOp,
  RegionVerdict,
  TraceEvidence,
} from './types';

export * from './measure';

export interface PolicyInput {
  profile: FitProfile;
  needs: NeedLevels;
  signals: PageSignals;
  /** Region verdicts from local rules and (cached or fresh) page analysis. */
  verdicts: Record<string, RegionVerdict>;
  learning: UserLearningState;
  domain: DomainState | undefined;
  site: SiteRule | undefined;
  /** Friction likelihood ratios observed on this page for specific ops. */
  friction: Partial<Record<OpId, number>>;
  /** Offers already shown today and on this page (budget). */
  offersToday: number;
  offersThisPage: number;
  tabSession: string;
  now: number;
  /** Profile calibration confidence, null when uncalibrated. */
  profileConfidence: number | null;
  /**
   * Triage for this page view (docs/10 §3). With it, page_zoom applies
   * triage's page scale, text_floor carries the residual, and a need that
   * fits gets no automatic change. Without it the v1 rules apply and the tab
   * is never scaled.
   */
  triage?: TriageVerdict;
  /**
   * WebAble's page scale in effect when the signals were read (1 = none, as
   * TriageInput.scale). A repeat visit is read with its scale already on, so
   * viewport shares are taken back to 100% before the plan's scale applies.
   */
  scale?: number;
}

// ---------------------------------------------------------------------------
// Triage (docs/10 §3.2, §5.1-5.2)
// ---------------------------------------------------------------------------

/** The triage need each op serves. Ops not listed keep the v1 rules. */
const OP_NEED: Readonly<Partial<Record<OpId, TriageNeed>>> = {
  text_floor: 'text',
  page_zoom: 'text',
  target_size: 'targets',
  target_spacing: 'targets',
  dim_distractions: 'clutter',
  focus_view: 'clutter',
  unpin_bars: 'occlusion',
  contrast: 'contrast',
  calm_motion: 'motion',
  pause_media: 'motion',
};

/** Needs measured only from layout features: without them (an older engine) these ops keep the v1 rules. */
const LAYOUT_NEEDS: ReadonlySet<TriageNeed> = new Set<TriageNeed>([
  'clutter',
  'occlusion',
]);

/** Triage's band for the need an op serves, or null when triage does not gate the op. */
export function triageBand(op: OpId, input: PolicyInput): TriageKind | null {
  const need = OP_NEED[op];
  if (!input.triage || !need) return null;
  if (LAYOUT_NEEDS.has(need) && !input.signals.layout) return null;
  return input.triage.needs[need];
}

/** The person's own zoom (tab zoom without WebAble's page scale, times pinch), as the worker reports it. */
function ownZoom(signals: PageSignals): number {
  const z = signals.viewport.zoom;
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** A level the person set for this op (on this site, or for every site). */
const manualLevel = (op: OpId, input: PolicyInput): boolean =>
  Number.isFinite(input.site?.levels[op]);

/**
 * The page scale this plan applies: page_zoom's level when it is decided
 * automatically, else 1 (an offered scale is not in effect until accepted).
 * text_floor carries the residual against it, and target sizes are compared
 * at the CSS size that reaches the person's size at this scale.
 */
export function zoomInEffect(input: PolicyInput): number {
  if (!input.triage) return 1;
  const planned = decideDetailed('page_zoom', input).planned;
  return planned?.mode === 'auto' ? levelValue('page_zoom', planned.level) : 1;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/**
 * The level an op would run at: the person's manual level for this site, else
 * a profile-derived level for ops without a learned dimension, else Learner B.
 */
export function levelFor(op: OpId, input: PolicyInput): number {
  const levels = OP_CATALOG[op].levels;
  const clampLevel = (l: number) =>
    Math.max(0, Math.min(levels.length - 1, Math.round(l)));
  const manual = input.site?.levels[op];
  if (manual !== undefined && Number.isFinite(manual))
    return clampLevel(manual);
  switch (op) {
    case 'contrast':
      return nearestLevel('contrast', input.profile.vision.contrastFloor.value);
    case 'target_spacing':
      return clampLevel(evidenceNeeds(input.profile, input.needs).targets);
    case 'menu_grace':
      return input.profile.motor.hoverGraceMs.value >= 700 ? 1 : 0;
    case 'page_zoom':
      // Triage chose the scale for this page view; Learner B's zoom only fills in without one.
      if (input.triage && input.triage.zoom > 1)
        return nearestLevel('page_zoom', input.triage.zoom);
      break;
  }
  return chooseLevel(input.learning, input.domain, op, null, toDay(input.now));
}

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

export interface Applicability {
  /** A in [0, 1]: does this page have something this op should act on? */
  a: number;
  /** Component keys to target for region-scoped ops, strongest first. */
  regions: string[];
  evidence: TraceEvidence[];
  /** A per targeted region (region ops only). */
  perRegion: Record<string, number>;
}

const NONE: Applicability = { a: 0, regions: [], evidence: [], perRegion: {} };
const page = (evidence: TraceEvidence[]): Applicability => ({
  a: 1,
  regions: [],
  evidence,
  perRegion: {},
});

type SignalRegion = PageSignals['regions'][number];

/** Regions WebAble may never target: focus inside, required fields, or the main content itself. */
function untouchable(region: SignalRegion, signals: PageSignals): boolean {
  return (
    region.containsFocus ||
    region.hasRequiredFields ||
    region.key === signals.main.key
  );
}

function verdictFor(
  region: SignalRegion,
  input: PolicyInput,
): RegionVerdict | null {
  return input.verdicts[region.key] ?? ruleVerdict(region);
}

/** A confident main-content region (landmark, single article, readability or a clear page-analysis pick). */
function confidentMain(signals: PageSignals): string | null {
  return signals.main.key !== null && !signals.main.ambiguous
    ? signals.main.key
    : null;
}

function dimApplicability(input: PolicyInput): Applicability {
  const { signals, learning, domain } = input;
  const day = toDay(input.now);
  const exceptions = new Set(domain?.exceptions ?? []);
  const perRegion: Record<string, number> = {};
  const evidence: TraceEvidence[] = [];
  const found: Array<{ key: string; a: number; ev: TraceEvidence }> = [];

  for (const region of signals.regions) {
    if (untouchable(region, signals) || exceptions.has(region.key)) continue;
    if (region.areaPct < MIN_REGION_AREA_PCT && region.pinned === 'no')
      continue;
    const v = verdictFor(region, input);
    if (!v || v.protected || v.label === null || v.role === null) continue;
    const role: RegionRole = v.role;
    if (!DIMMABLE_ROLES.includes(role)) continue;
    // Feeds and search results: recommendations are the content, and the centre column is protected.
    if (
      isFeedLike(signals.category) &&
      (role === 'recommendations' || region.zone === 'center_column')
    )
      continue;
    const a =
      v.source === 'rule'
        ? clamp01(v.pEligible)
        : labelApplicability(learning, 'dim_distractions', v.label, day);
    if (!(a > 0)) continue;
    found.push({
      key: region.key,
      a,
      ev:
        v.source === 'rule'
          ? { kind: 'region_role', role, by: 'rule' }
          : { kind: 'region_role', role, by: 'page_analysis', label: v.label },
    });
  }
  if (found.length === 0) return NONE;
  found.sort((x, y) => y.a - x.a);
  for (const f of found) perRegion[f.key] = f.a;
  for (const f of found) evidence.push(f.ev);
  return {
    a: found[0]!.a,
    regions: found.map((f) => f.key),
    evidence,
    perRegion,
  };
}

function focusViewApplicability(input: PolicyInput): Applicability {
  const { signals } = input;
  const main = confidentMain(signals);
  if (main === null) return NONE;
  const others = signals.regions.filter((r) => r.key !== main);
  // Focus view softens everything else: never while focus or required fields sit outside main.
  if (others.some((r) => r.containsFocus || r.hasRequiredFields)) return NONE;
  if (!others.some((r) => r.areaPct >= MIN_REGION_AREA_PCT)) return NONE;
  const mainVerdict = input.verdicts[main];
  const by = mainVerdict?.source === 'page_analysis' ? 'page_analysis' : 'rule';
  return {
    a: 1,
    regions: [main],
    evidence: [{ kind: 'region_role', role: 'main_content', by }],
    perRegion: { [main]: 1 },
  };
}

function unpinApplicability(input: PolicyInput): Applicability {
  const { signals } = input;
  // Pinned bars grow with the page scale while the screen keeps its size.
  if (
    stickyBandShare(signals, zoomInEffect(input), input.scale) <=
    STICKY_BAND_SHARE
  )
    return NONE;
  const perRegion: Record<string, number> = {};
  const found: Array<{ key: string; a: number; by: 'rule' | 'page_analysis' }> =
    [];
  for (const region of signals.regions) {
    if (region.pinned === 'no' || untouchable(region, signals)) continue;
    if (region.zone !== 'header_band' && region.zone !== 'overlay_top')
      continue;
    const v = verdictFor(region, input);
    // Only navigation bars scroll away; consent, chat and everything else stays pinned (3.5, 3.7).
    if (!v || v.role !== 'navigation') continue;
    const a =
      v.source === 'rule'
        ? clamp01(Math.max(v.pEligible, region.rulePrecision))
        : 0.8;
    found.push({ key: region.key, a, by: v.source });
  }
  if (found.length === 0) return NONE;
  found.sort((x, y) => y.a - x.a);
  for (const f of found) perRegion[f.key] = f.a;
  return {
    a: found[0]!.a,
    regions: found.map((f) => f.key),
    evidence: [
      {
        kind: 'sticky_bars',
        count: Math.max(signals.sticky.bars, found.length),
        heightPx: Math.round(signals.sticky.topBandPx),
      },
      { kind: 'region_role', role: 'navigation', by: found[0]!.by },
    ],
    perRegion,
  };
}

function textFloorPx(input: PolicyInput): number {
  return levelValue('text_floor', levelFor('text_floor', input));
}

/**
 * text_floor with triage: running text in main goes to the level (effective
 * px) only where the page scale in effect leaves it short by more than
 * TEXT_RESIDUAL_MIN. The level never changes with the zoom; the engine aims
 * at level / (the person's own zoom x the page scale) CSS px
 * (AdaptationPlan.ownZoom x zoom).
 */
function textFloorWithTriage(
  input: PolicyInput,
  t: TriageVerdict,
): Applicability {
  if (t.k === null || !(t.k > 0)) return NONE;
  const floorPx = textFloorPx(input);
  const zoom = zoomInEffect(input);
  // Running text as the person sees it at their own zoom (k = textMinPx / this).
  const runningPx = input.profile.vision.textMinPx.value / t.k;
  if (!(floorPx / (runningPx * zoom) > TEXT_RESIDUAL_MIN)) return NONE;
  const scale = ownZoom(input.signals) * zoom;
  const evidence: TraceEvidence[] = [
    {
      kind: 'small_text',
      share: round2(smallText(input.signals, floorPx / scale).share),
      floorPx,
      beforePx: Math.round(runningPx * zoom),
    },
  ];
  if (zoom > 1) evidence.push({ kind: 'page_scale', zoom, k: t.k });
  return page(evidence);
}

/** page_zoom: triage's page scale, or one the person set for this site. Never without triage. */
function pageZoomApplicability(input: PolicyInput): Applicability {
  const t = input.triage;
  if (!t || (!(t.zoom > 1) && !manualLevel('page_zoom', input))) return NONE;
  const zoom = levelValue('page_zoom', levelFor('page_zoom', input));
  if (t.k === null) return page([]);
  const floorPx = input.profile.vision.textMinPx.value;
  return page([
    { kind: 'page_scale', zoom, k: t.k },
    {
      kind: 'small_text',
      share: round2(
        smallText(input.signals, floorPx / ownZoom(input.signals)).share,
      ),
      floorPx,
      beforePx: Math.round(floorPx / t.k),
    },
  ]);
}

/**
 * Deterministic applicability A in [0, 1] of an op on this page
 * (ai-architecture.md 1 row 3): measured facts for page ops, verdict labels for
 * region ops. Returns the regions an op should target when region-scoped.
 */
export function applicability(
  op: OpId,
  input: PolicyInput,
): {
  a: number;
  regions: string[];
  evidence: DecisionTrace['evidence'];
  perRegion: Record<string, number>;
} {
  const { signals, profile } = input;
  switch (op) {
    case 'text_floor': {
      if (input.triage) return textFloorWithTriage(input, input.triage);
      const t = smallText(signals, textFloorPx(input));
      if (t.share < SMALL_TEXT_MIN_SHARE) return NONE;
      return page([
        {
          kind: 'small_text',
          share: round2(t.share),
          floorPx: t.floorPx,
          beforePx: t.beforePx,
        },
      ]);
    }
    case 'page_zoom':
      return pageZoomApplicability(input);
    case 'line_spacing': {
      const current = signals.text.mainLineHeight;
      const target = levelValue(
        'line_spacing',
        levelFor('line_spacing', input),
      );
      if (current === null || !(current < target - LINE_HEIGHT_SLACK))
        return NONE;
      return page([
        { kind: 'tight_lines', lineHeight: round2(current), target },
      ]);
    }
    case 'line_length': {
      const main = confidentMain(signals);
      const lineCh = signals.text.mainLineCh;
      const maxCh = levelValue('line_length', levelFor('line_length', input));
      if (
        main === null ||
        lineCh === null ||
        !(lineCh > maxCh + LINE_LENGTH_SLACK_CH)
      )
        return NONE;
      const region = signals.regions.find((r) => r.key === main);
      if (region && (region.containsFocus || region.hasRequiredFields))
        return NONE;
      return {
        a: 1,
        regions: [main],
        evidence: [{ kind: 'long_lines', lineCh: Math.round(lineCh), maxCh }],
        perRegion: { [main]: 1 },
      };
    }
    case 'contrast': {
      if (signals.env.forcedColors) return NONE;
      const floor = profile.vision.contrastFloor.value;
      const count = contrastFailures(signals, floor);
      if (count < 1) return NONE;
      return page([{ kind: 'contrast_failures', count, targetRatio: floor }]);
    }
    case 'focus_outline': {
      // Selector-only and invisible to pointer use, so it only helps where keyboard focus matters:
      // keyboard input, a contrast need, a strong target need, or the person asked for it.
      const needs = evidenceNeeds(profile, input.needs);
      const keyboard =
        profile.motor.input === 'keyboard' ||
        profile.device.input === 'keyboard';
      const asked = sourceOf('focus_outline', input).pinned;
      return keyboard || asked || needs.contrast >= 1 || needs.targets >= 2
        ? page([])
        : NONE;
    }
    case 'target_size': {
      const px = levelValue('target_size', levelFor('target_size', input));
      // With triage the level is effective px: compare at the CSS size that reaches it.
      const count = input.triage
        ? Math.round(
            targetsBelow(
              signals,
              px / (ownZoom(signals) * zoomInEffect(input)),
            ),
          )
        : signals.targets.below[targetKey(px)];
      if (count < 1) return NONE;
      return page([{ kind: 'target_failures', count, targetPx: px }]);
    }
    case 'target_spacing': {
      if (signals.targets.crowded < 1) return NONE;
      return page([
        { kind: 'crowded_targets', count: signals.targets.crowded },
      ]);
    }
    case 'steady_clicks': {
      if (signals.targets.count < 1) return NONE;
      const px = profile.motor.minTargetPx.value;
      const small = signals.targets.below[targetKey(px)];
      return page(
        small > 0
          ? [{ kind: 'target_failures', count: small, targetPx: px }]
          : [],
      );
    }
    case 'menu_grace': {
      if (signals.hoverMenus < 1) return NONE;
      return page([{ kind: 'hover_menus', count: signals.hoverMenus }]);
    }
    case 'calm_motion': {
      const count = motionSources(signals);
      if (count < 1) return NONE;
      return page([{ kind: 'motion_sources', count }]);
    }
    case 'pause_media': {
      const count = autoplaySources(signals);
      if (count < 1) return NONE;
      return page([{ kind: 'autoplay_media', count }]);
    }
    case 'dim_distractions':
      return dimApplicability(input);
    case 'focus_view':
      return focusViewApplicability(input);
    case 'unpin_bars':
      return unpinApplicability(input);
    case 'reading_guide': {
      if (
        signals.text.totalChars < READING_GUIDE_MIN_CHARS ||
        signals.text.mainFontPx === null
      )
        return NONE;
      return page([]);
    }
  }
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/** Expected utility of auto-applying at P with engine reliability pOk (personalization.md 5.1). */
export function euAuto(p: number, pOk: number): number {
  return pOk * (p - (1 - p) * K.C) - (1 - pOk) * K.C_FAIL;
}

/** Offer probability: friction multiplies the odds, never the decision to apply (5.5). */
export function offerProbability(p: number, lr: number): number {
  const clamped = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return sigmoid(
    logit(clamped) + Math.log(Math.max(1, Number.isFinite(lr) ? lr : 1)),
  );
}

/** Which friction signal a likelihood ratio most plausibly came from, for the trace and the offer copy. */
export function frictionSignal(
  op: OpId,
  lr: number,
): Extract<TraceEvidence, { kind: 'friction' }>['signal'] {
  if (lr === FRICTION_LR.zoom_in) return 'zoom_in';
  if (lr === FRICTION_LR.scroll_reversal) return 'scroll_reversal';
  const pointing =
    op === 'target_size' ||
    op === 'target_spacing' ||
    op === 'steady_clicks' ||
    op === 'menu_grace';
  if (pointing) return 'misclick_burst';
  if (op === 'text_floor' || op === 'page_zoom') return 'zoom_in';
  if (op === 'line_spacing' || op === 'line_length' || op === 'reading_guide')
    return 'scroll_reversal';
  return 'rage_click';
}

export interface OpDecision {
  planned: PlannedOp | null;
  trace: DecisionTrace;
  /** Friction-adjusted offer probability (ranks offers when only one may be shown). */
  pOffer: number;
}

function sourceOf(
  op: OpId,
  input: PolicyInput,
): { source: DecisionSource; pinned: boolean; sitePin: boolean } {
  const sitePin =
    (input.site?.pins.includes(op) ?? false) ||
    input.domain?.ops[op]?.pin === true;
  let src = input.learning.ops[op]?.src ?? 'none';
  // A saved text size is page_zoom's authority as it is text_floor's: the
  // two compose into one text change (docs/10 §5.1).
  if (
    op === 'page_zoom' &&
    src === 'none' &&
    input.triage &&
    input.profile.vision.textMinPx.source !== 'default'
  )
    src = 'profile';
  const pinned = sitePin || src === 'pinned';
  return { source: pinned ? 'pinned' : src, pinned, sitePin };
}

function learnedNotes(
  op: OpId,
  input: PolicyInput,
  source: DecisionSource,
  sitePin: boolean,
): TraceEvidence[] {
  const day = toDay(input.now);
  const notes: TraceEvidence[] = [];
  if (sitePin) notes.push({ kind: 'learned', note: 'site_pin' });
  if (source === 'system')
    notes.push({ kind: 'learned', note: 'system_setting' });
  const personal = input.learning.ops[op]?.c;
  if (personal) {
    const c = decayCounts(personal, day);
    if (c.s >= 1 && c.s > c.f)
      notes.push({ kind: 'learned', note: 'kept_before' });
  }
  const dop = input.domain?.ops[op];
  if (
    demotedHere(input.domain, op) ||
    (dop && decayCounts(dop, day).f >= 0.5)
  ) {
    notes.push({ kind: 'learned', note: 'undone_before' });
  }
  return notes;
}

function decideDetailed(op: OpId, input: PolicyInput): OpDecision {
  const def = OP_CATALOG[op];
  const day = toDay(input.now);
  const { learning: u, domain: d, site, signals } = input;
  const { source, pinned, sitePin } = sourceOf(op, input);
  const level = levelFor(op, input);

  const make = (
    mode: DecisionMode,
    why: string,
    extra: {
      p?: number | null;
      pOk?: number | null;
      evidence?: TraceEvidence[];
      source?: DecisionSource;
    } = {},
  ): DecisionTrace => ({
    op,
    mode,
    source: extra.source ?? source,
    level,
    p: extra.p ?? null,
    pOk: extra.pOk ?? null,
    why,
    evidence: extra.evidence ?? [],
  });
  const skip = (
    why: string,
    extra: Parameters<typeof make>[2] = {},
  ): OpDecision => ({
    planned: null,
    trace: make('skip', why, extra),
    pOffer: 0,
  });

  if (RETIRED_OPS.has(op)) return skip('retired');
  // Hard rules first: user authority and session predictability.
  if (site?.paused) return skip('site_paused');
  if (u.ops[op]?.blocked || d?.ops[op]?.block || site?.blocks.includes(op))
    return skip('blocked');
  if (
    d?.ops[op]?.sessionOff !== undefined &&
    d.ops[op]!.sessionOff === input.tabSession
  ) {
    return skip('undone_this_session');
  }
  // Page scale needs triage: the breakpoint-safe zoom and the guard's baseline.
  if (op === 'page_zoom' && !input.triage) return skip('not_triaged');

  const app = applicability(op, input);
  const evidence = [
    ...app.evidence,
    ...learnedNotes(op, input, source, sitePin),
  ];
  if (!(app.a > 0) || (def.scope === 'region' && app.regions.length === 0)) {
    return skip('not_applicable', { evidence });
  }

  // The engine gate blocks everything; a "Not now" snooze on this site only silences the offer.
  const snoozed = offerSnoozed(d, op, day);
  const pOk = snoozed
    ? verifierPassRate(d, op, signals.category, day)
    : engineReliability(d, op, signals.category, day);
  if (pOk < K.P_OK_MIN) {
    return skip('engine_unreliable_here', { pOk: round2(pOk), evidence });
  }

  // Tune and explicit adjustments already chose these minimums. A population
  // prior for "would you like larger text?" must not veto the saved fit.
  // Page applicability, user blocks/undo and engine reliability still gate it.
  const savedMinimum =
    source === 'profile' &&
    (((op === 'text_floor' || op === 'page_zoom') &&
      input.profile.vision.textMinPx.source !== 'default') ||
      (op === 'target_size' &&
        input.profile.motor.minTargetPx.source !== 'default'));

  // A need that fits gets no automatic change, saved fit or not (docs/10
  // §3.2): text auto only past k = 1.15. The person's pins and levels for a
  // site still apply.
  const fits =
    triageBand(op, input) === 'fits' && !pinned && !manualLevel(op, input);

  const needs = evidenceNeeds(input.profile, input.needs);
  const theta = pinned
    ? pinnedDesirability(d, op, day)
    : desirability(
        u,
        d,
        op,
        {
          needs,
          category: signals.category,
          profileConfidence: input.profileConfidence,
        },
        day,
      ).mean;
  const P = Math.min(1 - 1e-4, Math.max(1e-4, app.a * theta));

  // Auto only from eligible sources: pins, or profile/system for auto-eligible ops, never after a
  // demoting undo on this site, never from friction.
  const autoSource =
    pinned ||
    ((source === 'profile' || source === 'system') && def.autoEligible);
  const matchesFit = savedMinimum && !snoozed;
  if (
    !fits &&
    autoSource &&
    !demotedHere(d, op) &&
    (matchesFit || euAuto(P, pOk) > 0)
  ) {
    const regions =
      def.scope === 'region'
        ? app.regions.filter(
            (key) => euAuto((app.perRegion[key] ?? 0) * theta, pOk) > 0,
          )
        : [];
    if (def.scope === 'page' || regions.length > 0) {
      const trace = make(
        'auto',
        matchesFit ? 'saved_fit' : `auto P=${P.toFixed(2)}`,
        {
          p: round2(P),
          pOk: round2(pOk),
          evidence,
        },
      );
      return {
        planned: {
          op,
          level,
          mode: 'auto',
          scope: def.scope === 'page' ? 'page' : { regions },
          trace,
        },
        trace,
        pOffer: P,
      };
    }
  }

  const lr = Math.max(1, input.friction[op] ?? 1);
  const pOffer = offerProbability(P, lr);
  // Where the need fits, only friction raises an offer. text_floor's
  // low-benefit band (residual past 1.05 with k up to 1.15) is offered,
  // never applied.
  if (fits && op !== 'text_floor' && !(lr > 1))
    return skip('page_fits', { p: round2(P), pOk: round2(pOk), evidence });
  if (pOffer < K.TAU_OFFER)
    return skip('below_threshold', {
      p: round2(P),
      pOk: round2(pOk),
      evidence,
    });

  const byFriction = lr > 1 && P < K.TAU_OFFER;
  const offerEvidence: TraceEvidence[] =
    lr > 1
      ? [...evidence, { kind: 'friction', signal: frictionSignal(op, lr) }]
      : evidence;
  const offerSource: DecisionSource = byFriction ? 'friction' : source;
  const extra = {
    p: round2(pOffer),
    pOk: round2(pOk),
    evidence: offerEvidence,
    source: offerSource,
  };

  if (snoozed) return skip('snoozed_here', extra);
  if (!(day > (u.ops[op]?.offerCooldownUntil ?? -Infinity)))
    return skip('offer_cooldown', extra);
  if (
    input.offersThisPage >= K.OFFERS_PER_PAGE ||
    input.offersToday >= K.OFFERS_PER_DAY
  ) {
    return skip('offer_budget', extra);
  }
  const regions =
    def.scope === 'region'
      ? app.regions.filter(
          (key) =>
            offerProbability((app.perRegion[key] ?? 0) * theta, lr) >=
            K.TAU_OFFER,
        )
      : [];
  if (def.scope === 'region' && regions.length === 0)
    return skip('below_threshold', extra);

  const trace = make('offer', `offer P=${pOffer.toFixed(2)}`, extra);
  return {
    planned: {
      op,
      level,
      mode: 'offer',
      scope: def.scope === 'page' ? 'page' : { regions },
      trace,
    },
    trace,
    pOffer,
  };
}

/** Expected-utility decision for one op (personalization.md 5, 11 decide()). */
export function decideOp(
  op: OpId,
  input: PolicyInput,
): { planned: PlannedOp | null; trace: DecisionTrace } {
  const { planned, trace } = decideDetailed(op, input);
  return { planned, trace };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function demote(decision: OpDecision, why: string): OpDecision {
  return {
    planned: null,
    trace: { ...decision.trace, mode: 'skip', why },
    pOffer: 0,
  };
}

/**
 * The plan and every op's trace (including skips), for the debug panel and
 * "What WebAble learned". `buildPlan` returns only the plan.
 */
export function planWithTraces(input: PolicyInput): {
  plan: AdaptationPlan;
  traces: DecisionTrace[];
} {
  const plan: AdaptationPlan = {
    id: `plan-${input.tabSession}-${Math.round(input.now)}`,
    createdAt: input.now,
    category: input.signals.category,
    basis: 'local',
    ops: [],
    zoom: 1,
    ...(input.triage ? { triage: input.triage } : {}),
  };
  if (input.site?.paused) {
    return {
      plan,
      traces: OP_IDS.map((op) => decideDetailed(op, input).trace),
    };
  }

  const decisions = new Map<OpId, OpDecision>();
  for (const op of OP_IDS) decisions.set(op, decideDetailed(op, input));
  const get = (op: OpId) => decisions.get(op)!;

  // Page scale and text floor compose (docs/10 §5.2): page_zoom applies
  // triage's scale, and text_floor, decided against that scale, carries only
  // the residual.

  // Focus view supersedes dimming, unless dimming is on automatically and focus view is only offered.
  const focus = get('focus_view');
  const dim = get('dim_distractions');
  if (
    focus.planned &&
    dim.planned &&
    !(dim.planned.mode === 'auto' && focus.planned.mode === 'offer')
  ) {
    decisions.set('dim_distractions', demote(dim, 'superseded_by_focus_view'));
  }

  // At most one offer per page (and within the daily budget): the most probable one.
  const offers = OP_IDS.filter((op) => get(op).planned?.mode === 'offer');
  const budgetLeft =
    input.offersThisPage < K.OFFERS_PER_PAGE &&
    input.offersToday < K.OFFERS_PER_DAY;
  let best: OpId | null = null;
  if (budgetLeft) {
    for (const op of offers)
      if (best === null || get(op).pOffer > get(best).pOffer) best = op;
  }
  for (const op of offers)
    if (op !== best) decisions.set(op, demote(get(op), 'one_offer_per_page'));

  for (const op of OP_IDS) {
    const planned = get(op).planned;
    if (planned) plan.ops.push(planned);
  }
  const scale = plan.ops.find((p) => p.op === 'page_zoom' && p.mode === 'auto');
  plan.zoom = scale ? levelValue('page_zoom', scale.level) : 1;
  plan.basis = plan.ops.some((p) =>
    p.trace.evidence.some(
      (e) => e.kind === 'region_role' && e.by === 'page_analysis',
    ),
  )
    ? 'page_analysis'
    : 'local';
  return { plan, traces: OP_IDS.map((op) => get(op).trace) };
}

/**
 * Full plan for a page: every op decided, at most one offer (budgeted), conflict
 * rules applied (page_zoom and text_floor compose, with plan.zoom the scale in
 * effect; focus_view supersedes dim_distractions on the same page; paused sites
 * return an empty plan).
 */
export function buildPlan(input: PolicyInput): AdaptationPlan {
  return planWithTraces(input).plan;
}
