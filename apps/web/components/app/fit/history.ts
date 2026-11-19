import type { FitProfile } from '@webable/core';
import { type FitRow, fitRows } from '@webable/core/profile/describe';
import type { FitValue } from '@webable/ui';

import { formatDay } from '../format';
import { diffValue } from './value';

/**
 * Version history for "Your fit" (design-final.md 9.5): each saved version, when
 * it was saved, where it came from, and which rows it changed compared with the
 * version before it. Pure.
 */

export type FitSourceKind =
  | 'calibration'
  | 'recalibration'
  | 'adjustment'
  | 'learned'
  | 'import'
  | 'restore';

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
  /** The same change as an inline fit value. */
  value: FitValue;
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
  /**
   * What using this version again would change, from the current fit to this
   * one. Null for the current version and for versions that can't be read.
   */
  restore: HistoryChange[] | null;
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
  restore: 'An earlier version, used again',
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
      value: diffValue(row.before, row.after, row.srText),
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
  const current = entries.find((entry) => entry.isCurrent)?.profile ?? null;
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
      restore:
        !entry.isCurrent && entry.profile && current
          ? changedRows(entry.profile, current)
          : null,
      first: isOldest && complete,
      unreadable: entry.profile === null,
    };
  });
}
