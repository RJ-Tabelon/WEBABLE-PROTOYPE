import type { PageSpec } from '@webable/core';

import {
  baseline,
  type EffectBaseline,
  type EffectKind,
  type Signals,
  watchEffect,
} from './effect';
import { isPersonEvent, markProxyEvent } from './firewall';
import {
  Ephemeral,
  fieldSig,
  type FieldSig,
  labelOf,
  type Positions,
  relocateField,
  type Resolved,
  resolveOriginal,
  seekRecord,
} from './locate';
import type {
  ProxyRole,
  ProxyTarget,
  Proxies,
  SkeletonRegistry,
  ViewSurface,
} from './types';

/**
 * Every control in Fit view drives the original (docs/10 §4.4).
 *
 * The renderer creates a ProxyTarget per control and calls bind(); it never
 * dispatches itself. On the person's action (a real event, or the firewall
 * router's copy of one, delivered synchronously inside the real event so
 * transient activation carries over) the original is re-resolved
 * (locate.ts), checked, and driven by the recipe for its role:
 *
 *   link     plain left click: dispatched to the original anchor (keeps SPA
 *            routing). A changed href navigates to the href that was shown;
 *            a vanished original follows the shown href natively. Middle and
 *            modified clicks act on the view's own <a href>.
 *   button   pointerdown, mousedown, pointerup, mouseup, click at the
 *            original's centre with detail 1.
 *   toggle   a click on the original, then its state is read back and shown.
 *   input    native value setter + input; change + blur on commit; Enter via
 *            the MAIN-world key bridge, then form.requestSubmit() only if
 *            nothing happened within 300 ms. A field the site replaces (on
 *            focus, as Wikipedia's search does) is found again by its
 *            signature (locate.ts relocateField) and told it has focus.
 *   select   native setter + input + change, read back.
 *   none     never proxied: shown on the page ("Do this on the page").
 *
 * A record that is not in the DOM (virtualized) is brought back first
 * (two-phase). Popup controls are scrolled to the centre before the click so
 * the site's menu opens where it can be mirrored. Irreversible actions need a
 * second press within 4 s. Every action gets an effect check; a failure
 * shows the element on the page and logs a defect, and never invites a blind
 * retry. Every event sent to the page is marked (isProxyEvent).
 */

/**
 * True for a synthetic event Fit view dispatched to a page element (one
 * isolated-world set shared by engine.js and fitview.js). WebAble's own page
 * listeners skip these, e.g. steady_clicks: `if (isProxyEvent(e)) return;`.
 */
export { isProxyEvent } from './firewall';

export type FailRole = Exclude<ProxyRole, 'none'>;
export type FailWhy = 'not_found' | 'fingerprint' | 'no_effect' | 'blocked';

export const PROXY_COPY = {
  covered: 'Something on this page is covering Fit view',
  answerFirst: 'Answer this on the page first',
  changed: 'This changed on the page. Here it is.',
  noEffect: "WebAble couldn't confirm that worked. Here it is on the page.",
  gone: "This isn't on the page anymore",
  unavailable: "This isn't available on the page right now",
  here: 'Here it is on the page',
  pressAgain: (name: string): string => `Press again to ${name}`,
} as const;

/** A second press must follow within this window. */
export const CONFIRM_MS = 4000;
/** No second dispatch of the same control while its first is this fresh. */
const BUSY_MS = 800;
/** Enter: wait this long for the site's own handler before requestSubmit(). */
export const SUBMIT_FALLBACK_MS = 300;

export interface ProxyAct {
  target: ProxyTarget;
  control: HTMLElement;
  original: Element;
}

/** What the proxy layer needs from the rest of the live layer. */
export interface ProxyHost {
  win: Window;
  surface: ViewSurface;
  registry(): SkeletonRegistry;
  spec(): PageSpec;
  eph: Ephemeral;
  positions: Positions;
  signals: Signals;
  /** Something covers Fit view's controls: act on nothing. */
  frozen(): boolean;
  /** A site dialog or modal blocks the page: it must be answered first. */
  blocking(): Element | null;
  showOnPage(el: Element | null, caption: string): void;
  notice(owner: string, text: string | null): void;
  /** A proxied action was dispatched (status window, learning). */
  acted(a: ProxyAct): void;
  /** The action is expected to change the page: show loading, re-read when quiet. */
  navigating(): void;
  /** The original opens a menu or dialog: mirror it beside `control`. */
  expectPopup(original: Element, control: HTMLElement): void;
  /** The person types into a field that may show suggestions. */
  typing(original: Element, control: HTMLElement): void;
  failed(role: FailRole, why: FailWhy): void;
}

