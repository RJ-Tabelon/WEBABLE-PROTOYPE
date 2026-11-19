'use client';

import {
  createContext,
  useContext,
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
 * The current screen's element (`.tn-screen`). Task keys listen on it, not on
 * the window, so they work only while focus is inside the screen (WCAG 2.1.4):
 * the heading takes focus when a screen opens, so keys work at once, and they
 * never fire while focus is in the action bar or a dialog.
 */
export const ScreenContext =
  createContext<RefObject<HTMLElement | null> | null>(null);

/**
 * Single-key answers for a task screen ("t", "f", "c", "1"...), scoped to the
 * screen element. Ignored while typing, with modifiers, while a dialog is open,
 * or when `active` is false. Keys are matched in lower case; Space, Enter and
 * the arrows are never taken, so buttons, radios and scrolling keep their
 * native behaviour.
 */
export function useTaskKeys(
  handlers: Readonly<Record<string, () => void>>,
  active: boolean,
): void {
  const latest = useLatest(handlers);
  const screen = useContext(ScreenContext);
  useEffect(() => {
    const el = screen?.current;
    if (!active || !el) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.key.length !== 1) return;
      const handler = latest.current[event.key.toLowerCase()];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [active, latest, screen]);
}

export interface ContentBox {
  width: number;
  height: number;
}

function contentBoxOf(el: HTMLElement): ContentBox | null {
  const style = getComputedStyle(el);
  const width =
    el.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight);
  const height =
    el.clientHeight -
    Number.parseFloat(style.paddingTop) -
    Number.parseFloat(style.paddingBottom);
  if (!Number.isFinite(width) || width <= 0) return null;
  return { width, height: Number.isFinite(height) ? Math.max(0, height) : 0 };
}

/**
 * An element's content box (width and height), kept up to date. The stage's
 * height comes from the screen around it (it flexes between 160 and 360 px), so
 * stimuli sized from it always fit above the answers.
 */
export function useContentBox(
  ref: RefObject<HTMLElement | null>,
  fallback: ContentBox,
): ContentBox {
  const [box, setBox] = useState(fallback);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = contentBoxOf(el);
      if (!next) return;
      setBox((prev) =>
        Math.abs(prev.width - next.width) >= 1 ||
        Math.abs(prev.height - next.height) >= 1
          ? next
          : prev,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return box;
}

/** Width of an element's content box, kept up to date. */
export function useContentWidth(
  ref: RefObject<HTMLElement | null>,
  fallback: number,
): number {
  return useContentBox(ref, { width: fallback, height: 0 }).width;
}

/** Measure an element's content box once, now (layout effects only). */
export function measureContentBox(el: HTMLElement): ContentBox | null {
  return contentBoxOf(el);
}
