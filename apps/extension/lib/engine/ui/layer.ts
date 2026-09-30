import type { OpId } from '@webable/core/ops/catalog';

import type { OverlayPort } from '../ops/types';
import { HOST_TAG } from '../util/dom';
import { inflate, intersection, type Box } from '../util/geometry';
import { glyph } from './icons';
import { layerCss } from './styles';

/**
 * WebAble's in-page layer (design-final.md 7.14, 7.17, 8): one closed shadow
 * root in a custom-tag host, fixed, at the maximum z-index.
 *   - Never takes focus: controls are tabindex -1; the focus-layer command
 *     moves focus in, Esc (or a Tab past either end) returns it.
 *   - pointer-events: none everywhere except the chip and toast controls.
 *   - Mounted lazily and removed when empty.
 *   - Decorative parts (outlines, guide, frozen frames) are aria-hidden; one
 *     visually hidden status line speaks for the chip and the toast.
 */

export interface OfferView {
  op: OpId;
  question: string;
  reason: string;
  /** Spoken summary: "WebAble suggests bigger click targets here." */
  spoken: string;
}

export interface ToastView {
  /** WebAble's action, one line: "WebAble set text to 18 px here." */
  message: string;
  /** 'one': [Undo] for the single change; 'all': [Undo all]. */
  undo: 'one' | 'all';
}

export interface OutlineItem {
  /** The original box (targets only), drawn dashed inside the fit outline. */
  ghost: Box | null;
  fit: Box;
}

/** One change's outlines, in document coordinates, most important first. */
export interface OutlineGroup {
  items: OutlineItem[];
  /** Tint the fit box (targets); text blocks get the outline only. */
  fill: boolean;
  /** Fit-mark tag; for text ops the only place "before" is shown. */
  tag?: { label: string; before: string; after: string };
}

export interface LayerConfig {
  reduceMotion: boolean;
  shortcuts: { focusLayer: string; undoAll: string };
}

export interface LayerEvents {
  offerAnswer(op: OpId, answer: 'accept' | 'dismiss' | 'timeout'): void;
  toastUndo(all: boolean): void;
}

export const OFFER_TIMEOUT_MS = 20_000;
/** Outlines sit this far outside the element, so strokes never cross its glyphs. */
const FIT_OUTSET = 4;
/** At most this many outlines per change in the viewport. */
const MAX_OUTLINES = 3;

const TYPING_MS = 2000;
const SCROLL_MS = 800;
const POLL_MS = 400;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A number, a space (normally a no-break space), and a word unit. */
const MEASURE = /^(-?\d+(?:[.,]\d+)?)[\u00a0 ](\S.*)$/;

/** Split "13 px" / "18 px" into "13" -> "18 px" when both share a unit. */
export function fitParts(
  before: string,
  after: string,
): { before: string; after: string } {
  const b = MEASURE.exec(before);
  const a = MEASURE.exec(after);
  if (b?.[1] && a && b[2] === a[2]) return { before: b[1], after };
  return { before, after };
}

/** Spoken form of a fit mark: "13 to 18 pixels". */
export function fitSpoken(before: string, after: string): string {
  const p = fitParts(before, after);
  return `${p.before} to ${p.after}`
    .replace(/\u00a0px\b/g, ' pixels')
    .replace(/\u00a0ms\b/g, ' milliseconds')
    .replace(/\u00a0/g, ' ');
}

/** The WebAble mark (design-final.md 11.3), cropped to the glyph: 16 px, stroke 1.5. */
function markGlyph(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '5 4 14 15');
  svg.setAttribute('width', String((16 * 14) / 15));
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M6 8h12M6 5v6M18 5v6M6 14h12M6 18h8');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(path);
  return svg;
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement)
    return !el.readOnly && !NON_TEXT_INPUTS.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * When the person is typing, dragging or scrolling, a chip would interrupt.
 * Timestamps only: no key values, positions or targets are kept.
 */
class InputActivity {
  private lastKey = -Infinity;
  private lastScroll = -Infinity;
  private down: { x: number; y: number } | null = null;
  private dragging = false;
  private readonly off: Array<() => void> = [];

