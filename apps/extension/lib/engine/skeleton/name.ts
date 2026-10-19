import { HOST_TAG } from '../util/dom';
import { shadowOf, type OpenClosed } from './dom';
import { isButtonInput } from './roles';
import { normalizeSpace } from './text';

/**
 * Accessible-name approximation (accname 1.2, the parts that matter for
 * labelling Fit view's controls): aria-labelledby, aria-label, native
 * labels (label[for], alt, caption, legend, value of button inputs), name
 * from content, then title and placeholder. The value of a text field is
 * never read: a name never contains what someone typed.
 */

const NAME_MAX = 300;

function idRefText(el: Element, ids: string): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const doc = el.ownerDocument;
  const out: string[] = [];
  for (const id of ids.split(/\s+/)) {
    if (!id) continue;
    const ref =
      (root as Partial<Pick<Document, 'getElementById'>>).getElementById?.(
        id,
      ) ?? doc.getElementById(id);
    // Referenced content counts even when hidden (accname step 2B).
    if (ref && ref !== el) out.push(contentName(ref, 0, true));
    else if (ref === el) out.push(el.getAttribute('aria-label') ?? '');
  }
  return normalizeSpace(out.join(' '));
}

/** Elements whose content is not part of a name. */
const SKIP: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'textarea',
  'select',
  'datalist',
  HOST_TAG,
]);

function hiddenForName(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.hasAttribute('hidden')) return true;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const cs = view.getComputedStyle(el);
  return cs.display === 'none' || cs.visibility === 'hidden';
}

/** Name from content: text, alt of images, aria-label of embedded parts. */
function contentName(
  el: Element,
  depth: number,
  includeHidden = false,
  openClosed?: OpenClosed,
): string {
  if (depth > 24) return '';
  const parts: string[] = [];
  const sr = shadowOf(el, openClosed);
  const nodes = sr ? sr.childNodes : el.childNodes;
  for (const n of nodes) {
    if (n.nodeType === 3) {
      parts.push(n.nodeValue ?? '');
      continue;
    }
    if (n.nodeType !== 1) continue;
    const c = n as Element;
    const tag = c.localName;
    if (SKIP.has(tag)) continue;
    if (!includeHidden && hiddenForName(c)) continue;
    if (tag === 'slot') {
      for (const a of (c as HTMLSlotElement).assignedNodes({ flatten: true })) {
        if (a.nodeType === 3) parts.push(a.nodeValue ?? '');
        else if (a.nodeType === 1)
          parts.push(
            nodeName(a as Element, depth + 1, includeHidden, openClosed),
          );
      }
      continue;
    }
    parts.push(' ', nodeName(c, depth + 1, includeHidden, openClosed), ' ');
  }
  return normalizeSpace(parts.join(''));
}

/** One embedded node's contribution to its ancestor's name. */
function nodeName(
  el: Element,
  depth: number,
  includeHidden: boolean,
  openClosed?: OpenClosed,
): string {
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  const tag = el.localName;
  if (tag === 'img' || tag === 'area') return el.getAttribute('alt') ?? '';
  if (tag === 'input') {
    if (isButtonInput(el))
      return el.getAttribute('value') ?? el.getAttribute('alt') ?? '';
    return '';
  }
  if (tag === 'svg') {
    const t = el.querySelector(':scope > title');
    return t?.textContent ?? '';
  }
  return contentName(el, depth, includeHidden, openClosed);
}

function labelsOf(el: Element): string {
  const labels = (el as HTMLInputElement).labels;
  if (!labels || labels.length === 0) return '';
  const out: string[] = [];
  for (const l of labels) out.push(contentName(l, 0));
  return normalizeSpace(out.join(' '));
}

/**
 * At most NAME_MAX characters, with a figure repeated back to back said
 * once: a price's offscreen copy beside a copy in a non-boolean
 * aria-hidden box reads "List Price: CAD 16.99 List Price: CAD 16.99".
 */
const cap = (s: string): string => {
  const t =
    s.length > 600
      ? s
      : s
          .replace(/(\S.{6,}?)(?: \1)+(?= |$)/g, (m, p: string) =>
            /\d/.test(p) ? p : m,
          )
          // The offscreen copy spaced, the drawn one not: "CAD 18.41 CAD18.41".
          .replace(PRICE_TWICE, '$1');
  return t.length > NAME_MAX ? t.slice(0, NAME_MAX) : t;
};
const PRICE_TWICE =
  /((?:[A-Z]{2,3}|[$€£¥₹])\s?(\d[\d.,]*\d))\s+(?:[A-Z]{2,3}|[$€£¥₹])\s?\2(?![\d.,]*\d)/g;

function explicitWidgetRole(el: Element): boolean {
  return /^(?:radio|checkbox|switch|option|menuitemradio|menuitemcheckbox|tab)$/.test(
    (el.getAttribute('role') ?? '').trim().toLowerCase(),
  );
}

/** Accessible name of `el` (whitespace normalised, at most 300 characters). */
export function accessibleName(el: Element, openClosed?: OpenClosed): string {
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const t = idRefText(el, lb);
    if (t) return cap(t);
  }
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return cap(normalizeSpace(aria));
  const tag = el.localName;
  switch (tag) {
    case 'input': {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'submit' || type === 'reset' || type === 'button') {
        const v = el.getAttribute('value');
        if (v && v.trim()) return cap(normalizeSpace(v));
        // A button input given a widget role (a radio swatch) has no
        // "Submit" of its own: an unnamed swatch stays unnamed.
        if (type !== 'button' && !explicitWidgetRole(el))
          return type === 'submit' ? 'Submit' : 'Reset';
        break;
      }
      if (type === 'image') {
        const alt = el.getAttribute('alt');
        if (alt && alt.trim()) return cap(normalizeSpace(alt));
        break;
      }
      const l = labelsOf(el);
      if (l) return cap(l);
      break;
    }
    case 'select':
    case 'textarea':
    case 'meter':
    case 'progress':
    case 'output': {
      const l = labelsOf(el);
      if (l) return cap(l);
      break;
    }
    case 'img':
    case 'area': {
      const alt = el.getAttribute('alt');
      if (alt && alt.trim()) return cap(normalizeSpace(alt));
      break;
    }
    case 'fieldset': {
      const legend = el.querySelector(':scope > legend');
      if (legend) {
        const t = contentName(legend, 0);
        if (t) return cap(t);
      }
      break;
    }
    case 'table': {
      const caption = el.querySelector(':scope > caption');
      if (caption) {
        const t = contentName(caption, 0);
        if (t) return cap(t);
      }
      break;
    }
    case 'figure': {
      const fc = el.querySelector(':scope > figcaption');
      if (fc) {
        const t = contentName(fc, 0);
        if (t) return cap(t);
      }
      break;
    }
    case 'iframe':
    case 'svg':
      break;
    default: {
      const t = contentName(el, 0, false, openClosed);
      if (t) return cap(t);
    }
  }
  if (tag === 'svg') {
    const t = el.querySelector(':scope > title')?.textContent;
    if (t && t.trim()) return cap(normalizeSpace(t));
  }
  const title = el.getAttribute('title');
  if (title && title.trim()) return cap(normalizeSpace(title));
  const ph =
    el.getAttribute('placeholder') ?? el.getAttribute('aria-placeholder');
  if (ph && ph.trim()) return cap(normalizeSpace(ph));
  return '';
}
