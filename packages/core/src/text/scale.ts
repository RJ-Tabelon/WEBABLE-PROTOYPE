// Owner: T (round 3). Text size, hierarchy and the page column.
//
// Principle: zoom carries size; CSS carries structure.
//  - Size comes from browser zoom only: the smallest Chrome preset that brings the page's body text to the person's
//    size (within a small tolerance), capped at 200% (250% for large print). No per-element font-size changes on
//    fitted pages, so the site's own heading-to-body ratios survive unchanged.
//  - Where the site's own hierarchy is weak, headings are raised to a minimum ramp (never shrunk).
//  - On enlarged pages the content is held to a centred column so lines stay a readable length.
// `mapFontSize` is kept for the fitting's preview (a re-presented page, not a fitted one).
import type { FitProfile } from '../types';

export const CHROME_ZOOM_PRESETS: number[] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** Below this total scale nothing changes: the cost of change dominates small benefits (Gajos 2010). */
export const MIN_SCALE_TO_ACT = 1.15;
/** WebAble's own zoom stops here (the column handles width, so there is no viewport-width cap any more). */
export const MAX_PAGE_ZOOM = 2;
/** Large-print fits may go one preset further. */
export const MAX_PAGE_ZOOM_LARGE = 2.5;
/** The person's own A+ steps may go this far (large print: one preset more). */
export const MAX_PERSON_ZOOM = 2.5;
export const MAX_PERSON_ZOOM_LARGE = 3;
/** The lowest zoom the person's A− steps reach. */
export const MIN_PERSON_ZOOM = 0.5;
/**
 * Body text within this share of the person's size counts as reached: the fit already carries a +26% reading margin
 * over critical print size (research-fitting §5), so a preset 7% short beats one 30% over.
 */
export const SIZE_TOLERANCE = 0.93;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The person's comfortable body size the plan aims for (override wins). */
export function fitBodyPx(fit: FitProfile): number {
  const v = fit.text.override ?? fit.text.bodyPx;
  return Number.isFinite(v) && v > 0 ? v : 16;
}

/** Largest preset above 1 that is ≤ v (1 when none is). */
export function snapZoomDown(v: number, presets: number[] = CHROME_ZOOM_PRESETS.filter((z) => z > 1)): number {
  let best = 1;
  for (const p of presets) if (p <= v + 1e-9 && p > best) best = p;
  return best;
}

