import type { InputClass } from '../profile/schema';

/**
 * Raw per-trial records produced by the calibration UI (apps/web, /tune).
 * They exist only in memory for the duration of a session and are reduced to
 * the summaries in ./schema.ts before anything is stored or sent.
 */

export interface Point {
  x: number;
  y: number;
}

/** One click in the pointing ring. Coordinates are CSS px relative to the stage. */
export interface PointerTrial {
  targetPx: number;
  targetCenter: Point;
  start: Point;
  /** performance.now() timestamps */
  tStart: number;
  tDown: number;
  tUp: number;
  down: Point;
  up: Point;
  hitDown: boolean;
  hitUp: boolean;
  pressMs: number;
  /** Max distance travelled while the button was held. */
  pressPathMaxPx: number;
  /** Mean speed over the 50 ms before pointerdown, px/ms. */
  speedAtDown: number;
  /** Additional presses that followed this one before the next trial began. */
  extraPresses: Array<{ dtMs: number; distPx: number; sameTarget: boolean }>;
  pointerType: 'mouse' | 'pen' | 'touch';
  /** First click of each block positions the pointer and is not scored. */
  scored: boolean;
  /** Times the pointer entered the target before pressing (hover settling). */
  nEntries?: number;
  /** Final entry to pointerdown, ms. */
  verifMs?: number;
}

export interface PointerBlock {
  targetPx: number;
  trials: PointerTrial[];
}

export interface HoldTrial {
  /** p95 distance from the hold centroid after a 300 ms settle, CSS px. */
  jitterP95Px: number;
  exits: number;
  /** The click that followed the hold. */
  click?: PointerTrial;
}

export interface DragTrial {
  success: boolean;
  earlyRelease: boolean;
  regrabs: number;
  moveMs: number;
}

export interface PointingSession {
  input: InputClass;
  blocks: PointerBlock[];
  holds: HoldTrial[];
  drags: DragTrial[] | 'skipped';
  /** Return block at the starting size (fatigue check), if run. */
  returnBlock: PointerBlock | null;
  chosenPx: number | null;
  express: boolean;
  durationSec: number;
}

export interface ReadingTrial {
  fontPx: number;
  xHeightPx: number;
  words: number;
  response: 'true' | 'false' | 'cant';
  correct: boolean;
  /** Onset (first rAF after paint) to response. */
  rtMs: number;
  /** Zoom or visibility changed during the trial. */
  disturbed: boolean;
}

export interface ContrastTrial {
  /** Weber contrast of the word, 0..1. */
  weber: number;
  correct: boolean;
  cantSee: boolean;
}

export interface PolarityTrial {
  polarity: 'light' | 'dark';
  words: number;
  rtMs: number;
  correct: boolean;
}

export interface ReadingSession {
  comfortPx: number | null;
  ladder: ReadingTrial[];
  contrast: ContrastTrial[];
  polarity: PolarityTrial[];
  statedPolarity: 'light' | 'dark' | 'same' | null;
  overrides: { textPx?: number; polarity?: 'light' | 'dark' | 'none'; moreSpacing?: boolean };
  referenceXHeightRatio: number;
  displayLimited: boolean;
  durationSec: number;
}

export interface SearchTrial {
  clutter: 'clean' | 'busy';
  motion: 'still' | 'animated' | 'salient';
  rtMs: number;
  firstClickCorrect: boolean;
  timedOut: boolean;
  /** Predicted pointer movement time from the pointing module, if known. */
  predictedMoveMs: number;
}

export interface NextActionTrial {
  hierarchy: 'weak' | 'strong';
  rtMs: number;
  firstClick: 'target' | 'decoy' | 'other';
}

export interface FindTextTrial {
  format: 'dense' | 'chunked';
  rtMs: number;
  correct: boolean;
}

export interface FocusSession {
  motionShown: boolean;
  stopMotionPressed: boolean;
  search: SearchTrial[];
  nextAction: NextActionTrial[];
  findText: FindTextTrial[];
  preferences: {
    still: number | null;
    clean: number | null;
    chunked: number | null;
    hierarchy: number | null;
  };
  chips: Array<'moving' | 'busy' | 'long_text' | 'unclear_action' | 'nothing'>;
  durationSec: number;
}
