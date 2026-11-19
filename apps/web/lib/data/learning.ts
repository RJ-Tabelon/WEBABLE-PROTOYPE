import {
  type Json,
  LEARNING_VERSION,
  toDay,
  type UserLearningState,
} from '@webable/core';
import {
  forgetAllLearning,
  isLearnedKey,
  isUserLearningState,
  resetLearnedKey,
} from '@webable/core/learning/reset';

import {
  type DataResult,
  fail,
  guarded,
  mapPostgrestError,
  ok,
} from './result';
import { getDataContext } from './session';

/** One write, then one retry after a conflict (another device wrote first). */
const MAX_ATTEMPTS = 2;

type Transform = (state: UserLearningState) => UserLearningState;

/**
 * Read the signed-in person's learning state, apply `transform`, and write it
 * with put_learning_state at the revision read. No state row: nothing was
 * learned, so there is nothing to clear.
 */
async function rewriteLearning(
  label: string,
  transform: Transform,
): Promise<DataResult<null>> {
  return guarded(label, async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data: row, error } = await supabase
        .from('learning_state')
        .select('state, rev')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) return fail(mapPostgrestError(error));
      if (!row) return ok(null);
      if (!isUserLearningState(row.state)) return fail('invalid_data');

      const { data, error: putError } = await supabase.rpc(
        'put_learning_state',
        {
          p_state: transform(row.state) as unknown as Json,
          p_expected_rev: row.rev,
          p_engine_version: LEARNING_VERSION,
        },
      );
      if (putError) return fail(mapPostgrestError(putError));
      const result = Array.isArray(data) ? data[0] : null;
      if (result?.ok) return ok(null);
    }
    return fail('conflict');
  });
}

/** Clear what was learned for one op (Beta counts, global disable) or one dimension. */
export async function resetLearned(key: string): Promise<DataResult<null>> {
  if (!isLearnedKey(key)) return fail('invalid_input', ['key']);
  return rewriteLearning('resetLearned', (state) =>
    resetLearnedKey(state, key, toDay(Date.now())),
  );
}

/** Forget everything WebAble learned for this account. The fit stays. */
export async function forgetLearning(): Promise<DataResult<null>> {
  return rewriteLearning('forgetLearning', (state) =>
    forgetAllLearning(state, toDay(Date.now())),
  );
}
