// Round 11: text size on a phone. The one exception to "zoom carries size; CSS carries structure".
//
// On a phone, tab zoom makes the page lay out narrower and draws it bigger. Most sites stop getting narrower at about
// 320 CSS px, so past ~1.1-1.2x the page scrolls sideways and the zoom has to stop short of the person's size. Only
// there (a narrow screen, and a zoom the page's width capped) the rest of the way is a text map: every text size on
// the page times the same factor k, the page staying phone-width.
//
// Rules:
//  - uniform: each element that draws text gets its own computed font-size x k, its px line-height x k ('normal' and
//    numbers scale by themselves) and its px letter- and word-spacing x k. Every ratio between sizes (headings, body,
//    captions) stays as the site made it; nothing is pulled up to a target and nothing is set per element by need;
//  - read with the map lifted: sizes are the page's own computed values read while this sheet is disabled, then
//    pinned as px, so em, % and rem never compound (no child is scaled twice) and re-reading never runs away;
//  - a constructed sheet plus data-wa-tm tokens: the site's inline styles are never written, except an inline
//    `!important` size, which only an inline value can beat; that one is put back byte for byte;
//  - content added or changed later (a MutationObserver), a late stylesheet and a window resize are read again the
//    same way, so revealed and client-rendered text gets the same k; the engine's own writes are never re-read;
//  - never: WebAble's own UI (and the simplified page inside it), SVG and MathML text, icon-font glyphs, text that is
//    hidden by design in a box that does not clip it (scaling could show it), and a one-line form control whose fixed
//    box would cut its scaled text (its text is drawn by the browser inside, where no check can see it).
// The controller decides when (narrow screen, width-capped zoom), runs the same checks, and takes it off (one smaller
// fallback, then off) when a check fails.

import type { LedgerEntry } from '@webable/core';
import { makeOpRecord, type Op, type SheetLayer } from './tailor';

/** The text map runs only on screens narrower than this (screen px: CSS px x the tab's zoom). */
export const TEXT_SCALE_NARROW_PX = 600;
/** Below this factor nothing changes (the zoom presets are ~10-25% apart; a smaller text step is not worth a change). */
export const TEXT_SCALE_MIN = 1.08;
/** At most twice the page's own sizes on a phone: beyond that single words in headings stop fitting the width. */
export const TEXT_SCALE_MAX = 2;
/** Extra size trials when the planned zoom made a narrow page scroll sideways (each one is a real resize). */
export const WIDTH_TRIALS = 2;

const ATTR = 'data-wa-tm';
/** Specificity (0,4,0): above the site's rules and WebAble's own size and spacing tokens, so the map multiplies them. */
const REPEAT = 4;
/** Inputs whose text the person reads or types (submit/button/reset show their value as a label). */
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time', 'submit', 'button', 'reset']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'CANVAS', 'PICTURE', 'IMG', 'WEBABLE-UI']);
const SKIP_CLOSEST = 'svg, math, script, style, noscript, template, iframe, object, embed, webable-ui';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MATH_NS = 'http://www.w3.org/1998/Math/MathML';
const ICON_FONT = /icon|awesome|material symbols|material icons|glyph|fontello|ionicons|feather|remixicon|bootstrap-icons|dashicons/i;
/** Private-use glyphs only (an icon font drawn from a code point). */
const PUA_ONLY = /^[-\s]+$/;
const STYLE_SIZE = /font|line-height|letter-spacing|word-spacing/i;
const PROPS = ['font-size', 'line-height', 'letter-spacing', 'word-spacing'] as const;
/** A line of text needs about this many times its font size of height. */
const LINE_ROOM = 1.2;
const MAX_ELEMENTS = 12000;
/** A changed subtree this large (or <html>/<body>) is read again later and at most once a second. */
const BIG_SUBTREE = 2000;

/* ------------------------------------------------------------------ */
/* Pure planning                                                       */
/* ------------------------------------------------------------------ */

/** The text map is for narrow screens only: on wider screens zoom has the width to carry size by itself. */
export function textScaleGate(screenPx: number): boolean {
  return Number.isFinite(screenPx) && screenPx > 0 && screenPx < TEXT_SCALE_NARROW_PX;
}

/**
 * k for a page whose zoom the width stopped at `zoom` when the plan wanted `wantZoom`: the rest of the way, so body
 * text lands where the plan put it (body x zoom x k = body x wantZoom), capped at TEXT_SCALE_MAX. Null below
 * TEXT_SCALE_MIN.
 */
