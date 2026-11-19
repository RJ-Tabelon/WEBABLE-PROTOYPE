import { isOurs, isRendered } from '../util/dom';
import { nextFrame } from '../util/schedule';
import type { Signals } from './effect';
import { clean, type Ephemeral, labelOf } from './locate';
import { safeHref } from './proxy';
import type { SkeletonRegistry, StatusLine, ViewSurface } from './types';

/**
 * The status strip (docs/10 §4.5): site feedback that is not a popup would
 * otherwise render unseen under the view ("Conversation archived · Undo",
 * "Added to cart", "Message sent", form errors), and a time-limited Undo
 * would run out.
 *
 * Mirrored into the view (surface.status):
 *   - new content in role=status, role=alert, aria-live and output regions;
 *   - fixed-position toasts that appear within 3 s of a proxied action.
 * Text is the page's visible text, read on this device (screen-reader-only
 * text never shows). Buttons in the message (Undo) become proxied actions.
 * A line leaves the strip when its source disappears or goes stale.
 *
 * Read-only.
 */

export const STATUS_WINDOW_MS = 3000;

const LIVE_SELECTOR =
  '[role="status"],[role="alert"],[aria-live]:not([aria-live="off"]),output';
const ACTION_SELECTOR = 'button,[role="button"],a[href],[role="link"]';
const NOT_TOAST = [
  'header',
  'nav',
  'dialog',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="toolbar"]',
  '[role="menubar"]',
  '[role="tooltip"]',
].join(',');

const MAX_LINES = 3;
const MAX_ACTIONS = 3;
/** Longer texts are content, not a status message. */
const MAX_TEXT = 200;
/** A live region's line without actions goes after this long. */
const LIVE_TTL_MS = 12_000;
/** A message with actions (Undo) stays while it is on the page, up to this. */
const ACTION_TTL_MS = 30_000;
/** Polite updates while the person types are suggestion counts: not news. */
const TYPING_QUIET_MS = 1500;
const TOAST_DEPTH = 8;
const MAX_CANDIDATES = 60;
const SWEEP_MS = 1000;

export interface StatusHost {
  win: Window;
  surface: ViewSurface;
  registry(): SkeletonRegistry;
  eph: Ephemeral;
  signals: Signals;
  /** Containers the view already shows as records: their live regions are not news. */
  shown(): Element[];
}

interface Entry {
  line: StatusLine;
  at: number;
  ttl: number;
}

/** Remove the action labels from a message's text ("Conversation archived. Undo"). */
export function messageText(text: string, actionLabels: string[]): string {
  let t = text;
  for (const label of actionLabels) {
    if (!label) continue;
    const i = t.lastIndexOf(label);
    if (i >= 0) t = `${t.slice(0, i)} ${t.slice(i + label.length)}`;
  }
  return clean(t).replace(/[\s·•|,–-]+$/u, '');
}

