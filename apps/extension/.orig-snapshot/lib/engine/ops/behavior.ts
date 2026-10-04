import {
  ACTIVATABLE_SELECTOR,
  HANDS_OFF_SELECTOR,
  isElement,
} from '../util/dom';
import { tok } from './css';
import { sel } from './marks';
import { notNeeded, type OpImpl } from './types';

/**
 * steady_clicks (engine.md 3.4.11): the web analogue of Steady Clicks
 * (Trewin et al., ASSETS'06). On pointerdown on an activatable control the
 * pointer is captured, so a slip before release still produces a trusted
 * click on the control (Chrome >= 135 dispatches click to the capture
 * target). Pointer events only: keyboard input is never observed or changed.
 * Sliders, drag sources, text fields and selections are left alone.
 */

export interface StabilizerParams {
  /** A press older than this that moves more than dragPx is a deliberate drag. */
  holdMs: number;
  dragPx: number;
  /** Any movement beyond this hands the pointer back (deliberate cancel). */
  abandonPx: number;
}

export function stabilizerParams(windowMs: number): StabilizerParams {
  return { holdMs: windowMs, dragPx: 12, abandonPx: 48 };
}

/** Pure decision used by the listener and unit tests. */
export function shouldRelease(
  p: StabilizerParams,
  distance: number,
  elapsedMs: number,
): boolean {
  return (
    (distance > p.dragPx && elapsedMs > p.holdMs) || distance > p.abandonPx
  );
}

export function installClickStabilizer(
  win: Window,
  p: StabilizerParams,
): () => void {
  const doc = win.document;
  let press: {
    id: number;
    el: Element;
    x: number;
    y: number;
    t: number;
  } | null = null;

  const down = (e: PointerEvent): void => {
    if (
      (e.pointerType !== 'mouse' && e.pointerType !== 'pen') ||
      e.button !== 0 ||
      !e.isPrimary
    )
      return;
    const path = e.composedPath().filter(isElement);
    if (path.some((n) => n.matches(HANDS_OFF_SELECTOR))) return;
    const el = path.find((n) => n.matches(ACTIVATABLE_SELECTOR));
    if (!el) return;
    try {
      el.setPointerCapture(e.pointerId);
      press = {
        id: e.pointerId,
        el,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
      };
    } catch {
      press = null; // pointer no longer active
    }
  };
  const move = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    const d = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (shouldRelease(p, d, e.timeStamp - press.t)) {
      try {
        if (press.el.hasPointerCapture(press.id))
          press.el.releasePointerCapture(press.id);
      } catch {
        // already released
      }
      press = null;
    }
  };
  const end = (): void => {
    press = null;
  };
  // No accidental text selection while a stabilised press is held.
  const selectStart = (e: Event): void => {
    if (press) e.preventDefault();
  };
  // Capture phase on window: runs before page handlers; a page that captures
  // the pointer itself overrides ours, which is what we want.
  win.addEventListener('pointerdown', down, true);
  win.addEventListener('pointermove', move, true);
  win.addEventListener('pointerup', end, true);
  win.addEventListener('pointercancel', end, true);
  doc.addEventListener('selectstart', selectStart, true);
  return () => {
    win.removeEventListener('pointerdown', down, true);
    win.removeEventListener('pointermove', move, true);
    win.removeEventListener('pointerup', end, true);
    win.removeEventListener('pointercancel', end, true);
    doc.removeEventListener('selectstart', selectStart, true);
    press = null;
  };
}

export const steadyClicks: OpImpl = {
  id: 'steady_clicks',
  prepare(env, windowMs) {
    const count = env.facts.targets.filter(
      (t) => t.el.isConnected && t.el.matches(ACTIVATABLE_SELECTOR),
    ).length;
    return {
      status: 'ready',
      run: () => installClickStabilizer(env.view, stabilizerParams(windowMs)),
      count,
      fit: { before: '0\u00a0ms', after: `${Math.round(windowMs)}\u00a0ms` },
    };
  },
};

/**
 * menu_grace (engine.md 3.4.12): CSS only. Transitions use the after-change
 * style, so a delay placed on the hidden state keeps a hover submenu open for
 * `ms` after the pointer leaves while opening stays instant.
 * `transition-behavior: allow-discrete` makes display/visibility delayable.
 * No event is intercepted. Menus that remove their nodes are unaffected
 * (harmless); keyboard paths (:focus-within) are untouched.
 */
export const menuGrace: OpImpl = {
  id: 'menu_grace',
  prepare(env, ms) {
    const menus = env.facts.hoverMenus.filter((m) => m.isConnected);
    if (menus.length === 0) return notNeeded('no hover-only menus');
    const marks: Array<[Element, string]> = [];
    for (const m of menus) {
      marks.push([m, 'mg']);
      const trigger =
        m.parentElement?.closest('li, [aria-haspopup]') ?? m.parentElement;
      if (trigger) marks.push([trigger, 'mgt']);
      const prev = m.previousElementSibling;
      if (prev) marks.push([prev, 'mgt']);
    }
    const open = `${sel('mgt')}:is(:hover, :focus-within)`;
    const css = [
      `${tok('mg')} { transition-property: display, visibility, opacity !important; transition-duration: 0s !important; transition-delay: ${Math.round(ms)}ms !important; transition-timing-function: linear !important; transition-behavior: allow-discrete !important; }`,
      `${open} ${tok('mg')}, ${open} ~ ${tok('mg')}, ${tok('mg')}:is(:hover, :focus-within) { transition-delay: 0s !important; }`,
    ].join('\n');
    return {
      status: 'ready',
      css: { doc: css },
      marks,
      count: menus.length,
      fit: { before: '0\u00a0ms', after: `${Math.round(ms)}\u00a0ms` },
      show: menus.map((m) => m.parentElement ?? m),
    };
  },
};
