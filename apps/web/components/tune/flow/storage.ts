import {
  calibrationModulesSchema,
  calibrationRecordSchema,
  fitProfileSchema,
  type CalibrationRecord,
  type FitProfile,
} from '@webable/core';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

import type { TuneStash } from './machine';

/**
 * What Tune keeps in this browser, and only here:
 *
 * - `wa-tune-pending-v1`: a finished fit made while signed out. /tune/save
 *   stores it in the account after sign-in and then removes it. `usePendingFit`
 *   follows it across tabs so nothing made here is forgotten.
 * - `wa-tune-progress-v1`: module summaries from a Tune the person chose to
 *   finish later.
 *
 * Both hold summaries and the derived fit only. Raw trials never reach storage.
 * Entries are versioned, validated on read, and expire, so a stale or tampered
 * entry is ignored rather than trusted.
 */

export const PENDING_FIT_KEY = 'wa-tune-pending-v1';
export const PROGRESS_KEY = 'wa-tune-progress-v1';
/** Same-tab signal: `storage` events only reach other tabs. */
const PENDING_CHANGE_EVENT = 'wa-tune-pending-change';

/** A pending fit older than this is not saved to an account. */
export const PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A saved Tune older than this is offered as a fresh start instead. */
export const PROGRESS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const moduleId = z.enum(['reading', 'pointing', 'focus']);
const outcome = z.enum(['pending', 'done', 'skipped']);

const setupSchema = z.object({
  input: z.enum(['mouse', 'trackpad', 'touch', 'keyboard']),
  assistive: z.enum(['none', 'screen-reader', 'magnifier']),
  reducedMotion: z.boolean(),
  forcedColors: z.boolean(),
  recalibrate: z.boolean(),
});

export const pendingFitSchema = z.object({
  v: z.literal(1),
  savedAt: z.iso.datetime(),
  source: z.enum(['calibration', 'recalibration']),
  profile: fitProfileSchema,
  record: calibrationRecordSchema,
});
export type PendingFit = z.infer<typeof pendingFitSchema>;

export const progressSchema = z.object({
  v: z.literal(1),
  savedAt: z.iso.datetime(),
  setup: setupSchema,
  startedAt: z.iso.datetime(),
  summaries: calibrationModulesSchema,
  outcomes: z.object({ reading: outcome, pointing: outcome, focus: outcome }),
  resumeModule: moduleId,
});

/** The subset of `Storage` Tune uses; injectable for tests. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStore(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(store: KeyValueStore | null, key: string): unknown {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(
  store: KeyValueStore | null,
  key: string,
  value: unknown,
): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(store: KeyValueStore | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // Nothing stored, or storage is blocked: either way nothing remains to clear.
  }
}

function fresh(savedAt: string, maxAgeMs: number, now: Date): boolean {
  const at = Date.parse(savedAt);
  return (
    Number.isFinite(at) &&
    now.getTime() - at <= maxAgeMs &&
    at <= now.getTime() + 60_000
  );
}

/* ---------- Pending fit (signed out) ---------- */

export function writePendingFit(
  input: {
    profile: FitProfile;
    record: CalibrationRecord;
    source: PendingFit['source'];
  },
  now: Date = new Date(),
  store: KeyValueStore | null = browserStore(),
): boolean {
  const entry: PendingFit = {
    v: 1,
    savedAt: now.toISOString(),
    source: input.source,
    profile: input.profile,
    record: input.record,
  };
  const written = writeJson(store, PENDING_FIT_KEY, entry);
  announcePending();
  return written;
}

export function readPendingFit(
  now: Date = new Date(),
  store: KeyValueStore | null = browserStore(),
): PendingFit | null {
  const parsed = pendingFitSchema.safeParse(readJson(store, PENDING_FIT_KEY));
  if (!parsed.success) return null;
  return fresh(parsed.data.savedAt, PENDING_MAX_AGE_MS, now)
    ? parsed.data
    : null;
}

export function clearPendingFit(
  store: KeyValueStore | null = browserStore(),
): void {
  remove(store, PENDING_FIT_KEY);
  announcePending();
}

function announcePending(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event(PENDING_CHANGE_EVENT));
  } catch {
    // Nothing listens, or events are unavailable: readers re-check on focus.
  }
}

/**
 * When the pending fit was saved (ms since epoch), or null. Only the date is
 * read: the fit itself stays in storage until /tune/save takes it.
 */
export function pendingSavedAt(
  now: Date = new Date(),
  store: KeyValueStore | null = browserStore(),
): number | null {
  const pending = readPendingFit(now, store);
  if (!pending) return null;
  const at = Date.parse(pending.savedAt);
  return Number.isFinite(at) ? at : null;
}

function subscribePending(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PENDING_FIT_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(PENDING_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(PENDING_CHANGE_EVENT, onChange);
  };
}

const serverPending = (): number | null => null;

/** getSnapshot runs on every render: parse only when the stored text changes. */
let snapshot: { raw: string | null; day: number; savedAt: number | null } = {
  raw: null,
  day: -1,
  savedAt: null,
};
function clientPending(): number | null {
  const store = browserStore();
  let raw: string | null = null;
  try {
    raw = store?.getItem(PENDING_FIT_KEY) ?? null;
  } catch {
    raw = null;
  }
  // Re-read once a day as well, so an entry that expires stops showing.
  const day = Math.floor(Date.now() / 86_400_000);
  if (raw !== snapshot.raw || day !== snapshot.day) {
    snapshot = { raw, day, savedAt: raw ? pendingSavedAt() : null };
  }
  return snapshot.savedAt;
}

/**
 * A fit made while signed out that is still waiting in this browser, kept up to
 * date across tabs (storage events) and in this tab (write and clear). Null
 * while server rendering and when there is none (C10: the app's AppSync and
 * the Tune intro read it).
 */
export function usePendingFit(): { savedAt: number } | null {
  const savedAt = useSyncExternalStore(
    subscribePending,
    clientPending,
    serverPending,
  );
  return savedAt === null ? null : { savedAt };
}

/* ---------- Saved progress ("Save and finish later") ---------- */

export function writeProgress(
  stash: TuneStash,
  now: Date = new Date(),
  store: KeyValueStore | null = browserStore(),
): boolean {
  return writeJson(store, PROGRESS_KEY, {
    v: 1,
    savedAt: now.toISOString(),
    ...stash,
  });
}

export function readProgress(
  now: Date = new Date(),
  store: KeyValueStore | null = browserStore(),
): TuneStash | null {
  const parsed = progressSchema.safeParse(readJson(store, PROGRESS_KEY));
  if (!parsed.success) return null;
  if (!fresh(parsed.data.savedAt, PROGRESS_MAX_AGE_MS, now)) return null;
  const { v: _v, savedAt: _s, ...stash } = parsed.data;
  return stash;
}

export function clearProgress(
  store: KeyValueStore | null = browserStore(),
): void {
  remove(store, PROGRESS_KEY);
}
