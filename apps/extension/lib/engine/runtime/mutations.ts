import { isOurs, type TreeScope } from '../util/dom';

/**
 * Host changes, including text updates and reused framework nodes. A narrow
 * attribute allowlist excludes WebAble's own marks, preventing feedback.
 * Changes are debounced (350 ms, max wait 1 s), nested roots collapsed,
 * and a burst of more than 1,000 added elements switches to a full pass.
 * Pages that mutate constantly (tickers, feeds) back the debounce off.
 */

export interface SchedulerOptions {
  debounceMs: number;
  maxWaitMs: number;
  huge: number;
}

export const DEFAULT_SCHEDULER: SchedulerOptions = {
  debounceMs: 350,
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
  private disposed = false;

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
    mo.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'hidden',
        'open',
        'role',
        'id',
        'lang',
        'aria-hidden',
        'type',
        'contenteditable',
      ],
    });
    this.observers.push(mo);
  }

  /** Visible for tests. */
  onRecords(recs: readonly MutationRecord[]): void {
    if (this.disposed) return;
    let changed = false;
    const add = (el: Element | null): void => {
      if (!el || isOurs(el)) return;
      changed = true;
      if (/^(style|link)$/.test(el.localName)) this.huge = true;
      this.pending.add(el);
      if (this.pending.size > this.opts.huge) this.huge = true;
    };
    for (const r of recs) {
      const target =
        r.target?.nodeType === 1
          ? (r.target as Element)
          : r.target?.parentElement;
      if (target && isOurs(target)) continue;
      if (r.type === 'attributes' || r.type === 'characterData')
        add(target ?? null);
      if (
        Array.from(r.removedNodes ?? []).some(
          (n) => n.nodeType !== 1 || !isOurs(n as Element),
        )
      )
        add(target ?? null);
      for (const n of r.addedNodes) {
        if (n.nodeType === 1) add(n as Element);
        else if (n.nodeType === 3) add(target ?? null);
      }
    }
    if (!changed) return;
    this.arm();
  }

  /** Stylesheet loads, font completion and viewport changes need a full pass. */
  requestAll(): void {
    if (this.disposed) return;
    this.huge = true;
    this.arm();
  }

  private arm(): void {
    this.onActivity?.();
    const now = performance.now();
    if (!this.first) this.first = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(
      0,
      Math.min(this.debounce, this.opts.maxWaitMs - (now - this.first)),
    );
    this.timer = setTimeout(
      () => void this.flush().catch(() => undefined),
      wait,
    );
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.disposed) return;
    if (this.running) {
      // A flush is in progress: try again after it.
      this.timer = setTimeout(
        () => void this.flush().catch(() => undefined),
        this.debounce,
      );
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
    else if (this.flushTimes.length < 5) this.debounce = this.opts.debounceMs;
    if (roots !== 'all' && roots.length === 0) return;
    this.running = true;
    try {
      await this.run(roots);
    } finally {
      this.running = false;
    }
  }

  disconnect(): void {
    this.disposed = true;
    for (const mo of this.observers) mo.disconnect();
    this.observers.length = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
