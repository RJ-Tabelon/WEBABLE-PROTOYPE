import { HOST_TAG } from '../util/dom';

/**
 * Composed-tree access for the skeleton (docs/10 §4). The skeleton, its
 * registry and its locators all walk the same tree: a shadow host's children
 * are its shadow root's children (closed roots too, through `openClosed`),
 * and a <slot> is replaced by the elements assigned to it (or its fallback
 * content). Using one definition everywhere is what lets a slot path or a
 * locator recorded at read time be replayed later.
 */

export type OpenClosed = (el: Element) => ShadowRoot | null;

/** Elements the skeleton never enters or emits. */
export const SKEL_SKIP: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'meta',
  'link',
  'title',
  'base',
  'br',
  'wbr',
  'param',
  'source',
  'track',
  'map',
  'area',
  'option',
  'optgroup',
  'datalist',
  HOST_TAG,
]);

/** The element's author shadow root, open or (through `openClosed`) closed. */
export function shadowOf(
  el: Element,
  openClosed?: OpenClosed,
): ShadowRoot | null {
  const open = (el as HTMLElement).shadowRoot;
  if (open) return open;
  // attachShadow() only works on custom elements and the built-ins below.
  if (
    !openClosed ||
    (!el.localName.includes('-') && !SHADOW_CAPABLE.has(el.localName))
  )
    return null;
  try {
    return openClosed(el);
  } catch {
    return null;
  }
}

/** Built-in elements that may host an author shadow root (DOM spec). */
const SHADOW_CAPABLE: ReadonlySet<string> = new Set([
  'article',
  'aside',
  'blockquote',
  'body',
  'div',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'main',
  'nav',
  'p',
  'section',
  'span',
]);

function pushComposed(c: Element, out: Element[]): void {
  if (c.localName === 'slot') {
    const slot = c as HTMLSlotElement;
    // flatten: nested slots resolve to their assigned elements, and a slot
    // with nothing assigned renders its fallback content.
    for (const a of slot.assignedElements({ flatten: true })) out.push(a);
    return;
  }
  out.push(c);
}

/** Children in the composed (rendered) tree. */
export function composedKids(el: Element, openClosed?: OpenClosed): Element[] {
  const sr = shadowOf(el, openClosed);
  const src = sr ? sr.children : el.children;
  const out: Element[] = [];
  for (const c of src) pushComposed(c, out);
  return out;
}

function findSlot(sr: ShadowRoot, el: Element): HTMLSlotElement | null {
  for (const s of sr.querySelectorAll('slot')) {
    if ((s as HTMLSlotElement).assignedElements().includes(el))
      return s as HTMLSlotElement;
  }
  return null;
}

/** Inverse of composedKids: the element whose composed children include `el`. */
export function composedParentOf(
  el: Element,
  openClosed?: OpenClosed,
): Element | null {
  const parent = el.parentElement;
  if (parent) {
    const sr = shadowOf(parent, openClosed);
    if (sr) {
      // A light child of a host renders where its slot is.
      const slot =
        (el as Element & { assignedSlot: HTMLSlotElement | null })
          .assignedSlot ?? findSlot(sr, el);
      return slot ? composedParentOf(slot, openClosed) : null;
    }
    // Fallback content of a slot: the slot is transparent.
    if (parent.localName === 'slot')
      return composedParentOf(parent, openClosed);
    return parent;
  }
  const root = el.parentNode;
  return root instanceof ShadowRoot ? root.host : null;
}

/** `a` is `b` or one of its composed ancestors. */
export function composedIncludes(
  a: Element,
  b: Element,
  openClosed?: OpenClosed,
): boolean {
  let n: Element | null = b;
  for (let i = 0; n && i < 400; i++) {
    if (n === a) return true;
    n = composedParentOf(n, openClosed);
  }
  return false;
}

/** The focused element, through open (and opened closed) shadow roots. */
export function deepActiveElement(
  doc: Document,
  openClosed?: OpenClosed,
): Element | null {
  let a: Element | null = doc.activeElement;
  for (let i = 0; a && i < 32; i++) {
    const sr = shadowOf(a, openClosed);
    const inner = sr?.activeElement ?? null;
    if (!inner) break;
    a = inner;
  }
  if (!a || a === doc.body || a === doc.documentElement) return null;
  return a;
}

/** State-like class tokens that differ between items of one template. */
const STATE_CLASS =
  /^(is-|has-|js-|active|selected|current|hover|focus|open|closed|expanded|collapsed|first|last|odd|even|visible|hidden|unread|read|checked|disabled|loading|loaded)/i;

/**
 * Class tokens used to compare siblings: state classes and numbered tokens
 * are dropped so a selected or unread item still matches its siblings.
 * Values stay in memory; they are never sent anywhere.
 */
export function classTokens(el: Element): string[] {
  const out: string[] = [];
  for (const k of el.classList) {
    if (k.length >= 40 || /\d{2,}/.test(k) || STATE_CLASS.test(k)) continue;
    out.push(k);
    if (out.length >= 12) break;
  }
  return out.sort();
}

export function isHtmlElement(el: Element): el is HTMLElement {
  return (el as HTMLElement).style !== undefined && el.namespaceURI === HTML_NS;
}

export const HTML_NS = 'http://www.w3.org/1999/xhtml';
export const SVG_NS = 'http://www.w3.org/2000/svg';
