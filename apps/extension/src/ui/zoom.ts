// Owner: U. One reading of the tab's page zoom for all of WebAble's in-page UI, and the viewport size.
//
// The engine may zoom the tab (and the person may zoom it too). Our UI must stay the same physical size, so every
// layer divides by this number: the corner chrome and the Calm view through CSS `zoom`, the Lens through its own
// scale. Sources, newest wins:
// - `state.pageZoom` from the engine (the zoom it applied, including the person's own);
// - `getZoom` from the background, read at start, after every resize (Chrome fires one when the zoom changes) and on a
//   slow poll;
// - between a zoom change and that answer, an estimate from the change in devicePixelRatio, so the UI does not jump.
import { useEffect, useState } from 'preact/hooks';
import type { EngineApi } from '../contracts';
import { ask } from '../engine/bus';

type Listener = (z: number) => void;

const MIN = 0.25;
const MAX = 5;

let current = 1;
/** A real reading arrived (from the tab or a change in the engine's value). Until then the engine's value is a guess. */
let measured = false;
/** The engine's `pageZoom` as last seen by any hook, so a value that did not change is never adopted again. */
let engineSeen: number | null = null;
let lastDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
let started = false;
let seq = 0;
const listeners = new Set<Listener>();
let stopAll: (() => void) | null = null;

export function parseZoom(r: unknown): number | null {
  let z: unknown = r;
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    z = o.factor ?? o.zoom ?? o.value;
  }
  return typeof z === 'number' && Number.isFinite(z) && z >= MIN && z <= MAX ? z : null;
}

function set(z: number): void {
  if (!Number.isFinite(z) || z < MIN || z > MAX) return;
  // Round away float noise (1.4999999) so equal zooms compare equal.
  const v = Math.round(z * 10000) / 10000;
  lastDpr = window.devicePixelRatio || lastDpr;
  if (v === current) return;
  current = v;
  for (const l of Array.from(listeners)) l(v);
}

function read(): void {
  const mine = ++seq;
  let p: Promise<unknown>;
  try {
    p = ask<unknown>({ type: 'getZoom' }, 2500);
  } catch {
    return;
  }
  p.then((r) => {
    // An older answer must not overwrite a newer one.
    if (mine !== seq) return;
    const z = parseZoom(r);
    if (z !== null) {
      measured = true;
      set(z);
    }
  }).catch(() => {});
}

function start(): void {
  if (started) return;
  started = true;
  let timer = 0;
  const onResize = () => {
    const dpr = window.devicePixelRatio || 1;
    if (Math.abs(dpr - lastDpr) > 0.001 && lastDpr > 0) {
      // Same screen, new zoom: devicePixelRatio moved with it. Confirmed by getZoom just below.
      set(current * (dpr / lastDpr));
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(read, 90);
  };
  window.addEventListener('resize', onResize, { passive: true });
  const poll = window.setInterval(() => {
    if (!document.hidden) read();
  }, 8000);
  read();
  stopAll = () => {
    window.removeEventListener('resize', onResize);
    window.clearTimeout(timer);
    window.clearInterval(poll);
    started = false;
    stopAll = null;
  };
}

/** The page zoom right now (1 = 100%). */
export function pageZoomNow(): number {
  return current;
}

/** Tell the UI the zoom changed (the engine's state, or a test). */
export function notePageZoom(z: number): void {
  measured = true;
  set(z);
}

/** Subscribe to page zoom changes. Starts the readers on first use; stops them when the last listener leaves. */
export function onPageZoom(l: Listener): () => void {
  listeners.add(l);
  start();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) stopAll?.();
  };
}

/**
 * Adopt the engine's `pageZoom` when it changes. A value that has not changed since any hook last saw it is never
 * adopted again (it may be older than the tab's own reading); before the first reading it is the best guess.
 */
function fromEngine(z: unknown): void {
  if (typeof z !== 'number' || !Number.isFinite(z)) return;
  if (engineSeen === null) {
    engineSeen = z;
    if (!measured) set(z);
    return;
  }
  if (z === engineSeen) return;
  engineSeen = z;
  measured = true;
  set(z);
}

/** The tab's page zoom, kept current. Pass the engine to also follow `state.pageZoom`. */
export function usePageZoom(api?: EngineApi | null): number {
  const [z, setZ] = useState(() => {
    fromEngine(api?.getState().pageZoom);
    return current;
  });
  useEffect(() => {
    const off = onPageZoom(setZ);
    setZ(current);
    const offState = api?.subscribe((s) => fromEngine(s.pageZoom));
    return () => {
      off();
      offState?.();
    };
  }, [api]);
  return z;
}

export interface Viewport {
  /** CSS px (what window.innerWidth says at the current zoom). */
  w: number;
  h: number;
}

/** window.innerWidth / innerHeight, kept current (one update per frame while resizing). */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setVp((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : { w: window.innerWidth, h: window.innerHeight }));
      });
    };
    window.addEventListener('resize', on, { passive: true });
    on();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', on);
    };
  }, []);
  return vp;
}
