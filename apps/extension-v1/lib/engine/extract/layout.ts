import type { LayoutFeatures } from '@webable/core/triage/types';

import {
  groupRuns,
  qualifyRun,
  type QualifiedRun,
} from '../skeleton/collections';
import { composedKids, type OpenClosed } from '../skeleton/dom';
import {
  PASSWORD_FIELD_SELECTOR,
  PAYMENT_FIELD_SELECTOR,
  PAYMENT_FRAME_SELECTOR,
} from '../skeleton/privacy';
import { isVisible } from '../skeleton/visible';
import type { RegionFact, TextFact } from '../types';
import { round } from '../util/buckets';
import {
  ACTIONABLE_SELECTOR,
  composedContains,
  directTextLength,
  iframeHost,
  isOurs,
  isRendered,
  type TreeScope,
} from '../util/dom';
import { navReading, noteTitleBaseline } from '../verify/checks';
import { readerableScore } from './main';
import { CMP_SELECTOR, iframeKindOfHost } from './rules';

/**
 * Layout features for triage (docs/10 §3.1): person-independent numbers
 * about how much a page can absorb a change, measured in the extraction pass
 * that already runs at DCL. The content script never sees the fit; every
 * person-relative share is computed in the service worker.
 *
 * Viewport-first and cheap: elements are collected during the existing walk
 * (no extra style sweep), and only those in view are measured afterwards,
 * with fixed caps so a huge page costs no more than a large one.
 */

/**
 * Collected during the walk; measured after it. The walk already holds each
 * element's computed style, so collecting costs a few property reads, read
 * only when they can matter.
 */
export class LayoutCollector {
  readonly rows: Element[] = [];
  readonly containers: Element[] = [];
  readonly media: Element[] = [];
  readonly leaves: Element[] = [];
  readonly blocks: Element[] = [];
  readonly pinned: Element[] = [];
  /** Elements holding text, and their two nearest ancestors. */
  readonly textHolders = new WeakSet<Element>();

  visit(el: Element, cs: CSSStyleDeclaration, position: string): void {
    const kids = el.childElementCount;
    if (position === 'fixed' || position === 'sticky') {
      if (this.pinned.length < 400) this.pinned.push(el);
    }
    if (MEDIA_TAGS.has(el.localName)) {
      if (this.media.length < 800) this.media.push(el);
    }
    if (kids === 0) {
      if (this.leaves.length < 2500) this.leaves.push(el);
      return;
    }
    const d = cs.display;
    if (d.startsWith('inline')) {
      if (
        d === 'inline-flex' &&
        kids >= 2 &&
        this.rows.length < 400 &&
        cs.flexWrap === 'nowrap' &&
        cs.flexDirection.startsWith('row')
      )
        this.addRow(el);
      return;
    }
    if (d === 'contents') return;
    if (this.blocks.length < 1500) this.blocks.push(el);
    if (kids >= 5 && this.containers.length < 400) this.containers.push(el);
    if (
      d === 'flex' &&
      kids >= 2 &&
      this.rows.length < 400 &&
      cs.flexWrap === 'nowrap' &&
      cs.flexDirection.startsWith('row')
    )
      this.addRow(el);
    if (this.media.length < 800) {
      const bg = cs.backgroundImage;
      if (bg !== 'none' && bg.includes('url(')) this.media.push(el);
    }
  }

  /** `el` holds text (a TextFact): it and two ancestors hold text; a nowrap block is a row. */
  noteText(el: Element, cs: CSSStyleDeclaration, display: string): void {
    this.textHolders.add(el);
    const p = el.parentElement;
    if (p) {
      this.textHolders.add(p);
      if (p.parentElement) this.textHolders.add(p.parentElement);
    }
    if (this.rows.length >= 400 || cs.whiteSpace !== 'nowrap') return;
    if (
      display === 'block' ||
      display === 'list-item' ||
      display === 'table-cell'
    )
      this.addRow(el);
    // Inline text inherits nowrap from its box: that box is the row.
    else if (display.startsWith('inline') && p) this.addRow(p);
  }

  private readonly rowSet = new Set<Element>();