// ---------------------------------------------------------------------------
// Dispatch helpers (also used by peek and sheet)
// ---------------------------------------------------------------------------

/** Must match entrypoints/keybridge.content.ts. */
export const KEY_EVENT = 'webable-key';

const FALLBACK_KEYS: Record<
  string,
  { code: string; keyCode: number; charCode?: number }
> = {
  Enter: { code: 'Enter', keyCode: 13, charCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
};

export interface KeyResult {
  /** The MAIN-world bridge dispatched the keys. */
  bridged: boolean;
  /** The page cancelled the keydown (it handled the key). */
  prevented: boolean;
}

function bridgeEvent(detail: string): CustomEvent {
  return markProxyEvent(
    new CustomEvent(KEY_EVENT, {
      detail,
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  );
}

/**
 * Press a key on an original: keydown, keypress (keys with a character) and
 * keyup with keyCode and which, through the MAIN-world bridge when it is
 * there, else from this world with the legacy init members.
 */
export function pressKey(el: Element, key: 'Enter' | 'Escape'): KeyResult {
  const bridged = !el.dispatchEvent(bridgeEvent('{"ping":1}'));
  if (bridged) {
    const prevented = !el.dispatchEvent(bridgeEvent(JSON.stringify({ key })));
    return { bridged, prevented };
  }
  const def = FALLBACK_KEYS[key] as {
    code: string;
    keyCode: number;
    charCode?: number;
  };
  const view = el.ownerDocument.defaultView;
  const make = (
    type: string,
    keyCode: number,
    charCode: number,
  ): KeyboardEvent =>
    markProxyEvent(
      new KeyboardEvent(type, {
        key,
        code: def.code,
        keyCode,
        charCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        composed: true,
        view,
      } as KeyboardEventInit),
    );
  const down = el.dispatchEvent(make('keydown', def.keyCode, 0));
  if (down && def.charCode !== undefined)
    el.dispatchEvent(make('keypress', def.charCode, def.charCode));
  el.dispatchEvent(make('keyup', def.keyCode, 0));
  return { bridged: false, prevented: !down };
}

/**
 * The pointer and mouse sequence a real click produces, at the original's
 * centre (Polymer's tap logic and delegated handlers read the coordinates).
 * A cancelled pointerdown suppresses the mouse compatibility events, as in a
 * browser. Returns false when the click was cancelled by the page.
 */
export function clickSequence(win: Window, el: Element): boolean {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const common = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: win,
    clientX: x,
    clientY: y,
    screenX: x + win.screenX,
    screenY: y + win.screenY,
    button: 0,
  };
  const pointer = {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    width: 1,
    height: 1,
  };
  const fire = (ev: Event): boolean => el.dispatchEvent(markProxyEvent(ev));
  const hasPointer = typeof PointerEvent === 'function';
  const compat = hasPointer
    ? fire(
        new PointerEvent('pointerdown', {
          ...common,
          ...pointer,
          buttons: 1,
          pressure: 0.5,
        }),
      )
    : true;
  if (compat)
    fire(new MouseEvent('mousedown', { ...common, buttons: 1, detail: 1 }));
  if (hasPointer)
    fire(
      new PointerEvent('pointerup', {
        ...common,
        ...pointer,
        buttons: 0,
        pressure: 0,
      }),
    );
  if (compat)
    fire(new MouseEvent('mouseup', { ...common, buttons: 0, detail: 1 }));
  const click = hasPointer
    ? new PointerEvent('click', {
        ...common,
        ...pointer,
        buttons: 0,
        detail: 1,
      })
    : new MouseEvent('click', { ...common, buttons: 0, detail: 1 });
  return fire(click);
}

/** A single click event (native checkbox and radio: their activation toggles them). */
function plainClick(win: Window, el: Element): boolean {
  const ev =
    typeof PointerEvent === 'function'
      ? new PointerEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: win,
          detail: 1,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      : new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: win,
          detail: 1,
        });
  return el.dispatchEvent(markProxyEvent(ev));
}

type ValueEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The native value setter, past framework instance overrides (React's value tracker). */
export function setNativeValue(el: ValueEl, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (set) set.call(el, value);
  else el.value = value;
}

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** The href if it is http(s), mailto or tel; never javascript: or data:. */
export function safeHref(
  href: string | null | undefined,
  base?: string,
): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return SAFE_SCHEMES.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function isValueEl(el: Element): el is ValueEl {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

function isCheckable(el: Element): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    (el.type === 'checkbox' || el.type === 'radio')
  );
}

/** Checked, pressed or selected state of an original (read only). */
export function isOn(el: Element): boolean {
  if (isCheckable(el)) return el.checked;
  const a =
    el.getAttribute('aria-checked') ??
    el.getAttribute('aria-pressed') ??
    el.getAttribute('aria-selected');
  return a === 'true' || a === 'mixed';
}

function isDisabled(el: Element): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute('aria-disabled') === 'true'
  );
}

/** A field whose page shows suggestions as the person types (combobox, autocomplete). */
export function isComboboxLike(el: Element): boolean {
  const hp = el.getAttribute('aria-haspopup');
  return (
    el.getAttribute('role') === 'combobox' ||
    el.hasAttribute('aria-autocomplete') ||
    el.hasAttribute('aria-controls') ||
    el.hasAttribute('list') ||
    (hp !== null && hp !== 'false') ||
    el.closest('[role="combobox"]') !== null
  );
}

/** Enter in this field searches (a results page follows). */
function isSearchLike(el: Element): boolean {
  return (
    (el instanceof HTMLInputElement && el.type === 'search') ||
    el.getAttribute('role') === 'searchbox' ||
    el.closest('[role="search"], search') !== null ||
    isComboboxLike(el)
  );
}

function shortName(name: string): string {
  const n = name.trim();
  return n.split(/\s+/).length <= 4 ? n.toLowerCase() : n;
}

// ---------------------------------------------------------------------------
// The proxy layer
// ---------------------------------------------------------------------------

interface ClickLike {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault(): void;
}

const KEYBOARD_ACTIVATION: ClickLike = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  preventDefault: () => undefined,
};

export class ProxyLayer implements Proxies {
  private readonly targets = new WeakMap<HTMLElement, ProxyTarget>();
  private readonly byId = new Map<string, Set<HTMLElement>>();
  private readonly byList = new Map<string, Set<HTMLElement>>();
  private readonly listened = new WeakSet<HTMLElement>();
  private readonly armed = new WeakMap<HTMLElement, number>();
  private readonly busy = new WeakMap<HTMLElement, number>();
  /** Text fields: the original they drive and whether it was told it has focus. */
  private readonly inputs = new WeakMap<
    HTMLElement,
    { el: Element; focused: boolean; committed: string }
  >();
  /** Text fields: how to find the original again if the site replaces it. */
  private readonly sigs = new WeakMap<HTMLElement, FieldSig>();
  private readonly abort = new AbortController();
  private count = 0;
  private disposed = false;

  constructor(private readonly host: ProxyHost) {}

  // -- Proxies -------------------------------------------------------------

  bind(control: HTMLElement, target: ProxyTarget): void {
    if (this.disposed) return;
    const prev = this.targets.get(control);
    if (prev) this.unindex(control, prev);
    this.targets.set(control, target);
    this.index(control, target);
    if (target.role === 'input') this.noteField(control, target);
    if (!this.listened.has(control)) {
      this.listened.add(control);
      this.listen(control);
    }
  }

  actions(): number {
    return this.count;
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.byId.clear();
    this.byList.clear();
  }

  // -- Queries for the rest of the live layer -------------------------------

  targetOf(control: HTMLElement): ProxyTarget | undefined {
    return this.targets.get(control);
  }

  /** Connected controls bound to a target id, in DOM order. */
  controlsFor(id: string): HTMLElement[] {
    return this.live(this.byId.get(id));
  }