  constructor(private readonly doc: Document) {
    const view = doc.defaultView;
    if (!view) return;
    const opts = { capture: true, passive: true } as const;
    const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
    ): void => {
      view.addEventListener(type, fn, opts);
      this.off.push(() => view.removeEventListener(type, fn, true));
    };
    on('keydown', (e) => {
      // Characters and deletions are typing; Tab, arrows and shortcuts are not.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.key.length === 1 ||
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        e.key === 'Process' ||
        e.key === 'Dead'
      )
        this.lastKey = Date.now();
    });
    on('scroll', () => {
      this.lastScroll = Date.now();
    });
    on('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY };
      this.dragging = false;
    });
    on('pointermove', (e) => {
      if (!this.down || this.dragging || e.buttons === 0) return;
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4)
        this.dragging = true;
    });
    const up = (): void => {
      if (this.dragging) this.lastScroll = Date.now();
      this.down = null;
      this.dragging = false;
    };
    on('pointerup', up);
    on('pointercancel', up);
  }

  /** Milliseconds until the person is idle; 0 when a chip may show now. */
  busyFor(now = Date.now()): number {
    if (this.dragging) return POLL_MS;
    let a: Element | null = this.doc.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    if (isEditable(a)) return POLL_MS;
    return Math.max(
      0,
      this.lastKey + TYPING_MS - now,
      this.lastScroll + SCROLL_MS - now,
    );
  }

  dispose(): void {
    for (const off of this.off.splice(0)) off();
  }
}

type Timer = ReturnType<typeof setTimeout>;

export class InPageLayer implements OverlayPort {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private stack: HTMLElement | null = null;
  private live: HTMLElement | null = null;
  private liveRaf = 0;
  private chip: HTMLElement | null = null;
  private toast: HTMLElement | null = null;
  private marks: HTMLElement | null = null;
  private guide: HTMLElement | null = null;
  private frozen = new Map<HTMLImageElement, HTMLCanvasElement>();
  private offerOp: OpId | null = null;
  private pendingOffer: OfferView | null = null;
  private holdTimer: Timer | null = null;
  private activity: InputActivity | null;
  private offerTimer: Timer | null = null;
  private offerDeadline = 0;
  private offerRemaining = OFFER_TIMEOUT_MS;
  private returnFocus: Element | null = null;
  private outlines: OutlineGroup[] = [];
  private drawn = { fits: 0, ghosts: 0, tags: [] as string[] };
  private raf = 0;
  private guideX: number | null = null;
  private guideY: number | null = null;
  private guideLh = 24;
  private guideBand: { top: number; height: number } | null = null;
  private guideOff: (() => void) | null = null;
  private config: LayerConfig = {
    reduceMotion: false,
    shortcuts: { focusLayer: '', undoAll: '' },
  };
  private readonly listeners: Array<() => void> = [];

  constructor(
    private readonly doc: Document,
    private readonly events: LayerEvents,
  ) {
    this.activity = new InputActivity(doc);
  }

  /** WebAble's own reduce-motion setting and the shortcuts the layer announces. */
  configure(config: LayerConfig): void {
    this.config = {
      reduceMotion: config.reduceMotion,
      shortcuts: { ...config.shortcuts },
    };
    this.applyMotion();
  }

  private applyMotion(): void {
    if (!this.host) return;
    if (this.config.reduceMotion)
      this.host.setAttribute('data-motion', 'reduce');
    else this.host.removeAttribute('data-motion');
  }

  // ------------------------------------------------------------------ host