  private addRow(el: Element): void {
    if (this.rowSet.has(el)) return;
    this.rowSet.add(el);
    this.rows.push(el);
  }
}

const MEDIA_TAGS: ReadonlySet<string> = new Set([
  'img',
  'picture',
  'video',
  'canvas',
  'iframe',
  'svg',
]);

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface LayoutInput {
  doc: Document;
  scopes: readonly TreeScope[];
  collector: LayoutCollector;
  texts: readonly TextFact[];
  main: Element | null;
  regions: readonly RegionFact[];
  mainFontPx: number | null;
  /** Product JSON-LD seen by the signal pass. */
  jsonldProduct: boolean;
  rectOf: (el: Element) => DOMRect;
  openClosed?: OpenClosed;
  /** Marks the end of a sub-phase for perf.phases (`layout_<name>`). */
  lap?: (name: string) => void;
}

/** Area of `r` inside the viewport. */
function inView(r: Rect, vw: number, vh: number): number {
  const w = Math.min(r.right, vw) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Union area of rects within the viewport, on a 16 px grid. */
export function unionShare(
  rects: readonly Rect[],
  vw: number,
  vh: number,
): number {
  if (!rects.length || vw <= 0 || vh <= 0) return 0;
  const cell = 16;
  const cols = Math.ceil(vw / cell);
  const rowsN = Math.ceil(vh / cell);
  const grid = new Uint8Array(cols * rowsN);
  let covered = 0;
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.left / cell));
    const x1 = Math.min(cols, Math.ceil(r.right / cell));
    const y0 = Math.max(0, Math.floor(r.top / cell));
    const y1 = Math.min(rowsN, Math.ceil(r.bottom / cell));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * cols + x;
        if (grid[i]) continue;
        grid[i] = 1;
        covered++;
      }
    }
  }
  return Math.min(1, covered / (cols * rowsN));
}

/** Tall fixed boxes whose content underneath is hit-tested (three points each). */
const MAX_OCCLUSION_PROBES = 4;

/** The box paints something of its own: a background colour, an image, a blur. */
function paints(cs: CSSStyleDeclaration): boolean {
  const bg = /rgba?\(([^)]*)\)/.exec(cs.backgroundColor);
  const alpha = bg?.[1]?.split(/[\s,/]+/)[3];
  const colour =
    bg !== null && (alpha === undefined || parseFloat(alpha) > 0.05);
  return (
    colour ||
    cs.backgroundImage !== 'none' ||
    (cs.backdropFilter !== '' && cs.backdropFilter !== 'none')
  );
}

/** A sticky box held at its top or bottom offset (as it is while stuck). */
function stuck(r: DOMRect, cs: CSSStyleDeclaration, vh: number): boolean {
  const top = parseFloat(cs.top);
  if (Number.isFinite(top) && Math.abs(r.top - top) <= 2) return true;
  const bottom = parseFloat(cs.bottom);
  return Number.isFinite(bottom) && Math.abs(vh - r.bottom - bottom) <= 2;
}

