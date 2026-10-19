// compose: the layout planner proxy between the extension and OpenAI (docs/10 §6, §8).
//
// The extension's service worker sends a wire skeleton (enums, ids, rounded
// boxes and public-vocabulary words; never page text) after the person opened
// Fit view. This function checks who is asking and whether they turned on
// "Better Fit view layouts", re-validates every word, writes the outline the
// model reads, and asks the pinned model (gpt-6-sol, falling back once to
// gpt-5.6-terra when it is unavailable) for a PageSpec under a 12 s deadline
// with no retries. Only a spec made of enums and the request's own ids goes
// back. Nothing about the person is sent to OpenAI, and nothing about the page
// is stored or logged.
//
// Request:  POST, Authorization: Bearer <access token>, body ComposeRequest (<= 49 KB).
//           GET <function>/health: empty 204, warms the connection and the isolate.
//
// Response (ComposeResponse bodies):
//   200 { ok: true, v: 1, schema, model, spec }
//   200 { ok: false, degraded, retryAfterMs? }   disabled | unconfigured | timeout |
//                                                model_error | invalid_output | refused
//   429 { ok: false, degraded: 'quota', retryAfterMs }
// Access and input errors use the shared { error: { code, message } } shape:
//   400 bad_request (not JSON), 401 unauthorized, 403 forbidden_origin | consent_required,
//   405, 409 schema_mismatch, 413 payload_too_large, 415, 422 bad_input,
//   500 misconfigured | internal, 503 unavailable.
// Degraded answers are 200 on purpose: Fit view keeps the heuristic spec and
// the worker decides when to ask again. Usage, cached-token counts and timing
// are never returned (a cached-prefix count would tell one person that someone
// else recently sent the same page structure).

import type { AuthResult } from '../_shared/auth.ts';
import {
  type CorsPolicy,
  corsHeaders,
  originRefused,
  preflight,
} from '../_shared/cors.ts';
import {
  COMPOSE_FALLBACK_MODEL,
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
  composeResponseSchema,
  wireOutline,
  type ComposeDegraded,
  type ComposeDegradedReason,
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
import type { PlannerConfig } from './config.ts';
import { callPlanner, type PlannerFailure } from './openai.ts';
import { checkPlannerOutput, validateComposeRequest } from './validate.ts';

/**
 * extension -> function body cap: the 48 KB wire skeleton (skeleton/to-wire.ts
 * WIRE_MAX_BYTES) plus the request envelope around it.
 */
export const MAX_BODY_BYTES = 49 * 1024;
/** Sent with a product-wide quota denial (its tightest window is a minute). */
export const GLOBAL_QUOTA_RETRY_AFTER_MS = 60_000;
export const DEFAULT_DEADLINES = { consentMs: 1_500, quotaMs: 2_500 } as const;

const HOUR_MS = 3_600_000;

export interface QuotaDecision {
  userOk: boolean;
  globalOk: boolean;
}

export interface ComposeDeps {
  /** Web app and extension origins. */
  cors: CorsPolicy;
  verify(req: Request): Promise<AuthResult>;
  /** accounts.ai_layout for the caller, read with the service-role client. Throws on failure. */
  readConsent(userId: string): Promise<boolean>;
  /** public.consume_compose_quota(p_user) with the service-role client. Throws on failure. */
  consumeQuota(userId: string): Promise<QuotaDecision>;
  planner: PlannerConfig;
  /** The kill switch, read on every request (COMPOSE_DISABLED). */
  disabled(): boolean;
  /** Wall-clock milliseconds, for quota retry hints. Default: Date.now. */
  clock?: () => number;
  log?: typeof logEvent;
  deadlines?: Partial<{ consentMs: number; quotaMs: number }>;
}

type Settled<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' };

/**
 * Await `work` for at most `ms`. Never rejects; clears its timer when the work
 * settles. (The same helper as decide's, kept local so neither function
 * imports the other.)
 */
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

/** Read the consume_compose_quota result: `{ user_ok: boolean, global_ok: boolean }`. */
export function parseQuotaDecision(data: unknown): QuotaDecision | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return null;
  const row = data as Record<string, unknown>;
  if (typeof row.user_ok !== 'boolean' || typeof row.global_ok !== 'boolean')
    return null;
  return { userOk: row.user_ok, globalOk: row.global_ok };
}

