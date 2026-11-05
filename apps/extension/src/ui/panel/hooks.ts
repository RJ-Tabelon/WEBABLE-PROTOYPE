// Owner: D2. Small hooks shared by the in-page chrome.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FitProfile } from '@webable/core';
import type { EngineApi, EngineState } from '../../contracts';
import { clamp } from './format';

/** Re-render on every engine notification. Reads the state fresh, so in-place mutation is fine. */
export function useEngineState(api: EngineApi): EngineState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const off = api.subscribe(() => setTick((t) => (t + 1) % 1_000_000));
    return () => off();
  }, [api]);
  return api.getState();
}

function systemReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The fit's "reduce motion" or the system setting. */
export function useReducedMotion(fit: FitProfile | null): boolean {
  const [sys, setSys] = useState(systemReducedMotion);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const on = () => setSys(mq ? mq.matches : false);
    mq.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, []);
  return sys || Boolean(fit?.attention?.motion?.on);
}

export interface ChromeSizing {
  /** The fit's UI scale: one design pixel in screen pixels. It never changes with the page zoom. */
  scale: number;
  /** The tab's page zoom (1 = 100%). */
  pageZoom: number;
  /**
   * CSS `zoom` for a layer laid out in design pixels (scale ÷ page zoom): inside it one CSS px is one design pixel,
   * whatever the page zoom, so the layer keeps its physical size.
   */
  zoom: number;
  /** One design pixel in CSS px, for layers that are not zoomed (they size with `--u`). Equals `zoom`. */
  u: number;
  /** The chrome's text size in CSS px, for layers that are not zoomed. */
  fontPx: number;
  /** The person's minimum control size in CSS px, for layers that are not zoomed. */
  targetPx: number;
  /** The person's minimum control size in design pixels, for zoomed layers. */
  target: number;
}

/**
 * Size the chrome from the fit only. The page zoom is divided out exactly (no floors), so the pill, panel, offers,
 * toasts and chips are the same size on screen at 100%, 150% or 250%.
 */
export function chromeSizing(fit: FitProfile | null, pageZoom: number): ChromeSizing {
  const body = fit ? (fit.text?.override ?? fit.text?.bodyPx ?? 16) : 16;
  const effective = clamp(Math.round((Number.isFinite(body) ? body : 16) * 0.78), 15, 20);
  const scale = effective / 15;
  const z = Number.isFinite(pageZoom) && pageZoom > 0 ? pageZoom : 1;
  const min = fit?.targets?.minPx;
  const targetScreen = Math.max(44, typeof min === 'number' && Number.isFinite(min) ? Math.min(min, 96) : 44);
  const zoom = scale / z;
  return { scale, pageZoom: z, zoom, u: zoom, fontPx: effective / z, targetPx: targetScreen / z, target: targetScreen / scale };
}

/** Tween a number toward its target for the live counter. */
export function useTweened(target: number, ms: number, reduce: boolean, start?: number): number {
  const first = reduce || start === undefined ? target : start;
  const [value, setValue] = useState(first);
  const from = useRef(first);
  const shown = useRef(first);
  useEffect(() => {
    if (reduce || !Number.isFinite(target) || ms <= 0) {
      shown.current = target;
      setValue(target);
      return;
    }
    from.current = shown.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = clamp((now - start) / ms, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from.current + (target - from.current) * eased;
      shown.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduce]);
  return value;
}

/** True once `ms` have passed since `key` last changed, unless `hold` is set. */
export function useElapsed(key: string, ms: number, hold: boolean): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
    if (hold) return;
    const t = window.setTimeout(() => setDone(true), ms);
    return () => window.clearTimeout(t);
  }, [key, ms, hold]);
  return done;
}

export type PillSide = 'right' | 'left';

/** macOS shows the Option and Shift symbols; other systems spell the keys out. */
export function isMac(): boolean {
  try {
    const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
    return /mac/i.test(p);
  } catch {
    return false;
  }
}

/** The shortcut modifiers: '⌥⇧' on a Mac, 'Alt+Shift' elsewhere. */
export function modifierLabel(): string {
  return isMac() ? '⌥⇧' : 'Alt+Shift';
}

/** 'Alt+Shift+L' (or '⌥⇧L' on a Mac). */
export function shortcutLabel(letter: string): string {
  return isMac() ? `⌥⇧${letter}` : `Alt+Shift+${letter}`;
}
