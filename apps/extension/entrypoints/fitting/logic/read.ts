// Read: sizing the sentence card and scaling times. Core's ReadPosterior picks the sizes and decides when to stop.

/** Fixed decision and press time, seconds (core uses the same). */
export const T0_S = 0.6;
/** Times are reported as if every sentence had 56 characters, so length differences cancel. */
export const STANDARD_CHARS = 56;

/** Reading time scaled to a standard-length sentence, keeping the fixed press time. */
export function normalizedMs(chars: number, rtMs: number): number {
  const t = Math.max(0, rtMs / 1000 - T0_S);
  return Math.round((T0_S + (t * STANDARD_CHARS) / Math.max(1, chars)) * 1000);
}

/**
 * The largest sentence size (CSS px) that fits the card: at least `minCh` characters per line, and the longest sentence
 * (58 characters) inside the card's height at line height 1.25.
 */
export function maxSentenceCss(cardW: number, cardH: number, charRatio: number, minCh = 13): number {
  let best = 16;
  for (let s = 16; s <= 200; s += 1) {
    const cpl = cardW / (charRatio * s);
    if (cpl < minCh) break;
    const lines = Math.ceil(58 / Math.max(1, cpl - 2)); // word wrap loses about two characters a line
    if (lines * 1.25 * s > cardH) break;
    best = s;
  }
  return best;
}

/** R2's ladder (onboarding spec): start a step above the comfortable size, then 0.1 log smaller each sentence. */
export const LADDER = {
  stepLog: 0.1,
  maxSentences: 9,
  maxActiveMs: 35_000,
  missesInRow: 2,
  /** Never smaller than this (px at 100%): below it nobody reads, and the stop rule has already fired. */
  floorPx: 6,
} as const;

/** The first sentence's size (px at 100%): just above the comfortable size, or above 20 px when none is known. */
export function ladderStartPx(seedPx: number | null, priorPx: number | null): number {
  const base = seedPx ?? priorPx ?? 20;
  return Math.round(Math.min(120, Math.max(12, base * 10 ** LADDER.stepLog)) * 10) / 10;
}

/** Size of sentence n (0-based) on the ladder. */
export function ladderPx(startPx: number, n: number): number {
  return Math.round(startPx * 10 ** (-LADDER.stepLog * n) * 10) / 10;
}

/** Why the ladder stops after these answers, or null to go on. A miss is a wrong answer or "I can't read it". */
export function ladderStop(
  trials: ReadonlyArray<{ correct: boolean }>,
  activeMs: number,
  nextPx: number,
): 'max_trials' | 'time' | 'reversal' | 'ladder_end' | null {
  const n = trials.length;
  if (n >= LADDER.maxSentences) return 'max_trials';
  if (n >= LADDER.missesInRow && trials.slice(-LADDER.missesInRow).every((t) => !t.correct)) return 'reversal';
  if (activeMs >= LADDER.maxActiveMs) return 'time';
  if (nextPx < LADDER.floorPx) return 'ladder_end';
  return null;
}
