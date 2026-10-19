import type { PageSignals } from '../page/types';
import {
  autoplaySources,
  contrastFailures,
  motionSources,
  targetsBelow,
} from '../policy/measure';
import { structureNeed } from '../fit/structure';
import { normCdf } from '../profile/needs';
import type { FitProfile, LatentDim } from '../profile/schema';
import { TRIAGE_VERSION } from '../versions';
import {
  TRIAGE_BLOCKERS,
  type LayoutFeatures,
  type TriageBlocker,
  type TriageKind,
  type TriageNeed,
  type TriageReason,
  type TriageVerdict,
} from './types';

/**
 * Person-relative triage (docs/10 §3.2): does this page need anything for
 * this person, how much, and can the page absorb it in place?
 *
 * Runs in the service worker on every page view. The content script sends
 * person-independent features (PageSignals, PageSignals.layout); every share
 * here is computed against the fit, which never leaves the worker. Pure and
 * deterministic: the same inputs always give the same verdict.
 *
 * Constants marked † are unvalidated defaults, to be calibrated on the
 * real-site corpus (docs/10 §10).
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** † Needed text scale k at or below which running text already fits. Auto changes start above it. */
export const TEXT_FITS_MAX_K = 1.15;
/**
 * Text scale left after the page scale (k / zoom) above which running text
 * still needs text_floor (docs/10 §5.2).
 */
export const TEXT_RESIDUAL_MIN = 1.05;
/**
 * † Hysteresis margin, in the unit of each threshold: k for text, share (0-1)
 * for targets, contrast and occlusion, percentile / 100 for clutter, and a
 * tenth of the threshold for structure scores. With a prior verdict for the
 * same template, a need changes band only when its measure crosses the
 * threshold by this margin.
 */
export const TRIAGE_HYSTERESIS = 0.1;

/** Chrome's zoom presets above 100% (110/125/150/175/200%): the only page scales WebAble sets. */
export const ZOOM_PRESETS = [1.1, 1.25, 1.5, 1.75, 2] as const;
/** † Largest page scale WebAble applies. */
export const ZOOM_MAX = 2;
/**
 * † Narrowest layout width (CSS px) a page scale may leave, so `innerWidth / z`
 * stays in the desktop layout class (most sites switch to a tablet layout
 * below about 800 px). The engine and worker's post-apply guard (visible
 * primary navigation and search) steps down further when a site's own
 * breakpoint sits higher (docs/10 §5.1).
 */
export const ZOOM_MIN_LAYOUT_PX = 800;

/** † Targets: share of targets below the person's size that still fits. */
export const TARGETS_FITS_MAX_SHARE = 0.1;
/** † Targets: share below the person's size at which a records page with no slack is re-presented. */
export const TARGETS_COMPOSE_MIN_SHARE = 0.4;
/** † Share of targets crowded together (24 px spacing circle) at which hit areas have no room to grow. */
export const TARGETS_NO_SLACK_CROWDED = 0.3;
/** † Row slack (1/U) below which nowrap and flex rows cannot grow. */
export const ROW_SLACK_MIN = 1.1;

/** Posterior P(benefit > 0) an attention gate requires (never the mean, docs/10 §3.2). */
export const ATTENTION_GATE_P = 0.8;
/**
 * † Comfort percentile for a person with no lean either way (P = 0.5). It
 * falls toward CLUTTER_COMFORT_MIN as P(distraction benefit > 0) rises and
 * rises toward 100 as it falls.
 */
export const CLUTTER_COMFORT_PERCENTILE = 75;
/** † Lowest comfort percentile (a person who is clearly helped by calmer pages). */
export const CLUTTER_COMFORT_MIN = 50;
/** † Density percentile at which a page is re-presented for a person helped by calm. */
export const CLUTTER_COMPOSE_PERCENTILE = 90;

/** † Occlusion (viewport share under fixed or sticky boxes) that still fits. */
export const OCCLUSION_FITS_MAX = 0.15;
/** † Occlusion above which the page is re-presented. */
export const OCCLUSION_COMPOSE_MIN = 0.3;

