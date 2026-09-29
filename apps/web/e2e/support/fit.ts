import { createClient } from '@supabase/supabase-js';
import type { FitProfile } from '@webable/core';
import { defaultFitProfile } from '@webable/core/profile/defaults';

import { supabaseEnv, type TestUser } from './env';

/**
 * A fit as Tune would save it: reading and pointing measured, focus skipped.
 * Real, schema-valid values, so every row on "Your fit" has something to show.
 */
export function measuredFit(now: Date = new Date()): FitProfile {
  const p = defaultFitProfile(undefined, now);
  p.calibrationVersion = 'e2e';
  p.modules = { reading: 'measured', pointing: 'measured', focus: 'skipped' };
  p.vision.textMinPx = {
    value: 18,
    source: 'measured',
    confidence: 0.8,
    measured: 18,
  };
  p.vision.contrastFloor = {
    value: 7,
    source: 'measured',
    confidence: 0.7,
    measured: 7,
  };
  p.vision.lineHeight = {
    value: 1.6,
    source: 'measured',
    confidence: 0.6,
    measured: 1.6,
  };
  p.motor.minTargetPx = {
    value: 44,
    source: 'measured',
    confidence: 0.75,
    measured: 44,
  };
  p.confidence = 0.7;
  return p;
}

/**
 * Save `profile` as the current fit for the test user, through the same RPC the
 * app uses (save_fit_profile), signed in as that user. Returns the new version.
 */
export async function seedFit(
  user: TestUser,
  profile: FitProfile = measuredFit(),
): Promise<number> {
  const { url, key } = supabaseEnv();
  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { error: signInError } = await supabase.auth.signInWithPassword(user);
  if (signInError)
    throw new Error(
      `Test user could not sign in (${signInError.code ?? 'unknown'}).`,
    );
  try {
    const { data, error } = await supabase.rpc('save_fit_profile', {
      p_profile: profile,
      p_source: 'calibration',
      p_derivation_version: profile.derivationVersion,
    });
    if (error || !data)
      throw new Error(`Could not seed a fit (${error?.code ?? 'no row'}).`);
    return (data as { version: number }).version;
  } finally {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}
