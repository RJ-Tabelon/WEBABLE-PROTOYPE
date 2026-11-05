// Owner: X (round 7). The DOM side of extraction (browser only): the reader's tree nodes, JSON-LD script text, the site's
// name, and an svg logo as a data URL. Never reads a form field's value.

import type { SAttrs, SNode } from './types';

const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'OPTGROUP', 'DATALIST']);

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Direct text of an element, and its segments when text follows a child element. Form fields give ''. */
export function directSegs(el: Element): { text: string; segs?: Array<[number, string]> } {
  if (FIELD_TAGS.has(el.tagName) || (el as HTMLElement).isContentEditable) return { text: '' };
  let k = 0;
  let late = false;
  const segs: Array<[number, string]> = [];
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) {
      k++;
      continue;
    }
    if (c.nodeType !== 3) continue;
    const t = collapse((c as Text).data);
    if (!t) continue;
    if (k > 0) late = true;
    segs.push([k, t]);
  }
  const text = collapse(segs.map((s) => s[1]).join(' '));
  return late ? { text, segs } : { text };
}

/** A tree node for one visible element the reader walked. */
export function snapNode(el: Element, tag: string, cs: CSSStyleDeclaration, rect: DOMRect, sx: number, sy: number, ci: number): SNode {
  const { text, segs } = directSegs(el);
  const cls = `${el.id ?? ''} ${el.getAttribute('class') ?? ''}`.toLowerCase().slice(0, 300).trim();
  const n: SNode = {
    tag: tag.toLowerCase(),
    cls,
    text,
    x: Math.round(rect.left + sx),
    y: Math.round(rect.top + sy),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    fs: parseFloat(cs.fontSize) || 0,
    fw: parseFloat(cs.fontWeight) || 400,
    kids: [],
    ci,
    el,
  };
  if (segs) n.segs = segs;
  const role = el.getAttribute('role');
  if (role) n.role = role.toLowerCase().split(/\s+/)[0] ?? role.toLowerCase();
  const attrs: SAttrs = {};
  const label = el.getAttribute('aria-label');
  if (label) attrs.label = collapse(label).slice(0, 200);
  const title = el.getAttribute('title');
  if (title) attrs.title = collapse(title).slice(0, 200);
  const ip = el.getAttribute('itemprop');
  if (ip) attrs.itemprop = ip;
  if (tag === 'IMG') {
    const img = el as HTMLImageElement;
    const alt = el.getAttribute('alt');
    if (alt !== null) attrs.alt = collapse(alt).slice(0, 200);
    const src = img.currentSrc || img.src;
    if (src && (!src.startsWith('data:') || src.length < 20000)) attrs.src = src;
    if (img.naturalWidth) attrs.nw = img.naturalWidth;
    if (img.naturalHeight) attrs.nh = img.naturalHeight;
  } else if (tag === 'SVG' || tag === 'svg') {
    const t = el.querySelector(':scope > title');
    if (t?.textContent) attrs.title = collapse(t.textContent).slice(0, 200);
  } else if (tag === 'A') {
    const href = el.getAttribute('href');
    if (href !== null) attrs.href = href;
  } else if (tag === 'TD' || tag === 'TH') {
    const span = Number(el.getAttribute('colspan') ?? '1');
    if (Number.isFinite(span) && span > 1) attrs.colspan = Math.min(12, span);
  } else if (tag === 'TIME') {
    const dt = el.getAttribute('datetime');
    if (dt) attrs.datetime = dt;
  }
  if (Object.keys(attrs).length) n.attrs = attrs;
  return n;
}

/** The text of every application/ld+json script on the page (capped). */
export function readLdTexts(doc: Document = document): string[] {
  const out: string[] = [];
  let total = 0;
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json" i]')).slice(0, 30)) {
    const t = s.textContent ?? '';
    if (!t || total + t.length > 3_000_000) continue;
    total += t.length;
    out.push(t);
  }
  return out;
}

/** The site's own name, when the page states one (og:site_name, application-name). */
export function readSiteName(doc: Document = document): string | null {
  for (const sel of ['meta[property="og:site_name" i]', 'meta[name="application-name" i]', 'meta[name="apple-mobile-web-app-title" i]']) {
    const v = doc.querySelector(sel)?.getAttribute('content');
    if (v && collapse(v)) return collapse(v).slice(0, 80);
  }
  // "Refunds | Internal Revenue Service": the last part of a split title names the site.
  const parts = collapse(doc.title ?? '').split(/\s+[|–—]\s+|\s+-\s+/).filter(Boolean);
  const last = parts.length >= 2 ? parts[parts.length - 1] : undefined;
  return last && last.length <= 40 ? last : null;
}

/** An inline svg as a data URL (references to the page's own symbols are copied in). '' when too big or empty. */
export function svgDataUrl(svg: Element): string {
  try {
    const clone = svg.cloneNode(true) as Element;
    for (const use of Array.from(clone.querySelectorAll('use'))) {
      const ref = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
      if (!ref.startsWith('#')) continue;
      const target = svg.ownerDocument.getElementById(ref.slice(1));
      if (!target) continue;
      const g = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
      for (const c of Array.from(target.childNodes)) g.appendChild(c.cloneNode(true));
      if (!clone.getAttribute('viewBox') && target.getAttribute('viewBox')) clone.setAttribute('viewBox', target.getAttribute('viewBox') ?? '');
      use.replaceWith(g);
    }
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // The logo's colour often comes from CSS `currentColor`: pin it to what the page shows.
    const color = getComputedStyle(svg).color;
    if (color && !clone.getAttribute('color')) clone.setAttribute('color', color);
    const r = svg.getBoundingClientRect();
    if (!clone.getAttribute('width') && r.width) clone.setAttribute('width', String(Math.round(r.width)));
    if (!clone.getAttribute('height') && r.height) clone.setAttribute('height', String(Math.round(r.height)));
    const xml = new XMLSerializer().serializeToString(clone);
    if (!xml || xml.length > 60_000 || !/<(path|g|rect|circle|polygon|text|image|ellipse|line|polyline)\b/i.test(xml)) return '';
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  } catch {
    return '';
  }
}
