// Collects FittingRaw and the session numbers in memory while the warm-up runs. Only the derived fit (with the
// session's counts and timings in `calibration.warmup`) is saved; per-trial data is dropped when the page closes.

import type {
  FittingRaw, InputClass, Polarity, ReadTrial, WarmupBlock, WarmupBlockMetrics, WarmupMetrics,
} from '@webable/core';
import type { SiteTaskResult } from '../../../src/sitetask/types';
import type { RingPress } from './pointing';

/** Added to gotInWay when the person pressed a "stop the moving parts" control (core reads it as the stop press). */
export const STOPPED_MOTION = 'pressed stop';

type FindTrial = { clutter: boolean; motion: boolean; ms: number; found: boolean };

/**
 * One Finding trial from one real site (round 8c): `{ clutter: busy, motion: motionSeen, ms, found }`. A site the person
 * never really tried (it didn't load, or they skipped it without searching) gives no trial; a site they searched and
 * then skipped, or never found, is a trial that was not found.
 */
export function siteTrial(r: SiteTaskResult): FindTrial | null {
  const tried = !r.skipped || (r.presses ?? 0) > 1 || (r.wrongClicks ?? 0) > 0 || (r.scrollScreens ?? 0) >= 0.5;
  if (!tried) return null;
  const found = !!r.found && r.ms != null && Number.isFinite(r.ms) && r.ms > 0;
  return { clutter: !!r.busy, motion: !!r.motionSeen, ms: Math.round(found ? (r.ms as number) : Math.max(0, r.ms ?? 0)), found };
}

interface PressDown {
  x: number;
  y: number;
  t: number;
  el: Element | null;
  repeat: boolean;
}

