import { isOurs, type TreeScope } from '../util/dom';

/**
 * Host changes, including text updates and reused framework nodes. A narrow
 * attribute allowlist excludes WebAble's own marks, preventing feedback.
 * Changes are debounced (350 ms, max wait 1 s), nested roots collapsed,
 * and a burst of more than 1,000 added elements switches to a full pass.
 * Pages that mutate constantly (tickers, feeds) back the debounce off.
 *
 * Two paths: `sync` runs inside the MutationObserver callback, before the
 * browser renders the change, so new content can be adapted in its very
 * first frame; `run` is the debounced pass for everything that needs
 * measuring (verification, imperative effects, a fresh decision).
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

/** Pre-paint hook: element nodes the page inserted, and elements whose class changed. */
export type SyncHook = (
  added: readonly Element[],
  restyled: readonly Element[],
) => void;

export class MutationScheduler {
  private pending = new Set<Element>();
  private huge = false;
  private first = 0;
  private added = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushTimes: number[] = [];
  private debounce: number;
  private readonly observers: MutationObserver[] = [];
  private readonly observed = new WeakSet<TreeScope>();
  private running = false;
  private disposed = false;

  constructor(
    private readonly run: (roots: FlushRoots, added: number) => Promise<void>,
    private readonly opts: SchedulerOptions = DEFAULT_SCHEDULER,
    private readonly onActivity?: () => void,
    private readonly sync?: SyncHook,
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
    const inserted: Element[] = [];
    const restyled: Element[] = [];
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
      if (r.type === 'attributes' || r.type === 'characterData') {
        add(target ?? null);
        if (
          r.type === 'attributes' &&
          r.attributeName === 'class' &&
          target &&
          !isOurs(target)
        )
          restyled.push(target);
      }
      if (
        Array.from(r.removedNodes ?? []).some(
          (n) => n.nodeType !== 1 || !isOurs(n as Element),
        )
      )
        add(target ?? null);
      for (const n of r.addedNodes ?? []) {
        if (n.nodeType === 1) {
          if (isOurs(n as Element)) continue;
          add(n as Element);
          inserted.push(n as Element);
          this.added++;
        } else if (n.nodeType === 3) add(target ?? null);
      }
    }
    if (!changed) return;
    if (this.sync && (inserted.length || restyled.length)) {
      try {
        this.sync(inserted, restyled);
      } catch {
        // Best effort: the debounced pass covers anything missed here.
      }
    }
    this.arm();
  }

  /** Stylesheet loads, font completion and viewport changes need a full pass. */
  requestAll(): void {
    if (this.disposed) return;
    this.huge = true;
    this.arm();
  }

  /**
   * Hand roots back to be processed later (the person is scrolling). Their
   * added-element count was already reported, so it is not counted again.
   */
  requeue(roots: FlushRoots, delayMs: number): void {
    if (this.disposed) return;
    if (roots === 'all') this.huge = true;
    else for (const r of roots) this.pending.add(r);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.flush().catch(() => undefined),
      delayMs,
    );
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
    const added = this.added;
    this.pending.clear();
    this.huge = false;
    this.first = 0;
    this.added = 0;
    const now = performance.now();
    this.flushTimes = this.flushTimes.filter((t) => now - t < 10_000);
    this.flushTimes.push(now);
    if (this.flushTimes.length > 20)
      this.debounce = Math.min(this.debounce * 2, 2000);
    else if (this.flushTimes.length < 5) this.debounce = this.opts.debounceMs;
    if (roots !== 'all' && roots.length === 0) return;
    this.running = true;
    try {
      await this.run(roots, added);
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
