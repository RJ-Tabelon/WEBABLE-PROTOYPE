import type { AttentionSummary } from './schema';
import type { FocusSession } from './trials';

/** Reduce a focus session to its persisted summary (cal-attention.md 5). */
export function summarizeFocus(_session: FocusSession): AttentionSummary {
  throw new Error('not implemented');
}
