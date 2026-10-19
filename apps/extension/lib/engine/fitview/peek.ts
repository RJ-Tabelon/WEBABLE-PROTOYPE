import {
  composedParent,
  FOCUSABLE_SELECTOR,
  HOST_TAG,
  isOurs,
  isRendered,
} from '../util/dom';
import { nextFrame } from '../util/schedule';
import type { Signals } from './effect';
import { deepActive } from './firewall';
import type { Ephemeral } from './locate';
import type { ProxyLayer } from './proxy';
import { dismissPopup, SheetMirror } from './sheet';
import type { SkeletonRegistry, ViewSurface } from './types';

/**
 * Site popups while Fit view is open (docs/10 §4.5, "Site popups").
 *
 * Peek is triggered by state, not by cause. Real sites rarely insert a new
 * node: YouTube reuses one dropdown and toggles its style, Gmail toggles
 * visibility on existing role=menu elements, and sites open dialogs on their
 * own (session expiry, a late consent banner). So every dialog, menu,
 * listbox, aria-modal and popover element is watched for becoming visible
 * (attribute and style changes, checkVisibility, top-layer toggles).
 *
 *   menu / listbox   mirrored as a sheet beside the control that opened it
 *                    (sheet.ts); suggestions of the field the person is
 *                    typing in are never a peek.
 *   dialog           peek: the view steps aside (surface.peek), focus moves
 *                    into the site's dialog, and "Back to Fit view" sends
 *                    Escape to it first. A dialog that closes itself returns
 *                    to the view. A site showModal() at any time peeks.
 *
 * "Show on page" (a refused or failed proxy, "Do this on the page") is a
 * peek too, with a ring around the element in WebAble's own host.
 *
 * Covering: if something covers Fit view's controls outside a peek (an
 * IntersectionObserver v2 visibility change, confirmed by a hit test),
 * proxies freeze with one line until it is gone.
 *
 * Nothing here writes to the site's DOM. Focus moves into a site dialog the
 * way the dialog itself would ask for.
 */

export const PEEK_COPY = {
  covered: 'Something on this page is covering Fit view',
} as const;

const POPUP_SELECTOR = [
  'dialog',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[popover]',
].join(',');

const ITEM_SELECTOR =
  '[role="option"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';

/** Attributes that show or hide a popup (on it or on an ancestor). */
const WATCHED_ATTRS = [
  'open',
  'hidden',
  'style',
  'class',
  'aria-hidden',
  'aria-modal',
  'role',
  'popover',
];

/** A proxied action this recent explains a popup that opens. */
const ACTION_WINDOW_MS = 3000;
/** Typing this recent explains a listbox that opens (suggestions). */
const TYPING_WINDOW_MS = 1500;
/** A dialog that closed returns to the view after this, unless another opens. */
const RETURN_DELAY_MS = 150;
/** "Back to Fit view" waits this long for Escape to close the site popup. */
const BACK_WAIT_MS = 300;
const ANCESTOR_DEPTH = 40;

export type PopupKind = 'dialog' | 'menu';

/** What kind of popup an element is, if any. */
export function popupKind(el: Element): PopupKind | null {
  const role = el.getAttribute('role');
  if (
    el instanceof HTMLDialogElement ||
    role === 'dialog' ||
    role === 'alertdialog' ||
    el.getAttribute('aria-modal') === 'true'
  )
    return 'dialog';
  if (role === 'menu' || role === 'listbox') return 'menu';
  if (el.hasAttribute('popover')) {
    if (role === 'tooltip' || role === 'status' || role === 'alert')
      return null;
    if (el.querySelector(ITEM_SELECTOR)) return 'menu';
    if (el.querySelector(FOCUSABLE_SELECTOR)) return 'dialog';
  }
  return null;
}

