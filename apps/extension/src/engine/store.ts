// Owner: C1. Tiny observable store used by the controller.
// State updates are synchronous (getState is always current); listeners are notified once per microtask,
// so a burst of updates causes one UI render.

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  replace(next: T): void;
  subscribe(listener: (s: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(s: T) => void>();
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    const snapshot = state;
    for (const l of [...listeners]) {
      try {
        l(snapshot);
      } catch (err) {
        console.warn('[WebAble] state listener failed', err);
      }
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };

  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      schedule();
    },
    replace(next) {
      state = next;
      schedule();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Throttle a function to at most one call per `ms`, always running the trailing call. */
export function throttle(fn: () => void, ms: number): { (): void; cancel(): void; flush(): void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    last = Date.now();
    fn();
  };
  const t = () => {
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    } else if (!timer) {
      timer = setTimeout(run, wait);
    }
  };
  t.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  t.flush = () => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };
  return t;
}
