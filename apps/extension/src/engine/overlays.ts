// Owner: O (round 2). "Make room": overlays that cover the task.
//
// Detection (overlays brief):
//  - overlay root: the outermost position: fixed (or a stuck, full-width sticky bar) ancestor covering >= 1% of the
//    viewport; page shells (a fixed wrapper around the main content) are never overlays;
//  - coverage(o): the share of a 24 x 14 elementsFromPoint grid where o is on top (WebAble's own UI is skipped);
//  - blocked: the centre, or >= 3 of 5 points, of the main action, a main-form field, the focused element or the h1
//    is covered by the overlay;
//  - self-opened: it appeared more than 1.5 s after the person's last trusted press or key. Overlays the person
//    opened, and ones in use (focus, a press or typing inside), are never touched.
// Decisions are core's `planOverlays` (pure, tested). Actions, all undoable with WebAble's own CSS:
//  - consent: docked off screen with `translate` (still in the DOM and tab order; :focus-within brings it back);
//    the UI shows a 72 px bar with the site's own choices. WebAble never answers it;
//  - chat that opened by itself: Jev picks its own minimise button (core jev/overlay.ts gate), code presses it and
//    checks within 800 ms (panel shrank >= 80%, launcher shows, focus, scroll and URL unchanged); else it is tucked;
//  - survey, newsletter, promotion (Jev's v1 fold rule): tucked to the nearest edge with a "‹name› · Show" chip;
//  - modal: offered only; promo bar / tall header: unpinned; pinned bars that stay get scroll-padding (WCAG C43).
// Runs on new overlays (300 ms quiet), zoom, resize, scroll end and focusin; at most once per 500 ms; never while the
// pointer hovers an overlay or the person is typing. Undo remembers "leave" for that site and kind for 30 days.

import { closeRefusal, planOverlays, safeClassWords } from '@webable/core';
import type {
  BgRequest, ElementDecision, LedgerEntry, OverlayAction, OverlayButtonEvidence, OverlayCloseResult, OverlayEvidence,
  OverlayFacts, OverlayKind, OverlayPlan, Role,
} from '@webable/core';
import type { Op, SheetLayer } from './tailor';
import { makeOpRecord } from './tailor';
import {
  CHAT_CLASS, CONSENT_CLASS, accessibleName, classWordsOf, collapse, iframeKindOf, linkTargetOf, pageFrame, safeUiLabel, visibleTextOf,
} from './reader';
import { sleep } from './nav';

/* ------------------------------------------------------------------ */
/* What the UI reads (EngineState.overlays carries these objects)      */
/* ------------------------------------------------------------------ */

/** One of the site's own buttons in a docked notice, in DOM order. `id` works with `api.elementFor`. */
export interface OverlayChoice {
  id: string;
  label: string;
}

/**
 * EngineState.overlays entries are OverlayAction plus these fields (read them with `overlayView`):
 *  - name: short chip name ("Survey", "Signup", "Offer", "Chat", "Cookie notice");
 *  - choices: a docked consent notice's own buttons, in DOM order (ids work with api.elementFor);
 *  - revealed: the person moved focus into the moved overlay, so it is back on screen (hide its bar or chip);
 *  - edge: where it was moved to (chips sit on that side);
 *  - question: for action 'offered' (a modal), the offer's question.
 * Commands go through api.restoreOverlay(cmd): `id` (Undo / Show: brings it back; remembers "leave" for this site
 * and kind for 30 days, except consent), `${id}#read` (bring it back for this page view only), `${id}#close` (accept
 * an offered modal close: presses the site's own close button Jev found).
 */
export interface OverlayView extends OverlayAction {
  name: string;
  choices: OverlayChoice[];
  revealed: boolean;
  edge: 'top' | 'bottom' | 'left' | 'right' | null;
  question?: string;
}

/** Defensive reader for an EngineState.overlays entry. */
export function overlayView(a: OverlayAction): OverlayView {
  const x = a as Partial<OverlayView> & OverlayAction;
  return {
    ...a,
    name: typeof x.name === 'string' && x.name ? x.name : NAME[a.kind],
    choices: Array.isArray(x.choices) ? x.choices : [],
    revealed: x.revealed === true,
    edge: x.edge ?? null,
    ...(typeof x.question === 'string' ? { question: x.question } : {}),
  };
}

export const overlayCommand = {
  read: (id: string): string => `${id}#read`,
  close: (id: string): string => `${id}#close`,
};

/** The bar the UI draws for a docked consent notice (counted in coverage after docking). */
export const CONSENT_BAR_PX = 72;

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

export interface OverlayHost {
  ask<T>(req: BgRequest): Promise<T>;
  isOurUi(t: EventTarget | null): boolean;
  /** Reader id for any element (assigned when new), so `api.elementFor` finds it. */
  ensureId(el: Element): string;
  decisions(): ElementDecision[];
  elementFor(id: string): Element | null;
  /** The main action, main-form fields and the h1 (the focused element is added here). */
  taskTargets(): Element[];
  mainRoot(): Element | null;
  sheets: SheetLayer;
  /** Serialises DOM writes with the verified op batches. */
  lock<T>(fn: () => Promise<T>): Promise<T>;
  addOp(op: Op): void;
  syncOps(): void;
  log(e: Omit<LedgerEntry, 'at'>): void;
  toast(text: string, undoOpId?: string): void;
  publish(list: OverlayView[]): void;
  /** No scans: not fitted yet, Calm view open, or the original page showing. */
  paused(): boolean;
  /** Whether the ledger already has an entry with this title (one line per fact). */
  ledgerHas(title: string): boolean;
  /** No toasts now (Calm view is open): the ledger still says what changed. */
  quiet(): boolean;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const COLS = 24;
const ROWS = 14;
const SELF_OPEN_MS = 1500;
const MIN_GAP_MS = 500;
const QUIET_MS = 300;
const VERIFY_MS = 800;
const LEAVE_DAYS = 30;
const LEAVE_KEY = 'overlayLeave';
const ATTR = 'data-wa-ov';
const UNPIN_ATTR = 'data-wa-ovunpin';

const NAME: Record<OverlayKind, string> = {
  consent: 'Cookie notice', chat: 'Chat', survey: 'Survey', newsletter: 'Signup', promo_bar: 'Offer', warning: 'Notice',
  modal: 'Popup', header: 'Header', other: 'Popup',
};
const NOUN: Record<OverlayKind, string> = {
  consent: 'cookie notice', chat: 'chat window', survey: 'survey invitation', newsletter: 'signup popup', promo_bar: 'promotion bar',
  warning: 'warning', modal: 'popup', header: 'top bar', other: 'floating panel',
};

const SURVEY_RE = /\b(survey|feedback|questionnaire|how (is|are|was) (your|we|our)|rate (us|your|our)|tell us what you think)\b/i;
const NEWSLETTER_RE = /\b(newsletter|subscribe|sign ?up|signup|email (updates|offers|list)|reminders?|join (our|the|now)|text (alerts|reminders)|never miss)\b/i;
const PROMO_RE = /\b(\d+% off|sale|deal|offer|promo|coupon|discount|free (shipping|delivery|trial)|save \$?\d|limited time|shop now|members?hip|rewards?)\b/i;
const WARNING_RE = /\b(session|time ?out|timed out|expir(e|es|ing)|signed out|sign(ed)? you out|inactiv(e|ity)|about to end|unsaved)\b/i;
const CLOSE_HINT = /(close|minimi[sz]e|hide|collapse|dismiss|toggle|chevron|caret|^x$|^min$)/i;
const BUTTONS = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], a[href], summary';
const CHOICE_BUTTONS = 'button, [role="button"], input[type="button"], input[type="submit"]';
const TOGGLES = 'input[type="checkbox"], input[type="radio"], [role="switch"], [role="checkbox"]';
const FIELDS = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"], [contenteditable=""]';

type Rect = { l: number; t: number; r: number; b: number };

