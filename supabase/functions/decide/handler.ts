// decide: the page-analysis proxy between the extension and Jev
// (ai-architecture.md 3.1-3.3, 4.4, 7, 9).
//
// The extension's service worker sends vocabulary-filtered page structure; this
// function checks who is asking and whether they consented, re-validates every
// word, builds the questions from the server-only catalog, and asks Jev pinned
// to jev-1.13.0 with a 2 s deadline and no retries. The answer goes back as
// probabilities only. Nothing about the person is sent to Jev, and nothing about
// the page is stored or logged.
//
// Request:  POST, Authorization: Bearer <access token>, body DecideRequest (<= 16 KB).
//           GET <function>/health: empty 204, warms the connection and the isolate.
//
// Response (DecideResponse bodies):
//   200 { v: 1, ok: true, ... }                          probabilities only
//   200 { v: 1, ok: false, degraded, retryAfterMs? }     timeout | rate_limited | overloaded |
//                                                        upstream | model_drift | unconfigured
//   409 { v: 1, ok: false, degraded: 'catalog_mismatch' }
//   422 { v: 1, ok: false, degraded: 'bad_input' }       schema or vocabulary
//   429 { v: 1, ok: false, degraded: 'quota', retryAfterMs }
// Access errors use the shared { error: { code, message } } shape:
//   400 bad_request (not JSON), 401 unauthorized, 403 forbidden_origin | consent_required,
//   405, 413 payload_too_large, 415, 500 misconfigured | internal, 503 unavailable.
// Degraded answers are 200 on purpose: the extension keeps its instant plan and
// its circuit breaker decides when to ask again. Nothing is retried here.

import { type AuthResult } from '../_shared/auth.ts';
import {
  type CorsPolicy,
  corsHeaders,
  originRefused,
  preflight,
} from '../_shared/cors.ts';
import {
  buildQuestions,
  callJev,
  compact,
  JEV_PINNED_MODEL,
  type DecideDegraded,
  type DegradedReason,
  type JevFailure,
} from '../_shared/core.bundle.js';
import {
  empty,
  errorResponse,
  fromHttpError,
  HttpError,
  json,
  logEvent,
  readJsonBody,
} from '../_shared/http.ts';
import type { JevConfig } from './config.ts';
import { validateDecideRequest } from './validate.ts';

/** extension -> function body cap (ai-architecture.md 3.2.4). */
export const MAX_BODY_BYTES = 16 * 1024;
/** Sent with a quota denial; the per-minute window is the common case. */
export const QUOTA_RETRY_AFTER_MS = 60_000;
/** Upper bound on a Retry-After passed through from TypeSafe. */
export const MAX_RETRY_AFTER_MS = 10 * 60_000;
export const DEFAULT_DEADLINES = { consentMs: 1_500, quotaMs: 2_500 } as const;

export interface QuotaDecision {
  userOk: boolean;
  globalOk: boolean;
}

export interface DecideDeps {
  /** Web app and extension origins. */
  cors: CorsPolicy;
  verify(req: Request): Promise<AuthResult>;
  /** accounts.cloud_analysis for the caller, read with the service-role client. Throws on failure. */
  readConsent(userId: string): Promise<boolean>;
  /** public.consume_ai_quota(p_user) with the service-role client. Throws on failure. */
  consumeQuota(userId: string): Promise<QuotaDecision>;
  jev: JevConfig;
  /** Monotonic milliseconds. */
  now(): number;
  log?: typeof logEvent;
  deadlines?: Partial<{ consentMs: number; quotaMs: number }>;
}

type Settled<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' };

/** Await `work` for at most `ms`. Never rejects; clears its timer when the work settles. */
export function settle<T>(
  work: () => Promise<T>,
  ms: number,
): Promise<Settled<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), ms);
    Promise.resolve()
      .then(work)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve({ kind: 'ok', value });
        },
        (error: unknown) => {
          clearTimeout(timer);
          resolve({ kind: 'error', error });
        },
      );
  });
}

/** Read the consume_ai_quota result: `{ user_ok: boolean, global_ok: boolean }`. */
export function parseQuotaDecision(data: unknown): QuotaDecision | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return null;
  const row = data as Record<string, unknown>;
  if (typeof row.user_ok !== 'boolean' || typeof row.global_ok !== 'boolean')
    return null;
  return { userOk: row.user_ok, globalOk: row.global_ok };
}

