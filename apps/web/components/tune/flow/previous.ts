import type { CalibrationRecord, FitProfile } from '@webable/core';
import type { FitRowId } from '@webable/core/profile/describe';

import type { DataResult } from '../../../lib/data/result';
import { keepOldRows } from './adjust';
import { deriveProfile } from './record';

/**
 * Tuning again never silently erases what the person set. Whenever someone
 * signed in has a current fit, Tune derives the new fit with it as `previous`
 * (overrides survive, deriveFitProfile), shows Keep new / Keep old, and saves
 * the result as a recalibration, whatever the entry point (/tune, a link from
 * the app, or /tune/save after a signed-out Tune).
 */

export interface PreviousFit {
  profile: FitProfile;
  /** When it was made (ISO), for "since Sep 12". */
  createdAt: string;
}

/**
 * The current fit to compare against, for a signed-in person. A failed read
 * leaves Tune without a comparison rather than blocking it.
 */
export async function previousFitFor(
  signedIn: boolean,
  load: () => Promise<
    DataResult<{ profile: FitProfile; createdAt: string } | null>
  >,
): Promise<PreviousFit | null> {
  if (!signedIn) return null;
  try {
    const current = await load();
    if (!current.ok || !current.data) return null;
    return {
      profile: current.data.profile,
      createdAt: current.data.createdAt,
    };
  } catch {
    return null;
  }
}

/** Rows where a fit holds a value the person chose (Adjust, or a Tune preview nudge). */
export function overriddenRows(profile: FitProfile): Set<FitRowId> {
  const rows = new Set<FitRowId>();
  const { vision, motor, attention } = profile;
  const set = (source: string, row: FitRowId) => {
    if (source === 'override') rows.add(row);
  };
  set(vision.textMinPx.source, 'textSize');
  set(vision.contrastFloor.source, 'contrast');
  set(vision.polarity.source, 'polarity');
  set(vision.lineHeight.source, 'lineSpacing');
  set(vision.maxLineCh.source, 'lineLength');
  set(motor.minTargetPx.source, 'targets');
  set(motor.steadyClicks.source, 'steadyClicks');
  set(motor.hoverGraceMs.source, 'hoverGrace');
  if (attention.motion.sources.includes('override')) rows.add('motion');
  if (attention.distraction.sources.includes('override')) rows.add('busyPages');
  return rows;
}

/**
 * A fit made while signed out, re-derived against the account's current fit
 * before it is saved: the same answers, with `previous` in the derivation, so
 * the person's earlier choices survive. Choices made in that Tune (Adjust on
 * Your fit) are newer, so they win over the earlier ones.
 */
export function rederivePending(
  pending: { profile: FitProfile; record: CalibrationRecord },
  previous: FitProfile,
  now: Date = new Date(),
): FitProfile {
  const completedAt = pending.record.completedAt ?? now.toISOString();
  const { profile } = deriveProfile({
    device: pending.record.device,
    modules: pending.record.modules,
    startedAt: pending.record.startedAt,
    completedAt,
    previous,
  });
  return keepOldRows(profile, pending.profile, overriddenRows(pending.profile));
}
