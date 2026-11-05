// Owner: A2, round 3: T. Optional fields may be added to these measure types; keep the names.
// Pure verify maths over before/after measurements (research-fitting §9.1–§9.8). The content script measures
// (verify-dom.ts); this module decides. Thresholds are the brief's exact values, plus round 3's text-overlap rule
// (line boxes of different elements may not newly intersect by more than 4 px²) and the page-column spill rule.
import type { CheckName, CheckResult, OpKind, OpRecord } from '../types';
import { contrastTarget } from '../color/contrast';

export interface MeasureRect { x: number; y: number; w: number; h: number }

export interface ElementMeasure {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  scrollW: number; scrollH: number; clientW: number; clientH: number;
  overflowHidden: boolean;
  fontPx: number | null;
  /**
   * The element's effective CSS zoom (Element.currentCSSZoom; 1 when none). Font sizes are in the element's own CSS px
   * and rects in viewport px, so letters-per-line divides by fontPx × cssZoom (the page column zooms the body).
   */
  cssZoom?: number;
  color: string | null; background: string | null; contrast: number | null;
  visible: boolean; focusable: boolean; inTabOrder: boolean; tabIndex: number | null;
  textChars: number;
  headingLevel: number | null;
  region: string | null;

  /* Optional, measured when available (each makes its check exact; absent means "use the fallback"). */
  /** Nearest measured ancestor's id (pairs inside one another are never "overlap"). */
  parentId?: string | null;
  /** In a position: fixed layer (dialog, cookie bar, chat panel); overlap is compared within a layer only. */
  fixedLayer?: boolean;
  /** WebAble op ids marked on this element and up to 5 ancestors (attribution). */
  opIds?: string[];
  fontWeight?: number;
  /** Share of the text's line boxes inside its clip box (§9.1 visFrac), 0..1. */
  visFrac?: number;
  /** The same share counting only the clip box's top and bottom (text cut at the sides is ignored), 0..1. */
  visFracY?: number;
  /** The text's line boxes cut to its clip box: what is drawn (text-overlap compares these when present). */
  inkLines?: MeasureRect[];
  /** Ellipsis or line-clamp currently cutting text (§9.1 trunc). */
  truncated?: boolean;
  /** Has overflow auto/scroll and content larger than its box. */
  scrollable?: boolean;
  lineHeightPx?: number;
  /** Text line boxes (from Range.getClientRects) for the overlap check; else `rect` is used. */
  lines?: MeasureRect[];
  /** 0..3 of the text's sample points covered by something else (§9.2 paint occlusion). */
  occluded?: number;
  /** Interactive control (link, button, field). Defaults to `focusable`. */
  isControl?: boolean;
  /** Computed pointer-events is not 'none' (default true). */
  pointerEvents?: boolean;
  /** At least 1 of 5 sample points hits the control or its label (only meaningful in the viewport). */
  hitOK?: boolean;
  /** Not pushed to coordinates the page cannot scroll to. */
  inDoc?: boolean;
  inViewport?: boolean;
  /** Help / contact / support / chat link or button (§9.4 help guard). */
  isHelp?: boolean;
  /** Effective opacity including ancestors (default 1). */
  opacity?: number;
  /** Image, video or canvas. */
  isMedia?: boolean;
  /** Inside a region WebAble dimmed (excluded from text contrast). */
  dimmed?: boolean;
  /** Contrast target T_c for this text; default from the page floor and the text size. */
  contrastTarget?: number;
  /** The contrast solver changed this element's colour. */
  contrastOp?: boolean;
  /** Carries a WebAble hit-area token; its edge probes all returned it; its probed box min side; the target. */
  hitToken?: boolean;
  hitEdgesOK?: boolean;
  hitBoxMin?: number;
  targetPx?: number;
  /** Stacked on purpose: absolutely positioned or sticky (itself or a near ancestor), e.g. a badge over a card. */
  stacked?: boolean;
  /** The part of `rect` inside the element's clip box (what can actually be seen). */
  visRect?: MeasureRect;
}

export interface PageMeasure {
  elements: ElementMeasure[];
  docScrollW: number; viewportW: number;
  visibleTextByRegion: Record<string, number>;
  focusableCount: number;
  tabOrder: string[];
  headingPxByLevel: Record<number, number>;
  readingAnchor: { id: string; top: number } | null;

  /* Optional */
  /** Running-text size (char-weighted median), else computed from the elements. */
  bodyPx?: number;
  /** The page's contrast floor from the fit (4.5 / 7 / 15). */
  contrastFloor?: number;
  activeId?: string | null;
  activeIsBody?: boolean;
  /** Layout-shift score observed while the person was reading after the batch. */
  clsWhileReading?: number;
  /** The page column's box (viewport x), when WebAble holds the page to a column. */
  column?: { left: number; right: number } | null;
}

