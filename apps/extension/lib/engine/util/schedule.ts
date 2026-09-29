/**
 * Main-thread scheduling: yield between slices, settle after writes, idle work.
 * Every wait is bounded so a hidden tab (paused rAF) never hangs the engine.
 */

interface SchedulerLike {
  yield?: () => Promise<void>;
}

export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** One animation frame, or `fallbackMs` when frames are not being produced. */
export function nextFrame(fallbackMs = 100): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function')
      requestAnimationFrame(() => finish());
    setTimeout(finish, fallbackMs);
  });
}

/**
 * Wait until a write has rendered: two frames (the first runs before the frame
 * that paints the change, the second after it), then web fonts, bounded.
 */
export async function settle(
  doc: Document,
  maxFontWaitMs = 300,
): Promise<void> {
  await nextFrame();
  await nextFrame();
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts && fonts.status !== 'loaded') {
    await Promise.race([
      fonts.ready.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, maxFontWaitMs)),
    ]);
  }
}

export function whenIdle(fn: () => void, timeoutMs = 1000): () => void {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: timeoutMs });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 1);
  return () => clearTimeout(id);
}

/**
 * Tracks main-thread busy time across slices. Callers do a unit of work, then
 * `await budget.tick()`, which yields once the current slice exceeds `sliceMs`.
 */
export class Budget {
  private sliceStart: number;
  private busy = 0;
  private paused = false;

  constructor(
    readonly totalMs: number,
    readonly sliceMs = 5,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.sliceStart = now();
  }

  /** Busy time so far, including the running slice. */
  get used(): number {
    return this.busy + (this.paused ? 0 : this.now() - this.sliceStart);
  }

  get exhausted(): boolean {
    return this.used > this.totalMs;
  }

  /** Yield if the slice is long. Returns false once the total budget is spent. */
  async tick(): Promise<boolean> {
    if (this.paused) this.resume();
    const now = this.now();
    if (now - this.sliceStart < this.sliceMs) return !this.exhausted;
    this.busy += now - this.sliceStart;
    this.sliceStart = now;
    if (this.busy > this.totalMs) return false;
    this.paused = true;
    await yieldToMain();
    this.resume();
    return true;
  }

  /** Close the running slice (before an intentional wait that is not our work). */
  pause(): void {
    if (this.paused) return;
    this.busy += this.now() - this.sliceStart;
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.sliceStart = this.now();
  }
}

/** Serialize async jobs so messages never interleave writes. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
