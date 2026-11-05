// Owner: D1. Drive the original page's controls from our re-presented copy.
//
// Recipes verified tonight on React 19 and Vue 3 from the ISOLATED world (research-engineering §11.1):
// - text: native value setter, then `input` and `change` (bubbling)
// - checkbox / radio: `el.click()` only (React listens to click; setting `.checked` desyncs it)
// - select: selectedIndex by index (Angular encodes values), then `input` and `change`
// - button / clickable div: pointerdown → mousedown → pointerup → mouseup → click at the original's centre
// Call these inside the person's real click handler so the page keeps transient activation (window.open, fullscreen).
// Values read here are shown only in our own UI and are never sent anywhere.

export type LiveValue =
  | { kind: 'text'; value: string; disabled: boolean; readOnly: boolean }
  | { kind: 'check'; checked: boolean; disabled: boolean }
  | { kind: 'select'; index: number; options: string[]; disabled: boolean }
  | { kind: 'control'; label: string; disabled: boolean; pressed: boolean | null; expanded: boolean | null }
  | { kind: 'gone' };

function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled === true) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  const fs = el.closest('fieldset');
  return !!fs && fs.disabled && !fs.querySelector(':scope > legend')?.contains(el);
}

function centre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

function valueSetter(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, prop: 'value' | 'selectedIndex'): ((v: unknown) => void) | null {
  let proto: object | null = Object.getPrototypeOf(el);
  while (proto) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (d?.set) {
      const set = d.set;
      return (v: unknown) => set.call(el, v);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

function isCheckable(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
}

/** Full pointer sequence for buttons, links and clickable divs. Checkboxes and radios are routed to `proxyCheck`. */
export function proxyClick(el: Element): void {
  if (!el.isConnected || isDisabled(el)) return;
  if (isCheckable(el)) {
    proxyCheck(el);
    return;
  }
  if (el instanceof HTMLLabelElement || el instanceof HTMLSelectElement) {
    (el as HTMLElement).click();
    return;
  }
  const { x, y } = centre(el);
  const view = el.ownerDocument.defaultView ?? window;
  const base: MouseEventInit = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, detail: 1, view };
  const ptr: PointerEventInit = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 };
  const P = view.PointerEvent ?? PointerEvent;
  const M = view.MouseEvent ?? MouseEvent;
  el.dispatchEvent(new P('pointerover', { ...ptr, cancelable: false }));
  el.dispatchEvent(new M('mouseover', base));
  el.dispatchEvent(new P('pointerdown', { ...ptr, buttons: 1, pressure: 0.5 }));
  el.dispatchEvent(new M('mousedown', { ...base, buttons: 1 }));
  el.dispatchEvent(new P('pointerup', { ...ptr, buttons: 0, pressure: 0 }));
  el.dispatchEvent(new M('mouseup', { ...base, buttons: 0 }));
  // Untrusted `click` still runs activation behaviour (links navigate, buttons submit their form).
  el.dispatchEvent(new M('click', { ...base, buttons: 0 }));
}