/** A non-rollback finding: drop one element's token (contrast or hit area), keep the op. */
export interface TokenDrop { id: string; kind: 'contrast' | 'targets'; reason: string; opId?: string }

export interface CheckReport {
  results: CheckResult[];
  failures: CheckResult[];
  tokenDrops: TokenDrop[];
  /** Soft failures: offer Undo, never roll back (reading position, larger new scrollers). */
  soft: string[];
}

interface FailMeta { elementIds: string[]; opTokens: string[]; batch: string[] }
const META = new WeakMap<CheckResult, FailMeta>();

const MAX_FAILS_PER_CHECK = 5;
const area = (r: MeasureRect): number => Math.max(0, r.w) * Math.max(0, r.h);
const inter = (a: MeasureRect, b: MeasureRect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** New text overlap above this many px² fails (round 3). */
export const TEXT_OVERLAP_PX2 = 4;
/** Content sticking out of the page column by more than this many px fails. */
export const COLUMN_SPILL_PX = 8;
/**
 * The column may not squeeze running text below this many letters a line (from clearly more): a floated box or a
 * fixed-width side box keeps its width, and the text beside it pays (lines under about 50 letters slow reading).
 */
export const COLUMN_MIN_CPL = 40;

/**
 * Letters per line of a multi-line text element, from its line boxes: the median width of its lines (the last line
 * is usually short, so it is left out) over an average letter of half its font size. Null for one-line text.
 */
export function lettersPerLine(m: ElementMeasure): number | null {
  if (!m.lines || m.lines.length < 2 || !m.fontPx) return null;
  const rows: Array<{ top: number; left: number; right: number }> = [];
  for (const r of m.lines) {
    const row = rows.find((x) => Math.abs(x.top - r.y) < Math.max(2, r.h * 0.3));
    if (row) {
      row.left = Math.min(row.left, r.x);
      row.right = Math.max(row.right, r.x + r.w);
    } else rows.push({ top: r.y, left: r.x, right: r.x + r.w });
  }
  if (rows.length < 3) return null;
  rows.sort((a, b) => a.top - b.top);
  const spans = rows.slice(0, -1).map((x) => x.right - x.left).sort((a, b) => a - b);
  const mid = spans[Math.floor(spans.length / 2)] ?? 0;
  return mid / (0.5 * m.fontPx * (m.cssZoom && m.cssZoom > 0 ? m.cssZoom : 1));
}

/**
 * The ink core of one text line box. Range rects span the font's whole ascent and descent, so neighbouring lines in
 * tight but correct typography (line-height 1) already touch; the core (15% off the top, 10% off the bottom, 1 px off
 * each side) only meets another core when glyphs really collide.
 */
export function lineCore(r: MeasureRect): MeasureRect {
  const top = r.h * 0.15;
  const bottom = r.h * 0.1;
  return { x: r.x + 1, y: r.y + top, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - top - bottom) };
}

/** Total area (px²) where the line cores of two text elements intersect. */
export function textInk(a: MeasureRect[], b: MeasureRect[]): number {
  let sum = 0;
  for (const r of a) {
    const cr = lineCore(r);
    if (cr.w <= 0 || cr.h <= 0) continue;
    for (const q of b) {
      const cq = lineCore(q);
      if (cq.w <= 0 || cq.h <= 0) continue;
      sum += inter(cr, cq);
    }
  }
  return sum;
}
const where = (m: ElementMeasure): string => (m.region ? ` in the ${m.region}` : '');
const isControl = (m: ElementMeasure): boolean => m.isControl ?? m.focusable;

function weightedMedian(pairs: Array<[number, number]>): number | null {
  const s = pairs.filter(([v, w]) => Number.isFinite(v) && w > 0).sort((a, b) => a[0] - b[0]);
  const total = s.reduce((a, [, w]) => a + w, 0);
  if (!total) return null;
  let acc = 0;
  for (const [v, w] of s) { acc += w; if (acc >= total / 2) return v; }
  return s[s.length - 1]?.[0] ?? null;
}

function bodySize(p: PageMeasure): number | null {
  if (p.bodyPx && p.bodyPx > 0) return p.bodyPx;
  return weightedMedian(p.elements.filter((e) => e.headingLevel == null && e.textChars >= 40 && e.fontPx != null && e.visible).map((e) => [e.fontPx as number, e.textChars]));
}

class Checker {
  readonly B: Map<string, ElementMeasure>;
  readonly A: Map<string, ElementMeasure>;
  readonly common: Array<[ElementMeasure, ElementMeasure]>;
  readonly results: CheckResult[] = [];
  readonly tokenDrops: TokenDrop[] = [];
  readonly soft: string[] = [];

