import type { DimId, OpId } from '../ops/catalog';
import { cloneJson, defaultOpState, isDimId, isOpId } from './state';
import type { Day, DimState, OpState, UserLearningState } from './types';

/**
 * Forgetting what was learned (contract C18). Pure transforms of the synced,
 * domain-free learning state; the caller writes the result with the revision
 * it read. The fit is untouched: an op keeps a source that came from the fit or
 * the system setting, and a dimension returns to its calibration.
 */

/** An op (Learner A) or a continuous dimension (Learner B). */
export type LearnedKey = OpId | DimId;

export const isLearnedKey = (x: unknown): x is LearnedKey =>
  isOpId(x) || isDimId(x);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The shape a stored learning_state.state must have before it is transformed. */
export function isUserLearningState(v: unknown): v is UserLearningState {
  return (
    isRecord(v) &&
    v.v === 1 &&
    typeof v.libVer === 'string' &&
    typeof v.priorRelease === 'string' &&
    isRecord(v.ops) &&
    isRecord(v.dims)
  );
}

/**
 * The default op state. Beta counts, the global block, accept and dismiss
 * bookkeeping all clear; a 'profile' or 'system' source stays (it comes from
 * the fit, not from learning). A learned pin clears.
 */
function resetOp(prev: OpState | undefined, op: OpId, day: Day): OpState {
  const fresh = defaultOpState(op, day);
  if (prev?.src === 'profile' || prev?.src === 'system') fresh.src = prev.src;
  return fresh;
}

/** Back to the calibration mean and variance. */
function resetDim(prev: DimState, day: Day): DimState {
  const next: DimState = {
    m: prev.mCal,
    v: prev.vCal,
    t: day,
    mCal: prev.mCal,
    vCal: prev.vCal,
  };
  if (prev.floor !== undefined) next.floor = prev.floor;
  return next;
}

/** Clear one op's counts, block and label counts. Returns a new state. */
export function resetOpLearning(
  state: UserLearningState,
  op: OpId,
  day: Day,
): UserLearningState {
  const out = cloneJson(state);
  out.ops[op] = resetOp(out.ops[op], op, day);
  if (out.labels) delete out.labels[op];
  return out;
}

/** Return one dimension to its calibration. An absent dimension stays absent. */
export function resetDimLearning(
  state: UserLearningState,
  dim: DimId,
  day: Day,
): UserLearningState {
  const out = cloneJson(state);
  const prev = out.dims[dim];
  if (prev) out.dims[dim] = resetDim(prev, day);
  return out;
}

export function resetLearnedKey(
  state: UserLearningState,
  key: LearnedKey,
  day: Day,
): UserLearningState {
  return isOpId(key)
    ? resetOpLearning(state, key, day)
    : resetDimLearning(state, key, day);
}

/**
 * Forget everything: every op present returns to its default state, every
 * dimension to its calibration, and the label table empties. The delta ids
 * stay, so a delta pushed again after a lost reply is still not counted twice.
 */
export function forgetAllLearning(
  state: UserLearningState,
  day: Day,
): UserLearningState {
  const out = cloneJson(state);
  for (const key of Object.keys(out.ops)) {
    if (isOpId(key)) out.ops[key] = resetOp(out.ops[key], key, day);
  }
  for (const key of Object.keys(out.dims)) {
    const prev = out.dims[key as DimId];
    if (isDimId(key) && prev) out.dims[key] = resetDim(prev, day);
  }
  out.labels = {};
  return out;
}
