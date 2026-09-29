import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';
import type { AdaptationPlan, PlannedOp } from '@webable/core/policy/types';

/**
 * Late page-analysis answers (ai-architecture.md 6.2, 08 section 6). The
 * instant plan never waits for the network. When answers arrive:
 * - before the first interaction and within 1.5 s of DOMContentLoaded, new
 *   paint-only changes apply now (they cannot move what someone is reading);
 * - layout changes from a late answer never apply on this page view; the
 *   answers are cached and the next visit applies them in the instant plan;
 * - after 1.5 s, or once the person has interacted, nothing new applies.
 * Protection always wins: a region the analysis now protects is released at
 * once, whatever the timing. Pure.
 */

export const SOFT_DEADLINE_MS = 1_500;
/** The worker's fetch timeout; answers later than this are dropped entirely. */
export const HARD_TIMEOUT_MS = 3_000;

export type RefinementMode = 'apply_paint' | 'cache_only';

export function refinementMode(t: {
  /** When the page's signals arrived (DOMContentLoaded + extraction). */
  dclAt: number;
  answeredAt: number;
  /** First pointerdown/keydown/scroll, when known. */
  interactedAt: number | null;
}): RefinementMode {
  if (t.interactedAt !== null && t.interactedAt <= t.answeredAt)
    return 'cache_only';
  return t.answeredAt - t.dclAt <= SOFT_DEADLINE_MS
    ? 'apply_paint'
    : 'cache_only';
}

export interface RefinementDiff {
  /** Ops to send in a `sw:plan` (reason 'refine'): new paint ops or narrowed scopes. */
  ops: PlannedOp[];
  /** Ops to remove entirely (every region they covered is now protected). */
  undo: OpId[];
  /** New offers the refined decision surfaced (shown in the popup, never in the page). */
  offers: PlannedOp[];
}

const regionsOf = (p: PlannedOp): string[] | null =>
  p.scope === 'page' ? null : p.scope.regions;

/**
 * What to change on the page after a refined plan.
 * `current` is the plan in effect (instant plan plus earlier refinements);
 * `protectedKeys` are regions the answers now protect.
 */
export function diffRefinement(
  current: AdaptationPlan,
  refined: AdaptationPlan,
  mode: RefinementMode,
  protectedKeys: ReadonlySet<string>,
): RefinementDiff {
  const out: RefinementDiff = { ops: [], undo: [], offers: [] };
  const prevByOp = new Map(current.ops.map((p) => [p.op, p] as const));
  const nextByOp = new Map(refined.ops.map((p) => [p.op, p] as const));

  for (const next of refined.ops) {
    const prev = prevByOp.get(next.op);
    const paint = OP_CATALOG[next.op].risk === 'paint';
    if (next.mode === 'offer') {
      if (!prev) out.offers.push(next);
      continue;
    }
    if (!prev || prev.mode !== 'auto') {
      if (mode === 'apply_paint' && paint) out.ops.push(next);
      continue;
    }
    const before = regionsOf(prev);
    const after = regionsOf(next);
    if (before === null || after === null) continue; // page ops: nothing to refine
    const released = before.filter((k) => protectedKeys.has(k));
    const added =
      mode === 'apply_paint' && paint
        ? after.filter((k) => !before.includes(k))
        : [];
    if (released.length === 0 && added.length === 0) continue;
    const scope = [...before.filter((k) => !protectedKeys.has(k)), ...added];
    if (scope.length === 0) {
      out.undo.push(next.op);
      continue;
    }
    out.ops.push({ ...next, scope: { regions: scope } });
  }

  // Region ops the refined plan dropped: only protection may remove them.
  for (const prev of current.ops) {
    if (prev.mode !== 'auto' || nextByOp.has(prev.op)) continue;
    const before = regionsOf(prev);
    if (before === null) continue;
    const remaining = before.filter((k) => !protectedKeys.has(k));
    if (remaining.length === before.length) continue;
    if (remaining.length === 0) out.undo.push(prev.op);
    else out.ops.push({ ...prev, scope: { regions: remaining } });
  }
  return out;
}

/** The plan in effect after a refinement was applied. */
export function applyRefinement(
  current: AdaptationPlan,
  diff: RefinementDiff,
  basis: AdaptationPlan['basis'],
): AdaptationPlan {
  const undo = new Set(diff.undo);
  const replaced = new Map(diff.ops.map((p) => [p.op, p] as const));
  const ops = current.ops
    .filter((p) => !undo.has(p.op))
    .map((p) => replaced.get(p.op) ?? p);
  for (const p of diff.ops) if (!ops.some((o) => o.op === p.op)) ops.push(p);
  return { ...current, basis, ops };
}
