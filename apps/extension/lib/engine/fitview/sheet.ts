import { isRendered } from '../util/dom';
import { nextFrame } from '../util/schedule';
import { clean, type Ephemeral, labelOf } from './locate';
import { pressKey, type ProxyLayer, safeHref } from './proxy';
import type { ProxyTarget, SkeletonRegistry, ViewSurface } from './types';

/**
 * Site menus and listboxes, mirrored inside Fit view (docs/10 §4.4, control
 * substitution: "a menu or listbox the site opens -> rows inside Fit view").
 *
 * The site's popup opens under the view, anchored to an original the person
 * cannot see. Its items are read on this device (accessible name, else
 * visible text) and handed to the view as a sheet beside the control that
 * opened it (surface.sheet). Each row proxies a click to its original item.
 * The sheet follows the popup: items that change are re-read each frame, and
 * when the popup closes the sheet goes. Search suggestions are a sheet under
 * the field the person types in, never a peek.
 *
 * Keyboard: ArrowDown and ArrowUp move between the field (or the control)
 * and the rows, Home and End jump, Escape closes the site's popup too, and
 * typing on a suggestion row returns to the field.
 */

export interface SheetOption {
  label: string;
  selected: boolean;
  target: ProxyTarget;
}

/** Items of a menu, listbox or menu-like popover. */
const ITEM_SELECTOR = [
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="treeitem"]',
].join(',');
/** Popups without item roles: their links and buttons are the items. */
const FALLBACK_SELECTOR = 'a[href],button,[role="button"],[role="link"]';

export const SHEET_MAX_ROWS = 60;

function isSelected(el: Element): boolean {
  const cur = el.getAttribute('aria-current');
  return (
    el.getAttribute('aria-selected') === 'true' ||
    el.getAttribute('aria-checked') === 'true' ||
    (cur !== null && cur !== 'false')
  );
}

function isDisabledItem(el: Element): boolean {
  return (
    el.getAttribute('aria-disabled') === 'true' ||
    (el as HTMLButtonElement).disabled === true
  );
}

/** The popup's visible, enabled, labelled items as sheet rows. */
export function readOptions(
  popup: Element,
  reg: SkeletonRegistry,
  eph: Ephemeral,
  max = SHEET_MAX_ROWS,
): SheetOption[] {
  let items = Array.from(popup.querySelectorAll(ITEM_SELECTOR));
  if (items.length === 0)
    items = Array.from(popup.querySelectorAll(FALLBACK_SELECTOR));
  const out: SheetOption[] = [];
  for (const el of items) {
    if (out.length >= max) break;
    if (!isRendered(el) || isDisabledItem(el)) continue;
    const label = clean(labelOf(reg, el));
    if (!label) continue;
    const href =
      el instanceof HTMLAnchorElement
        ? safeHref(reg.href(el), el.ownerDocument.location.href)
        : null;
    const target = eph.target(el, href ? 'link' : 'button', label, href);
    const hp = el.getAttribute('aria-haspopup');
    if (hp !== null && hp !== 'false') target.popup = true;
    out.push({ label, selected: isSelected(el), target });
  }
  return out;
}

