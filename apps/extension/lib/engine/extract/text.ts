import type { TextFact } from '../types';
import { directText } from '../util/dom';

/**
 * Text measurement helpers. Samples of the page's own text are read into
 * memory for canvas measurement only; they never leave the function.
 */

let canvasCtx: CanvasRenderingContext2D | null | undefined;

function ctx2d(doc: Document): CanvasRenderingContext2D | null {
  if (canvasCtx !== undefined) return canvasCtx;
  try {
    // A detached document canvas: web fonts registered on document.fonts apply.
    const c = doc.createElement('canvas');
    canvasCtx = c.getContext('2d');
  } catch {
    canvasCtx = null;
  }
  return canvasCtx;
}

function fontShorthand(cs: CSSStyleDeclaration): string {
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

/** Average advance per character of `el`'s own text in its font, px. */
export function avgCharWidth(
  el: Element,
  cs: CSSStyleDeclaration,
): number | null {
  const c = ctx2d(el.ownerDocument);
  if (!c) return null;
  const sample = directText(el, 300);
  if (sample.length < 20) return null;
  c.font = fontShorthand(cs);
  const ls = parseFloat(cs.letterSpacing);
  const w =
    c.measureText(sample).width +
    (Number.isFinite(ls) ? ls * sample.length : 0);
  return w > 0 ? w / sample.length : null;
}

const xHeightCache = new Map<string, number>();

/**
 * x-height / font-size of a font family (0.52 is typical of Arial/Helvetica).
 * Used to make the text floor font-size-adjust aware. Null when unmeasurable.
 */
export function xHeightRatio(
  doc: Document,
  family: string,
  weight: string,
): number | null {
  const key = `${weight}|${family}`;
  const hit = xHeightCache.get(key);
  if (hit !== undefined) return hit;
  const c = ctx2d(doc);
  if (!c) return null;
  c.font = `normal ${weight} 100px ${family}`;
  const m = c.measureText('x');
  const ratio =
    m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent / 100 : null;
  if (ratio !== null) xHeightCache.set(key, ratio);
  return ratio;
}

const BLOCK_DISPLAY = /^(block|list-item|flow-root|table-cell)$/;

/**
 * Characters per line for block paragraphs (engine.md 2.5, cheap method):
 * content width / average glyph advance. Only paragraphs long enough to fill
 * at least one line count. Returns individual samples.
 */
export function lineLengths(
  texts: readonly TextFact[],
  view: Window,
  max = 30,
): number[] {
  const out: number[] = [];
  for (const t of texts) {
    if (out.length >= max) break;
    if (t.icon || t.chars < 80) continue;
    const cs = view.getComputedStyle(t.el);
    if (!BLOCK_DISPLAY.test(cs.display)) continue;
    const avg = avgCharWidth(t.el, cs);
    if (!avg) continue;
    const padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const width =
      (t.el as HTMLElement).clientWidth -
      (Number.isFinite(padding) ? padding : 0);
    if (width <= 0) continue;
    const cpl = width / avg;
    if (t.chars < cpl) continue; // a single short line says nothing about measure
    out.push(Math.round(cpl));
  }
  return out;
}

/** Parse a computed line-height; null for `normal`. */
export function lineHeightPx(cs: CSSStyleDeclaration): number | null {
  if (cs.lineHeight === 'normal') return null;
  const v = parseFloat(cs.lineHeight);
  return Number.isFinite(v) ? v : null;
}

export function fontWeightNum(cs: CSSStyleDeclaration): number {
  const w = cs.fontWeight;
  if (w === 'bold') return 700;
  if (w === 'normal') return 400;
  const n = parseInt(w, 10);
  return Number.isFinite(n) ? n : 400;
}
