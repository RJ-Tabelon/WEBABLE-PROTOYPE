import type { CalibrationRecord, FitProfile } from '@webable/core';

import type {
  CalibrationSessionRef,
  CompleteCalibrationInput,
  CompletedCalibrationSession,
  DataResult,
  FitVersion,
  SaveFitInput,
  StartCalibrationInput,
} from '../../../lib/data';

/**
 * Saving a finished Tune to the account (signed in, or on /tune/save after
 * sign-in). Only the module summaries and coarse device buckets go to the
 * calibration session, and the derived fit to fit_profiles; raw trials never
 * leave the browser. Pure orchestration over the Server Actions, so it can be
 * tested with fakes.
 */

/** The Server Actions Tune uses (lib/data/actions). */
export interface TuneServerActions {
  startCalibrationSession: (
    input: StartCalibrationInput,
  ) => Promise<DataResult<CalibrationSessionRef>>;
  completeCalibrationSession: (
    input: CompleteCalibrationInput,
  ) => Promise<DataResult<CompletedCalibrationSession>>;
  saveFit: (input: SaveFitInput) => Promise<DataResult<FitVersion>>;
  abandonCalibrationSession: (input: {
    id: string;
  }) => Promise<DataResult<{ id: string }>>;
}

export type FitSaveSource = 'calibration' | 'recalibration';

export type PersistOutcome =
  | { kind: 'saved'; fit: FitVersion; sessionId: string | null }
  /** The session ended: keep the fit in this browser and sign in again. */
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

export const UNREACHABLE_MESSAGE =
  'WebAble couldn’t reach its server. Nothing changed. Try again in a moment.';

export interface PersistInput {
  profile: FitProfile;
  record: CalibrationRecord;
  source: FitSaveSource;
  /** A session opened when Tune began, if that worked. */
  sessionId?: string | null;
}

async function openSession(
  actions: TuneServerActions,
  record: CalibrationRecord,
): Promise<{ id: string | null; signedOut: boolean }> {
  const started = await actions.startCalibrationSession({
    device: record.device,
  });
  if (started.ok) return { id: started.data.id, signedOut: false };
  return { id: null, signedOut: started.error.code === 'not_signed_in' };
}

/**
 * Close the calibration session with the summaries, then save the fit as the
 * new current version. A session that cannot be recorded never blocks the fit:
 * the fit is saved without a session link.
 */
export async function persistFit(
  actions: TuneServerActions,
  input: PersistInput,
): Promise<PersistOutcome> {
  try {
    let id = input.sessionId ?? null;
    if (!id) {
      const opened = await openSession(actions, input.record);
      if (opened.signedOut) return { kind: 'signed-out' };
      id = opened.id;
    }

    let sessionId: string | null = null;
    if (id) {
      let completed = await actions.completeCalibrationSession({
        id,
        modules: input.record.modules,
      });
      if (!completed.ok && completed.error.code === 'not_signed_in')
        return { kind: 'signed-out' };
      // The session opened at the start was closed meanwhile: open a fresh one once.
      if (!completed.ok && completed.error.code === 'not_found') {
        const opened = await openSession(actions, input.record);
        if (opened.signedOut) return { kind: 'signed-out' };
        if (opened.id) {
          completed = await actions.completeCalibrationSession({
            id: opened.id,
            modules: input.record.modules,
          });
        }
      }
      if (completed.ok) sessionId = completed.data.id;
    }

    const saved = await actions.saveFit({
      profile: input.profile,
      source: input.source,
      calibrationSessionId: sessionId,
    });
    if (saved.ok) return { kind: 'saved', fit: saved.data, sessionId };
    if (saved.error.code === 'not_signed_in') return { kind: 'signed-out' };
    return { kind: 'error', message: saved.error.message };
  } catch {
    return { kind: 'error', message: UNREACHABLE_MESSAGE };
  }
}

/** Best effort: mark a session the person left as abandoned. Never throws. */
export async function abandonSession(
  actions: TuneServerActions,
  id: Promise<string | null> | null,
): Promise<void> {
  try {
    const resolved = id ? await id : null;
    if (resolved) await actions.abandonCalibrationSession({ id: resolved });
  } catch {
    // Nothing to do: an open session simply stays unfinished.
  }
}
