import type { OpId } from '@webable/core/ops/catalog';

import type { OverlayPort } from '../ops/types';
import { HOST_TAG } from '../util/dom';
import { intersection, type Box } from '../util/geometry';
import { glyph } from './icons';
import { layerCss } from './styles';

/**
 * WebAble's in-page layer (design-final.md 7.14, 7.17, 8): one closed shadow
 * root in a custom-tag host, fixed, at the maximum z-index.
 *   - Never takes focus: controls are tabindex -1; the focus-layer command
 *     moves focus in, Esc returns it to where it was.
 *   - pointer-events: none everywhere except the chip and toast controls.
 *   - Mounted lazily and removed when empty.
 *   - Decorative parts (outlines, guide, frozen frames) are aria-hidden.
 */

export interface OfferView {
  op: OpId;
  question: string;
  reason: string;
}

export interface ToastView {
  label: string;
  before: string;
  after: string;
  /** Additional changes applied with this one. */
  more: number;
}

export interface OutlineItem {
  ghost: Box | null;
  fit: Box;
  /** Fit-mark tag on the first item of each op. */
  tag?: { label: string; before: string; after: string };
}

export interface LayerEvents {
  offerAnswer(op: OpId, answer: 'accept' | 'dismiss' | 'timeout'): void;
  toastUndo(): void;
}

export const OFFER_TIMEOUT_MS = 20_000;

