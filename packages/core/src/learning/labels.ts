import type { OpId } from '../ops/catalog';
import type { AnalysisLabel } from '../policy/types';
import { decayCounts } from './math';
import { LABEL_PRIOR, LABEL_PRIOR_STRENGTH } from './params';
import type { Day, UserLearningState } from './types';

/**
 * The label table (ai-architecture.md 10): Beta per (op, label) mapping a
 * calibrated page-analysis label to applicability A. The prior is centred on
 * 0.80 / 0.55 / 0.25 with strength 10 until a corpus Wilson bound replaces it;
 * local counts use the same 90-day decay; a pool-adjacent-violators pass keeps
 * clear >= likely >= unsure.
 */
export const LABEL_ORDER: readonly AnalysisLabel[] = [
  'clear',
  'likely',
  'unsure',
];

export function labelTableMeans(
  u: UserLearningState,
  op: OpId,
  now: Day,
): Record<AnalysisLabel, number> {
  const blocks = LABEL_ORDER.map((label) => {
    const prior = LABEL_PRIOR[label];
    const counts = u.labels[op]?.[label];
    const c = counts ? decayCounts(counts, now) : { s: 0, f: 0 };
    const a = prior * LABEL_PRIOR_STRENGTH + c.s;
    const b = (1 - prior) * LABEL_PRIOR_STRENGTH + c.f;
    return { labels: [label], mean: a / (a + b), weight: a + b };
  });

  // Pool adjacent violators for a non-increasing sequence.
  const stack: typeof blocks = [];
  for (const block of blocks) {
    stack.push({ ...block });
    while (
      stack.length >= 2 &&
      stack[stack.length - 2]!.mean < stack[stack.length - 1]!.mean
    ) {
      const right = stack.pop()!;
      const left = stack.pop()!;
      const weight = left.weight + right.weight;
      stack.push({
        labels: [...left.labels, ...right.labels],
        mean: (left.mean * left.weight + right.mean * right.weight) / weight,
        weight,
      });
    }
  }
  const out = {} as Record<AnalysisLabel, number>;
  for (const block of stack)
    for (const label of block.labels) out[label] = block.mean;
  return out;
}

/** A for a page-analysis verdict label: the monotone label-table mean for this op. */
export function labelApplicability(
  u: UserLearningState,
  op: OpId,
  label: AnalysisLabel,
  now: Day,
): number {
  return labelTableMeans(u, op, now)[label];
}
