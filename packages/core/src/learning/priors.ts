import { OP_CATALOG, OP_IDS, type DimId, type OpId } from '../ops/catalog';
import { PAGE_CATEGORIES, type PageCategory } from '../page/types';
import type { NeedLevel, NeedLevels } from '../profile/schema';

/**
 * Reviewed, versioned prior tables (personalization.md 6, 9, 16).
 *
 * These are expert defaults for Phase 0 (no product telemetry). They are data,
 * not code: a later release may move the *centre* of a cell (never its
 * strength), clamped to +/-0.10 per release and human-reviewed.
 */
export const PRIOR_RELEASE = 'prior-1.0.0' as const;

type NeedRow = readonly [need0: number, need1: number, need2: number];

/**
 * p0 by need level before category modifiers (personalization.md 9 table,
 * mapped onto the 16-op library).
 *
 * - need 0 sits near the population rate (~0.10-0.25): a change nobody asked
 *   for is rarely wanted, so it is at most an offer.
 * - need 2 sits at 0.85-0.90 for cheap, reversible, well-understood changes
 *   (text, targets, motion) and lower (0.55-0.75) for changes that alter what
 *   the page shows (dimming, focus view, reading guide), because a wrong
 *   dim costs more than a missed one.
 * - page_zoom sits slightly below text_floor: zoom rescales the whole layout,
 *   including images, and is chosen over text_floor by measurement, not taste.
 * - calm_motion and pause_media are highest: stopping motion is almost never
 *   unwanted by someone whose fit (or OS setting) asks for less of it.
 */
export const BASE_PRIOR: Readonly<Record<OpId, NeedRow>> = {
  text_floor: [0.15, 0.6, 0.85],
  page_zoom: [0.12, 0.55, 0.8],
  line_spacing: [0.15, 0.5, 0.75],
  line_length: [0.15, 0.5, 0.75],
  contrast: [0.1, 0.5, 0.8],
  focus_outline: [0.2, 0.6, 0.85],
  target_size: [0.1, 0.55, 0.85],
  target_spacing: [0.1, 0.55, 0.85],
  steady_clicks: [0.05, 0.5, 0.85],
  menu_grace: [0.1, 0.5, 0.75],
  calm_motion: [0.25, 0.65, 0.9],
  pause_media: [0.25, 0.65, 0.9],
  dim_distractions: [0.1, 0.45, 0.65],
  focus_view: [0.1, 0.4, 0.6],
  unpin_bars: [0.1, 0.45, 0.65],
  reading_guide: [0.05, 0.35, 0.55],
};

/**
 * Category modifiers, multiplicative on the odds (personalization.md 9).
 * Rationale per row:
 * - Reading aids (line length, spacing, guide, focus view, dimming) help most
 *   where the page is prose (article, docs) and least where the page is a tool
 *   (web app) or a task (checkout), where softening or reflowing gets in the way.
 * - Pausing autoplay on a video page pauses the thing the person came for.
 * - On feeds, dimming is limited to ads (recommendations are the content).
 * - Bigger targets and steady clicks matter most on forms and checkouts.
 * - Zoom in a web app tends to hide tool panels; text floors are safer there.
 */
export const CATEGORY_ODDS: Readonly<
  Record<OpId, Partial<Record<PageCategory, number>>>
> = {
  text_floor: {},
  page_zoom: { web_app: 0.8 },
  line_spacing: { article: 1.1, web_app: 0.7, form_checkout: 0.8 },
  line_length: {
    article: 1.2,
    docs_reference: 1.1,
    web_app: 0.6,
    form_checkout: 0.7,
  },
  contrast: {},
  focus_outline: { form_checkout: 1.1, web_app: 1.1 },
  target_size: { form_checkout: 1.2, web_app: 1.1 },
  target_spacing: { form_checkout: 1.1 },
  steady_clicks: { form_checkout: 1.1 },
  menu_grace: {},
  calm_motion: { web_app: 0.9 },
  pause_media: { media_video: 0.5, feed_social: 1.2 },
  dim_distractions: {
    article: 1.2,
    docs_reference: 1.1,
    feed_social: 0.8,
    media_video: 0.8,
    web_app: 0.6,
    form_checkout: 0.5,
  },
  focus_view: {
    article: 1.3,
    docs_reference: 1.2,
    feed_social: 0.6,
    search_results: 0.6,
    web_app: 0.5,
    form_checkout: 0.5,
  },
  unpin_bars: { article: 1.1, web_app: 0.6, form_checkout: 0.7 },
  reading_guide: {
    article: 1.2,
    docs_reference: 1.1,
    web_app: 0.5,
    form_checkout: 0.5,
    media_video: 0.5,
  },
};

