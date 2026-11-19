import { z } from 'zod';

import {
  type DataResult,
  fail,
  guarded,
  issuePaths,
  mapPostgrestError,
  ok,
} from './result';
import { getDataContext } from './session';

/*
 * Weekly per-op counts for the person's own "Changes" view. Domain-free: no
 * sites or URLs are stored. The server keeps 26 weeks.
 */

export const ACTIVITY_MAX_WEEKS = 26;

export interface ActivityCounts {
  applied: number;
  kept: number;
  undone: number;
  /** Reversed by WebAble's own checks, not by the person. */
  undoneByChecks: number;
  offered: number;
  accepted: number;
}

export interface WeeklyActivityRow extends ActivityCounts {
  /** Monday of the ISO week, YYYY-MM-DD. */
  week: string;
  op: string;
}

export interface WeeklyActivity {
  /** Every Monday in the range, oldest first, including weeks with no rows. */
  weeks: string[];
  rows: WeeklyActivityRow[];
  totals: ActivityCounts;
}

const DAY_MS = 86_400_000;

/** Monday (UTC) of the week containing `date`, as YYYY-MM-DD. */
export function mondayOf(date: Date): string {
  const day = date.getUTCDay(); // 0 = Sunday
  const offset = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      offset * DAY_MS,
  );
  return monday.toISOString().slice(0, 10);
}

/** The last `count` Mondays up to and including this week's, oldest first. */
export function recentMondays(count: number, now: Date = new Date()): string[] {
  const current = Date.parse(`${mondayOf(now)}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(current - (count - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10),
  );
}

export function emptyCounts(): ActivityCounts {
  return {
    applied: 0,
    kept: 0,
    undone: 0,
    undoneByChecks: 0,
    offered: 0,
    accepted: 0,
  };
}

export const weeklyActivityOptionsSchema = z.strictObject({
  weeks: z.int().min(1).max(ACTIVITY_MAX_WEEKS).default(8),
});

/** Activity for the last N weeks (default 8, at most 26). */
export async function getWeeklyActivity(
  options: z.input<typeof weeklyActivityOptionsSchema> = {},
  now: Date = new Date(),
): Promise<DataResult<WeeklyActivity>> {
  const parsed = weeklyActivityOptionsSchema.safeParse(options);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));
  const weeks = recentMondays(parsed.data.weeks, now);
  const since = weeks[0] as string;

  return guarded('getWeeklyActivity', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { data, error } = await supabase
      .from('weekly_activity')
      .select(
        'week, op, applied, kept, undone, undone_by_checks, offered, accepted',
      )
      .eq('user_id', user.id)
      .gte('week', since)
      .order('week', { ascending: true })
      .order('op', { ascending: true });
    if (error) return fail(mapPostgrestError(error));

    const totals = emptyCounts();
    const rows = data.map((row): WeeklyActivityRow => {
      const counts: ActivityCounts = {
        applied: row.applied,
        kept: row.kept,
        undone: row.undone,
        undoneByChecks: row.undone_by_checks,
        offered: row.offered,
        accepted: row.accepted,
      };
      for (const key of Object.keys(totals) as (keyof ActivityCounts)[])
        totals[key] += counts[key];
      return { week: row.week, op: row.op, ...counts };
    });

    return ok({ weeks, rows, totals });
  });
}