/** Text, a picture or a control lies under a pinned box (three points across its middle). */
function coversContent(
  p: Element,
  r: DOMRect,
  doc: Document,
  vw: number,
  vh: number,
): boolean {
  const y = (Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2;
  const x0 = Math.max(r.left, 0);
  const x1 = Math.min(r.right, vw);
  for (const f of [0.25, 0.5, 0.75]) {
    const x = x0 + (x1 - x0) * f;
    let seen = 0;
    for (const e of doc.elementsFromPoint(x, y)) {
      if (e === p || composedContains(p, e) || composedContains(e, p)) continue;
      if (isOurs(e)) continue;
      if (
        directTextLength(e) > 0 ||
        MEDIA_TAGS.has(e.localName) ||
        e.matches(ACTIONABLE_SELECTOR)
      )
        return true;
      if (++seen >= 3) break;
    }
  }
  return false;
}

const clipsX = (s: CSSStyleDeclaration): boolean =>
  s.overflowX === 'hidden' || s.overflowX === 'clip';
const clipsY = (s: CSSStyleDeclaration): boolean =>
  s.overflowY === 'hidden' || s.overflowY === 'clip';

/** Text in a box that clips (ellipsis, line clamp, hidden overflow on nowrap). */
function clipRisk(s: CSSStyleDeclaration): boolean {
  const x = clipsX(s);
  const y = clipsY(s);
  if (s.textOverflow === 'ellipsis' && x) return true;
  const clamp = s.getPropertyValue('-webkit-line-clamp');
  if (clamp && clamp !== 'none' && (x || y)) return true;
  return (x || y) && s.whiteSpace === 'nowrap';
}

/** Text whose box height is capped: max-height set, or content already overflowing. */
function fixedHeight(el: Element, s: CSSStyleDeclaration): boolean {
  if (s.maxHeight !== 'none') return true;
  const h = el as HTMLElement;
  return !s.display.startsWith('inline') && h.scrollHeight > h.clientHeight + 1;
}

const NOWRAP = (s: CSSStyleDeclaration): boolean =>
  s.whiteSpace === 'nowrap' || s.whiteSpace === 'pre';

/**
 * Smallest 1/U over rows in view that hold text which cannot wrap, where
 * U = (width of the row's items) / (the row's content width). Items with
 * wrapping text absorb growth by wrapping and count 0; items without text
 * (icons, images, fields) count their box; nowrap text counts its full
 * extent, so a row whose text is already cut off has slack below 1.
 */
function rowSlack(
  input: LayoutInput,
  view: Window,
  vw: number,
  vh: number,
): number | null {
  const { collector, rectOf } = input;
  let min: number | null = null;
  let measured = 0;
  const doc = input.doc;
  for (const row of collector.rows) {
    if (!collector.textHolders.has(row)) continue;
    const r = rectOf(row);
    if (r.width < 40 || inView(r, vw, vh) === 0) continue;
    if (++measured > 150) break;
    const cs = view.getComputedStyle(row);
    const inner =
      r.width -
      (parseFloat(cs.paddingLeft) || 0) -
      (parseFloat(cs.paddingRight) || 0) -
      (parseFloat(cs.borderLeftWidth) || 0) -
      (parseFloat(cs.borderRightWidth) || 0);
    if (inner <= 1) continue;
    let used = 0;
    let nowrapText = false;
    if (cs.display.endsWith('flex')) {
      const gap = parseFloat(cs.columnGap) || 0;
      let n = 0;
      for (const c of row.children) {
        const ccs = view.getComputedStyle(c);
        if (
          ccs.display === 'none' ||
          ccs.position === 'absolute' ||
          ccs.position === 'fixed'
        )
          continue;
        n++;
        const box = c.getBoundingClientRect().width;
        if (!/\S/.test(c.textContent ?? '')) used += box;
        else if (NOWRAP(ccs)) {
          nowrapText = true;
          used += Math.max(box, contentWidth(c, doc));
        }
        // Auto margins absorb free space; count at most a fixed gutter.
        used +=
          Math.min(32, parseFloat(ccs.marginLeft) || 0) +
          Math.min(32, parseFloat(ccs.marginRight) || 0);
      }
      used += Math.max(0, n - 1) * gap;
    } else {
      nowrapText = true;
      used = contentWidth(row, doc);
    }
    if (!nowrapText || used <= 0) continue;
    const slack = inner / used;
    if (min === null || slack < min) min = slack;
  }
  return min === null ? null : round(Math.max(0, min), 2);
}

/** Width of an element's laid-out content (a range over its children). */
function contentWidth(el: Element, doc: Document): number {
  const range = doc.createRange();
  range.selectNodeContents(el);
  const w = range.getBoundingClientRect().width;
  range.detach();
  return w;
}

interface JsonLdFacts {
  product: boolean;
  paywalled: boolean;
  video: boolean;
}

/** JSON-LD types and isAccessibleForFree, parsed locally (only the flags are kept). */
function jsonLdFacts(doc: Document): JsonLdFacts {
  const out: JsonLdFacts = { product: false, paywalled: false, video: false };
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node.slice(0, 50)) visit(n, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    for (const v of Array.isArray(t) ? t : [t]) {
      if (typeof v !== 'string') continue;
      const lc = v.toLowerCase();
      if (lc === 'product' || lc === 'productgroup') out.product = true;
      if (lc === 'videoobject') out.video = true;
    }
    const free = obj['isAccessibleForFree'];
    if (free === false || (typeof free === 'string' && /^false$/i.test(free)))
      out.paywalled = true;
    for (const k of ['@graph', 'mainEntity', 'hasPart', 'itemListElement'])
      if (obj[k]) visit(obj[k], depth + 1);
  };
  let n = 0;
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    if (++n > 10) break;
    const text = s.textContent ?? '';
    if (text.length > 200_000) continue;
    try {
      visit(JSON.parse(text), 0);
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }
  return out;
}

