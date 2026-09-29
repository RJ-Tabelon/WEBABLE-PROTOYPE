// ingest: opt-in product learning (personalization.md 13.3, 14.2). Off by default.
//
// A device that opted in ("Help improve WebAble's starting suggestions",
// accounts.product_learning) sends at most one AggReport per 4-week window:
// up to 4 outcome cells, each a coarse key plus one randomized-response bit.
// This function checks the caller and their consent, bounds contribution to one
// report per account per window with an HMAC tag, adds the cells to
// private.agg_outcome and forgets who sent them. No per-report rows, no user
// id, no body logging.
//
// Request:  POST, Authorization: Bearer <access token>, body AggReport (<= 4 KB).
// Response: 204 stored.
//   Errors use the shared { error: { code, message } } shape:
//   400 bad_request (not JSON), 401 unauthorized, 403 forbidden_origin | consent_required,
//   405, 409 already_reported, 413, 415, 422 invalid_report | window_closed | window_future,
//   500 misconfigured | internal, 503 unavailable.
//
// Stored today: `cells`. `engine` and `ai` rows are validated but not stored
// until tables for them exist (see the final report of this change).

import { type AuthResult } from '../_shared/auth.ts';
import {
  type CorsPolicy,
  corsHeaders,
  originRefused,
  preflight,
} from '../_shared/cors.ts';
import { aggReportSchema } from '../_shared/core.bundle.js';
import {
  empty,
  errorResponse,
  fromHttpError,
  HttpError,
  logEvent,
  readJsonBody,
} from '../_shared/http.ts';
import type { IngestOutcome, IngestStore } from './store.ts';
import { ingestTag, usableSecret } from './tag.ts';
import { checkWindow, windowAt } from './window.ts';

export const MAX_BODY_BYTES = 4 * 1024;
/** One report per account per window (personalization.md 14.2 step 4). */
export const REPORTS_PER_WINDOW = 1;
/** A finished window still accepts its report for this long. */
export const GRACE_MS = 7 * 86_400_000;
/** Device clocks may run this far ahead at a window boundary. */
export const CLOCK_SKEW_MS = 15 * 60_000;
/** Aggregates are kept 13 months (personalization.md 14.3). */
export const RETENTION_MS = 396 * 86_400_000;
export const STORE_DEADLINE_MS = 6_000;

export interface IngestDeps {
  /** Extension origins. */
  cors: CorsPolicy;
  verify(req: Request): Promise<AuthResult>;
  /** Lazily built; throws MissingEnvError when the database URL is not set. */
  store(): IngestStore;
  /** INGEST_TAG_SECRET. */
  tagSecret: string | undefined;
  /** Wall-clock epoch milliseconds. */
  now(): number;
  log?: typeof logEvent;
  storeDeadlineMs?: number;
}

const isMissingEnv = (error: unknown): boolean =>
  error instanceof Error && error.name === 'MissingEnvError';
const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'unknown';

class DeadlineError extends Error {
  constructor() {
    super('The store did not answer in time.');
    this.name = 'DeadlineError';
  }
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createIngestHandler(
  deps: IngestDeps,
): (req: Request) => Promise<Response> {
  const log = deps.log ?? logEvent;

  return async function handle(req: Request): Promise<Response> {
    const pre = preflight(req, deps.cors);
    if (pre) return pre;

    const cors = corsHeaders(deps.cors, req.headers.get('origin'));
    if (originRefused(deps.cors, req)) {
      return errorResponse(
        403,
        'forbidden_origin',
        'This origin may not send reports.',
        cors,
      );
    }
    if (req.method !== 'POST') {
      return empty(405, { ...cors, Allow: 'POST, OPTIONS' });
    }

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

      const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
      const parsed = aggReportSchema.safeParse(body);
      if (!parsed.success) {
        log('ingest_invalid', {
          issue: parsed.error.issues[0]?.code ?? 'body',
        });
        return errorResponse(
          422,
          'invalid_report',
          'The report does not match AggReport v1.',
          cors,
        );
      }
      const report = parsed.data;

      const nowMs = deps.now();
      const window = checkWindow(report.window, new Date(nowMs), {
        graceMs: GRACE_MS,
        skewMs: CLOCK_SKEW_MS,
      });
      if (!window.ok) {
        log('ingest_invalid', { issue: `window_${window.reason}` });
        return window.reason === 'malformed'
          ? errorResponse(422, 'invalid_report', 'Unknown window id.', cors)
          : errorResponse(
              422,
              `window_${window.reason}`,
              window.reason === 'closed'
                ? 'This window no longer accepts reports.'
                : 'This window has not started.',
              cors,
            );
      }

      if (!usableSecret(deps.tagSecret)) {
        log('ingest_misconfigured', { missing: 'INGEST_TAG_SECRET' });
        return errorResponse(
          500,
          'misconfigured',
          'The function is missing configuration.',
          cors,
        );
      }
      const tag = await ingestTag(
        deps.tagSecret,
        window.window.id,
        auth.user.id,
      );

      let outcome: IngestOutcome;
      try {
        outcome = await withDeadline(
          deps.store().submit({
            userId: auth.user.id,
            tag,
            period: window.window.id,
            expiresAt: window.expiresAt,
            limit: REPORTS_PER_WINDOW,
            windowId: window.window.id,
            libVer: report.libVer,
            cells: report.cells,
            retentionCutoff: windowAt(new Date(nowMs - RETENTION_MS)).id,
          }),
          deps.storeDeadlineMs ?? STORE_DEADLINE_MS,
        );
      } catch (error) {
        if (isMissingEnv(error)) throw error;
        log('ingest_unavailable', { reason: errorName(error) });
        return errorResponse(
          503,
          'unavailable',
          'Reports cannot be stored right now.',
          {
            ...cors,
            'Retry-After': '60',
          },
        );
      }

      switch (outcome) {
        case 'no_consent':
          log('ingest_no_consent', {});
          return errorResponse(
            403,
            'consent_required',
            'Product learning is off for this account.',
            cors,
          );
        case 'already_reported':
          log('ingest_duplicate', {});
          return errorResponse(
            409,
            'already_reported',
            'This window already has a report from this account.',
            cors,
          );
        case 'stored':
          log('ingest_stored', { cells: report.cells.length });
          return empty(204, cors);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        log('ingest_rejected', { status: error.status, code: error.code });
        return fromHttpError(error, cors);
      }
      if (isMissingEnv(error)) {
        log('ingest_misconfigured', {});
        return errorResponse(
          500,
          'misconfigured',
          'The function is missing configuration.',
          cors,
        );
      }
      log('ingest_error', { reason: errorName(error) });
      return errorResponse(500, 'internal', 'Unexpected error.', cors);
    }
  };
}
