import type { FitProfile } from '@webable/core';
import { type FitRow, fitRows } from '@webable/core/profile/describe';

import { formatDay } from '../format';

/**
 * Version history for "Your fit" (design-final.md 9.5): each saved version, when
 * it was saved, where it came from, and which rows it changed compared with the
 * version before it. Pure.
 */

export type FitSourceKind =
  'calibration' | 'recalibration' | 'adjustment' | 'learned' | 'import';

export interface HistoryInput {
  id: string;
  version: number;
  source: FitSourceKind;
  createdAt: string;
  isCurrent: boolean;
  profile: FitProfile | null;
}

export interface HistoryChange {
  id: FitRow['id'];
  label: string;
  before: string;
  after: string;
  srText: string;
}

export interface HistoryItem {
  id: string;
  version: number;
  /** "From Tune", "Tuned again", "Adjusted by you"… */
  sourceLabel: string;
  /** "Sep 29, 2026" */
  date: string;
  /** ISO timestamp for <time dateTime>. */
  dateTime: string;
  isCurrent: boolean;
  /** Rows that differ from the previous version. Empty for the first version. */
  changes: HistoryChange[];
  /** True for the oldest version shown when nothing older exists. */
  first: boolean;
  /** The saved profile no longer matches the schema (an older app version). */
  unreadable: boolean;
}

const SOURCE_LABELS: Readonly<Record<FitSourceKind, string>> = {
  calibration: 'From Tune',
  recalibration: 'Tuned again',
  adjustment: 'Adjusted by you',
  learned: 'Learned as you browse',
  import: 'Imported',
};

export function sourceLabel(source: FitSourceKind): string {
  return SOURCE_LABELS[source];
}

/** Rows that changed from `previous` to `current`. */
export function changedRows(
  current: FitProfile,
  previous: FitProfile,
): HistoryChange[] {
  return fitRows(current, previous)
    .filter((row) => row.changed)
    .map((row) => ({
      id: row.id,
      label: row.label,
      before: row.before,
      after: row.after,
      srText: row.srText,
    }));
}

/**
 * History items, newest first. `entries` must be newest first (as listFitHistory
 * returns them); `complete` says whether the oldest entry is the person's first.
 */
export function describeHistory(
  entries: readonly HistoryInput[],
  complete: boolean,
): HistoryItem[] {
  return entries.map((entry, index) => {
    const previous = entries[index + 1];
    const isOldest = previous === undefined;
    const changes =
      entry.profile && previous?.profile
        ? changedRows(entry.profile, previous.profile)
        : [];
    return {
      id: entry.id,
      version: entry.version,
      sourceLabel: sourceLabel(entry.source),
      date: formatDay(entry.createdAt),
      dateTime: entry.createdAt,
      isCurrent: entry.isCurrent,
      changes,
      first: isOldest && complete,
      unreadable: entry.profile === null,
    };
  });
}