const EDITOR_SELECTOR =
  '[contenteditable]:not([contenteditable="false" i]), .ProseMirror, .ql-editor, .DraftEditor-root, .cke_editable, .monaco-editor, .cm-editor, .CodeMirror, [role="textbox"][aria-multiline="true"]';
const DIALOG_SELECTOR =
  'dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"]';
const PAYWALL_WORDS =
  /paywall|regwall|subscribe-wall|meter-wall|\btp-modal\b|\btp-backdrop\b|piano-/i;
const CONSENT_WORDS =
  /cookie|consent|gdpr|onetrust|cookiebot|didomi|usercentrics|privacy-banner/i;
function* scoped(
  scopes: readonly TreeScope[],
  selector: string,
  max = 400,
): Generator<Element> {
  let n = 0;
  for (const scope of scopes) {
    let list: NodeListOf<Element>;
    try {
      list = scope.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const el of list) {
      if (++n > max) return;
      if (!isOurs(el)) yield el;
    }
  }
}

/** Records: collections of >= 5 similar items (the skeleton's detector, without exemplars). */
function records(
  input: LayoutInput,
  vw: number,
  vh: number,
  sx: number,
  sy: number,
): LayoutFeatures['records'] {
  const accepted: QualifiedRun[] = [];
  const inside = new Set<Element>();
  let examined = 0;
  const kids = (e: Element): Element[] => composedKids(e, input.openClosed);
  for (const c of input.collector.containers) {
    if (examined > 4000) break;
    // A list inside an item of a list already found is part of that item.
    let skip = false;
    for (let a = c.parentElement, i = 0; a && i < 12; a = a.parentElement, i++)
      if (inside.has(a)) {
        skip = true;
        break;
      }
    if (skip || !isRendered(c)) continue;
    const children = kids(c);
    examined += children.length;
    for (const idx of groupRuns(children, 5)) {
      const run = qualifyRun(
        idx.map((i) => children[i] as Element),
        { vw, vh, kids, openClosed: input.openClosed },
      );
      if (!run || run.members.length < 5) continue;
      accepted.push(run);
      for (const m of run.members) inside.add(m);
    }
  }
  let largest = 0;
  for (const r of accepted) largest = Math.max(largest, r.members.length);
  // Share of main's area covered by the collections' boxes, within main's
  // first three screens: what a reader meets. A virtualised list makes main
  // hundreds of thousands of px tall (Craigslist: 763,570 px), and its share
  // of the whole would read as no structure at all (eval M2).
  const doc = input.doc;
  const mr = input.main ? input.rectOf(input.main) : null;
  const mx0 = mr ? mr.left + sx : 0;
  const my0 = mr ? mr.top + sy : 0;
  const mx1 = mr ? mr.right + sx : doc.documentElement.scrollWidth;
  const my1 = Math.min(
    mr ? mr.bottom + sy : doc.documentElement.scrollHeight,
    my0 + RECORDS_BAND_SCREENS * vh,
  );
  const mainArea = Math.max(1, (mx1 - mx0) * (my1 - my0));
  let covered = 0;
  for (const run of accepted) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of run.rects) {
      x0 = Math.min(x0, r.left + sx);
      y0 = Math.min(y0, r.top + sy);
      x1 = Math.max(x1, r.right + sx);
      y1 = Math.max(y1, r.bottom + sy);
    }
    const w = Math.min(x1, mx1) - Math.max(x0, mx0);
    const h = Math.min(y1, my1) - Math.max(y0, my0);
    if (w > 0 && h > 0) covered += w * h;
  }
  return {
    count: accepted.length,
    largest,
    mainShare: round(Math.min(1, covered / mainArea), 2),
  };
}