/** † Share of sampled text below the person's contrast floor that still fits. */
export const CONTRAST_FITS_MAX_SHARE = 0.05;

/** Mozilla isProbablyReaderable's minimum score. */
export const READERABLE_MIN_SCORE = 20;
/** A collection of at least this many records of one template... */
export const RECORDS_MIN_ITEMS = 5;
/** † ...covering at least this share of main makes a page re-presentable. */
export const RECORDS_MIN_MAIN_SHARE = 0.4;

/**
 * † Reference distribution for page density: the value of each in-view
 * feature at REFERENCE_PERCENTILES. Leaf boxes and block corners stand in for
 * the Michailidou visual-complexity score.
 *
 * Every row is the corpus's (docs/10 §10; research/v2-eval-2026-10-15.md):
 * the 13 real pages at 1440 × 900 as the extractor measures them, at each
 * percentile by linear interpolation. Leaves run 1.2 (GOV.UK) to 18.4
 * (GitHub), corners 24 to 288, font sizes 4 to 10 and competing regions 5
 * to 23. The first estimates, from DOM probes of news, reference, search,
 * video and shop pages, sat above every real page for leaves (median 28) and
 * below them for regions (0-12, where every real page has 5 or more), so a
 * calm page read as dense in regions and a busy one as calm in leaves.
 */
export const REFERENCE_PERCENTILES = [10, 25, 50, 75, 90, 97] as const;
export const DENSITY_REFERENCE: Readonly<
  Record<keyof LayoutFeatures['density'], readonly number[]>
> = {
  leafPer100k: [1.6, 2, 11, 15, 17, 18],
  corners: [28, 36, 102, 144, 174, 249],
  fontSizes: [4, 5, 6, 7, 7.8, 9.3],
  regions: [5, 6, 9, 12, 23, 23],
};
/**
 * † Weight of each feature in the density percentile. Against the corpus's
 * own percentiles, block corners separate its busy pages (YouTube search,
 * Wikipedia, Amazon search, GitHub) from its calm ones (GOV.UK, WebAIM,
 * Meta) best; font sizes and regions least (the v1 segmentation finds 5
 * regions on YouTube search and 8 on a GOV.UK page).
 */
export const DENSITY_WEIGHTS: Readonly<
  Record<keyof LayoutFeatures['density'], number>
> = { leafPer100k: 0.3, corners: 0.55, fontSizes: 0.1, regions: 0.05 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BANDS: readonly TriageKind[] = ['fits', 'tailor', 'compose'];

const r2 = (x: number): number => Math.round(x * 100) / 100;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));
/** `x` when it is a finite positive number, else `fallback`. */
const positive = (x: number | undefined, fallback: number): number =>
  x !== undefined && Number.isFinite(x) && x > 0 ? x : fallback;
/** part / whole in 0-1 (0 when there is no whole). */
const share = (part: number, whole: number): number =>
  whole > 0 && Number.isFinite(part) ? clamp(part / whole, 0, 1) : 0;

/**
 * x is past threshold t. With a prior answer (`wasPast`), the edge moves by
 * the hysteresis margin toward keeping it: a need that was past stays past
 * until x falls `margin` below t, and one that was not needs `margin` more.
 */
function past(
  x: number,
  t: number,
  wasPast: boolean | null,
  margin = TRIAGE_HYSTERESIS,
  inclusive = false,
): boolean {
  const edge = wasPast === null ? t : wasPast ? t - margin : t + margin;
  return inclusive ? x >= edge : x > edge;
}

/** x is short of threshold t, with the same hysteresis as `past`. */
const short = (
  x: number,
  t: number,
  wasShort: boolean | null,
  margin = TRIAGE_HYSTERESIS,
): boolean => past(-x, -t, wasShort, margin);

/** The prior verdict's band for this need is at least `band` (null: no prior). */
const atLeast = (prior: TriageKind | null, band: TriageKind): boolean | null =>
  prior === null ? null : BANDS.indexOf(prior) >= BANDS.indexOf(band);

/** The largest Chrome zoom preset at or below x (1 below the smallest). */
export function snapZoom(x: number): number {
  let z = 1;
  for (const preset of ZOOM_PRESETS) if (preset <= x + 1e-9) z = preset;
  return z;
}

