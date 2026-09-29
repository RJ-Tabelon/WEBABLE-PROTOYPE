import { HOST_TAG, type TreeScope } from '../util/dom';

/**
 * Incremental re-application (engine.md 3.5). Only childList additions are
 * observed (never attributes, so WebAble's own marks never feed back).
 * Additions are debounced (150 ms, max wait 1 s), nested roots collapsed,
 * and a burst of more than 1,000 added elements switches to a full pass.
 * Pages that mutate constantly (tickers, feeds) back the debounce off.
 */

export interface SchedulerOptions {
  debounceMs: number;
  maxWaitMs: number;
  huge: number;
}

export const DEFAULT_SCHEDULER: SchedulerOptions = {
  debounceMs: 150,
  maxWaitMs: 1000,
  huge: 1000,
};

export type FlushRoots = Element[] | 'all';

export class MutationScheduler {
  private pending = new Set<Element>();
  private huge = false;
  private first = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushTimes: number[] = [];
  private debounce: number;
  private readonly observers: MutationObserver[] = [];
  private readonly observed = new WeakSet<TreeScope>();
  private running = false;

  constructor(
    private readonly run: (roots: FlushRoots) => Promise<void>,
    private readonly opts: SchedulerOptions = DEFAULT_SCHEDULER,
    private readonly onActivity?: () => void,
  ) {
    this.debounce = opts.debounceMs;
  }

  observe(root: TreeScope): void {
    if (this.observed.has(root)) return;
    this.observed.add(root);
    const mo = new MutationObserver((recs) => this.onRecords(recs));
    mo.observe(root, { childList: true, subtree: true });
    this.observers.push(mo);
  }

  /** Visible for tests. */
  onRecords(recs: readonly MutationRecord[]): void {
    let added = 0;
    for (const r of recs) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        const el = n as Element;
        if (el.localName === HOST_TAG) continue;
        if (++added > this.opts.huge) {
          this.huge = true;
          break;
        }
        this.pending.add(el);
      }
    }
    if (added === 0 && !this.huge) return;
    this.onActivity?.();
    const now = performance.now();
    if (!this.first) this.first = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(
      0,
      Math.min(this.debounce, this.opts.maxWaitMs - (now - this.first)),
    );
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.running) {
      // A flush is in progress: try again after it.
      this.timer = setTimeout(() => void this.flush(), this.debounce);
      return;
    }
    const all = [...this.pending];
    const roots: FlushRoots = this.huge
      ? 'all'
      : all.filter(
          (e) => e.isConnected && !all.some((p) => p !== e && p.contains(e)),
        );
    this.pending.clear();
    this.huge = false;
    this.first = 0;
    const now = performance.now();
    this.flushTimes = this.flushTimes.filter((t) => now - t < 10_000);
    this.flushTimes.push(now);
    if (this.flushTimes.length > 20)
      this.debounce = Math.min(this.debounce * 2, 2000);
    if (roots !== 'all' && roots.length === 0) return;
    this.running = true;
    try {
      await this.run(roots);
    } finally {
      this.running = false;
    }
  }

  disconnect(): void {
    for (const mo of this.observers) mo.disconnect();
    this.observers.length = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