/**
 * When to ask again after a quota denial. A person's limits are 10 an hour
 * and 60 a day: the hourly window reopens at the top of the hour (a person
 * over the daily cap is refused again then, without a model call). The
 * product-wide limit's tightest window is a minute.
 */
export function quotaRetryAfterMs(
  scope: 'user' | 'global',
  now: number,
): number {
  if (scope === 'global') return GLOBAL_QUOTA_RETRY_AFTER_MS;
  return Math.max(1_000, HOUR_MS - (((now % HOUR_MS) + HOUR_MS) % HOUR_MS));
}

/** How a planner failure reaches the extension. */
export function degradeFor(failure: PlannerFailure): ComposeDegradedReason {
  switch (failure.kind) {
    case 'timeout':
      return 'timeout';
    case 'refused':
      return 'refused';
    case 'incomplete':
      // The JSON was cut off at the output cap: there is no spec to use.
      return 'invalid_output';
    default:
      return 'model_error';
  }
}

/** Low-cardinality log fields for a failure: kinds, statuses and codes, never bodies. */
function failureFields(
  failure: PlannerFailure,
): Record<string, string | number> {
  switch (failure.kind) {
    case 'http':
      return {
        kind: failure.kind,
        status: failure.status,
        ...(failure.code ? { code: failure.code } : {}),
      };
    case 'model_unavailable':
      return { kind: failure.kind, status: failure.status };
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

export function createComposeHandler(
  deps: ComposeDeps,
): (req: Request) => Promise<Response> {
  const log = deps.log ?? logEvent;
  const clock = deps.clock ?? Date.now;
  const deadlines = { ...DEFAULT_DEADLINES, ...deps.deadlines };
  const models = [COMPOSE_PINNED_MODEL, COMPOSE_FALLBACK_MODEL] as const;

  return async function handle(req: Request): Promise<Response> {
    const pre = preflight(req, deps.cors);
    if (pre) return pre;

    const cors = corsHeaders(deps.cors, req.headers.get('origin'));
    if (originRefused(deps.cors, req)) {
      return errorResponse(
        403,
        'forbidden_origin',
        'This origin may not request layout planning.',
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
      status: 200 | 429,
      reason: ComposeDegradedReason,
      retryAfterMs?: number,
      headers: Record<string, string> = {},
    ): Response => {
      const body: ComposeDegraded = {
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
        'Layout planning is unavailable right now.',
        { ...cors, 'Retry-After': '5' },
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

      // The kill switch stops everything after auth, before the body is even read.
      if (deps.disabled()) {
        log('compose_disabled', {});
        return degrade(200, 'disabled');
      }

      const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
      const validation = validateComposeRequest(body);
      if (!validation.ok) {
        if (validation.reason === 'schema_mismatch') {
          log('compose_schema_mismatch', {});
          return errorResponse(
            409,
            'schema_mismatch',
            `This function plans ${COMPOSE_SCHEMA_VERSION} layouts.`,
            cors,
          );
        }
        log('compose_bad_input', {
          stage: validation.stage,
          ...(validation.issue ? { issue: validation.issue } : {}),
          ...(validation.count !== undefined
            ? { count: validation.count }
            : {}),
        });
        return errorResponse(
          422,
          'bad_input',
          'The skeleton does not match the compose contract.',
          cors,
        );
      }
      const request = validation.request;

      if (deps.planner.status !== 'ready') {
        log('compose_unconfigured', { reason: deps.planner.reason });
        return degrade(200, 'unconfigured');
      }
      const settings = deps.planner.settings;

      // Consent gates everything that leaves this function.
      const consent = await settle(
        () => deps.readConsent(user.id),
        deadlines.consentMs,
      );
      if (consent.kind === 'error' && isMissingEnv(consent.error))
        throw consent.error;
      if (consent.kind !== 'ok') {
        log('compose_unavailable', {
          stage: 'consent',
          reason:
            consent.kind === 'timeout' ? 'timeout' : errorName(consent.error),
        });
        return unavailable();
      }
      if (!consent.value) {
        log('compose_no_consent', {});
        return errorResponse(
          403,
          'consent_required',
          'Better Fit view layouts are off for this account.',
          cors,
        );
      }

      // The server writes the outline; nothing page-supplied reaches the prompt unvalidated.
      const outline = wireOutline(request.skeleton);

      // Quota runs alongside the model; a denial (or a quota failure) aborts the call.
      const abort = new AbortController();
      const quotaP = settle(
        () => deps.consumeQuota(user.id),
        deadlines.quotaMs,
      ).then((q) => {
        if (q.kind !== 'ok' || !q.value.userOk || !q.value.globalOk)
          abort.abort();
        return q;
      });
      const planP = callPlanner(outline, {
        settings,
        models,
        signal: abort.signal,
      });
      const [quota, plan] = await Promise.all([quotaP, planP]);

      if (quota.kind === 'error' && isMissingEnv(quota.error))
        throw quota.error;
      if (quota.kind !== 'ok') {
        log('compose_unavailable', {
          stage: 'quota',
          reason: quota.kind === 'timeout' ? 'timeout' : errorName(quota.error),
        });
        return unavailable();
      }
      if (!quota.value.userOk || !quota.value.globalOk) {
        const scope = quota.value.userOk ? 'global' : 'user';
        const retryAfterMs = quotaRetryAfterMs(scope, clock());
        log('compose_quota', { scope });
        return degrade(429, 'quota', retryAfterMs, {
          'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
        });
      }

      if (plan.fallback) log('compose_fallback', { model: plan.model });
      if (!plan.ok) {
        const reason = degradeFor(plan.error);
        log('compose_degraded', {
          reason,
          model: plan.model,
          ...failureFields(plan.error),
        });
        return degrade(200, reason);
      }

      const output = checkPlannerOutput(plan.text, request);
      if (!output.ok) {
        log('compose_degraded', {
          reason: 'invalid_output',
          model: plan.model,
          stage: output.stage,
          ...(output.issue ? { issue: output.issue } : {}),
          ...(output.count !== undefined ? { count: output.count } : {}),
        });
        return degrade(200, 'invalid_output');
      }

      // Re-parse the whole answer with the wire schema, so nothing but the
      // contract's fields can reach a client even if this code changes.
      const answer = composeResponseSchema.safeParse({
        ok: true,
        v: 1,
        schema: COMPOSE_SCHEMA_VERSION,
        model: plan.model,
        spec: output.spec,
      });
      if (!answer.success || !answer.data.ok) {
        log('compose_degraded', {
          reason: 'invalid_output',
          model: plan.model,
          stage: 'response',
        });
        return degrade(200, 'invalid_output');
      }

      log('compose_ok', {
        model: plan.model,
        fallback: plan.fallback,
        sections: answer.data.spec.sections.length,
        collections: answer.data.spec.collections.length,
      });
      return json(answer.data, { headers: cors });
    } catch (error) {
      if (error instanceof HttpError) {
        log('compose_rejected', { status: error.status, code: error.code });
        return fromHttpError(error, cors);
      }
      if (isMissingEnv(error)) {
        log('compose_misconfigured', {});
        return errorResponse(
          500,
          'misconfigured',
          'The function is missing configuration.',
          cors,
        );
      }
      log('compose_error', { reason: errorName(error) });
      return errorResponse(500, 'internal', 'Unexpected error.', cors);
    }
  };
}