/** Text input / textarea: native setter, then `input` and `change`. */
export function proxyInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (!el.isConnected || isDisabled(el) || el.readOnly) return;
  const set = valueSetter(el, 'value');
  if (set) set(value);
  else el.value = value;
  const view = el.ownerDocument.defaultView ?? window;
  const IE = view.InputEvent ?? InputEvent;
  el.dispatchEvent(new IE('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Commit a text field the way leaving it would (Angular "touched", validation on blur). */
export function proxyCommit(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  if (!el.isConnected) return;
  const view = el.ownerDocument.defaultView ?? window;
  const FE = view.FocusEvent ?? FocusEvent;
  el.dispatchEvent(new FE('blur', { bubbles: false }));
  el.dispatchEvent(new FE('focusout', { bubbles: true, composed: true }));
}

/** Checkbox / radio: `click()` only. */
export function proxyCheck(el: HTMLInputElement): void {
  if (!el.isConnected || isDisabled(el)) return;
  el.click();
}

/** Select by index (never by value string), then `input` and `change`. */
export function proxySelect(el: HTMLSelectElement, index: number): void {
  if (!el.isConnected || isDisabled(el)) return;
  if (index < 0 || index >= el.options.length) return;
  const set = valueSetter(el, 'selectedIndex');
  if (set) set(index);
  else el.selectedIndex = index;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const KEYS: Record<string, { code: string; keyCode: number }> = {
  Enter: { code: 'Enter', keyCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  ' ': { code: 'Space', keyCode: 32 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Tab: { code: 'Tab', keyCode: 9 },
};

/** Keydown/keyup with keyCode (Chrome honours keyCode in the init dict from the isolated world). */
export function proxyKey(el: Element, key: keyof typeof KEYS | string): void {
  if (!el.isConnected) return;
  const k = KEYS[key] ?? { code: key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 };
  const init: KeyboardEventInit & { keyCode: number; which: number } = {
    key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true, composed: true,
  };
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  if (key === 'Enter') el.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 }));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
}

/**
 * Submit what a text field belongs to: the form's submit button if it has one, else `requestSubmit()`, else Enter.
 * Synthetic Enter does not run implicit submission, so the key is the last resort.
 */
export function proxySubmit(field: Element): void {
  if (!field.isConnected) return;
  const form = (field as HTMLInputElement).form ?? field.closest('form');
  if (form) {
    const submit = form.querySelector<HTMLElement>('button[type=submit], input[type=submit], button:not([type])');
    if (submit && !isDisabled(submit)) {
      proxyClick(submit);
      return;
    }
    try {
      form.requestSubmit();
      return;
    } catch {
      /* fall through to the key */
    }
  }
  proxyKey(field, 'Enter');
}

const flashing = new WeakMap<Element, number>();

/** "Do this on the page": scroll the original into view, focus it and outline it for a moment. */
export function focusOriginal(el: Element): void {
  if (!el.isConnected) return;
  const h = el as HTMLElement;
  try {
    h.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  } catch {
    h.scrollIntoView();
  }
  if (typeof h.focus === 'function') {
    try {
      h.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    } catch {
      h.focus();
    }
  }
  if (!h.style) return;
  const prev = flashing.get(el);
  if (prev !== undefined) window.clearTimeout(prev);
  const old = { outline: h.style.getPropertyValue('outline'), pri: h.style.getPropertyPriority('outline'), offset: h.style.getPropertyValue('outline-offset') };
  h.style.setProperty('outline', '3px solid #2D6A3E', 'important');
  h.style.setProperty('outline-offset', '3px');
  flashing.set(
    el,
    window.setTimeout(() => {
      flashing.delete(el);
      if (old.outline) h.style.setProperty('outline', old.outline, old.pri);
      else h.style.removeProperty('outline');
      if (old.offset) h.style.setProperty('outline-offset', old.offset);
      else h.style.removeProperty('outline-offset');
    }, 2400),
  );
}

function boolAttr(el: Element, name: string): boolean | null {
  const v = el.getAttribute(name);
  if (v === null) return null;
  return v === 'true' || v === 'mixed';
}

/** Current state of an original control, for mirrored controls in our UI. Never sent anywhere. */
export function renderLiveValue(el: Element | null): LiveValue {
  if (!el || !el.isConnected) return { kind: 'gone' };
  if (isCheckable(el)) return { kind: 'check', checked: el.checked, disabled: isDisabled(el) };
  if (el instanceof HTMLSelectElement) {
    return { kind: 'select', index: el.selectedIndex, options: Array.from(el.options, (o) => (o.label || o.text).trim()), disabled: isDisabled(el) };
  }
  if (el instanceof HTMLInputElement && ['button', 'submit', 'reset', 'image'].includes(el.type)) {
    return { kind: 'control', label: (el.value || el.alt || el.getAttribute('aria-label') || '').trim(), disabled: isDisabled(el), pressed: null, expanded: null };
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return { kind: 'text', value: el.value, disabled: isDisabled(el), readOnly: el.readOnly };
  }
  const role = el.getAttribute('role');
  if (role === 'checkbox' || role === 'switch' || role === 'radio') {
    return { kind: 'check', checked: el.getAttribute('aria-checked') === 'true', disabled: isDisabled(el) };
  }
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const aria = (el.getAttribute('aria-label') ?? '').trim();
  // A glyph ("–", "×") says less than the control's accessible name.
  const label = text && (!aria || /[\p{L}\p{N}]/u.test(text)) ? text : aria || text;
  return { kind: 'control', label, disabled: isDisabled(el), pressed: boolAttr(el, 'aria-pressed'), expanded: boolAttr(el, 'aria-expanded') };
}

/** A cheap signature of a live value, to tell whether a mirror needs to update. */
export function liveKey(v: LiveValue): string {
  switch (v.kind) {
    case 'text': return `t|${v.value}|${v.disabled}|${v.readOnly}`;
    case 'check': return `c|${v.checked}|${v.disabled}`;
    case 'select': return `s|${v.index}|${v.disabled}|${v.options.length}|${v.options.join('\u0001')}`;
    case 'control': return `b|${v.label}|${v.disabled}|${v.pressed}|${v.expanded}`;
    default: return 'g';
  }
}
