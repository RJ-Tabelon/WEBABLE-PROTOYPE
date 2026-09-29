import type { SystemSignals } from '../profile/defaults';
import type { FitProfile } from '../profile/schema';
import type { CalibrationRecord } from './schema';

export interface DeriveInput {
  record: CalibrationRecord;
  system: SystemSignals;
  /** The previous profile when recalibrating; its overrides are preserved. */
  previous?: FitProfile;
  now?: Date;
}

/**
 * Pure, deterministic, versioned derivation of the fit profile from
 * calibration summaries (cal-motor.md 5.7, cal-vision.md 4, cal-attention.md 5-6).
 * Skipped modules keep defaults (or the previous profile's values).
 */
export function deriveFitProfile(_input: DeriveInput): FitProfile {
  throw new Error('not implemented');
}