/** The Chrome preset nearest to `z` (log distance), for custom zoom levels the person set. */
export function nearestPreset(z: number): number {
  let best = 1;
  let d = Infinity;
  for (const p of CHROME_ZOOM_PRESETS) {
    const x = Math.abs(Math.log(p) - Math.log(z > 0 ? z : 1));
    if (x < d) {
      d = x;
      best = p;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Page zoom                                                           */
/* ------------------------------------------------------------------ */

export interface ZoomPlan {
  /** Absolute tab zoom to set (1 = 100%). */
  zoom: number;
  /** The zoom the fit alone asks for (before the person's own steps). */
  fitZoom: number;
  /** The person's own zoom when the page loaded. */
  ownZoom: number;
  /** WebAble's ceiling for this fit (2 or 2.5). */
  cap: number;
  /** The person's size could not be reached under the cap. */
  capped: boolean;
  /** Text size steps the person took on this site (0 = the fit's size). */
  step: number;
  /** Page body text, CSS px at 100%. */
  bodyPx: number;
  /** The person's size (CSS px at 100%). */
  targetPx: number;
  /** What the person sees: body × zoom, in px at 100%. */
  effectiveBodyPx: number;
  /** How far short of the person's size the page stays at the fit's own zoom (0 when reached). */
  shortPx: number;
  /**
   * Round 11: on a narrow screen whose width capped the zoom, every text size is also multiplied by this (the
   * extension's text map); effectiveBodyPx then includes it. Absent or 1: zoom alone.
   */
  textScale?: number;
}

export interface ZoomOptions {
  /** The tab's zoom set by the person (not by WebAble). Default 1. */
  ownZoom?: number;
  /** Text size steps the person took on this site (one Chrome preset each). */
  step?: number;
}

/** The ladder the person's A−/A+ steps move along. */
export function personZoomLadder(largePrint: boolean): number[] {
  const top = largePrint ? MAX_PERSON_ZOOM_LARGE : MAX_PERSON_ZOOM;
  return CHROME_ZOOM_PRESETS.filter((z) => z >= MIN_PERSON_ZOOM - 1e-9 && z <= top + 1e-9);
}

/** Move `steps` presets along the person's ladder from `from` (a custom level starts at its nearest preset). */
export function stepZoom(from: number, steps: number, largePrint = false): number {
  const ladder = personZoomLadder(largePrint);
  const start = nearestPreset(from);
  let i = ladder.findIndex((z) => Math.abs(z - start) < 1e-6);
  if (i < 0) i = start < (ladder[0] ?? 1) ? 0 : ladder.length - 1;
  const j = clamp(i + Math.round(steps), 0, ladder.length - 1);
  return ladder[j] ?? from;
}

/**
 * Plan the page zoom for a page whose running text is `pageBodyPx` (CSS px). The zoom is the smallest Chrome preset
 * that brings body text to at least SIZE_TOLERANCE × the person's size, never below the person's own zoom, capped at
 * 200% (250% for large print). Gaps under 1.15× change nothing; a 'default' fit (never measured, never set) changes
 * nothing. The person's own steps (`step`) then move one preset each along `personZoomLadder`.
 */
export function planPageZoom(fit: FitProfile, pageBodyPx: number, opts: ZoomOptions = {}): ZoomPlan {
  const ownZoom = opts.ownZoom && Number.isFinite(opts.ownZoom) && opts.ownZoom > 0 ? opts.ownZoom : 1;
  const b = Number.isFinite(pageBodyPx) && pageBodyPx > 0 ? pageBodyPx : 16;
  const largePrint = !!fit.text.largePrint;
  const cap = largePrint ? MAX_PAGE_ZOOM_LARGE : MAX_PAGE_ZOOM;
  const F = fitBodyPx(fit);
  const step = Number.isFinite(opts.step) ? Math.round(opts.step as number) : 0;

  let fitZoom = ownZoom;
  let capped = false;
  const isDefault = fit.text.source === 'default' && fit.text.override == null;
  if (!isDefault) {
    const k = F / (b * ownZoom);
    if (k > MIN_SCALE_TO_ACT) {
      const want = (SIZE_TOLERANCE * F) / b;
      const options = CHROME_ZOOM_PRESETS.filter((z) => z > ownZoom + 1e-6 && z <= cap + 1e-9);
      const reach = options.find((z) => z + 1e-9 >= want);
      if (reach !== undefined) fitZoom = reach;
      else {
        fitZoom = Math.max(ownZoom, options[options.length - 1] ?? ownZoom);
        capped = true;
      }
    }
  }
  const zoom = step ? stepZoom(fitZoom, step, largePrint) : fitZoom;
  const effectiveBodyPx = round1(b * zoom);
  const shortPx = capped ? round1(Math.max(0, F - b * fitZoom)) : 0;
  return { zoom, fitZoom, ownZoom, cap, capped: shortPx > 0, step, bodyPx: b, targetPx: F, effectiveBodyPx, shortPx };
}

/* ------------------------------------------------------------------ */
/* Page body size                                                      */
/* ------------------------------------------------------------------ */

/** One block of text the reader saw (structure only). */
export interface BodyBlock {
  fontPx: number;
  /** Characters in the block's whole text (a <p> with links counts the links' words too). */
  chars: number;
  inMain: boolean;
  /** Why this block is not running body text (footer, legal, consent, chat, promo, aside, nav, control, heading, metadata), or null. */
  excluded?: string | null;
}

export interface BodySize {
  px: number;
  /** Which rule found it. */
  source: 'main paragraphs' | 'paragraphs' | 'main text' | 'page text' | 'main links' | 'default';
  blocks: number;
  chars: number;
}

/** Blocks shorter than this are labels, not running text. */
export const BODY_MIN_CHARS = 60;
/** Text smaller than this is fine print, not the page's body. */
export const BODY_MIN_PX = 12;

function weightedMedianPx(blocks: BodyBlock[]): number | null {
  const s = blocks.filter((b) => Number.isFinite(b.fontPx) && b.fontPx > 0 && b.chars > 0).sort((a, b) => a.fontPx - b.fontPx);
  const total = s.reduce((acc, b) => acc + b.chars, 0);
  if (!total) return null;
  let acc = 0;
  for (const b of s) {
    acc += b.chars;
    if (acc >= total / 2) return b.fontPx;
  }
  return s[s.length - 1]?.fontPx ?? null;
}

/**
 * The page's body text size: the char-weighted median over paragraph-like blocks in the main content (≥ 60
 * characters, ≥ 12 px), leaving out footers, legal and fine print, consent notices, chat, promotions, asides,
 * navigation, controls, headings and one-line metadata. Falls back to paragraphs anywhere, then shorter text in main,
 * then shorter text anywhere, then headline links in main, then `fallbackPx` (the body element's own size), then 16.
 */
export function bodySizeFromBlocks(blocks: BodyBlock[], fallbackPx?: number | null): BodySize {
  const ok = (b: BodyBlock) => !b.excluded && b.fontPx >= BODY_MIN_PX;
  const tries: Array<[BodySize['source'], BodyBlock[]]> = [
    ['main paragraphs', blocks.filter((b) => ok(b) && b.inMain && b.chars >= BODY_MIN_CHARS)],
    ['paragraphs', blocks.filter((b) => ok(b) && b.chars >= BODY_MIN_CHARS)],
    ['main text', blocks.filter((b) => ok(b) && b.inMain && b.chars >= 20)],
    ['page text', blocks.filter((b) => ok(b) && b.chars >= 20)],
    // A page of headline links (a news front page): the headlines are its running text.
    ['main links', blocks.filter((b) => b.excluded === 'control' && b.inMain && b.fontPx >= BODY_MIN_PX && b.chars >= 30)],
  ];
  for (const [source, set] of tries) {
    const px = weightedMedianPx(set);
    if (px != null) return { px: round1(px), source, blocks: set.length, chars: set.reduce((a, b) => a + b.chars, 0) };
  }
  const fb = fallbackPx && Number.isFinite(fallbackPx) && fallbackPx > 0 ? fallbackPx : 16;
  return { px: round1(fb), source: 'default', blocks: 0, chars: 0 };
}

/* ------------------------------------------------------------------ */
/* Heading hierarchy                                                   */
/* ------------------------------------------------------------------ */

/**
 * Minimum heading-to-body ratios (measured after zoom, which keeps the site's own ratios). Apple's text styles put
 * Title 1 / Title 2 / Title 3 at 1.65 / 1.29 / 1.18 of Body; Material 3 puts Headline Medium / Headline Small /
 * Title Large at 1.75 / 1.5 / 1.375 of Body Large. NN/g's eye-tracking work shows people scan pages by their
 * headings, so a heading has to stand out from body text by size, not by weight alone.
 */
export const HEADING_RAMP: Record<1 | 2 | 3, number> = { 1: 1.75, 2: 1.4, 3: 1.2 };
/** Raised headings are at least this weight (Apple separates tiers by weight where sizes converge). */
export const HEADING_MIN_WEIGHT = 600;
/** A heading never grows by more than this factor of its own size (eyebrow labels marked up as headings). */
export const HEADING_MAX_GROWTH = 1.75;

export interface HeadingSample {
  id: string;
  level: number;
  fontPx: number;
  weight: number;
  chars: number;
  /**
   * The smallest text on the page set larger than this heading and well above body size (another heading level, a
   * lead headline in a span): the heading stays under it, so the site's own visual order holds. Null for none.
   */
  ceilPx?: number | null;
}

export interface HeadingChange {
  id: string;
  level: number;
  fromPx: number;
  toPx: number;
  /** New weight, or null to keep the site's. */
  weight: number | null;
}

/**
 * Raise weak h1–h3 headings to the minimum ramp (h1 ≥ 1.75×, h2 ≥ 1.4×, h3 ≥ 1.2× body, weight ≥ 600). Headings that
 * already stand out are left as they are; nothing ever shrinks; sizes are rounded to 0.5 px.
 */
export function planHeadingScale(headings: HeadingSample[], bodyPx: number): HeadingChange[] {
  if (!(bodyPx > 0)) return [];
  const out: HeadingChange[] = [];
  for (const h of headings) {
    const lvl = Math.round(h.level);
    if (lvl < 1 || lvl > 3 || !(h.fontPx > 0) || h.chars <= 0 || h.chars > 200) continue;
    const want = HEADING_RAMP[lvl as 1 | 2 | 3] * bodyPx;
    if (h.fontPx >= want - 0.25) continue;
    const ceil = h.ceilPx && h.ceilPx > h.fontPx ? h.ceilPx - 0.5 : Infinity;
    const toPx = Math.min(Math.round(Math.min(want, h.fontPx * HEADING_MAX_GROWTH) * 2) / 2, Math.floor(ceil * 2) / 2);
    if (toPx <= h.fontPx + 0.25) continue;
    out.push({ id: h.id, level: lvl, fromPx: h.fontPx, toPx, weight: h.weight < HEADING_MIN_WEIGHT ? HEADING_MIN_WEIGHT : null });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The page column                                                     */
/* ------------------------------------------------------------------ */

/**
 * Characters per line the column aims for at the fitted size: inside the 66–75 range (66 the classic ideal, 75 its
 * upper end; research-fitting §8.7), above Dyson & Haselgrove's 55 cpl comprehension optimum and under WCAG 1.4.8's
 * 80-character limit.
 */
export const COLUMN_CPL = 70;
/** The column never goes below this width (screen px), so page layouts keep a usable width. */
export const COLUMN_MIN_PX = 720;
/** Page background stays visible on each side of the column (screen px). */
export const COLUMN_GUTTER_PX = 64;
/** One Narrower / Wider step (screen px). */
export const COLUMN_STEP_PX = 80;
/** The automatic column is at least this share of the screen (about four fifths, like Caden's narrowed window). */
export const COLUMN_SHARE = 0.78;
/** Room for the page's own side padding, per side, in CSS px (scaled by zoom). */
export const COLUMN_SIDE_PAD_CSS = 24;

export interface ColumnPlan {
  /** Column width in screen px (CSS px at 100% zoom). */
  widthPx: number;
  /** The same width in CSS px at this zoom: what the stylesheet sets. */
  cssPx: number;
  /** Characters per line of body text the width allows. */
  cpl: number;
  minPx: number;
  maxPx: number;
}

export interface ColumnInput {
  /** Viewport width in screen px (CSS px × zoom). */
  screenW: number;
  zoom: number;
  /** Average character width of the page's body text, CSS px at 100%. */
  charPx: number;
  /** A fixed width the person chose (screen px), or null for automatic. */
  fixedPx?: number | null;
}

/** The column's limits on this screen, or null when there is no room for one. */
export function columnLimits(screenW: number): { minPx: number; maxPx: number } | null {
  const maxPx = Math.floor((screenW - 2 * COLUMN_GUTTER_PX) / 8) * 8;
  if (!(maxPx >= COLUMN_MIN_PX)) return null;
  return { minPx: COLUMN_MIN_PX, maxPx };
}

/**
 * Column width (automatic): the wider of about 70 characters of body text at the fitted size (plus the page's own
 * side padding) and COLUMN_SHARE of the screen, clamped to [720, screenW − 128] screen px. The column is a narrower
 * virtual window (see the extension's column op): the site lays itself out for that width with its own breakpoints,
 * so its own measure rules hold inside it, and the share keeps a news front page in a desktop or tablet layout
 * instead of a phone one (Caden's 2.webp: a window about four fifths of the screen wide). Null on a narrow screen.
 */
export function planColumn(input: ColumnInput): ColumnPlan | null {
  const lim = columnLimits(input.screenW);
  if (!lim) return null;
  const zoom = input.zoom > 0 && Number.isFinite(input.zoom) ? input.zoom : 1;
  const c = (input.charPx > 0 && Number.isFinite(input.charPx) ? input.charPx : 8) * zoom;
  const pad = 2 * COLUMN_SIDE_PAD_CSS * zoom;
  const raw = input.fixedPx && input.fixedPx > 0 ? input.fixedPx : Math.max(COLUMN_CPL * c + pad, COLUMN_SHARE * input.screenW);
  const widthPx = clamp(Math.round(raw / 8) * 8, lim.minPx, lim.maxPx);
  return { widthPx, cssPx: Math.round(widthPx / zoom), cpl: Math.round((widthPx - pad) / c), minPx: lim.minPx, maxPx: lim.maxPx };
}

/** One Narrower (-1) or Wider (+1) step from `widthPx`, inside the limits (null when there is no room). */
export function stepColumn(widthPx: number, dir: -1 | 1, screenW: number): number | null {
  const lim = columnLimits(screenW);
  if (!lim) return null;
  return clamp(Math.round((widthPx + dir * COLUMN_STEP_PX) / 8) * 8, lim.minPx, lim.maxPx);
}

/**
 * Between a width that did not fit (`lo`) and one that did (`hi`), the next width to try, or null when they are
 * within `minStep` px. The column is as narrow as the page allows: a narrower body squeezes the site's current
 * layout tier (media queries still see the whole window), so fixed-width parts decide how far it can go.
 */
export function bisectColumn(lo: number, hi: number, minStep = 48): number | null {
  if (!(hi > lo)) return null;
  const mid = Math.round((lo + hi) / 2 / 8) * 8;
  return hi - mid >= minStep && mid > lo ? mid : null;
}

/* ------------------------------------------------------------------ */
/* The fitting preview's text map (not used on fitted pages)           */
/* ------------------------------------------------------------------ */

/** e = min(1, max(0.2, 1 − 0.48·log2 k_r)). */
export function compressiveExponent(residual: number): number {
  if (residual <= 1) return 1;
  return round3(Math.min(1, Math.max(0.2, 1 - 0.48 * Math.log2(residual))));
}

/**
 * The text map for one computed size s (CSS px), with page body b and target body F′ = b·k_r:
 *   s ≥ b: s′ = F′·(s/b)^e;  s < b: s′ = min(F′, s·k_r);  never s′ < s.
 * Used by the fitting's preview only; fitted pages grow by zoom.
 */
export function mapFontSize(sizePx: number, pageBodyPx: number, targetBodyPx: number, exponent: number): number {
  if (!Number.isFinite(sizePx) || sizePx <= 0) return sizePx;
  const b = pageBodyPx > 0 ? pageBodyPx : 16;
  const F = targetBodyPx;
  if (!(F > b)) return sizePx;
  const kr = F / b;
  const e = clamp(Number.isFinite(exponent) ? exponent : 1, 0.2, 1);
  const mapped = sizePx >= b ? F * (sizePx / b) ** e : Math.min(F, sizePx * kr);
  return Math.max(sizePx, Math.round(mapped * 100) / 100);
}
