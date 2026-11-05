// Owner: D1. Hooks that keep the Calm view in step with the live page and the engine.
import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { EngineApi, EngineState } from '../../contracts';
import { ask } from '../../engine/bus';
import { calmCss } from '../base.css';
import { componentsCss } from './components';
import { composeCss } from './compose/compose.css';
import { markersCss } from './markers';
import { pageCss } from './page.css';
import { purposeCss } from './purpose.css';

/**
 * Calm view's whole stylesheet: the view, the meaning components (round 7), the purpose template around them, and
 * round 10's laid-out parts, and round 8b's page rules (width, spacing, the end of a reading page), last so they win.
 */
export const calmSheetCss = (): string =>
  `${calmCss}\n${componentsCss}\n${purposeCss}\n${markersCss}\n${composeCss}\n${pageCss}`;
import { liveKey, renderLiveValue, type LiveValue } from '../proxy';

/** The engine's state, re-rendering on every change. */
export function useEngineState(api: EngineApi): EngineState {
  const [s, set] = useState<EngineState>(() => api.getState());
  useEffect(() => {
    set(api.getState());
    return api.subscribe(set);
  }, [api]);
  return s;
}

const WATCHED_ATTRS = [
  'disabled', 'checked', 'selected', 'aria-checked', 'aria-pressed', 'aria-expanded', 'aria-selected', 'aria-current',
  'aria-disabled', 'aria-hidden', 'hidden', 'open', 'class', 'style', 'src',
];

/** A counter that goes up (throttled) whenever the page's DOM changes, so the view re-reads the live text. */
export function useDomVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let timer = 0;
    let last = 0;
    const bump = (): void => {
      timer = 0;
      last = performance.now();
      setV((x) => x + 1);
    };
    const mo = new MutationObserver((recs) => {
      if (timer) return;
      const relevant = recs.some((r) => {
        const t = r.target instanceof Element ? r.target : r.target.parentElement;
        return !t || !t.closest('webable-ui');
      });
      if (!relevant) return;
      timer = window.setTimeout(bump, Math.max(120, 450 - (performance.now() - last)));
    });
    mo.observe(document.body ?? document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: WATCHED_ATTRS,
    });
    return () => {
      mo.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, []);
  return v;
}

/* ---------- a shared ticker for mirrored controls (catches changes the page makes without events) ---------- */

const tickers = new Set<() => void>();
let tickTimer = 0;

export function onTick(cb: () => void): () => void {
  tickers.add(cb);
  if (!tickTimer) tickTimer = window.setInterval(() => tickers.forEach((f) => f()), 700);
  return () => {
    tickers.delete(cb);
    if (!tickers.size && tickTimer) {
      window.clearInterval(tickTimer);
      tickTimer = 0;
    }
  };
}

/** Re-read every mirror now (after a proxy changed the page, e.g. a radio unchecking its neighbours). */
export function tickNow(): void {
  tickers.forEach((f) => f());
  window.setTimeout(() => tickers.forEach((f) => f()), 60);
}

/** Live state of an original control: input/change listeners on the original plus the ticker. */
export function useLive(el: Element | null): LiveValue {
  const [v, setV] = useState<LiveValue>(() => renderLiveValue(el));
  const ref = useRef(liveKey(v));
  useEffect(() => {
    const update = (): void => {
      const n = renderLiveValue(el);
      const k = liveKey(n);
      if (k !== ref.current) {
        ref.current = k;
        setV(n);
      }
    };
    update();
    const off = onTick(update);
    if (!el) return off;
    el.addEventListener('input', update);
    el.addEventListener('change', update);
    return () => {
      off();
      el.removeEventListener('input', update);
      el.removeEventListener('change', update);
    };
  }, [el]);
  return v;
}

/** Force a re-render on every tick (for recaps that read several live values). */
export function useTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => onTick(() => setN((x) => x + 1)), []);
  return n;
}

function parseZoom(r: unknown): number | null {
  if (typeof r === 'number' && Number.isFinite(r)) return r;
  if (r && typeof r === 'object') {
    for (const k of ['factor', 'zoom', 'value']) {
      const v = (r as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return null;
}

/** The tab's zoom factor (from the background), so lengths can be divided by it. */
export function useZoom(): number {
  const [z, setZ] = useState(1);
  useEffect(() => {
    let alive = true;
    let t = 0;
    const read = (): void => {
      try {
        ask<unknown>({ type: 'getZoom' }, 2000)
          .then((r) => {
            const f = parseZoom(r);
            if (alive && f && f >= 0.25 && f <= 5) setZ(f);
          })
          .catch(() => undefined);
      } catch {
        /* no background (tests, previews): stay at 1 */
      }
    };
    read();
    const onResize = (): void => {
      window.clearTimeout(t);
      t = window.setTimeout(read, 250);
    };
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return z;
}

let calmSheet: CSSStyleSheet | null | undefined;
function sheet(): CSSStyleSheet | null {
  if (calmSheet !== undefined) return calmSheet;
  try {
    const s = new CSSStyleSheet();
    s.replaceSync(calmSheetCss());
    calmSheet = s;
  } catch {
    calmSheet = null;
  }
  return calmSheet;
}

/**
 * Adopt the Calm view's constructed stylesheet into whatever root the view is mounted in (our closed shadow root).
 * Re-checked on every render, in case the host replaces its adopted sheets. Returns true when a <style> fallback is needed.
 */
export function useCalmStyles(ref: RefObject<HTMLElement>): boolean {
  const [inline, setInline] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const root = node.getRootNode() as ShadowRoot | Document;
    const s = sheet();
    if (s && 'adoptedStyleSheets' in root) {
      try {
        if (!root.adoptedStyleSheets.includes(s)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, s];
        return;
      } catch {
        /* fall through */
      }
    }
    if (!inline) setInline(true);
  });
  return inline;
}

/** prefers-reduced-motion, live. */
export function useReducedMotion(): boolean {
  const [r, setR] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = (): void => setR(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return r;
}
