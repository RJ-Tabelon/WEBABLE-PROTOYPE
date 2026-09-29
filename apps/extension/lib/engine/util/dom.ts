import type { RegionEvidence } from '@webable/core/page/types';

/** WebAble's own in-page host. Custom tag: page class selectors never match it. */
export const HOST_TAG = 'webable-ui';

/** Elements never walked, measured or marked. */
export const SKIP_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'meta',
  'link',
  'title',
  'base',
  'svg',
  'math',
  'object',
  'embed',
  HOST_TAG,
]);

export type TreeScope = Document | ShadowRoot;

export const isElement = (n: unknown): n is Element =>
  typeof n === 'object' && n !== null && (n as Node).nodeType === 1;

export function isOurs(el: Element | null | undefined): boolean {
  if (!el) return false;
  const root = el.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : el;
  return host.localName === HOST_TAG || el.localName === HOST_TAG;
}

/** Parent element, crossing a shadow boundary to the host. */
export function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** `a.contains(b)` across shadow boundaries. */
export function composedContains(a: Element, b: Element): boolean {
  let n: Element | null = b;
  while (n) {
    if (n === a) return true;
    n = composedParent(n);
  }
  return false;
}

/**
 * Candidates for actionable targets (engine.md 2.6). Elements with
 * cursor:pointer whose parent is not pointer are added during the walk.
 */
export const ACTIONABLE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'label[for]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(',');

/** Things a press-and-drag or text selection legitimately owns. */
export const HANDS_OFF_SELECTOR = [
  '[draggable="true"]',
  '[role="slider"]',
  '[role="scrollbar"]',
  'input[type="range"]',
  'input:not([type])',
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input[type="password"]',
  'input[type="number"]',
  'input[type="url"]',
  'input[type="tel"]',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  'canvas',
  'video',
  'audio',
  'iframe',
  '.leaflet-container',
  '.gm-style',
  '.mapboxgl-canvas',
  '[aria-roledescription="sortable" i]',
  '[aria-roledescription="draggable" i]',
  '[data-rbd-draggable-id]',
  '[data-rfd-draggable-id]',
  '.ui-draggable',
  '.ui-sortable',
].join(',');

/** Controls that `steady_clicks` may hold a press on. */
export const ACTIVATABLE_SELECTOR = [
  'a[href]',
  'button',
  'summary',
  'label',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="reset"]',
  'input[type="image"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
].join(',');

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(',');

/** Replaced and void elements cannot host a ::after hit area. */
export const NO_PSEUDO_TAGS: ReadonlySet<string> = new Set([
  'input',
  'img',
  'select',
  'textarea',
  'video',
  'audio',
  'iframe',
  'canvas',
  'embed',
  'object',
  'br',
  'hr',
  'meter',
  'progress',
]);

/** Sum of the element's own non-whitespace text nodes (no layout). */
export function directTextLength(el: Element): number {
  let len = 0;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) len += (n.nodeValue ?? '').trim().length;
  }
  return len;
}

/** First `max` characters of the element's own text. Stays in memory, never leaves. */
export function directText(el: Element, max = 300): string {
  let out = '';
  for (let n = el.firstChild; n && out.length < max; n = n.nextSibling) {
    if (n.nodeType === 3) out += n.nodeValue ?? '';
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

const ICON_FONT_RE =
  /icon|awesome|material|glyph|symbols|fontello|ionicons|dashicons|feather/i;

export function isIconFont(fontFamily: string, sample: string): boolean {
  if (ICON_FONT_RE.test(fontFamily)) return true;
  if (!sample) return false;
  for (const ch of sample) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xe000 && cp <= 0xf8ff) return true;
  }
  return false;
}

const LANDMARK_BY_ROLE: Record<string, RegionEvidence['landmark']> = {
  banner: 'banner',
  navigation: 'navigation',
  main: 'main',
  complementary: 'complementary',
  contentinfo: 'contentinfo',
  search: 'search',
  form: 'form',
  region: 'region',
  dialog: 'dialog',
  alertdialog: 'dialog',
};

const hasAccessibleNameAttr = (el: Element): boolean =>
  el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');