  constructor(readonly before: PageMeasure, readonly after: PageMeasure, readonly batch: string[]) {
    this.B = new Map(before.elements.map((e) => [e.id, e]));
    this.A = new Map(after.elements.map((e) => [e.id, e]));
    this.common = [];
    for (const [id, b] of this.B) {
      const a = this.A.get(id);
      if (a) this.common.push([b, a]);
    }
  }

  /** The batch is the page column alone (a narrower virtual window; see the extension's column op). */
  get columnOnly(): boolean {
    return this.batch.length > 0 && this.batch.every((id) => id.startsWith('column'));
  }

  opFor(a: ElementMeasure | undefined): string | undefined {
    const tokens = (a?.opIds ?? []).filter((t) => this.batch.includes(t));
    if (tokens.length === 1) return tokens[0];
    if (!tokens.length && this.batch.length === 1) return this.batch[0];
    return undefined;
  }

  fail(name: CheckName, detail: string, els: ElementMeasure[] = []): void {
    if (this.results.filter((r) => r.name === name && !r.pass).length >= MAX_FAILS_PER_CHECK) return;
    const opId = els.length ? this.opFor(els[0]) : this.batch.length === 1 ? this.batch[0] : undefined;
    const r: CheckResult = opId ? { name, pass: false, detail, opId } : { name, pass: false, detail };
    META.set(r, {
      elementIds: els.map((e) => e.id),
      opTokens: [...new Set(els.flatMap((e) => e.opIds ?? []))],
      batch: [...this.batch],
    });
    this.results.push(r);
  }

  pass(name: CheckName, detail: string): void {
    if (!this.results.some((r) => r.name === name)) this.results.push({ name, pass: true, detail });
  }

  /* §9.1 */
  clipping(): void {
    let n = 0;
    // The page column is a narrower window, so the site's own narrower layout is not a cut: a carousel or a sideways
    // row showing fewer items, a menu folded into a drawer (hidden whole), a headline its CSS shortens with an
    // ellipsis, one card's text clipped by its fixed-height card (a video placeholder's message, say). What counts is
    // copy outgrowing a fixed-height box: two or more texts each cut by more than a quarter at the top or bottom.
    const columnOnly = this.columnOnly;
    const vis = (m: ElementMeasure): number | null | undefined => (columnOnly ? m.visFracY ?? m.visFrac : m.visFrac);
    const columnCuts: Array<[ElementMeasure, number, number]> = [];
    for (const [b, a] of this.common) {
      if (b.textChars <= 0 || !b.visible) continue;
      n++;
      const va = vis(a);
      const vb = vis(b);
      if (va != null && vb != null) {
        // Only text that was (nearly) all visible can be newly cut off; a carousel slide that was already mostly
        // outside its window moving a little is not a cut.
        if (vb >= 0.9 && va < vb - 0.02) {
          if (!columnOnly) this.fail('clipping', `Text${where(a)} is cut off (${a.id}: ${pct(va)} visible, was ${pct(vb)})`, [a]);
          else if (va >= 0.05 && va < 0.75 && b.textChars >= 12) columnCuts.push([a, va, vb]);
        }
      } else {
        const cut = (m: ElementMeasure): boolean => m.overflowHidden && (m.scrollW > m.clientW + 1 || m.scrollH > m.clientH + 1);
        if (cut(a) && !cut(b)) this.fail('clipping', `Text${where(a)} is cut off by its box (${a.id})`, [a]);
      }
      if (a.truncated && !b.truncated && !columnOnly) this.fail('clipping', `Text${where(a)} is now shortened with an ellipsis (${a.id})`, [a]);
    }
    if (columnCuts.length >= 2) {
      for (const [a, va, vb] of columnCuts) this.fail('clipping', `Text${where(a)} is cut off (${a.id}: ${pct(va)} visible, was ${pct(vb)})`, [a]);
    }
    for (const [b, a] of this.common) {
      if (!a.scrollable || b.scrollable) continue;
      const lh = a.lineHeightPx ?? (a.fontPx ?? 16) * 1.3;
      if (a.clientH < 3 * lh) this.fail('clipping', `A small scroll box appeared${where(a)} (${a.id})`, [a]);
      else this.soft.push(`A scroll box appeared${where(a)} (${a.id})`);
    }
    this.pass('clipping', `No new clipping (${n} text elements checked)`);
  }