/** zMax: the largest page scale that keeps the desktop layout (viewport / 800, 1-2). */
export function breakpointSafeZoom(viewportWidth: number): number {
  if (!(viewportWidth > 0) || !Number.isFinite(viewportWidth)) return 1;
  return clamp(viewportWidth / ZOOM_MIN_LAYOUT_PX, 1, ZOOM_MAX);
}

/** Body text size: the layout features' main-region median, else the signals'. */
function bodyPxOf(signals: PageSignals): number | null {
  const px = signals.layout?.bodyPx ?? signals.text.mainFontPx;
  return px !== null && px !== undefined && Number.isFinite(px) && px > 0
    ? px
    : null;
}

/** k = textMinPx / (bodyPx x zoom), or null without body text. */
function neededScale(
  profile: FitProfile,
  signals: PageSignals,
  zoom: number,
): number | null {
  const body = bodyPxOf(signals);
  if (body === null) return null;
  return profile.vision.textMinPx.value / (body * positive(zoom, 1));
}

/** Posterior P(benefit > 0) of a latent dimension (sd floored at 0.05). */
export function benefitPositive(dim: LatentDim): number {
  return normCdf(dim.mean / Math.max(dim.sd, 0.05));
}

/** Something other than the flat default prior informed this dimension. */
const seen = (dim: LatentDim): boolean =>
  dim.confidence > 0 || dim.sources.length > 0;

/** Percentile (0-100) of x against a reference row, piecewise linear. */
function percentileOf(x: number, ref: readonly number[]): number {
  const P = REFERENCE_PERCENTILES;
  const first = ref[0]!;
  if (!(x > first)) return first > 0 ? (P[0] * Math.max(0, x)) / first : P[0];
  for (let i = 1; i < ref.length; i += 1) {
    const hi = ref[i]!;
    if (x < hi) {
      const lo = ref[i - 1]!;
      return P[i - 1]! + ((P[i]! - P[i - 1]!) * (x - lo)) / (hi - lo);
    }
  }
  const last = ref[ref.length - 1]!;
  const top = P[P.length - 1]!;
  return top + (100 - top) * Math.min(1, (x - last) / Math.max(last, 1));
}

/** Density percentile (0-100) of a page against the reference distribution. */
export function densityPercentile(density: LayoutFeatures['density']): number {
  let sum = 0;
  let weight = 0;
  for (const key of Object.keys(DENSITY_WEIGHTS) as Array<
    keyof LayoutFeatures['density']
  >) {
    const value = density[key];
    if (!Number.isFinite(value)) continue;
    sum += DENSITY_WEIGHTS[key] * percentileOf(value, DENSITY_REFERENCE[key]);
    weight += DENSITY_WEIGHTS[key];
  }
  return weight > 0 ? clamp(sum / weight, 0, 100) : 0;
}

/** The person's comfort percentile for page density, from P(distraction benefit > 0). */
export function comfortPercentile(pBenefit: number): number {
  return clamp(
    CLUTTER_COMFORT_PERCENTILE +
      2 * (CLUTTER_COMFORT_PERCENTILE - CLUTTER_COMFORT_MIN) * (0.5 - pBenefit),
    CLUTTER_COMFORT_MIN,
    100,
  );
}

// ---------------------------------------------------------------------------
// Needs
// ---------------------------------------------------------------------------

interface NeedResult {
  band: TriageKind;
  reasons: TriageReason[];
}

const FITS: NeedResult = { band: 'fits', reasons: [] };

function textNeed(
  k: number | null,
  zMax: number,
  evidence: boolean,
  prior: TriageKind | null,
): NeedResult {
  if (!evidence || k === null) return FITS;
  // With zMax at or below the fits edge there is no in-place band: past it is compose.
  const composeEdge = Math.max(TEXT_FITS_MAX_K, zMax);
  if (past(k, composeEdge, atLeast(prior, 'compose'))) {
    return {
      band: 'compose',
      reasons: [
        { kind: 'small_text', k: r3(k) },
        { kind: 'cant_stretch', k: r3(k), zMax: r3(zMax) },
      ],
    };
  }
  if (past(k, TEXT_FITS_MAX_K, atLeast(prior, 'tailor')))
    return { band: 'tailor', reasons: [{ kind: 'small_text', k: r3(k) }] };
  return FITS;
}

