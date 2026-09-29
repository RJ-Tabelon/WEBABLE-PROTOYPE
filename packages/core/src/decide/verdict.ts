import type { PageCategory, PageSignals } from '../page/types';
import type { AnalysisLabel, RegionVerdict } from '../policy/types';
import type { DecideResponse } from './wire';

/** Rule-decided verdict for a region (rulePrecision >= 0.90), else null. */
export function ruleVerdict(_region: PageSignals['regions'][number]): RegionVerdict | null {
  throw new Error('not implemented');
}

export interface Recalibration {
  dimEligible(p: number): number;
  protectedRole(p: number): number;
  taskNeed(p: number): number;
}

/** Identity maps until an isotonic fit exists for the pinned model. */
export const IDENTITY_RECALIBRATION: Recalibration = {
  dimEligible: (p) => p,
  protectedRole: (p) => p,
  taskNeed: (p) => p,
};

/**
 * Map page-analysis answers to verdicts with the veto-first rule
 * (ai-architecture.md 3.5-3.6): protected if P(protected role) >= 0.05 or
 * P(task need) >= 0.20 or a local protective rule fires; feed/search centre
 * columns are protected; else label by P(eligible).
 * `ridToKey` maps ephemeral region ids back to component keys.
 */
export function verdictsFromAnswers(
  _answers: Extract<DecideResponse, { ok: true }>,
  _ridToKey: Record<string, string>,
  _signals: PageSignals,
  _category: PageCategory,
  _cal?: Recalibration,
): Record<string, RegionVerdict> {
  throw new Error('not implemented');
}

export function labelFor(_pEligible: number, _task: number): AnalysisLabel | null {
  throw new Error('not implemented');
}