/** Screens of main, from its top, that the records' share is measured over. */
const RECORDS_BAND_SCREENS = 3;

/** Everything the kind flags need, found in one selector sweep per scope. */
const KIND_SWEEP = [
  EDITOR_SELECTOR,
  '[role="application"]',
  DIALOG_SELECTOR,
  PASSWORD_FIELD_SELECTOR,
  PAYMENT_FIELD_SELECTOR,
].join(',');

interface Swept {
  editors: Element[];
  applications: Element[];
  canvases: Element[];
  players: Element[];
  layers: Element[];
  password: boolean;
  payment: boolean;
}

function sweep(doc: Document, scopes: readonly TreeScope[]): Swept {
  const out: Swept = {
    editors: [],
    applications: [],
    canvases: [],
    players: [],
    layers: [],
    password: false,
    payment: false,
  };
  const base = doc.baseURI;
  for (const el of scoped(scopes, KIND_SWEEP, 800)) {
    const tag = el.localName;
    if (
      tag === 'input' ||
      tag === 'select' ||
      el.hasAttribute('autocomplete')
    ) {
      if (el.matches(PASSWORD_FIELD_SELECTOR)) out.password ||= isRendered(el);
      if (el.matches(PAYMENT_FIELD_SELECTOR)) out.payment ||= isRendered(el);
    }
    if (el.matches(EDITOR_SELECTOR)) out.editors.push(el);
    if (el.getAttribute('role') === 'application') out.applications.push(el);
    if (el.matches(DIALOG_SELECTOR)) out.layers.push(el);
  }
  // Tag lookups are cheap; frames are told apart by their host.
  for (const scope of scopes) {
    let n = 0;
    for (const el of scope.querySelectorAll('canvas, video, iframe')) {
      if (++n > 200) break;
      const tag = el.localName;
      if (tag === 'canvas') out.canvases.push(el);
      else if (tag === 'video') out.players.push(el);
      else if (el.matches(PAYMENT_FRAME_SELECTOR)) {
        out.payment ||= isRendered(el);
      } else {
        let path = '';
        try {
          path = new URL(el.getAttribute('src') ?? '', base).pathname;
        } catch {
          path = '';
        }
        if (iframeKindOfHost(iframeHost(el, base), path) === 'video_host')
          out.players.push(el);
      }
    }
  }
  return out;
}

const PLAYER_BUTTON =
  /\b(?:play|pause|mute|unmute|volume|full ?screen|captions|subtitles)\b/i;
const PLAYER_NAME = /player/i;

/**
 * A video a person plays: native controls, player controls around it (a
 * seek bar, or two or more play, volume or captions buttons), a container
 * named or classed as a player, or a sound track it starts paused with. A
 * muted video that loops, autoplays or already plays without controls is a
 * background (Meta's hero), whatever its size. Frames from video hosts are
 * players.
 */
