'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

const useIsoLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Keeps a ref pointing at the latest value (for stable event listeners). */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Stimulus onset: `performance.now()` at the first animation frame after the
 * stimulus for `key` has been painted (the second rAF after commit). Until then
 * the ref holds the commit time, so a very fast answer still gets a time.
 */
export function useStimulusOnset(
  key: string | number | null,
): RefObject<number | null> {
  const onset = useRef<number | null>(null);
  useIsoLayoutEffect(() => {
    if (key === null) {
      onset.current = null;
      return;
    }
    onset.current = performance.now();
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        onset.current = performance.now();
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [key]);
  return onset;
}

/** Milliseconds from onset to now, never negative. */
export function elapsedSince(onset: number | null): number {
  if (onset === null) return 0;
  return Math.max(0, Math.round(performance.now() - onset));
}

/**
 * Whether anything disturbed the current trial: the page was hidden, lost
 * focus, or the zoom changed (devicePixelRatio moved). Resets with `key`.
 */
export function useDisturbance(
  key: string | number | null,
): RefObject<boolean> {
  const disturbed = useRef(false);
  useEffect(() => {
    disturbed.current = false;
    const dpr = window.devicePixelRatio;
    const mark = () => {
      disturbed.current = true;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') mark();
    };
    const onResize = () => {
      if (window.devicePixelRatio !== dpr) mark();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', mark);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', mark);
      window.removeEventListener('resize', onResize);
    };
  }, [key]);
  return disturbed;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['radio', 'checkbox', 'button', 'submit'].includes(type);
  }
  return false;
}

/**
 * Single-key answers for a task screen ("t", "f", "c", "1"...). Ignored while
 * typing, with modifiers, while a dialog is open, or when `active` is false.
 * Keys are matched in lower case; Space and Enter are never taken, so buttons
 * keep their native behaviour.
 */
export function useTaskKeys(
  handlers: Readonly<Record<string, () => void>>,
  active: boolean,
): void {
  const latest = useLatest(handlers);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handler = latest.current[key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, latest]);
}

/** Width of an element's content box, kept up to date. */
export function useContentWidth(
  ref: RefObject<HTMLElement | null>,
  fallback: number,
): number {
  const [width, setWidth] = useState(fallback);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const w =
        el.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      if (Number.isFinite(w) && w > 0) {
        setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