/** Split "13 px" / "18 px" into "13" -> "18 px" when both share a unit. */
export function fitParts(
  before: string,
  after: string,
): { before: string; after: string } {
  const unit = (s: string): string | null => {
    const i = s.indexOf('\u00a0');
    return i > 0 ? s.slice(i + 1) : null;
  };
  const ub = unit(before);
  if (ub !== null && ub === unit(after))
    return { before: before.slice(0, before.indexOf('\u00a0')), after };
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

type Timer = ReturnType<typeof setTimeout>;

export class InPageLayer implements OverlayPort {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private stack: HTMLElement | null = null;
  private chip: HTMLElement | null = null;
  private toast: HTMLElement | null = null;
  private marks: HTMLElement | null = null;
  private guide: HTMLElement | null = null;
  private frozen = new Map<HTMLImageElement, HTMLCanvasElement>();
  private offerOp: OpId | null = null;
  private offerTimer: Timer | null = null;
  private offerDeadline = 0;
  private offerRemaining = OFFER_TIMEOUT_MS;
  private returnFocus: Element | null = null;
  private outlines: OutlineItem[] = [];
  private raf = 0;
  private guideY: number | null = null;
  private guideLh = 24;
  private guideOff: (() => void) | null = null;
  private readonly listeners: Array<() => void> = [];

  constructor(
    private readonly doc: Document,
    private readonly events: LayerEvents,
  ) {}

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
    const stack = this.doc.createElement('div');
    stack.className = 'wa-stack';
    root.append(stack);
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
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.stack = null;
  }

  /** True when `el` is the layer's host (page-side identity check for tests and checks). */
  owns(el: Element | null): boolean {
    return el !== null && el === this.host;
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

  showOffer(view: OfferView): void {
    this.hideOffer();
    this.ensure();
    const chip = this.doc.createElement('section');
    chip.className = 'wa-chip';
    chip.setAttribute('role', 'region');
    chip.setAttribute('aria-label', 'Suggested by WebAble');
    const q = this.doc.createElement('p');
    q.className = 'wa-chip__q';
    q.textContent = view.question;
    const close = this.closeButton('Close', () => this.answer('dismiss'));
    close.classList.add('wa-chip__close');
    chip.append(q, close);
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
  }

  get offerShown(): OpId | null {
    return this.offerOp;
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

  hideOffer(): void {
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
    toast.setAttribute('role', 'status');
    const msg = this.doc.createElement('p');
    msg.className = 'wa-toast__msg';
    msg.append(`${view.label} `, this.fitMark(view.before, view.after));
    if (view.more > 0) {
      const more = this.doc.createElement('span');
      more.className = 'wa-toast__more';
      more.textContent =
        view.more === 1
          ? '1 more change on this page'
          : `${view.more} more changes on this page`;
      msg.append(more);
    }
    toast.append(
      glyph(this.doc, 'check', 20, 'wa-toast__check'),
      msg,
      this.button('Undo', 'inverse', () => {
        this.hideToast();
        this.events.toastUndo();
      }),
      this.closeButton('Close', () => this.hideToast()),
    );
    this.toast = toast;
    // The toast sits above the chip when both are shown.
    this.stack?.prepend(toast);
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

  private restoreFocus(): void {
    const el = this.returnFocus as HTMLElement | null;
    this.returnFocus = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
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
      const next =
        list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
      next?.focus();
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

  showOutlines(items: OutlineItem[]): void {
    this.hideOutlines();
    const root = this.ensure();
    const marks = this.doc.createElement('div');
    marks.className = 'wa-marks';
    marks.setAttribute('aria-hidden', 'true');
    root.append(marks);
    this.marks = marks;
    this.outlines = items;
    this.drawOutlines();
  }

  hideOutlines(): void {
    this.marks?.remove();
    this.marks = null;
    this.outlines = [];
    this.collapse();
  }

  get outlinesShown(): number {
    return this.outlines.length;
  }

  private drawOutlines(): void {
    const marks = this.marks;
    const view = this.doc.defaultView;
    if (!marks || !view) return;
    marks.replaceChildren();
    const sx = view.scrollX;
    const sy = view.scrollY;
    const place = (el: HTMLElement, b: Box): void => {
      el.style.left = `${b.left - sx}px`;
      el.style.top = `${b.top - sy}px`;
      el.style.width = `${Math.max(0, b.right - b.left)}px`;
      el.style.height = `${Math.max(0, b.bottom - b.top)}px`;
    };
    for (const item of this.outlines) {
      if (item.ghost) {
        const g = this.doc.createElement('div');
        g.className = 'wa-ghost';
        place(g, item.ghost);
        marks.append(g);
      }
      const f = this.doc.createElement('div');
      f.className = 'wa-fit';
      place(f, item.fit);
      marks.append(f);
    }
    // Tags last, so no outline crosses a label.
    for (const item of this.outlines) {
      if (item.tag) {
        const tag = this.doc.createElement('div');
        tag.className = 'wa-tag';
        const label = this.doc.createElement('span');
        label.className = 'wa-tag__label';
        label.textContent = item.tag.label;
        tag.append(label, this.fitMark(item.tag.before, item.tag.after));
        const anchor = item.ghost ?? item.fit;
        tag.style.left = `${Math.max(4, Math.min(anchor.left, item.fit.left) - sx)}px`;
        tag.style.top = `${Math.max(4, Math.min(anchor.top, item.fit.top) - sy - 34)}px`;
        marks.append(tag);
      }
    }
  }

  // ------------------------------------------------------------------ reading guide

  setReadingGuide(on: boolean, lineHeightPx = 24): void {
    const view = this.doc.defaultView;
    if (!on) {
      this.guideOff?.();
      this.guideOff = null;
      this.guide?.remove();
      this.guide = null;
      this.guideY = null;
      this.collapse();
      return;
    }
    const root = this.ensure();
    if (this.guide) return;
    this.guideLh = lineHeightPx;
    const guide = this.doc.createElement('div');
    guide.className = 'wa-guide';
    guide.setAttribute('aria-hidden', 'true');
    for (const cls of [
      'wa-shade wa-shade--top',
      'wa-shade wa-shade--bottom',
      'wa-band-edge',
      'wa-band-edge',
    ]) {
      const d = this.doc.createElement('div');
      d.className = cls;
      guide.append(d);
    }
    root.append(guide);
    this.guide = guide;
    if (view) {
      const onMove = (e: PointerEvent): void => {
        this.guideY = e.clientY;
        this.schedule();
      };
      view.addEventListener('pointermove', onMove, {
        passive: true,
        capture: true,
      });
      this.guideOff = () =>
        view.removeEventListener('pointermove', onMove, true);
      this.guideY = view.innerHeight / 3;
    }
    this.drawGuide();
  }

  private drawGuide(): void {
    const guide = this.guide;
    const view = this.doc.defaultView;
    if (!guide || !view) return;
    const band = Math.min(96, Math.max(28, Math.round(this.guideLh * 1.6)));
    const y = this.guideY ?? view.innerHeight / 3;
    const top = Math.max(0, y - band / 2);
    const [shadeTop, shadeBottom, edgeTop, edgeBottom] = [
      ...guide.children,
    ] as HTMLElement[];
    if (!shadeTop || !shadeBottom || !edgeTop || !edgeBottom) return;
    shadeTop.style.height = `${top}px`;
    shadeBottom.style.top = `${top + band}px`;
    edgeTop.style.top = `${top - 1}px`;
    edgeBottom.style.top = `${top + band - 1}px`;
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

  /** Test and diagnostics view of what the layer shows (text only, no page data). */
  inspect(): {
    mounted: boolean;
    offer: { question: string; buttons: string[]; tabIndexes: number[] } | null;
    toast: { text: string; buttons: string[] } | null;
    outlines: number;
    guide: boolean;
    frozen: number;
    focusInside: boolean;
  } {
    return {
      mounted: this.host?.isConnected ?? false,
      offer: this.chip
        ? {
            question: this.chip.querySelector('.wa-chip__q')?.textContent ?? '',
            buttons: [...this.chip.querySelectorAll('button')].map(
              (b) => b.textContent || b.getAttribute('aria-label') || '',
            ),
            tabIndexes: [...this.chip.querySelectorAll('button')].map(
              (b) => b.tabIndex,
            ),
          }
        : null,
      toast: this.toast
        ? {
            text: this.toast.querySelector('.wa-toast__msg')?.textContent ?? '',
            buttons: [...this.toast.querySelectorAll('button')].map(
              (b) => b.textContent || b.getAttribute('aria-label') || '',
            ),
          }
        : null,
      outlines: this.outlines.length,
      guide: this.guide !== null,
      frozen: this.frozen.size,
      focusInside: this.root?.activeElement != null,
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
    this.chip = null;
    this.toast = null;
    this.marks = null;
    this.guide = null;
    this.frozen.clear();
    this.outlines = [];
    this.offerOp = null;
    this.teardownHost();
  }
}
