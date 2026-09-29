import { OP_CATALOG, OP_IDS, type OpId } from '@webable/core';

import { plural, times } from '../format';

/**
 * The "Changes" page as calm sentences and a short list per kind of change
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
  /** "Applied 48 times · you undid it twice" */
  detail: string;
}

export interface ActivitySummary {
  sentences: string[];
  items: ActivityItem[];
  totals: Counts;
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

/** One line of detail for a kind of change. */
export function detailFor(c: Counts): string {
  const parts: string[] = [];
  if (c.applied > 0) parts.push(`Applied ${times(c.applied)}`);
  if (c.undone > 0) parts.push(`you undid it ${times(c.undone)}`);
  if (c.undoneByChecks > 0)
    parts.push(`undone ${times(c.undoneByChecks)} by WebAble’s checks`);
  if (c.offered > 0) {
    const yes =
      c.accepted > 0 ? `you said yes ${times(c.accepted)}` : 'you said not now';
    parts.push(`asked ${times(c.offered)}, ${yes}`);
  }
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
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
      detail: detailFor(counts),
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

/** Calm sentences about a period ("this week", "in the last 8 weeks"). */
export function sentencesFor(totals: Counts, period: string): string[] {
  if (isEmpty(totals)) return [];
  const out: string[] = [];
  if (totals.applied > 0) {
    out.push(`WebAble made ${plural(totals.applied, 'change')} ${period}.`);
    const one = totals.applied === 1;
    if (totals.undone > 0)
      out.push(one ? 'You undid it.' : `You undid ${totals.undone} of them.`);
    else if (totals.undoneByChecks > 0)
      out.push(one ? 'You didn’t undo it.' : 'You didn’t undo any of them.');
    else out.push(one ? 'You kept it.' : 'You kept every one of them.');
  }
  if (totals.undoneByChecks > 0) {
    // "Undone" means reversed by WebAble's own checks (design-final.md 13.2).
    out.push(
      totals.undoneByChecks === 1
        ? 'WebAble’s checks put 1 back because it didn’t fit the page.'
        : `WebAble’s checks put ${totals.undoneByChecks} back because they didn’t fit the page.`,
    );
  }
  if (totals.offered > 0) {
    out.push(
      `WebAble asked before ${plural(totals.offered, 'change')}. You said yes to ${totals.accepted}.`,
    );
  }
  return out;
}

export function summarize(
  rows: readonly ActivityRow[],
  period: string,
): ActivitySummary {
  const totals = zeroCounts();
  for (const row of rows) add(totals, row);
  return {
    sentences: sentencesFor(totals, period),
    items: groupByOp(rows),
    totals,
  };
}

/** Rows for one week (YYYY-MM-DD Monday). */
export function rowsForWeek(
  rows: readonly ActivityRow[],
  week: string,
): ActivityRow[] {
  return rows.filter((row) => row.week === week);
}
