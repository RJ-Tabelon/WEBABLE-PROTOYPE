// Small shared hooks: the trial clock, window keys, element size, and the 120 ms press-down.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * Trial timing. The onset is the second animation frame after the stimulus is set (it has been painted). Coming back
 * to the tab or a pixel-ratio change restarts the clock, so a trial never carries time spent elsewhere. `armed()`
 * ignores presses in the first 250 ms (accidental repeats).
 */
export function useTrialClock(trialKey: unknown): { elapsed: () => number; armed: () => boolean } {
  const onset = useRef(performance.now() + 1e9);

  useEffect(() => {
    let raf2 = 0;
    const set = performance.now();
    onset.current = set + 1e9;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        onset.current = performance.now();
      });
    });
    // Frames can be throttled (a backgrounded window): never leave a trial unanswerable.
    const fallback = window.setTimeout(() => {
      if (onset.current > performance.now()) onset.current = set;
    }, 200);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(fallback);
    };
  }, [trialKey]);

  useEffect(() => {
    let dpr = window.devicePixelRatio;
    const restart = () => {
      onset.current = performance.now();
    };
    const onVis = () => {
      if (!document.hidden) restart();
    };
    const onResize = () => {
      if (window.devicePixelRatio !== dpr) {
        dpr = window.devicePixelRatio;
        restart();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return {
    elapsed: () => Math.max(0, performance.now() - onset.current),
    armed: () => performance.now() - onset.current > 250,
  };
}

/** Window key handler while `enabled`. Ignores keys with modifiers, repeats, and keys typed into fields. */
export function useKeys(enabled: boolean, handler: (key: string, e: KeyboardEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      ref.current(e.key, e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** The content box of an element, kept current. */
export function useBox<T extends HTMLElement>(fallback: { w: number; h: number }): [preact.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setBox((b) => (Math.abs(b.w - w) < 1 && Math.abs(b.h - h) < 1 ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

/** Which answer shows the 120 ms press-down (keyboard answers get it too). */
export function usePressed(): [string | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [
    id,
    (next: string) => {
      window.clearTimeout(timer.current);
      setId(next);
      timer.current = window.setTimeout(() => setId(null), 120);
    },
  ];
}
