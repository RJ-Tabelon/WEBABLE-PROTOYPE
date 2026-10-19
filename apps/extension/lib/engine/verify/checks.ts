import type { OpId } from '@webable/core/ops/catalog';
import type { VerifyCode } from '@webable/core/policy/types';

import { measureContrast } from '../extract/contrast';
import type { ViewportGuard } from '../fitview/types';
import { opsNear, opsWithin, tokenOp, tokensOf } from '../ops/marks';
import {
  area,
  BoxGrid,
  boxOf,
  gaps,
  inflate,
  intersection,
  type Box,
} from '../util/geometry';
import {
  composedContains,
  composedParent,
  directTextLength,
  FOCUSABLE_SELECTOR,
  isIconFont,
  isOurs,
  isRendered,
  landmarkOf,
} from '../util/dom';

/**
 * Native, geometry-based verification (engine.md 4, docs/10 §5.2). A
 * baseline snapshot of a bounded probe set is taken before the write and
 * diffed after it settles. Nearby tokens identify candidates only; the engine
 * confirms causal layout changes with synchronous counterfactual reads before
 * rolling anything back.
 *
 * Besides clipping, overlap, overflow, controls, focus and contrast, v2
 * checks what a page's reader sees as a whole: size order within a record or
 * section (hierarchy), one size per template field (consistency), how much
 * text is cut off (truncation), and text growing over pictures and icons.
 */

// ---------------------------------------------------------------------------
// Template fields and size groups (shared with the text and target ops)
// ---------------------------------------------------------------------------

/** Classes one instance of a template toggles on its own: state, not structure. */
const STATE_CLASS =
  /^(?:is-|has-)?(?:active|selected|current|hover|hovered|focus|focused|focus-visible|open|opened|expanded|collapsed|visible|hidden|disabled|checked|pressed|loading|loaded)$/i;

/** Sorted structural class tokens of one element (state classes dropped). */
export function classSignature(el: Element): string {
  const raw = el.getAttribute('class');
  if (!raw) return '';
  const out: string[] = [];
  for (const t of raw.split(/\s+/)) if (t && !STATE_CLASS.test(t)) out.push(t);
  return out.sort().slice(0, 8).join('.');
}

function sigOf(el: Element | null, cache?: Map<Element, string>): string {
  if (!el) return '';
  let s = cache?.get(el);
  if (s === undefined) {
    s = `${el.localName}.${classSignature(el)}`;
    cache?.set(el, s);
  }
  return s;
}

/**
 * A template field: tag + class signature + the parent's. Every instance of
 * a field gets one decision (grown, held or excluded), so rows and cards
 * never come out as a patchwork (docs/10 §1).
 */
export function templateKey(el: Element, cache?: Map<Element, string>): string {
  return `${sigOf(el, cache)}<${sigOf(composedParent(el), cache)}`;
}

/** Containers whose texts are read together: sections, lists, tables and rows. */
const SECTION_SELECTOR = [
  'article',
  'section',
  'aside',
  'figure',
  'table',
  'ul',
  'ol',
  'dl',
  'form',
  'details',
  'dialog',
  'main',
  '[role="article"]',
  '[role="region"]',
  '[role="feed"]',
  '[role="list"]',
  '[role="listitem"]',
  '[role="grid"]',
  '[role="table"]',
  '[role="row"]',
].join(',');

export interface GroupCache {
  sig: Map<Element, string>;
  repeated: Map<Element, boolean>;
  group: Map<Element, Element>;
}

export const groupCache = (): GroupCache => ({
  sig: new Map(),
  repeated: new Map(),
  group: new Map(),
});

/** One instance of a repeated template: at least two siblings share its signature. */
export function isRepeated(n: Element, ctx: GroupCache): boolean {
  const hit = ctx.repeated.get(n);
  if (hit !== undefined) return hit;
  let repeated = false;
  const parent = n.parentElement;
  if (parent && parent.childElementCount >= 3) {
    const mine = sigOf(n, ctx.sig);
    let same = 0;
    let seen = 0;
    for (
      let k = parent.firstElementChild;
      k && seen < 40;
      k = k.nextElementSibling, seen++
    ) {
      if (k === n || sigOf(k, ctx.sig) !== mine) continue;
      if (++same >= 2) {
        repeated = true;
        break;
      }
    }
  }
  ctx.repeated.set(n, repeated);
  return repeated;
}

const CONTROL_TEXT =
  'button, [role="button"], label, summary, legend, select, option, input, textarea';

/**
 * The label of a control (a button, a field's label): ranked with nothing.
 * Its size against the text around it is not the reading order, and a
 * fixed-size button must not hold back the text of a whole section.
 */
export function isControlText(el: Element): boolean {
  for (
    let n: Element | null = el, i = 0;
    n && i < 4;
    n = composedParent(n), i++
  )
    if (n.matches(CONTROL_TEXT)) return true;
  return false;
}

/** Boxes that operate something: a glyph label of one of these is a symbol, not text. */
const CONTROL_BOX = `${CONTROL_TEXT}, a[href], [role="link"], [role="tab"], [role="menuitem"], [role="option"]`;
const HEADING_TAG = /^h[1-6]$/;
/** Characters (code points) a control's whole label has at most to be a glyph ("+", "×", "OK"). */
const GLYPH_MAX_CHARS = 2;

/** Text in a heading (h1-h6 or role=heading, within five ancestors). */
export function inHeading(el: Element): boolean {
  for (
    let n: Element | null = el, i = 0;
    n && i < 5;
    n = composedParent(n), i++
  )
    if (HEADING_TAG.test(n.localName) || n.getAttribute('role') === 'heading')
      return true;
  return false;
}

