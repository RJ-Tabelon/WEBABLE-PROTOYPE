import { OP_CATALOG } from '@webable/core/ops/catalog';
import { ZOOM_PRESETS } from '@webable/core/triage/triage';
import type { TriageVerdict } from '@webable/core/triage/types';

import type { TriagePrior } from '../storage/sites';

/**
 * Page scale (docs/10 §5.1): WebAble zooms a tab so text, targets and images
 * grow together and the site's own breakpoints do the reflow. These are the
 * pure rules; the worker owns the Chrome calls and the per-tab state.
 *
 * - The scale z is relative to the person's own zoom (their per-origin
 *   factor, their baseline): the tab is set to baseline x z, per tab.
 * - z is decided once per page view, at its first reading that has body
 *   text, and frozen; it changes only on Undo, a step-down by the zoom guard,
 *   or the person's own action.
 * - A zoom change to a factor WebAble did not set means the person owns zoom
 *   on that site.
 */

/** Two zoom factors are the same within this tolerance (Chrome rounds zoom levels). */
export const ZOOM_TOLERANCE = 0.01;
/** Overflow the zoom guard accepts after a page scale, in CSS px. */
export const GUARD_OVERFLOW_PX = 8;
/** onZoomChange events within this long of WebAble's own set call are WebAble's. */
export const OWN_ZOOM_WINDOW_MS = 3_000;
/** Window widths are bucketed this wide (DIP) for the page-scale cache. */
export const WIDTH_BUCKET_PX = 160;
/**
 * Titles newly cut off by a page scale (an ellipsis or a line clamp) that
 * step it down (eval m1): at least this many, and at least this share of the
 * titles the guard compared. A long title or two may lose a word; a list of
 * records whose titles all lose theirs is a breakpoint the scale broke.
 */
export const GUARD_TITLES_CUT_MIN = 3;
export const GUARD_TITLES_CUT_SHARE = 0.2;

export const sameFactor = (a: number, b: number): boolean =>
  Math.abs(a - b) <= ZOOM_TOLERANCE;

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** The tab factor for a page scale over the person's own zoom. */
export function tabFactor(baseline: number, z: number): number {
  const b = Number.isFinite(baseline) && baseline > 0 ? baseline : 1;
  return round3(b * z);
}

/** Position of a scale on the preset ladder (1 = no scale is 0). */
export function ladderIndex(z: number): number {
  if (!(z > 1 + ZOOM_TOLERANCE)) return 0;
  let best = 0;
  ZOOM_PRESETS.forEach((p, i) => {
    if (p <= z + ZOOM_TOLERANCE) best = i + 1;
  });
  return best;
}

/** One preset below z (1 below the smallest). */
export function stepDown(z: number): number {
  const i = ladderIndex(z);
  return i <= 1 ? 1 : (ZOOM_PRESETS[i - 2] ?? 1);
}

/** page_zoom's level index for a scale (its levels are the presets). */
export function zoomLevel(z: number): number {
  const levels = OP_CATALOG.page_zoom.levels as readonly number[];
  let best = 0;
  levels.forEach((l, i) => {
    if (Math.abs(l - z) < Math.abs((levels[best] ?? 1) - z)) best = i;
  });
  return best;
}

/** The page-scale cache bucket of a window width (DIP). */
export function widthBucket(width: number | null | undefined): number | null {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)
    return null;
  return Math.min(999, Math.floor(width / WIDTH_BUCKET_PX));
}

/**
 * The scale for the first plan of a page view when a cached scale was already
 * applied at hello: keep it while triage still wants a scale within one preset
 * of it (no second relayout for a near miss), otherwise follow triage.
 */
export function firstScale(decided: number, early: number | null): number {
  if (early === null || !(early > 1)) return decided;
  if (!(decided > 1)) return decided;
  return Math.abs(ladderIndex(decided) - ladderIndex(early)) <= 1
    ? early
    : decided;
}

/**
 * A reading with no body text to size (an SPA's shell before its content
 * renders after DOMContentLoaded): triage found no body size, so k is null.
 * Such a reading decides no page scale and is never cached for its template;
 * the scale is decided at the first reading that has body text.
 */
export const noBodyText = (t: TriageVerdict | undefined): boolean =>
  t !== undefined && t.k === null;

