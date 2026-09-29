import type { VisionSummary } from './schema';
import type { ReadingSession, ReadingTrial } from './trials';

/** Text sizes step by 0.1 log10 (x1.26). */
export const READING_STEP_LOG = 0.1;

export interface LadderState {
  trials: readonly ReadingTrial[];
  startPx: number;
  maxFitPx: number;
}

/**
 * Next reading-ladder size, or null to stop (cal-vision.md 3, V2: coarse -0.2 log
 * steps while on plateau, then fine 0.1 steps to bracket; stop after 12 trials,
 * a "can't read" below plateau, the 4 px x-height floor, or 40 s).
 */
export function nextReadingSize(_state: LadderState): number | null {
  throw new Error('not implemented');
}

/** QUEST+-style contrast staircase with fixed slope (cal-vision.md 3, V3). */
export interface ContrastStaircase {
  /** Weber contrast (0..1) for the next word. */
  next(): number;
  update(correct: boolean): void;
  done(): boolean;
  estimate(): { alphaLog: number; sd: number; ceiling: boolean; trials: number };
}

export function createContrastStaircase(_opts: { largePrint: boolean }): ContrastStaircase {
  throw new Error('not implemented');
}

/** Reduce a reading session to its persisted summary (cal-vision.md 4). */
export function summarizeReading(_session: ReadingSession): VisionSummary {
  throw new Error('not implemented');
}
