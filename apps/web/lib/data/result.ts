/**
 * Result types for server-side data access. Expected failures are values, not
 * exceptions, and carry a stable code plus a plain-language message that follows
 * the copy rules (design-final.md 13). Database details never reach the UI.
 */

export const DATA_ERROR_CODES = [
  'not_signed_in',
  'invalid_input',
  'too_large',
  'not_found',
  'conflict',
  'invalid_data',
  'rate_limited',
  'unavailable',
  'unknown',
] as const;

export type DataErrorCode = (typeof DATA_ERROR_CODES)[number];

export const DATA_ERROR_MESSAGES: Readonly<Record<DataErrorCode, string>> =
  Object.freeze({
    not_signed_in: 'Your session ended. Sign in again to continue.',
    invalid_input:
      'Some values were out of range, so nothing was saved. Try again.',
    too_large: 'That is more than WebAble can store. Nothing was saved.',
    not_found: 'That is no longer here. Nothing changed.',
    conflict:
      'This changed somewhere else. Reload to see the latest, then try again.',
    invalid_data:
      "Your saved fit couldn't be read. Tune again to make a new one.",
    rate_limited:
      'Too many tries in a short time. Wait a minute, then try again.',
    unavailable:
      "WebAble couldn't reach its server. Nothing changed. Try again in a moment.",
    unknown: 'Something went wrong. Nothing changed. Try again.',
  });

export interface DataError {
  code: DataErrorCode;
  message: string;
  /** Developer detail (schema paths), never shown to people. */
  issues?: string[];
}

export type DataResult<T> =
  { ok: true; data: T } | { ok: false; error: DataError };

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(
  code: DataErrorCode,
  issues?: string[],
): { ok: false; error: DataError } {
  const error: DataError = { code, message: DATA_ERROR_MESSAGES[code] };
  if (issues && issues.length > 0) error.issues = issues;
  return { ok: false, error };
}

/** The fields of a PostgREST error this mapping reads. */
export interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

/**
 * Map a PostgREST / Postgres error to a stable code. SQLSTATE classes:
 * 42501 permission, 23xxx integrity, 22xxx data, 57014 timeout, 40001 serialization.
 */
export function mapPostgrestError(
  error: PostgrestErrorLike | null | undefined,
): DataErrorCode {
  const code = error?.code ?? '';
  if (code === '') return 'unavailable'; // fetch failures carry no code
  if (
    code === '42501' ||
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    code === 'PGRST303'
  )
    return 'not_signed_in';
  if (code === 'PGRST116') return 'not_found';
  if (code === '23505' || code === '40001' || code === '40P01')
    return 'conflict';
  if (
    code === '23514' ||
    code === '23503' ||
    code === '23502' ||
    code.startsWith('22')
  )
    return 'invalid_input';
  if (
    code === '57014' ||
    code === '53300' ||
    code.startsWith('08') ||
    code === 'PGRST000' ||
    code === 'PGRST001' ||
    code === 'PGRST002'
  ) {
    return 'unavailable';
  }
  return 'unknown';
}

/** Schema issue paths for developers ("modules.reading.accuracy"). */
export function issuePaths(
  issues: ReadonlyArray<{ path: PropertyKey[] }>,
): string[] {
  return issues
    .slice(0, 10)
    .map((issue) => issue.path.map(String).join('.') || '(root)');
}

/**
 * Byte length of a value as Postgres prints jsonb (`{"a": 1, "b": [1, 2]}`), which
 * is what the table CHECK constraints measure with octet_length(col::text).
 */
export function jsonbTextBytes(value: unknown): number {
  const compact = JSON.stringify(value);
  if (compact === undefined) return 0;
  let separators = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      separators += Math.max(0, node.length - 1);
      node.forEach(walk);
    } else if (node !== null && typeof node === 'object') {
      const entries = Object.entries(node).filter(([, v]) => v !== undefined);
      separators += entries.length + Math.max(0, entries.length - 1);
      for (const [, v] of entries) walk(v);
    }
  };
  walk(value);
  return new TextEncoder().encode(compact).length + separators;
}

/**
 * Run a data operation so that an unexpected throw (a bug, a dropped connection)
 * still resolves to a DataResult. Logs the error name only: no personal data.
 */
export async function guarded<T>(
  label: string,
  run: () => Promise<DataResult<T>>,
): Promise<DataResult<T>> {
  try {
    return await run();
  } catch (error) {
    console.error(
      `[data] ${label} failed`,
      error instanceof Error ? error.name : typeof error,
    );
    return fail('unknown');
  }
}