  /**
   * Round 3: text drawn over other text. Every visible text element with line boxes, anywhere on the page (not only
   * in the viewport: the person scrolls), is compared with every other one; a pair fails when the ink cores of their
   * lines newly intersect by more than 4 px². Pairs inside one another, in different fixed layers, or stacked on
   * purpose (absolutely positioned or sticky) are skipped.
   */
  textOverlap(anc: (id: string) => Set<string>): number {
    const ink = (m: ElementMeasure): MeasureRect[] => m.inkLines ?? m.lines ?? [];
    const items = this.common.filter(([b, a]) => a.visible && b.visible && a.textChars > 0 && ink(a).length > 0 && !a.stacked && !b.stacked);
    const CELL = 64;
    const grid = new Map<string, number[]>();
    items.forEach(([, a], i) => {
      for (const r of ink(a)) {
        const c = lineCore(r);
        if (c.w <= 0 || c.h <= 0) continue;
        for (let gx = Math.floor(c.x / CELL); gx <= Math.floor((c.x + c.w) / CELL); gx++) {
          for (let gy = Math.floor(c.y / CELL); gy <= Math.floor((c.y + c.h) / CELL); gy++) {
            const k = `${gx},${gy}`;
            const cell = grid.get(k);
            if (cell) { if (cell[cell.length - 1] !== i) cell.push(i); } else grid.set(k, [i]);
          }
        }
      }
    });
    const seen = new Set<string>();
    let found = 0;
    for (const cell of grid.values()) {
      for (let x = 0; x < cell.length; x++) {
        for (let y = x + 1; y < cell.length; y++) {
          const i = cell[x] as number;
          const j = cell[y] as number;
          const key = i < j ? `${i}:${j}` : `${j}:${i}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const [bi, ai] = items[i] as [ElementMeasure, ElementMeasure];
          const [bj, aj] = items[j] as [ElementMeasure, ElementMeasure];
          if ((ai.fixedLayer ?? false) !== (aj.fixedLayer ?? false)) continue;
          if (anc(ai.id).has(aj.id) || anc(aj.id).has(ai.id)) continue;
          const inkA = textInk(ink(ai), ink(aj));
          if (inkA <= TEXT_OVERLAP_PX2) continue;
          const inkB = ink(bi).length && ink(bj).length ? textInk(ink(bi), ink(bj)) : 0;
          if (inkA - inkB <= TEXT_OVERLAP_PX2) continue;
          found++;
          this.fail('overlap', `Text${where(ai)} is drawn over other text (${ai.id} and ${aj.id}, ${Math.round(inkA - inkB)} px²)`, [ai, aj]);
        }
      }
    }
    return items.length;
  }

  /* §9.2 */
  overlap(): void {
    const parent = new Map<string, string | null>();
    for (const e of this.after.elements) parent.set(e.id, e.parentId ?? null);
    for (const e of this.before.elements) if (!parent.has(e.id)) parent.set(e.id, e.parentId ?? null);
    const anc = (id: string): Set<string> => {
      const out = new Set<string>();
      let p = parent.get(id) ?? null;
      while (p && !out.has(p)) { out.add(p); p = parent.get(p) ?? null; }
      return out;
    };
    const items = this.common.filter(([b, a]) => a.visible && b.visible && a.inViewport !== false
      && (a.textChars > 0 || isControl(a) || (a.isMedia && a.rect.w >= 16 && a.rect.h >= 16)));
    const boxes = (m: ElementMeasure): MeasureRect[] => (m.lines && m.lines.length ? m.lines : [m.rect]).filter((r) => area(r) >= 1);
    const ov = (x: MeasureRect[], y: MeasureRect[]): number => {
      let best = 0;
      for (const r of x) for (const s of y) {
        const i = inter(r, s);
        if (i > 0) best = Math.max(best, i / Math.min(area(r), area(s)));
      }
      return best;
    };
    // 128 px grid over the after-boxes.
    const CELL = 128;
    const grid = new Map<string, number[]>();
    const aBoxes = items.map(([, a]) => boxes(a));
    aBoxes.forEach((bs, i) => {
      for (const r of bs) {
        for (let gx = Math.floor(r.x / CELL); gx <= Math.floor((r.x + r.w) / CELL); gx++) {
          for (let gy = Math.floor(r.y / CELL); gy <= Math.floor((r.y + r.h) / CELL); gy++) {
            const k = `${gx},${gy}`;
            const cell = grid.get(k);
            if (cell) { if (cell[cell.length - 1] !== i) cell.push(i); } else grid.set(k, [i]);
          }
        }
      }
    });
    const seen = new Set<string>();
    const ancCache = new Map<string, Set<string>>();
    const ancOf = (id: string): Set<string> => {
      let s = ancCache.get(id);
      if (!s) { s = anc(id); ancCache.set(id, s); }
      return s;
    };
    const textChecked = this.textOverlap(ancOf);
    for (const cell of grid.values()) {
      for (let x = 0; x < cell.length; x++) {
        for (let y = x + 1; y < cell.length; y++) {
          const i = cell[x] as number;
          const j = cell[y] as number;
          const key = i < j ? `${i}:${j}` : `${j}:${i}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const [bi, ai] = items[i] as [ElementMeasure, ElementMeasure];
          const [bj, aj] = items[j] as [ElementMeasure, ElementMeasure];
          if (ancOf(ai.id).has(aj.id) || ancOf(aj.id).has(ai.id)) continue;
          // Two text elements were compared line by line above.
          if (ai.textChars > 0 && aj.textChars > 0 && ai.lines?.length && aj.lines?.length) continue;
          // Stacked on purpose (carousel dots over a slide, a badge over a card).
          if (ai.stacked || aj.stacked || bi.stacked || bj.stacked) continue;
          // A fixed layer (dialog, cookie bar, chat panel) covers the page by design; compare within a layer only.
          if ((ai.fixedLayer ?? false) !== (aj.fixedLayer ?? false)) continue;
          const ovA = ov(aBoxes[i] as MeasureRect[], aBoxes[j] as MeasureRect[]);
          if (ovA < 0.15) continue;
          const ovB = ov(boxes(bi), boxes(bj));
          if (ovA - ovB >= 0.1) this.fail('overlap', `Content${where(ai)} now overlaps (${ai.id} and ${aj.id}, ${pct(ovA)})`, [ai, aj]);
        }
      }
    }
    // The page column re-lays the page out for a narrower window, so a single link landing under another changed
    // element there is the site's narrower layout meeting it; two or more covered texts still count.
    const covered = this.common.filter(([b, a]) => (a.occluded ?? 0) >= 2 && (b.occluded ?? 0) <= 1 && a.visible).map(([, a]) => a);
    if (!this.columnOnly || covered.length >= 2) {
      for (const a of covered) this.fail('overlap', `Text${where(a)} is now covered by something else (${a.id})`, [a]);
    }
    this.pass('overlap', `No new overlap (${textChecked} text elements line by line, ${items.length} boxes in view)`);
  }