/** On screen now: rendered, with a box, open when it is a dialog or popover. */
export function popupShown(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el instanceof HTMLDialogElement && !el.open) return false;
  if (el.hasAttribute('popover') && !el.matches(':popover-open')) return false;
  if (!isRendered(el, { opacity: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function isModal(el: Element): boolean {
  return (
    el.matches(':modal') ||
    el.getAttribute('aria-modal') === 'true' ||
    el.getAttribute('role') === 'alertdialog'
  );
}

/** Covers the middle of the viewport: a blocking overlay built from divs. */
function coversCentre(el: Element, win: Window): boolean {
  const r = el.getBoundingClientRect();
  const cx = win.innerWidth / 2;
  const cy = win.innerHeight / 2;
  return (
    r.left <= cx &&
    r.right >= cx &&
    r.top <= cy &&
    r.bottom >= cy &&
    r.width * r.height >= 0.25 * win.innerWidth * win.innerHeight
  );
}

// ---------------------------------------------------------------------------
// Watching popups become visible
// ---------------------------------------------------------------------------

/**
 * Tracks every popup-like element in the document and reports visibility
 * transitions once per frame. Attribute changes on an ancestor (a wrapper's
 * style or class) are matched by walking up from each known popup, so the
 * cost does not grow with the page's mutation rate.
 */
export class PopupWatch {
  readonly known = new Set<Element>();
  private readonly shown = new WeakMap<Element, boolean>();
  private readonly dirty = new Set<Element>();
  private readonly touched = new Set<Element>();
  private readonly mo: MutationObserver;
  private pending = false;
  private disposed = false;
  private readonly onToggle = (e: Event): void => {
    const t = e.target;
    if (t instanceof Element && !isOurs(t)) {
      this.add(t, false);
      this.dirty.add(t);
      this.schedule();
    }
  };

  constructor(
    private readonly doc: Document,
    private readonly onChange: (popup: Element, shown: boolean) => void,
  ) {
    for (const el of Array.from(doc.querySelectorAll(POPUP_SELECTOR)))
      this.add(el, true);
    this.mo = new MutationObserver((records) => this.records(records));
    this.mo.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRS,
    });
    doc.addEventListener('toggle', this.onToggle, true);
  }

  isShown(el: Element): boolean {
    return this.shown.get(el) === true;
  }

  /** Check every known popup now (after a proxied action, say). */
  recheck(): void {
    for (const p of this.known) this.dirty.add(p);
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.mo.disconnect();
    this.doc.removeEventListener('toggle', this.onToggle, true);
    this.known.clear();
  }

  private add(el: Element, initial: boolean): void {
    if (this.known.has(el) || isOurs(el) || !el.matches(POPUP_SELECTOR)) return;
    this.known.add(el);
    // Popups present at open are a baseline; new ones start hidden so that
    // one inserted already visible counts as appearing.
    this.shown.set(el, initial ? popupShown(el) : false);
  }

  private records(records: MutationRecord[]): void {
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of Array.from(r.addedNodes)) {
          if (n.nodeType !== Node.ELEMENT_NODE) continue;
          const el = n as Element;
          if (el.localName === HOST_TAG) continue;
          if (el.matches(POPUP_SELECTOR)) {
            this.add(el, false);
            this.dirty.add(el);
          }
          for (const d of Array.from(el.querySelectorAll(POPUP_SELECTOR))) {
            this.add(d, false);
            this.dirty.add(d);
          }
        }
        if (r.removedNodes.length) this.touched.add(r.target as Element);
        continue;
      }
      const t = r.target as Element;
      if (t.matches(POPUP_SELECTOR)) {
        this.add(t, false);
        this.dirty.add(t);
      } else this.touched.add(t);
    }
    this.schedule();
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
    const changes: Array<[Element, boolean]> = [];
    for (const p of this.known) {
      if (!this.dirty.has(p) && !this.ancestorTouched(p) && p.isConnected)
        continue;
      const now = popupShown(p);
      const was = this.shown.get(p) === true;
      if (now !== was) {
        this.shown.set(p, now);
        changes.push([p, now]);
      }
      if (!p.isConnected) this.known.delete(p);
    }
    this.dirty.clear();
    this.touched.clear();
    // Closings first, so a dialog replacing another hands over cleanly.
    changes.sort((a, b) => Number(a[1]) - Number(b[1]));
    for (const [p, now] of changes) this.onChange(p, now);
  }

  private ancestorTouched(p: Element): boolean {
    if (this.touched.size === 0) return false;
    let n: Element | null = p;
    for (let i = 0; n && i < ANCESTOR_DEPTH; i++, n = composedParent(n))
      if (this.touched.has(n)) return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// The ring around an element shown on the page
// ---------------------------------------------------------------------------

const RING_CSS = `
:host { all: initial; }
.ring {
  position: fixed; pointer-events: none; box-sizing: border-box;
  border: 3px solid #2D6A3E; border-radius: 4px;
  box-shadow: 0 0 0 2px #FFFFFF, inset 0 0 0 2px #FFFFFF;
}
.caption {
  position: fixed; pointer-events: none; max-width: min(36em, 90vw);
  padding: 4px 10px; border-radius: 4px;
  background: #FAFAF7; color: #1A1A17; box-shadow: 0 0 0 1px #7D7C73;
  font: 500 16px/1.45 system-ui, sans-serif;
}
`;

/** WebAble's own outline around a site element (a separate host; the page is never written). */
export class Ring {
  private readonly host: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly caption: HTMLElement;
  private raf = 0;
  private stopped = false;

  constructor(
    private readonly doc: Document,
    private target: Element,
    caption: string,
  ) {
    this.host = doc.createElement(HOST_TAG);
    this.host.style.setProperty('position', 'fixed', 'important');
    this.host.style.setProperty('inset', '0', 'important');
    this.host.style.setProperty('pointer-events', 'none', 'important');
    this.host.style.setProperty('z-index', '2147483600', 'important');
    const root = this.host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(RING_CSS);
    root.adoptedStyleSheets = [sheet];
    this.ring = doc.createElement('div');
    this.ring.className = 'ring';
    this.caption = doc.createElement('div');
    this.caption.className = 'caption';
    this.caption.textContent = caption;
    this.caption.hidden = !caption;
    root.append(this.ring, this.caption);
    doc.documentElement.append(this.host);
    this.place();
  }

  move(target: Element, caption: string): void {
    this.target = target;
    this.caption.textContent = caption;
    this.caption.hidden = !caption;
    this.place();
  }

  remove(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.host.remove();
  }

  private place(): void {
    if (this.stopped) return;
    const r = this.target.isConnected
      ? this.target.getBoundingClientRect()
      : null;
    const visible = r !== null && (r.width > 0 || r.height > 0);
    this.ring.hidden = !visible;
    if (r && visible) {
      const pad = 4;
      Object.assign(this.ring.style, {
        left: `${r.left - pad}px`,
        top: `${r.top - pad}px`,
        width: `${r.width + pad * 2}px`,
        height: `${r.height + pad * 2}px`,
      });
      const below = r.bottom + pad + 8;
      const vh = this.doc.defaultView?.innerHeight ?? 0;
      Object.assign(this.caption.style, {
        left: `${Math.max(8, r.left - pad)}px`,
        top:
          below + 40 < vh ? `${below}px` : `${Math.max(8, r.top - pad - 44)}px`,
      });
    }
    this.raf = requestAnimationFrame(() => this.place());
  }
}

// ---------------------------------------------------------------------------
// Covering
// ---------------------------------------------------------------------------

const COVER_SAMPLE = 8;
const COVER_RECHECK_MS = 500;

interface IOv2Init extends IntersectionObserverInit {
  trackVisibility?: boolean;
  delay?: number;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

/**
 * Something on the page drawn over Fit view would let a page dress up the
 * person's click (clickjacking): only the top layer can sit above the view's
 * modal dialog, so that is a site popover (or fullscreen element) shown after
 * the view. It can be inert and let clicks through to the control it hides,
 * so hit testing cannot see it; IntersectionObserver v2 (trackVisibility)
 * reports the occlusion on a sample of the view's controls, and a covering
 * top-layer element is confirmed by its box (Fit view's own sticky parts
 * occlude controls too, harmlessly).
 */
export class CoverWatch {
  private io: IntersectionObserver | null = null;
  private observed: HTMLElement[] = [];
  private covered = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resample: ReturnType<typeof setInterval> | null = null;
  /** When each site popover opened; those opened before the view are under it. */
  private readonly openedAt = new WeakMap<Element, number>();
  private viewShownAt = performance.now();
  private readonly onToggle = (e: Event): void => {
    const t = e.target;
    if (!(t instanceof Element) || isOurs(t)) return;
    if ((e as ToggleEvent).newState === 'open')
      this.openedAt.set(t, performance.now());
    this.check();
  };
  private readonly onFullscreen = (): void => this.check();

  constructor(
    private readonly doc: Document,
    private readonly controls: () => HTMLElement[],
    private readonly onChange: (covered: boolean) => void,
  ) {
    doc.addEventListener('toggle', this.onToggle, true);
    doc.addEventListener('fullscreenchange', this.onFullscreen);
    if (typeof IntersectionObserver !== 'function') return;
    try {
      this.io = new IntersectionObserver(
        (entries) => {
          const suspect = entries.some(
            (e) =>
              e.isIntersecting &&
              (e as IntersectionObserverEntry & { isVisible?: boolean })
                .isVisible === false,
          );
          if (suspect || this.covered) this.check();
        },
        { trackVisibility: true, delay: 100, threshold: [0] } as IOv2Init,
      );
    } catch {
      this.io = null;
    }
    this.sample();
    this.resample = setInterval(() => this.sample(), 1000);
  }

  get frozen(): boolean {
    return this.covered;
  }

  /** The view's dialog went back on top of the top layer (a peek ended). */
  shown(): void {
    this.viewShownAt = performance.now();
    this.check();
  }

  /** Check the sampled controls against the page's top layer now. */
  check(): void {
    const above = this.above();
    if (above.length === 0) {
      this.set(false);
      return;
    }
    this.sample();
    const boxes = above.map((el) => el.getBoundingClientRect());
    const vh = this.doc.defaultView?.innerHeight ?? 0;
    const covered = this.observed.some((c) => {
      if (!c.isConnected) return false;
      const r = c.getBoundingClientRect();
      if (r.width === 0 || r.bottom <= 0 || r.top >= vh) return false;
      return boxes.some((b) => overlaps(r, b));
    });
    this.set(covered);
  }

  dispose(): void {
    this.doc.removeEventListener('toggle', this.onToggle, true);
    this.doc.removeEventListener('fullscreenchange', this.onFullscreen);
    this.io?.disconnect();
    if (this.timer) clearInterval(this.timer);
    if (this.resample) clearInterval(this.resample);
    this.observed = [];
  }

  /** Site top-layer elements drawn above the view, visible. */
  private above(): Element[] {
    const out: Element[] = [];
    for (const el of Array.from(this.doc.querySelectorAll(':popover-open'))) {
      if (isOurs(el)) continue;
      const at = this.openedAt.get(el);
      if (at === undefined || at < this.viewShownAt) continue;
      if (isRendered(el, { opacity: true })) out.push(el);
    }
    const fs = this.doc.fullscreenElement;
    if (fs && !isOurs(fs)) out.push(fs);
    return out;
  }

  private sample(): void {
    const vh = this.doc.defaultView?.innerHeight ?? 0;
    const pick = this.controls()
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < vh;
      })
      .slice(0, COVER_SAMPLE);
    if (
      pick.length === this.observed.length &&
      pick.every((c, i) => c === this.observed[i])
    )
      return;
    this.io?.disconnect();
    this.observed = pick;
    for (const c of pick) this.io?.observe(c);
  }

  private set(covered: boolean): void {
    if (covered === this.covered) return;
    this.covered = covered;
    if (covered && !this.timer)
      this.timer = setInterval(() => this.check(), COVER_RECHECK_MS);
    if (!covered && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onChange(covered);
  }
}

// ---------------------------------------------------------------------------
// The peek controller
// ---------------------------------------------------------------------------

export interface PeekHost {
  win: Window;
  surface: ViewSurface;
  root: ShadowRoot;
  registry(): SkeletonRegistry;
  eph: Ephemeral;
  proxies: ProxyLayer;
  signals: Signals;
  notice(owner: string, text: string | null): void;
  /** Peek started or ended (the live layer stops driving the page's scroll). */
  onPeek(on: boolean): void;
}

interface PeekState {
  /** The site popup being answered, or null for "show on page". */
  popup: Element | null;
  reason: 'dialog' | 'show';
  /** The view control to return focus to. */
  anchor: HTMLElement | null;
  scrollTop: number;
  ring: Ring | null;
}

interface Expectation {
  original: Element;
  control: HTMLElement;
  at: number;
}

export class PeekController {
  readonly sheet: SheetMirror;
  private readonly watch: PopupWatch;
  private readonly cover: CoverWatch;
  private state: PeekState | null = null;
  private expected: Expectation | null = null;
  private typed: Expectation | null = null;
  private lastAction = Number.NEGATIVE_INFINITY;
  private returnTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly host: PeekHost) {
    const doc = host.win.document;
    this.sheet = new SheetMirror({
      surface: host.surface,
      root: host.root,
      registry: host.registry,
      eph: host.eph,
      proxies: host.proxies,
    });
    this.watch = new PopupWatch(doc, (p, shown) => this.popup(p, shown));
    this.cover = new CoverWatch(
      doc,
      () => host.proxies.allControls(),
      (covered) => this.covered(covered),
    );
  }

  /**
   * The person is on the page: a peek of ours, or the view stepped aside
   * for another reason (the renderer's own "Do this on the page").
   */
  get peeking(): boolean {
    return this.state !== null || !this.host.surface.dialog.open;
  }

  /** Proxies refuse while something covers the view (never during a peek). */
  frozen(): boolean {
    return !this.peeking && this.cover.frozen;
  }

  /** A site modal (showModal, aria-modal) that blocks the page. */
  blocking(): Element | null {
    const doc = this.host.win.document;
    const modal = doc.querySelector(':modal');
    if (modal && !isOurs(modal)) return modal;
    for (const p of this.watch.known)
      if (
        this.watch.isShown(p) &&
        p.getAttribute('aria-modal') === 'true' &&
        popupShown(p)
      )
        return p;
    return null;
  }

  /** A proxied action just happened. */
  noteAction(): void {
    this.lastAction = performance.now();
    this.watch.recheck();
  }

  /** The proxy is about to click a control that opens a popup. */
  expectPopup(original: Element, control: HTMLElement): void {
    this.expected = { original, control, at: performance.now() };
    this.lastAction = performance.now();
  }

  /** The person is typing in a field whose original may show suggestions. */
  typing(original: Element, control: HTMLElement): void {
    this.typed = { original, control, at: performance.now() };
    this.watch.recheck();
  }

  /** Step aside and show an element on the page, with a ring and a caption. */
  show(el: Element | null, caption: string): void {
    if (this.disposed) return;
    if (el?.isConnected)
      el.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'instant',
      });
    const doc = this.host.win.document;
    if (this.state) {
      if (el?.isConnected) {
        if (this.state.ring) this.state.ring.move(el, caption);
        else this.state.ring = new Ring(doc, el, caption);
      }
      return;
    }
    this.enter({
      popup: null,
      reason: 'show',
      anchor: this.activeControl(),
      scrollTop: this.host.surface.scroller.scrollTop,
      ring: el?.isConnected ? new Ring(doc, el, caption) : null,
    });
  }

  /** "Back to Fit view": Escape to the site popup first, then return. */
  back(): void {
    const st = this.state;
    if (!st) return;
    const p = st.popup;
    if (!p || !popupShown(p)) {
      this.exit();
      return;
    }
    dismissPopup(p);
    const started = performance.now();
    const wait = (): void => {
      if (this.state !== st) return;
      if (!popupShown(p) || performance.now() - started >= BACK_WAIT_MS)
        this.exit();
      else setTimeout(wait, 50);
    };
    setTimeout(wait, 30);
  }

  dispose(): void {
    this.disposed = true;
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.state?.ring?.remove();
    this.state = null;
    this.sheet.dispose();
    this.watch.dispose();
    this.cover.dispose();
  }

  // -- Popups ----------------------------------------------------------------

  private popup(p: Element, shown: boolean): void {
    if (this.disposed) return;
    if (!shown) {
      if (this.sheet.source === p) this.sheet.close();
      if (this.state?.popup === p) this.scheduleReturn();
      return;
    }
    const kind = popupKind(p);
    if (!kind) return;
    // The view stepped aside without us: the person works on the page.
    if (!this.state && !this.host.surface.dialog.open) return;
    const now = performance.now();
    if (this.state) {
      // The person is on the page: a new dialog becomes the one to answer.
      if (
        kind === 'dialog' &&
        this.state.reason === 'dialog' &&
        !this.state.popup?.contains(p)
      ) {
        if (this.returnTimer) clearTimeout(this.returnTimer);
        this.state.popup = p;
        this.focusInto(p);
      }
      return;
    }
    if (kind === 'menu') {
      const t = this.typed;
      if (t && now - t.at < TYPING_WINDOW_MS && this.belongsTo(p, t.original)) {
        this.openSheet(p, t.control, 'combobox', t.original);
        return;
      }
      const x = this.expected;
      if (x && now - x.at < ACTION_WINDOW_MS) {
        this.expected = null;
        this.openSheet(p, x.control, 'menu', null);
      }
      return;
    }
    const recent = now - this.lastAction < ACTION_WINDOW_MS;
    if (recent || isModal(p) || coversCentre(p, this.host.win)) {
      this.host.signals.emit('popup');
      this.sheet.close();
      this.enter({
        popup: p,
        reason: 'dialog',
        anchor: this.expected?.control ?? this.activeControl(),
        scrollTop: this.host.surface.scroller.scrollTop,
        ring: null,
      });
      this.expected = null;
      this.focusInto(p);
    }
  }

  /** A listbox belongs to a field: aria-controls/owns, active descendant, or it opened as they typed. */
  private belongsTo(p: Element, field: Element): boolean {
    const ids = new Set<string>();
    const combo = field.closest('[role="combobox"]');
    for (const el of [field, combo]) {
      if (!el) continue;
      for (const a of ['aria-controls', 'aria-owns'])
        for (const id of (el.getAttribute(a) ?? '').split(/\s+/))
          if (id) ids.add(id);
    }
    if (p.id && ids.has(p.id)) return true;
    for (const id of ids) {
      const owned = p.ownerDocument.getElementById(id);
      if (owned && (owned === p || owned.contains(p) || p.contains(owned)))
        return true;
    }
    const active = field.getAttribute('aria-activedescendant');
    if (
      active &&
      p.ownerDocument.getElementById(active)?.closest(POPUP_SELECTOR) === p
    )
      return true;
    // No association in the markup: a listbox that opens while they type.
    return ids.size === 0 && p.getAttribute('role') === 'listbox';
  }

  private openSheet(
    p: Element,
    control: HTMLElement,
    mode: 'menu' | 'combobox',
    field: Element | null,
  ): void {
    this.sheet.open(p, control, mode, field);
    if (this.sheet.rows().length === 0 && mode === 'menu') {
      // Nothing readable to mirror: show the menu where it is.
      void nextFrame().then(() => {
        if (this.sheet.source !== p || this.sheet.rows().length > 0) return;
        this.sheet.close();
        this.show(p, '');
      });
    }
    this.host.signals.emit('popup');
  }

  // -- Peek ------------------------------------------------------------------

  private enter(st: PeekState): void {
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.state = st;
    this.host.surface.peek(true, () => this.back());
    this.host.onPeek(true);
  }

  private exit(): void {
    const st = this.state;
    if (!st) return;
    this.state = null;
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = null;
    st.ring?.remove();
    this.host.surface.peek(false);
    this.cover.shown();
    // The dialog's scroller may have lost its offset while it was closed.
    const scroller = this.host.surface.scroller;
    void nextFrame().then(() => {
      if (scroller.scrollTop !== st.scrollTop)
        scroller.scrollTop = st.scrollTop;
      if (st.anchor?.isConnected) st.anchor.focus({ preventScroll: true });
    });
    this.host.onPeek(false);
  }

  /** The dialog that caused the peek closed: return unless another one opens. */
  private scheduleReturn(): void {
    const st = this.state;
    if (!st || st.reason !== 'dialog') return;
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      if (this.state === st && (!st.popup || !popupShown(st.popup)))
        this.exit();
    }, RETURN_DELAY_MS);
  }

  /** Move focus into a site dialog, if it did not take focus itself. */
  private focusInto(p: Element): void {
    void nextFrame().then(() => {
      if (!this.state || this.state.popup !== p) return;
      const doc = p.ownerDocument;
      if (doc.activeElement && p.contains(doc.activeElement)) return;
      const first = Array.from(
        p.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).find((el) => isRendered(el) && !(el as HTMLButtonElement).disabled);
      if (first) first.focus();
      else if (p instanceof HTMLElement && p.tabIndex >= 0) p.focus();
    });
  }

  private activeControl(): HTMLElement | null {
    const a = deepActive(this.host.root);
    return a instanceof HTMLElement ? a : null;
  }

  private covered(on: boolean): void {
    this.host.notice('cover', on ? PEEK_COPY.covered : null);
  }
}
