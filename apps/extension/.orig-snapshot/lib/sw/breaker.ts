/**
 * Page-analysis circuit breaker (ai-architecture.md 3.1 G7 and 7): three
 * consecutive failures pause calls for 5 minutes, doubling up to 60 minutes;
 * a server `retryAfterMs` (quota, rate limit) opens it for at least that long.
 * A success closes it and resets the backoff. Pure; the worker persists it.
 */
export interface BreakerState {
  failures: number;
  /** Calls are refused until this time (ms). 0 = closed. */
  openUntil: number;
  /** The next open period (ms). */
  backoffMs: number;
}

export const BREAKER = {
  FAILURES_TO_OPEN: 3,
  BASE_MS: 5 * 60_000,
  MAX_MS: 60 * 60_000,
} as const;

export const closedBreaker = (): BreakerState => ({
  failures: 0,
  openUntil: 0,
  backoffMs: BREAKER.BASE_MS,
});

export function breakerOpen(s: BreakerState, now: number): boolean {
  return now < s.openUntil;
}

export function breakerSuccess(): BreakerState {
  return closedBreaker();
}

export function breakerFailure(
  s: BreakerState,
  now: number,
  retryAfterMs?: number,
): BreakerState {
  const failures = s.failures + 1;
  const retry =
    retryAfterMs !== undefined &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
      ? Math.min(retryAfterMs, BREAKER.MAX_MS)
      : 0;
  if (failures < BREAKER.FAILURES_TO_OPEN && retry === 0) {
    return { ...s, failures };
  }
  const period = Math.max(
    retry,
    failures >= BREAKER.FAILURES_TO_OPEN ? s.backoffMs : 0,
  );
  return {
    failures: failures >= BREAKER.FAILURES_TO_OPEN ? 0 : failures,
    openUntil: now + period,
    backoffMs:
      failures >= BREAKER.FAILURES_TO_OPEN
        ? Math.min(BREAKER.MAX_MS, s.backoffMs * 2)
        : s.backoffMs,
  };
}

export function normalizeBreaker(raw: unknown): BreakerState {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as BreakerState).failures === 'number' &&
    typeof (raw as BreakerState).openUntil === 'number' &&
    typeof (raw as BreakerState).backoffMs === 'number'
  ) {
    const r = raw as BreakerState;
    return {
      failures: Math.max(0, r.failures),
      openUntil: Math.max(0, r.openUntil),
      backoffMs: Math.min(
        BREAKER.MAX_MS,
        Math.max(BREAKER.BASE_MS, r.backoffMs),
      ),
    };
  }
  return closedBreaker();
}
