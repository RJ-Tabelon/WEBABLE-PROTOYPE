import {
  dayOf,
  type LearnedSummary,
  learnedSummary,
} from '../../../components/app/changes/learned';
import {
  type DataResult,
  fail,
  guarded,
  mapPostgrestError,
  ok,
} from '../../../lib/data/result';
import { getDataContext } from '../../../lib/data/session';

export interface LearnedState extends LearnedSummary {
  /** When the extension last synced what it learned, or null if it never has. */
  updatedAt: string | null;
}

/**
 * The signed-in person's synced learning state, summarized (domain-free: the
 * row holds per-change counts and settled values, never sites). Server only.
 */
export async function getLearnedState(
  now: Date = new Date(),
): Promise<DataResult<LearnedState>> {
  return guarded<LearnedState>('getLearnedState', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { data, error } = await supabase
      .from('learning_state')
      .select('state, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return fail(mapPostgrestError(error));
    if (!data) return ok({ ops: [], dims: [], updatedAt: null });
    return ok({
      ...learnedSummary(data.state, dayOf(now)),
      updatedAt: data.updated_at,
    });
  });
}
