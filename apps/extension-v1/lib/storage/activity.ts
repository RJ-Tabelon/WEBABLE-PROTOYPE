import { OP_IDS, type OpId } from '@webable/core/ops/catalog';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { isRecord, JsonStore, ownerField } from './store';

/**
 * Weekly per-op counts for the person's own "Changes" view
 * (`weekly_activity`, 26-week retention). Domain-free: only op ids and
 * counts. Accumulated here and flushed with `record_activity` when signed in.
 */
export const ACTIVITY_FIELDS = [
  'applied',
  'kept',
  'undone',
  'undone_by_checks',
  'offered',
  'accepted',
] as const;
export type ActivityField = (typeof ACTIVITY_FIELDS)[number];
export type WeeklyCounts = Record<ActivityField, number>;

export interface ActivityRecord {
  /** ISO Monday (YYYY-MM-DD, UTC) -> op -> counts not yet flushed. */
  weeks: Record<string, Partial<Record<OpId, WeeklyCounts>>>;
  /** The account these counts belong to (absent: none yet). */
  ownerUserId?: string;
}

export const ACTIVITY_WEEKS_MAX = 26;
const WEEK = /^\d{4}-\d{2}-\d{2}$/;
const OP_SET: ReadonlySet<string> = new Set(OP_IDS);

/** The Monday (UTC) of the week containing `ms`, as YYYY-MM-DD. */
export function isoMonday(ms: number): string {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow),
  );
  return monday.toISOString().slice(0, 10);
}

export const zeroCounts = (): WeeklyCounts => ({
  applied: 0,
  kept: 0,
  undone: 0,
  undone_by_checks: 0,
  offered: 0,
  accepted: 0,
});

export function normalizeActivity(raw: unknown): ActivityRecord {
  if (!isRecord(raw)) return { weeks: {} };
  const out: ActivityRecord = { weeks: {}, ...ownerField(raw) };
  if (!isRecord(raw.weeks)) return out;
  for (const [week, ops] of Object.entries(raw.weeks)) {
    if (!WEEK.test(week) || !isRecord(ops)) continue;
    const clean: Partial<Record<OpId, WeeklyCounts>> = {};
    for (const [op, c] of Object.entries(ops)) {
      if (!OP_SET.has(op) || !isRecord(c)) continue;
      const counts = zeroCounts();
      for (const f of ACTIVITY_FIELDS) {
        const n = c[f];
        counts[f] = typeof n === 'number' && n > 0 ? Math.round(n) : 0;
      }
      clean[op as OpId] = counts;
    }
    out.weeks[week] = clean;
  }
  return out;
}

/** Add to one counter. Pure; keeps at most the newest 26 weeks. */
export function addActivity(
  rec: ActivityRecord,
  at: number,
  op: OpId,
  field: ActivityField,
  n = 1,
): ActivityRecord {
  const week = isoMonday(at);
  const weeks = structuredClone(rec.weeks);
  const ops = (weeks[week] ??= {});
  const counts = (ops[op] ??= zeroCounts());
  counts[field] = Math.min(10_000, counts[field] + Math.max(0, Math.round(n)));
  const kept = Object.keys(weeks).sort().slice(-ACTIVITY_WEEKS_MAX);
  return {
    ...rec,
    weeks: Object.fromEntries(kept.map((w) => [w, weeks[w]!])),
  };
}

/** Remove counts that were flushed (subtracting, so concurrent adds survive). */
export function subtractFlushed(
  rec: ActivityRecord,
  week: string,
  flushed: Partial<Record<OpId, WeeklyCounts>>,
): ActivityRecord {
  const weeks = structuredClone(rec.weeks);
  const ops = weeks[week];
  if (!ops) return rec;
  for (const [op, sent] of Object.entries(flushed)) {
    const cur = ops[op as OpId];
    if (!cur || !sent) continue;
    for (const f of ACTIVITY_FIELDS) cur[f] = Math.max(0, cur[f] - sent[f]);
    if (ACTIVITY_FIELDS.every((f) => cur[f] === 0)) delete ops[op as OpId];
  }
  if (Object.keys(ops).length === 0) delete weeks[week];
  return { ...rec, weeks };
}

export function activityStore(area: KvArea): JsonStore<ActivityRecord> {
  return new JsonStore(area, KEYS.activity, normalizeActivity);
}

/** Offers shown today (the daily budget, K.OFFERS_PER_DAY). */
export interface OfferBudget {
  day: number;
  count: number;
}

export function offerBudgetStore(area: KvArea): JsonStore<OfferBudget> {
  return new JsonStore(area, KEYS.offers, (raw) =>
    isRecord(raw) &&
    typeof raw.day === 'number' &&
    typeof raw.count === 'number'
      ? { day: raw.day, count: Math.max(0, raw.count) }
      : { day: 0, count: 0 },
  );
}

export function offersToday(b: OfferBudget, day: number): number {
  return b.day === day ? b.count : 0;
}
