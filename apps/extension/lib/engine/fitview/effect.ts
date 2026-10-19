import { isOurs } from '../util/dom';

/**
 * Did a proxied action do anything? (docs/10 §4.4, effect check.)
 *
 * After a proxy dispatches to an original, the page has up to 3 s to show an
 * effect: a navigation or URL change, the original (or its record) changing
 * state, content changing in the record or section, the original leaving the
 * page, a popup opening or a status message appearing. Nothing within the
 * window means the action probably did not take: the proxy then shows the
 * element on the page and logs a defect. It never offers a blind retry: a
 * repeated Like or Add to cart is harmful.
 *
 * Pure observation: nothing here writes to the page.
 */

export type EffectKind =
  | 'navigation'
  | 'url'
  | 'state'
  | 'value'
  | 'content'
  | 'removed'
  | 'popup'
  | 'status'
  | 'handled';

export const EFFECT_TIMEOUT_MS = 3000;

/** Effects other parts of the live layer observe (a popup opened, a toast). */
export type SignalKind = 'popup' | 'status';

export class Signals {
  private readonly subs = new Set<(kind: SignalKind) => void>();

  on(cb: (kind: SignalKind) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  emit(kind: SignalKind): void {
    for (const cb of [...this.subs]) cb(kind);
  }
}

/** State attributes whose change is an effect (toggles, menus, selection). */
export const STATE_ATTRS = [
  'aria-pressed',
  'aria-checked',
  'aria-expanded',
  'aria-selected',
  'aria-current',
  'aria-disabled',
  'aria-busy',
  'disabled',
  'hidden',
  'open',
  'checked',
  'value',
  'src',
] as const;
const STATE_SET = new Set<string>(STATE_ATTRS);

/** What a mutation adds or removes that a person could see. */
const VISIBLE_LEAF =
  'img,picture,video,svg,canvas,iframe,input,select,textarea,button,a[href]';

/**
 * Read-only state snapshot of a control: ARIA state, checked, selected value.
 * Two snapshots differ when a toggle, menu button or select took effect.
 */
export function stateOf(el: Element | null | undefined): string {
  if (!el) return '';
  const parts: string[] = [];
  for (const a of STATE_ATTRS) {
    if (a === 'src' || a === 'value') continue;
    const v = el.getAttribute(a);
    if (v !== null) parts.push(`${a}=${v}`);
  }
  if (el instanceof HTMLInputElement) parts.push(`checked:${el.checked}`);
  if (el instanceof HTMLSelectElement) parts.push(`value:${el.value}`);
  return parts.join('|');
}

/** A mutation a person would notice: text, media, controls or state. */
export function meaningful(r: MutationRecord): boolean {
  if (r.type === 'characterData') return true;
  if (r.type === 'attributes')
    return r.attributeName !== null && STATE_SET.has(r.attributeName);
  const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
  for (const n of nodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      if ((n.nodeValue ?? '').trim()) return true;
      continue;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as Element;
    if (isOurs(el)) continue;
    if ((el.textContent ?? '').trim()) return true;
    if (el.matches(VISIBLE_LEAF) || el.querySelector(VISIBLE_LEAF)) return true;
  }
  return false;
}

export interface EffectBaseline {
  url: string;
  /** stateOf(original) and stateOf(record root), joined. */
  state: string;
  /** Text field or select value. */
  value: string | null;
}

function valueOf(el: Element): string | null {
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  )
    return el.value;
  return null;
}

/** Read before dispatching, so state changed by the dispatch itself counts. */
export function baseline(
  win: Window,
  original: Element,
  record?: Element | null,
): EffectBaseline {
  return {
    url: win.location.href,
    state: `${stateOf(original)}#${stateOf(record)}`,
    value: valueOf(original),
  };
}

export interface EffectWatchOptions {
  win: Window;
  original: Element;
  /** The record root, when the control belongs to one. */
  record?: Element | null;
  /**
   * Subtree whose content changes count (the record, the form or the
   * section). Defaults to the record, then the original's grandparent.
   */
  scope?: Element | null;
  before: EffectBaseline;
  signals?: Signals;
  timeoutMs?: number;
}