export class StatusMirror {
  private readonly entries = new Map<Element, Entry>();
  private readonly baseline = new WeakMap<Element, string>();
  private readonly keys = new WeakMap<Element, string>();
  private readonly dirtyLive = new Set<Element>();
  private readonly candidates = new Set<Element>();
  private readonly mo: MutationObserver;
  private n = 0;
  private lastAction = Number.NEGATIVE_INFINITY;
  private lastTyping = Number.NEGATIVE_INFINITY;
  private pending = false;
  private sent = '';
  private sentKeys = new Set<string>();
  private sweep: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly host: StatusHost) {
    const doc = host.win.document;
    const reg = host.registry();
    for (const el of Array.from(doc.querySelectorAll(LIVE_SELECTOR)).slice(
      0,
      200,
    ))
      if (!isOurs(el)) this.baseline.set(el, clean(reg.text(el)));
    this.mo = new MutationObserver((r) => this.records(r));
    this.mo.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
    });
  }

  /** A proxied action happened: toasts in the next 3 s are its feedback. */
  noteAction(): void {
    this.lastAction = performance.now();
  }

  noteTyping(): void {
    this.lastTyping = performance.now();
  }

  dispose(): void {
    this.disposed = true;
    this.mo.disconnect();
    if (this.sweep) clearInterval(this.sweep);
    this.entries.clear();
  }

  private inWindow(now = performance.now()): boolean {
    return now - this.lastAction < STATUS_WINDOW_MS;
  }

  private records(records: MutationRecord[]): void {
    const toast = this.inWindow();
    for (const r of records) {
      const node = r.target;
      const el =
        node.nodeType === Node.ELEMENT_NODE
          ? (node as Element)
          : node.parentElement;
      if (!el || isOurs(el)) continue;
      if (r.type !== 'attributes') {
        const live = el.closest(LIVE_SELECTOR);
        if (live) this.dirtyLive.add(live);
      }
      if (r.type === 'childList') {
        for (const n of Array.from(r.addedNodes)) {
          if (n.nodeType !== Node.ELEMENT_NODE) continue;
          const added = n as Element;
          if (isOurs(added)) continue;
          if (added.matches(LIVE_SELECTOR)) this.dirtyLive.add(added);
          for (const l of Array.from(
            added.querySelectorAll(LIVE_SELECTOR),
          ).slice(0, 20))
            this.dirtyLive.add(l);
          if (toast && this.candidates.size < MAX_CANDIDATES)
            this.candidates.add(added);
        }
      } else if (r.type === 'attributes') {
        if (el.matches(LIVE_SELECTOR) || el.closest(LIVE_SELECTOR)) {
          const live = el.closest(LIVE_SELECTOR);
          if (live) this.dirtyLive.add(live);
        }
        if (toast && this.candidates.size < MAX_CANDIDATES)
          this.candidates.add(el);
      }
    }
    if (this.dirtyLive.size || this.candidates.size) this.schedule();
  }

  private schedule(): void {
    if (this.pending || this.disposed) return;
    this.pending = true;
    void nextFrame().then(() => {
      this.pending = false;
      this.flush();
    });
  }

  private flush(): void {
    if (this.disposed) return;
    const now = performance.now();
    for (const live of this.dirtyLive) this.readLive(live, now);
    this.dirtyLive.clear();
    if (this.inWindow(now)) {
      const seen = new Set<Element>();
      for (const c of this.candidates) {
        const t = this.toastRoot(c);
        if (t && !seen.has(t)) {
          seen.add(t);
          this.read(t, now, 'toast');
        }
      }
    }
    this.candidates.clear();
    this.emit(now);
  }

  private shownContains(el: Element): boolean {
    return this.host.shown().some((c) => c.contains(el));
  }

  private readLive(el: Element, now: number): void {
    if (!el.isConnected || isOurs(el) || this.shownContains(el)) return;
    const polite =
      el.getAttribute('role') === 'status' ||
      el.getAttribute('aria-live') === 'polite' ||
      el.localName === 'output';
    if (polite && now - this.lastTyping < TYPING_QUIET_MS) return;
    this.read(el, now, 'live');
  }

  /** A fixed-position box around a node that changed in the action window. */
  private toastRoot(start: Element): Element | null {
    const win = this.host.win;
    let el: Element | null = start;
    for (let i = 0; el && i < TOAST_DEPTH; i++, el = el.parentElement) {
      if (el === win.document.body || el === win.document.documentElement)
        return null;
      if (isOurs(el)) return null;
      if (win.getComputedStyle(el).position !== 'fixed') continue;
      // Popups are peek's; fixed headers, nav and toolbars are not messages.
      if (el.matches(NOT_TOAST) || el.closest('header, nav')) return null;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > 0.4 * win.innerWidth * win.innerHeight)
        return null;
      if (el.querySelectorAll(ACTION_SELECTOR).length > MAX_ACTIONS)
        return null;
      return el;
    }
    return null;
  }

  private read(el: Element, now: number, kind: 'live' | 'toast'): void {
    const reg = this.host.registry();
    const full = isRendered(el) ? clean(reg.text(el)) : '';
    if (!full || full.length > MAX_TEXT || this.shownContains(el)) {
      this.entries.delete(el);
      return;
    }
    if (
      kind === 'live' &&
      this.baseline.get(el) === full &&
      !this.entries.has(el)
    )
      return;
    this.baseline.delete(el);
    const prev = this.entries.get(el);
    const actions = this.actionsIn(el);
    const text = messageText(
      full,
      actions.map((a) => a.label),
    );
    if (!text) {
      this.entries.delete(el);
      return;
    }
    if (
      prev &&
      prev.line.text === text &&
      prev.line.actions.length === actions.length
    )
      return;
    this.entries.set(el, {
      line: { key: this.keyOf(el), text, actions },
      at: now,
      ttl: actions.length ? ACTION_TTL_MS : LIVE_TTL_MS,
    });
  }

  private actionsIn(el: Element): StatusLine['actions'] {
    const reg = this.host.registry();
    const out: StatusLine['actions'] = [];
    for (const a of Array.from(el.querySelectorAll(ACTION_SELECTOR))) {
      if (out.length >= MAX_ACTIONS) break;
      if (!isRendered(a)) continue;
      const label = clean(labelOf(reg, a));
      if (!label) continue;
      const href =
        a instanceof HTMLAnchorElement
          ? safeHref(reg.href(a), a.ownerDocument.location.href)
          : null;
      out.push({
        label,
        target: this.host.eph.target(a, href ? 'link' : 'button', label, href),
      });
    }
    return out;
  }

  private keyOf(el: Element): string {
    let k = this.keys.get(el);
    if (!k) {
      k = `s${++this.n}`;
      this.keys.set(el, k);
    }
    return k;
  }

  /** Drop lines whose source went away or went stale; send the strip if it changed. */
  private emit(now: number): void {
    const reg = this.host.registry();
    for (const [el, e] of this.entries) {
      const gone =
        !el.isConnected ||
        !isRendered(el) ||
        !clean(reg.text(el)) ||
        now - e.at > e.ttl;
      if (gone) this.entries.delete(el);
    }
    const lines = [...this.entries.values()]
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_LINES)
      .map((e) => e.line);
    const sig = lines
      .map(
        (l) =>
          `${l.key}:${l.text}:${l.actions.map((a) => a.target.id).join(',')}`,
      )
      .join('|');
    if (sig !== this.sent) {
      const fresh = lines.some((l) => !this.sentKeys.has(l.key));
      this.sent = sig;
      this.sentKeys = new Set(lines.map((l) => l.key));
      this.host.surface.status(lines);
      if (fresh) this.host.signals.emit('status');
    }
    if (this.entries.size > 0 && !this.sweep)
      this.sweep = setInterval(() => this.emit(performance.now()), SWEEP_MS);
    else if (this.entries.size === 0 && this.sweep) {
      clearInterval(this.sweep);
      this.sweep = null;
    }
  }
}
