import { READING_STEP_LOG } from '@webable/core';

/**
 * Reading stimulus geometry (cal-vision §3). Sizes are CSS px of the stimulus
 * font. The face is bundled Noto Sans 400 (design-final §9.2); its x-height
 * ratio and average advance are still measured at runtime, so a fallback face
 * (if the file could not load) also gives valid sizes.
 */

/** The CSS family for reading stimuli (the face is loaded by shared/primitives). */
export const STIMULUS_FAMILY =
  "'Noto Sans', Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif";

/** The longest reading sentence, in characters (they are 55-60, cal-vision §3). */
export const SENTENCE_CHARS = 60;

/** Fallbacks when the canvas cannot measure (tests, very old engines). */
export const FALLBACK_XHEIGHT_RATIO = 0.52;
export const FALLBACK_ADVANCE_EM = 0.5;

/** The ladder box is about 22 characters wide (20-24, cal-vision §3). */
export const BOX_CHARS = 22;
/** At least 13 characters per line (8 on the large-print path) must fit. */
export const MIN_CHARS = 13;
export const MIN_CHARS_LARGE_PRINT = 8;
/** Share of the available width the box may use. */
export const FIT_SHARE = 0.9;

/** Size steps are 0.1 log (x1.26). */
const STEP = 10 ** READING_STEP_LOG;

const SAMPLE = 'A bicycle has two wheels and moves forward when pedaled.';

export interface StimulusMetrics {
  /** x-height / font size of the stimulus face. */
  xHeightRatio: number;
  /** Average advance per character, in em. */
  advanceEm: number;
}

/** Measure the stimulus face with a canvas. Browser only; falls back safely. */
export function measureStimulusFont(doc: Document = document): StimulusMetrics {
  try {
    const canvas = doc.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const size = 100;
    ctx.font = `400 ${size}px ${STIMULUS_FAMILY}`;
    const x = ctx.measureText('x');
    const ascent = x.actualBoundingBoxAscent;
    const xHeightRatio =
      Number.isFinite(ascent) && ascent > 0
        ? clamp(ascent / size, 0.3, 0.7)
        : FALLBACK_XHEIGHT_RATIO;
    const width = ctx.measureText(SAMPLE).width;
    const advanceEm =
      Number.isFinite(width) && width > 0
        ? clamp(width / SAMPLE.length / size, 0.35, 0.7)
        : FALLBACK_ADVANCE_EM;
    return {
      xHeightRatio: round(xHeightRatio, 4),
      advanceEm: round(advanceEm, 4),
    };
  } catch {
    return {
      xHeightRatio: FALLBACK_XHEIGHT_RATIO,
      advanceEm: FALLBACK_ADVANCE_EM,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** V1 starts at max(1.5 x the browser default, 24 px) (design-final §9.2). */
export function comfortStartPx(rootFontPx: number): number {
  return round(Math.max(1.5 * clamp(rootFontPx, 8, 64), 24));
}

/**
 * The text scale WebAble's own chrome wears while Tune runs, from the size
 * chosen on "Make this comfortable to read" (design-final §9.2). It grows only
 * past the starting size (1.5 x the browser default), never shrinks, and stops
 * at 2 so the task layout still fits.
 */
export function tuneChromeScale(comfortPx: number, rootFontPx: number): number {
  const start = comfortStartPx(rootFontPx);
  if (!Number.isFinite(comfortPx) || start <= 0) return 1;
  return Math.round(clamp(comfortPx / start, 1, 2) * 1000) / 1000;
}

/** One 0.1 log step up (+1) or down (-1), kept inside [minPx, maxPx]. */
export function stepComfort(
  px: number,
  direction: 1 | -1,
  bounds: { minPx: number; maxPx: number },
): number {
  const next = direction > 0 ? px * STEP : px / STEP;
  return round(clamp(next, bounds.minPx, bounds.maxPx));
}

/**
 * The largest font size at which `minChars` characters still fit in `share` of
 * the available width (S_fit, cal-vision §3).
 */
export function maxFitPx(
  availableWidthPx: number,
  advanceEm: number,
  minChars = MIN_CHARS,
): number {
  const width = Math.max(0, availableWidthPx) * FIT_SHARE;
  const perChar = Math.max(0.2, advanceEm);
  return round(Math.max(8, width / (minChars * perChar)));
}

/**
 * Lines a sentence of `chars` characters takes in a box `boxPx` wide. Words
 * wrap early, so each line is counted two characters short (a 22-character
 * box holds the 55-60 character sentences in 3 lines).
 */
export function linesAt(
  fontPx: number,
  advanceEm: number,
  boxPx: number,
  chars = SENTENCE_CHARS,
): number {
  const perLine = Math.floor(boxPx / (Math.max(0.2, advanceEm) * fontPx));
  const usable = Math.max(1, perLine - 2);
  return Math.ceil(chars / usable);
}

/**
 * The largest font size, at most `maxPx`, at which a sentence set in the
 * reading box fits `heightPx` of stage (the stage sits between the heading and
 * the answers, so a stimulus that fits never pushes the answers out of view;
 * scrolling to answer would count as reading time). `insetPx` is space the box
 * adds around the text (the light and dark boxes have padding).
 */
export function maxFitHeightPx(input: {
  heightPx: number;
  widthPx: number;
  advanceEm: number;
  lineHeight: number;
  maxPx: number;
  chars?: number;
  insetInlinePx?: number;
  insetBlockPx?: number;
  minPx?: number;
}): number {
  const {
    heightPx,
    widthPx,
    advanceEm,
    lineHeight,
    maxPx,
    chars = SENTENCE_CHARS,
    insetInlinePx = 0,
    insetBlockPx = 0,
    minPx = 12,
  } = input;
  if (!(heightPx > 0) || !(widthPx > 0)) return round(Math.max(minPx, maxPx));
  const room = heightPx - insetBlockPx;
  for (let px = maxPx; px > minPx; px -= 0.5) {
    const box = boxWidthPx(px, advanceEm, widthPx - insetInlinePx);
    if (linesAt(px, advanceEm, box, chars) * px * lineHeight <= room)
      return round(px);
  }
  return minPx;
}

/** Width of the sentence box: about 22 characters, never wider than the space. */
export function boxWidthPx(
  fontPx: number,
  advanceEm: number,
  availableWidthPx: number,
): number {
  return Math.round(
    Math.min(BOX_CHARS * advanceEm * fontPx, Math.max(0, availableWidthPx)),
  );
}

/** Ladder start S0 = min(comfort x 10^0.3, S_fit). */
export function ladderStartPx(comfortPx: number, fitPx: number): number {
  return round(Math.min(comfortPx * 10 ** 0.3, fitPx));
}

/** Font size for a target x-height, from a log10 x-height. */
export function fontPxFromLogX(logX: number, xHeightRatio: number): number {
  return 10 ** logX / clamp(xHeightRatio, 0.3, 0.7);
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