  /* §9.2 horizontal overflow, and (round 3) content sticking out of the page column */
  overflow(): void {
    const ovA = this.after.docScrollW - this.after.viewportW;
    const ovB = this.before.docScrollW - this.before.viewportW;
    if (ovA > 8 && ovB <= 8) this.fail('overflow', `The page now scrolls sideways (by ${Math.round(ovA)} px)`);
    const col = this.after.column;
    if (col && col.right > col.left) {
      const vwB = this.before.viewportW;
      for (const [b, a] of this.common) {
        if (!a.visible || !b.visible || a.fixedLayer || b.fixedLayer) continue;
        if (!(a.textChars > 0 || isControl(a) || a.isMedia)) continue;
        const r = a.visRect ?? a.rect;
        const rb = b.visRect ?? b.rect;
        if (r.w < 1 || r.h < 1 || rb.w < 1) continue;
        // Already off the screen before (skip links, off-canvas menus): not the column's doing.
        if (rb.x < -1 || rb.x + rb.w > vwB + 1) continue;
        const left = col.left - r.x;
        const right = r.x + r.w - col.right;
        // Full-bleed on both sides is a design choice (calc(50% - 50vw) bands), not a spill.
        if (left > COLUMN_SPILL_PX && right > COLUMN_SPILL_PX) continue;
        const spill = Math.max(left, right);
        if (spill > COLUMN_SPILL_PX) this.fail('overflow', `Content${where(a)} sticks out of the page column (${a.id}, by ${Math.round(spill)} px)`, [a]);
      }
      for (const [b, a] of this.common) {
        if (!a.visible || !b.visible || a.fixedLayer || a.textChars < 80 || isControl(a)) continue;
        const ca = lettersPerLine(a);
        const cb = lettersPerLine(b) ?? (b.fontPx && b.lines?.length === 1 ? b.lines[0]!.w / (0.5 * b.fontPx * (b.cssZoom && b.cssZoom > 0 ? b.cssZoom : 1)) : null);
        if (ca == null || cb == null) continue;
        // The column is a narrower window: the site's narrower layout setting narrower cards is its design; only a
        // squeeze to under 25 letters a line counts then.
        const floor = this.columnOnly ? 25 : COLUMN_MIN_CPL;
        if (ca < floor && cb >= COLUMN_MIN_CPL && cb >= ca * 1.25) {
          this.fail('overflow', `Text${where(a)} is squeezed to about ${Math.round(ca)} letters a line by the page column (${a.id}, was ${Math.round(cb)})`, [a]);
        }
      }
    }
    this.pass('overflow', col ? 'No sideways scrolling; everything fits the page column' : 'No sideways scrolling');
  }

