import { HOST_TAG } from '../util/dom';
import { composedParentOf, shadowOf, type OpenClosed } from './dom';
import { normalizeSpace } from './text';

/**
 * What a sighted person can see (docs/10 §4.3: "every word in Fit view is
 * visible page text"). Text is read here, on this device, at render time; it
 * is never stored in the skeleton and never leaves the device.
 *
 * Hidden means any of: display:none, visibility:hidden, opacity:0, a
 * visually-hidden ("sr-only") box, blurred (withheld) text, transparent
 * ink, or text clipped entirely outside an overflow:hidden/clip ancestor.
 * aria-hidden alone does not hide text that is drawn on screen.
 */

type Checkable = Element & {
  checkVisibility?: (o?: Record<string, boolean>) => boolean;
};

/** Rendered and perceivable: no display:none, visibility:hidden or opacity:0 on it or an ancestor. */
export function isVisible(el: Element): boolean {
  const e = el as Checkable;
  if (typeof e.checkVisibility === 'function') {
    return e.checkVisibility({
      visibilityProperty: true,
      opacityProperty: true,
      contentVisibilityAuto: false,
    });
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/** Rendered at all (has boxes), whatever its opacity or visibility. */
export function isRenderedBox(el: Element): boolean {
  const e = el as Checkable;
  if (typeof e.checkVisibility === 'function')
    return e.checkVisibility({ contentVisibilityAuto: false });
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

interface Size {
  width: number;
  height: number;
}

function zeroAreaClip(clip: string): boolean {
  const m = /rect\(([^)]*)\)/.exec(clip);
  if (!m?.[1]) return false;
  const v = m[1]
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((p) => (p === 'auto' ? NaN : parseFloat(p)));
  if (v.length !== 4 || v.some((n) => Number.isNaN(n))) return false;
  const [top, right, bottom, left] = v as [number, number, number, number];
  return bottom - top <= 1 || right - left <= 1;
}

/**
 * Visually hidden but kept for screen readers: an absolutely positioned box
 * clipped to nothing (clip: rect(0 0 0 0), clip-path: inset(50%)) or shrunk
 * to a pixel with overflow hidden.
 */
export function isSrOnly(cs: CSSStyleDeclaration, r: Size): boolean {
  if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
  if (cs.clip && cs.clip !== 'auto' && zeroAreaClip(cs.clip)) return true;
  const cp = cs.clipPath;
  if (
    cp &&
    cp !== 'none' &&
    /inset\(\s*(?:50|100)%|circle\(\s*0(?:px|%)?\s*[ )a]/.test(cp)
  )
    return true;
  const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
  return clips && r.width <= 1 && r.height <= 1;
}

/** Text deliberately obscured (blurred teasers behind a paywall, spoilers). */
export function isObscured(cs: CSSStyleDeclaration): boolean {
  const f = cs.filter;
  if (!f || f === 'none') return false;
  const m = /blur\(\s*([\d.]+)px/.exec(f);
  return !!m && parseFloat(m[1] ?? '0') >= 2;
}

const TRANSPARENT = /^(?:transparent|rgba\([^)]*,\s*0(?:\.0+)?\))$/;

interface Clip {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clipsX = (cs: CSSStyleDeclaration): boolean =>
  cs.overflowX === 'hidden' || cs.overflowX === 'clip';
const clipsY = (cs: CSSStyleDeclaration): boolean =>
  cs.overflowY === 'hidden' || cs.overflowY === 'clip';

/** The element's clip on the axes it clips, intersected with an outer clip. */
function narrow(
  clip: Clip | null,
  el: Element,
  cs: CSSStyleDeclaration,
): Clip | null {
  const x = clipsX(cs);
  const y = clipsY(cs);
  if (!x && !y) return clip;
  const r = el.getBoundingClientRect();
  const bl = parseFloat(cs.borderLeftWidth) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  const br = parseFloat(cs.borderRightWidth) || 0;
  const bb = parseFloat(cs.borderBottomWidth) || 0;
  const own: Clip = {
    left: x ? r.left + bl : -Infinity,
    right: x ? r.right - br : Infinity,
    top: y ? r.top + bt : -Infinity,
    bottom: y ? r.bottom - bb : Infinity,
  };
  if (!clip) return own;
  return {
    left: Math.max(clip.left, own.left),
    right: Math.min(clip.right, own.right),
    top: Math.max(clip.top, own.top),
    bottom: Math.min(clip.bottom, own.bottom),
  };
}

function intersects(r: Clip, c: Clip): boolean {
  return (
    Math.min(r.right, c.right) - Math.max(r.left, c.left) > 0.5 &&
    Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top) > 0.5
  );
}

/** Intersection of the overflow clips of `el`'s composed ancestors, or null. */
export function ancestorClip(
  el: Element,
  view: Window,
  openClosed?: OpenClosed,
): Clip | null {
  let clip: Clip | null = null;
  const root = el.ownerDocument.documentElement;
  let n = composedParentOf(el, openClosed);
  for (let i = 0; n && n !== root && i < 200; i++) {
    const cs = view.getComputedStyle(n);
    if (cs.display !== 'contents') clip = narrow(clip, n, cs);
    n = composedParentOf(n, openClosed);
  }
  return clip;
}

/** Elements whose content is never visible text (values, media, code islands). */
const NO_TEXT: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'select',
  'option',
  'optgroup',
  'datalist',
  'input',
  'img',
  'picture',
  'video',
  'audio',
  'canvas',
  'iframe',
  'object',
  'embed',
  'svg',
  'head',
  HOST_TAG,
]);

/** Child nodes in the composed tree (shadow children, slots resolved to assigned nodes). */
function composedChildNodes(el: Element, openClosed?: OpenClosed): Node[] {
  const sr = shadowOf(el, openClosed);
  const src = sr ? sr.childNodes : el.childNodes;
  const out: Node[] = [];
  for (const c of src) {
    if (c.nodeType === 1 && (c as Element).localName === 'slot') {
      for (const a of (c as HTMLSlotElement).assignedNodes({ flatten: true }))
        out.push(a);
    } else out.push(c);
  }
  return out;
}

export interface VisibleTextOptions {
  /** Stop after this many characters (default 4000). */
  max?: number;
  openClosed?: OpenClosed;
}

/**
 * The visible text of `el`, whitespace normalised. Block boundaries become
 * spaces. Text clipped entirely outside an overflow:hidden/clip ancestor is
 * left out; text that is only partly clipped (an ellipsis, a line clamp) is
 * kept whole, because a person sees that it is there.
 */
export function visibleText(
  el: Element,
  opts: VisibleTextOptions = {},
): string {
  const max = opts.max ?? 4000;
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  if (!view || !el.isConnected || NO_TEXT.has(el.localName)) return '';
  const own = view.getComputedStyle(el);
  if (own.display !== 'contents') {
    if (!isVisible(el)) return '';
    // Off the page's canvas (skip links parked at left:-9999px).
    const r = el.getBoundingClientRect();
    if (r.right + view.scrollX <= 0 || r.bottom + view.scrollY <= 0) return '';
  }
  const clip = ancestorClip(el, view, opts.openClosed);
  if (clip && (clip.right <= clip.left || clip.bottom <= clip.top)) return '';
  const range = doc.createRange();
  const parts: string[] = [];
  /** Hidden twins of drawn text ("CAD14.19" in an offscreen span beside "CAD 14¹⁹"). */
  const twins: string[] = [];
  let len = 0;

  const textVisible = (t: Text, c: Clip | null): boolean => {
    if (!c) return true;
    range.selectNodeContents(t);
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return intersects(r, c);
  };

  const visit = (
    node: Element,
    cs: CSSStyleDeclaration,
    c: Clip | null,
    depth: number,
  ): void => {
    if (depth > 64 || len >= max) return;
    const inked =
      cs.visibility === 'visible' && !TRANSPARENT.test(cs.color.trim());
    const inner = cs.display === 'contents' ? c : narrow(c, node, cs);
    if (cs.contentVisibility === 'hidden') return;
    for (const child of composedChildNodes(node, opts.openClosed)) {
      if (len >= max) return;
      if (child.nodeType === 3) {
        const v = child.nodeValue ?? '';
        if (!/\S/.test(v)) {
          if (v) parts.push(' ');
          continue;
        }
        if (!inked || !textVisible(child as Text, inner)) continue;
        parts.push(v);
        len += v.length;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const e = child as Element;
      const tag = e.localName;
      if (tag === 'br') {
        parts.push(' ');
        continue;
      }
      if (NO_TEXT.has(tag)) continue;
      const ecs = view.getComputedStyle(e);
      if (ecs.display === 'none') continue;
      if (ecs.display !== 'contents') {
        if (isObscured(ecs)) continue;
        const r = e.getBoundingClientRect();
        if (ecs.opacity === '0' || isSrOnly(ecs, r)) {
          const t = e.textContent ?? '';
          if (t.length <= 40 && /\d[.,]\d/.test(t)) twins.push(t);
          continue;
        }
        // A box entirely outside the clip draws nothing, provided its
        // content cannot overflow it (an inline box, or one that clips).
        if (
          inner &&
          (r.width > 0 || r.height > 0) &&
          !intersects(r, inner) &&
          (ecs.display === 'inline' ||
            (ecs.overflowX !== 'visible' && ecs.overflowY !== 'visible'))
        )
          continue;
      }
      const block =
        !ecs.display.startsWith('inline') && ecs.display !== 'contents';
      if (block) parts.push(' ');
      // "$49<sup>99</sup>" and "CAD 14<span class=fraction>19</span>" read
      // as $49.99 and CAD 14.19, not $4999 and CAD1419.
      if (
        (tag === 'sup' ||
          /^(?:super|top|text-top)$/.test(ecs.verticalAlign) ||
          FRACTION.test(e.getAttribute('class') ?? '')) &&
        /^\s*\d{2}\s*$/.test(e.textContent ?? '') &&
        /(?:[$€£¥₹]|\b[A-Z]{3})\s?\d+$/.test(parts.slice(-4).join('').trimEnd())
      )
        parts.push('.');
      visit(e, ecs, inner, depth + 1);
      if (block) parts.push(' ');
    }
  };

  // Start from the element itself, clipped by its ancestors only.
  visit(el, own, clip, 0);
  range.detach();
  let out = normalizeSpace(parts.join(''));
  for (const t of twins) out = withSeparator(out, normalizeSpace(t));
  return out.length > max ? out.slice(0, max) : out;
}

const FRACTION = /(?:^|[\s_-])(?:price-fraction|fraction|cents?)(?:[\s_-]|$)/i;

/**
 * Where `shown` holds the characters of `twin` without its decimal
 * separator (superscript cents drawn apart), use the twin's spelling. The
 * words are the page's own either way.
 */
export function withSeparator(shown: string, twin: string): string {
  const chars = [...twin.replace(/[^\p{L}\p{N}]/gu, '')];
  if (chars.length < 3 || chars.length > 24) return shown;
  const esc = (c: string): string => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(chars.map(esc).join('[^\\p{L}\\p{N}]*'), 'u');
  const m = re.exec(shown);
  if (!m || /\d[.,]\d/.test(m[0])) return shown;
  return shown.slice(0, m.index) + twin + shown.slice(m.index + m[0].length);
}
