import { createHash } from 'node:crypto';

/** An error that maps to an HTTP response. `code` is a stable machine word; `message` never contains page text. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 413 | 422 | 500 | 502 | 503 | 504,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** JSON with object keys sorted, for hashing only (never for what we send: Jev reads key order). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function hashOf(...parts: unknown[]): string {
  return sha256(parts.map((p) => (typeof p === 'string' ? p : canonicalJson(p))).join('\u0000'));
}

export const round = (v: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Median of a list (null when empty). */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** One log line per event. Never pass bodies, page text or keys here. */
export function log(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  console.log(`[webable] ${event}${parts.length ? ' ' + parts.join(' ') : ''}`);
}