function rectHas(r: DOMRect, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

interface BlockClock {
  status: WarmupBlockMetrics['status'];
  activeMs: number;
  since: number | null;
  actions: number;
  trials: number;
  stop?: string;
}

export class RawCollector {
  inputClass: InputClass = 'mouse';
  /** This page's zoom: every px value is reported as CSS px × zoom, i.e. px at 100%. */
  zoom = 1;
  readonly skipped = new Set<WarmupBlock>();
  readonly done = new Set<WarmupBlock>();

  /** R1: the comfortable size the person picked (px at 100%). */
  seedPx: number | null = null;
  ladder: ReadTrial[] = [];
  faint: Array<{ contrast: number; correct: boolean }> = [];
  /** R4: reading times (56-character standard) on the light and the dark stage. */
  lightMs: number[] = [];
  darkMs: number[] = [];
  stated: Polarity | null = null;
  /** Steps with no block of their own in core's list ('size', 'light or dark'), when skipped. */
  readonly skippedSteps = new Set<string>();
  blocks: Array<{ sizePx: number; presses: RingPress[] }> = [];
  findTrials: FindTrial[] = [];
  /** The real sites (round 8c), in the order visited, for the results page's evidence. */
  sites: SiteTaskResult[] = [];
  preferredCalm = 0;
  stoppedMotion = false;
  /** Extra "what got in the way" notes. Core reads "moving things" as a reason to hold motion still. */
  notes: string[] = [];
  readonly presses: Array<{ slipped: boolean; repeat: boolean }> = [];

  private activeMs = 0;
  private runningSince: number | null = null;
  private actionCount = 0;
  private readonly clocks = new Map<WarmupBlock, BlockClock>();
  private current: WarmupBlock | null = null;
  private down: PressDown | null = null;
  private lastUp: { x: number; y: number; t: number; el: Element | null } | null = null;

  /* ---------------- active time (pauses and hidden tabs excluded) ---------------- */

  startClock(): void {
    const now = performance.now();
    if (this.runningSince === null) this.runningSince = now;
    const c = this.current ? this.clocks.get(this.current) : null;
    if (c && c.since === null) c.since = now;
  }

  stopClock(): void {
    const now = performance.now();
    if (this.runningSince !== null) {
      this.activeMs += now - this.runningSince;
      this.runningSince = null;
    }
    const c = this.current ? this.clocks.get(this.current) : null;
    if (c && c.since !== null) {
      c.activeMs += now - c.since;
      c.since = null;
    }
  }

  get running(): boolean {
    return this.runningSince !== null;
  }

  get activeTotalMs(): number {
    return this.activeMs + (this.runningSince === null ? 0 : performance.now() - this.runningSince);
  }

  get durationSec(): number {
    return Math.round(this.activeTotalMs / 1000);
  }

  /* ---------------- blocks ---------------- */

  beginBlock(id: WarmupBlock): void {
    this.endCurrent();
    this.current = id;
    const c: BlockClock = this.clocks.get(id) ?? { status: 'done', activeMs: 0, since: null, actions: 0, trials: 0 };
    c.since = this.runningSince !== null ? performance.now() : null;
    this.clocks.set(id, c);
  }

  private endCurrent(): void {
    const c = this.current ? this.clocks.get(this.current) : null;
    if (c && c.since !== null) {
      c.activeMs += performance.now() - c.since;
      c.since = null;
    }
    this.current = null;
  }

  /** Close the running block with its outcome. */
  endBlock(id: WarmupBlock, outcome: { trials: number; stop?: string; skipped?: boolean }): void {
    const c = this.clocks.get(id) ?? { status: 'done' as const, activeMs: 0, since: null, actions: 0, trials: 0 };
    if (this.current === id) this.endCurrent();
    c.trials = outcome.trials;
    c.stop = outcome.skipped ? 'person' : outcome.stop;
    c.status = outcome.skipped ? 'skipped' : 'done';
    this.clocks.set(id, c);
    if (outcome.skipped) this.skip(id);
    else this.complete(id);
  }

  markBlock(id: WarmupBlock, status: 'prefilled' | 'not_run'): void {
    this.clocks.set(id, { status, activeMs: 0, since: null, actions: 0, trials: 0 });
    if (status === 'not_run' || status === 'prefilled') this.skipped.add(id);
  }

  blockActiveMs(id: WarmupBlock): number {
    const c = this.clocks.get(id);
    if (!c) return 0;
    return c.activeMs + (c.since !== null ? performance.now() - c.since : 0);
  }

  /** Any press or key press (counts toward the session's actions and the running block's). */
  countAction(): void {
    this.actionCount += 1;
    const c = this.current ? this.clocks.get(this.current) : null;
    if (c) c.actions += 1;
  }

  /* ---------------- presses anywhere in the warm-up ---------------- */

  private isRepeat(x: number, y: number, t: number, el: Element | null): boolean {
    const last = this.lastUp;
    if (!last || t - last.t > 500) return false;
    return Math.hypot(x - last.x, y - last.y) <= 5 || (el !== null && el === last.el);
  }

  onPointerDown(e: PointerEvent): void {
    if (!e.isPrimary) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('[data-ring]')) return; // the ring reports its own presses
    const el = target?.closest('button, a, [role="button"], [data-press]') ?? null;
    this.down = { x: e.clientX, y: e.clientY, t: e.timeStamp, el, repeat: this.isRepeat(e.clientX, e.clientY, e.timeStamp, el) };
  }

  onPointerUp(e: PointerEvent): void {
    const d = this.down;
    if (!d || !e.isPrimary) return;
    this.down = null;
    const slipped = d.el ? !rectHas(d.el.getBoundingClientRect(), e.clientX, e.clientY) : false;
    this.presses.push({ slipped, repeat: d.repeat });
    this.lastUp = { x: e.clientX, y: e.clientY, t: e.timeStamp, el: d.el };
  }

  /** Ring presses: the ring knows the dot geometry, so it decides slipped itself. */
  ringPress(downX: number, downY: number, downT: number, upX: number, upY: number, upT: number, slipped: boolean): void {
    const repeat = this.isRepeat(downX, downY, downT, null);
    this.presses.push({ slipped, repeat });
    this.lastUp = { x: upX, y: upY, t: upT, el: null };
  }

  /**
   * The real sites' results: one Finding trial per site, and every press on the sites into allPresses (their slips
   * count toward steady clicks like any other press). Call once per run. Returns the trials added.
   */
  addSites(results: readonly SiteTaskResult[]): number {
    this.sites = results.map((r) => ({ ...r }));
    let added = 0;
    for (const r of results) {
      const t = siteTrial(r);
      if (t) {
        this.findTrials.push(t);
        added += 1;
      }
      const n = Math.max(0, Math.min(500, Math.round(r.presses ?? 0)));
      const slips = Math.max(0, Math.min(n, Math.round(r.slips ?? 0)));
      for (let k = 0; k < n; k++) this.presses.push({ slipped: k < slips, repeat: false });
    }
    return added;
  }

  /* ---------------- outcomes ---------------- */

  skip(id: WarmupBlock): void {
    if (!this.done.has(id)) this.skipped.add(id);
  }

  complete(id: WarmupBlock): void {
    this.done.add(id);
    this.skipped.delete(id);
  }

  /** Drop trials so a retake starts from an empty session. */
  reset(): void {
    this.stopClock();
    this.skipped.clear();
    this.done.clear();
    this.seedPx = null;
    this.ladder = [];
    this.faint = [];
    this.lightMs = [];
    this.darkMs = [];
    this.stated = null;
    this.skippedSteps.clear();
    this.blocks = [];
    this.findTrials = [];
    this.sites = [];
    this.preferredCalm = 0;
    this.stoppedMotion = false;
    this.notes = [];
    this.presses.length = 0;
    this.activeMs = 0;
    this.runningSince = null;
    this.actionCount = 0;
    this.clocks.clear();
    this.current = null;
    this.down = null;
    this.lastUp = null;
  }

  /** px as reported to core: CSS px scaled by the page zoom, so it means px at 100%. */
  eff(cssPx: number): number {
    return Math.round(cssPx * this.zoom * 10) / 10;
  }

  toRaw(): FittingRaw {
    const readingTouched = this.seedPx != null || this.ladder.length > 0 || this.faint.length > 0 || this.stated !== null;
    const gotInWay = [...(this.stoppedMotion ? [STOPPED_MOTION] : []), ...this.notes];
    const findingTouched = this.done.has('find') || this.done.has('pick');
    return {
      inputClass: this.inputClass,
      durationSec: this.durationSec,
      skipped: [...this.skipped, ...this.skippedSteps],
      reading: readingTouched
        ? {
            seedPx: this.seedPx,
            ladder: this.ladder.map((t) => ({ ...t })),
            faint: this.faint.map((t) => ({ ...t })),
            polarity: { lightMs: [...this.lightMs], darkMs: [...this.darkMs], stated: this.stated },
          }
        : null,
      pointing: this.blocks.length
        ? { blocks: this.blocks.map((b) => ({ sizePx: b.sizePx, presses: b.presses.map((p) => ({ ...p })) })) }
        : null,
      finding: findingTouched
        ? { trials: this.findTrials.map((t) => ({ ...t })), preferredCalm: this.preferredCalm, gotInWay }
        : null,
      allPresses: this.presses.map((p) => ({ ...p })),
    };
  }

  metrics(opts: { completed: boolean; corrections: WarmupMetrics['corrections']; settingsUsed: string[] }): WarmupMetrics {
    const order: WarmupBlock[] = ['read', 'faint', 'point', 'find', 'pick', 'confirm'];
    const blocks: WarmupBlockMetrics[] = [];
    for (const id of order) {
      const c = this.clocks.get(id);
      if (!c) continue;
      const m: WarmupBlockMetrics = {
        block: id,
        status: c.status,
        activeMs: Math.round(c.activeMs + (c.since !== null ? performance.now() - c.since : 0)),
        actions: c.actions,
        trials: c.trials,
      };
      if (c.stop) m.stop = c.stop;
      blocks.push(m);
    }
    return {
      v: 'warmup.1',
      activeMs: Math.round(this.activeTotalMs),
      actions: this.actionCount,
      completed: opts.completed,
      blocks,
      corrections: opts.corrections,
      settingsUsed: opts.settingsUsed,
    };
  }
}