const round2 = (x: number): number => Math.round(x * 100) / 100;

function applyOdds(p: number, multiplier: number): number {
  if (multiplier === 1) return p;
  const odds = (p / (1 - p)) * multiplier;
  return round2(odds / (1 + odds));
}

function buildPriorTable(): Readonly<
  Record<
    OpId,
    Readonly<Record<NeedLevel, Readonly<Record<PageCategory, number>>>>
  >
> {
  const table = {} as Record<
    OpId,
    Record<NeedLevel, Record<PageCategory, number>>
  >;
  for (const op of OP_IDS) {
    const rows = {} as Record<NeedLevel, Record<PageCategory, number>>;
    ([0, 1, 2] as const).forEach((need) => {
      const row = {} as Record<PageCategory, number>;
      for (const cat of PAGE_CATEGORIES) {
        row[cat] = applyOdds(BASE_PRIOR[op][need], CATEGORY_ODDS[op][cat] ?? 1);
      }
      rows[need] = Object.freeze(row);
    });
    table[op] = Object.freeze(rows);
  }
  return Object.freeze(table);
}

/** P0[op][need][category]: the reviewed prior centre p0 used by Learner A. */
export const PRIOR_TABLE = buildPriorTable();

/**
 * Population prior p0 for a person who has not tuned (tier 0, m0 = 2;
 * personalization.md 9): "unknown" is not "measured and not needed". Around
 * 0.2 for most ops, lower for changes most people never want (steady clicks,
 * focus view, reading guide), higher for stopping autoplay. With a friction
 * likelihood ratio of 3 an op at 0.2 crosses the 0.40 offer threshold (0.43),
 * which is the only way a tier-0 page changes without an OS setting.
 */
export const POPULATION_PRIOR: Readonly<Record<OpId, number>> = {
  text_floor: 0.2,
  page_zoom: 0.15,
  line_spacing: 0.2,
  line_length: 0.2,
  contrast: 0.15,
  focus_outline: 0.2,
  target_size: 0.2,
  target_spacing: 0.15,
  steady_clicks: 0.1,
  menu_grace: 0.15,
  calm_motion: 0.25,
  pause_media: 0.3,
  dim_distractions: 0.15,
  focus_view: 0.1,
  unpin_bars: 0.15,
  reading_guide: 0.1,
};

/** Tier-0 prior centre with the same category modifiers as PRIOR_TABLE. */
export function populationPrior(op: OpId, category: PageCategory): number {
  return applyOdds(POPULATION_PRIOR[op], CATEGORY_ODDS[op][category] ?? 1);
}

/**
 * The need level that drives an op's prior: the strongest of the op's areas
 * (ops/catalog.ts `areas`), e.g. pause_media uses max(motion, distraction).
 */
export function needForOp(op: OpId, needs: NeedLevels): NeedLevel {
  let level: NeedLevel = 0;
  for (const area of OP_CATALOG[op].areas)
    if (needs[area] > level) level = needs[area];
  return level;
}

export function priorCentre(
  op: OpId,
  needs: NeedLevels,
  category: PageCategory,
): number {
  return PRIOR_TABLE[op][needForOp(op, needs)][category];
}