/** How a Jev failure reaches the extension. Everything that is not a known state is `upstream`. */
export function degradeFor(failure: JevFailure): {
  reason: DegradedReason;
  retryAfterMs?: number;
} {
  switch (failure.kind) {
    case 'timeout':
      return { reason: 'timeout' };
    case 'rate_limited':
      return failure.retryAfterMs === undefined
        ? { reason: 'rate_limited' }
        : {
            reason: 'rate_limited',
            retryAfterMs: Math.min(
              MAX_RETRY_AFTER_MS,
              Math.max(0, Math.round(failure.retryAfterMs)),
            ),
          };
    case 'overloaded':
      return { reason: 'overloaded' };
    case 'model_drift':
      // Thresholds are calibrated on the pinned model; answers from another are not used.
      return { reason: 'model_drift' };
    default:
      return { reason: 'upstream' };
  }
}

/** Low-cardinality log fields for a failure: kinds, statuses and codes, never bodies. */
function failureFields(failure: JevFailure): Record<string, string | number> {
  switch (failure.kind) {
    case 'auth':
    case 'invalid':
    case 'server':
      return { kind: failure.kind, status: failure.status };
    case 'shape':
      return { kind: failure.kind, issue: failure.issue.slice(0, 64) };
    case 'model_drift':
      return { kind: failure.kind, got: failure.got.slice(0, 64) };
    default:
      return { kind: failure.kind };
  }
}

const isMissingEnv = (error: unknown): boolean =>
  error instanceof Error && error.name === 'MissingEnvError';
const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'unknown';
const isHealthPath = (pathname: string): boolean =>
  /\/health\/?$/.test(pathname);

