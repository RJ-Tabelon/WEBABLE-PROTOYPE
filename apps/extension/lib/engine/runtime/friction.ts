import type { OpId } from '@webable/core/ops/catalog';

import { ACTIONABLE_SELECTOR, isElement, isOurs } from '../util/dom';

/**
 * Friction detectors (personalization.md 5.5). They only ever raise the odds
 * of an *offer* in the service worker; they never apply a change. All
 * listeners are passive observers: no event is prevented, stopped or
 * re-dispatched, and keyboard input is not observed at all.
 */

export type FrictionSignal =
  'misclick_burst' | 'rage_click' | 'zoom_in' | 'scroll_reversal';

export const FRICTION_OPS: Readonly<Record<FrictionSignal, readonly OpId[]>> = {
  misclick_burst: ['target_size', 'target_spacing', 'steady_clicks'],
  rage_click: ['target_size', 'steady_clicks'],
  zoom_in: ['text_floor', 'page_zoom'],
  scroll_reversal: ['line_spacing', 'line_length', 'reading_guide'],
};

export interface FrictionConfig {
  /** Misclicks needed inside the window. */
  misclicks: number;
  misclickWindowMs: number;
  rageClicks: number;
  rageWindowMs: number;
  rageRadiusPx: number;
  reversals: number;
  reversalWindowMs: number;
  /** A reversal counts only when it re-reads less than this share of the viewport. */
  reversalMaxSpan: number;
  /** Per-signal quiet period after an emit. */
  cooldownMs: number;
  /** At most this many emits per signal per page. */
  maxPerPage: number;
}

export const DEFAULT_FRICTION: FrictionConfig = {
  misclicks: 2,
  misclickWindowMs: 60_000,
  rageClicks: 3,
  rageWindowMs: 1000,
  rageRadiusPx: 30,
  reversals: 3,
  reversalWindowMs: 20_000,
  reversalMaxSpan: 0.6,
  cooldownMs: 60_000,
  maxPerPage: 2,
};

/** Pure state machine; the DOM wiring below feeds it. */
export class FrictionDetector {
  private misses: number[] = [];
  private clicks: Array<{ x: number; y: number; t: number }> = [];
  private lastScroll: { y: number; dir: 0 | 1 | -1; turnY: number } | null =
    null;
  private reversals: number[] = [];
  private readonly lastEmit = new Map<FrictionSignal, number>();
  private readonly emits = new Map<FrictionSignal, number>();

  constructor(
    private readonly emit: (
      signal: FrictionSignal,
      ops: readonly OpId[],
    ) => void,
    private readonly cfg: FrictionConfig = DEFAULT_FRICTION,
  ) {}

  private fire(signal: FrictionSignal, t: number): boolean {
    const last = this.lastEmit.get(signal) ?? -Infinity;
    const count = this.emits.get(signal) ?? 0;
    if (t - last < this.cfg.cooldownMs || count >= this.cfg.maxPerPage)
      return false;
    this.lastEmit.set(signal, t);
    this.emits.set(signal, count + 1);
    this.emit(signal, FRICTION_OPS[signal]);
    return true;
  }

  /** A press that landed just outside a small actionable target. */
  misclick(t: number): boolean {
    this.misses = this.misses.filter((m) => t - m < this.cfg.misclickWindowMs);
    this.misses.push(t);
    if (this.misses.length >= this.cfg.misclicks) {
      this.misses = [];
      return this.fire('misclick_burst', t);
    }
    return false;
  }

  /** Repeated clicks on one spot in quick succession. */
  click(x: number, y: number, t: number): boolean {
    this.clicks = this.clicks.filter((c) => t - c.t < this.cfg.rageWindowMs);
    this.clicks.push({ x, y, t });
    const near = this.clicks.filter(
      (c) => Math.hypot(c.x - x, c.y - y) <= this.cfg.rageRadiusPx,
    );
    if (near.length >= this.cfg.rageClicks) {
      this.clicks = [];
      return this.fire('rage_click', t);
    }
    return false;
  }

  zoomIn(t: number): boolean {
    return this.fire('zoom_in', t);
  }

