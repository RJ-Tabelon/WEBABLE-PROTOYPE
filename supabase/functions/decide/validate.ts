// Request validation for `decide`: catalog version, strict schema, then a
// server-side re-check of every word against VOCAB_V1 (ai-architecture.md 3.2.3).
// A modified client therefore cannot use the proxy to send free text: the only
// strings that reach Jev are enum values and words from the public vocabulary.
//
// Nothing here returns or logs the offending values. Unknown words may be page
// text from a buggy or hostile client, so only counts and schema paths come out.

import {
  CATALOG_VERSION,
  decideRequestSchema,
  MAX_CONTROL_WORDS,
  MAX_HEADING_WORDS,
  vocabularyViolations,
  type DecideRequest,
} from '../_shared/core.bundle.js';

// The check itself lives in core (page/vocab-check.ts), so the extension runs
// the same one before anything leaves the device.
export { MAX_CONTROL_WORDS, MAX_HEADING_WORDS, vocabularyViolations };

/** Catalogs this deployment can answer. During a rollout it holds N and N-1. */
export const SUPPORTED_CATALOGS: ReadonlySet<string> = new Set([
  CATALOG_VERSION,
]);

export type Validation =
  | { ok: true; request: DecideRequest }
  | { ok: false; reason: 'catalog_mismatch' }
  | {
      ok: false;
      reason: 'bad_input';
      stage: 'body' | 'schema' | 'vocabulary';
      /** First schema issue as `code@path` (schema keys and indices only). */
      issue?: string;
      /** Number of vocabulary violations. */
      count?: number;
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeIssue(issue: {
  code: string;
  path: ReadonlyArray<PropertyKey>;
}): string {
  const path = issue.path
    .map((p) => (typeof p === 'symbol' ? '?' : String(p)))
    .join('.');
  return `${issue.code}@${path || '(root)'}`;
}

export function validateDecideRequest(body: unknown): Validation {
  if (!isPlainObject(body))
    return { ok: false, reason: 'bad_input', stage: 'body' };

  // An older or newer client: say so precisely (409) rather than "bad input".
  if (
    typeof body.catalog === 'string' &&
    !SUPPORTED_CATALOGS.has(body.catalog)
  ) {
    return { ok: false, reason: 'catalog_mismatch' };
  }

  const parsed = decideRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      reason: 'bad_input',
      stage: 'schema',
      ...(first ? { issue: describeIssue(first) } : {}),
    };
  }

  const request = parsed.data;
  let count = 0;
  for (const region of request.regions)
    count += vocabularyViolations(region.ev);
  for (const candidate of request.mainCandidates ?? [])
    count += vocabularyViolations(candidate.ev);
  if (count > 0)
    return { ok: false, reason: 'bad_input', stage: 'vocabulary', count };

  return { ok: true, request };
}