  private ensure(): ShadowRoot {
    if (this.root && this.host?.isConnected) return this.root;
    const host = this.doc.createElement(HOST_TAG);
    // Max z-index, not the top layer: a popover would become a focus navigation
    // scope and change the page's sequential focus order.
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');
    host.style.setProperty('z-index', '2147483600', 'important');
    const root = host.attachShadow({ mode: 'closed' });
    // A constructed sheet: not a <style> element, so page CSP style-src never blocks it.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(layerCss());
    root.adoptedStyleSheets = [sheet];
    // One persistent status line for the chip and the toast.
    const live = this.doc.createElement('div');
    live.className = 'wa-sr';
    live.setAttribute('role', 'status');
    const stack = this.doc.createElement('div');
    stack.className = 'wa-stack';
    root.append(live, stack);
    root.addEventListener('keydown', (e) => this.onKey(e as KeyboardEvent));
    this.doc.documentElement.append(host);
    const view = this.doc.defaultView;
    if (view) {
      const reflow = (): void => this.schedule();
      view.addEventListener('scroll', reflow, { passive: true, capture: true });
      view.addEventListener('resize', reflow, { passive: true });
      const onFocusIn = (): void => this.avoidFocus();
      this.doc.addEventListener('focusin', onFocusIn, {
        capture: true,
        passive: true,
      });
      this.listeners.push(
        () => view.removeEventListener('scroll', reflow, true),
        () => view.removeEventListener('resize', reflow),
        () => this.doc.removeEventListener('focusin', onFocusIn, true),
      );
    }
    this.host = host;
    this.root = root;
    this.stack = stack;
    this.live = live;
    this.applyMotion();
    return root;
  }

  /** Remove the host when nothing is shown. */
  private collapse(): void {
    if (this.chip || this.toast || this.marks || this.guide || this.frozen.size)
      return;
    this.teardownHost();
  }