interface Rec {
  key: string;
  root: Element;
  kind: OverlayKind;
  appearedAt: number;
  lastCoverage: number;
  actions: number;
  /** The person brought it back or answered it: never act on it again on this page view. */
  personDone: boolean;
  /** A Jev close call is in flight or done. */
  asking: boolean;
  closeResult: OverlayCloseResult | null;
  closeEl: Element | null;
  launcher: Element | null;
  op: Op | null;
  view: OverlayView | null;
  logged: Set<string>;
  edge: OverlayView['edge'];
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function viewport(): { vw: number; vh: number } {
  return { vw: document.documentElement.clientWidth || innerWidth, vh: document.documentElement.clientHeight || innerHeight };
}

function visible(el: Element): boolean {
  if (!el.isConnected) return false;
  try {
    if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  } catch {
    /* older engine */
  }
  const r = el.getBoundingClientRect();
  return r.width >= 1 && r.height >= 1;
}

/** Union of the root's box and its visible descendants' boxes (an absolutely placed chat panel is wider than its root). */
function visualRect(root: Element): Rect | null {
  let out: Rect | null = null;
  const add = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (!out) out = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    else out = { l: Math.min(out.l, r.left), t: Math.min(out.t, r.top), r: Math.max(out.r, r.right), b: Math.max(out.b, r.bottom) };
  };
  if (visible(root)) add(root);
  const kids = root.querySelectorAll('*');
  for (let i = 0; i < kids.length && i < 400; i++) {
    const k = kids[i];
    if (!k) continue;
    const cs = getComputedStyle(k);
    if (cs.position !== 'absolute' && cs.position !== 'fixed' && i > 40) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    add(k);
  }
  return out;
}

