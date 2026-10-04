import type {
  LearnDelta,
  UserLearningState,
} from '@webable/core/learning/types';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { isRecord, JsonStore, num, ownerField, strOrNull } from './store';

/**
 * Personal learning state on this device (personalization.md 12): the
 * domain-free UserLearningState, the deltas not yet pushed to Supabase, and
 * the server revision it was last reconciled with.
 */
export interface LearningRecord {
  v: 1;
  user: UserLearningState | null;
  /** `learning_state.rev` last reconciled with (0 = never pushed). */
  rev: number;
  /** Domain-free deltas awaiting sync, oldest first. */
  pending: LearnDelta[];
  /** Which profile the state was seeded from (e.g. "account:3", "tier0:rm"). */
  seededFor: string | null;
  /** The profile changed after the last push: reseed before the next push. */
  reseed: boolean;
  lastSyncAt: number;
  /** The account this state and its pending deltas belong to (absent: none yet). */
  ownerUserId?: string;
}

export const PENDING_MAX = 2000;

export function isLearningState(v: unknown): v is UserLearningState {
  return (
    isRecord(v) &&
    v.v === 1 &&
    typeof v.libVer === 'string' &&
    typeof v.priorRelease === 'string' &&
    isRecord(v.ops) &&
    isRecord(v.dims)
  );
}

const isDelta = (v: unknown): v is LearnDelta =>
  isRecord(v) &&
  v.v === 1 &&
  typeof v.deltaId === 'string' &&
  typeof v.day === 'number';

export function emptyLearningRecord(): LearningRecord {
  return {
    v: 1,
    user: null,
    rev: 0,
    pending: [],
    seededFor: null,
    reseed: false,
    lastSyncAt: 0,
  };
}

export function normalizeLearning(raw: unknown): LearningRecord {
  if (!isRecord(raw)) return emptyLearningRecord();
  return {
    v: 1,
    user: isLearningState(raw.user) ? raw.user : null,
    rev: Math.max(0, Math.round(num(raw.rev, 0))),
    pending: Array.isArray(raw.pending)
      ? raw.pending.filter(isDelta).slice(-PENDING_MAX)
      : [],
    seededFor: strOrNull(raw.seededFor),
    reseed: raw.reseed === true,
    lastSyncAt: num(raw.lastSyncAt, 0),
    ...ownerField(raw),
  };
}

export function learningStore(area: KvArea): JsonStore<LearningRecord> {
  return new JsonStore(area, KEYS.learning, normalizeLearning);
}

/** Queue deltas (bounded; the oldest are dropped past the cap). Pure. */
export function queueDeltas(
  rec: LearningRecord,
  deltas: readonly LearnDelta[],
): LearningRecord {
  if (deltas.length === 0) return rec;
  return { ...rec, pending: [...rec.pending, ...deltas].slice(-PENDING_MAX) };
}
