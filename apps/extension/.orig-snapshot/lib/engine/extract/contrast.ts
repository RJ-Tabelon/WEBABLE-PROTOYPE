import {
  contrastRatio,
  over,
  parseColor,
  WHITE,
  type RGBA,
} from '../util/color';
import { composedContains, isOurs } from '../util/dom';

/**
 * Effective background of a text element (engine.md 2.4): a hybrid of axe's
 * background stack and a cheap ancestor walk. In the viewport the native
 * elementsFromPoint stack is used; elsewhere the ancestor chain.
 *
 * `kind` tells the contrast op whether a colour solve is safe:
 * solid/translucent -> solve; image/gradient/overlap/unknown -> skip.
 */
export type BgKind =
  'solid' | 'translucent' | 'gradient' | 'image' | 'overlap' | 'unknown';

export interface Background {
  bg: RGBA;
  kind: BgKind;
}

const IMAGE_TAGS = new Set(['img', 'video', 'canvas', 'picture', 'iframe']);

function layerOf(cs: CSSStyleDeclaration): {
  kind: BgKind | null;
  color: RGBA | null;
} {
  if (cs.backgroundImage && cs.backgroundImage !== 'none') {
    return {
      kind: /gradient\(/.test(cs.backgroundImage) ? 'gradient' : 'image',
      color: null,
    };
  }
  if (
    (cs.mixBlendMode && cs.mixBlendMode !== 'normal') ||
    (cs.filter && cs.filter !== 'none') ||
    (cs.backdropFilter && cs.backdropFilter !== 'none')
  ) {
    return { kind: 'unknown', color: null };
  }
  return { kind: null, color: parseColor(cs.backgroundColor) };
}

function composite(layers: readonly RGBA[], kind: BgKind): Background {
  let bg: RGBA = WHITE; // canvas default under a transparent root
  for (let j = layers.length - 1; j >= 0; j--)
    bg = over(layers[j] ?? WHITE, bg);
  const translucent = layers.some((l) => l[3] < 1);
  return { bg, kind: kind === 'solid' && translucent ? 'translucent' : kind };
}

/** Ancestor-chain background: used off-screen and as the stack fallback. */
export function ancestorBackground(el: Element, view: Window): Background {
  const layers: RGBA[] = [];
  let kind: BgKind = 'solid';
  let n: Element | null = el;
  let depth = 0;
  while (n && depth++ < 40) {
    const cs = view.getComputedStyle(n);
    const l = layerOf(cs);
    if (l.kind) {
      kind = l.kind;
      break;
    }
    if (l.color === null) {
      kind = 'unknown';
      break;
    }
    if (l.color[3] > 0) {
      layers.push(l.color);
      if (l.color[3] >= 1) break;
    }
    if (n !== el && IMAGE_TAGS.has(n.localName)) {
      kind = 'image';
      break;
    }
    n = n.parentElement ?? (n.getRootNode() as ShadowRoot).host ?? null;
  }
  return composite(layers, kind);
}

/** Viewport background via the hit-test stack under the element's first line. */
export function effectiveBackground(
  el: Element,
  rect: DOMRectReadOnly,
  view: Window,
): Background {
  const doc = el.ownerDocument;
  const x = rect.left + Math.min(rect.width / 2, 40);
  const y = rect.top + Math.min(rect.height / 2, 12);
  if (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight) {
    return ancestorBackground(el, view);
  }
  const stack = doc.elementsFromPoint(x, y).filter((e) => !isOurs(e));
  let i = stack.findIndex(
    (e) => e === el || composedContains(e, el) || composedContains(el, e),
  );
  if (i < 0) return ancestorBackground(el, view);
  let kind: BgKind = stack
    .slice(0, i)
    .some((e) => !composedContains(e, el) && !composedContains(el, e))
    ? 'overlap'
    : 'solid';
  // Descendants of the text element above it in the stack are not background.
  while (
    i < stack.length &&
    stack[i] !== el &&
    composedContains(el, stack[i] as Element)
  )
    i++;
  const layers: RGBA[] = [];
  for (; i < stack.length; i++) {
    const e = stack[i] as Element;
    const l = layerOf(view.getComputedStyle(e));
    if (l.kind) {
      kind = kind === 'overlap' ? 'overlap' : l.kind;
      break;
    }
    if (l.color === null) {
      kind = 'unknown';
      break;
    }
    if (l.color[3] > 0) {
      layers.push(l.color);
      if (l.color[3] >= 1) break;
    }
    if (e !== el && IMAGE_TAGS.has(e.localName)) {
      kind = 'image';
      break;
    }
  }
  return composite(layers, kind);
}

export interface Foreground {
  fg: RGBA | null;
  /** Text paint we cannot model (fill colour, stroke, heavy shadow). */
  unknown: boolean;
}

export function foregroundOf(cs: CSSStyleDeclaration): Foreground {
  const fill = cs.getPropertyValue('-webkit-text-fill-color');
  const stroke = parseFloat(
    cs.getPropertyValue('-webkit-text-stroke-width') || '0',
  );
  const color = parseColor(cs.color);
  const fillColor = fill ? parseColor(fill) : null;
  const fillDiffers =
    fillColor !== null &&
    color !== null &&
    fillColor.some((v, i) => Math.abs(v - (color[i] ?? 0)) > 0.5);
  const shadow = cs.textShadow && cs.textShadow !== 'none';
  return {
    fg: color,
    unknown: color === null || fillDiffers || stroke > 0 || Boolean(shadow),
  };
}

export interface ContrastMeasure {
  ratio: number | null;
  kind: BgKind | 'fg_unknown';
  fg: RGBA | null;
  bg: RGBA | null;
}

export function measureContrast(
  el: Element,
  view: Window,
  inViewport: boolean,
): ContrastMeasure {
  const cs = view.getComputedStyle(el);
  const f = foregroundOf(cs);
  if (f.unknown || !f.fg)
    return { ratio: null, kind: 'fg_unknown', fg: f.fg, bg: null };
  const b = inViewport
    ? effectiveBackground(el, el.getBoundingClientRect(), view)
    : ancestorBackground(el, view);
  if (b.kind !== 'solid' && b.kind !== 'translucent') {
    return { ratio: null, kind: b.kind, fg: f.fg, bg: b.bg };
  }
  return { ratio: contrastRatio(f.fg, b.bg), kind: b.kind, fg: f.fg, bg: b.bg };
}