function sameOptions(a: SheetOption[], b: SheetOption[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((o, i) => {
    const p = b[i] as SheetOption;
    return (
      o.target.id === p.target.id &&
      o.label === p.label &&
      o.selected === p.selected
    );
  });
}

/**
 * Close a site popup the way a person would: Escape on it (through the key
 * bridge), then the platform's own close for dialogs and popovers that a
 * synthetic key cannot dismiss.
 */
export function dismissPopup(popup: Element, keyTarget?: Element | null): void {
  const doc = popup.ownerDocument;
  if (popup instanceof HTMLDialogElement && popup.open) {
    const d = popup as HTMLDialogElement & { requestClose?: () => void };
    if (typeof d.requestClose === 'function') d.requestClose();
    else d.close();
    return;
  }
  const active = doc.activeElement;
  const target =
    keyTarget ?? (active && popup.contains(active) ? active : popup);
  pressKey(target, 'Escape');
  if (popup.hasAttribute('popover') && popup.matches(':popover-open')) {
    try {
      (popup as HTMLElement).hidePopover();
    } catch {
      // Already closing.
    }
  }
}

export type SheetMode = 'menu' | 'combobox';

export interface SheetHost {
  surface: ViewSurface;
  root: ShadowRoot;
  registry(): SkeletonRegistry;
  eph: Ephemeral;
  proxies: ProxyLayer;
}

export class SheetMirror {
  private popup: Element | null = null;
  /** For a combobox: the original field (Escape goes there). */
  private field: Element | null = null;
  private anchor: HTMLElement | null = null;
  private mode: SheetMode = 'menu';
  private options: SheetOption[] = [];
  private mo: MutationObserver | null = null;
  private pending = false;
  private readonly onKey = (e: Event): void => this.key(e as KeyboardEvent);

  constructor(private readonly host: SheetHost) {
    host.root.addEventListener('keydown', this.onKey, true);
  }

  /** The site popup the sheet mirrors, if one is open. */
  get source(): Element | null {
    return this.popup;
  }

  open(
    popup: Element,
    anchor: HTMLElement,
    mode: SheetMode,
    field: Element | null = null,
  ): void {
    if (this.popup !== popup) this.stopObserving();
    this.popup = popup;
    this.anchor = anchor;
    this.mode = mode;
    this.field = field;
    this.options = [];
    if (!this.mo) {
      this.mo = new MutationObserver(() => this.schedule());
      this.mo.observe(popup, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'aria-selected',
          'aria-checked',
          'aria-current',
          'aria-disabled',
          'aria-label',
          'hidden',
          'style',
          'class',
        ],
      });
    }
    this.render();
    if (mode === 'menu') void nextFrame().then(() => this.focusRow(0));
  }

  /** Re-read the popup's items now. */
  render(): void {
    const popup = this.popup;
    if (!popup || !this.anchor) return;
    const next = readOptions(popup, this.host.registry(), this.host.eph);
    if (sameOptions(next, this.options) && this.options.length > 0) return;
    this.options = next;
    this.host.surface.sheet(this.anchor, next);
  }

  /** Close the sheet; with `escape`, close the site's popup as well. */
  close(opts: { escape?: boolean; focus?: boolean } = {}): void {
    const popup = this.popup;
    if (!popup) return;
    const anchor = this.anchor;
    const field = this.field;
    this.popup = null;
    this.anchor = null;
    this.field = null;
    this.options = [];
    this.stopObserving();
    this.host.surface.sheet(null, []);
    if (opts.escape && popup.isConnected) dismissPopup(popup, field);
    if (opts.focus && anchor?.isConnected) anchor.focus();
  }

  /** The view's row controls, in option order. */
  rows(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const o of this.options) {
      const c = this.host.proxies.controlsFor(o.target.id)[0];
      if (c) out.push(c);
    }
    return out;
  }

  dispose(): void {
    this.host.root.removeEventListener('keydown', this.onKey, true);
    this.stopObserving();
    this.popup = null;
    this.anchor = null;
  }

  private stopObserving(): void {
    this.mo?.disconnect();
    this.mo = null;
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    void nextFrame().then(() => {
      this.pending = false;
      this.render();
    });
  }

  private focusRow(i: number): void {
    const rows = this.rows();
    if (rows.length === 0) return;
    const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
    row?.focus();
  }

  private key(e: KeyboardEvent): void {
    if (!this.popup || e.defaultPrevented) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rows = this.rows();
    const i = rows.indexOf(t);
    const onAnchor = t === this.anchor;
    if (!onAnchor && i < 0) return;
    const consume = (): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        consume();
        this.focusRow(i < 0 ? 0 : i + 1);
        return;
      case 'ArrowUp':
        consume();
        if (i <= 0) {
          if (this.mode === 'combobox' || i < 0) this.anchor?.focus();
          else this.focusRow(rows.length - 1);
        } else this.focusRow(i - 1);
        return;
      case 'Home':
        if (i < 0) return;
        consume();
        this.focusRow(0);
        return;
      case 'End':
        if (i < 0) return;
        consume();
        this.focusRow(rows.length - 1);
        return;
      case 'Escape':
        consume();
        this.close({ escape: true, focus: true });
        return;
      case 'Tab':
        this.close({ escape: true });
        return;
      case 'Enter':
      case ' ':
        // Buttons and links activate natively (a click follows).
        if (
          i < 0 ||
          t instanceof HTMLButtonElement ||
          t instanceof HTMLAnchorElement
        )
          return;
        consume();
        this.host.proxies.activate(t);
        return;
      default:
        // Typing on a suggestion row goes back to the field.
        if (
          this.mode === 'combobox' &&
          i >= 0 &&
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        )
          this.anchor?.focus();
    }
  }
}
