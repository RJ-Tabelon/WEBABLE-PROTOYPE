import {
  composeRequestSchema,
  composeResponseSchema,
  type ComposeDegradedReason,
  type ComposeRequest,
  type ComposeResponse,
} from '@webable/core/compose/wire';
import { parseRetryAfter } from '@webable/core/jev/client';
import { isVocabWord } from '@webable/core/page/vocab';
import { toWireSkeleton } from '@webable/core/skeleton/to-wire';
import type { Skeleton } from '@webable/core/skeleton/types';
import {
  COMPOSE_FALLBACK_MODEL,
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
} from '@webable/core/versions';

/**
 * Layout planning in the worker (docs/10 §6): build the request (the wire
 * skeleton only: enums, rounded boxes, length shapes and at most six public
 * vocabulary words per label, never page text, the URL or the fit), and call
 * the `compose` Edge Function. Nothing here knows who the person is.
 */

/** The planner's whole budget (the function aborts the model call sooner). */
export const COMPOSE_TIMEOUT_MS = 12_000;

export type ComposeOk = Extract<ComposeResponse, { ok: true }>;

export interface BuiltCompose {
  request: ComposeRequest;
  /** The exact bytes that will leave the device. */
  body: string;
}

/**
 * The compose request for a skeleton, validated with the shared strict schema
 * and every label word re-checked against the public vocabulary (the same
 * check the function runs). If anything outside the contract slipped in,
 * nothing is sent.
 */
export function buildComposeRequest(skeleton: Skeleton): BuiltCompose | null {
  let wire;
  try {
    wire = toWireSkeleton(skeleton);
  } catch {
    return null;
  }
  const parsed = composeRequestSchema.safeParse({
    v: 1,
    schema: COMPOSE_SCHEMA_VERSION,
    skeleton: wire,
  });
  if (!parsed.success) return null;
  const words = parsed.data.skeleton.nodes.flatMap((n) => n.l ?? []);
  if (words.some((w) => w !== '·' && !isVocabWord(w))) return null;
  return { request: parsed.data, body: JSON.stringify(parsed.data) };
}

export type ComposeOutcome =
  | { ok: true; data: ComposeOk; ms: number }
  | {
      ok: false;
      reason:
        | ComposeDegradedReason
        | 'network'
        | 'unauthorized'
        | 'consent_required'
        | 'rate_limited'
        | 'http'
        | 'shape'
        | 'model_drift';
      retryAfterMs?: number;
      status?: number;
      ms: number;
    };

export interface ComposeCall {
  url: string;
  /** The project's publishable key; omitted for the local dev planner. */
  publishableKey?: string;
  /** The session's access token; null for the local dev planner (no account). */
  accessToken: string | null;
  body: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Models the planner may answer with (pinned, or its fallback). */
const MODELS: ReadonlySet<string> = new Set([
  COMPOSE_PINNED_MODEL,
  COMPOSE_FALLBACK_MODEL,
]);

const aborted = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'name' in err &&
  (err.name === 'TimeoutError' || err.name === 'AbortError');

/** POST the body to `compose`. Never throws; failures come back as outcomes. */
export async function callCompose(call: ComposeCall): Promise<ComposeOutcome> {
  const now = call.now ?? (() => performance.now());
  const start = now();
  const doFetch = call.fetch ?? fetch;
  const deadline = AbortSignal.timeout(call.timeoutMs ?? COMPOSE_TIMEOUT_MS);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (call.accessToken) headers.authorization = `Bearer ${call.accessToken}`;
  if (call.publishableKey) headers.apikey = call.publishableKey;
  let res: Response;
  let json: unknown;
  try {
    res = await doFetch(call.url, {
      method: 'POST',
      headers,
      body: call.body,
      signal: deadline,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    try {
      json = await res.json();
    } catch (error) {
      if (deadline.aborted || aborted(error)) throw error;
      json = null;
    }
  } catch (err) {
    return {
      ok: false,
      reason: deadline.aborted || aborted(err) ? 'timeout' : 'network',
      ms: now() - start,
    };
  }
  const ms = now() - start;
  if (res.status === 401)
    return { ok: false, reason: 'unauthorized', status: 401, ms };
  if (res.status === 403) {
    const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
    return {
      ok: false,
      reason: code === 'consent_required' ? 'consent_required' : 'http',
      status: 403,
      ms,
    };
  }
  const retryAfterMs = parseRetryAfter(res.headers);
  const parsed = composeResponseSchema.safeParse(json);
  if (!parsed.success)
    return {
      ok: false,
      reason: res.status === 429 ? 'rate_limited' : res.ok ? 'shape' : 'http',
      status: res.status,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      ms,
    };
  const data = parsed.data;
  if (!data.ok)
    return {
      ok: false,
      reason: data.degraded,
      ...(data.retryAfterMs !== undefined
        ? { retryAfterMs: data.retryAfterMs }
        : retryAfterMs !== undefined
          ? { retryAfterMs }
          : {}),
      status: res.status,
      ms,
    };
  if (!res.ok) return { ok: false, reason: 'http', status: res.status, ms };
  if (!MODELS.has(data.model))
    return { ok: false, reason: 'model_drift', status: res.status, ms };
  return { ok: true, data, ms };
}
