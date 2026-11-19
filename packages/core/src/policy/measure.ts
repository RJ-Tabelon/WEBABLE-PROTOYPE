import type { PageSignals } from '../page/types';
import type { FitProfile } from '../profile/schema';

/**
 * Deterministic page measurements used for applicability (ai-architecture.md 1
 * row 3). These are facts the content script already measured; nothing here is
 * a model decision.
 */

/** Minimum share of characters below the floor before text ops apply (personalization.md 6). */
export const SMALL_TEXT_MIN_SHARE = 0.05;
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

/** The extractor's target-size ladder (PageSignals.targets.below keys). */
const TARGET_KEYS = [24, 32, 44, 56, 72] as const;

/**
 * Targets whose hit area is below `px` (CSS px), interpolated in log size
 * between the extractor's cumulative ladder counts. Exact at the ladder
 * sizes; above 72 px it uses the largest measured (72), below 24 px it scales
 * the 24 px count down linearly. Used when a page scale changes the CSS size
 * that reaches the person's target size (T / zoom).
 */
export function targetsBelow(signals: PageSignals, px: number): number {
  const below = signals.targets.below;
  const count = (key: (typeof TARGET_KEYS)[number]): number => {
    const n = below[String(key) as keyof typeof below];
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  if (!(px > 0)) return 0;
  if (px >= 72) return count(72);
  if (px <= 24) return count(24) * (px / 24);
  for (let i = 1; i < TARGET_KEYS.length; i += 1) {
    const hi = TARGET_KEYS[i]!;
    if (px > hi) continue;
    const lo = TARGET_KEYS[i - 1]!;
    const t = Math.log(px / lo) / Math.log(hi / lo);
    return count(lo) + (count(hi) - count(lo)) * t;
  }
  return count(72);
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

/**
 * Height of the pinned top band as a share of the viewport, scaled by the
 * zoom WebAble would apply. `measuredAt` is WebAble's page scale when the
 * page was read (a repeat visit is read with it already on, in a viewport
 * that many times shorter in CSS px): the band is compared with the
 * viewport without it, so the scale counts once.
 */
export function stickyBandShare(
  signals: PageSignals,
  zoom: number,
  measuredAt = 1,
): number {
  const at = Number.isFinite(measuredAt) && measuredAt > 0 ? measuredAt : 1;
  const height = signals.viewport.height * at;
  if (!(height > 0)) return 0;
  return (signals.sticky.topBandPx * Math.max(1, zoom)) / height;
}