  /** Record keys of a list in the view's order. */
  order(listId: string): string[] {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const c of this.live(this.byList.get(listId))) {
      const k = this.targets.get(c)?.record?.key;
      if (k !== undefined && !seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
    return keys;
  }

  /** One control per rendered record (the first in DOM order), every list. */
  representatives(): Array<{
    control: HTMLElement;
    listId: string;
    key: string;
  }> {
    const out: Array<{ control: HTMLElement; listId: string; key: string }> =
      [];
    for (const [listId, set] of this.byList) {
      const seen = new Set<string>();
      for (const c of this.live(set)) {
        const k = this.targets.get(c)?.record?.key;
        if (k === undefined || seen.has(k)) continue;
        seen.add(k);
        out.push({ control: c, listId, key: k });
      }
    }
    return out;
  }

  /** The fingerprint the view shows for a record (from its bound controls). */
  shownFingerprint(listId: string, key: string): string | undefined {
    for (const c of this.live(this.byList.get(listId))) {
      const r = this.targets.get(c)?.record;
      if (r?.key === key) return r.fingerprint;
    }
    return undefined;
  }

  /** Every connected bound control (covering checks sample these). */
  allControls(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const set of this.byId.values()) out.push(...this.live(set));
    return out;
  }

  /** Keyboard activation of a control that has no native activation (a div row). */
  activate(control: HTMLElement): void {
    this.onActivate(KEYBOARD_ACTIVATION, control);
  }

  // -- Indexing ------------------------------------------------------------

  private index(control: HTMLElement, t: ProxyTarget): void {
    let ids = this.byId.get(t.id);
    if (!ids) this.byId.set(t.id, (ids = new Set()));
    ids.add(control);
    if (t.record) {
      let list = this.byList.get(t.record.listId);
      if (!list) this.byList.set(t.record.listId, (list = new Set()));
      list.add(control);
    }
  }

  private unindex(control: HTMLElement, t: ProxyTarget): void {
    this.byId.get(t.id)?.delete(control);
    if (t.record) this.byList.get(t.record.listId)?.delete(control);
  }

  /** Connected members of a control set in DOM order; prunes the rest. */
  private live(set: Set<HTMLElement> | undefined): HTMLElement[] {
    if (!set) return [];
    const out: HTMLElement[] = [];
    for (const c of set) {
      if (c.isConnected) out.push(c);
      else set.delete(c);
    }
    out.sort((a, b) =>
      a === b
        ? 0
        : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
    );
    return out;
  }

  // -- Listeners -----------------------------------------------------------

  private listen(control: HTMLElement): void {
    const opts = { signal: this.abort.signal };
    control.addEventListener(
      'click',
      (e) => {
        if (isPersonEvent(e)) this.onActivate(e, control);
      },
      opts,
    );
    control.addEventListener(
      'change',
      (e) => {
        if (isPersonEvent(e)) this.onChange(control);
      },
      opts,
    );
    control.addEventListener(
      'input',
      (e) => {
        if (isPersonEvent(e)) this.onInput(control, e as InputEvent);
      },
      opts,
    );
    control.addEventListener(
      'keydown',
      (e) => {
        if (isPersonEvent(e)) this.onKeyDown(control, e as KeyboardEvent);
      },
      opts,
    );
    control.addEventListener(
      'focusin',
      (e) => {
        if (isPersonEvent(e)) this.onFocusIn(control);
      },
      opts,
    );
    control.addEventListener(
      'focusout',
      (e) => {
        if (isPersonEvent(e)) this.onFocusOut(control, e as FocusEvent);
      },
      opts,
    );
  }

  private get win(): Window {
    return this.host.win;
  }

  private resolve(t: ProxyTarget): Resolved {
    return resolveOriginal(this.host.registry(), t, this.host.eph);
  }

  // -- Activation (link, button, toggle, option rows, none) -----------------

