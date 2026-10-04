import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { supabaseEnv, type TestUser } from './env';

/*
 * Domain-free activity and learning for the test user, written through the
 * same RPCs the extension uses (record_activity, put_learning_state). Only op
 * ids, weeks and counts: never sites.
 */

const DAY_MS = 86_400_000;

/** Monday (UTC) of the week containing `date`, as YYYY-MM-DD. */
export function mondayOf(date: Date): string {
  const offset = (date.getUTCDay() + 6) % 7;
  const monday =
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
    offset * DAY_MS;
  return new Date(monday).toISOString().slice(0, 10);
}

async function signedIn(user: TestUser): Promise<SupabaseClient> {
  const { url, key } = supabaseEnv();
  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { error } = await supabase.auth.signInWithPassword(user);
  if (error)
    throw new Error(
      `Test user could not sign in (${error.code ?? 'unknown'}).`,
    );
  return supabase;
}

export const THIS_WEEK = {
  text_floor: { applied: 48, kept: 46, undone: 2 },
  line_spacing: { applied: 12, kept: 11, undone_by_checks: 1 },
  target_size: { applied: 2, kept: 2, offered: 3, accepted: 2 },
} as const;

export const LAST_WEEK = {
  text_floor: { applied: 30, kept: 29, undone: 1 },
} as const;

/** Replace the test user's activity with a known two-week history and learning state. */
export async function seedActivity(
  user: TestUser,
  now: Date = new Date(),
): Promise<void> {
  const supabase = await signedIn(user);
  try {
    const thisWeek = mondayOf(now);
    const lastWeek = mondayOf(new Date(now.getTime() - 7 * DAY_MS));

    const cleared = await supabase
      .from('weekly_activity')
      .delete()
      .gte('week', '2000-01-03');
    if (cleared.error)
      throw new Error(`Could not clear activity (${cleared.error.code}).`);
    for (const [week, counts] of [
      [lastWeek, LAST_WEEK],
      [thisWeek, THIS_WEEK],
    ] as const) {
      const { error } = await supabase.rpc('record_activity', {
        p_week: week,
        p_counts: counts,
      });
      if (error) throw new Error(`Could not record activity (${error.code}).`);
    }

    const today = Math.floor(now.getTime() / DAY_MS);
    const state = {
      v: 1,
      ops: {
        text_floor: { c: { s: 9, f: 1, t: today }, src: 'profile' },
        target_size: { c: { s: 1, f: 5, t: today }, src: 'profile' },
        calm_motion: {
          c: { s: 0, f: 0, t: today },
          src: 'none',
          blocked: true,
        },
      },
      dims: {
        textPx: {
          m: Math.log(20),
          v: 0.01,
          t: today,
          mCal: Math.log(18),
          vCal: 0.02,
        },
      },
    };
    const current = await supabase
      .from('learning_state')
      .select('rev')
      .maybeSingle();
    if (current.error)
      throw new Error(`Could not read learning state (${current.error.code}).`);
    const { error } = await supabase.rpc('put_learning_state', {
      p_state: state,
      p_expected_rev: current.data?.rev ?? 0,
      p_engine_version: 'e2e',
    });
    if (error)
      throw new Error(`Could not save learning state (${error.code}).`);
  } finally {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}

/** Clear what WebAble learned for the test user (an empty learning state). */
export async function clearLearning(user: TestUser): Promise<void> {
  const supabase = await signedIn(user);
  try {
    const current = await supabase
      .from('learning_state')
      .select('rev')
      .maybeSingle();
    if (current.error)
      throw new Error(`Could not read learning state (${current.error.code}).`);
    const { error } = await supabase.rpc('put_learning_state', {
      p_state: { v: 1, ops: {}, dims: {} },
      p_expected_rev: current.data?.rev ?? 0,
      p_engine_version: 'e2e',
    });
    if (error)
      throw new Error(`Could not clear learning state (${error.code}).`);
  } finally {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}