  /** Scroll position sample. Short back-and-forth over the same lines counts. */
  scroll(y: number, viewportH: number, t: number): boolean {
    const prev = this.lastScroll;
    if (!prev) {
      this.lastScroll = { y, dir: 0, turnY: y };
      return false;
    }
    const dy = y - prev.y;
    if (Math.abs(dy) < 4) return false;
    const dir: 1 | -1 = dy > 0 ? 1 : -1;
    let fired = false;
    if (prev.dir !== 0 && dir !== prev.dir) {
      const span = Math.abs(prev.y - prev.turnY);
      if (span < this.cfg.reversalMaxSpan * viewportH) {
        this.reversals = this.reversals.filter(
          (r) => t - r < this.cfg.reversalWindowMs,
        );
        this.reversals.push(t);
        if (this.reversals.length >= this.cfg.reversals) {
          this.reversals = [];
          fired = this.fire('scroll_reversal', t);
        }
      }
      this.lastScroll = { y, dir, turnY: prev.y };
    } else {
      this.lastScroll = { y, dir, turnY: prev.dir === 0 ? prev.y : prev.turnY };
    }
    return fired;
  }
}

const NEAR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [8, 0],
  [-8, 0],
  [0, 8],
  [0, -8],
  [6, 6],
  [-6, -6],
  [6, -6],
  [-6, 6],
];

/** True when the press missed: not on an actionable target but within 8 px of a small one. */
export function isNearMiss(
  doc: Document,
  e: PointerEvent,
  smallPx = 32,
): boolean {
  const path = e.composedPath().filter(isElement);
  if (path.some((n) => !isOurs(n) && n.matches(ACTIONABLE_SELECTOR)))
    return false;
  for (const [dx, dy] of NEAR_OFFSETS) {
    const hit = doc.elementFromPoint(e.clientX + dx, e.clientY + dy);
    if (!hit || isOurs(hit)) continue;
    const target = hit.closest(ACTIONABLE_SELECTOR);
    if (!target) continue;
    const r = target.getBoundingClientRect();
    if (Math.min(r.width, r.height) < smallPx) return true;
  }
  return false;
}

export interface FrictionWiring {
  /** Ignore zoom changes for a while (the service worker is applying page_zoom). */
  suppressZoom(ms: number): void;
  dispose(): void;
}

export function installFriction(
  win: Window,
  detector: FrictionDetector,
): FrictionWiring {
  const doc = win.document;
  let zoomQuietUntil = 0;
  let dpr = win.devicePixelRatio || 1;
  let scale = win.visualViewport?.scale ?? 1;
  const now = (): number => performance.now();

  // Page scripts can dispatch synthetic events; only the person's input counts.
  const onDown = (e: PointerEvent): void => {
    if (!e.isTrusted) return;
    if (!e.isPrimary || e.button !== 0) return;
    if (isNearMiss(doc, e)) detector.misclick(now());
  };
  const onClick = (e: MouseEvent): void => {
    if (!e.isTrusted) return;
    if (e.detail === 0) return; // keyboard-generated activation: not a pointer signal
    detector.click(e.clientX, e.clientY, now());
  };
  const onWheel = (e: WheelEvent): void => {
    if (!e.isTrusted) return;
    // Ctrl+wheel and trackpad pinch both arrive as ctrlKey wheel events.
    if (e.ctrlKey && e.deltaY < 0 && now() > zoomQuietUntil)
      detector.zoomIn(now());
  };
  const onResize = (e: Event): void => {
    if (!e.isTrusted) return;
    const d = win.devicePixelRatio || 1;
    if (d > dpr * 1.05 && now() > zoomQuietUntil) detector.zoomIn(now());
    dpr = d;
  };
  const onViewport = (e: Event): void => {
    if (!e.isTrusted) return;
    const s = win.visualViewport?.scale ?? 1;
    if (s > scale * 1.15 && now() > zoomQuietUntil) detector.zoomIn(now());
    scale = s;
  };
  let raf = 0;
  const onScroll = (e: Event): void => {
    if (!e.isTrusted || raf) return;
    raf = win.requestAnimationFrame(() => {
      raf = 0;
      detector.scroll(win.scrollY, win.innerHeight, now());
    });
  };
  const opts = { capture: true, passive: true } as const;
  win.addEventListener('pointerdown', onDown, opts);
  win.addEventListener('click', onClick, opts);
  win.addEventListener('wheel', onWheel, opts);
  win.addEventListener('resize', onResize, { passive: true });
  win.addEventListener('scroll', onScroll, { passive: true });
  win.visualViewport?.addEventListener('resize', onViewport, { passive: true });
  return {
    suppressZoom(ms: number) {
      zoomQuietUntil = now() + ms;
      dpr = win.devicePixelRatio || 1;
    },
    dispose() {
      win.removeEventListener('pointerdown', onDown, true);
      win.removeEventListener('click', onClick, true);
      win.removeEventListener('wheel', onWheel, true);
      win.removeEventListener('resize', onResize);
      win.removeEventListener('scroll', onScroll);
      win.visualViewport?.removeEventListener('resize', onViewport);
      if (raf) win.cancelAnimationFrame(raf);
    },
  };
}