export function planTextScale(wantZoom: number, zoom: number, max = TEXT_SCALE_MAX): number | null {
  if (!(Number.isFinite(wantZoom) && wantZoom > 0 && Number.isFinite(zoom) && zoom > 0)) return null;
  const k = Math.min(max, wantZoom / zoom);
  if (!(k >= TEXT_SCALE_MIN)) return null;
  return Math.round(k * 100) / 100;
}

/** The one smaller try after a failed check: halfway between the page's own sizes and k. Null when too small to act. */
export function fallbackTextScale(k: number): number | null {
  const h = Math.round((1 + (k - 1) / 2) * 100) / 100;
  return h >= TEXT_SCALE_MIN && h < k ? h : null;
}

/**
 * The next zoom to try after the page scrolled sideways at `failedZoom`, from what was measured there: the page
 * needed `scrollW` CSS px, so the zoom that gives it that width is screen ÷ scrollW. The largest zoom on `ladder`
 * at or under that, below the failed zoom and above the person's own; null when there is none. Not linear guesses:
 * every step down is a new measurement (a page's minimum width depends on the width it is given).
 */
export function widthLimitedZoom(o: { screenPx: number; scrollW: number; failedZoom: number; own: number; ladder: readonly number[] }): number | null {
  if (!(o.screenPx > 0) || !(o.scrollW > 0)) return null;
  const maxZ = o.screenPx / o.scrollW;
  let best: number | null = null;
  for (const z of o.ladder) {
    if (z > o.own + 0.005 && z < o.failedZoom - 0.005 && z <= maxZ + 0.001 && (best === null || z > best)) best = z;
  }
  return best;
}

