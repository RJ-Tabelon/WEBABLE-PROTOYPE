import type { DimId, OpId } from '../ops/catalog';
import type { FitProfile, NeedLevels } from '../profile/schema';
import type { PageCategory } from '../page/types';
import type {
  AdaptEvent,
  Counts,
  Day,
  DomainState,
  LearnDelta,
  UserLearningState,
} from './types';

/** Integer day since epoch for a timestamp in ms. */
export function toDay(ms: number): Day {
  return Math.floor(ms / 86_400_000);
}

/** Exponential decay of counts to `now` with half-life K.H_DAYS. */
export function decay(_c: Counts, _now: Day): Counts {
  throw new Error('not implemented');
}

/**
 * Fresh learning state seeded from a fit profile: op sources ('profile' when the
 * profile's need levels switch the op on, 'system' for OS preferences) and
 * Learner B dimensions centred on profile values (mCal/vCal from calibration confidence).
 */
export function initialLearningState(_profile: FitProfile, _needs: NeedLevels, _now: Day): UserLearningState {
  throw new Error('not implemented');
}

/**
 * Re-seed an existing state after recalibration: keep counts, reset dimension means
 * toward the new calibration with its confidence, keep user blocks/pins.
 */
export function reseedFromProfile(
  _state: UserLearningState,
  _profile: FitProfile,
  _needs: NeedLevels,
  _now: Day,
): UserLearningState {
  throw new Error('not implemented');
}

export interface DesirabilityContext {
  needs: NeedLevels;
  category: PageCategory;
  /** Calibration confidence, or null for an uncalibrated (tier 0) person. */
  profileConfidence: number | null;
}

/** Learner A: posterior mean desirability, personal and shrunk-to-domain (personalization.md 3, 11). */
export function desirability(
  _u: UserLearningState,
  _d: DomainState | undefined,
  _op: OpId,
  _ctx: DesirabilityContext,
  _now: Day,
): { personal: number; mean: number } {
  throw new Error('not implemented');
}

/** Engine reliability on this site from the verifier channel (never preference). */
export function engineReliability(
  _d: DomainState | undefined,
  _op: OpId,
  _category: PageCategory,
  _now: Day,
): number {
  throw new Error('not implemented');
}

/**
 * Apply one local event to personal + domain state (personalization.md 4, 11 onEvent).
 * Returns domain-free deltas to queue for sync.
 */
export function applyEvent(
  _u: UserLearningState,
  _d: DomainState,
  _ev: AdaptEvent,
): { user: UserLearningState; domain: DomainState; deltas: LearnDelta[] } {
  throw new Error('not implemented');
}

/** Learner B: nearest reviewed level for an op with hysteresis (personalization.md 7.5). */
export function chooseLevel(
  _u: UserLearningState,
  _d: DomainState | undefined,
  _op: OpId,
  _currentLevel: number | null,
  _now: Day,
): number {
  throw new Error('not implemented');
}

/** Learner B estimate for a dimension in natural units (e.g. 18.4 px). */
export function dimensionEstimate(_u: UserLearningState, _dim: DimId): { value: number; sd: number } {
  throw new Error('not implemented');
}

/**
 * Merge domain-free deltas into canonical state (G-counter for counts; Kalman
 * observations replayed in day order). Idempotent: deltas already applied
 * (by deltaId) are ignored. Used by the extension before pushing with
 * optimistic concurrency.
 */
export function mergeDeltas(
  _base: UserLearningState,
  _deltas: readonly LearnDelta[],
  _applied: ReadonlySet<string>,
): UserLearningState {
  throw new Error('not implemented');
}