  /* §9.3 */
  contrast(): void {
    const floor = this.after.contrastFloor ?? this.before.contrastFloor ?? 4.5;
    let n = 0;
    for (const [b, a] of this.common) {
      if (b.textChars <= 0 || !a.visible || !b.visible || a.dimmed) continue;
      if (a.contrast == null || b.contrast == null) continue;
      n++;
      const T = a.contrastTarget ?? b.contrastTarget ?? contrastTarget(floor, a.fontPx ?? b.fontPx ?? 16, a.fontWeight ?? b.fontWeight ?? 400);
      if (a.contrast < Math.min(b.contrast, T) - 0.05) {
        this.fail('contrast', `Text${where(a)} got fainter (${a.id}: ${a.contrast.toFixed(1)}:1, was ${b.contrast.toFixed(1)}:1)`, [a]);
      } else if (a.contrastOp && a.contrast < T - 0.05) {
        const opId = this.opFor(a);
        this.tokenDrops.push({ id: a.id, kind: 'contrast', reason: `reached ${a.contrast.toFixed(1)}:1 of ${T}:1`, ...(opId ? { opId } : {}) });
      }
    }
    this.pass('contrast', `No text got fainter (${n} samples)`);
  }

  /* §9.4 */
  reachability(): void {
    const reachable = (m: ElementMeasure): boolean =>
      m.visible && m.pointerEvents !== false && (m.inViewport === false || m.hitOK !== false) && m.inDoc !== false && area(m.rect) >= 1;
    let n = 0;
    for (const [b, a] of this.common) {
      if (!isControl(b) || !reachable(b)) continue;
      n++;
      if (!reachable(a)) this.fail('reachability', `A control${where(a)} can no longer be clicked (${a.id})`, [a]);
    }
    // Tab sequence: the relative order of everything still tabbable must be unchanged; nothing may drop out.
    const aIdx = new Map(this.after.tabOrder.map((id, i) => [id, i]));
    let last = -1;
    let lastId: string | null = null;
    for (const id of this.before.tabOrder) {
      const i = aIdx.get(id);
      if (i === undefined) {
        const a = this.A.get(id);
        if (a && a.visible && this.after.tabOrder.length) this.fail('reachability', `A control left the keyboard order (${id})`, [a]);
        continue;
      }
      if (i < last) {
        const a = this.A.get(id);
        this.fail('reachability', `The keyboard order changed (${id} now comes before ${lastId})`, a ? [a] : []);
        break;
      }
      last = i;
      lastId = id;
    }
    const act = this.before.activeId;
    if (act && this.after.activeIsBody) {
      const a = this.A.get(act);
      if (!a || !a.visible) this.fail('reachability', `Keyboard focus was lost (${act} is hidden)`, a ? [a] : []);
    }
    for (const [b, a] of this.common) {
      if (!b.isHelp || !b.visible || (b.opacity ?? 1) < 0.9) continue;
      if (!a.visible || (a.opacity ?? 1) < 0.9) this.fail('reachability', `A help link faded or hid (${a.id})`, [a]);
    }
    for (const a of this.after.elements) {
      if (!a.hitToken) continue;
      const small = a.hitBoxMin != null && a.targetPx != null && a.hitBoxMin < a.targetPx;
      if (a.hitEdgesOK === false || small) {
        const opId = this.opFor(a);
        this.tokenDrops.push({ id: a.id, kind: 'targets', reason: small ? `click area ${Math.round(a.hitBoxMin ?? 0)} px of ${a.targetPx} px` : 'an edge of the click area hits something else', ...(opId ? { opId } : {}) });
      }
    }
    this.pass('reachability', `Every control is still reachable and the keyboard order is unchanged (${n} controls)`);
  }

  /* §9.5 */
  contentLoss(): void {
    let lost = 0;
    const losers: Array<[ElementMeasure, number]> = [];
    let textEls = 0;
    for (const [b, a] of this.common) {
      if (b.textChars <= 0 || !b.visible || (b.visFrac ?? 1) < 0.5) continue;
      textEls++;
      if (!a.visible || (a.visFrac ?? 1) < 0.5 || area(a.rect) < 1) {
        lost += b.textChars;
        losers.push([a, b.textChars]);
      }
    }
    losers.sort((x, y) => y[1] - x[1]);
    for (const [a, chars] of losers) this.fail('content_loss', `Text${where(a)} disappeared (${a.id}, ${chars} characters)`, [a]);
    for (const [b, a] of this.common) {
      if (!b.isMedia || !b.visible || b.rect.w < 32 || b.rect.h < 32) continue;
      if (!a.visible || area(a.rect) < 0.5 * area(b.rect)) this.fail('content_loss', `An image${where(a)} hid or shrank (${a.id})`, [a]);
    }
    if (!textEls) {
      for (const [region, bChars] of Object.entries(this.before.visibleTextByRegion)) {
        const aChars = this.after.visibleTextByRegion[region] ?? 0;
        if (bChars > 0 && aChars < bChars - Math.max(20, 0.02 * bChars)) {
          this.fail('content_loss', `Text in the ${region} disappeared (${bChars - aChars} characters)`);
        }
      }
    }
    this.pass('content_loss', `No content lost (${textEls} text elements${lost ? `, ${lost} characters` : ''})`);
  }

