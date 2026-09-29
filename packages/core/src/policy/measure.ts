import type { PageSignals } from '../page/types';
import type { FitProfile } from '../profile/schema';

/**
 * Deterministic page measurements used for applicability (ai-architecture.md 1
 * row 3). These are facts the content script already measured; nothing here is
 * a model decision.
 */

/** Minimum share of characters below the floor before text ops apply (personalization.md 6). */
export const SMALL_TEXT_MIN_SHARE = 0.05;
/** At or above this share of small text the whole layout grows: page zoom beats per-element floors (3.7). */
export const ZOOM_STRATEGY_SHARE = 0.3;
/** Main text must exceed the person's maximum line length by this many characters. */
export const LINE_LENGTH_SLACK_CH = 2;
/** Main line height must be this far below the person's line height. */
export const LINE_HEIGHT_SLACK = 0.05;
/** A sticky top band taller than this share of the viewport (after zoom) is worth unpinning (3.5). */
export const STICKY_BAND_SHARE = 0.2;
/** Minimum text on a page before a reading guide can help. */
export const READING_GUIDE_MIN_CHARS = 2000;
/** Regions smaller than this share of the viewport are not worth a region op (G4). */
export const MIN_REGION_AREA_PCT = 1.5;

export interface SmallText {
  /** Share of sampled characters rendered below the floor, 0..1. */
  share: number;
  /** The typical small size (the most common size below the floor, by characters), or main text size. */
  beforePx: number | null;
  floorPx: number;
}

/** Share of characters below `floorPx`, from the character-weighted size histogram. */
export function smallText(signals: PageSignals, floorPx: number): SmallText {
  let total = 0;
  let small = 0;
  const bySize = new Map<number, number>();
  for (const [px, chars] of signals.text.histogram) {
    if (!(chars > 0) || !Number.isFinite(px)) continue;
    total += chars;
    if (px < floorPx) {
      small += chars;
      bySize.set(px, (bySize.get(px) ?? 0) + chars);
    }
  }
  const share = total > 0 ? small / total : 0;
  const main = signals.text.mainFontPx;
  let beforePx: number | null =
    main !== null && main < floorPx ? Math.round(main) : null;
  if (beforePx === null && bySize.size > 0) {
    let best = -1;
    let bestChars = -1;
    for (const [px, chars] of bySize) {
      if (chars > bestChars || (chars === bestChars && px < best)) {
        best = px;
        bestChars = chars;
      }
    }
    beforePx = Math.round(best);
  }
  return { share, beforePx, floorPx };
}

/** Text failing the person's contrast floor. A floor of 21 uses the 7:1 count (the most the extractor samples). */
export function contrastFailures(
  signals: PageSignals,
  floor: FitProfile['vision']['contrastFloor']['value'],
): number {
  if (signals.contrast.sampled <= 0) return 0;
  return floor >= 7 ? signals.contrast.below7 : signals.contrast.below45;
}

/** Map a minimum target size to the extractor's ladder key (96 px uses the largest measured, 72). */
export function targetKey(px: number): '24' | '32' | '44' | '56' | '72' {
  if (px >= 72) return '72';
  if (px >= 56) return '56';
  if (px >= 44) return '44';
  if (px >= 32) return '32';
  return '24';
}

export function motionSources(signals: PageSignals): number {
  return (
    Math.max(signals.motion.running, signals.motion.infinite) +
    signals.motion.carousels
  );
}

export function autoplaySources(signals: PageSignals): number {
  return signals.motion.autoplayMedia + signals.motion.animatedImages;
}

/** Height of the pinned top band as a share of the viewport, scaled by the zoom WebAble would apply. */
export function stickyBandShare(signals: PageSignals, zoom: number): number {
  if (signals.viewport.height <= 0) return 0;
  return (
    (signals.sticky.topBandPx * Math.max(1, zoom)) / signals.viewport.height
  );
}
