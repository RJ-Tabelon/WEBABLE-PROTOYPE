import { normCdf } from '../profile/needs';
import { K } from './params';
import type { Counts, Day, DimState } from './types';

/**
 * Pure numeric helpers shared by the learners and the delta merge.
 * Counts are decayed pseudo-counts with a 90-day half-life; dimensions are
 * scalar Gaussians in log space (personalization.md 7-8).
 */

const finite = (x: number, fallback = 0): number =>
  Number.isFinite(x) ? x : fallback;

/** Exponential decay of counts to `now` with half-life K.H_DAYS. Never inflates counts from the future. */
export function decayCounts(c: Counts, now: Day): Counts {
  const s = Math.max(0, finite(c.s));
  const f = Math.max(0, finite(c.f));
  const t = finite(c.t, now);
  const dt = now - t;
  if (!(dt > 0)) return { s, f, t: Math.max(t, now) };
  const g = Math.pow(2, -dt / K.H_DAYS);
  return { s: s * g, f: f * g, t: now };
}

/**
 * Add weighted pseudo-observations dated `day`. A contribution older than the
 * counts' own date is decayed to it, so additions commute: the result is
 * sum(w_i * 2^(-(T - day_i) / H)) whatever order they arrive in.
 */
export function addCounts(c: Counts, s: number, f: number, day: Day): Counts {
  const base = decayCounts(c, day);
  const g = day < base.t ? Math.pow(2, -(base.t - day) / K.H_DAYS) : 1;
  return {
    s: base.s + Math.max(0, s) * g,
    f: base.f + Math.max(0, f) * g,
    t: base.t,
  };
}

/** Remove previously credited weight (local reversal only), clamped at zero. */
export function subtractCounts(
  c: Counts,
  s: number,
  f: number,
  day: Day,
): Counts {
  const base = decayCounts(c, day);
  return {
    s: Math.max(0, base.s - Math.max(0, s)),
    f: Math.max(0, base.f - Math.max(0, f)),
    t: base.t,
  };
}

export const zeroCounts = (day: Day): Counts => ({ s: 0, f: 0, t: day });

export function normPdf(x: number): number {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
}

/** Kalman predict: variance grows by Q per idle day, capped at the calibration prior v0 = vCal + g^2. */
export function predictDim(s: DimState, day: Day, gap = 0.1): DimState {
  const dt = Math.max(0, day - s.t);
  const cap = s.vCal + gap * gap;
  const v = dt > 0 ? Math.min(s.v + K.Q_PER_DAY * dt, Math.max(cap, s.v)) : s.v;
  return { ...s, v, t: Math.max(s.t, day) };
}

/**
 * Scalar Kalman point update in log space (personalization.md 7.2), optionally
 * with a domain offset (7.4). Returns the updated dimension and offset.
 */
export function kalmanPoint(
  s: DimState,
  z: number,
  r: number,
  offset?: { d: number; v: number },
): { dim: DimState; offset?: { d: number; v: number } } {
  const off = offset ?? { d: 0, v: 0 };
  const e = z - (s.m + off.d);
  const S = s.v + off.v + r;
  const m = s.m + (s.v / S) * e;
  const v = Math.max(s.v - (s.v * s.v) / S, K.SIGMA_MIN ** 2);
  const dim: DimState = { ...s, m, v };
  if (!offset) return { dim };
  return {
    dim,
    offset: {
      d: off.d + (off.v / S) * e,
      v: Math.max(off.v - (off.v * off.v) / S, 1e-4),
    },
  };
}

/**
 * Probit (TrueSkill-style) moment-matching update for a censored observation
 * "the preference is above (dir = 1) / below (dir = -1) c this time"
 * (personalization.md 7.3). `c` and `offsetD` are in log space.
 */
export function probitUpdate(
  s: DimState,
  c: number,
  dir: 1 | -1,
  r: number,
  offsetD = 0,
): DimState {
  const sd = Math.sqrt(s.v + r);
  const t = (dir * (s.m + offsetD - c)) / sd;
  const lam = normPdf(t) / Math.max(normCdf(t), 1e-9);
  const m = s.m + dir * (s.v / sd) * lam;
  const v = Math.max(
    s.v * (1 - (s.v / (s.v + r)) * lam * (lam + t)),
    K.SIGMA_MIN ** 2,
  );
  return { ...s, m, v };
}

export const clamp01 = (x: number): number =>
  Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
export const logit = (p: number): number => Math.log(p / (1 - p));
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