  /* §9.6 */
  hierarchy(): void {
    const byRegion = new Map<string, Array<{ b: number; a: number; m: ElementMeasure }>>();
    for (const [b, a] of this.common) {
      if (b.textChars <= 0 || !a.visible || !b.visible || b.fontPx == null || a.fontPx == null) continue;
      const k = a.region ?? b.region ?? '';
      const list = byRegion.get(k) ?? [];
      list.push({ b: b.fontPx, a: a.fontPx, m: a });
      byRegion.set(k, list);
    }
    let pairs = 0;
    const bodyB0 = bodySize(this.before);
    // A heading raised past running text is the point of the heading ramp (heading_scale), not a swap; a heading
    // passing display text (a lead headline set in a span, well above body size) still is.
    const isHeading = (m: ElementMeasure): boolean =>
      (m.headingLevel != null && m.headingLevel <= 3) || (m.opIds ?? []).some((t) => t.startsWith('heading_scale'));
    const raisedPastBody = (it: { b: number; m: ElementMeasure }, past: ElementMeasure): boolean =>
      isHeading(past) && it.m.headingLevel == null && bodyB0 != null && it.b <= bodyB0 * 1.2;
    for (const list of byRegion.values()) {
      list.sort((x, y) => x.b - y.b);
      let p = 0;
      let best: { a: number; m: ElementMeasure } | null = null;
      for (const it of list) {
        // Every element clearly smaller before (b·1.05 < this) must stay ≤ this after.
        while (p < list.length && (list[p] as { b: number }).b * 1.05 < it.b) {
          const q = list[p] as { a: number; m: ElementMeasure };
          if (!best || q.a > best.a) best = q;
          p++;
        }
        pairs += p;
        if (best && it.a < best.a - 0.01 && !raisedPastBody(it, best.m)) {
          this.fail('hierarchy', `Text sizes swapped order${where(it.m)} (${it.m.id} is now smaller than ${best.m.id})`, [it.m, best.m]);
        }
      }
    }
    const bodyB = bodySize(this.before);
    const bodyA = bodySize(this.after);
    if (bodyB != null && bodyA != null) {
      for (const [b, a] of this.common) {
        const lvl = b.headingLevel ?? a.headingLevel;
        if (lvl == null || lvl > 3 || b.fontPx == null || a.fontPx == null || !a.visible) continue;
        if (b.fontPx > bodyB && a.fontPx < bodyA) this.fail('hierarchy', `A heading${where(a)} is now smaller than body text (${a.id})`, [a]);
      }
    }
    const lv = Object.keys(this.before.headingPxByLevel).map(Number).sort((x, y) => x - y);
    for (let i = 0; i < lv.length; i++) {
      for (let j = i + 1; j < lv.length; j++) {
        const hi = lv[i] as number;
        const lo = lv[j] as number;
        const bHi = this.before.headingPxByLevel[hi];
        const bLo = this.before.headingPxByLevel[lo];
        const aHi = this.after.headingPxByLevel[hi];
        const aLo = this.after.headingPxByLevel[lo];
        if (bHi == null || bLo == null || aHi == null || aLo == null) continue;
        if (bHi > bLo * 1.05 && aHi < aLo) this.fail('hierarchy', `Level ${hi} headings are now smaller than level ${lo} headings`);
      }
    }
    this.pass('hierarchy', `Text sizes keep their order (${pairs} pairs checked)`);
  }

  /* §9.7 (soft only) */
  readingPosition(): void {
    const anchor = this.before.readingAnchor;
    if (anchor) {
      let top: number | null = null;
      if (this.after.readingAnchor?.id === anchor.id) top = this.after.readingAnchor.top;
      else {
        const a = this.A.get(anchor.id);
        if (a) top = a.rect.y;
      }
      if (top == null) this.soft.push('The reading position could not be restored');
      else if (Math.abs(top - anchor.top) > 2) this.soft.push(`The reading position moved by ${Math.round(Math.abs(top - anchor.top))} px`);
    }
    if ((this.after.clsWhileReading ?? 0) > 0.1) this.soft.push(`The page shifted while reading (score ${(this.after.clsWhileReading ?? 0).toFixed(2)})`);
    const s = this.soft.filter((x) => /reading|shifted/.test(x));
    this.results.push({ name: 'reading_position', pass: true, detail: s.length ? `soft: ${s.join('; ')}` : 'The reading position held' });
  }

