import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';

import { isRecord } from './store';

/**
 * Per-site level memo (see lib/sw/levels.ts for the hysteresis rule): the
 * level each learned op shows on a site, and a different level Learner B
 * suggested that is waiting for confirmation on a second page view.
 */

export const CONFIRM_SESSIONS = 2;

export interface OpLevelMemo {
  /** The level this site shows. */
  level: number;
  /** A different level Learner B suggested, and the page views that saw it. */
  pending?: { level: number; sessions: string[] };
}

export interface LevelMemo {
  /** Profile identity the levels were chosen under. */
  seed: string;
  ops: Partial<Record<OpId, OpLevelMemo>>;
}

export const emptyLevelMemo = (seed: string): LevelMemo => ({ seed, ops: {} });

export function normalizeLevelMemo(raw: unknown): LevelMemo | null {
  if (!isRecord(raw) || typeof raw.seed !== 'string' || !isRecord(raw.ops))
    return null;
  const ops: LevelMemo['ops'] = {};
  for (const [op, v] of Object.entries(raw.ops)) {
    if (!(op in OP_CATALOG) || !isRecord(v) || typeof v.level !== 'number')
      continue;
    const entry: OpLevelMemo = { level: v.level };
    const p = v.pending;
    if (
      isRecord(p) &&
      typeof p.level === 'number' &&
      Array.isArray(p.sessions) &&
      p.sessions.every((s) => typeof s === 'string')
    )
      entry.pending = {
        level: p.level,
        sessions: (p.sessions as string[]).slice(-CONFIRM_SESSIONS),
      };
    ops[op as OpId] = entry;
  }
  return { seed: raw.seed, ops };
}