/** Read-only landmark classification. Never modifies ARIA. */
export function landmarkOf(el: Element): RegionEvidence['landmark'] {
  const role = el.getAttribute('role')?.trim().toLowerCase().split(/\s+/)[0];
  if (role && LANDMARK_BY_ROLE[role]) return LANDMARK_BY_ROLE[role];
  switch (el.localName) {
    case 'main':
      return 'main';
    case 'nav':
      return 'navigation';
    case 'aside':
      return 'complementary';
    case 'search':
      return 'search';
    case 'dialog':
      return 'dialog';
    case 'header':
      return isSectioningScoped(el) ? 'none' : 'banner';
    case 'footer':
      return isSectioningScoped(el) ? 'none' : 'contentinfo';
    case 'form':
      return hasAccessibleNameAttr(el) ? 'form' : 'none';
    case 'section':
      return hasAccessibleNameAttr(el) ? 'region' : 'none';
    default:
      return 'none';
  }
}

/** header/footer inside article/aside/main/nav/section are not landmarks. */
function isSectioningScoped(el: Element): boolean {
  return (
    el.parentElement?.closest('article, aside, main, nav, section') != null
  );
}

export const LANDMARK_SELECTOR = [
  'header',
  'nav',
  'main',
  'aside',
  'footer',
  'search',
  'form[aria-label]',
  'form[aria-labelledby]',
  'section[aria-label]',
  'section[aria-labelledby]',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="main"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  '[role="search"]',
  '[role="region"]',
  'dialog[open]',
  '[role="dialog"]',
].join(',');

const TAGS = new Set<RegionEvidence['tag']>([
  'div',
  'section',
  'aside',
  'nav',
  'header',
  'footer',
  'form',
  'iframe',
  'ul',
  'article',
  'dialog',
]);

export function tagBucket(el: Element): RegionEvidence['tag'] {
  const t = el.localName as RegionEvidence['tag'];
  if (TAGS.has(t)) return t;
  if (el.localName === 'ol') return 'ul';
  return 'other';
}

/**
 * Every tree scope the engine must style: the document plus open shadow roots
 * (and closed ones when `openClosed` is available, i.e. chrome.dom in an
 * extension). Bounded so pathological component trees cannot stall the page.
 */
export function collectScopes(
  doc: Document,
  openClosed?: (el: Element) => ShadowRoot | null,
  max = 200,
): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const visit = (root: Document | ShadowRoot): void => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (
      let n = walker.nextNode();
      n && out.length < max;
      n = walker.nextNode()
    ) {
      const el = n as Element;
      if (el.localName === HOST_TAG) continue;
      const sr = (el as HTMLElement).shadowRoot ?? openClosed?.(el) ?? null;
      if (sr && !out.includes(sr)) {
        out.push(sr);
        visit(sr);
      }
    }
  };
  visit(doc);
  return out;
}

/** Shadow roots inside a subtree (recursively), bounded. */
export function shadowRootsWithin(
  root: Element,
  openClosed?: (el: Element) => ShadowRoot | null,
  max = 50,
): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const visit = (start: Element | ShadowRoot): void => {
    const doc =
      start instanceof Element ? start.ownerDocument : start.ownerDocument;
    const walker = doc.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
    let steps = 0;
    for (
      let n: Node | null = start instanceof Element ? start : walker.nextNode();
      n && out.length < max && steps < 3000;
      n = walker.nextNode(), steps++
    ) {
      const el = n as Element;
      if (el.localName === HOST_TAG) continue;
      const sr = (el as HTMLElement).shadowRoot ?? openClosed?.(el) ?? null;
      if (sr && !out.includes(sr)) {
        out.push(sr);
        visit(sr);
      }
    }
  };
  visit(root);
  return out;
}

/** Hostname of an iframe's src, parsed locally. Never stored or sent. */
export function iframeHost(el: Element, base: string): string | null {
  const src = el.getAttribute('src');
  if (!src) return null;
  try {
    return new URL(src, base).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Visible per checkVisibility, with a conservative fallback for older engines. */
export function isRendered(el: Element, opts?: { opacity?: boolean }): boolean {
  const e = el as Element & {
    checkVisibility?: (o?: Record<string, boolean>) => boolean;
  };
  if (typeof e.checkVisibility === 'function') {
    return e.checkVisibility({
      contentVisibilityAuto: true,
      visibilityProperty: true,
      opacityProperty: opts?.opacity ?? false,
    });
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}
