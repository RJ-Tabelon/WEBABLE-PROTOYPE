// Point: the dot ring's block statistics and the walk that picks the next dot size (onboarding spec, P1).
// Core's deriveFit recomputes the minimum target from the blocks; this decides only what to show next.

import { median } from './rand';

export const MOUSE_LADDER = [24, 32, 44, 56, 72, 96] as const;
export const TOUCH_LADDER = [44, 56, 72, 96] as const;
export const RING_COUNT = 9;
/** Visiting order across the ring (ISO 9241-9 style): each step jumps to the far side. */
export const RING_ORDER: number[] = Array.from({ length: RING_COUNT }, (_, k) => (k * 5) % RING_COUNT);

export interface RingPress {
  dx: number;
  dy: number;
  hit: boolean;
  slipped: boolean;
}

export interface BlockStats {
  misses: number;
  sigma: number;
  sigmaAbs: number;
  pMiss: number;
  pass: boolean;
}

/** P(miss) for a circular target of diameter L with a circular Gaussian spread sigma. */
export function pMissCircle(L: number, sigma: number): number {
  if (sigma <= 0) return 0;
  return Math.exp(-(L * L) / (8 * sigma * sigma));
}

export function blockStats(sizePx: number, presses: RingPress[]): BlockStats {
  const W = sizePx;
  const misses = presses.filter((p) => !p.hit).length;
  const r = presses.map((p) => Math.hypot(p.dx, p.dy)).filter((d) => d <= 2 * W);
  const sigma = r.length ? median(r) / 1.1774 : W;
  const sigmaAbs = Math.sqrt(Math.max(0, sigma * sigma - (0.16 * W) ** 2));
  const pMiss = pMissCircle(W, Math.sqrt((1.15 * sigmaAbs) ** 2 + (0.16 * W) ** 2));
  return { misses, sigma, sigmaAbs, pMiss, pass: misses <= 1 && pMiss <= 0.08 };
}

export interface BlockRecord {
  sizePx: number;
  /** Scored presses only (the very first press of the dots positions the pointer and is not scored). */
  presses: RingPress[];
  pass: boolean;
}

/**
 * The dots walk (onboarding spec, P1): blocks of 8 scored presses, at most 3 blocks, starting at 44 px on every input.
 * A block passes with at most one miss and a tight spread (core's rule for 8 presses). The walk goes down a size after a
 * pass and up after a fail, and stops at the first reversal, the end of the ladder, or the third block.
 */
export class BlockWalk {
  static readonly PER_BLOCK = 8;
  static readonly MAX_BLOCKS = 3;

  readonly blocks: BlockRecord[] = [];
  private readonly ladder: readonly number[];
  private idx: number;
  private direction: -1 | 1 | null = null;
  private presses: RingPress[] = [];
  private positioned = false;
  private finished = false;
  stopReason: 'reversal' | 'ladder_end' | 'max_trials' | null = null;

  constructor(touch: boolean) {
    this.ladder = touch ? TOUCH_LADDER : MOUSE_LADDER;
    this.idx = this.ladder.indexOf(44);
  }

  get done(): boolean {
    return this.finished;
  }

  /** Dot size (px at 100%) for the next press, or null when finished. */
  current(): number | null {
    return this.finished ? null : (this.ladder[this.idx] ?? null);
  }

  get scoredCount(): number {
    return this.blocks.reduce((a, b) => a + b.presses.length, 0) + this.presses.length;
  }

  /** Record one press at the current size. */
  press(p: RingPress): void {
    if (this.finished) return;
    if (!this.positioned) {
      this.positioned = true;
      return;
    }
    this.presses.push(p);
    if (this.presses.length < BlockWalk.PER_BLOCK) return;
    const size = this.ladder[this.idx] ?? 44;
    const pass = blockStats(size, this.presses).pass;
    this.blocks.push({ sizePx: size, presses: this.presses, pass });
    this.presses = [];
    const dir: -1 | 1 = pass ? -1 : 1;
    if (this.direction !== null && dir !== this.direction) return this.finish('reversal');
    this.direction = dir;
    if (this.blocks.length >= BlockWalk.MAX_BLOCKS) return this.finish('max_trials');
    const next = this.idx + dir;
    if (next < 0 || next >= this.ladder.length) return this.finish('ladder_end');
    this.idx = next;
  }

  private finish(reason: 'reversal' | 'ladder_end' | 'max_trials'): void {
    this.finished = true;
    this.stopReason = reason;
  }
}

/** Ring geometry for a stage of the given size; grows so large dots never touch their neighbours. */
export function ringDiameter(stageW: number, stageH: number, touch: boolean, dotPx: number): number {
  const m = Math.min(stageW, stageH);
  const base = touch
    ? Math.min(260, Math.max(120, Math.round(0.3 * m)))
    : Math.min(280, Math.max(160, Math.round(0.28 * m)));
  const noTouching = Math.ceil((dotPx * RING_COUNT * 1.35) / Math.PI);
  return Math.max(base, noTouching);
}