  private teardownHost(): void {
    for (const off of this.listeners.splice(0)) off();
    this.guideOff?.();
    this.guideOff = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.liveRaf) cancelAnimationFrame(this.liveRaf);
    this.liveRaf = 0;
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.stack = null;
    this.live = null;
  }

  /** True when `el` is the layer's host (page-side identity check for tests and checks). */
  owns(el: Element | null): boolean {
    return el !== null && el === this.host;
  }

  /** Clear the status line, then set it on the next frame so it is announced again. */
  private say(text: string): void {
    const live = this.live;
    if (!live) return;
    live.textContent = '';
    if (this.liveRaf) cancelAnimationFrame(this.liveRaf);
    this.liveRaf = requestAnimationFrame(() => {
      this.liveRaf = 0;
      if (this.live === live) live.textContent = text;
    });
  }

  private withShortcut(text: string, key: string, action: string): string {
    return key ? `${text} Press ${key} to ${action}.` : text;
  }

  // ------------------------------------------------------------------ controls

  private button(
    label: string,
    variant: 'primary' | 'secondary' | 'inverse',
    onClick: () => void,
  ): HTMLButtonElement {
    const b = this.doc.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = `wa-btn wa-btn--${variant}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private closeButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = this.doc.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = 'wa-icon-btn';
    b.setAttribute('aria-label', label);
    b.append(glyph(this.doc, 'x', 20));
    b.addEventListener('click', onClick);
    return b;
  }

  private fitMark(before: string, after: string): HTMLElement {
    const parts = fitParts(before, after);
    const wrap = this.doc.createElement('span');
    wrap.className = 'wa-fitmark';
    const sr = this.doc.createElement('span');
    sr.className = 'wa-sr';
    sr.textContent = fitSpoken(before, after);
    const visual = this.doc.createElement('span');
    visual.setAttribute('aria-hidden', 'true');
    visual.className = 'wa-fitmark';
    const b = this.doc.createElement('span');
    b.className = 'wa-fitmark__before';
    b.textContent = parts.before;
    const a = this.doc.createElement('span');
    a.className = 'wa-fitmark__after';
    a.textContent = parts.after;
    visual.append(b, glyph(this.doc, 'fit', 12), a);
    wrap.append(sr, visual);
    return wrap;
  }

  // ------------------------------------------------------------------ offer chip

  /**
   * Show an offer once the person is idle: never while typing (focus in an
   * editable field, or a key in the last 2 s), dragging, or scrolling (last
   * 800 ms). The 20 s timeout starts when the chip appears.
   */
  showOffer(view: OfferView): void {
    this.hideOffer();
    this.pendingOffer = view;
    this.activity ??= new InputActivity(this.doc);
    this.showWhenIdle();
  }

  private showWhenIdle(): void {
    this.holdTimer = null;
    const view = this.pendingOffer;
    if (!view) return;
    const wait = this.activity?.busyFor() ?? 0;
    if (wait > 0) {
      this.holdTimer = setTimeout(
        () => this.showWhenIdle(),
        Math.max(50, wait),
      );
      return;
    }
    this.pendingOffer = null;
    this.renderOffer(view);
  }

  private renderOffer(view: OfferView): void {
    this.ensure();
    const chip = this.doc.createElement('section');
    chip.className = 'wa-chip';
    chip.setAttribute('role', 'region');
    chip.setAttribute('aria-label', 'Suggested by WebAble');
    // Source line: the region's name already says WebAble to screen readers.
    const src = this.doc.createElement('p');
    src.className = 'wa-chip__src';
    src.setAttribute('aria-hidden', 'true');
    src.append(markGlyph(this.doc), 'WebAble');
    const q = this.doc.createElement('p');
    q.className = 'wa-chip__q';
    q.textContent = view.question;
    const close = this.closeButton('Close', () => this.answer('dismiss'));
    close.classList.add('wa-chip__close');
    chip.append(src, q, close);
    if (view.reason) {
      const why = this.doc.createElement('p');
      why.className = 'wa-chip__why';
      why.textContent = view.reason;
      chip.append(why);
    }
    const actions = this.doc.createElement('div');
    actions.className = 'wa-chip__actions';
    actions.append(
      this.button('Try it', 'primary', () => this.answer('accept')),
      this.button('Not now', 'secondary', () => this.answer('dismiss')),
    );
    chip.append(actions);
    // Pause the 20 s timeout while the person is pointing at or inside the chip.
    chip.addEventListener('pointerenter', () => this.pauseOfferTimer());
    chip.addEventListener('pointerleave', () => this.resumeOfferTimer());
    chip.addEventListener('focusin', () => this.pauseOfferTimer());
    chip.addEventListener('focusout', () => this.resumeOfferTimer());
    this.chip = chip;
    this.offerOp = view.op;
    this.stack?.append(chip);
    this.offerRemaining = OFFER_TIMEOUT_MS;
    this.resumeOfferTimer();
    this.avoidFocus();
    this.say(
      this.withShortcut(
        view.spoken,
        this.config.shortcuts.focusLayer,
        'answer',
      ),
    );
  }

  /** The op the chip shows now (null while an offer waits for the person to be idle). */
  get offerShown(): OpId | null {
    return this.offerOp;
  }

  /** The op of an offer held until the person is idle. */
  get offerPending(): OpId | null {
    return this.pendingOffer?.op ?? null;
  }

  private pauseOfferTimer(): void {
    if (!this.offerTimer) return;
    clearTimeout(this.offerTimer);
    this.offerTimer = null;
    this.offerRemaining = Math.max(1000, this.offerDeadline - Date.now());
  }

  private resumeOfferTimer(): void {
    if (!this.chip || this.offerTimer) return;
    if (this.root && this.chip.contains(this.root.activeElement)) return;
    this.offerDeadline = Date.now() + this.offerRemaining;
    this.offerTimer = setTimeout(
      () => this.answer('timeout'),
      this.offerRemaining,
    );
  }

  private answer(a: 'accept' | 'dismiss' | 'timeout'): void {
    const op = this.offerOp;
    this.hideOffer();
    if (op) this.events.offerAnswer(op, a);
  }

  /** Remove the chip (or a held offer) without reporting an answer. */
  hideOffer(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.pendingOffer = null;
    if (this.offerTimer) clearTimeout(this.offerTimer);
    this.offerTimer = null;
    const hadFocus =
      this.chip &&
      this.root?.activeElement &&
      this.chip.contains(this.root.activeElement);
    this.chip?.remove();
    this.chip = null;
    this.offerOp = null;
    if (hadFocus) this.restoreFocus();
    this.collapse();
  }

  // ------------------------------------------------------------------ toast

  showToast(view: ToastView): void {
    this.hideToast();
    this.ensure();
    const toast = this.doc.createElement('div');
    toast.className = 'wa-toast';
    const msg = this.doc.createElement('p');
    msg.className = 'wa-toast__msg';
    msg.textContent = view.message;
    const all = view.undo === 'all';
    toast.append(
      glyph(this.doc, 'check', 20, 'wa-toast__check'),
      msg,
      this.button(all ? 'Undo all' : 'Undo', 'inverse', () => {
        this.hideToast();
        this.events.toastUndo(all);
      }),
      this.closeButton('Close', () => this.hideToast()),
    );
    this.toast = toast;
    // The toast sits above the chip when both are shown.
    this.stack?.prepend(toast);
    this.say(
      this.withShortcut(view.message, this.config.shortcuts.undoAll, 'undo'),
    );
  }

  hideToast(): void {
    const hadFocus =
      this.toast &&
      this.root?.activeElement &&
      this.toast.contains(this.root.activeElement);
    this.toast?.remove();
    this.toast = null;
    if (hadFocus) this.restoreFocus();
    this.collapse();
  }

  // ------------------------------------------------------------------ focus

  /** The focus-layer command: move focus into the layer. Returns false when empty. */
  focusLayer(): boolean {
    const target =
      this.chip?.querySelector<HTMLElement>('.wa-btn') ??
      this.toast?.querySelector<HTMLElement>('.wa-btn');
    if (!target) return false;
    const active = this.deepActive();
    if (active && !this.owns(active)) this.returnFocus = active;
    target.focus();
    return true;
  }

  private deepActive(): Element | null {
    let a: Element | null = this.doc.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  /** Give focus back to the page: where it was, or nowhere when it was nowhere. */
  private restoreFocus(): void {
    const el = this.returnFocus as HTMLElement | null;
    this.returnFocus = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
    else (this.root?.activeElement as HTMLElement | null)?.blur();
  }

  private controls(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const surface of [this.toast, this.chip]) {
      if (surface) out.push(...surface.querySelectorAll<HTMLElement>('button'));
    }
    return out;
  }

  /** Keyboard inside WebAble's own layer only; the page's keys are never touched. */
  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.restoreFocus();
      return;
    }
    if (e.key === 'Tab') {
      const list = this.controls();
      const i = list.indexOf(this.root?.activeElement as HTMLElement);
      if (i < 0 || list.length === 0) return;
      e.preventDefault();
      const next = list[i + (e.shiftKey ? -1 : 1)];
      // Past either end, focus goes back to the page; the layer never traps it.
      if (next) next.focus();
      else this.restoreFocus();
    }
  }

  /** Never cover focused content: move the stack to another corner if needed. */
  private avoidFocus(): void {
    const stack = this.stack;
    if (!stack || (!this.chip && !this.toast)) return;
    const active = this.doc.activeElement;
    if (!active || active === this.doc.body || this.owns(active)) {
      stack.removeAttribute('data-side');
      return;
    }
    const a = active.getBoundingClientRect();
    for (const side of [null, 'left', 'top'] as const) {
      if (side) stack.setAttribute('data-side', side);
      else stack.removeAttribute('data-side');
      if (intersection(a, stack.getBoundingClientRect()) === 0) return;
    }
  }

  // ------------------------------------------------------------------ show on page

  showOutlines(groups: OutlineGroup[]): void {
    this.hideOutlines();
    const root = this.ensure();
    const marks = this.doc.createElement('div');
    marks.className = 'wa-marks';
    marks.setAttribute('aria-hidden', 'true');
    root.append(marks);
    this.marks = marks;
    this.outlines = groups;
    this.drawOutlines();
  }

  hideOutlines(): void {
    this.marks?.remove();
    this.marks = null;
    this.outlines = [];
    this.drawn = { fits: 0, ghosts: 0, tags: [] };
    this.collapse();
  }

  /** Fit outlines drawn in the viewport now. */
  get outlinesShown(): number {
    return this.drawn.fits;
  }

  /**
   * Up to three outlines per change among the items in the viewport, each 4 px
   * outside its element; a dashed ghost only where a group supplies one. The
   * change's tag goes on its first outlined item.
   */
  private drawOutlines(): void {
    const marks = this.marks;
    const view = this.doc.defaultView;
    if (!marks || !view) return;
    marks.replaceChildren();
    const drawn = { fits: 0, ghosts: 0, tags: [] as string[] };
    const sx = view.scrollX;
    const sy = view.scrollY;
    const vw = view.innerWidth;
    const vh = view.innerHeight;
    const toView = (b: Box): Box => ({
      left: b.left - sx,
      top: b.top - sy,
      right: b.right - sx,
      bottom: b.bottom - sy,
    });
    const place = (el: HTMLElement, b: Box): void => {
      el.style.left = `${b.left}px`;
      el.style.top = `${b.top}px`;
      el.style.width = `${Math.max(0, b.right - b.left)}px`;
      el.style.height = `${Math.max(0, b.bottom - b.top)}px`;
    };
    const tags: Array<[NonNullable<OutlineGroup['tag']>, Box]> = [];
    for (const group of this.outlines) {
      let n = 0;
      let first: Box | null = null;
      for (const item of group.items) {
        if (n >= MAX_OUTLINES) break;
        const fit = inflate(toView(item.fit), FIT_OUTSET, FIT_OUTSET);
        if (
          fit.right <= 0 ||
          fit.left >= vw ||
          fit.bottom <= 0 ||
          fit.top >= vh
        )
          continue;
        n++;
        first ??= fit;
        if (item.ghost) {
          const g = this.doc.createElement('div');
          g.className = 'wa-ghost';
          place(g, toView(item.ghost));
          marks.append(g);
          drawn.ghosts++;
        }
        const f = this.doc.createElement('div');
        f.className = group.fill ? 'wa-fit wa-fit--fill' : 'wa-fit';
        place(f, fit);
        marks.append(f);
        drawn.fits++;
      }
      if (group.tag && first) tags.push([group.tag, first]);
    }
    // Tags last, so no outline crosses a label.
    const placed: Box[] = [];
    for (const [info, box] of tags) {
      const text = this.placeTag(marks, info, box, view, placed);
      if (text !== null) drawn.tags.push(text);
    }
    this.drawn = drawn;
  }

  /**
   * Above the box when there is 40 px of room, otherwise 6 px below, clamped
   * to the viewport. A tag that would cover page text (or another tag) tries
   * the other side, then is dropped. Returns the tag's text, or null.
   */
  private placeTag(
    marks: HTMLElement,
    info: NonNullable<OutlineGroup['tag']>,
    box: Box,
    view: Window,
    placed: Box[],
  ): string | null {
    const tag = this.doc.createElement('div');
    tag.className = 'wa-tag';
    const label = this.doc.createElement('span');
    label.className = 'wa-tag__label';
    label.textContent = info.label;
    tag.append(label, this.fitMark(info.before, info.after));
    tag.style.left = '0px';
    tag.style.top = '0px';
    tag.style.visibility = 'hidden';
    marks.append(tag);
    const r = tag.getBoundingClientRect();
    const w = r.width;
    const h = r.height;
    const left = Math.max(8, Math.min(box.left, view.innerWidth - w - 8));
    const below = box.bottom + 6;
    const tops = box.top >= 40 ? [box.top - h - 6, below] : [below];
    for (const t of tops) {
      const top = Math.max(8, Math.min(view.innerHeight - 40, t));
      const rect = { left, top, right: left + w, bottom: top + h };
      if (placed.some((p) => intersection(p, rect) > 0)) continue;
      if (this.coversText(rect)) continue;
      tag.style.left = `${left}px`;
      tag.style.top = `${top}px`;
      tag.style.visibility = '';
      placed.push(rect);
      return tag.textContent ?? '';
    }
    tag.remove();
    return null;
  }

  /** True when page text lies under `r` (viewport coordinates). */
  private coversText(r: Box): boolean {
    const seen = new Set<Element>();
    const range = this.doc.createRange();
    const w = r.right - r.left;
    for (const fx of [0.02, 0.25, 0.5, 0.75, 0.98]) {
      for (const y of [r.top + 2, (r.top + r.bottom) / 2, r.bottom - 2]) {
        const el = this.doc.elementFromPoint(r.left + w * fx, y);
        if (!el || seen.has(el) || this.owns(el)) continue;
        seen.add(el);
        for (const n of el.childNodes) {
          if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue;
          range.selectNodeContents(n);
          for (const b of range.getClientRects()) {
            if (
              b.right > r.left &&
              b.left < r.right &&
              b.bottom > r.top &&
              b.top < r.bottom
            )
              return true;
          }
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ reading guide

  setReadingGuide(on: boolean, lineHeightPx = 24): void {
    const view = this.doc.defaultView;
    if (!on) {
      this.guideOff?.();
      this.guideOff = null;
      this.guide?.remove();
      this.guide = null;
      this.guideX = null;
      this.guideY = null;
      this.guideBand = null;
      this.collapse();
      return;
    }
    const root = this.ensure();
    if (this.guide) return;
    this.guideLh = lineHeightPx;
    const guide = this.doc.createElement('div');
    guide.className = 'wa-guide';
    guide.setAttribute('aria-hidden', 'true');
    for (const cls of ['wa-shade wa-shade--top', 'wa-shade wa-shade--bottom']) {
      const d = this.doc.createElement('div');
      d.className = cls;
      guide.append(d);
    }
    root.append(guide);
    this.guide = guide;
    if (view) {
      const onMove = (e: PointerEvent): void => {
        this.guideX = e.clientX;
        this.guideY = e.clientY;
        this.schedule();
      };
      view.addEventListener('pointermove', onMove, {
        passive: true,
        capture: true,
      });
      this.guideOff = () =>
        view.removeEventListener('pointermove', onMove, true);
    }
    this.drawGuide();
  }

  /** The rendered line of text under a viewport point, or null. */
  private lineAt(x: number, y: number): { top: number; height: number } | null {
    const doc = this.doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    let node: Node | null = null;
    if (typeof doc.caretPositionFromPoint === 'function')
      node = doc.caretPositionFromPoint(x, y)?.offsetNode ?? null;
    else if (typeof doc.caretRangeFromPoint === 'function')
      node = doc.caretRangeFromPoint(x, y)?.startContainer ?? null;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const range = this.doc.createRange();
    range.selectNodeContents(node);
    let best: DOMRect | null = null;
    let dist = Infinity;
    for (const r of range.getClientRects()) {
      if (r.width <= 0 || r.height <= 0) continue;
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < dist) {
        dist = d;
        best = r;
      }
    }
    // The nearest caret can be far from the pointer (margins, gaps): not a line under it.
    if (!best || dist > best.height) return null;
    return { top: best.top, height: best.height };
  }

  private drawGuide(): void {
    const guide = this.guide;
    const view = this.doc.defaultView;
    if (!guide || !view) return;
    const x = this.guideX ?? view.innerWidth / 2;
    const y = this.guideY ?? view.innerHeight / 3;
    const line = this.lineAt(x, y);
    let band: { top: number; height: number };
    if (line) band = { top: line.top - 4, height: line.height + 8 };
    else if (this.guideBand)
      return; // no line under the pointer: stay put
    else {
      const height = Math.min(96, Math.max(28, Math.round(this.guideLh * 1.6)));
      band = { top: y - height / 2, height };
    }
    const prev = this.guideBand;
    if (
      prev &&
      Math.round(prev.top) === Math.round(band.top) &&
      Math.round(prev.height) === Math.round(band.height)
    )
      return; // same line: no redraw
    this.guideBand = band;
    const [shadeTop, shadeBottom] = [...guide.children] as HTMLElement[];
    if (!shadeTop || !shadeBottom) return;
    shadeTop.style.height = `${Math.max(0, band.top)}px`;
    shadeBottom.style.top = `${band.top + band.height}px`;
  }

  get guideShown(): boolean {
    return this.guide !== null;
  }

  // ------------------------------------------------------------------ frozen images

  freezeImages(images: readonly HTMLImageElement[]): () => void {
    if (images.length === 0) return () => undefined;
    const root = this.ensure();
    const mine: HTMLImageElement[] = [];
    for (const img of images) {
      if (this.frozen.has(img)) continue;
      const c = this.doc.createElement('canvas');
      c.className = 'wa-frozen';
      c.setAttribute('aria-hidden', 'true');
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
      try {
        // A cross-origin image taints the canvas, but tainted canvases still display.
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      } catch {
        continue; // not decodable: leave it (the image stays visible)
      }
      root.append(c);
      this.frozen.set(img, c);
      mine.push(img);
    }
    this.drawFrozen();
    return () => {
      for (const img of mine) {
        this.frozen.get(img)?.remove();
        this.frozen.delete(img);
      }
      this.collapse();
    };
  }

  unfreezeImage(img: HTMLImageElement): void {
    this.frozen.get(img)?.remove();
    this.frozen.delete(img);
    this.collapse();
  }

  private drawFrozen(): void {
    for (const [img, c] of this.frozen) {
      if (!img.isConnected) {
        c.style.display = 'none';
        continue;
      }
      const r = img.getBoundingClientRect();
      c.style.display = r.width > 0 ? 'block' : 'none';
      c.style.left = `${r.left}px`;
      c.style.top = `${r.top}px`;
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
  }

  // ------------------------------------------------------------------ frame loop

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.drawOutlines();
      this.drawGuide();
      this.drawFrozen();
      this.avoidFocus();
    });
  }

  /** Re-measure positioned overlays (after the page reflows). */
  refresh(): void {
    this.schedule();
  }

  /** Test and diagnostics view of what the layer shows (text and geometry only, no page data). */
  inspect(): {
    mounted: boolean;
    offer: {
      question: string;
      source: string;
      buttons: string[];
      tabIndexes: number[];
    } | null;
    offerPending: OpId | null;
    toast: { text: string; buttons: string[] } | null;
    outlines: number;
    ghosts: number;
    tags: string[];
    guide: boolean;
    guideBand: { top: number; height: number } | null;
    frozen: number;
    focusInside: boolean;
    live: string;
    motion: string | null;
  } {
    return {
      mounted: this.host?.isConnected ?? false,
      offer: this.chip
        ? {
            question: this.chip.querySelector('.wa-chip__q')?.textContent ?? '',
            source: this.chip.querySelector('.wa-chip__src')?.textContent ?? '',
            buttons: [...this.chip.querySelectorAll('button')].map(
              (b) => b.textContent || b.getAttribute('aria-label') || '',
            ),
            tabIndexes: [...this.chip.querySelectorAll('button')].map(
              (b) => b.tabIndex,
            ),
          }
        : null,
      offerPending: this.offerPending,
      toast: this.toast
        ? {
            text: this.toast.querySelector('.wa-toast__msg')?.textContent ?? '',
            buttons: [...this.toast.querySelectorAll('button')].map(
              (b) => b.textContent || b.getAttribute('aria-label') || '',
            ),
          }
        : null,
      outlines: this.drawn.fits,
      ghosts: this.drawn.ghosts,
      tags: [...this.drawn.tags],
      guide: this.guide !== null,
      guideBand: this.guide && this.guideBand ? { ...this.guideBand } : null,
      frozen: this.frozen.size,
      focusInside: this.root?.activeElement != null,
      live: this.live?.textContent ?? '',
      motion: this.host?.getAttribute('data-motion') ?? null,
    };
  }

  /** Test hook: press a layer control by its visible label. */
  press(label: string): boolean {
    for (const b of this.controls()) {
      if ((b.textContent || b.getAttribute('aria-label')) === label) {
        b.click();
        return true;
      }
    }
    return false;
  }

  destroy(): void {
    if (this.offerTimer) clearTimeout(this.offerTimer);
    this.offerTimer = null;
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.pendingOffer = null;
    this.activity?.dispose();
    this.activity = null;
    this.chip = null;
    this.toast = null;
    this.marks = null;
    this.guide = null;
    this.guideBand = null;
    this.frozen.clear();
    this.outlines = [];
    this.drawn = { fits: 0, ghosts: 0, tags: [] };
    this.offerOp = null;
    this.teardownHost();
  }
}
