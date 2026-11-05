// Which element on a real page is the thing we asked the person to find (docs/design/ONBOARDING.md, round 8c, point 4).
// Pure DOM helpers, shared by task mode in the content script and by the live check of today's pages.
import type { SiteTaskSpec } from './types';

export type TargetSpec = SiteTaskSpec['target'];

/** Elements a person clicks on purpose. A found click must land on one of these (or inside one). */
export const CLICKABLE =
  'a[href], area[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="button"], input[type="submit"]';

/** Clicks this close to a target's box (CSS px), but outside it, are near-misses. */
export const NEAR_PAD = 24;

export function normText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const WORDISH = /[a-z0-9_-]/;

/**
 * True when `href` contains one of the needles, case-insensitive. A needle that ends in a letter or digit must end
 * there in the href too, so "/wiki/University_of_Florida" does not match "/wiki/University_of_Florida_Health".
 */
export function hrefMatches(href: string | null | undefined, needles: string[] | undefined): boolean {
  if (!href || !needles || needles.length === 0) return false;
  const h = href.toLowerCase();
  for (const raw of needles) {
    const needle = raw.toLowerCase();
    if (!needle) continue;
    const bounded = WORDISH.test(needle.charAt(needle.length - 1));
    let from = 0;
    for (;;) {
      const i = h.indexOf(needle, from);
      if (i < 0) break;
      if (!bounded) return true;
      const next = h.charAt(i + needle.length);
      if (!next || !WORDISH.test(next)) return true;
      from = i + 1;
    }
  }
  return false;
}

/** True when the element's text, aria-label or title equals one of the wanted texts (trimmed, case-insensitive). */
export function textMatches(el: Element, texts: string[] | undefined): boolean {
  if (!texts || texts.length === 0) return false;
  const want = new Set(texts.map(normText).filter(Boolean));
  if (want.size === 0) return false;
  const own = [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')];
  if (el instanceof HTMLInputElement) own.push(el.value);
  return own.some((c) => c != null && want.has(normText(c)));
}

function parentAcrossShadow(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** The nearest clickable at or above `el`, crossing open shadow roots. */
export function findClickable(el: Element | null): Element | null {
  for (let n: Element | null = el, i = 0; n && i < 40; n = parentAcrossShadow(n), i++) {
    if (n.matches(CLICKABLE)) return n;
  }
  return null;
}

/** The nearest link (anchor or area with an href) at or above `el`, crossing open shadow roots. */
export function findLink(el: Element | null): HTMLAnchorElement | HTMLAreaElement | null {
  for (let n: Element | null = el, i = 0; n && i < 40; n = parentAcrossShadow(n), i++) {
    if ((n instanceof HTMLAnchorElement || n instanceof HTMLAreaElement) && n.hasAttribute('href')) return n;
  }
  return null;
}

function linkHref(el: Element): string | null {
  if (el instanceof HTMLAnchorElement || el instanceof HTMLAreaElement) return el.href || el.getAttribute('href');
  return null;
}

/** Does this clickable element itself match the target (its link, its text)? */
export function clickableMatches(el: Element, target: TargetSpec): boolean {
  return hrefMatches(linkHref(el), target.hrefIncludes) || textMatches(el, target.text);
}

/**
 * Does a click on `el` count as finding the target? The click must be on (or inside) something clickable, and that
 * clickable, or an element between it and the click, must match by link or by text.
 */
export function clickMatchesTarget(el: Element | null, target: TargetSpec): boolean {
  if (!el) return false;
  const clickable = findClickable(el);
  const link = findLink(el);
  const stop = clickable ?? link;
  if (!stop) return false;
  for (let n: Element | null = el, i = 0; n && i < 40; n = parentAcrossShadow(n), i++) {
    if (clickableMatches(n, target)) return true;
    if (n === stop) break;
  }
  if (link && link !== stop && clickableMatches(link, target)) return true;
  return false;
}

/** Every clickable in the document that matches the target. */
export function findTargets(doc: Document, target: TargetSpec): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(doc.querySelectorAll(CLICKABLE))) {
    if (clickableMatches(el, target)) out.push(el);
  }
  return out;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A box someone could see and click: some size, not hidden. */
export function isShown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || '1') > 0.05;
}

/** A click at (x, y) outside every box but within `pad` of at least one. */
export function isNearMiss(x: number, y: number, boxes: Box[], pad = NEAR_PAD): boolean {
  let near = false;
  for (const b of boxes) {
    const inside = x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    if (inside) return false;
    if (x >= b.left - pad && x <= b.right + pad && y >= b.top - pad && y <= b.bottom + pad) near = true;
  }
  return near;
}