/**
 * How a control's label ranks as a ceiling for the text beside it (docs/10
 * §5.2, ops/rank.ts): size order is the reading order, and a control's size
 * beside the text is not part of it.
 * - 'glyph': the control's whole label is one or two characters or an icon
 *   (a "+" button at the browser's default 13.33 px, an icon font): it caps
 *   no text.
 * - 'label': any other text inside a control (isControlText): it caps no
 *   running text. Labels in fixed-size buttons still keep to their box
 *   (text_floor's controlFit, the spill check), and are capped themselves.
 * - null: it ranks as text. A heading always does, in a control or not (an
 *   accordion's button in an h3 stays above the text it introduces).
 */
export function controlCeiling(
  el: Element,
  style: (n: Element) => CSSStyleDeclaration = (n) =>
    (n.ownerDocument.defaultView as Window).getComputedStyle(n),
): 'glyph' | 'label' | null {
  if (inHeading(el)) return null;
  for (
    let n: Element | null = el, i = 0;
    n && i < 4;
    n = composedParent(n), i++
  ) {
    if (!n.matches(CONTROL_BOX)) continue;
    const label = (n.textContent ?? '').replace(/\s+/g, '');
    if (
      [...label].length <= GLYPH_MAX_CHARS ||
      isIconFont(style(el).fontFamily, label.slice(0, 8))
    )
      return 'glyph';
    break;
  }
  return isControlText(el) ? 'label' : null;
}

/** A size group that is a record (a row, a card) rather than a section. */
export const isRecordGroup = (g: Element, ctx: GroupCache): boolean =>
  ctx.repeated.get(g) === true;

/**
 * The group a text's size is ranked in: its record (the nearest repeated
 * template instance, such as a row or a card), else its section, else `stop`
 * (the region root). The text op plans against these groups and the
 * verifier checks them, so both agree on what "the same place" means.
 */
export function sizeGroup(
  el: Element,
  stop: Element,
  ctx: GroupCache = groupCache(),
): Element {
  const hit = ctx.group.get(el);
  if (hit) return hit;
  let out = stop;
  let n = composedParent(el);
  for (let depth = 0; n && depth < 12; depth++, n = composedParent(n)) {
    if (n === stop || n.localName === 'body' || n.localName === 'html') break;
    if (depth < 8 && isRepeated(n, ctx)) {
      out = n;
      break;
    }
    if (n.matches(SECTION_SELECTOR)) {
      out = n;
      break;
    }
  }
  ctx.group.set(el, out);
  return out;
}

/**
 * The root elements of an extraction's regions (PageFacts.regions) and
 * their component keys. Roots that share a key (every card of one
 * component) are one region.
 */
export function regionRootsOf(
  regions: ReadonlyMap<string, ReadonlyArray<{ el: Element }>>,
): Map<Element, string> {
  const out = new Map<Element, string>();
  for (const [key, list] of regions)
    for (const f of list) if (f.el.isConnected) out.set(f.el, key);
  return out;
}

/** The region of text outside every region root: the page. */
export const PAGE_REGION = 'page';

/**
 * The region a text belongs to: the key of the nearest root of the last
 * extraction's regions (the v1 segmentation), else the page. Sizes are
 * ranked per region (docs/10 §10 hierarchy gate): text_floor plans against
 * these regions and the verifier checks them, so both agree.
 */
export function regionResolver(
  roots: ReadonlyMap<Element, string>,
): (el: Element) => string {
  const cache = new Map<Element, string>();
  return (el) => {
    const chain: Element[] = [];
    let out = PAGE_REGION;
    for (
      let n: Element | null = el, i = 0;
      n && i < 64;
      n = composedParent(n), i++
    ) {
      const hit = cache.get(n);
      if (hit) {
        out = hit;
        break;
      }
      const key = roots.get(n);
      if (key !== undefined) {
        out = key;
        break;
      }
      chain.push(n);
    }
    for (const c of chain) cache.set(c, out);
    return out;
  };
}

/**
 * Text no one sees: inside a screen-reader-only box (absolute, 1-2 px or
 * clipped away) or one placed off screen. Its size is no rank a reader sees.
 */
