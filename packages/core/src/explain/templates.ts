import type { AppliedChange, DecisionTrace } from '../policy/types';

/**
 * "Why this changed": deterministic templates rendered from the DecisionTrace.
 * Faithful by construction. Never names a condition, never claims conformance,
 * says "page analysis" (not "AI decided"), always implies undo is available.
 */
export interface Explanation {
  /** e.g. "Text size" */
  title: string;
  /** e.g. "Most text here was 13 px. WebAble raised it to your 18 px." */
  detail: string;
}

export function explainChange(_change: AppliedChange): Explanation {
  throw new Error('not implemented');
}

/** The question shown for an offer: "Buttons on this page are small. Make them bigger here?" */
export function offerQuestion(_trace: DecisionTrace): { question: string; reason: string } {
  throw new Error('not implemented');
}

/** Neutral copy for a change the checks undid: "Line spacing was undone. It made text overlap here…" */
export function explainUndone(_change: AppliedChange): Explanation {
  throw new Error('not implemented');
}