/** k as people read it: one decimal ("1.6"). */
export function scaleWords(k: number): string {
  return (Math.round(k * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

/* ------------------------------------------------------------------ */
/* The text map                                                        */
/* ------------------------------------------------------------------ */

/** An element's own sizes as the page sets them (CSS px), read with the map lifted. */
export interface TextBase {
  /** font-size */
  f: number;
  /** line-height when it is a length (null: 'normal', which follows the font by itself) */
  lh: number | null;
  /** letter-spacing and word-spacing when not zero / normal */
  ls: number | null;
  ws: number | null;
}

type Skip = 'zero' | 'icon' | 'hidden' | 'control';

interface Measured {
  base: TextBase;
  /** One-line control in a fixed box: the largest k whose text line still fits its box (Infinity: it grows). */
  maxK: number;
  /** The element sets a size inline with !important (only an inline value beats it). */
  inline: boolean;
}

interface InlinePin {
  /** The style attribute as the site left it (null: none). */
  orig: string | null;
  /** The attribute as WebAble wrote it. */
  ours: string;
  lifted: boolean;
}

export interface TextMapHost {
  isOurUi(el: Element): boolean;
  sheets: SheetLayer;
}

export interface TextMapStats {
  tokened: number;
  skipped: Record<Skip, number>;
  refreshes: number;
  /** ms of the last full set(). */
  setMs: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function hasDirectText(el: Element): boolean {
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && /\S/.test((c as Text).data)) return true;
  return false;
}

function directText(el: Element): string {
  let s = '';
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) s += (c as Text).data;
  return s;
}

function textControl(el: Element): 'multi' | 'single' | null {
  const t = el.tagName;
  if (t === 'TEXTAREA') return 'multi';
  if (t === 'SELECT') return (el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1 ? 'multi' : 'single';
  if (t === 'INPUT') {
    const type = ((el as HTMLInputElement).type || el.getAttribute('type') || 'text').toLowerCase();
    return TEXT_INPUTS.has(type) ? 'single' : null;
  }
  return null;
}

function pxOf(v: string): number | null {
  if (!/px$/.test(v)) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** The box's height is auto (it grows with its text), when the browser can say. */
function autoHeight(el: Element): boolean {
  try {
    const KV = (globalThis as { CSSKeywordValue?: typeof CSSKeywordValue }).CSSKeywordValue;
    const v = (el as HTMLElement).computedStyleMap?.().get('height');
    return !!KV && v instanceof KV && v.value === 'auto';
  } catch {
    return false;
  }
}

/**
 * The page's text sizes times one factor. One instance per page view; `set(k)` puts it on (or changes k), `clear()`
 * takes it off and leaves the page exactly as it was. `suspend(fn)` runs fn with the page's own sizes showing (the
 * engine's reader measures the page, never its own scaled text).
 */
export class TextMap {
  /** The factor on the page now (1: off). */
  scale = 1;
  /** The op whose effect is on the page (a newer op with another k takes it over). */
  owner: Op | null = null;
  readonly stats: TextMapStats = { tokened: 0, skipped: { zero: 0, icon: 0, hidden: 0, control: 0 }, refreshes: 0, setMs: 0 };
  private host: TextMapHost;
  private sheet: CSSStyleSheet | null = null;
  /** Holds transitions while the map is lifted for a read or written (see holdTransitions). */
  private still: CSSStyleSheet | null = null;
  private holds = 0;
  private attached = false;
  /** Base sizes -> bucket (one rule per bucket). */
  private buckets = new Map<string, number>();
  private bucketBase: TextBase[] = [];
  /** Element -> its bucket, or the reason it is left as it is. */
  private marks = new WeakMap<Element, number | Skip>();
  private measured = new WeakMap<Element, Measured>();
  private inline = new Map<Element, InlinePin>();
  private mo: MutationObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private linkTimer: ReturnType<typeof setTimeout> | null = null;
  private bigTimer: ReturnType<typeof setTimeout> | null = null;
  private bigAt = 0;

  constructor(host: TextMapHost) {
    this.host = host;
  }

  get active(): boolean {
    return this.attached && this.scale !== 1;
  }

  /* ---------------- which elements draw text ---------------- */

  private skipNode(el: Element): boolean {
    if (SKIP_TAGS.has(el.tagName) || el.namespaceURI === SVG_NS || el.namespaceURI === MATH_NS) return true;
    try {
      return this.host.isOurUi(el);
    } catch {
      return false;
    }
  }

  private inSkipped(el: Element): boolean {
    if (el.closest(SKIP_CLOSEST)) return true;
    try {
      return this.host.isOurUi(el);
    } catch {
      return false;
    }
  }

  /** Elements that draw text under `root` (default the body), in document order. Reads only. */
  candidates(root: Element | null = document.body, cap = MAX_ELEMENTS): Element[] {
    if (!root || !root.isConnected || this.inSkipped(root)) return [];
    const out: Element[] = [];
    const consider = (el: Element) => {
      if (el === document.documentElement) return; // the root's size is every rem: never touched
      if (hasDirectText(el) || textControl(el)) out.push(el);
    };
    consider(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (this.skipNode(n as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n && out.length < cap; n = walker.nextNode()) consider(n as Element);
    return out;
  }

  /* ---------------- reading the page's own sizes ---------------- */

  /** Take the map off for a synchronous read (no paint happens in between). */
  private lift(): void {
    if (!this.sheet || !this.attached) return;
    this.holdTransitions(true);
    this.sheet.disabled = true;
    for (const [el, pin] of this.inline) {
      if (el.getAttribute('style') !== pin.ours) continue;
      if (pin.orig === null) el.removeAttribute('style');
      else el.setAttribute('style', pin.orig);
      pin.lifted = true;
    }
  }

  private unlift(): void {
    if (!this.sheet || !this.attached) return;
    this.sheet.disabled = false;
    for (const [el, pin] of this.inline) {
      if (!pin.lifted) continue;
      el.setAttribute('style', pin.ours);
      pin.lifted = false;
    }
    this.holdTransitions(false);
  }

  /**
   * While the map is lifted for a read, no transition may start on the text it scales: a site's `transition: all`
   * (or WebAble's own motion op, which shortens every transition to a microsecond) would otherwise start one from the
   * scaled size, and WebKit then reports that start value, so the read comes back scaled and k would compound. The
   * style is flushed with transitions still held before they come back, so going back starts none either.
   */
  private holdTransitions(on: boolean): void {
    this.holds += on ? 1 : -1;
    if (this.holds < 0) this.holds = 0;
    if (on ? this.holds !== 1 : this.holds !== 0) return;
    try {
      if (on) {
        if (!this.still) {
          this.still = new CSSStyleSheet();
          // Any element whose size the map sets or inherits; id-level specificity beats the motion op's !important.
          this.still.replaceSync(`:is([${ATTR}], [${ATTR}] *):not(#wa-tm-still-a):not(#wa-tm-still-b) { transition: none !important; }`);
        }
        if (!document.adoptedStyleSheets.includes(this.still)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.still];
      } else if (this.still) {
        void document.documentElement.offsetWidth;
        const still = this.still;
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== still);
      }
    } catch {
      /* no constructed sheets: nothing to hold */
    }
  }

  /**
   * Run `fn` with the page's own sizes showing: the engine's reader measures the page with this, so the scaled text
   * never comes back as the page's body size.
   */
  suspend<T>(fn: () => T): T {
    if (!this.attached) return fn();
    const pending = this.mo?.takeRecords() ?? [];
    this.lift();
    try {
      return fn();
    } finally {
      this.unlift();
      this.mo?.takeRecords(); // our own inline writes
      if (pending.length) queueMicrotask(() => this.onRecords(pending));
    }
  }

  /** Style reads (map lifted), then layout reads (map on): which elements get which base sizes. */
  private measure(els: Element[]): Map<Element, Measured | Skip> {
    const out = new Map<Element, Measured | Skip>();
    const pending = this.mo?.takeRecords() ?? [];
    this.lift();
    try {
      for (const el of els) {
        const cs = getComputedStyle(el);
        const f = parseFloat(cs.fontSize);
        if (!(Number.isFinite(f) && f > 0)) {
          out.set(el, 'zero');
          continue;
        }
        if (ICON_FONT.test(cs.fontFamily) || (hasDirectText(el) && PUA_ONLY.test(directText(el)))) {
          out.set(el, 'icon');
          continue;
        }
        const lh = pxOf(cs.lineHeight);
        const ls = pxOf(cs.letterSpacing);
        const ws = pxOf(cs.wordSpacing);
        const st = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
        const inline = !!st && PROPS.some((p) => st.getPropertyPriority(p) === 'important');
        out.set(el, {
          base: { f, lh: lh !== null && lh > 0 ? lh : null, ls: ls !== null && Math.abs(ls) > 0.001 ? ls : null, ws: ws !== null && Math.abs(ws) > 0.001 ? ws : null },
          maxK: Infinity,
          inline,
        });
      }
    } finally {
      this.unlift();
      this.mo?.takeRecords();
      if (pending.length) queueMicrotask(() => this.onRecords(pending));
    }
    // Layout reads with the map on (what is drawn now).
    for (const [el, m] of out) {
      if (typeof m === 'string') continue;
      const r = el.getBoundingClientRect();
      const visible = typeof (el as HTMLElement).checkVisibility === 'function' ? (el as HTMLElement).checkVisibility() : r.width > 0;
      if (visible && r.width > 0 && (r.width <= 2 || r.height <= 2)) {
        // Hidden by design in a tiny box: scaled only when the box clips it (it then stays hidden).
        const cs = getComputedStyle(el);
        const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || (cs.clip && cs.clip !== 'auto') || (cs.clipPath && cs.clipPath !== 'none');
        if (!clips) {
          out.set(el, 'hidden');
          continue;
        }
      }
      if (textControl(el) === 'single' && !autoHeight(el)) {
        const room = (el as HTMLElement).clientHeight;
        if (room > 0) m.maxK = room / (m.base.f * LINE_ROOM);
      }
    }
    return out;
  }

  /* ---------------- writing ---------------- */

  private bucketOf(b: TextBase): number {
    const key = `${r2(b.f)}|${b.lh === null ? '' : r2(b.lh)}|${b.ls === null ? '' : r3(b.ls)}|${b.ws === null ? '' : r3(b.ws)}`;
    let i = this.buckets.get(key);
    if (i === undefined) {
      i = this.bucketBase.length;
      this.buckets.set(key, i);
      this.bucketBase.push({ f: r2(b.f), lh: b.lh === null ? null : r2(b.lh), ls: b.ls === null ? null : r3(b.ls), ws: b.ws === null ? null : r3(b.ws) });
    }
    return i;
  }

  /** The declarations for one base at the current k. */
  private decls(b: TextBase): Array<[string, string]> {
    const k = this.scale;
    const d: Array<[string, string]> = [['font-size', `${r2(b.f * k)}px`]];
    if (b.lh !== null) d.push(['line-height', `${r2(b.lh * k)}px`]);
    if (b.ls !== null) d.push(['letter-spacing', `${r3(b.ls * k)}px`]);
    if (b.ws !== null) d.push(['word-spacing', `${r3(b.ws * k)}px`]);
    return d;
  }

  private css(): string {
    return this.bucketBase
      .map((b, i) => `${`[${ATTR}="${i}"]`.repeat(REPEAT)} { ${this.decls(b).map(([p, v]) => `${p}: ${v} !important;`).join(' ')} }`)
      .join('\n');
  }

  private unmark(el: Element): void {
    if (el.hasAttribute(ATTR)) el.removeAttribute(ATTR);
    const pin = this.inline.get(el);
    if (pin) {
      this.unpin(el, pin);
      this.inline.delete(el);
    }
  }

  private unpin(el: Element, pin: InlinePin): void {
    const now = el.getAttribute('style');
    if (now === pin.ours || pin.lifted) {
      if (pin.orig === null) el.removeAttribute('style');
      else el.setAttribute('style', pin.orig);
    }
    // The site rewrote the attribute since: its new value stands (ours went with the rewrite).
  }

  private pin(el: Element, b: TextBase): void {
    const st = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
    if (!st) return;
    let pin = this.inline.get(el);
    if (pin) this.unpin(el, pin);
    const orig = el.getAttribute('style');
    for (const [p, v] of this.decls(b)) st.setProperty(p, v, 'important');
    pin = { orig, ours: el.getAttribute('style') ?? '', lifted: false };
    this.inline.set(el, pin);
  }

  /** Mark one measured element at the current k. Writes only what changed. */
  private place(el: Element, m: Measured | Skip): void {
    if (typeof m === 'string' || m.maxK < this.scale) {
      const why: Skip = typeof m === 'string' ? m : 'control';
      if (this.marks.get(el) !== why) {
        this.unmark(el);
        this.marks.set(el, why);
      }
      this.stats.skipped[why]++;
      return;
    }
    this.measured.set(el, m);
    const i = this.bucketOf(m.base);
    if (m.inline) {
      this.pin(el, m.base);
      if (el.hasAttribute(ATTR)) el.removeAttribute(ATTR);
    } else {
      const pin = this.inline.get(el);
      if (pin) {
        this.unpin(el, pin);
        this.inline.delete(el);
      }
      if (el.getAttribute(ATTR) !== String(i)) el.setAttribute(ATTR, String(i));
    }
    this.marks.set(el, i);
    this.stats.tokened++;
  }

  /**
   * Put the map on at factor k, or change k: every text element's own sizes are read again (with the map lifted),
   * so a change of k or of the window never compounds.
   */
  set(k: number): void {
    const t0 = performance.now();
    if (!(Number.isFinite(k) && k > 0)) return;
    if (!this.sheet) this.sheet = this.host.sheets.make('');
    this.scale = k;
    this.stats.tokened = 0;
    this.stats.skipped = { zero: 0, icon: 0, hidden: 0, control: 0 };
    // Text changes size at once: no transition animates it (and the checks never see it half way).
    this.holdTransitions(true);
    try {
      this.write(k);
    } finally {
      this.holdTransitions(false);
    }
    this.watch();
    this.mo?.takeRecords();
    this.stats.setMs = Math.round(performance.now() - t0);
  }

  private write(k: number): void {
    if (!this.sheet) return;
    const els = this.candidates();
    const measured = this.measure(els);
    const keep = new Set(els);
    for (const el of Array.from(document.querySelectorAll(`[${ATTR}]`))) if (!keep.has(el)) this.unmark(el);
    for (const [el, pin] of [...this.inline]) {
      if (!keep.has(el)) {
        this.unpin(el, pin);
        this.inline.delete(el);
      }
    }
    for (const [el, m] of measured) this.place(el, m);
    this.scale = k;
    this.sheet.replaceSync(this.css());
    if (!this.attached) {
      this.host.sheets.attach(this.sheet);
      this.attached = true;
    }
  }

  /** Take the map off: every token and inline value goes, the page's own styles are exactly as they were. */
  clear(): void {
    this.unwatch();
    // Back at once, like it came: the sheet goes while the tokens still hold transitions, then the tokens go.
    this.holdTransitions(true);
    try {
      if (this.sheet && this.attached) this.host.sheets.detach(this.sheet);
      this.attached = false;
      void document.documentElement.offsetWidth;
      for (const el of Array.from(document.querySelectorAll(`[${ATTR}]`))) el.removeAttribute(ATTR);
      for (const [el, pin] of this.inline) this.unpin(el, pin);
    } finally {
      this.holdTransitions(false);
    }
    this.inline.clear();
    this.buckets.clear();
    this.bucketBase = [];
    this.marks = new WeakMap();
    this.measured = new WeakMap();
    this.scale = 1;
    this.owner = null;
    if (this.sheet) this.sheet.replaceSync('');
  }

  /** Stop watching (the engine is going away); the caller reverts the op. */
  dispose(): void {
    this.unwatch();
  }

  /** Read these subtrees (and these single elements) again and mark what changed. */
  refresh(roots: Iterable<Element>, selves: Iterable<Element> = []): void {
    if (!this.attached || !this.sheet) return;
    const els = new Set<Element>();
    const within: Element[] = [];
    for (const root of roots) {
      if (!root.isConnected || els.size >= MAX_ELEMENTS) continue;
      for (const el of this.candidates(root, MAX_ELEMENTS - els.size)) els.add(el);
      within.push(root);
    }
    for (const el of selves) {
      if (!el.isConnected || els.has(el) || this.inSkipped(el)) continue;
      if (hasDirectText(el) || textControl(el)) els.add(el);
    }
    // Tokens under the roots on elements that no longer draw text go.
    for (const root of within) {
      if (root.hasAttribute(ATTR) && !els.has(root)) this.unmark(root);
      for (const el of Array.from(root.querySelectorAll(`[${ATTR}]`))) if (!els.has(el)) this.unmark(el);
    }
    if (!els.size) return;
    this.stats.refreshes++;
    const before = this.bucketBase.length;
    this.holdTransitions(true);
    try {
      const measured = this.measure([...els]);
      for (const [el, m] of measured) this.place(el, m);
      if (this.bucketBase.length !== before) this.sheet.replaceSync(this.css());
    } finally {
      this.holdTransitions(false);
    }
    this.mo?.takeRecords();
  }

  /* ---------------- watching for new and changed content ---------------- */

  private watch(): void {
    if (this.mo || typeof MutationObserver === 'undefined') return;
    this.mo = new MutationObserver((records) => this.onRecords(records));
    this.mo.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['class', 'style', 'data-wa-hs', 'data-wa-sp'],
    });
    window.addEventListener('resize', this.onResize, { passive: true });
  }

  private unwatch(): void {
    this.mo?.disconnect();
    this.mo = null;
    window.removeEventListener('resize', this.onResize);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    if (this.linkTimer) clearTimeout(this.linkTimer);
    if (this.bigTimer) clearTimeout(this.bigTimer);
    this.resizeTimer = null;
    this.linkTimer = null;
    this.bigTimer = null;
  }

  /** The window changed size (an orientation change, a zoom): the site's own sizes for the new width, times k. */
  private onResize = (): void => {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      if (this.attached) this.set(this.scale);
    }, 150);
  };

  private fullSoon(): void {
    if (this.linkTimer) clearTimeout(this.linkTimer);
    this.linkTimer = setTimeout(() => {
      this.linkTimer = null;
      if (this.attached && document.body) this.refresh([document.body]);
    }, 60);
  }

  private onRecords(records: MutationRecord[]): void {
    if (!this.attached) return;
    const roots = new Set<Element>();
    const selves = new Set<Element>();
    let full = false;
    for (const rec of records) {
      if (rec.type === 'childList') {
        for (const n of Array.from(rec.addedNodes)) {
          if (n.nodeType === 1) {
            const el = n as Element;
            if (el.tagName === 'STYLE' || (el.tagName === 'LINK' && /stylesheet/i.test(el.getAttribute('rel') ?? ''))) {
              // A late stylesheet can change any size: read the page again (a link once it has loaded).
              full = true;
              if (el.tagName === 'LINK') el.addEventListener('load', () => this.fullSoon(), { once: true });
              continue;
            }
            roots.add(el);
          } else if (n.nodeType === 3 && rec.target.nodeType === 1) selves.add(rec.target as Element);
        }
      } else if (rec.type === 'characterData') {
        const p = rec.target.parentElement;
        if (p?.tagName === 'STYLE') full = true;
        else if (p && this.marks.get(p) === undefined) selves.add(p);
      } else if (rec.type === 'attributes' && rec.target.nodeType === 1) {
        const el = rec.target as Element;
        if (rec.attributeName === 'style') {
          const now = el.getAttribute('style') ?? '';
          if (!STYLE_SIZE.test(now) && !STYLE_SIZE.test(rec.oldValue ?? '')) continue;
          // WebAble's own inline pin.
          const pin = this.inline.get(el);
          if (pin && now === pin.ours) continue;
        }
        roots.add(el);
      }
    }
    if (full) {
      this.fullSoon();
      return;
    }
    if (!roots.size && !selves.size) return;
    // A root inside another root is read with it.
    let top = [...roots].filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (roots.has(p)) return false;
      return true;
    });
    // A class or style change on the whole page (many sites toggle a class on <body> as it scrolls) would read every
    // text element again each time: those are read at most once a second, after the changes stop (sizes such a
    // change sets are rare; new content below is still read at once).
    const big = top.filter((el) => el === document.documentElement || el === document.body || el.getElementsByTagName('*').length > BIG_SUBTREE);
    if (big.length) {
      top = top.filter((el) => !big.includes(el));
      this.bigSoon();
    }
    if (top.length || selves.size) this.refresh(top, selves);
  }

  private bigSoon(): void {
    if (this.bigTimer) clearTimeout(this.bigTimer);
    const wait = Math.max(250, 1000 - (Date.now() - this.bigAt));
    this.bigTimer = setTimeout(() => {
      this.bigTimer = null;
      this.bigAt = Date.now();
      if (this.attached && document.body) this.refresh([document.body]);
    }, wait);
  }

  /**
   * After the map at k failed a check: the largest factor (to 0.01, at least `min`) at which `pass` holds. Measured,
   * not modelled: the page is laid out at trial factors and `pass` reads it, synchronously, so nothing is painted in
   * between (a page's width and what covers what do not grow linearly with its text: tables, pills, a title growing
   * under the button beside it). Null when even `min` fails. The map is left at k.
   */
  largestScale(k: number, pass: () => boolean, min = TEXT_SCALE_MIN): number | null {
    const sheet = this.sheet;
    if (!this.attached || !sheet || !(k > min)) return null;
    const at = (s: number): boolean => {
      this.scale = s;
      sheet.replaceSync(this.css());
      return pass();
    };
    let lo = min;
    let hi = k;
    this.holdTransitions(true);
    try {
      if (!at(lo)) return null;
      let best = lo;
      for (let i = 0; i < 8 && hi - lo > 0.011; i++) {
        const mid = Math.round(((lo + hi) / 2) * 100) / 100;
        if (mid <= lo || mid >= hi) break;
        if (at(mid)) {
          best = mid;
          lo = mid;
        } else hi = mid;
      }
      return best;
    } finally {
      this.scale = k;
      sheet.replaceSync(this.css());
      this.holdTransitions(false);
    }
  }

  /* ---------------- for tests and the ledger ---------------- */

  /** What the map sets on `el` now (null: not scaled), as [property, value] pairs. */
  valuesFor(el: Element): Array<[string, string]> | null {
    const i = this.marks.get(el);
    if (typeof i !== 'number') return null;
    const b = this.bucketBase[i];
    return b ? this.decls(b) : null;
  }

  /** Why `el` is left as it is, when it is. */
  skipOf(el: Element): Skip | null {
    const i = this.marks.get(el);
    return typeof i === 'string' ? i : null;
  }
}