/** The verdict the policy sees for a frozen page scale: same needs, that scale. */
export function withScale(t: TriageVerdict, z: number): TriageVerdict {
  if (sameFactor(t.zoom, z)) return t;
  const residual = t.k === null ? 1 : Math.max(1, t.k / z);
  return { ...t, zoom: z, residual: round3(residual) };
}

/** What the next visit's hysteresis needs of a verdict. */
export function toPrior(t: TriageVerdict): TriagePrior {
  return {
    version: t.version,
    needs: { ...t.needs },
    zoom: t.zoom,
    blockers: [...t.blockers],
  };
}

/**
 * A stored prior as the verdict `triage()` reads (it uses the prior's version,
 * need bands, page scale and blockers only).
 */
export function fromPrior(p: TriagePrior): TriageVerdict {
  const order = ['fits', 'tailor', 'compose'] as const;
  const verdict = Object.values(p.needs).reduce(
    (worst, band) =>
      order.indexOf(band) > order.indexOf(worst) ? band : worst,
    'fits' as TriageVerdict['verdict'],
  );
  return {
    version: p.version as TriageVerdict['version'],
    verdict,
    k: null,
    zoom: p.zoom,
    zMax: p.zoom,
    residual: 1,
    needs: { ...p.needs },
    reasons: [],
    representable: p.blockers.length === 0,
    blockers: [...p.blockers],
  };
}

export interface GuardReport {
  zoom: number;
  overflowPx: number;
  navLinks: number;
  searchVisible: boolean;
  /** Titles cut off since the content script's reading at 100% (ViewportGuard). */
  newlyEllipsised?: number;
  /** Titles that count compared. */
  titlesShown?: number;
}

/**
 * The zoom guard (docs/10 §5.1): after a page scale settles, the page must
 * not overflow sideways, primary navigation and the search field must still
 * be visible as they were at 100%, and the titles on screen must not lose
 * their text to an ellipsis or a clamp (eval m1). `baseline` is null when the
 * page was first read already scaled (a repeat visit), and then only
 * overflow counts; the title count carries its own baseline.
 */
export function guardVerdict(
  report: GuardReport,
  baseline: { links: number; search: boolean } | null,
): 'ok' | 'overflow' | 'nav_hidden' | 'truncation' {
  if (report.overflowPx > GUARD_OVERFLOW_PX) return 'overflow';
  if (
    baseline &&
    (report.navLinks < baseline.links ||
      (baseline.search && !report.searchVisible))
  )
    return 'nav_hidden';
  const cut = report.newlyEllipsised ?? 0;
  if (
    cut >= GUARD_TITLES_CUT_MIN &&
    cut >= GUARD_TITLES_CUT_SHARE * (report.titlesShown ?? 0)
  )
    return 'truncation';
  return 'ok';
}

/**
 * A zoom change that resets to the default (Chrome's zoom bubble "Reset", or
 * Ctrl+0) or back to the person's own zoom: it counts as Undo of the page
 * scale. Any other factor means the person took zoom over.
 */
export function isZoomReset(
  factor: number,
  baseline: number,
  defaultFactor: number | undefined,
): boolean {
  return (
    sameFactor(factor, baseline) ||
    sameFactor(
      factor,
      typeof defaultFactor === 'number' && defaultFactor > 0
        ? defaultFactor
        : 1,
    )
  );
}

/**
 * Zoom factors WebAble itself set, per tab, for a few seconds: Chrome reports
 * every change through onZoomChange, including WebAble's own. In memory only;
 * after a worker restart the per-tab record still tells WebAble's factor apart.
 */
export class OwnZoom {
  private readonly pending = new Map<
    number,
    Array<{ factor: number; until: number }>
  >();

  expect(tabId: number, factor: number, now: number): void {
    const list = (this.pending.get(tabId) ?? []).filter((e) => e.until > now);
    list.push({ factor, until: now + OWN_ZOOM_WINDOW_MS });
    this.pending.set(tabId, list);
  }

  /** True (and consumed) when `factor` is one WebAble just set in this tab. */
  consume(tabId: number, factor: number, now: number): boolean {
    const list = (this.pending.get(tabId) ?? []).filter((e) => e.until > now);
    const i = list.findIndex((e) => sameFactor(e.factor, factor));
    if (i >= 0) list.splice(i, 1);
    if (list.length > 0) this.pending.set(tabId, list);
    else this.pending.delete(tabId);
    return i >= 0;
  }

  forget(tabId: number): void {
    this.pending.delete(tabId);
  }
}
