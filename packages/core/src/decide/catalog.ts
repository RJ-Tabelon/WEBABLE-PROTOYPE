import type { JevQuestion, JevState } from '../jev/api';
import type { DecideRequest } from './wire';

/**
 * Server-only question builder for catalog wa-cat-1.0.0 (ai-architecture.md 3.3).
 * The ONLY place question text exists. Clients send evidence, never questions.
 * Page context goes in `state`; each region's evidence goes inside its own
 * question's `instructions` object. Every Choice has an escape option.
 * Trims lowest-priority regions if the estimated token count exceeds 12k.
 */
export function buildQuestions(_req: DecideRequest): {
  state: JevState;
  questions: Record<string, JevQuestion>;
  estimatedTokens: number;
} {
  throw new Error('not implemented');
}