  run(): CheckReport {
    this.clipping();
    this.overlap();
    this.overflow();
    this.contrast();
    this.reachability();
    this.contentLoss();
    this.hierarchy();
    this.readingPosition();
    return { results: this.results, failures: this.results.filter((r) => !r.pass), tokenDrops: this.tokenDrops, soft: this.soft };
  }
}

/** All checks with token drops and soft findings (see `runChecks` for the plain list). */
export function runChecksDetailed(before: PageMeasure, after: PageMeasure, opIds: string[]): CheckReport {
  return new Checker(before, after, opIds).run();
}

/**
 * Run §9.1–§9.7 on a before/after pair. One passing result per clean check, one failing result per finding
 * (≤ 5 per check). A hard failure means: roll back the op `attribute()` names. Reading position is soft only
 * (pass: true, detail starts with 'soft:'): offer Undo, never roll back.
 */
export function runChecks(before: PageMeasure, after: PageMeasure, opIds: string[]): CheckResult[] {
  return runChecksDetailed(before, after, opIds).results;
}

/** Bisect order per check (§9.8: text map → spacing → measure → gaps → unpin, plus the ops each check can catch). */
const RISK: Record<CheckName, OpKind[]> = {
  clipping: ['heading_scale', 'text_map', 'spacing', 'column', 'measure', 'weight', 'targets', 'unpin_sticky', 'page_zoom', 'promote_main'],
  overlap: ['heading_scale', 'text_map', 'spacing', 'column', 'targets', 'measure', 'unpin_sticky', 'weight', 'promote_main', 'page_zoom'],
  overflow: ['column', 'heading_scale', 'text_map', 'measure', 'spacing', 'targets', 'weight', 'page_zoom'],
  hierarchy: ['heading_scale', 'text_map', 'weight', 'page_zoom'],
  contrast: ['contrast', 'dim', 'weight', 'focus_ring', 'text_map'],
  reachability: ['targets', 'steady_clicks', 'debounce', 'dim', 'unpin_sticky', 'promote_main', 'column', 'heading_scale', 'text_map', 'spacing', 'measure', 'focus_ring'],
  content_loss: ['column', 'heading_scale', 'text_map', 'spacing', 'measure', 'motion', 'dim', 'unpin_sticky', 'page_zoom'],
  reading_position: ['page_zoom', 'column', 'heading_scale', 'text_map', 'spacing', 'measure', 'unpin_sticky'],
  visual: ['calm_view'],
};

function byRisk(name: CheckName, ops: OpRecord[]): string | null {
  const order = RISK[name] ?? [];
  let best: OpRecord | null = null;
  let bestRank = Infinity;
  for (const o of ops) {
    const r = order.indexOf(o.kind);
    if (r >= 0 && r < bestRank) { best = o; bestRank = r; }
  }
  return best?.id ?? null;
}

/**
 * Which op a failing check is attributed to (§9.8): the check's own opId; else the op tokens on the failing
 * element and its ancestors; else element-scoped ops targeting it; else the batch's ops in risk order; else
 * the most recent applied op (so the caller can bisect). Null for passing results or when nothing is applied.
 */
export function attribute(fail: CheckResult, ops: OpRecord[]): string | null {
  if (fail.pass) return null;
  const applied = ops.filter((o) => o.status === 'applied');
  if (!applied.length) return null;
  const meta = META.get(fail);
  const batch = meta?.batch.length ? applied.filter((o) => meta.batch.includes(o.id)) : [];
  const pool = batch.length ? batch : applied;
  if (fail.opId && pool.some((o) => o.id === fail.opId)) return fail.opId;
  const els = meta?.elementIds ?? [...fail.detail.matchAll(/\b(n\d{1,5})\b/g)].map((m) => m[1] as string);
  const tokens = meta?.opTokens ?? [];
  const tokenOps = pool.filter((o) => tokens.includes(o.id));
  if (tokenOps.length) return byRisk(fail.name, tokenOps) ?? tokenOps[tokenOps.length - 1]?.id ?? null;
  const targeted = pool.filter((o) => o.scope === 'element' && o.targetIds.some((t) => els.includes(t)));
  if (targeted.length) return byRisk(fail.name, targeted) ?? targeted[targeted.length - 1]?.id ?? null;
  return byRisk(fail.name, pool) ?? pool[pool.length - 1]?.id ?? null;
}