/**
 * Page scale for the text band: the largest preset at or below min(k, zMax).
 * With a prior for the template, its scale is kept while it stays
 * breakpoint-safe and within the hysteresis margin of today's choice.
 */
function pageScale(
  k: number | null,
  zMax: number,
  band: TriageKind,
  prior: TriageVerdict | null,
): number {
  if (band === 'fits' || k === null) return 1;
  const target = Math.min(k, zMax);
  const z = snapZoom(target);
  const kept = prior?.zoom;
  if (
    kept !== undefined &&
    kept !== z &&
    kept > 1 &&
    prior?.needs.text !== 'fits' &&
    (ZOOM_PRESETS as readonly number[]).includes(kept) &&
    kept <= zMax + 1e-9 &&
    snapZoom(target - TRIAGE_HYSTERESIS) <= kept &&
    kept <= snapZoom(target + TRIAGE_HYSTERESIS)
  )
    return kept;
  return z;
}

function targetsNeed(
  profile: FitProfile,
  signals: PageSignals,
  scale: number,
  recordsPage: boolean,
  prior: TriageKind | null,
): NeedResult & { share: number } {
  const { targets } = signals;
  const T = profile.motor.minTargetPx.value;
  if (profile.motor.minTargetPx.source === 'default' || !(targets.count > 0))
    return { ...FITS, share: 0 };
  // Targets grow with the page scale: compare at the CSS size that reaches T.
  const below = share(targetsBelow(signals, T / scale), targets.count);
  const crowded = share(targets.crowded, targets.count);
  // No slack: hit areas cannot grow without meeting their neighbours, or
  // rows of controls are already full.
  const wasCompose = atLeast(prior, 'compose');
  const rowSlack = signals.layout?.slack.rowSlackMin ?? null;
  const noSlack =
    past(
      crowded,
      TARGETS_NO_SLACK_CROWDED,
      wasCompose,
      TRIAGE_HYSTERESIS,
      true,
    ) ||
    (rowSlack !== null && short(rowSlack, ROW_SLACK_MIN, wasCompose));
  const reasons: TriageReason[] = [
    { kind: 'small_targets', share: r2(below), targetPx: T },
  ];
  if (crowded > TARGETS_FITS_MAX_SHARE)
    reasons.push({ kind: 'crowded_targets', share: r2(crowded) });
  if (
    recordsPage &&
    noSlack &&
    past(below, TARGETS_COMPOSE_MIN_SHARE, wasCompose)
  )
    return { band: 'compose', reasons, share: below };
  if (past(below, TARGETS_FITS_MAX_SHARE, atLeast(prior, 'tailor')))
    return { band: 'tailor', reasons, share: below };
  return { ...FITS, share: below };
}

function clutterNeed(
  profile: FitProfile,
  layout: LayoutFeatures | undefined,
  prior: TriageKind | null,
): NeedResult {
  // Any measured structure benefit (busy, dense, unchunked or weakly
  // signalled pages cost this person time) makes a busy page worth
  // restructuring (docs/11).
  const need = structureNeed(profile);
  if (!layout || Object.values(need.dims).every((d) => d === null)) return FITS;
  const pct = densityPercentile(layout.density);
  const p = need.p;
  const margin = TRIAGE_HYSTERESIS * 100;
  const reasons: TriageReason[] = [
    { kind: 'busy', percentile: Math.round(pct) },
  ];
  if (
    p >= ATTENTION_GATE_P &&
    past(
      pct,
      CLUTTER_COMPOSE_PERCENTILE,
      atLeast(prior, 'compose'),
      margin,
      true,
    )
  )
    return { band: 'compose', reasons };
  if (past(pct, comfortPercentile(p), atLeast(prior, 'tailor'), margin))
    return { band: 'tailor', reasons };
  return FITS;
}

