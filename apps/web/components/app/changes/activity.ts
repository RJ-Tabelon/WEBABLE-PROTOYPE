import { OP_CATALOG, OP_IDS, type OpId } from '@webable/core';

import { plural } from '../format';

/**
 * The "Changes" page as one sentence and one table per kind of change
 * (design-final.md 7.9: documents, not dashboards). Domain-free: the rows carry
 * only weeks and op ids. Pure.
 *
 * Vocabulary (design-final.md 13.2): the person *undid* a change; a change was
 * *undone* when WebAble's own checks reversed it.
 */

export interface Counts {
  applied: number;
  kept: number;
  undone: number;
  undoneByChecks: number;
  offered: number;
  accepted: number;
}

export interface ActivityRow extends Counts {
  week: string;
  op: string;
}

export interface ActivityItem {
  /** An op id, or "other" for ids this app version doesn't know. */
  key: OpId | 'other';
  label: string;
  counts: Counts;
}

export function zeroCounts(): Counts {
  return {
    applied: 0,
    kept: 0,
    undone: 0,
    undoneByChecks: 0,
    offered: 0,
    accepted: 0,
  };
}

function add(into: Counts, from: Counts): void {
  into.applied += from.applied;
  into.kept += from.kept;
  into.undone += from.undone;
  into.undoneByChecks += from.undoneByChecks;
  into.offered += from.offered;
  into.accepted += from.accepted;
}

function isOpId(value: string): value is OpId {
  return (OP_IDS as readonly string[]).includes(value);
}

function isEmpty(c: Counts): boolean {
  return c.applied + c.undone + c.undoneByChecks + c.offered + c.accepted === 0;
}

/** Group rows by op (known ops by catalog order, then "Other changes"). */
export function groupByOp(rows: readonly ActivityRow[]): ActivityItem[] {
  const byOp = new Map<OpId | 'other', Counts>();
  for (const row of rows) {
    const key = isOpId(row.op) ? row.op : 'other';
    const counts = byOp.get(key) ?? zeroCounts();
    add(counts, row);
    byOp.set(key, counts);
  }
  const items: ActivityItem[] = [];
  for (const [key, counts] of byOp) {
    if (isEmpty(counts)) continue;
    items.push({
      key,
      label: key === 'other' ? 'Other changes' : OP_CATALOG[key].label,
      counts,
    });
  }
  const order = (key: OpId | 'other') =>
    key === 'other'
      ? OP_IDS.length
      : (OP_IDS as readonly string[]).indexOf(key);
  // Most-used first; the catalog order breaks ties so the list is stable.
  return items.sort(
    (a, b) =>
      b.counts.applied - a.counts.applied || order(a.key) - order(b.key),
  );
}

/** Totals over rows. */
export function totalsOf(rows: readonly Counts[]): Counts {
  const totals = zeroCounts();
  for (const row of rows) add(totals, row);
  return totals;
}

/** Rows for one week (YYYY-MM-DD Monday). */
export function rowsForWeek(
  rows: readonly ActivityRow[],
  week: string,
): ActivityRow[] {
  return rows.filter((row) => row.week === week);
}

/* ------------------------------------------------------------------------ */
/* One table for the period (design-final §7.9: one document, no tiles)       */
/* ------------------------------------------------------------------------ */

export interface ActivityTableRow {
  key: OpId | 'other';
  label: string;
  /** Counts for the current week. */
  week: Counts;
  /** Counts for the whole period (e.g. 8 weeks). */
  period: Counts;
}

/**
 * One row per kind of change over the period, most applied first, with this
 * week's counts beside it. Kinds with nothing in the period are left out.
 */
export function activityTable(
  rows: readonly ActivityRow[],
  thisWeek: string,
): ActivityTableRow[] {
  const week = new Map(
    groupByOp(rowsForWeek(rows, thisWeek)).map((item) => [
      item.key,
      item.counts,
    ]),
  );
  return groupByOp(rows).map((item) => ({
    key: item.key,
    label: item.label,
    week: week.get(item.key) ?? zeroCounts(),
    period: item.counts,
  }));
}

/**
 * This week in one sentence: "62 changes this week. You undid 2, and
 * WebAble’s checks undid 1." Undo by the person and by the checks are told
 * apart (design-final §13.2).
 */
export function weekSentence(week: Counts): string {
  if (week.applied === 0) return 'No changes this week.';
  const made = `${plural(week.applied, 'change')} this week.`;
  const one = week.applied === 1;
  if (week.undone > 0 && week.undoneByChecks > 0)
    return `${made} You undid ${week.undone}, and WebAble’s checks undid ${week.undoneByChecks}.`;
  if (week.undone > 0) return `${made} You undid ${one ? 'it' : week.undone}.`;
  if (week.undoneByChecks > 0)
    return `${made} WebAble’s checks undid ${one ? 'it' : week.undoneByChecks}.`;
  return `${made} You kept ${one ? 'it' : 'every one'}.`;
}

/** "Asked first: 3 · you said yes to 2", or null when WebAble never asked. */
export function askedLine(counts: Counts): string | null {
  if (counts.offered === 0) return null;
  return `Asked first: ${counts.offered} · you said yes to ${counts.accepted}`;
}

/** The narrow form of a table row: "48 this week · 78 in 8 weeks". */
export function narrowCounts(row: ActivityTableRow, weeks: number): string {
  const parts = [
    `${row.week.applied} this week`,
    `${row.period.applied} in ${weeks} weeks`,
  ];
  if (row.period.undone > 0) parts.push(`you undid ${row.period.undone}`);
  if (row.period.undoneByChecks > 0)
    parts.push(`checks undid ${row.period.undoneByChecks}`);
  return parts.join(' · ');
}