/**
 * Engine-reliability priors Beta(a, b) per op x category (personalization.md 6;
 * ai-architecture.md 1 row 5). Phase 0 values are reviewed estimates by risk
 * class, to be replaced by pass rates from the archived CI corpus:
 * - paint ops (colour, outline, opacity, overlay) cannot move layout: ~0.95;
 * - behaviour ops change input handling but not geometry: ~0.90;
 * - layout ops can clip, overlap or overflow: ~0.85, lower in web apps and
 *   checkouts whose dense fixed-size panels break most often (~0.70-0.75).
 * Strength 20 lets local verifier counts on a site dominate within a few
 * visits; every cell stays above P_OK_MIN (0.5) so no op is off by prior alone.
 */
export const ENGINE_PRIOR_STRENGTH = 20;

const ENGINE_BASE: Record<'paint' | 'layout' | 'behavior', number> = {
  paint: 0.95,
  behavior: 0.9,
  layout: 0.85,
};

const ENGINE_CATEGORY_PASS: Partial<
  Record<PageCategory, Partial<Record<'paint' | 'layout' | 'behavior', number>>>
> = {
  web_app: { layout: 0.7, behavior: 0.85 },
  form_checkout: { layout: 0.75 },
  feed_social: { layout: 0.8 },
  media_video: { behavior: 0.85 },
};

function buildEnginePrior(): Readonly<
  Record<OpId, Readonly<Record<PageCategory, { a: number; b: number }>>>
> {
  const table = {} as Record<
    OpId,
    Record<PageCategory, { a: number; b: number }>
  >;
  for (const op of OP_IDS) {
    const risk = OP_CATALOG[op].risk;
    const row = {} as Record<PageCategory, { a: number; b: number }>;
    for (const cat of PAGE_CATEGORIES) {
      const pass = ENGINE_CATEGORY_PASS[cat]?.[risk] ?? ENGINE_BASE[risk];
      row[cat] = Object.freeze({
        a: round2(pass * ENGINE_PRIOR_STRENGTH),
        b: round2((1 - pass) * ENGINE_PRIOR_STRENGTH),
      });
    }
    table[op] = Object.freeze(row);
  }
  return Object.freeze(table);
}

export const ENGINE_PRIOR = buildEnginePrior();

/**
 * Personal desirability assumed for a pinned op ("Always do this"). The person
 * said so; only their own undos on a site can demote it there (through the
 * domain level, kappa = 4): one fast undo leaves it on (0.76), a second makes
 * it an offer on that site (0.63). Pins never demote globally.
 */
export const PIN_THETA = 0.95;

/** Implementation version per op. Bump when an op's behaviour changes materially: counts halve. */
export const OP_IMPL_VERSION: Readonly<Record<OpId, number>> = Object.freeze(
  Object.fromEntries(OP_IDS.map((op) => [op, 1])) as Record<OpId, number>,
);

/**
 * Learner B calibration spread (log units) at full confidence, per dimension
 * (personalization.md 7.1): text and spacing are measured tightly (0.10),
 * targets and line length less so (0.15), click windows and dim strength are
 * inferred rather than measured (0.20-0.25). At zero confidence every
 * dimension widens to SIGMA_WIDE.
 */
export const SIGMA_CAL: Readonly<Record<DimId, number>> = {
  textPx: 0.1,
  zoom: 0.15,
  lineHeight: 0.1,
  lineCh: 0.15,
  targetPx: 0.15,
  clickWindowMs: 0.2,
  dimOpacity: 0.25,
};
export const SIGMA_WIDE = 0.35;
/** Lab-to-wild gap g: calibration happens under ideal conditions (personalization.md 7.1). */
export const LAB_TO_WILD = 0.1;

/**
 * Which way is "stronger" for each dimension's natural value: +1 when a larger
 * value is a stronger change (bigger text), -1 when a smaller value is
 * (shorter lines, lower opacity for dimming).
 */
export const DIM_STRENGTH_SIGN: Readonly<Record<DimId, 1 | -1>> = {
  textPx: 1,
  zoom: 1,
  lineHeight: 1,
  lineCh: -1,
  targetPx: 1,
  clickWindowMs: 1,
  dimOpacity: -1,
};