function clipToViewport(r: Rect, vw: number, vh: number): Rect | null {
  const l = Math.max(0, r.l);
  const t = Math.max(0, r.t);
  const rr = Math.min(vw, r.r);
  const b = Math.min(vh, r.b);
  return rr > l && b > t ? { l, t, r: rr, b } : null;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function p2(x: number): string {
  return (Math.round(x * 100) / 100).toFixed(2);
}

function px(n: number): number {
  return Math.round(n);
}

function positionPhrase(r: Rect, vw: number, vh: number): string {
  const w = r.r - r.l;
  const h = r.b - r.t;
  if (w >= 0.8 * vw) return r.t <= vh * 0.3 ? 'top band, full width' : r.b >= vh * 0.7 ? 'bottom band, full width' : 'middle, full width';
  const cx = (r.l + r.r) / 2;
  const cy = (r.t + r.b) / 2;
  const v = cy < vh / 3 ? 'top' : cy > (2 * vh) / 3 ? 'bottom' : 'middle';
  const hz = cx < vw / 3 ? 'left' : cx > (2 * vw) / 3 ? 'right' : 'center';
  const nearSide = r.l <= 48 || r.r >= vw - 48;
  if (v !== 'middle' && hz !== 'center' && nearSide) return `${v} ${hz} corner, floating`;
  if (v === 'middle' && hz === 'center') return `center of the screen, ${h > 0.6 * vh ? 'tall' : 'floating'}`;
  return `${v} ${hz}, floating`;
}

function placeInOverlay(el: Element, box: Rect): string {
  const r = el.getBoundingClientRect();
  const w = Math.max(1, box.r - box.l);
  const h = Math.max(1, box.b - box.t);
  const fx = ((r.left + r.right) / 2 - box.l) / w;
  const fy = ((r.top + r.bottom) / 2 - box.t) / h;
  const v = fy < 0.25 ? 'top' : fy > 0.75 ? 'bottom' : 'middle';
  const hz = fx < 0.3 ? 'left' : fx > 0.7 ? 'right' : 'center';
  if (v !== 'middle' && hz !== 'center') return `${v}-${hz} corner`;
  if (v === 'middle' && hz === 'center') return 'middle';
  return v === 'middle' ? `${hz} side` : `${v} edge, ${hz === 'center' ? 'middle' : hz}`;
}

/* ------------------------------------------------------------------ */
/* The manager                                                         */
/* ------------------------------------------------------------------ */

export class OverlayManager {
  private host: OverlayHost;
  private recs = new Map<Element, Rec>();
  private seq = 0;
  private lastInputAt: number | null = null;
  private lastKeyAt = 0;
  private lastMove: { at: number; target: Element | null } = { at: 0, target: null };
  private pressed: Array<{ el: Element; at: number }> = [];
  private mutations: Array<{ el: Element; at: number }> = [];
  private mo: MutationObserver | null = null;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScanAt = 0;
  private prevScanAt = 0;
  private scanning = false;
  private rescan = false;
  private started = false;
  private leave: Record<string, Partial<Record<OverlayKind, number>>> = {};
  private leaveLoaded = false;
  private paddingOp: Op | null = null;
  private paddingSheet: CSSStyleSheet | null = null;
  private padding = { top: 0, bottom: 0 };
  private kindActions = new Map<OverlayKind, number>();
  private hidden = false;
  private inputBeforeHide: number | null = null;
  private keptSaid = new Set<string>();
  private readonly listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions]> = [];

  constructor(host: OverlayHost) {
    this.host = host;
  }

  /** Start tracking input and DOM changes (call early, before the page is fitted). */
  start(): void {
    if (this.started) return;
    this.started = true;
    const on = (t: EventTarget, type: string, fn: EventListener, opts: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.listeners.push([t, type, fn, opts]);
    };
    const passive = { capture: true, passive: true };
    on(window, 'pointerdown', ((e: PointerEvent) => {
      if (!e.isTrusted || this.host.isOurUi(e.target)) return;
      this.lastInputAt = performance.now();
      if (e.target instanceof Element) this.pressed = [...this.pressed.slice(-19), { el: e.target, at: this.lastInputAt }];
    }) as EventListener, passive);
    on(window, 'keydown', ((e: KeyboardEvent) => {
      if (!e.isTrusted || this.host.isOurUi(e.target)) return;
      this.lastInputAt = performance.now();
      this.lastKeyAt = this.lastInputAt;
    }) as EventListener, passive);
    on(window, 'pointermove', ((e: PointerEvent) => {
      this.lastMove = { at: performance.now(), target: e.target instanceof Element ? e.target : null };
    }) as EventListener, passive);
    on(window, 'resize', (() => {
      this.refresh();
      this.schedule('resize');
    }) as EventListener, { passive: true });
    on(window, 'scrollend', (() => this.schedule('scroll')) as EventListener, { passive: true });
    on(document, 'focusin', ((e: FocusEvent) => this.onFocus(e)) as EventListener, { capture: true });
    on(document, 'focusout', ((e: FocusEvent) => this.onFocus(e)) as EventListener, { capture: true });
    this.mo = new MutationObserver((records) => this.onMutations(records));
    this.mo.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-modal'],
    });
    void this.loadLeave();
  }

  stop(): void {
    this.mo?.disconnect();
    this.mo = null;
    for (const [t, type, fn, opts] of this.listeners.splice(0)) t.removeEventListener(type, fn, opts);
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.started = false;
  }

  /** A new page view: forget overlays (their ops are reverted by the controller's teardown). */
  reset(): void {
    this.recs.clear();
    this.kindActions.clear();
    this.keptSaid.clear();
    this.paddingOp = null;
    this.paddingSheet = null;
    this.padding = { top: 0, bottom: 0 };
    this.mutations = [];
    this.host.publish([]);
  }

  /** Run a scan soon (at most once per 500 ms; deferred while hovering an overlay or typing). */
  schedule(_reason: string): void {
    if (!this.started) return;
    if (this.scanning) {
      this.rescan = true;
      return;
    }
    if (this.scanTimer) return;
    const wait = Math.max(0, MIN_GAP_MS - (performance.now() - this.lastScanAt));
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      void this.scan();
    }, Math.max(50, wait));
  }

  /**
   * Whether an element sits inside a floating overlay (a fixed popup, panel or banner; not a pinned header), so the
   * controller leaves folding it to this module instead of dimming it in place.
   */
  inOverlay(el: Element): boolean {
    const root = this.rootOf(el, new Map());
    if (!root || getComputedStyle(root).position !== 'fixed') return false;
    const { vw, vh } = viewport();
    const r = root.getBoundingClientRect();
    const topBar = r.top <= 4 && r.width >= 0.8 * Math.min(vw, pageFrame().width) && r.height <= 0.3 * vh;
    return !topBar;
  }

  /** Hide the bar and chips (the original page is showing, or Calm view is open); show them again after. */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) {
      this.inputBeforeHide = this.lastInputAt;
    } else {
      // Presses and keys while Calm view (or the original page) was showing drove WebAble, not the page: an overlay
      // that shows again now did not open because of them. Look again right away.
      this.lastInputAt = this.inputBeforeHide;
      this.lastKeyAt = 0;
      this.schedule('shown');
    }
    this.publish();
  }

  /* ---------------- events ---------------- */

  private onMutations(records: MutationRecord[]): void {
    const now = performance.now();
    for (const r of records) {
      if (r.type === 'attributes' && r.attributeName?.startsWith('data-wa-')) continue;
      const t = r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement;
      if (!t || this.host.isOurUi(t)) continue;
      this.mutations.push({ el: t, at: now });
      if (r.type === 'childList') for (const n of Array.from(r.addedNodes)) if (n.nodeType === 1) this.mutations.push({ el: n as Element, at: now });
    }
    if (this.mutations.length > 600) this.mutations = this.mutations.slice(-400);
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      if (this.recentOverlayChange()) this.schedule('mutation');
    }, QUIET_MS);
  }

  /** Did a recent change touch something fixed or a dialog (cheap filter before a full scan)? */
  private recentOverlayChange(): boolean {
    const since = performance.now() - 2000;
    const cache = new Map<Element, CSSStyleDeclaration>();
    let n = 0;
    for (let i = this.mutations.length - 1; i >= 0 && n < 80; i--, n++) {
      const m = this.mutations[i];
      if (!m || m.at < since) break;
      if (!m.el.isConnected) continue;
      if (m.el.matches('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]')) return true;
      if (this.rootOf(m.el, cache)) return true;
      // A root that only now has a fixed descendant (a panel that was display: none).
      for (const rec of this.recs.values()) if (rec.root.contains(m.el)) return true;
    }
    return false;
  }

  private onFocus(e: FocusEvent): void {
    if (this.host.isOurUi(e.target)) return;
    let changed = false;
    for (const rec of this.recs.values()) {
      if (!rec.view || (rec.view.action !== 'docked' && rec.view.action !== 'tucked')) continue;
      const inside = rec.root.contains(document.activeElement);
      if (inside !== rec.view.revealed) {
        rec.view = { ...rec.view, revealed: inside };
        changed = true;
      }
    }
    if (changed) this.publish();
    if (e.type === 'focusin') this.schedule('focus');
  }

  /* ---------------- memory ---------------- */

  private async loadLeave(): Promise<void> {
    try {
      const got = await chrome.storage.local.get(LEAVE_KEY);
      const v = got[LEAVE_KEY] as Record<string, Partial<Record<OverlayKind, number>>> | undefined;
      if (v && typeof v === 'object') this.leave = v;
    } catch {
      /* storage unavailable: nothing remembered */
    }
    this.leaveLoaded = true;
  }

  private leaving(kind: OverlayKind): boolean {
    const until = this.leave[location.hostname]?.[kind];
    return typeof until === 'number' && until > Date.now();
  }

  private rememberLeave(kind: OverlayKind): void {
    const host = location.hostname;
    const now = Date.now();
    const next: Record<string, Partial<Record<OverlayKind, number>>> = {};
    for (const [h, kinds] of Object.entries(this.leave)) {
      const kept: Partial<Record<OverlayKind, number>> = {};
      for (const [k, t] of Object.entries(kinds)) if (typeof t === 'number' && t > now) kept[k as OverlayKind] = t;
      if (Object.keys(kept).length) next[h] = kept;
    }
    next[host] = { ...(next[host] ?? {}), [kind]: now + LEAVE_DAYS * 24 * 3600 * 1000 };
    this.leave = next;
    try {
      void chrome.storage.local.set({ [LEAVE_KEY]: next }).catch(() => undefined);
    } catch {
      /* storage unavailable */
    }
  }

  /* ---------------- detection ---------------- */

  private style(el: Element, cache: Map<Element, CSSStyleDeclaration>): CSSStyleDeclaration {
    let cs = cache.get(el);
    if (!cs) {
      cs = getComputedStyle(el);
      cache.set(el, cs);
    }
    return cs;
  }

  /** The outermost fixed (or stuck full-width sticky) ancestor, or null when the element is part of the page. */
  private rootOf(el: Element, cache: Map<Element, CSSStyleDeclaration>): Element | null {
    const { vw, vh } = viewport();
    let root: Element | null = null;
    const chain: Element[] = []; // fixed or stuck ancestors, innermost first
    let n: Element | null = el;
    let depth = 0;
    while (n && depth < 60) {
      if (n === document.documentElement || n === document.body) break;
      if (this.host.isOurUi(n)) return null;
      const cs = this.style(n, cache);
      if (cs.position === 'fixed') {
        root = n;
        chain.push(n);
      } else if (cs.position === 'sticky') {
        const r = n.getBoundingClientRect();
        const stuck = (r.top <= 2 || r.bottom >= vh - 2) && r.width >= 0.6 * Math.min(vw, pageFrame().width);
        if (stuck) {
          root = n;
          chain.push(n);
        }
      }
      const parent: Element | null = n.parentElement ?? ((n.parentNode as ShadowRoot | null)?.host ?? null);
      n = parent;
      depth++;
    }
    if (!root) return null;
    // A fixed top bar that holds another fixed layer below it (a cookie banner placed inside the site's header): the
    // layer is its own overlay, not part of the bar.
    if (chain.length >= 2) {
      const outer = root.getBoundingClientRect();
      if (outer.top <= 4 && outer.height <= 0.3 * vh) {
        for (let i = chain.length - 2; i >= 0; i--) {
          const r = chain[i]!.getBoundingClientRect();
          if (r.top >= outer.bottom - 2 && r.width >= 1 && r.height >= 1) {
            root = chain[i]!;
            break;
          }
        }
      }
    }
    return this.isShell(root) ? null : root;
  }

  /** A fixed wrapper that holds the page itself (an app shell) is not an overlay. */
  private isShell(root: Element): boolean {
    const { vw, vh } = viewport();
    const r = root.getBoundingClientRect();
    // Only a layer as big as half the screen can be the page's own shell (a reader may pick a cookie banner's long
    // paragraph as the "main" text on a page with little text of its own).
    const big = r.width * r.height >= 0.5 * vw * vh;
    const main = this.host.mainRoot();
    if (big && main && main !== document.body && main !== document.documentElement && root.contains(main)) return true;
    const m = document.querySelector('main, [role="main"]');
    if (big && m && root.contains(m)) return true;
    if (r.width * r.height >= 0.85 * vw * vh && !root.matches('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]')
      && !root.querySelector('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]')) {
      const cs = getComputedStyle(root);
      const scrolls = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && root.scrollHeight > root.clientHeight + 4;
      if (scrolls || collapse(root.textContent ?? '').length > 4000) return true;
    }
    return false;
  }

  /** Grid coverage per overlay root (share of the 24 x 14 points where it is on top). */
  private grid(cache: Map<Element, CSSStyleDeclaration>, box?: Rect, cols = COLS, rows = ROWS): Map<Element, number> {
    const { vw, vh } = viewport();
    const area = box ?? { l: 0, t: 0, r: vw, b: vh };
    const counts = new Map<Element, number>();
    const w = area.r - area.l;
    const h = area.b - area.t;
    if (w <= 0 || h <= 0) return counts;
    const total = cols * rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = area.l + ((i + 0.5) * w) / cols;
        const y = area.t + ((j + 0.5) * h) / rows;
        const top = this.topAt(x, y);
        if (!top) continue;
        const root = this.rootOf(top, cache);
        if (root) counts.set(root, (counts.get(root) ?? 0) + 1);
      }
    }
    for (const [k, v] of counts) counts.set(k, v / total);
    return counts;
  }

  private topAt(x: number, y: number): Element | null {
    let stack: Element[];
    try {
      stack = document.elementsFromPoint(x, y);
    } catch {
      return null;
    }
    for (const el of stack) {
      if (el.tagName === 'WEBABLE-UI' || this.host.isOurUi(el)) continue;
      return el;
    }
    return null;
  }

  private blocked(roots: Set<Element>, cache: Map<Element, CSSStyleDeclaration>): Set<Element> {
    const out = new Set<Element>();
    const { vw, vh } = viewport();
    const targets = [...this.host.taskTargets()];
    const active = document.activeElement;
    if (active && active !== document.body && !this.host.isOurUi(active)) targets.push(active);
    for (const t of targets.slice(0, 24)) {
      if (!t.isConnected || roots.has(t) || [...roots].some((r) => r.contains(t))) continue;
      const r = t.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      const pts: Array<[number, number]> = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + r.width * 0.2, r.top + r.height * 0.25], [r.left + r.width * 0.8, r.top + r.height * 0.25],
        [r.left + r.width * 0.2, r.top + r.height * 0.75], [r.left + r.width * 0.8, r.top + r.height * 0.75],
      ];
      const hits: Array<Element | null> = pts.map(([x, y]) => {
        if (x < 0 || y < 0 || x >= vw || y >= vh) return null;
        const top = this.topAt(x, y);
        if (!top || t.contains(top) || top.contains(t)) return null;
        const root = this.rootOf(top, cache);
        return root && roots.has(root) ? root : null;
      });
      const centre = hits[0];
      const tally = new Map<Element, number>();
      for (const h of hits) if (h) tally.set(h, (tally.get(h) ?? 0) + 1);
      if (centre) out.add(centre);
      for (const [root, n] of tally) if (n >= 3) out.add(root);
    }
    return out;
  }

  /** Jev's answers about the overlay itself: decisions on elements covering >= 40% of its box. */
  private jevFacts(root: Element, box: Rect): { folded: boolean; task: number; keepPopup: boolean; consent: number; ad: number; popup: number; help: number; reason: string } {
    const area = Math.max(1, (box.r - box.l) * (box.b - box.t));
    let folded = false;
    let keepPopup = false;
    let task = 0;
    let consent = 0;
    let ad = 0;
    let popup = 0;
    let help = 0;
    let reason = '';
    for (const d of this.host.decisions()) {
      const el = this.host.elementFor(d.id);
      if (!el || !(el === root || root.contains(el))) continue;
      if (d.verdict === 'keep_popup') {
        keepPopup = true;
        task = Math.max(task, d.judgment.task);
      }
      const r = el.getBoundingClientRect();
      const big = r.width * r.height >= 0.4 * area || el === root;
      if (!big) continue;
      const j = d.judgment;
      task = Math.max(task, j.task);
      help = Math.max(help, j.help);
      consent = Math.max(consent, j.roleProbs.consent_notice ?? 0);
      ad = Math.max(ad, j.roleProbs.advertising ?? 0);
      popup = Math.max(popup, j.roleProbs.popup_overlay ?? 0);
      if (d.verdict === 'fold') {
        folded = true;
        const word = (r2: Role) => (r2 === 'popup_overlay' ? 'popup' : r2 === 'advertising' ? 'advertising' : r2 === 'recommendations' ? 'recommendations' : r2);
        reason = `${word(j.role)} ${p2(j.roleP)} · task ${p2(j.task)}`;
      }
    }
    return { folded, task, keepPopup, consent, ad, popup, help, reason };
  }

  private classify(root: Element, box: Rect, jev: ReturnType<OverlayManager['jevFacts']>): { kind: OverlayKind; modal: boolean; alertdialog: boolean; name: string } {
    const { vw, vh } = viewport();
    const dlg = root.matches('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]')
      ? root
      : root.querySelector('[role="alertdialog"], [role="dialog"], dialog[open], [aria-modal="true"]');
    const alertdialog = root.matches('[role="alertdialog"]') || !!root.querySelector('[role="alertdialog"]');
    let modal = root.matches('[aria-modal="true"]') || !!root.querySelector('[aria-modal="true"]');
    try {
      modal = modal || root.matches(':modal') || !!root.querySelector(':modal');
    } catch {
      /* :modal unsupported */
    }
    const words = new Set<string>(classWordsOf(root, 8));
    for (const el of [dlg, ...Array.from(root.children).slice(0, 3)]) if (el) for (const w of classWordsOf(el, 6)) words.add(w);
    const wordStr = [...words].join(' ');
    const label = collapse(dlg?.getAttribute('aria-label') ?? root.getAttribute('aria-label') ?? '');
    const labelledBy = (dlg ?? root).getAttribute('aria-labelledby');
    const titled = labelledBy ? collapse(document.getElementById(labelledBy.split(/\s+/)[0] ?? '')?.textContent ?? '') : '';
    const heading = collapse(root.querySelector('h1, h2, h3, h4, legend, [role="heading"]')?.textContent ?? '');
    const name = label || titled || heading;
    const text = visibleTextOf(root, 500);
    const all = `${wordStr} ${name} ${text}`;
    const iframe = root.querySelector('iframe');
    const ifKind = iframe ? iframeKindOf(iframe.getAttribute('src') ?? '') : null;
    const area = (box.r - box.l) * (box.b - box.t);
    // Full width of the page: the page column when WebAble holds the page to one (its header spans the column).
    const full = box.r - box.l >= 0.8 * Math.min(vw, pageFrame().width);
    const atTop = box.t <= 4;
    const atBottom = box.b >= vh - 4;

    if (alertdialog || jev.keepPopup || jev.task >= 0.7 || (dlg && WARNING_RE.test(`${name} ${text.slice(0, 200)}`))) {
      return { kind: 'warning', modal, alertdialog, name };
    }
    if (CONSENT_CLASS.test(wordStr) || ifKind === 'consent_manager' || jev.consent >= 0.5
      || (/\bcookies?\b/i.test(text) && /\b(accept|reject|consent|privacy|preferences|agree)\b/i.test(text))) {
      return { kind: 'consent', modal, alertdialog, name };
    }
    const hasField = !!root.querySelector('input[type="text"], textarea, [contenteditable="true"], [role="textbox"]');
    if (ifKind === 'chat_widget' || ((CHAT_CLASS.test(wordStr) || /\b(chat|assistant|messag(e|ing)|live help)\b/i.test(name)) && (hasField || !!iframe || area >= 0.05 * vw * vh))) {
      return { kind: 'chat', modal, alertdialog, name };
    }
    // The site's own header bar first: a pinned top bar that holds the site's navigation, banner or search is its
    // header even when an ad slot inside it says "Ad Feedback" (cnn.com), so it scrolls away and is never tucked.
    if (!modal && full && atTop && box.b - box.t <= 0.35 * vh
      && (root.matches('header, [role="banner"], nav') || !!root.querySelector('header, [role="banner"], nav, [role="navigation"], [role="search"]'))) {
      return { kind: 'header', modal, alertdialog, name };
    }
    if (SURVEY_RE.test(all) || ifKind === 'survey') return { kind: 'survey', modal, alertdialog, name };
    if (NEWSLETTER_RE.test(all)) return { kind: 'newsletter', modal, alertdialog, name };
    if (modal) return { kind: 'modal', modal, alertdialog, name };
    if (full && (atTop || atBottom) && box.b - box.t <= 0.2 * vh && (jev.ad >= 0.9 || jev.folded || (PROMO_RE.test(text) && !root.querySelector('nav, [role="navigation"], [role="banner"], header')))) {
      return { kind: 'promo_bar', modal, alertdialog, name };
    }
    if (full && atTop && (root.matches('header, [role="banner"], nav') || !!root.querySelector('header, [role="banner"], nav, [role="navigation"], [role="search"]'))) {
      return { kind: 'header', modal, alertdialog, name };
    }
    return { kind: 'other', modal, alertdialog, name };
  }

  private findLauncher(root: Element): Element | null {
    const ids = new Set<string>();
    if (root.id) ids.add(root.id);
    for (const el of Array.from(root.querySelectorAll('[id]')).slice(0, 300)) ids.add(el.id);
    for (const el of Array.from(document.querySelectorAll('[aria-controls]')).slice(0, 300)) {
      const c = el.getAttribute('aria-controls') ?? '';
      if (c.split(/\s+/).some((x) => ids.has(x)) && el.matches(BUTTONS)) return el;
    }
    for (const el of Array.from(root.querySelectorAll(CHOICE_BUTTONS))) {
      const words = `${classWordsOf(el).join(' ')} ${accessibleName(el)}`;
      if (el.hasAttribute('aria-expanded') && /(chat|messag|help|assist|support|open|launcher|bubble)/i.test(words)) return el;
      if (/(launcher|bubble|fab|trigger)/i.test(classWordsOf(el).join(' '))) return el;
    }
    return null;
  }

  private touched(root: Element): boolean {
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a)) return true;
    const since = performance.now() - 120_000;
    if (this.pressed.some((p) => p.at >= since && root.contains(p.el))) return true;
    for (const f of Array.from(root.querySelectorAll(FIELDS)).slice(0, 20)) {
      const v = (f as HTMLInputElement).value;
      if (typeof v === 'string' && v.length > 0) return true;
      if (f.getAttribute('contenteditable') !== null && collapse(f.textContent ?? '').length > 0) return true;
    }
    return false;
  }

  /**
   * When the overlay appeared (or grew): the first change inside it since the previous scan, so a chat that keeps
   * adding messages after the person opened it still dates from the moment it opened.
   */
  private appearedAt(rec: Rec | undefined, root: Element, coverage: number): number {
    const grew = !rec || coverage >= rec.lastCoverage + 0.05 || rec.lastCoverage <= 0.002;
    if (rec && !grew) return rec.appearedAt;
    let first = -1;
    let latest = -1;
    for (const m of this.mutations) {
      if (!(m.el === root || root.contains(m.el))) continue;
      latest = m.at;
      if (first < 0 && m.at > this.prevScanAt) first = m.at;
    }
    if (first >= 0) return first;
    if (latest >= 0) return latest;
    return rec ? rec.appearedAt : 0; // there since the page loaded
  }

  private selfOpened(at: number): boolean {
    if (this.lastInputAt === null) return true;
    if (at < this.lastInputAt) return true;
    return at - this.lastInputAt > SELF_OPEN_MS;
  }

  /* ---------------- the scan ---------------- */

  private async scan(): Promise<void> {
    if (this.scanning || !this.started) return;
    if (this.host.paused()) return;
    const now = performance.now();
    // Not while the pointer rests on an overlay or the person is typing.
    if (now - this.lastKeyAt < 900 || (now - this.lastMove.at < 400 && this.lastMove.target && this.rootOf(this.lastMove.target, new Map()))) {
      this.scanTimer = setTimeout(() => {
        this.scanTimer = null;
        void this.scan();
      }, 600);
      return;
    }
    if (!this.leaveLoaded) await this.loadLeave();
    this.scanning = true;
    this.prevScanAt = this.lastScanAt;
    this.lastScanAt = now;
    try {
      await this.scanOnce();
    } catch (err) {
      console.warn('[WebAble] overlay scan failed', err);
    } finally {
      this.scanning = false;
      if (this.rescan) {
        this.rescan = false;
        this.schedule('again');
      }
    }
  }

  private async scanOnce(): Promise<void> {
    const { vw, vh } = viewport();
    const cache = new Map<Element, CSSStyleDeclaration>();
    const cov = this.grid(cache);
    // Candidates: what is on top somewhere, plus overlays Jev folded that are behind something (a survey behind a
    // session warning), plus overlays already tracked.
    const roots = new Set<Element>(cov.keys());
    for (const d of this.host.decisions()) {
      if (d.verdict !== 'fold' && d.verdict !== 'keep_popup') continue;
      const el = this.host.elementFor(d.id);
      const r = el ? this.rootOf(el, cache) : null;
      if (r) roots.add(r);
    }
    for (const el of Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')).slice(0, 20)) {
      const r = this.rootOf(el, cache);
      if (r) roots.add(r);
    }
    for (const [root, rec] of this.recs) {
      if (!root.isConnected) {
        this.recs.delete(root);
        continue;
      }
      roots.add(root);
      if (rec.view && (rec.view.action === 'docked' || rec.view.action === 'tucked') && !visualRect(root)) {
        // The site removed it (answered, closed): the bar or chip goes too.
        rec.view = null;
      }
    }

    const live: Array<{ root: Element; box: Rect; rec: Rec; facts: OverlayFacts; cls: ReturnType<OverlayManager['classify']>; jev: ReturnType<OverlayManager['jevFacts']> }> = [];
    const blocking = this.blocked(new Set(roots), cache);
    for (const root of roots) {
      const tracked = this.recs.get(root);
      if (tracked?.op?.active && tracked.view?.action === 'minimised' && (cov.get(root) ?? 0) >= 0.05) {
        // The chat opened again after it was minimised: decide afresh (at most 2 automatic actions in all).
        tracked.op = null;
        tracked.view = null;
      }
      if (!root.isConnected || (root.hasAttribute(ATTR) && tracked?.op?.active)) {
        if (tracked) tracked.lastCoverage = cov.get(root) ?? 0;
        continue;
      }
      const vr = visualRect(root);
      const box = vr ? clipToViewport(vr, vw, vh) : null;
      if (!box) continue;
      const boxArea = (box.r - box.l) * (box.b - box.t);
      const coverage = cov.get(root) ?? 0;
      const known = this.recs.get(root);
      if (!known && boxArea < 0.01 * vw * vh) continue;
      const jev = this.jevFacts(root, box);
      const cls = this.classify(root, box, jev);
      let rec = known;
      if (!rec) {
        rec = {
          key: this.host.ensureId(root), root, kind: cls.kind, appearedAt: 0, lastCoverage: 0, actions: 0, personDone: false,
          asking: false, closeResult: null, closeEl: null, launcher: null, op: null, view: null, logged: new Set(), edge: null,
        };
        this.recs.set(root, rec);
      }
      if (!rec.op) rec.kind = cls.kind;
      rec.appearedAt = this.appearedAt(known, root, coverage);
      rec.lastCoverage = coverage;
      if (rec.kind === 'chat') rec.launcher = this.findLauncher(root);
      const edge: OverlayFacts['edge'] = box.b >= vh - 4 && box.t > vh * 0.3 ? 'bottom' : box.t <= 4 && box.b < vh * 0.7 ? 'top' : box.l <= 4 || box.r >= vw - 4 || box.l <= 48 || box.r >= vw - 48 ? 'side' : 'center';
      const choices = Array.from(root.querySelectorAll(CHOICE_BUTTONS)).filter((b) => visible(b) && !(b as HTMLButtonElement).disabled).length;
      const toggles = Array.from(root.querySelectorAll(TOGGLES)).some((t) => visible(t) && !(t as HTMLInputElement).disabled);
      const wall = coverage >= 0.6 || boxArea >= 0.9 * vw * vh;
      const facts: OverlayFacts = {
        id: rec.key,
        kind: rec.kind,
        coverage,
        blocks: blocking.has(root),
        selfOpened: this.selfOpened(rec.appearedAt),
        touched: this.touched(root),
        choices,
        toggles,
        wall,
        modal: cls.modal,
        folded: jev.folded,
        task: jev.task,
        alertdialog: cls.alertdialog,
        advertising: jev.ad,
        edge,
        heightShare: (box.b - box.t) / vh,
        launcher: rec.kind === 'chat' ? !!rec.launcher : false,
        leave: this.leaving(rec.kind) || rec.personDone || (this.kindActions.get(rec.kind) ?? 0) >= 4,
        actions: rec.actions,
      };
      live.push({ root, box, rec, facts, cls, jev });
    }

    const plans = planOverlays(live.map((x) => x.facts));
    for (let i = 0; i < live.length; i++) {
      const item = live[i];
      const plan = plans[i];
      if (!item || !plan) continue;
      if (item.rec.op?.active || item.rec.asking) continue;
      await this.act(item.rec, plan.plan, plan.reason, item);
    }
    this.updatePadding(cache);
    this.publish();
  }

  /* ---------------- actions ---------------- */

  private async act(
    rec: Rec, plan: OverlayPlan, reason: string,
    item: { root: Element; box: Rect; facts: OverlayFacts; cls: { name: string }; jev: { reason: string; task: number } },
  ): Promise<void> {
    const { facts } = item;
    switch (plan) {
      case 'keep': {
        if (rec.logged.has('keep')) return;
        rec.logged.add('keep');
        if (rec.kind === 'consent') {
          this.setView(rec, 'kept', facts.coverage, facts.coverage, 'Left for you to answer: WebAble never answers consent notices.');
          if (!this.ledgerHas('Left the cookie notice for you to answer')) {
            this.host.log({ source: 'layout', title: 'Left the cookie notice for you to answer', detail: `It ${reason.startsWith('a full') ? 'covers the whole page' : `has ${reason}`}, so it stays as the site shows it.`, action: 'protected' });
          }
          return;
        }
        const session = WARNING_RE.test(`${item.cls.name} ${visibleTextOf(rec.root, 200)}`);
        const alert = facts.alertdialog || session;
        const what = session ? 'the session warning' : alert ? 'the warning' : 'the popup';
        const taskTxt = item.jev.task > 0 ? ` (${alert ? 'task' : 'part of the task'} ${p2(item.jev.task)})` : '';
        this.setView(rec, 'kept', facts.coverage, facts.coverage, `Kept ${what} in front${taskTxt}.`, 'warning');
        // Say it once Jev has answered (with its task probability); without an answer, on the next scan.
        if (item.jev.task <= 0 && this.host.decisions().length === 0 && !rec.logged.has('keep-wait')) {
          rec.logged.delete('keep');
          rec.logged.add('keep-wait');
          return;
        }
        // One line per kind of kept popup (a backdrop and its dialog are two roots on some sites).
        if (this.keptSaid.has(what)) return;
        this.keptSaid.add(what);
        this.host.log({ source: item.jev.task > 0 ? 'jev' : 'layout', title: `Kept ${what} in front${taskTxt}`, detail: alert ? 'Warnings that affect the task are never moved.' : 'Jev judged it part of this page’s task, so WebAble leaves it where it is.', ...(item.jev.task > 0 ? { p: item.jev.task } : {}), action: 'kept' });
        return;
      }
      case 'dock':
        await this.dock(rec, item);
        return;
      case 'tuck':
        await this.tuck(rec, item, rec.kind === 'chat' ? `${reason}` : item.jev.reason || reason);
        return;
      case 'minimise':
        // Pressing a site button can move focus: never while Calm view is open or focus is in WebAble's own UI
        // (the next scan after Calm closes decides again).
        if (this.host.quiet() || this.host.isOurUi(document.activeElement)) return;
        await this.minimise(rec, item);
        return;
      case 'unpin':
        await this.unpin(rec, item, reason);
        return;
      case 'offer':
        if (this.host.quiet()) return;
        await this.offerClose(rec, item);
        return;
      default:
        return;
    }
  }

  private ledgerHas(title: string): boolean {
    try {
      return this.host.ledgerHas(title);
    } catch {
      return false;
    }
  }

  private bump(rec: Rec): void {
    rec.actions++;
    this.kindActions.set(rec.kind, (this.kindActions.get(rec.kind) ?? 0) + 1);
  }

  private setView(
    rec: Rec, action: OverlayAction['action'], before: number, after: number, detail: string, kind: OverlayKind = rec.kind,
    extra: Partial<OverlayView> = {},
  ): void {
    const view: OverlayView = {
      id: rec.key,
      kind,
      action,
      coverageBefore: Math.round(before * 1000) / 1000,
      coverageAfter: Math.round(after * 1000) / 1000,
      detail,
      name: NAME[kind],
      choices: [],
      revealed: false,
      edge: rec.edge,
      ...extra,
    };
    if (rec.op) view.opId = rec.op.rec.id;
    rec.view = view;
  }

  private publish(): void {
    const list: OverlayView[] = [];
    if (!this.hidden) for (const rec of this.recs.values()) if (rec.view) list.push(rec.view);
    this.host.publish(list);
  }

  /** Coverage of one root right now (finer grid over its old box). */
  private coverageNow(root: Element): number {
    const cache = new Map<Element, CSSStyleDeclaration>();
    return this.grid(cache).get(root) ?? 0;
  }

  /** Translate a root off screen toward one edge (WebAble's own CSS; :focus-within brings it back). */
  private moveOp(rec: Rec, mode: 'dock' | 'tuck', title: string, detail: string, source: LedgerEntry['source'], p?: number): Op | null {
    const root = rec.root;
    const { vw, vh } = viewport();
    const vr = visualRect(root);
    if (!vr) return null;
    const value = `o${++this.seq}`;
    // The nearest edge: the shortest move that takes the whole box off screen.
    const moves: Array<{ edge: NonNullable<OverlayView['edge']>; dist: number }> = mode === 'dock'
      ? [{ edge: vr.b >= vh - 4 || (vr.t + vr.b) / 2 > vh / 2 ? 'bottom' : 'top', dist: 0 }]
      : [
        { edge: 'right', dist: vw - vr.l },
        { edge: 'left', dist: vr.r },
        { edge: 'bottom', dist: vh - vr.t },
        { edge: 'top', dist: vr.b },
      ];
    moves.sort((a, b) => a.dist - b.dist);
    const edge = moves[0]?.edge ?? 'bottom';
    rec.edge = edge;
    const layer = this.host.sheets;
    let sheet: CSSStyleSheet | null = null;
    const css = (): string => {
      // Measured with the move removed, so a resize or zoom recomputes from the overlay's own place.
      const had = root.getAttribute(ATTR);
      if (had) root.removeAttribute(ATTR);
      const r = visualRect(root) ?? vr;
      if (had) root.setAttribute(ATTR, had);
      const v = viewport();
      const gap = 16;
      // Rects are in viewport px; `translate` is in the overlay's own CSS px, which the page column zooms.
      const cz = (root as Element & { currentCSSZoom?: number }).currentCSSZoom;
      const u = typeof cz === 'number' && cz > 0 && Number.isFinite(cz) ? cz : 1;
      const t = edge === 'bottom' ? `0 ${px((v.vh - r.t + gap) / u)}px`
        : edge === 'top' ? `0 ${-px((r.b + gap) / u)}px`
          : edge === 'right' ? `${px((v.vw - r.l + gap) / u)}px 0` : `${-px((r.r + gap) / u)}px 0`;
      const sel = `[${ATTR}="${value}"][${ATTR}="${value}"]`;
      return `${sel} { translate: ${t} !important; transition: none !important; }\n${sel}:focus-within { translate: none !important; }`;
    };
    const op: Op = {
      rec: makeOpRecord('unobstruct', 'element', [root], `${mode === 'dock' ? 'docked' : 'tucked'} ${NOUN[rec.kind]} toward the ${edge} edge`, (el) => this.host.ensureId(el)),
      elements: [root],
      risk: 1,
      active: false,
      persistent: false,
      source,
      title,
      detail,
      ...(p !== undefined ? { p } : {}),
      apply: () => {
        if (!root.isConnected) return;
        const text = css();
        if (!sheet) sheet = layer.make(text);
        else sheet.replaceSync(text);
        layer.attach(sheet);
        root.setAttribute(ATTR, value);
        op.active = true;
      },
      revert: () => {
        root.removeAttribute(ATTR);
        if (sheet) layer.detach(sheet);
        op.active = false;
      },
    };
    (op as Op & { refresh?: () => void }).refresh = () => {
      if (op.active && sheet && root.isConnected) sheet.replaceSync(css());
    };
    return op;
  }

  private async dock(rec: Rec, item: { facts: OverlayFacts }): Promise<void> {
    const root = rec.root;
    const choices: OverlayChoice[] = Array.from(root.querySelectorAll(CHOICE_BUTTONS))
      .filter((b) => visible(b) && !(b as HTMLButtonElement).disabled)
      .slice(0, 4)
      .map((b) => {
        const name = collapse(accessibleName(b)).slice(0, 48);
        return { id: this.host.ensureId(b), label: !name || /^[×x✕✖]$/i.test(name) ? 'Close' : name };
      });
    if (choices.length < 1) return;
    const before = item.facts.coverage;
    const op = this.moveOp(rec, 'dock', `Moved the cookie notice into a short bar (it covered ${pct(before)} of the screen)`,
      `All ${choices.length} choices are in the bar. WebAble did not answer it.`, 'layout');
    if (!op) return;
    await this.host.lock(async () => {
      op.apply();
      this.host.addOp(op);
    });
    await this.frames();
    rec.op = op;
    this.bump(rec);
    const { vh } = viewport();
    const after = Math.min(1, this.coverageNow(root) + CONSENT_BAR_PX / Math.max(1, vh));
    this.setView(rec, 'docked', before, after, `All ${choices.length} choices are in the bar. WebAble did not answer it.`, 'consent', { choices, name: 'Cookie notice' });
    this.host.log({ source: 'layout', title: op.title, detail: op.detail, action: 'applied', opId: op.rec.id });
  }

  private async tuck(
    rec: Rec, item: { facts: OverlayFacts; jev: { reason: string } }, why: string, fromChat?: string, pressed = false,
  ): Promise<void> {
    // Never move the site's own header off screen: a layer that holds its navigation, banner or search (an ad slot
    // inside a pinned header says "Ad Feedback" on cnn.com) at most scrolls away with the page.
    if (rec.kind !== 'chat' && rec.root.querySelector('nav, [role="navigation"], [role="banner"], [role="search"], header')) {
      rec.kind = 'header';
      if (item.facts.edge === 'top') await this.unpin(rec, item, 'it holds the site\'s header');
      return;
    }
    const before = item.facts.coverage;
    const ad = rec.kind === 'promo_bar' && item.facts.advertising >= 0.9;
    const noun = ad ? 'ad bar' : NOUN[rec.kind];
    const jevDriven = !fromChat && !!item.jev.reason;
    const title = rec.kind === 'chat'
      ? `Tucked away the chat window that opened by itself (it covered ${pct(before)} of the screen)`
      : rec.kind === 'promo_bar'
        ? `Tucked away the ${noun} pinned to the ${item.facts.edge === 'top' ? 'top' : 'bottom'} of the screen (it covered ${pct(before)})`
        : `Tucked away the ${noun} that floated over the page`;
    const own = collapse((item as { cls?: { name?: string } }).cls?.name ?? '');
    const chip = ad ? 'Ad' : rec.kind === 'other' && own && own.length <= 20 ? own : NAME[rec.kind];
    const lead = fromChat ? `${fromChat[0]?.toUpperCase() ?? ''}${fromChat.slice(1)}` : '';
    const detail = rec.kind === 'chat'
      ? `${lead ? `${lead}, so WebAble ${pressed ? 'tucked it away as well' : 'did not press anything'}. ` : ''}The “Chat · Open” chip brings it back.`
      : `${why}. The “${chip} · Show” chip brings it back.`;
    const op = this.moveOp(rec, 'tuck', title, detail, jevDriven ? 'jev' : 'layout');
    if (!op) return;
    await this.host.lock(async () => {
      op.apply();
      this.host.addOp(op);
    });
    await this.frames();
    rec.op = op;
    this.bump(rec);
    this.setView(rec, 'tucked', before, this.coverageNow(rec.root), detail, rec.kind, { name: chip });
    this.host.log({ source: op.source, title, detail: jevDriven ? why : detail, action: 'applied', opId: op.rec.id });
  }

  private async unpin(rec: Rec, item: { facts: OverlayFacts }, reason: string): Promise<void> {
    const root = rec.root;
    if (root.closest('[data-wa-unpin]')) return; // the fit's own unpin already let it scroll away
    const cs = getComputedStyle(root);
    const bottom = item.facts.edge === 'bottom';
    if (bottom) return;
    const value = cs.position === 'fixed' ? 'f' : 's';
    const layer = this.host.sheets;
    const sheet = layer.make(`[${UNPIN_ATTR}="s"][${UNPIN_ATTR}="s"] { position: relative !important; top: auto !important; }
[${UNPIN_ATTR}="f"][${UNPIN_ATTR}="f"] { position: absolute !important; }`);
    const before = item.facts.coverage;
    const title = `Let the ${NOUN[rec.kind]} scroll away (${reason})`;
    const op: Op = {
      rec: makeOpRecord('unobstruct', 'element', [root], `unpinned ${NOUN[rec.kind]}`, (el) => this.host.ensureId(el)),
      elements: [root], risk: 2, active: false, persistent: false, source: 'layout', title,
      detail: 'It stays at the top of the page and scrolls away with it.',
      apply: () => {
        root.setAttribute(UNPIN_ATTR, value);
        layer.attach(sheet);
        op.active = true;
      },
      revert: () => {
        root.removeAttribute(UNPIN_ATTR);
        layer.detach(sheet);
        op.active = false;
      },
    };
    await this.host.lock(async () => {
      op.apply();
      this.host.addOp(op);
    });
    rec.op = op;
    this.bump(rec);
    this.setView(rec, 'unpinned', before, before, op.detail ?? '');
    this.host.log({ source: 'layout', title, detail: op.detail, action: 'applied', opId: op.rec.id });
  }

  /* ---------------- Jev: the overlay's own close control ---------------- */

  private candidates(root: Element, box: Rect): Array<{ el: Element; ev: OverlayButtonEvidence }> {
    const list = Array.from(root.querySelectorAll(BUTTONS)).filter((b) => visible(b) && !(b as HTMLButtonElement).disabled);
    const scored = list.map((el, i) => {
      const r = el.getBoundingClientRect();
      const name = `${accessibleName(el)} ${classWordsOf(el).join(' ')}`;
      let s = 0;
      if (r.top - box.t < 0.3 * (box.b - box.t)) s += 2;
      if (box.r - r.right < 0.3 * (box.r - box.l)) s += 1;
      if (r.width <= 48 && r.height <= 48) s += 1;
      if (el.hasAttribute('aria-expanded')) s += 1;
      if (CLOSE_HINT.test(name)) s += 3;
      return { el, i, s };
    });
    scored.sort((a, b) => b.s - a.s || a.i - b.i);
    const top = scored.slice(0, 8).sort((a, b) => a.i - b.i);
    return top.map(({ el }) => {
      const r = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      const form = el.closest('form');
      const submit = (tag === 'button' && (type === 'submit' || (type === '' && !!form))) || (tag === 'input' && type === 'submit');
      const ev: OverlayButtonEvidence = {
        id: this.host.ensureId(el),
        tag,
        label: safeUiLabel(accessibleName(el), 12),
        visible_text: safeUiLabel(visibleTextOf(el, 80), 8),
        position_in_overlay: placeInOverlay(el, box),
        size: `${px(r.width)} x ${px(r.height)} px`,
        class_words: safeClassWords(classWordsOf(el)),
      };
      if (tag === 'a') {
        const lt = linkTargetOf(el);
        if (lt) ev.link_target = lt;
      }
      if (submit) ev.form_submit = true;
      const exp = el.getAttribute('aria-expanded');
      if (exp === 'true' || exp === 'false') ev.aria_expanded = exp === 'true';
      return { el, ev };
    });
  }

  private evidence(rec: Rec, box: Rect, coverage: number, selfOpened: boolean, name: string): OverlayEvidence {
    const { vw, vh } = viewport();
    const iframe = rec.root.querySelector('iframe');
    const ev: OverlayEvidence = {
      id: rec.key,
      kind_hint: rec.kind,
      label: safeUiLabel(name || accessibleName(rec.root), 10),
      position: positionPhrase(box, vw, vh),
      size: `${px(box.r - box.l)} x ${px(box.b - box.t)} px, covers ${pct(coverage)} of the screen`,
      opened_by_itself: selfOpened,
      class_words: safeClassWords(classWordsOf(rec.root)),
    };
    if (iframe) ev.iframe_kind = iframeKindOf(iframe.getAttribute('src') ?? '');
    return ev;
  }

  private async askClose(rec: Rec, item: { box: Rect; facts: OverlayFacts; cls: { name: string } }): Promise<{ result: OverlayCloseResult | null; el: Element | null; refusal: string }> {
    if (rec.kind === 'consent') return { result: null, el: null, refusal: 'consent notices are never closed' };
    const cands = this.candidates(rec.root, item.box);
    if (!cands.length) return { result: null, el: null, refusal: 'it has no buttons' };
    const overlay = this.evidence(rec, item.box, item.facts.coverage, item.facts.selfOpened, item.cls.name);
    rec.asking = true;
    let result: OverlayCloseResult | null = null;
    try {
      result = await this.host.ask<OverlayCloseResult>({ type: 'overlayClose', overlay, candidates: cands.map((c) => c.ev) });
    } catch {
      result = null;
    } finally {
      rec.asking = false;
    }
    if (!result || typeof result.accept !== 'boolean') return { result: null, el: null, refusal: 'Jev could not be asked' };
    rec.closeResult = result;
    const refusal = closeRefusal(result, cands.map((c) => c.ev)) ?? '';
    const pick = result.accept ? cands.find((c) => c.ev.id === result?.pick)?.el ?? null : null;
    rec.closeEl = pick;
    return { result, el: pick, refusal };
  }

  private async minimise(rec: Rec, item: { root: Element; box: Rect; facts: OverlayFacts; cls: { name: string }; jev: { reason: string } }): Promise<void> {
    const { result, el, refusal } = await this.askClose(rec, item);
    if (!rec.root.isConnected || rec.personDone || this.host.paused()) return;
    if (!result || !result.accept || !el) {
      await this.tuck(rec, item, '', refusal || 'Jev found no button that only minimises it');
      return;
    }
    // Still the same situation? (The person may have started using it while Jev answered.)
    if (this.touched(rec.root)) return;
    const label = collapse(accessibleName(el)) || collapse(visibleTextOf(el, 40)) || 'minimise';
    const jevP = Math.min(result.pFwd, result.pRev);
    const launcher = rec.launcher;
    let ok = false;
    let why = '';
    let after = item.facts.coverage;
    let pressed = false;
    await this.host.lock(async () => {
      const before = {
        focus: document.activeElement,
        sx: scrollX,
        sy: scrollY,
        url: location.href,
        area: this.coverageNow(rec.root),
      };
      if (this.host.isOurUi(before.focus)) {
        why = 'you were using WebAble';
        return;
      }
      pressed = true;
      (el as HTMLElement).click();
      const t0 = performance.now();
      while (performance.now() - t0 < VERIFY_MS) {
        await sleep(100);
        // A site that moves focus to its chat button while the person was in the page: put focus back where it was.
        const a = document.activeElement;
        if (a !== before.focus && before.focus && before.focus !== document.body && before.focus.isConnected
          && !rec.root.contains(before.focus) && a && rec.root.contains(a)) {
          (before.focus as HTMLElement).focus?.({ preventScroll: true });
        }
        const area = this.coverageNow(rec.root);
        const shrank = before.area <= 0 ? area <= 0 : area <= 0.2 * before.area;
        const launcherShows = launcher ? visible(launcher) : !!visualRect(rec.root);
        const now = document.activeElement;
        const focusOk = now === before.focus
          || ((before.focus === document.body || before.focus === null) && (!now || now === document.body || rec.root.contains(now)));
        const scrollOk = Math.abs(scrollX - before.sx) <= 2 && Math.abs(scrollY - before.sy) <= 2;
        const urlOk = location.href === before.url;
        after = area;
        why = !shrank ? 'the window did not get smaller' : !launcherShows ? 'its chat button did not show' : !focusOk ? 'focus moved' : !scrollOk ? 'the page scrolled' : !urlOk ? 'the address changed' : '';
        if (!why) {
          ok = true;
          break;
        }
        if (!urlOk || !scrollOk) break;
      }
    });
    if (!ok) {
      if (!pressed) return; // nothing pressed; the next scan decides again
      await this.tuck(rec, item, '', `WebAble pressed its own “${label}” button, but the check failed (${why})`, true);
      return;
    }
    const title = `Minimised the chat window that opened by itself (it covered ${pct(item.facts.coverage)} of the screen)`;
    const detail = `Used its own “${label}” button (Jev ${p2(jevP)}); its chat button stays.`;
    const op: Op = {
      rec: makeOpRecord('unobstruct', 'element', [rec.root], `minimised with the site's own button (Jev ${p2(result.pFwd)} / ${p2(result.pRev)}, side effect ${p2(result.sideEffect)})`, (x) => this.host.ensureId(x)),
      elements: [rec.root], risk: 0, active: true, persistent: true, source: 'jev', title, detail, p: jevP,
      // The site's chat stays as the person last saw it when WebAble's changes are switched off or on.
      apply: () => {
        op.active = true;
      },
      revert: () => {
        op.active = false;
      },
      undo: () => {
        op.active = false;
        if (launcher && launcher.isConnected && visible(launcher)) (launcher as HTMLElement).click();
      },
    };
    this.host.addOp(op);
    rec.op = op;
    this.bump(rec);
    this.setView(rec, 'minimised', item.facts.coverage, after, detail);
    this.host.log({ source: 'jev', title, detail, p: jevP, action: 'applied', opId: op.rec.id });
    if (!this.host.quiet()) this.host.toast('Minimised the chat that opened by itself.', op.rec.id);
  }

  private async offerClose(rec: Rec, item: { root: Element; box: Rect; facts: OverlayFacts; cls: { name: string }; jev: { reason: string } }): Promise<void> {
    if (rec.logged.has('offer')) return;
    rec.logged.add('offer');
    const { result, el, refusal } = await this.askClose(rec, item);
    if (!rec.root.isConnected) return;
    const what = rec.kind === 'newsletter' ? 'A signup popup' : rec.kind === 'survey' ? 'A survey popup' : 'A popup';
    if (!result || !result.accept || !el) {
      this.host.log({ source: 'jev', title: `${what} covers this page; WebAble left it as it is`, detail: refusal || undefined, action: 'kept' });
      this.setView(rec, 'left', item.facts.coverage, item.facts.coverage, refusal || 'Left as it is.');
      return;
    }
    const label = collapse(visibleTextOf(el, 20)) || collapse(accessibleName(el)) || 'close';
    const question = `${what} covers this page. Close it with its own ${label.length <= 3 ? `${label} ` : `“${label}” `}button?`;
    this.setView(rec, 'offered', item.facts.coverage, item.facts.coverage, `Jev ${p2(Math.min(result.pFwd, result.pRev))} that “${collapse(accessibleName(el)) || label}” only closes it.`, rec.kind, { question });
    this.host.log({ source: 'jev', title: question, detail: rec.view?.detail, p: Math.min(result.pFwd, result.pRev), action: 'offered' });
  }

  /* ---------------- the person's commands ---------------- */

  /** api.restoreOverlay: `id` (Undo / Show), `${id}#read` (this page view only), `${id}#close` (accept a close offer). */
  restore(cmd: string): void {
    const [id, verb] = cmd.split('#');
    const rec = [...this.recs.values()].find((r) => r.key === id);
    if (!rec) return;
    if (verb === 'close') {
      void this.acceptClose(rec);
      return;
    }
    const remember = verb !== 'read' && rec.kind !== 'consent';
    this.bringBack(rec, remember ? 'undo' : 'read');
  }

  /** The controller's undoOp for an unobstruct op. Returns true when this module handled it. */
  undo(opId: string): boolean {
    const rec = [...this.recs.values()].find((r) => r.op?.rec.id === opId);
    if (!rec) return false;
    this.bringBack(rec, 'undo');
    return true;
  }

  private bringBack(rec: Rec, how: 'undo' | 'read'): void {
    const op = rec.op;
    rec.personDone = true;
    if (op && op.rec.status === 'applied') {
      try {
        if (op.undo) void op.undo();
        else void op.revert();
      } catch {
        /* best effort */
      }
      op.rec.status = 'reversed';
      this.host.syncOps();
    }
    if (how === 'undo') this.rememberLeave(rec.kind);
    const noun = NOUN[rec.kind];
    const detail = how === 'undo'
      ? `WebAble will leave ${rec.kind === 'chat' ? 'chat windows' : `${noun}s`} on this site alone for 30 days.`
      : 'Back where the site put it.';
    const before = rec.view?.coverageBefore ?? rec.lastCoverage;
    this.setView(rec, 'left', before, before, detail);
    this.host.log({ source: 'person', title: how === 'undo' ? `Brought back the ${noun}` : `Showing the ${noun}`, detail, action: 'reversed', ...(op ? { opId: op.rec.id } : {}) });
    this.publish();
    this.updatePadding(new Map());
    if (rec.kind === 'consent') {
      // The bar's choices bring the notice back, then press the site's own button: say so once the site closes it.
      setTimeout(() => {
        if (rec.root.isConnected && visualRect(rec.root)) return;
        this.host.log({ source: 'person', title: 'You answered the cookie notice with the site’s own button', detail: 'WebAble only brought the notice back; the choice was yours.', action: 'kept' });
        rec.view = null;
        this.publish();
      }, 1500);
    }
  }

  private async acceptClose(rec: Rec): Promise<void> {
    const el = rec.closeEl;
    if (!el || !el.isConnected || rec.view?.action !== 'offered') return;
    rec.personDone = true;
    const before = this.coverageNow(rec.root);
    await this.host.lock(async () => {
      (el as HTMLElement).click();
      await sleep(300);
    });
    const after = this.coverageNow(rec.root);
    const ok = after <= 0.2 * Math.max(before, 0.0001) || !visualRect(rec.root);
    this.setView(rec, ok ? 'left' : 'offered', before, after, ok ? 'Closed with its own button, as you asked.' : 'Its button did not close it.');
    this.host.log({ source: 'person', title: ok ? `Closed the ${NOUN[rec.kind]} with its own button` : `The ${NOUN[rec.kind]}'s own button did not close it`, action: ok ? 'applied' : 'skipped' });
    this.publish();
  }

  /* ---------------- scroll padding for bars that stay pinned (WCAG C43) ---------------- */

  private updatePadding(cache: Map<Element, CSSStyleDeclaration>): void {
    const { vw, vh } = viewport();
    let top = 0;
    let bottom = 0;
    for (const rec of this.recs.values()) {
      const v = rec.view;
      if (v && v.action === 'docked' && !v.revealed) bottom = Math.max(bottom, CONSENT_BAR_PX + 8);
    }
    // Pinned full-width bars at the top that stay (sticky or fixed headers WebAble did not unpin).
    for (const el of Array.from(document.querySelectorAll('header, [role="banner"], nav, [class*="sticky" i], [class*="fixed" i]')).slice(0, 40)) {
      if (this.host.isOurUi(el) || el.closest(`[${ATTR}], [${UNPIN_ATTR}], [data-wa-unpin]`)) continue;
      const cs = this.style(el, cache);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 0.6 * Math.min(vw, pageFrame().width) || r.height < 16 || r.height > 0.4 * vh) continue;
      if (r.top <= 2 && r.bottom > 0) top = Math.max(top, r.bottom);
    }
    top = Math.round(top);
    bottom = Math.round(bottom);
    if (top === this.padding.top && bottom === this.padding.bottom) return;
    this.padding = { top, bottom };
    const css = top || bottom ? `html { ${top ? `scroll-padding-top: ${top + 8}px !important;` : ''} ${bottom ? `scroll-padding-bottom: ${bottom}px !important;` : ''} }` : '';
    if (!this.paddingOp) {
      if (!css) return;
      const layer = this.host.sheets;
      this.paddingSheet = layer.make(css);
      const sheet = this.paddingSheet;
      const op: Op = {
        rec: makeOpRecord('unobstruct', 'page', [], 'scroll padding for pinned bars (WCAG technique C43)', (el) => this.host.ensureId(el)),
        elements: [], risk: 0, active: false, persistent: false, source: 'layout',
        title: 'Things you move to with the keyboard scroll clear of pinned bars',
        apply: () => {
          layer.attach(sheet);
          op.active = true;
        },
        revert: () => {
          layer.detach(sheet);
          op.active = false;
        },
      };
      op.apply();
      this.paddingOp = op;
      this.host.addOp(op);
      return;
    }
    this.paddingSheet?.replaceSync(css || 'html {}');
  }

  /** Keep moved overlays fully off screen after a zoom or resize. */
  refresh(): void {
    for (const rec of this.recs.values()) {
      const op = rec.op as (Op & { refresh?: () => void }) | null;
      op?.refresh?.();
    }
  }

  private frames(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }
}
