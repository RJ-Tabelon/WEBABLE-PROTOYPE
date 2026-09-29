import type { MotorSummary } from './schema';
import type { PointerBlock, PointingSession } from './trials';

/** Pointer ladder (CSS px). Touch uses the same ladder but starts at 56. */
export const POINTER_LADDER = [24, 32, 44, 56, 72, 96] as const;

export interface RingStep {
  /** Target size for the next block, or null when the walk is finished. */
  nextPx: number | null;
  /** Whether the block just completed was accepted (cal-motor.md 5.2 rule). */
  accepted: boolean | null;
}

/**
 * Adaptive ladder walk for the pointing ring (cal-motor.md 5.2).
 * Pointer: start 44; accepted -> 32 -> 24; rejected -> 56 -> 72.
 * Touch: start 56; accepted -> 44 (-> 32 only with 0 misses); rejected -> 72 -> 96.
 * Stop at the first rejection when descending or first acceptance when ascending; max 4 blocks.
 */
export function nextRingStep(
  _input: 'pointer' | 'touch',
  _completed: readonly PointerBlock[],
): RingStep {
  throw new Error('not implemented');
}

/** Reduce a pointing session to its persisted summary (cal-motor.md 5.5-5.6). */
export function summarizePointing(_session: PointingSession): MotorSummary {
  throw new Error('not implemented');
}
