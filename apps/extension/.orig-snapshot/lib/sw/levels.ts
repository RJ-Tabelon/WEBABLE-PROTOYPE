import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';
import type { AdaptationPlan } from '@webable/core/policy/types';

import {
  CONFIRM_SESSIONS,
  emptyLevelMemo,
  type LevelMemo,
} from '../storage/levels';

export {
  CONFIRM_SESSIONS,
  type LevelMemo,
  type OpLevelMemo,
} from '../storage/levels';

/**
 * Level hysteresis across page views (personalization.md 7.5): Learner B may
 * suggest a new level for an op, but the level a site shows changes only when
 * the same new level wins on 2 consecutive page views. Predictability matters
 * more than tracking noise. Manual levels always apply at once.
 *
 * The memo is per site (Learner B's domain offsets make levels site-specific),
 * lives in the local site record, and is dropped when the profile it was
 * built from changes (a recalibration may raise the floor). Pure.
 */

export interface StabilizeInput {
  plan: AdaptationPlan;
  memo: LevelMemo | null;
  /** Current profile identity. */
  seed: string;
  tabSession: string;
  /** Levels the person set for this site or everywhere (never held back). */
  manual: Partial<Record<OpId, number>>;
}

export function stabilizeLevels(input: StabilizeInput): {
  plan: AdaptationPlan;
  memo: LevelMemo;
} {
  const memo: LevelMemo =
    input.memo && input.memo.seed === input.seed
      ? { seed: input.seed, ops: structuredClone(input.memo.ops) }
      : emptyLevelMemo(input.seed);
  const ops = input.plan.ops.map((p) => {
    if (OP_CATALOG[p.op].dim === null) return p;
    if (input.manual[p.op] !== undefined) {
      memo.ops[p.op] = { level: p.level };
      return p;
    }
    const m = memo.ops[p.op];
    if (!m) {
      memo.ops[p.op] = { level: p.level };
      return p;
    }
    if (p.level === m.level) {
      delete m.pending;
      return p;
    }
    const pending =
      m.pending && m.pending.level === p.level
        ? { level: p.level, sessions: [...m.pending.sessions] }
        : { level: p.level, sessions: [] as string[] };
    if (!pending.sessions.includes(input.tabSession))
      pending.sessions.push(input.tabSession);
    if (pending.sessions.length >= CONFIRM_SESSIONS) {
      memo.ops[p.op] = { level: p.level };
      return p;
    }
    m.pending = {
      level: pending.level,
      sessions: pending.sessions.slice(-CONFIRM_SESSIONS),
    };
    return { ...p, level: m.level, trace: { ...p.trace, level: m.level } };
  });
  return { plan: { ...input.plan, ops }, memo };
}