  private onActivate(e: ClickLike, control: HTMLElement): void {
    const t = this.targets.get(control);
    if (!t || this.disposed) return;
    // Checkboxes, radios and selects act on `change`; text fields on input.
    if (t.role === 'input') return;
    if (
      (t.role === 'toggle' || t.role === 'select') &&
      (isCheckable(control) || control instanceof HTMLSelectElement)
    )
      return;
    if (t.role === 'select') {
      // An option row drawn as a button (data-value): choose it.
      e.preventDefault();
      this.changeSelect(control, t);
      return;
    }
    if (
      t.role === 'link' &&
      (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
    )
      return; // the view's own href, natively (new tab, download)
    if (t.role === 'none') {
      e.preventDefault();
      const r = this.resolve(t);
      this.host.showOnPage(r.kind === 'ok' ? r.el : nearOf(r), PROXY_COPY.here);
      return;
    }
    const role = t.role;
    const r = this.resolve(t);
    if (role === 'link' && r.kind !== 'ok') {
      // The original is gone or changed: follow the href that was shown.
      const shown = safeHref(t.href, this.win.location.href);
      if (shown) {
        if (!(control instanceof HTMLAnchorElement) || control.href !== shown) {
          e.preventDefault();
          this.go(shown, null);
        }
        this.count++;
        this.host.navigating();
        return;
      }
    }
    if (!this.allowed(e, control, t, r)) return;
    e.preventDefault();
    if (r.kind === 'ok') {
      this.perform(control, t, r.el, r.member);
      return;
    }
    if (r.kind === 'absent' && t.record) {
      void this.twoPhase(control, t);
      return;
    }
    this.refuse(control, t, r);
  }

  /** Covering, blocking overlays, the irreversible double press and repeat clicks. */
  private allowed(
    e: ClickLike,
    control: HTMLElement,
    t: ProxyTarget,
    r: Resolved,
  ): boolean {
    const role = t.role as FailRole;
    if (this.host.frozen()) {
      e.preventDefault();
      this.host.notice('proxy', PROXY_COPY.covered);
      this.host.failed(role, 'blocked');
      return false;
    }
    const blocker = this.host.blocking();
    if (blocker && !(r.kind === 'ok' && blocker.contains(r.el))) {
      e.preventDefault();
      this.host.showOnPage(blocker, PROXY_COPY.answerFirst);
      this.host.failed(role, 'blocked');
      return false;
    }
    const now = performance.now();
    const since = this.busy.get(control);
    if (since !== undefined && now - since < BUSY_MS) {
      e.preventDefault();
      return false;
    }
    if (t.irreversible) {
      const until = this.armed.get(control);
      if (until === undefined || now > until) {
        e.preventDefault();
        this.arm(control, r);
        return false;
      }
      this.armed.delete(control);
      delete control.dataset.webableArmed;
      this.host.notice('confirm', null);
    }
    return true;
  }

  private arm(control: HTMLElement, r: Resolved): void {
    const name =
      (r.kind === 'ok' ? labelOf(this.host.registry(), r.el) : '') ||
      (control.textContent ?? '').trim();
    this.armed.set(control, performance.now() + CONFIRM_MS);
    control.dataset.webableArmed = 'true';
    this.host.notice('confirm', PROXY_COPY.pressAgain(shortName(name)));
    setTimeout(() => {
      const until = this.armed.get(control);
      if (until !== undefined && performance.now() < until) return;
      this.armed.delete(control);
      delete control.dataset.webableArmed;
      this.host.notice('confirm', null);
    }, CONFIRM_MS + 50);
  }

  /** Run the role's recipe on a resolved original, inside the person's event. */
  private perform(
    control: HTMLElement,
    t: ProxyTarget,
    el: Element,
    member: Element | null,
  ): void {
    if (isDisabled(el)) {
      this.host.notice('proxy', PROXY_COPY.unavailable);
      this.host.failed(t.role as FailRole, 'blocked');
      return;
    }
    const reg = this.host.registry();
    const before = baseline(this.win, el, member);
    if (t.role === 'link') {
      // Pinned: an original whose href changed (or is no longer safe) does
      // not decide where the person goes.
      const shown = safeHref(t.href, this.win.location.href);
      const now = safeHref(reg.href(el), this.win.location.href);
      if (shown && shown !== now) this.go(shown, el);
      else clickSequence(this.win, el);
      this.done(control, t, el, member, before, true);
      return;
    }
    if (t.role === 'toggle') {
      if (isCheckable(el)) plainClick(this.win, el);
      else clickSequence(this.win, el);
      this.reflect(control, el);
      this.done(control, t, el, member, before, false);
      return;
    }
    if (t.popup) {
      el.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'instant',
      });
      this.host.expectPopup(el, control);
    }
    clickSequence(this.win, el);
    this.done(control, t, el, member, before, this.opensRecord(t));
  }

  /** Navigate to the href the person was shown (the original's changed, or it is gone). */
  private go(href: string, original: Element | null): void {
    const target = original?.getAttribute('target');
    if (
      target &&
      target !== '_self' &&
      target !== '_top' &&
      target !== '_parent'
    )
      this.win.open(href, '_blank', 'noopener');
    else this.win.location.assign(href);
  }

  /** The control opens its record (the collection's open slot): a navigation. */
  private opensRecord(t: ProxyTarget): boolean {
    const rec = t.record;
    if (!rec) return false;
    const c = this.host
      .spec()
      .collections.find((x) => x.list_id === rec.listId);
    return c?.open_slot === rec.slotId;
  }

  private async twoPhase(control: HTMLElement, t: ProxyTarget): Promise<void> {
    const rec = t.record;
    if (!rec) return;
    this.busy.set(control, performance.now());
    const r = await seekRecord({
      reg: this.host.registry(),
      target: t,
      order: this.order(rec.listId),
      positions: this.host.positions,
    });
    this.busy.delete(control);
    if (this.disposed) return;
    if (r.kind === 'ok') this.perform(control, t, r.el, r.member);
    else this.refuse(control, t, r);
  }

  private refuse(control: HTMLElement, t: ProxyTarget, r: Resolved): void {
    const role = (t.role === 'none' ? 'button' : t.role) as FailRole;
    // A view checkbox already flipped natively: put it back.
    if (t.role === 'toggle' && isCheckable(control))
      control.checked = !control.checked;
    if (t.role === 'select' && isCheckable(control)) control.checked = false;
    switch (r.kind) {
      case 'changed':
        if (t.record) this.host.surface.patchRecords(t.record.listId);
        this.host.showOnPage(r.member, PROXY_COPY.changed);
        this.host.failed(role, 'fingerprint');
        return;
      case 'ambiguous':
        this.host.showOnPage(r.member, PROXY_COPY.here);
        this.host.failed(role, 'fingerprint');
        return;
      case 'missing':
      case 'absent': {
        const near = nearOf(r);
        if (near) this.host.showOnPage(near, PROXY_COPY.gone);
        else this.host.notice('proxy', PROXY_COPY.gone);
        if (t.record) this.host.surface.patchRecords(t.record.listId);
        this.host.failed(role, 'not_found');
        return;
      }
      case 'ok':
        return;
    }
  }

  /** After a dispatch: count it, tell the live layer, and check its effect. */
  private done(
    control: HTMLElement,
    t: ProxyTarget,
    el: Element,
    member: Element | null,
    before: EffectBaseline,
    navigates: boolean,
  ): void {
    this.count++;
    this.host.acted({ target: t, control, original: el });
    if (navigates) this.host.navigating();
    const reg = this.host.registry();
    const scope =
      t.role === 'link'
        ? el.ownerDocument.body
        : (member ?? (t.scopeId ? reg.element(t.scopeId) : null));
    this.check(control, t, el, member, before, scope, (kind) => {
      if (t.role === 'toggle') this.reflect(control, el);
      return kind;
    });
  }

  private check(
    control: HTMLElement,
    t: ProxyTarget,
    el: Element,
    member: Element | null,
    before: EffectBaseline,
    scope: Element | null,
    after?: (kind: EffectKind | null) => void,
  ): ReturnType<typeof watchEffect> {
    this.busy.set(control, performance.now());
    const watch = watchEffect({
      win: this.win,
      original: el,
      record: member,
      scope,
      before,
      signals: this.host.signals,
    });
    void watch.result.then((kind) => {
      this.busy.delete(control);
      after?.(kind);
      if (kind || this.disposed) return;
      this.host.failed(
        (t.role === 'none' ? 'button' : t.role) as FailRole,
        'no_effect',
      );
      this.host.showOnPage(el.isConnected ? el : member, PROXY_COPY.noEffect);
    });
    return watch;
  }

  /** Show the original's state on a toggle control (WebAble's own DOM). */
  private reflect(control: HTMLElement, el: Element): void {
    const on = isOn(el);
    if (isCheckable(control)) control.checked = on;
    else control.setAttribute('aria-pressed', String(on));
  }

  // -- Toggles and selects (change) ----------------------------------------

  private onChange(control: HTMLElement): void {
    const t = this.targets.get(control);
    if (!t || this.disposed) return;
    if (t.role === 'input') {
      this.commit(control, false);
      return;
    }
    if (t.role === 'toggle' && isCheckable(control)) {
      this.changeToggle(control, t);
      return;
    }
    if (t.role === 'select') this.changeSelect(control, t);
  }

  private changeToggle(control: HTMLInputElement, t: ProxyTarget): void {
    const r = this.resolve(t);
    if (!this.allowed(KEYBOARD_ACTIVATION, control, t, r)) {
      control.checked = !control.checked;
      return;
    }
    if (r.kind === 'ok') {
      this.perform(control, t, r.el, r.member);
      return;
    }
    if (r.kind === 'absent' && t.record) {
      void this.twoPhase(control, t);
      return;
    }
    this.refuse(control, t, r);
  }

  private changeSelect(control: HTMLElement, t: ProxyTarget): void {
    if (isCheckable(control) && !control.checked) return;
    const value =
      control instanceof HTMLSelectElement ||
      control instanceof HTMLInputElement
        ? control.value
        : (control.dataset.value ?? '');
    const r = this.resolve(t);
    if (!this.allowed(KEYBOARD_ACTIVATION, control, t, r)) {
      this.reflectSelect(t, r.kind === 'ok' ? r.el : null);
      return;
    }
    if (r.kind !== 'ok' || !(r.el instanceof HTMLSelectElement)) {
      this.refuse(
        control,
        t,
        r.kind === 'ok' ? { kind: 'missing', near: r.el } : r,
      );
      return;
    }
    const el = r.el;
    const option = Array.from(el.options).find((o) => o.value === value);
    if (!option || option.disabled) {
      this.reflectSelect(t, el);
      this.host.notice('proxy', PROXY_COPY.unavailable);
      this.host.failed('select', 'not_found');
      return;
    }
    const before = baseline(this.win, el, r.member);
    setNativeValue(el, value);
    el.dispatchEvent(
      markProxyEvent(new Event('input', { bubbles: true, composed: true })),
    );
    el.dispatchEvent(markProxyEvent(new Event('change', { bubbles: true })));
    this.reflectSelect(t, el);
    this.count++;
    this.host.acted({ target: t, control, original: el });
    this.check(control, t, el, r.member, before, null, () =>
      this.reflectSelect(t, el),
    );
  }

  /** Every view control bound to one select shows the original's value. */
  private reflectSelect(t: ProxyTarget, el: Element | null): void {
    if (!(el instanceof HTMLSelectElement)) return;
    for (const c of this.controlsFor(t.id)) {
      if (c instanceof HTMLSelectElement) c.value = el.value;
      else if (isCheckable(c)) c.checked = c.value === el.value;
      else c.setAttribute('aria-pressed', String(c.dataset.value === el.value));
    }
  }

  // -- Text fields ---------------------------------------------------------

  /** Keep a text field's signature while its original is on the page. */
  private noteField(control: HTMLElement, t: ProxyTarget, el?: Element): void {
    const reg = this.host.registry();
    const original = el ?? reg.element(t.id);
    const sig = original?.isConnected ? fieldSig(reg, original) : null;
    if (sig) this.sigs.set(control, sig);
  }

  /** A text field's original after the site replaced it (eval M8), or null. */
  private relocate(control: HTMLElement, t: ProxyTarget): Element | null {
    const sig = this.sigs.get(control);
    if (!sig) return null;
    const reg = this.host.registry();
    const scope = t.scopeId ? reg.element(t.scopeId) : null;
    return relocateField(reg, this.win.document, sig, scope);
  }

  private field(control: HTMLElement): Element | null {
    const t = this.targets.get(control);
    if (!t || t.role !== 'input') return null;
    const known = this.inputs.get(control);
    if (known?.el.isConnected) return known.el;
    // Its locator first, then the field's signature.
    const r = this.resolve(t);
    const el = r.kind === 'ok' ? r.el : this.relocate(control, t);
    if (!el) {
      this.inputs.delete(control);
      return null;
    }
    this.noteField(control, t, el);
    const state = {
      el,
      focused: false,
      committed: known?.committed ?? valueOf(el),
    };
    this.inputs.set(control, state);
    // Replaced while the person was in it: the new field has focus too.
    if (known?.focused) this.tellFocus(control, el, state);
    return el;
  }

  private onFocusIn(control: HTMLElement): void {
    const el = this.field(control);
    const state = this.inputs.get(control);
    if (!el || !state || state.focused) return;
    this.tellFocus(control, el, state);
  }

  /** The original is told it has focus (once, until the person leaves the field). */
  private tellFocus(
    control: HTMLElement,
    el: Element,
    state: { focused: boolean },
  ): void {
    state.focused = true;
    el.dispatchEvent(
      markProxyEvent(new FocusEvent('focus', { bubbles: false })),
    );
    el.dispatchEvent(
      markProxyEvent(
        new FocusEvent('focusin', { bubbles: true, composed: true }),
      ),
    );
    if (isComboboxLike(el)) this.host.typing(el, control);
  }

  private onInput(control: HTMLElement, e: InputEvent): void {
    const t = this.targets.get(control);
    if (!t || t.role !== 'input' || this.disposed) return;
    if (!isValueEl(control)) return;
    if (this.host.frozen()) {
      this.host.notice('proxy', PROXY_COPY.covered);
      return;
    }
    const el = this.field(control);
    if (!el || !isValueEl(el)) {
      this.host.notice('proxy', PROXY_COPY.gone);
      this.host.failed('input', 'not_found');
      return;
    }
    // Before the input event: suggestions it opens belong to this field.
    this.host.typing(el, control);
    setNativeValue(el, control.value);
    el.dispatchEvent(
      markProxyEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: e.inputType || 'insertText',
          data: e.data ?? null,
        }),
      ),
    );
  }

  private onKeyDown(control: HTMLElement, e: KeyboardEvent): void {
    const t = this.targets.get(control);
    if (!t || t.role !== 'input' || e.key !== 'Enter' || e.isComposing) return;
    const multiline = control instanceof HTMLTextAreaElement;
    if (multiline && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.enter(control);
  }

  /** Enter: the site's own key handling first, form submission only as a fallback. */
  private enter(control: HTMLElement): void {
    const t = this.targets.get(control);
    if (!t) return;
    let r = this.resolve(t);
    if (r.kind !== 'ok') {
      const el = this.field(control);
      if (el) r = { kind: 'ok', el, member: null };
    }
    if (!this.allowed(KEYBOARD_ACTIVATION, control, t, r)) return;
    if (r.kind !== 'ok' || !isValueEl(r.el)) {
      this.refuse(
        control,
        t,
        r.kind === 'ok' ? { kind: 'missing', near: r.el } : r,
      );
      return;
    }
    const el = r.el;
    if (isValueEl(control) && el.value !== control.value) {
      setNativeValue(el, control.value);
      el.dispatchEvent(
        markProxyEvent(
          new InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'insertText',
          }),
        ),
      );
    }
    const state = this.inputs.get(control);
    if (state && isValueEl(control)) state.committed = control.value;
    const form = (el as HTMLInputElement).form ?? el.closest('form');
    const before = baseline(this.win, el, r.member);
    const watch = this.check(
      control,
      t,
      el,
      r.member,
      before,
      form ?? el.parentElement?.parentElement ?? null,
    );
    if (isSearchLike(el)) this.host.navigating();
    const key = pressKey(el, 'Enter');
    if (key.prevented) watch.note('handled');
    this.count++;
    this.host.acted({ target: t, control, original: el });
    setTimeout(() => {
      if (watch.seen() || this.disposed || !el.isConnected || !form) return;
      if (!(form instanceof HTMLFormElement)) return;
      try {
        form.requestSubmit();
      } catch {
        // An invalid form shows its own messages; the effect check reports it.
      }
    }, SUBMIT_FALLBACK_MS);
  }

  private onFocusOut(control: HTMLElement, e: FocusEvent): void {
    // Moving into a mirrored suggestion row keeps the original "focused".
    const next = e.relatedTarget;
    if (
      next instanceof HTMLElement &&
      Ephemeral.is(this.targets.get(next)?.id ?? '')
    )
      return;
    this.commit(control, true);
  }

  /** change on commit, blur when the person leaves the field. */
  private commit(control: HTMLElement, blur: boolean): void {
    const state = this.inputs.get(control);
    const el = state?.el;
    if (!state || !el || !el.isConnected || !isValueEl(control)) return;
    if (control.value !== state.committed) {
      if (isValueEl(el) && el.value !== control.value)
        setNativeValue(el, control.value);
      el.dispatchEvent(markProxyEvent(new Event('change', { bubbles: true })));
      state.committed = control.value;
    }
    if (blur && state.focused) {
      state.focused = false;
      el.dispatchEvent(
        markProxyEvent(new FocusEvent('blur', { bubbles: false })),
      );
      el.dispatchEvent(
        markProxyEvent(
          new FocusEvent('focusout', { bubbles: true, composed: true }),
        ),
      );
    }
  }
}

function valueOf(el: Element): string {
  return isValueEl(el) ? el.value : '';
}

function nearOf(r: Resolved): Element | null {
  switch (r.kind) {
    case 'missing':
      return r.near;
    case 'changed':
    case 'ambiguous':
      return r.member;
    default:
      return null;
  }
}