/* ------------------------------------------------------------------ */
/* Text partly covered (an addition to the verifier for the map)       */
/* ------------------------------------------------------------------ */

/**
 * For each text element on screen: how many points along its lines (near both ends and the middle of each line) are
 * covered by something else. The verifier's occlusion test samples the middle of a line, so a title whose end runs
 * under a button next to it (as bigger text grows towards it) passes; this catches it. Compared before and after:
 * only new cover counts. Fixed and sticky layers cover the page by design (a scrolled header, a chat button) and
 * are left out unless the text is in the same layer. Points off screen cannot be tested and are skipped.
 */
export function textCover(els: readonly Element[], isOurUi: (el: Element) => boolean, only?: ReadonlyMap<Element, number>, cap = 500): Map<Element, number> {
  const de = document.documentElement;
  const vw = de.clientWidth || innerWidth;
  const vh = de.clientHeight || innerHeight;
  const out = new Map<Element, number>();
  const layers = new Map<Element, Element | null>();
  const layerOf = (start: Element): Element | null => {
    const path: Element[] = [];
    let found: Element | null = null;
    for (let n: Element | null = start; n && n !== document.body && n !== de; n = n.parentElement) {
      const known = layers.get(n);
      if (known !== undefined) {
        found = known;
        break;
      }
      path.push(n);
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') {
        found = n;
        break;
      }
    }
    for (const x of path) layers.set(x, found);
    return found;
  };
  // What a box clips its content to (its own and up to 8 boxes above it that hide overflow): text outside it is not
  // drawn, so nothing can cover it there (an icon button's hidden label running under the next button).
  const clipOf = (start: Element): { l: number; t: number; r: number; b: number } => {
    let box = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
    let d = 0;
    for (let n: Element | null = start; n && d < 9 && n !== document.body && n !== de; n = n.parentElement, d++) {
      const cs = getComputedStyle(n);
      const cx = cs.overflowX !== 'visible';
      const cy = cs.overflowY !== 'visible';
      if (!cx && !cy) continue;
      const b = n.getBoundingClientRect();
      box = {
        l: cx ? Math.max(box.l, b.left) : box.l, r: cx ? Math.min(box.r, b.right) : box.r,
        t: cy ? Math.max(box.t, b.top) : box.t, b: cy ? Math.min(box.b, b.bottom) : box.b,
      };
    }
    return box;
  };
  const range = document.createRange();
  for (const el of els) {
    if (out.size >= cap) break;
    if (only && !only.has(el)) continue;
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const clip = clipOf(el);
    if (clip.r - clip.l < 2 || clip.b - clip.t < 2) continue; // clipped away (a visually hidden label)
    const mine = layerOf(el);
    let covered = 0;
    let texts = 0;
    for (let c = el.firstChild; c && texts < 4; c = c.nextSibling) {
      if (c.nodeType !== 3 || !/\S/.test((c as Text).data)) continue;
      texts++;
      range.selectNodeContents(c);
      for (const lr of Array.from(range.getClientRects()).slice(0, 6)) {
        if (lr.width < 4 || lr.height < 4) continue;
        const y = lr.top + lr.height / 2;
        if (y < 0 || y >= vh || y < clip.t || y > clip.b) continue;
        for (const fx of [0.03, 0.5, 0.97]) {
          const x = lr.left + lr.width * fx;
          if (x < 0 || x >= vw || x < clip.l || x > clip.r) continue;
          const hit = document.elementFromPoint(x, y);
          if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
          let ours = false;
          try {
            ours = isOurUi(hit);
          } catch {
            /* treat as the page's */
          }
          if (ours) continue;
          const theirs = layerOf(hit);
          if (theirs && theirs !== mine) continue;
          covered++;
        }
      }
    }
    out.set(el, covered);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The op                                                              */
/* ------------------------------------------------------------------ */

export interface TextMapOpInfo {
  /** The tab's text zoom the map sits on (the zoom the width allows). */
  zoom: number;
  /** The zoom the plan wanted. */
  wantZoom: number;
  source: LedgerEntry['source'];
  /** The page's own body size (CSS px at 100%) and the person's size. */
  bodyPx: number;
  targetPx: number | null;
  idOf(el: Element): string;
}

function pct(z: number): string {
  return `${Math.round(z * 100)}%`;
}

/** The text map as an op (one per k): its Undo takes the map off; a newer op with another k takes over the page. */
export function textMapOp(tm: TextMap, k: number, info: TextMapOpInfo): Op {
  const els = tm.candidates();
  const shown = Math.round(info.bodyPx * info.zoom * k);
  const zoomWords = info.zoom > 1.005 ? `Zoom stops at ${pct(info.zoom)} here` : 'Zoom can’t go above 100% here';
  const op: Op = {
    rec: makeOpRecord('text_map', 'page', els, `every text size ×${k} at ${pct(info.zoom)} zoom (planned ${pct(info.wantZoom)}; a larger zoom scrolls sideways on this narrow screen)`, info.idOf),
    elements: els,
    risk: 6,
    active: false,
    persistent: true,
    source: info.source,
    title: `Made the text ${scaleWords(k)}× bigger; the page can’t get narrower on this phone`,
    detail: `${zoomWords}: at more, the page scrolls sideways. So every text size on the page is ${scaleWords(k)}× the site’s own, and headings, body text and captions keep their proportions. Body text is ${shown} px here${info.targetPx ? ` (your size is ${Math.round(info.targetPx)} px)` : ''}.`,
    apply() {
      tm.set(k);
      tm.owner = op;
      op.active = true;
    },
    revert() {
      if (tm.owner === op) tm.clear();
      op.active = false;
    },
  };
  return op;
}