function isPlayer(el: Element): boolean {
  if (el.localName !== 'video') return true;
  const v = el as HTMLVideoElement;
  if (v.controls) return true;
  let box: Element | null = v.parentElement;
  for (let i = 0; box && i < 4; box = box.parentElement, i++) {
    const named = `${box.id} ${box.getAttribute('class') ?? ''} ${box.getAttribute('aria-label') ?? ''} ${box.getAttribute('aria-roledescription') ?? ''}`;
    if (PLAYER_NAME.test(named)) return true;
    if (
      box.querySelector(
        'input[type="range"], [role="slider"], progress, [role="progressbar"]',
      )
    )
      return true;
    let buttons = 0;
    for (const b of box.querySelectorAll('button, [role="button"]')) {
      const label = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('title') ?? ''}`;
      if (PLAYER_BUTTON.test(label) && ++buttons >= 2) return true;
    }
  }
  if (v.muted && (v.loop || v.autoplay || !v.paused)) return false;
  return !v.muted;
}

/**
 * Main reads as a document though Readability scores it low (short
 * paragraphs and lists, as on GOV.UK guidance pages; eval M2): a title, two
 * or more section headings or lists, and at least 600 characters of text.
 */
function outlined(input: LayoutInput): boolean {
  const root = input.main ?? input.doc.body;
  if (!root.querySelector('h1')) return false;
  const parts = root.querySelectorAll('h2, h3, h4, ul, ol').length;
  if (parts < 2) return false;
  let chars = 0;
  for (const t of input.texts) {
    if (input.main && !t.inMain) continue;
    chars += t.chars;
    if (chars >= 600) return true;
  }
  return false;
}

export function layoutFeatures(input: LayoutInput): LayoutFeatures {
  const { doc, collector, rectOf } = input;
  const view = doc.defaultView as Window;
  const vw = view.innerWidth;
  const vh = view.innerHeight;
  const sx = view.scrollX;
  const sy = view.scrollY;
  const vArea = Math.max(1, vw * vh);

  // ---- Text in view: clip risk, capped heights, text over media ------------
  const mediaRects: Array<{ el: Element; r: DOMRect }> = [];
  for (const m of collector.media) {
    if (m.localName === 'body' || m.localName === 'html') continue;
    const r = rectOf(m);
    if (r.width < 40 || r.height < 24 || inView(r, vw, vh) === 0) continue;
    mediaRects.push({ el: m, r });
    if (mediaRects.length >= 200) break;
  }
  let textArea = 0;
  let clipArea = 0;
  let fixedArea = 0;
  let overlayArea = 0;
  const sizes = new Set<number>();
  const parentStyle = new Map<Element, { clip: boolean; capped: boolean }>();
  let scanned = 0;
  let inViewTexts = 0;
  for (const t of input.texts) {
    if (t.icon) continue;
    if (++scanned > 1500 || inViewTexts >= 300) break;
    const r = rectOf(t.el);
    const a = inView(r, vw, vh);
    if (a === 0) continue;
    inViewTexts++;
    textArea += a;
    sizes.add(Math.round(t.fontPx));
    const cs = view.getComputedStyle(t.el);
    let clip = clipRisk(cs);
    let capped = fixedHeight(t.el, cs);
    const parent = t.el.parentElement;
    if ((!clip || !capped) && parent && cs.display.startsWith('inline')) {
      let ps = parentStyle.get(parent);
      if (!ps) {
        const pcs = view.getComputedStyle(parent);
        ps = { clip: clipRisk(pcs), capped: fixedHeight(parent, pcs) };
        parentStyle.set(parent, ps);
      }
      clip ||= ps.clip;
      capped ||= ps.capped;
    }
    if (clip) clipArea += a;
    if (capped) fixedArea += a;
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    for (const m of mediaRects) {
      if (m.el === t.el || t.el.contains(m.el)) continue;
      if (m.r.width * m.r.height < 1.5 * r.width * r.height) continue;
      if (cx > m.r.left && cx < m.r.right && cy > m.r.top && cy < m.r.bottom) {
        overlayArea += a;
        break;
      }
    }
  }
  const share = (x: number): number =>
    textArea > 0 ? round(Math.min(1, x / textArea), 3) : 0;

  const lap = input.lap ?? ((): void => undefined);
  lap('layout_text');

  // ---- Occlusion: pinned boxes over what scrolls under them (eval M1) -------
  // Fixed boxes count; sticky ones only once stuck to an edge and only bars
  // (wide and short): a sticky column (a contents list) holds its own layout
  // space and covers nothing. Boxes beside main's column, transparent layers
  // the pointer passes through, and tall fixed boxes with no content under
  // them (a channel header that scrolls away, a scroll-driven hero) do not
  // count either.
  const mainBox = input.main ? rectOf(input.main) : null;
  const pinnedRects: DOMRect[] = [];
  let probes = 0;
  for (const p of collector.pinned) {
    const r = rectOf(p);
    if (r.width < 1 || r.height < 1 || inView(r, vw, vh) === 0) continue;
    if (!isVisible(p)) continue;
    const cs = view.getComputedStyle(p);
    if (cs.pointerEvents === 'none' && !paints(cs)) continue;
    if (
      mainBox &&
      mainBox.width > 0 &&
      (r.right <= mainBox.left + 1 || r.left >= mainBox.right - 1)
    )
      continue;
    if (cs.position === 'sticky') {
      if (!stuck(r, cs, vh) || r.width < 0.6 * vw || r.height >= 0.5 * vh)
        continue;
    } else if (r.height >= 0.35 * vh && probes < MAX_OCCLUSION_PROBES) {
      probes++;
      if (!coversContent(p, r, doc, vw, vh)) continue;
    }
    pinnedRects.push(r);
  }
  const occlusion = round(unionShare(pinnedRects, vw, vh), 3);

  lap('layout_occlusion');

  // ---- Density -------------------------------------------------------------
  let leaves = 0;
  for (const el of collector.leaves) {
    const r = el.getBoundingClientRect();
    if (r.width >= 1 && r.height >= 1 && inView(r, vw, vh) > 0) leaves++;
  }
  const corners = new Set<number>();
  for (const el of collector.blocks) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || inView(r, vw, vh) === 0) continue;
    corners.add(Math.round(r.left / 4) * 100_003 + Math.round(r.top / 4));
  }
  const main = input.main;
  const competing = input.regions.filter(
    (f) => f.el !== main && !f.containsMain,
  ).length;

  lap('layout_density');

  // ---- Kinds -----------------------------------------------------------------
  const found = sweep(doc, input.scopes);
  const ld = jsonLdFacts(doc);
  const product =
    input.jsonldProduct ||
    ld.product ||
    doc.querySelector('[itemtype*="schema.org/Product" i]') !== null ||
    /^product/i.test(
      doc.querySelector('meta[property="og:type"]')?.getAttribute('content') ??
        '',
    );
  const coverage = (el: Element): number => inView(rectOf(el), vw, vh) / vArea;
  const mainW = main ? rectOf(main).width : vw;
  const editor = found.editors.some((el) => {
    const p = el.parentElement;
    if (p && (p as HTMLElement).isContentEditable) return false;
    if (!isRendered(el)) return false;
    const r = rectOf(el);
    return coverage(el) >= 0.2 || (r.width >= 0.5 * mainW && r.height >= 200);
  });
  const application = found.applications.some(
    (el) =>
      el === doc.body ||
      el === doc.documentElement ||
      (isRendered(el) && coverage(el) >= 0.3),
  );
  let canvasArea = 0;
  for (const el of found.canvases)
    if (isRendered(el)) canvasArea += inView(rectOf(el), vw, vh);
  const canvas = canvasArea / vArea >= 0.4;
  // A player is a large video near the top of the page that a person plays
  // (eval M2): a muted hero playing on its own is a picture, not a player.
  const videoPlayer = found.players.some(
    (el) =>
      rectOf(el).top <= vh * 0.6 &&
      isRendered(el) &&
      coverage(el) >= 0.25 &&
      isPlayer(el),
  );
  // Paywalls: declared in JSON-LD, or a pinned paywall layer over the page.
  const paywall =
    ld.paywalled ||
    collector.pinned.some(
      (el) =>
        PAYWALL_WORDS.test(`${el.id} ${el.getAttribute('class') ?? ''}`) &&
        isVisible(el) &&
        coverage(el) >= 0.2,
    );
  const blockingOverlay = blocking(input, view, coverage, found.layers);
  lap('layout_kinds');
  const rowSlackMin = rowSlack(input, view, vw, vh);
  lap('layout_rows');
  const recordsF = records(input, vw, vh, sx, sy);
  lap('layout_records');
  const readerable = readerableScore(doc, (el) => isRendered(el));
  const isOutlined = outlined(input);
  lap('layout_readerable');
  const nav = navBaseline(doc);
  lap('layout_nav');

  return {
    bodyPx: input.mainFontPx,
    slack: {
      rowSlackMin,
      clipRiskShare: share(clipArea),
      fixedHeightTextShare: share(fixedArea),
      overlayTextShare: share(overlayArea),
    },
    occlusion,
    density: {
      leafPer100k: round(leaves / (vArea / 100_000), 1),
      corners: corners.size,
      fontSizes: sizes.size,
      regions: competing,
    },
    records: recordsF,
    readerable,
    outlined: isOutlined,
    kind: {
      product,
      editor,
      application,
      canvas,
      videoPlayer,
      paywall,
      blockingOverlay,
      password: found.password,
      payment: found.payment,
    },
    nav,
  };
}

/**
 * The zoom guard's baseline (docs/10 §5.1), counted as the guard counts
 * (eval M3), and the titles it compares truncation against (eval m1).
 */
function navBaseline(doc: Document): LayoutFeatures['nav'] {
  noteTitleBaseline(doc);
  const g = navReading(doc);
  return { primaryLinks: g.navLinks, searchVisible: g.searchVisible };
}

/**
 * A consent wall or modal blocks the page: a modal dialog (showModal makes
 * the rest inert), or a dialog, aria-modal or consent layer covering at
 * least half the viewport, or a smaller one over a page-wide backdrop.
 */
function blocking(
  input: LayoutInput,
  view: Window,
  coverage: (el: Element) => number,
  dialogs: readonly Element[],
): boolean {
  const doc = input.doc;
  try {
    for (const el of doc.querySelectorAll(':modal'))
      if (!isOurs(el)) return true;
  } catch {
    // ':modal' unsupported: fall through to the geometric test.
  }
  // Consent layers are pinned (CMP roots or consent-named boxes).
  const layers: Element[] = [...dialogs];
  for (const p of input.collector.pinned) {
    const idcls = `${p.id} ${p.getAttribute('class') ?? ''}`;
    if (CONSENT_WORDS.test(idcls) || p.matches(CMP_SELECTOR)) layers.push(p);
    else {
      const cmp = p.querySelector(CMP_SELECTOR);
      if (cmp) layers.push(cmp);
    }
  }
  const backdrops: Element[] = [];
  for (const p of input.collector.pinned) {
    if (coverage(p) < 0.9 || !isVisible(p)) continue;
    const cs = view.getComputedStyle(p);
    if (cs.pointerEvents === 'none') continue;
    const bg = /rgba?\(([^)]*)\)/.exec(cs.backgroundColor);
    const alpha = bg?.[1]?.split(',')[3];
    const opaque =
      bg !== null && (alpha === undefined || parseFloat(alpha) > 0.1);
    if (opaque || (cs.backdropFilter && cs.backdropFilter !== 'none'))
      backdrops.push(p);
  }
  for (const el of layers) {
    if (!isVisible(el)) continue;
    const c = coverage(el);
    if (c >= 0.5 || (backdrops.length && c >= 0.05)) return true;
  }
  return backdrops.some((b) => promptOver(b, input, view, coverage));
}

/**
 * A full-viewport backdrop blocks on its own, dialog role or not, when a
 * box that is no bar sits on top of it (Amazon's country prompt: a pinned
 * box over a black backdrop; eval M2). A backdrop around main is the page's
 * own shell, not a backdrop.
 */
function promptOver(
  backdrop: Element,
  input: LayoutInput,
  view: Window,
  coverage: (el: Element) => number,
): boolean {
  const main = input.main;
  if (main && composedContains(backdrop, main)) return false;
  const vw = view.innerWidth;
  const vh = view.innerHeight;
  let tried = 0;
  for (const q of input.collector.pinned) {
    if (q === backdrop || composedContains(q, backdrop)) continue;
    const c = coverage(q);
    if (c < 0.02 || c >= 0.9 || !isVisible(q)) continue;
    const r = input.rectOf(q);
    if (r.width >= 0.9 * vw && r.height < 0.25 * vh) continue;
    if (++tried > 6) break;
    const x = (Math.max(r.left, 0) + Math.min(r.right, vw)) / 2;
    const y = (Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2;
    const hit = input.doc.elementFromPoint(x, y);
    if (hit && (hit === q || composedContains(q, hit))) return true;
  }
  return false;
}