function occlusionNeed(
  profile: FitProfile,
  layout: LayoutFeatures | undefined,
  measuredAt: number,
  zoom: number,
  prior: TriageKind | null,
): NeedResult {
  // Bars that stay on screen matter to people who enlarge text (they take
  // more of a zoomed screen) or who are helped by calmer pages.
  const relevant =
    profile.vision.textMinPx.source !== 'default' ||
    seen(profile.attention.distraction);
  if (!layout || !relevant) return FITS;
  // Fixed boxes grow with the page scale while the viewport keeps its size.
  const occ = clamp((layout.occlusion / measuredAt) * zoom, 0, 1);
  const reasons: TriageReason[] = [{ kind: 'covered', share: r2(occ) }];
  if (past(occ, OCCLUSION_COMPOSE_MIN, atLeast(prior, 'compose')))
    return { band: 'compose', reasons };
  if (past(occ, OCCLUSION_FITS_MAX, atLeast(prior, 'tailor')))
    return { band: 'tailor', reasons };
  return FITS;
}

function contrastNeed(
  profile: FitProfile,
  signals: PageSignals,
  prior: TriageKind | null,
): NeedResult {
  const floor = profile.vision.contrastFloor;
  if (floor.source === 'default' || signals.env.forcedColors) return FITS;
  const low = share(
    contrastFailures(signals, floor.value),
    signals.contrast.sampled,
  );
  if (!past(low, CONTRAST_FITS_MAX_SHARE, atLeast(prior, 'tailor')))
    return FITS;
  return {
    band: 'tailor',
    reasons: [{ kind: 'low_contrast', share: r2(low) }],
  };
}

function motionNeed(profile: FitProfile, signals: PageSignals): NeedResult {
  const count = motionSources(signals) + autoplaySources(signals);
  if (count < 1) return FITS;
  const { attention } = profile;
  const asked =
    attention.systemReducedMotion ||
    signals.env.reducedMotion ||
    (seen(attention.motion) &&
      benefitPositive(attention.motion) >= ATTENTION_GATE_P);
  return asked
    ? { band: 'tailor', reasons: [{ kind: 'motion', count }] }
    : FITS;
}

// ---------------------------------------------------------------------------
// Re-presentability
// ---------------------------------------------------------------------------

/**
 * Why Fit view cannot re-present this page, in TRIAGE_BLOCKERS order. The
 * structure test keeps its prior answer within the hysteresis margin; the
 * hard blockers (editors, payment, an open consent wall) never do.
 */
export function blockersOf(
  signals: PageSignals,
  prior: TriageVerdict | null = null,
): TriageBlocker[] {
  const layout = signals.layout;
  const found = new Set<TriageBlocker>();
  if (signals.forms.hasPassword) found.add('password');
  if (signals.forms.hasPayment) found.add('payment');
  if (!layout) {
    found.add('no_structure');
  } else {
    const { kind, records } = layout;
    if (kind.editor) found.add('editor');
    if (kind.application) found.add('application');
    if (kind.canvas) found.add('canvas');
    if (kind.videoPlayer) found.add('video_player');
    if (kind.paywall) found.add('paywall');
    if (kind.blockingOverlay) found.add('blocking_overlay');
    if (kind.password) found.add('password');
    if (kind.payment) found.add('payment');
    const was =
      prior === null ? null : !prior.blockers.includes('no_structure');
    // Readability's own test is score > minScore.
    const readerable = past(
      layout.readerable,
      READERABLE_MIN_SCORE,
      was,
      READERABLE_MIN_SCORE * TRIAGE_HYSTERESIS,
    );
    const collection =
      records.count > 0 &&
      records.largest >= RECORDS_MIN_ITEMS &&
      past(
        records.mainShare,
        RECORDS_MIN_MAIN_SHARE,
        was,
        TRIAGE_HYSTERESIS,
        true,
      );
    // A short guidance page (GOV.UK's start pages) reads as a document by
    // its outline when Readability's paragraph score is low.
    const outlined = layout.outlined === true;
    if (!(readerable || collection || outlined || kind.product))
      found.add('no_structure');
  }
  return TRIAGE_BLOCKERS.filter((b) => found.has(b));
}

