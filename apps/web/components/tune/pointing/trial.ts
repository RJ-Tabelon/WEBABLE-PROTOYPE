import type { Point, PointerTrial } from '@webable/core';

/**
 * Pointer trial bookkeeping (cal-motor §5.3-5.5). A trial starts at the
 * previous release and ends at the next release; the press position decides
 * hit or miss. Samples live in a short ring buffer only until the trial's
 * features are extracted, then they are dropped.
 */

export interface Sample {
  x: number;
  y: number;
  t: number;
}

/** About 3 s of samples at 120 Hz. */
export const SAMPLE_BUFFER = 360;
/** Accidental repeat: within 500 ms and 5 px (or on the same target). */
export const REPEAT_WINDOW_MS = 500;
export const REPEAT_RADIUS_PX = 5;
/** Speed at press is the mean over this window, ms. */
export const SPEED_WINDOW_MS = 50;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Circular target of diameter `sizePx` centred on `center`. */
export function isHit(point: Point, center: Point, sizePx: number): boolean {
  return distance(point, center) <= sizePx / 2;
}

/** Keeps the newest `capacity` samples. */
export class SampleBuffer {
  private readonly items: Sample[] = [];
  constructor(private readonly capacity = SAMPLE_BUFFER) {}

  push(sample: Sample): void {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return;
    this.items.push(sample);
    if (this.items.length > this.capacity)
      this.items.splice(0, this.items.length - this.capacity);
  }

  /** Samples with t in [from, to]. */
  between(from: number, to: number): Sample[] {
    return this.items.filter((s) => s.t >= from && s.t <= to);
  }

  clear(): void {
    this.items.length = 0;
  }

  get size(): number {
    return this.items.length;
  }
}

/** Mean speed (px/ms) over the window before `t`, from raw samples. */
export function speedBefore(
  samples: readonly Sample[],
  t: number,
  windowMs = SPEED_WINDOW_MS,
): number {
  const inWindow = samples
    .filter((s) => s.t >= t - windowMs && s.t <= t)
    .sort((a, b) => a.t - b.t);
  if (inWindow.length < 2) return 0;
  let path = 0;
  for (let i = 1; i < inWindow.length; i++) {
    const a = inWindow[i - 1];
    const b = inWindow[i];
    if (a && b) path += distance(a, b);
  }
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const span = first && last ? last.t - first.t : 0;
  return span > 0 ? round(path / span, 3) : 0;
}

/** Largest distance from `origin` among samples in [from, to]. */
export function maxTravel(
  samples: readonly Sample[],
  origin: Point,
  from: number,
  to: number,
): number {
  let max = 0;
  for (const s of samples) {
    if (s.t < from || s.t > to) continue;
    max = Math.max(max, distance(s, origin));
  }
  return round(max, 2);
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export interface PressRecord {
  targetPx: number;
  targetCenter: Point;
  /** Where and when the previous trial ended (the previous release). */
  start: Point;
  tStart: number;
  down: Point;
  tDown: number;
  up: Point;
  tUp: number;
  pointerType: PointerTrial['pointerType'];
  scored: boolean;
}

/** Build the core trial record from one press and the samples around it. */
export function buildPointerTrial(
  press: PressRecord,
  samples: readonly Sample[],
): PointerTrial {
  const hitDown = isHit(press.down, press.targetCenter, press.targetPx);
  const hitUp = isHit(press.up, press.targetCenter, press.targetPx);
  return {
    targetPx: press.targetPx,
    targetCenter: roundPoint(press.targetCenter),
    start: roundPoint(press.start),
    tStart: press.tStart,
    tDown: press.tDown,
    tUp: press.tUp,
    down: roundPoint(press.down),
    up: roundPoint(press.up),
    hitDown,
    hitUp,
    pressMs: Math.max(0, Math.round(press.tUp - press.tDown)),
    pressPathMaxPx: Math.max(
      maxTravel(samples, press.down, press.tDown, press.tUp),
      round(distance(press.down, press.up), 2),
    ),
    speedAtDown: speedBefore(samples, press.tDown),
    extraPresses: [],
    pointerType: press.pointerType,
    scored: press.scored,
  };
}

function roundPoint(p: Point): Point {
  return { x: round(p.x, 1), y: round(p.y, 1) };
}

/**
 * Whether a new press is an accidental repeat of the last trial: within 500 ms
 * of its release and within 5 px of its press, or on the same target.
 */
export function isRepeatPress(
  last: PointerTrial,
  down: Point,
  tDown: number,
): { repeat: boolean; dtMs: number; distPx: number; sameTarget: boolean } {
  const dtMs = Math.max(0, tDown - last.tUp);
  const distPx = distance(down, last.down);
  const sameTarget = isHit(down, last.targetCenter, last.targetPx);
  const repeat =
    dtMs < REPEAT_WINDOW_MS && (distPx < REPEAT_RADIUS_PX || sameTarget);
  return {
    repeat,
    dtMs: Math.round(dtMs),
    distPx: round(distPx, 1),
    sameTarget,
  };
}

/** Median press-to-release move time of scored trials, ms. */
export function medianMoveMs(trials: readonly PointerTrial[]): number {
  const times = trials
    .filter((t) => t.scored)
    .map((t) => t.tDown - t.tStart)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (times.length === 0) return 0;
  const mid = Math.floor(times.length / 2);
  return times.length % 2
    ? (times[mid] ?? 0)
    : ((times[mid - 1] ?? 0) + (times[mid] ?? 0)) / 2;
}

/** p95 distance of points from their centroid (hold jitter, tap spread). */
export function spreadP95(points: readonly Point[]): number {
  if (points.length === 0) return 0;
  const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const cy = points.reduce((a, p) => a + p.y, 0) / points.length;
  const d = points
    .map((p) => Math.hypot(p.x - cx, p.y - cy))
    .sort((a, b) => a - b);
  const pos = (d.length - 1) * 0.95;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = d[lo] ?? 0;
  const b = d[hi] ?? a;
  return round(a + (b - a) * (pos - lo), 2);
}

/** Pointer type as the core records it. */
export function pointerTypeOf(type: string): PointerTrial['pointerType'] {
  return type === 'touch' ? 'touch' : type === 'pen' ? 'pen' : 'mouse';
}
