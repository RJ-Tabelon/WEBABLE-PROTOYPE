import { addCounts, kalmanPoint, predictDim, probitUpdate } from './math';
import { cloneJson, ensureOp, isDimId, isOpId } from './state';
import {
  learnDeltaSchema,
  type LearnDelta,
  type UserLearningState,
} from './types';

/**
 * Merge domain-free deltas into canonical state (personalization.md 11,
 * "Multi-device merge"):
 * - counts are G-counters: every (op, ds, df, day) contribution is added once,
 *   decayed to a common date, so the result does not depend on arrival order;
 * - accepts add; `src` and `blocked` are last-writer-wins in day order;
 * - Kalman observations are replayed in (day, deltaId) order;
 * - deltas already applied (by deltaId), duplicated in the input, or failing
 *   the schema are ignored, so merging is idempotent.
 *
 * `local` (optional) is this device's own state: its non-additive bookkeeping
 * (offer cooldowns, promotion ask dates, dismissal streaks, op versions) is
 * merged in with max semantics, because deltas cannot carry it.
 */
export function mergeLearningDeltas(
  base: UserLearningState,
  deltas: readonly LearnDelta[],
  applied: ReadonlySet<string>,
  local?: UserLearningState,
): UserLearningState {
  const u = cloneJson(base);
  u.labels ??= {};

  const seen = new Set<string>();
  const fresh: LearnDelta[] = [];
  for (const raw of deltas) {
    const parsed = learnDeltaSchema.safeParse(raw);
    if (!parsed.success) continue;
    const delta = parsed.data;
    if (applied.has(delta.deltaId) || seen.has(delta.deltaId)) continue;
    seen.add(delta.deltaId);
    fresh.push(delta);
  }
  fresh.sort(
    (a, b) =>
      a.day - b.day ||
      (a.deltaId < b.deltaId ? -1 : a.deltaId > b.deltaId ? 1 : 0),
  );

  for (const delta of fresh) {
    const day = delta.day;
    if (delta.op !== undefined && isOpId(delta.op)) {
      const o = ensureOp(u, delta.op, day);
      if ((delta.ds ?? 0) > 0 || (delta.df ?? 0) > 0)
        o.c = addCounts(o.c, delta.ds ?? 0, delta.df ?? 0, day);
      if (delta.accepts) o.accepts += delta.accepts;
      if (delta.src !== undefined) o.src = delta.src;
      if (delta.blocked === true) o.blocked = true;
      else if (delta.blocked === false) delete o.blocked;
    }
    if (delta.dim !== undefined && isDimId(delta.dim) && delta.obs) {
      const current = u.dims[delta.dim];
      if (current) {
        const predicted = predictDim(current, day);
        u.dims[delta.dim] =
          delta.obs.kind === 'point'
            ? kalmanPoint(predicted, delta.obs.value, delta.obs.r).dim
            : probitUpdate(
                predicted,
                delta.obs.value,
                delta.obs.kind === 'gt' ? 1 : -1,
                delta.obs.r,
              );
      }
    }
    if (delta.label && isOpId(delta.label.op)) {
      const byLabel = (u.labels[delta.label.op] ??= {
        clear: { s: 0, f: 0, t: day },
        likely: { s: 0, f: 0, t: day },
        unsure: { s: 0, f: 0, t: day },
      });
      byLabel[delta.label.label] = addCounts(
        byLabel[delta.label.label],
        delta.label.s,
        delta.label.f,
        day,
      );
    }
  }

  if (local) {
    for (const [op, mine] of Object.entries(local.ops)) {
      if (!isOpId(op) || !mine) continue;
      const o = ensureOp(u, op, mine.c.t);
      o.askAfter = Math.max(o.askAfter, mine.askAfter);
      o.offerCooldownUntil = Math.max(
        o.offerCooldownUntil,
        mine.offerCooldownUntil,
      );
      o.dismissStreak = Math.max(o.dismissStreak, mine.dismissStreak);
      o.opVer = Math.max(o.opVer, mine.opVer);
    }
  }
  return u;
}