export function createDecideHandler(
  deps: DecideDeps,
): (req: Request) => Promise<Response> {
  const log = deps.log ?? logEvent;
  const deadlines = { ...DEFAULT_DEADLINES, ...deps.deadlines };

  return async function handle(req: Request): Promise<Response> {
    const started = deps.now();
    const pre = preflight(req, deps.cors);
    if (pre) return pre;

    const cors = corsHeaders(deps.cors, req.headers.get('origin'));
    if (originRefused(deps.cors, req)) {
      return errorResponse(
        403,
        'forbidden_origin',
        'This origin may not request page analysis.',
        cors,
      );
    }

    if (isHealthPath(new URL(req.url).pathname)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return empty(405, { ...cors, Allow: 'GET, HEAD, OPTIONS' });
      }
      return empty(204, cors);
    }
    if (req.method !== 'POST') {
      return empty(405, { ...cors, Allow: 'POST, OPTIONS' });
    }

    const degrade = (
      status: 200 | 409 | 422 | 429,
      reason: DegradedReason,
      retryAfterMs?: number,
      headers: Record<string, string> = {},
    ): Response => {
      const body: DecideDegraded = {
        v: 1,
        ok: false,
        degraded: reason,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      };
      return json(body, { status, headers: { ...cors, ...headers } });
    };
    const unavailable = (): Response =>
      errorResponse(
        503,
        'unavailable',
        'Page analysis is unavailable right now.',
        {
          ...cors,
          'Retry-After': '5',
        },
      );

    try {
      const auth = await deps.verify(req);
      if (!auth.ok) {
        return errorResponse(
          auth.status,
          auth.status === 401 ? 'unauthorized' : 'unavailable',
          auth.message,
          {
            ...cors,
            ...(auth.status === 401
              ? { 'WWW-Authenticate': 'Bearer' }
              : { 'Retry-After': '5' }),
          },
        );
      }
      const { user } = auth;

      const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
      const validation = validateDecideRequest(body);
      if (!validation.ok) {
        if (validation.reason === 'catalog_mismatch') {
          log('decide_catalog_mismatch', {});
          return degrade(409, 'catalog_mismatch');
        }
        log('decide_bad_input', {
          stage: validation.stage,
          ...(validation.issue ? { issue: validation.issue } : {}),
          ...(validation.count !== undefined
            ? { count: validation.count }
            : {}),
        });
        return degrade(422, 'bad_input');
      }

      const built = buildQuestions(validation.request);
      if (Object.keys(built.questions).length === 0) {
        log('decide_bad_input', { stage: 'empty' });
        return degrade(422, 'bad_input');
      }

      if (deps.jev.status !== 'ready') {
        log('decide_unconfigured', { reason: deps.jev.reason });
        return degrade(200, 'unconfigured');
      }
      const jevSettings = deps.jev.settings;

      // Consent gates everything that leaves this function.
      const consent = await settle(
        () => deps.readConsent(user.id),
        deadlines.consentMs,
      );
      if (consent.kind === 'error' && isMissingEnv(consent.error))
        throw consent.error;
      if (consent.kind !== 'ok') {
        log('decide_unavailable', {
          stage: 'consent',
          reason:
            consent.kind === 'timeout' ? 'timeout' : errorName(consent.error),
        });
        return unavailable();
      }
      if (!consent.value) {
        log('decide_no_consent', {});
        return errorResponse(
          403,
          'consent_required',
          'Cloud page analysis is off for this account.',
          cors,
        );
      }

      // Quota runs alongside Jev; a denial (or a quota failure) aborts the Jev call.
      const abort = new AbortController();
      const quotaP = settle(
        () => deps.consumeQuota(user.id),
        deadlines.quotaMs,
      ).then((q) => {
        if (q.kind !== 'ok' || !q.value.userOk || !q.value.globalOk)
          abort.abort();
        return q;
      });
      const jevP = callJev(
        {
          model: JEV_PINNED_MODEL,
          state: built.state,
          questions: built.questions,
        },
        {
          apiKey: jevSettings.apiKey,
          timeoutMs: jevSettings.timeoutMs,
          pinnedModel: JEV_PINNED_MODEL,
          signal: abort.signal,
          endpoint: jevSettings.endpoint,
          ...(jevSettings.fetch ? { fetch: jevSettings.fetch } : {}),
        },
      );
      const [quota, jev] = await Promise.all([quotaP, jevP]);

      if (quota.kind === 'error' && isMissingEnv(quota.error))
        throw quota.error;
      if (quota.kind !== 'ok') {
        log('decide_unavailable', {
          stage: 'quota',
          reason: quota.kind === 'timeout' ? 'timeout' : errorName(quota.error),
        });
        return unavailable();
      }
      if (!quota.value.userOk || !quota.value.globalOk) {
        log('decide_quota', { scope: quota.value.userOk ? 'global' : 'user' });
        return degrade(429, 'quota', QUOTA_RETRY_AFTER_MS, {
          'Retry-After': String(QUOTA_RETRY_AFTER_MS / 1000),
        });
      }

      if (!jev.ok) {
        const { reason, retryAfterMs } = degradeFor(jev.error);
        log('decide_degraded', {
          reason,
          ...failureFields(jev.error),
          jevMs: Math.round(jev.ms),
          jevRequestId: jev.requestId,
        });
        return degrade(200, reason, retryAfterMs);
      }

      const answer = compact(built, jev.data, {
        jev: Math.round(jev.ms),
        edge: Math.round(Math.max(0, deps.now() - started)),
      });
      if (!answer) {
        log('decide_degraded', {
          reason: 'upstream',
          kind: 'compact',
          jevRequestId: jev.requestId,
        });
        return degrade(200, 'upstream');
      }

      log('decide_ok', {
        regions: Object.keys(answer.regions).length,
        trimmed: built.trimmed.length,
        tokens: answer.inputTokens,
        jevMs: answer.ms.jev,
        edgeMs: answer.ms.edge,
        jevRequestId: jev.requestId,
      });
      return json(answer, { headers: cors });
    } catch (error) {
      if (error instanceof HttpError) {
        log('decide_rejected', { status: error.status, code: error.code });
        return fromHttpError(error, cors);
      }
      if (isMissingEnv(error)) {
        log('decide_misconfigured', {});
        return errorResponse(
          500,
          'misconfigured',
          'The function is missing configuration.',
          cors,
        );
      }
      log('decide_error', { reason: errorName(error) });
      return errorResponse(500, 'internal', 'Unexpected error.', cors);
    }
  };
}
