import type { PageContext, RegionEvidence } from '@webable/core/page/types';

/**
 * Bucketing for everything that can leave the device. Exact numbers never do:
 * the page-analysis model reads bucket labels better than raw counts, and
 * buckets keep the payload enumerable.
 */

export function widthBucket(pctOfViewport: number): RegionEvidence['width'] {
  if (pctOfViewport < 15) return '<15%';
  if (pctOfViewport < 30) return '15-30%';
  if (pctOfViewport < 60) return '30-60%';
  if (pctOfViewport < 90) return '60-90%';
  return '>90%';
}

export function heightBucket(screens: number): RegionEvidence['height'] {
  if (screens < 0.1) return '<0.1 screens';
  if (screens < 0.3) return '0.1-0.3 screens';
  if (screens < 1) return '0.3-1 screens';
  if (screens <= 3) return '1-3 screens';
  return '>3 screens';
}

export function linkDensityBucket(
  density: number,
): RegionEvidence['link_density'] {
  if (density < 0.05) return 'none';
  if (density < 0.3) return 'low';
  if (density < 0.6) return 'mid';
  return 'high';
}

export function regionTextBucket(chars: number): RegionEvidence['text_amount'] {
  if (chars <= 0) return '0';
  if (chars < 100) return '<100 chars';
  if (chars < 500) return '100-500 chars';
  if (chars <= 2000) return '500-2k chars';
  return '>2k chars';
}

export function repeatedCardsBucket(
  n: number,
): RegionEvidence['repeated_cards'] {
  if (n < 2) return '0';
  if (n <= 3) return '2-3';
  if (n <= 8) return '4-8';
  return '>8';
}

export function pageTextBucket(
  chars: number,
): PageContext['counts']['text_amount'] {
  if (chars < 1000) return '<1k chars';
  if (chars < 10_000) return '1k-10k chars';
  if (chars <= 50_000) return '10k-50k chars';
  return '>50k chars';
}

export function pageHeightBucket(
  screens: number,
): PageContext['layout']['page_height'] {
  if (screens < 1) return '<1 screen';
  if (screens <= 3) return '1-3 screens';
  if (screens <= 10) return '3-10 screens';
  return '>10 screens';
}

export function pinnedBarsBucket(
  n: number,
): PageContext['layout']['pinned_bars'] {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n === 2) return '2';
  return '3+';
}

export function viewportClass(
  widthPx: number,
): PageContext['layout']['viewport'] {
  if (widthPx < 600) return 'phone';
  if (widthPx < 1024) return 'tablet';
  return 'desktop';
}

/** Weighted median of [value, weight] pairs. Returns null for an empty set. */
export function weightedMedian(
  pairs: ReadonlyArray<readonly [number, number]>,
): number | null {
  const sorted = pairs.filter(([, w]) => w > 0).sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return null;
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return sorted[sorted.length - 1]?.[0] ?? null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2
    ? (s[mid] ?? null)
    : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Round to a fixed number of decimals. */
export const round = (v: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
