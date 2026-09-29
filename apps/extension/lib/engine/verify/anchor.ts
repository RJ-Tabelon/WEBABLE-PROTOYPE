import { directTextLength, isOurs } from '../util/dom';

/**
 * Point of regard (UAAG 1.8): before a write, remember the first text block
 * near the top of the viewport and its offset; after the write, scroll so it
 * sits where it was. Applies, rollbacks and undo all keep the reader's place.
 */
export interface Anchor {
  el: Element;
  top: number;
}

function textBlock(el: Element | null): Element | null {
  for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) {
    if (n.localName === 'body' || n.localName === 'html') return null;
    if (directTextLength(n) > 0) return n;
  }
  return el;
}

export function readingAnchor(
  doc: Document,
  main: Element | null,
): Anchor | null {
  const view = doc.defaultView;
  if (!view) return null;
  const vw = view.innerWidth;
  const vh = view.innerHeight;
  let x = vw / 2;
  if (main?.isConnected) {
    const r = main.getBoundingClientRect();
    if (r.width > 0)
      x = Math.min(Math.max(r.left + Math.min(r.width / 2, 200), 1), vw - 1);
  }
  for (const f of [0.12, 0.2, 0.3, 0.45]) {
    const hit = doc.elementFromPoint(x, f * vh);
    if (!hit || isOurs(hit) || hit === doc.body || hit === doc.documentElement)
      continue;
    const el = textBlock(hit);
    if (!el) continue;
    return { el, top: el.getBoundingClientRect().top };
  }
  return null;
}

/** Scroll so the anchor is back at its offset. Returns the correction applied (px). */
export function restoreAnchor(doc: Document, a: Anchor | null): number {
  const view = doc.defaultView;
  if (!a || !view || !a.el.isConnected) return 0;
  const delta = a.el.getBoundingClientRect().top - a.top;
  if (Math.abs(delta) <= 2) return 0;
  view.scrollBy({ top: delta, left: 0, behavior: 'instant' as ScrollBehavior });
  return delta;
}