export interface EffectWatch {
  /** The first effect seen, or null when the window closed without one. */
  readonly result: Promise<EffectKind | null>;
  /** The effect seen so far (synchronous), or null. */
  seen(): EffectKind | null;
  /** Count an effect the caller observed itself (a key the site handled). */
  note(kind: EffectKind): void;
  stop(): void;
}

interface NavigationLike {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

const POLL_MS = 100;

export function watchEffect(o: EffectWatchOptions): EffectWatch {
  const { win, original } = o;
  const doc = original.ownerDocument;
  const record = o.record ?? null;
  const scope =
    o.scope ?? record ?? original.parentElement?.parentElement ?? original;
  let found: EffectKind | null = null;
  let done = false;
  let resolve: (k: EffectKind | null) => void = () => undefined;
  const result = new Promise<EffectKind | null>((r) => (resolve = r));
  const off: Array<() => void> = [];

  const finish = (kind: EffectKind | null): void => {
    if (done) return;
    done = true;
    if (kind && !found) found = kind;
    for (const f of off.splice(0)) f();
    resolve(found);
  };
  const hit = (kind: EffectKind): void => {
    if (!found) found = kind;
    finish(kind);
  };

  // A state attribute flipping on the original or its record is the control's
  // own read-back (a Like that became pressed); anything else is content.
  const mo = new MutationObserver((records) => {
    const seen = records.filter(meaningful);
    if (!seen.length) return;
    const own = seen.some(
      (r) =>
        r.type === 'attributes' &&
        (r.target === original || (record !== null && r.target === record)),
    );
    hit(own ? 'state' : 'content');
  });
  try {
    mo.observe(scope, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...STATE_ATTRS],
    });
    if (record && record !== scope)
      mo.observe(record, {
        attributes: true,
        attributeFilter: [...STATE_ATTRS],
      });
    if (!scope.contains(original))
      mo.observe(original, {
        attributes: true,
        attributeFilter: [...STATE_ATTRS],
      });
  } catch {
    // Detached scope: the poll below still sees removal and URL changes.
  }
  off.push(() => mo.disconnect());

  const listen = (
    target: EventTarget,
    type: string,
    kind: EffectKind,
    capture = false,
  ): void => {
    const fn = (): void => hit(kind);
    target.addEventListener(type, fn, capture);
    off.push(() => target.removeEventListener(type, fn, capture));
  };
  listen(win, 'hashchange', 'url');
  listen(win, 'popstate', 'url');
  listen(win, 'pagehide', 'navigation');
  // A new tab or window (window.open, target=_blank) takes focus away.
  listen(win, 'blur', 'navigation');
  listen(doc, 'visibilitychange', 'navigation');
  const nav = (win as Window & { navigation?: NavigationLike }).navigation;
  if (nav) listen(nav as unknown as EventTarget, 'navigate', 'navigation');
  if (o.signals) {
    const unsub = o.signals.on((k) => hit(k));
    off.push(unsub);
  }

  const check = (): void => {
    if (done) return;
    if (win.location.href !== o.before.url) return hit('url');
    if (!original.isConnected || (record && !record.isConnected))
      return hit('removed');
    const state = `${stateOf(original)}#${stateOf(record)}`;
    if (state !== o.before.state) return hit('state');
    const value = valueOf(original);
    if (value !== o.before.value) return hit('value');
  };
  const poll = setInterval(check, POLL_MS);
  off.push(() => clearInterval(poll));
  const timer = setTimeout(() => {
    check();
    finish(null);
  }, o.timeoutMs ?? EFFECT_TIMEOUT_MS);
  off.push(() => clearTimeout(timer));
  // The dispatch may already have changed state synchronously.
  check();

  return {
    result,
    seen: () => found,
    note: (kind) => hit(kind),
    stop: () => finish(null),
  };
}
