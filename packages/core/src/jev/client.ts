import type { JevModelId, JevQuestion, JevResult, JevState } from './api';

/**
 * Raw-fetch Jev client (runs unchanged in Deno and Node). No retries: a retry
 * cannot land inside the page-view latency budget. Validates response shape and
 * that the resolved model equals the pinned model.
 */
export async function callJev(
  _req: { state: JevState; model: JevModelId; questions: Record<string, JevQuestion> },
  _opts: { apiKey: string; timeoutMs: number; pinnedModel: string; signal?: AbortSignal; fetch?: typeof fetch },
): Promise<JevResult> {
  throw new Error('not implemented');
}