/** A records page: a stable collection covering enough of main (targets' compose band). */
function isRecordsPage(layout: LayoutFeatures | undefined): boolean {
  return (
    layout !== undefined &&
    layout.records.count > 0 &&
    layout.records.largest >= RECORDS_MIN_ITEMS &&
    layout.records.mainShare >= RECORDS_MIN_MAIN_SHARE
  );
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export interface TriageInput {
  profile: FitProfile;
  signals: PageSignals;
  /**
   * The tab's zoom when the page was read (PageSignals.viewport.zoom, the
   * person's own): body text is seen at bodyPx x zoom. Default 1.
   */
  zoom?: number;
  /**
   * WebAble's page scale in effect when the page was read (1 = none): the
   * layout viewport was measured at it, so zMax and occlusion are read
   * against the unscaled width. Default 1.
   */
  scale?: number;
  /** The last verdict for this page template (hysteresis); ignored from another triage version. */
  prior?: TriageVerdict | null;
}

/**
 * The triage verdict for one page view (docs/10 §3.2).
 *
 * - k = textMinPx / (bodyPx x zoom); per need a fits / tailor / compose band.
 * - zMax = min(2, viewport width / 800); zoom = the largest Chrome preset at
 *   or below min(k, zMax) when text needs more than fits; residual = k / zoom.
 * - compose when any need is compose and the page is re-presentable, else
 *   tailor when any need is not fits, else fits.
 * - Needs the person's fit says nothing about (default values, flat
 *   attention priors) fit: triage acts on evidence, as the policy does.
 * - Without layout features (an engine older than v2) the verdict is
 *   conservative: no page scale (the zoom guard has no baseline), clutter and
 *   occlusion unmeasured, and not re-presentable.
 */
export function triage(input: TriageInput): TriageVerdict {
  const { profile, signals } = input;
  const layout = signals.layout;
  const zoom = positive(input.zoom, 1);
  const measuredAt = positive(input.scale, 1);
  const prior =
    input.prior && input.prior.version === TRIAGE_VERSION ? input.prior : null;
  const was = (need: TriageNeed): TriageKind | null =>
    prior ? prior.needs[need] : null;

  const k = neededScale(profile, signals, zoom);
  const zMax = layout
    ? breakpointSafeZoom(signals.viewport.width * measuredAt)
    : 1;

  const text = textNeed(
    k,
    zMax,
    profile.vision.textMinPx.source !== 'default',
    was('text'),
  );
  const z = pageScale(k, zMax, text.band, prior);
  const residual = k === null ? 1 : Math.max(1, k / z);

  const recordsPage = isRecordsPage(layout);
  const targets = targetsNeed(
    profile,
    signals,
    zoom * z,
    recordsPage,
    was('targets'),
  );
  const clutter = clutterNeed(profile, layout, was('clutter'));
  const occlusion = occlusionNeed(
    profile,
    layout,
    measuredAt,
    z,
    was('occlusion'),
  );
  const contrast = contrastNeed(profile, signals, was('contrast'));
  const motion = motionNeed(profile, signals);

  const results: Record<TriageNeed, NeedResult> = {
    text,
    targets,
    clutter,
    occlusion,
    contrast,
    motion,
  };
  const needs = {} as Record<TriageNeed, TriageKind>;
  const reasons: TriageReason[] = [];
  for (const need of Object.keys(results) as TriageNeed[]) {
    needs[need] = results[need].band;
    if (results[need].band !== 'fits') reasons.push(...results[need].reasons);
  }

  const blockers = blockersOf(signals, prior);
  const representable = blockers.length === 0;
  const bands = Object.values(needs);
  const verdict: TriageKind =
    representable && bands.includes('compose')
      ? 'compose'
      : bands.some((b) => b !== 'fits')
        ? 'tailor'
        : 'fits';

  return {
    version: TRIAGE_VERSION,
    verdict,
    k: k === null ? null : r3(k),
    zoom: z,
    zMax: r3(zMax),
    residual: r3(residual),
    needs,
    reasons,
    representable,
    blockers,
  };
}