export function visuallyHidden(
  el: Element,
  view: Window,
  style: (n: Element) => CSSStyleDeclaration = (n) => view.getComputedStyle(n),
): boolean {
  for (
    let n: Element | null = el, i = 0;
    n && i < 4;
    n = composedParent(n), i++
  ) {
    if (n.localName === 'body' || n.localName === 'html') break;
    const cs = style(n);
    if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
    const r = n.getBoundingClientRect();
    if (
      r.width <= 2 ||
      r.height <= 2 ||
      r.right + view.scrollX <= 0 ||
      r.bottom + view.scrollY <= 0 ||
      (cs.clip !== '' && cs.clip !== 'auto') ||
      /inset\(\s*(?:50|100)%/.test(cs.clipPath)
    )
      return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

export interface ProbeSet {
  /** Text elements whose size/spacing changes (overlap check). */
  text: Element[];
  /** Boxes near each marked text it could now overlap: text, pictures, icons. */
  neighbours: Map<Element, Element[]>;
  /** Neighbours that are pictures, icons or video rather than text. */
  media: Set<Element>;
  /** Overflow-clipping containers of marked elements (clip check). */
  containers: Element[];
  /** Interactive elements in and near the viewport. */
  controls: Element[];
  /** Marked elements in and near the viewport: what a change can move over a control. */
  marked: Element[];
  /** Text with a known baseline contrast. */
  contrast: Element[];
  /**
   * Resized text and the texts ranked with it: one list per region (the
   * extraction's regions, near the viewport) and one per record read whole.
   * Every pair in a list is ranked, whatever keeps a text at its size.
   */
  groups: Array<{ members: Element[]; record: boolean }>;
  /** Resized text and the control box it labels: text must not spill out of it. */
  spill: Array<[Element, Element]>;
  /** Template field of every ranked text (consistency check). */
  fields: Map<Element, string>;
  /** Ranked texts inside boxes that can cut text off (truncation check). */
  cuttable: Element[];
}

interface State {
  box: Box;
  visible: boolean;
  visibleRead: boolean;
  /** Hit-test at the centre lands on the element (null: centre off-screen). */
  hit: boolean | null;
  clipped: boolean;
  ratio: number | null;
  /** Computed font size, px. */
  fontPx: number | null;
  /** Share of the element's box its clipping boxes leave visible (1 = all). */
  shown: number | null;
  /** The part of the box its clipping ancestors leave on screen. */
  vbox: Box | null;
}

export interface Snapshot {
  states: Map<Element, State>;
  overflowX: number;
  active: Element | null;
}

export interface Failure {
  code: VerifyCode;
  el: Element;
  ops: Set<OpId>;
  /** What now covers a control that was reachable before (hit-test failures). */
  cover?: Element;
}

const LAYOUT_TOKENS_TEXT = /^(tf|ls|ll)/;
/** Pictures and icons that text must not grow over. */
const MEDIA_SELECTOR = 'img, picture, video, canvas, svg, [role="img"]';

export function overflowOf(
  cs: CSSStyleDeclaration,
): 'hidden' | 'scroll' | 'visible' {
  const vals = [cs.overflowX, cs.overflowY];
  if (vals.some((v) => v === 'hidden' || v === 'clip')) return 'hidden';
  if (vals.some((v) => v === 'auto' || v === 'scroll')) return 'scroll';
  return 'visible';
}

/** Large scroll panes are designed to scroll; only small boxes cut content off. */
function cutsContent(el: Element, cs: CSSStyleDeclaration): boolean {
  const kind = overflowOf(cs);
  if (kind === 'visible') return false;
  const h = el as HTMLElement;
  return !(kind === 'scroll' && h.clientHeight >= 200 && h.clientWidth >= 200);
}

export function isClipped(el: Element, view: Window): boolean {
  const h = el as HTMLElement;
  const cs = view.getComputedStyle(el);
  if (!cutsContent(el, cs)) return false;
  return (
    h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1
  );
}

/** Up to 3 clipping ancestors (and the element itself) of each marked element. */
export function clippingContainers(
  els: readonly Element[],
  view: Window,
  cap = 200,
): Element[] {
  const out = new Set<Element>();
  for (const el of els) {
    let n: Element | null = el;
    for (let i = 0; n && i < 4 && out.size < cap; i++, n = n.parentElement) {
      if (n.localName === 'body' || n.localName === 'html') break;
      if (overflowOf(view.getComputedStyle(n)) !== 'visible') out.add(n);
    }
  }
  return [...out];
}

/** The padding box of a clipping container, in viewport coordinates. */
function clipBox(n: Element): Box {
  const r = n.getBoundingClientRect();
  const h = n as HTMLElement;
  const left = r.left + h.clientLeft;
  const top = r.top + h.clientTop;
  return {
    left,
    top,
    right: left + h.clientWidth,
    bottom: top + h.clientHeight,
  };
}

/**
 * How much of an element's text its own box and up to three clipping
 * ancestors leave visible (1 = all of it). Ellipsis, line clamps and
 * overflow:hidden boxes all lower it.
 */
export function shownFraction(el: Element, view: Window): number {
  let f = 1;
  const cs = view.getComputedStyle(el);
  const h = el as HTMLElement;
  if (cs.display !== 'inline' && cutsContent(el, cs)) {
    if (h.scrollWidth > h.clientWidth + 1)
      f = Math.min(f, h.clientWidth / h.scrollWidth);
    if (h.scrollHeight > h.clientHeight + 1)
      f = Math.min(f, h.clientHeight / h.scrollHeight);
  }
  const box = boxOf(el.getBoundingClientRect());
  const a = area(box);
  if (a < 1) return f;
  for (
    let n = composedParent(el), i = 0;
    n && i < 3;
    n = composedParent(n), i++
  ) {
    if (n.localName === 'body' || n.localName === 'html') break;
    if (!cutsContent(n, view.getComputedStyle(n))) continue;
    f = Math.min(f, intersection(box, clipBox(n)) / a);
  }
  return Math.max(0, Math.min(1, f));
}

/** The element or one of its three nearest ancestors can cut text off. */
function canCut(el: Element, view: Window): boolean {
  for (
    let n: Element | null = el, i = 0;
    n && i < 4;
    n = composedParent(n), i++
  ) {
    if (n.localName === 'body' || n.localName === 'html') return false;
    const cs = view.getComputedStyle(n);
    if (cs.display !== 'inline' && cutsContent(n, cs)) return true;
  }
  return false;
}

export interface ProbeInput {
  doc: Document;
  view: Window;
  /** Elements the batch will mark, by op. */
  marked: ReadonlyArray<readonly [Element, string]>;
  /** Already-marked elements (earlier batches) worth re-checking. */
  existing: readonly Element[];
  targets: readonly Element[];
  contrast: readonly Element[];
  /**
   * Text elements of the page (the extraction's): candidates for size
   * ranking and for overlap. Content that arrived since is found through
   * the groups of the marked text.
   */
  peers?: readonly Element[];
  /** Roots inside which sizes are ranked (text_floor's scope). Default: body. */
  textScope?: readonly Element[];
  /** Region roots of the last extraction and their keys: sizes are ranked per region. */
  regions?: ReadonlyMap<Element, string>;
}

/** Boxes a resized label sits in: past their edges the text spills out. */
const SPILL_BOX =
  'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], summary';

/** The nearest control box (not inline) around a label, within eight ancestors. */
function controlBoxOf(el: Element, view: Window): Element | null {
  for (
    let n: Element | null = el, i = 0;
    n && i < 8;
    n = composedParent(n), i++
  ) {
    if (n.localName === 'body' || n.localName === 'html') return null;
    if (!n.matches(SPILL_BOX)) continue;
    const d = view.getComputedStyle(n).display;
    if (d !== 'inline' && d !== 'contents') return n;
  }
  return null;
}

const hasSizeToken = (el: Element): boolean =>
  tokensOf(el).some((t) => tokenOp(t) === 'text_floor');

export function buildProbes(p: ProbeInput): ProbeSet {
  const vh = p.view.innerHeight;
  const vw = p.view.innerWidth;
  const rects = new Map<Element, DOMRect>();
  const rect = (el: Element): DOMRect => {
    let r = rects.get(el);
    if (!r) rects.set(el, (r = el.getBoundingClientRect()));
    return r;
  };
  const near = (el: Element): boolean => {
    const r = rect(el);
    return (
      r.bottom > -0.25 * vh && r.top < 1.25 * vh && r.right > 0 && r.left < vw
    );
  };
  const text = new Set<Element>();
  const sized = new Set<Element>();
  const all = new Set<Element>();
  for (const [el, token] of p.marked) {
    all.add(el);
    if (LAYOUT_TOKENS_TEXT.test(token)) text.add(el);
    if (tokenOp(token) === 'text_floor') sized.add(el);
  }
  for (const el of p.existing) {
    all.add(el);
    if (el.isConnected && hasSizeToken(el)) sized.add(el);
  }
  const textList = [...text].filter(near).slice(0, 100);
  const peers = (p.peers ?? []).slice(0, 2500);

  // Geometric neighbours: any nearby text or picture, however deeply each is
  // wrapped (a header label six levels down has no siblings to compare).
  const media = new Set<Element>();
  const neighbours = new Map<Element, Element[]>();
  if (textList.length) {
    const cand: Array<{ id: number; box: Box; el: Element }> = [];
    const add = (el: Element): void => {
      const r = rect(el);
      if (r.width * r.height < 1) return;
      cand.push({ id: cand.length, box: boxOf(r), el });
    };
    for (const el of peers) {
      if (cand.length >= 700) break;
      if (!el.isConnected || isOurs(el) || !near(el)) continue;
      add(el);
    }
    for (const el of textList) add(el);
    const found = p.doc.querySelectorAll(MEDIA_SELECTOR);
    for (let i = 0; i < Math.min(found.length, 600); i++) {
      const m = found[i] as Element;
      if (media.size >= 300) break;
      if (isOurs(m) || !near(m)) continue;
      const r = rect(m);
      if (r.width < 6 || r.height < 6) continue;
      media.add(m);
      add(m);
    }
    const grid = new BoxGrid(cand, 96);
    for (const el of textList) {
      const b = boxOf(rect(el));
      const reach = Math.min(
        320,
        Math.max(24, b.right - b.left, b.bottom - b.top),
      );
      const dist = new Map<Element, number>();
      for (const c of grid.near(inflate(b, reach, reach))) {
        if (c.el === el || dist.has(c.el)) continue;
        if (composedContains(el, c.el) || composedContains(c.el, el)) continue;
        const g = gaps(b, c.box);
        dist.set(c.el, Math.max(g.dx, g.dy));
      }
      neighbours.set(
        el,
        [...dist]
          .sort((x, y) => x[1] - y[1])
          .slice(0, 10)
          .map(([n]) => n),
      );
    }
  }

  // Size groups: resized text plus the texts ranked with it, per region
  // (every text there, controls and chips included) and per record (read
  // whole, including content newer than the extraction).
  const scopes = (p.textScope?.length ? p.textScope : [p.doc.body]).filter(
    (r) => r.isConnected,
  );
  const scopeOf = (el: Element): Element | null =>
    scopes.find((r) => r === el || composedContains(r, el)) ?? null;
  const regionOf = regionResolver(p.regions ?? new Map<Element, string>());
  const gctx = groupCache();
  const regionGroups = new Map<string, Element[]>();
  const recordGroups = new Map<Element, Element[]>();
  const members = new Set<Element>();
  // Only text a reader sees: its own characters in a box larger than a
  // screen-reader-only one (a container's size is no rank anyone reads).
  const seen = (el: Element): boolean => {
    if (directTextLength(el) === 0) return false;
    const r = rect(el);
    return r.width > 2 && r.height > 2;
  };
  const joinRegion = (el: Element, onlyKnown: boolean): void => {
    if (members.size >= 600 || !seen(el)) return;
    const g = regionOf(el);
    let list = regionGroups.get(g);
    if (!list) {
      if (onlyKnown) return;
      regionGroups.set(g, (list = []));
    }
    if (list.length >= 150 || list.includes(el)) return;
    list.push(el);
    members.add(el);
  };
  const joinRecord = (el: Element, onlyKnown: boolean): void => {
    if (!seen(el)) return;
    const s = scopeOf(el);
    if (!s) return;
    const g = sizeGroup(el, s, gctx);
    if (g === s || !isRecordGroup(g, gctx)) return;
    let list = recordGroups.get(g);
    if (!list) {
      if (onlyKnown) return;
      recordGroups.set(g, (list = []));
    }
    if (list.length >= 40 || list.includes(el)) return;
    list.push(el);
    members.add(el);
  };
  const sizedNear = [...sized]
    .filter((e) => e.isConnected && near(e))
    .slice(0, 120);
  for (const el of sizedNear) {
    joinRegion(el, false);
    joinRecord(el, false);
  }
  if (members.size) {
    for (const el of peers) {
      if (!el.isConnected || isOurs(el) || members.has(el) || !near(el))
        continue;
      joinRegion(el, true);
      joinRecord(el, true);
    }
    for (const [g, list] of [...recordGroups]) {
      if (list.length >= 40) continue;
      const inside = g.querySelectorAll('*');
      if (inside.length > 240) continue;
      for (const el of inside) {
        if (directTextLength(el) === 0 || isOurs(el)) continue;
        if (sizeGroup(el, scopeOf(el) ?? g, gctx) === g) joinRecord(el, true);
      }
    }
  }
  const groupList = [
    ...[...regionGroups.values()].map((m) => ({ members: m, record: true })),
    ...[...recordGroups.values()].map((m) => ({ members: m, record: true })),
  ]
    .filter((g) => g.members.length >= 2)
    .slice(0, 120);
  const spill: Array<[Element, Element]> = [];
  for (const el of sizedNear) {
    if (spill.length >= 80) break;
    const box = controlBoxOf(el, p.view);
    if (box) spill.push([el, box]);
  }
  const fields = new Map<Element, string>();
  const cuttable: Element[] = [];
  // Every resized text near the viewport, controls included, is checked for
  // consistency and truncation; ranked peers too.
  for (const el of [...members, ...sizedNear]) {
    if (fields.has(el)) continue;
    fields.set(el, templateKey(el, gctx.sig));
    if (cuttable.length < 240 && canCut(el, p.view)) cuttable.push(el);
  }

  // Boxes that cut text off: those of marked elements near the viewport, and
  // those of every ranked text whose truncation is read (a record read whole
  // reaches below the fold). A box that starts clipping is 'clip'; one that
  // already clipped and now cuts more is 'truncation'.
  const containers = clippingContainers(
    [...[...all].filter(near).slice(0, 300), ...cuttable],
    p.view,
    150,
  );
  const controls = p.targets
    .filter((el) => el.isConnected && !isOurs(el) && near(el))
    .slice(0, 150);
  const contrast = p.contrast.filter((el) => el.isConnected).slice(0, 60);
  return {
    text: textList,
    neighbours,
    media,
    containers,
    controls,
    marked: [...all].filter((el) => el.isConnected && near(el)).slice(0, 600),
    contrast,
    groups: groupList,
    fields,
    cuttable,
    spill,
  };
}

interface Needs {
  visible?: boolean;
  hit?: boolean;
  clip?: boolean;
  ratio?: boolean;
  size?: boolean;
  cut?: boolean;
  vbox?: boolean;
}

/**
 * The part of a box its clipping ancestors leave visible: text scrolled
 * away inside a carousel, or cut off by a card, overlaps nothing.
 */
function visibleBox(
  el: Element,
  r: DOMRect,
  view: Window,
  clips: Map<Element, Box | null>,
): Box {
  let box = boxOf(r);
  for (
    let n = composedParent(el), i = 0;
    n && i < 8;
    n = composedParent(n), i++
  ) {
    if (n.localName === 'body' || n.localName === 'html') break;
    let clip = clips.get(n);
    if (clip === undefined) {
      clip =
        overflowOf(view.getComputedStyle(n)) === 'visible' ? null : clipBox(n);
      clips.set(n, clip);
    }
    if (!clip) continue;
    box = {
      left: Math.max(box.left, clip.left),
      top: Math.max(box.top, clip.top),
      right: Math.max(
        Math.max(box.left, clip.left),
        Math.min(box.right, clip.right),
      ),
      bottom: Math.max(
        Math.max(box.top, clip.top),
        Math.min(box.bottom, clip.bottom),
      ),
    };
  }
  return box;
}

/** Read only what each probe kind needs: hit tests and colour reads are the costly ones. */
function fill(
  st: State,
  el: Element,
  doc: Document,
  view: Window,
  need: Needs,
  r: DOMRect,
  clips: Map<Element, Box | null>,
): void {
  if (need.vbox && st.vbox === null) st.vbox = visibleBox(el, r, view, clips);
  if ((need.visible || need.hit) && !st.visibleRead) {
    st.visible = isRendered(el, { opacity: true }) && r.width * r.height >= 1;
    st.visibleRead = true;
  }
  if (need.hit && st.hit === null && st.visible) {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx >= 0 && cy >= 0 && cx < view.innerWidth && cy < view.innerHeight) {
      const h = doc.elementFromPoint(cx, cy);
      st.hit = h === null || isOurs(h) || composedContains(el, h);
    }
  }
  if (need.clip) st.clipped = isClipped(el, view);
  if (need.ratio && st.ratio === null) {
    st.ratio = measureContrast(
      el,
      view,
      r.bottom > 0 && r.top < view.innerHeight,
    ).ratio;
  }
  if (need.size && st.fontPx === null) {
    const v = parseFloat(view.getComputedStyle(el).fontSize);
    st.fontPx = Number.isFinite(v) ? v : null;
  }
  if (need.cut && st.shown === null) st.shown = shownFraction(el, view);
}

/**
 * A snapshot of every probe. Given the baseline, controls that did not move
 * and that no marked box (with its hit-area margin) reaches keep their
 * baseline hit test: hit tests are the costly read once many positioned
 * boxes exist, and nothing else WebAble changes can cover a control.
 */
export function takeSnapshot(
  doc: Document,
  probes: ProbeSet,
  base?: Snapshot,
): Snapshot {
  const view = doc.defaultView as Window;
  const states = new Map<Element, State>();
  const clips = new Map<Element, Box | null>();
  const put = (el: Element, need: Needs): void => {
    const r = el.getBoundingClientRect();
    let st = states.get(el);
    if (!st) {
      st = {
        box: boxOf(r),
        visible: true,
        visibleRead: false,
        hit: null,
        clipped: false,
        ratio: null,
        fontPx: null,
        shown: null,
        vbox: null,
      };
      states.set(el, st);
    }
    fill(st, el, doc, view, need, r, clips);
  };
  for (const el of probes.text) {
    put(el, { vbox: true });
    for (const n of probes.neighbours.get(el) ?? [])
      put(n, { visible: true, vbox: true });
  }
  for (const el of probes.containers) put(el, { clip: true });
  const reach = base
    ? new BoxGrid(
        probes.marked.map((el, id) => ({
          id,
          box: inflate(boxOf(el.getBoundingClientRect()), 32, 32),
        })),
        128,
      )
    : null;
  for (const el of probes.controls) {
    const was = base?.states.get(el);
    if (reach && was && was.visibleRead) {
      const r = el.getBoundingClientRect();
      const still =
        Math.abs(r.left - was.box.left) < 1 &&
        Math.abs(r.top - was.box.top) < 1 &&
        Math.abs(r.right - was.box.right) < 1 &&
        Math.abs(r.bottom - was.box.bottom) < 1;
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const point = { left: cx, top: cy, right: cx, bottom: cy };
      const reached = reach
        .near(point)
        .some(
          (m) =>
            intersection(inflate(m.box, 0.5, 0.5), inflate(point, 0.5, 0.5)) >
            0,
        );
      if (still && !reached) {
        put(el, { visible: true });
        const st = states.get(el);
        if (st && st.visible) st.hit = was.hit;
        continue;
      }
    }
    put(el, { visible: true, hit: true });
  }
  for (const el of probes.contrast) put(el, { ratio: true });
  for (const el of probes.fields.keys()) put(el, { size: true });
  for (const [el, box] of probes.spill) {
    put(el, {});
    put(box, {});
  }
  for (const el of probes.cuttable) put(el, { cut: true });
  const root = doc.documentElement;
  const active =
    doc.activeElement && doc.activeElement !== doc.body
      ? doc.activeElement
      : null;
  return { states, overflowX: root.scrollWidth - root.clientWidth, active };
}

/** Elements inside a fixed or sticky layer (hit tests there are scroll artefacts). */
function inPinnedLayer(el: Element, view: Window): boolean {
  for (
    let n: Element | null = el, i = 0;
    n && i < 12;
    n = n.parentElement, i++
  ) {
    const p = view.getComputedStyle(n).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

export interface DiffContext {
  /** Personal contrast target when the contrast op is active, else 4.5. */
  contrastTarget: number;
  /**
   * The tab's zoom (the person's own zoom x AdaptationPlan.zoom): size ranks
   * are read in effective px, as the reader sees them, so the half-pixel
   * tolerance is SIZE_EPS / zoom in CSS px. Default 1.
   */
  zoom?: number;
  /** Marked elements to scan when the page gains horizontal overflow. */
  marked: readonly Element[];
}

/** Size changes under half a pixel are rounding, never a change of rank. */
const SIZE_EPS = 0.5;

export function diffSnapshots(
  doc: Document,
  probes: ProbeSet,
  base: Snapshot,
  ctx: DiffContext,
): Failure[] {
  const view = doc.defaultView as Window;
  const now = takeSnapshot(doc, probes, base);
  const fails: Failure[] = [];
  const get = (s: Snapshot, el: Element): State | undefined => s.states.get(el);

  // Clipping: newly clipped relative to baseline (sites often clip by design).
  for (const c of probes.containers) {
    const b = get(base, c);
    const a = get(now, c);
    if (b && a && !b.clipped && a.clipped) {
      const ops = opsNear(c);
      for (const op of opsWithin(c)) ops.add(op);
      fails.push({ code: 'clip', el: c, ops });
    }
  }

  // Overlap: a changed text block now covers a neighbour it did not cover,
  // or covers noticeably more of a picture or icon it already touched.
  for (const el of probes.text) {
    const b = get(base, el);
    const a = get(now, el);
    if (!b || !a) continue;
    // What is on screen: boxes cut down to their clipping ancestors.
    const bt = b.vbox ?? b.box;
    const at = a.vbox ?? a.box;
    for (const n of probes.neighbours.get(el) ?? []) {
      const sbn = get(base, n);
      const san = get(now, n);
      if (!sbn || !san || !san.visible) continue;
      const bn = sbn.vbox ?? sbn.box;
      const an = san.vbox ?? san.box;
      const before = intersection(bt, bn);
      const after = intersection(at, an);
      const smallA = Math.min(area(at), area(an));
      const smallB = Math.min(area(bt), area(bn));
      const newly =
        smallA > 0 &&
        after >= 0.15 * smallA &&
        before < 0.05 * Math.max(1, smallB);
      let grew = false;
      if (probes.media.has(n) && area(an) > 0 && area(bn) > 0) {
        // Text that sat inside a picture by design (a caption on a hero
        // image) may grow there; a badge spreading over an icon may not.
        const inside = before >= 0.9 * Math.max(1, area(bt));
        grew =
          !inside &&
          after / area(an) - before / area(bn) >= 0.15 &&
          after > before;
      }
      if (newly || grew) {
        fails.push({ code: 'overlap', el, ops: opsNear(el) });
        break;
      }
    }
  }

  // Spill: a resized label that sat inside its control's box now reaches
  // past it (text over a button's edge, B6: Meta's "Shop all").
  for (const [el, box] of probes.spill) {
    const bt = get(base, el)?.box;
    const bb = get(base, box)?.box;
    const at = get(now, el)?.box;
    const ab = get(now, box)?.box;
    if (!bt || !bb || !at || !ab || area(at) < 1) continue;
    const out = (t: Box, b: Box): number =>
      Math.max(
        b.left - t.left,
        t.right - b.right,
        b.top - t.top,
        t.bottom - b.bottom,
      );
    if (out(bt, bb) <= 1 && out(at, ab) > 2)
      fails.push({ code: 'overlap', el, ops: opsNear(el) });
  }

  // Hierarchy: within a region or a record, a text that was smaller than
  // another is now larger than it (Kendall tau = 1 per group, ties allowed).
  // A control's label is no ceiling for the text beside it (controlCeiling):
  // a glyph caps nothing, other control text caps no text outside controls
  // and headings (text_floor caps less than this allows, never more).
  const screen = view.innerHeight;
  const eps = SIZE_EPS / (ctx.zoom && ctx.zoom > 0 ? ctx.zoom : 1);
  const ceilings = new Map<Element, 'glyph' | 'label' | null>();
  const ceiling = (el: Element): 'glyph' | 'label' | null => {
    let c = ceilings.get(el);
    if (c === undefined) ceilings.set(el, (c = controlCeiling(el)));
    return c;
  };
  const caps = (y: Element, x: Element): boolean => {
    const c = ceiling(y);
    if (c === 'glyph') return false;
    return c !== 'label' || ceiling(x) !== null || inHeading(x);
  };
  for (const { members, record } of probes.groups) {
    const rows: Array<[Element, number, number, number]> = [];
    for (const el of members) {
      const b = get(base, el);
      const a = get(now, el);
      if (!b || !a || b.fontPx === null || a.fontPx === null) continue;
      if (area(a.box) < 4 || area(b.box) < 4) continue;
      rows.push([el, b.fontPx, a.fontPx, b.box.top]);
    }
    const flagged = new Set<Element>();
    for (const [x, bx, ax, tx] of rows) {
      if (flagged.has(x)) continue;
      for (const [y, by, ay, ty] of rows) {
        // Ranked when 0.5 px (effective) or more apart, as the eval reads it.
        if (x === y || !(by - bx >= eps - 1e-6) || !(ax - ay >= eps - 1e-6))
          continue;
        if (!record && Math.abs(tx - ty) > screen) continue;
        if (!caps(y, x)) continue;
        flagged.add(x);
        fails.push({ code: 'hierarchy', el: x, ops: opsNear(x) });
        break;
      }
    }
  }

  // Consistency: instances of one template field at one native size end at
  // one size. The outliers from the most common size are reported.
  const byField = new Map<string, Array<[Element, number]>>();
  for (const [el, field] of probes.fields) {
    const b = get(base, el);
    const a = get(now, el);
    if (!b || !a || b.fontPx === null || a.fontPx === null) continue;
    const key = `${field}@${Math.round(b.fontPx * 4)}`;
    const list = byField.get(key);
    if (list) list.push([el, a.fontPx]);
    else byField.set(key, [[el, a.fontPx]]);
  }
  for (const list of byField.values()) {
    if (list.length < 2) continue;
    const counts = new Map<number, number>();
    for (const [, px] of list) {
      const q = Math.round(px * 4);
      counts.set(q, (counts.get(q) ?? 0) + 1);
    }
    let mode = 0;
    let best = -1;
    for (const [q, n] of counts)
      if (n > best || (n === best && q > mode)) {
        mode = q;
        best = n;
      }
    const outlier = list.find(([, px]) => Math.abs(px - mode / 4) > SIZE_EPS);
    if (outlier)
      fails.push({
        code: 'inconsistent',
        el: outlier[0],
        ops: opsNear(outlier[0]),
      });
  }

  // Truncation: text newly cut off, or cut off noticeably more than before
  // (an ellipsized subject that now shows two words instead of six).
  for (const el of probes.cuttable) {
    const b = get(base, el)?.shown;
    const a = get(now, el)?.shown;
    if (b === null || b === undefined || a === null || a === undefined)
      continue;
    if ((b >= 0.98 && a < 0.98) || b - a >= 0.15) {
      const ops = opsNear(el);
      for (const op of opsWithin(el)) ops.add(op);
      fails.push({ code: 'truncation', el, ops });
    }
  }

  // Horizontal overflow of the page.
  if (now.overflowX - base.overflowX > 8) {
    const culprits = new Set<OpId>();
    let culpritEl: Element = doc.documentElement;
    for (const el of ctx.marked) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.right + view.scrollX > doc.documentElement.clientWidth + 1) {
        for (const op of opsNear(el)) culprits.add(op);
        culpritEl = el;
      }
    }
    fails.push({ code: 'overflow', el: culpritEl, ops: culprits });
  }

  // Controls: collapsed, hidden, or covered.
  for (const c of probes.controls) {
    const b = get(base, c);
    const a = get(now, c);
    if (!b || !a || !b.visible) continue;
    const focusable = c.matches(FOCUSABLE_SELECTOR);
    if (!a.visible) {
      const ops = opsNear(c);
      for (const op of opsWithin(c)) ops.add(op);
      fails.push({
        code: focusable ? 'focus_hidden' : 'control_collapsed',
        el: c,
        ops,
      });
      continue;
    }
    if (b.hit === true && a.hit === false) {
      const r = c.getBoundingClientRect();
      const cover = doc.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      if (cover && inPinnedLayer(cover, view) && opsNear(cover).size === 0)
        continue;
      const ops = opsNear(c);
      if (cover) for (const op of opsNear(cover)) ops.add(op);
      fails.push({
        code: 'control_collapsed',
        el: c,
        ops,
        ...(cover ? { cover } : {}),
      });
    }
  }

  // Focus: never lose the person's place.
  if (base.active && base.active.isConnected) {
    const cur = doc.activeElement;
    if (!cur || cur === doc.body) {
      if (isRendered(base.active)) {
        (base.active as HTMLElement).focus?.({ preventScroll: true });
      } else {
        fails.push({
          code: 'focus_lost',
          el: base.active,
          ops: opsNear(base.active),
        });
      }
    }
  }

  // Contrast must never get worse than baseline or the personal target.
  for (const el of probes.contrast) {
    const b = get(base, el);
    const a = get(now, el);
    if (!b || !a || b.ratio === null || a.ratio === null) continue;
    if (a.ratio < Math.min(b.ratio, ctx.contrastTarget) - 0.1) {
      fails.push({ code: 'contrast_drop', el, ops: opsNear(el) });
    }
  }
  return fails;
}

// ---------------------------------------------------------------------------
// Zoom guard (docs/10 §5.1)
// ---------------------------------------------------------------------------

const SEARCH_SELECTOR = [
  'input[type="search" i]',
  '[role="searchbox"]',
  '[role="search"] input:not([type="hidden"])',
  'search input:not([type="hidden"])',
  'input[name="q"]',
  'input[name="query"]',
  'input[name="search_query"]',
  'input[name="field-keywords"]',
  'input[name*="search" i]',
  'input[aria-label*="search" i]',
  'input[placeholder*="search" i]',
].join(',');

/**
 * Primary navigation and search as the zoom guard counts them (docs/10
 * §5.1): links in banner and navigation landmarks that are rendered, inside
 * the viewport's width and not cut away by a collapsed container, and
 * whether a search field is still visible. The extraction's baseline at 100%
 * (layout features `nav`) and the guard's reading after a page scale use
 * this one counter, so they compare like with like (eval M3). A site
 * breakpoint that folds navigation into a menu shows up as fewer links.
 */
export function navReading(doc: Document): {
  navLinks: number;
  searchVisible: boolean;
} {
  const view = doc.defaultView as Window;
  const root = doc.documentElement;
  const vw = view.innerWidth;
  // Links share their containers: each container's clip box is read once.
  const clips = new Map<Element, Box | null>();
  const clipOf = (n: Element): Box | null => {
    let c = clips.get(n);
    if (c === undefined) {
      c =
        overflowOf(view.getComputedStyle(n)) === 'visible' ? null : clipBox(n);
      clips.set(n, c);
    }
    return c;
  };
  const shown = (el: Element): boolean => {
    if (!isRendered(el, { opacity: true })) return false;
    const r = boxOf(el.getBoundingClientRect());
    const a = area(r);
    if (a < 4 || r.right <= 0 || r.left >= vw) return false;
    for (
      let n = composedParent(el), i = 0;
      n && i < 8;
      n = composedParent(n), i++
    ) {
      if (n === doc.body || n === root) break;
      const c = clipOf(n);
      if (c && intersection(r, c) < 0.5 * a) return false;
    }
    return true;
  };
  const links = new Set<Element>();
  for (const r of doc.querySelectorAll(
    'nav, [role="navigation"], header, [role="banner"]',
  )) {
    const landmark = landmarkOf(r);
    if ((landmark !== 'navigation' && landmark !== 'banner') || isOurs(r))
      continue;
    for (const a of r.querySelectorAll('a[href], [role="link"]')) {
      links.add(a);
      if (links.size >= 600) break;
    }
    if (links.size >= 600) break;
  }
  let navLinks = 0;
  for (const a of links) if (shown(a)) navLinks++;
  let searchVisible = false;
  let tried = 0;
  for (const s of doc.querySelectorAll(SEARCH_SELECTOR)) {
    if (++tried > 40) break;
    if (isOurs(s) || !shown(s)) continue;
    searchVisible = true;
    break;
  }
  return { navLinks, searchVisible };
}

/** Titles whose truncation the zoom guard counts: links and headings. */
const TITLE_SELECTOR =
  'a[href], [role="link"], h1, h2, h3, h4, h5, h6, [role="heading"]';
/** Titles read per reading, in document order within the first two screens. */
const MAX_TITLES = 200;

/** A title's text is cut off by an ellipsis or a line clamp (it or two ancestors). */
function titleCut(el: Element, view: Window): boolean {
  for (
    let n: Element | null = el, i = 0;
    n && i < 3;
    n = composedParent(n), i++
  ) {
    if (n.localName === 'body' || n.localName === 'html') break;
    const cs = view.getComputedStyle(n);
    const h = n as HTMLElement;
    if (
      cs.textOverflow === 'ellipsis' &&
      cs.overflowX !== 'visible' &&
      h.scrollWidth > h.clientWidth + 1
    )
      return true;
    const clamp = cs.getPropertyValue('-webkit-line-clamp');
    if (
      clamp &&
      clamp !== 'none' &&
      h.clientHeight > 0 &&
      h.scrollHeight > h.clientHeight + 1
    )
      return true;
  }
  return false;
}

/** Titles with text in the first two screens of the layout viewport. */
function titlesInView(doc: Document): Element[] {
  const view = doc.defaultView as Window;
  const vh = view.innerHeight;
  const vw = view.innerWidth;
  const out: Element[] = [];
  let tried = 0;
  for (const el of doc.querySelectorAll(TITLE_SELECTOR)) {
    if (out.length >= MAX_TITLES || ++tried > 2 * MAX_TITLES) break;
    if (isOurs(el) || !(el.textContent ?? '').trim()) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom <= 0 || r.top >= 2 * vh || r.right <= 0 || r.left >= vw)
      continue;
    out.push(el);
  }
  return out;
}

interface TitleBaseline {
  /** devicePixelRatio of the reading: browser zoom raises it. */
  dpr: number;
  cut: WeakMap<Element, boolean>;
}
const TITLE_BASELINES = new WeakMap<Document, TitleBaseline>();

/**
 * The guard's baseline for truncation (eval m1): which titles are cut off
 * before a page scale. Taken with every extraction at the person's own zoom
 * or below it, never at a WebAble scale above the last reading (the
 * devicePixelRatio tells them apart: browser zoom raises it).
 */
export function noteTitleBaseline(doc: Document): void {
  const view = doc.defaultView;
  if (!view) return;
  const dpr = view.devicePixelRatio || 1;
  const prev = TITLE_BASELINES.get(doc);
  if (prev && dpr > prev.dpr + 0.01) return;
  const cut = new WeakMap<Element, boolean>();
  for (const el of titlesInView(doc)) cut.set(el, titleCut(el, view));
  TITLE_BASELINES.set(doc, { dpr, cut });
}

/**
 * Titles on screen now whose text was whole at the baseline and is cut off
 * now (an ellipsis or a clamp), and how many titles were read. Zero cut when
 * no baseline was taken at a lower zoom than now.
 */
function titleReading(doc: Document): { cut: number; titles: number } {
  const view = doc.defaultView as Window;
  const base = TITLE_BASELINES.get(doc);
  const els = titlesInView(doc);
  if (!base || !((view.devicePixelRatio || 1) > base.dpr + 0.01))
    return { cut: 0, titles: els.length };
  let cut = 0;
  let titles = 0;
  for (const el of els) {
    const was = base.cut.get(el);
    if (was === undefined) continue;
    titles++;
    if (!was && titleCut(el, view)) cut++;
  }
  return { cut, titles };
}

/**
 * What a page-scale step must not lose (docs/10 §5.1): horizontal overflow
 * (scrollWidth beyond the layout viewport, scrollbar excluded), the visible
 * primary navigation and search (`navReading`), and titles newly cut off
 * since the baseline at the person's own zoom.
 */
export function viewportGuard(doc: Document): ViewportGuard {
  const root = doc.documentElement;
  const overflowPx = Math.max(
    0,
    Math.round(root.scrollWidth - root.clientWidth),
  );
  const titles = titleReading(doc);
  return {
    overflowPx,
    ...navReading(doc),
    newlyEllipsised: titles.cut,
    titlesShown: titles.titles,
  };
}
