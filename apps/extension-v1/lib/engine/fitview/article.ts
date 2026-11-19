import { HOST_TAG } from '../util/dom';
import {
  clean,
  FV_COPY,
  h,
  isFormField,
  makeTarget,
  mediaBox,
  ON_PAGE_TARGETS,
  onPageCard,
  quietLine,
  renderField,
  safeHref,
  siteControl,
  subtreeIds,
  waButton,
  withScope,
  type RenderCtx,
} from './components';
import { LONG_TITLE_CHARS, LONG_TITLE_CLASS } from './styles';

/**
 * Article sections (docs/10 §4.3, docs/12 §5 Reading): a readable column
 * rebuilt from an allowlist of tags, reading only text that is visible on the
 * page now, set on a raised reading sheet at the person's line length. Headings,
 * paragraphs, lists, quotes, figures, code and simple tables keep their
 * structure; every other element is flattened into its text. Players, frames
 * and canvases become "Use this on the page" cards; form controls are proxied.
 *
 * "Visible" means rendered (checkVisibility), not screen-reader-only (a 1 px
 * box), and not clipped away by an overflow-hidden ancestor, which is how soft
 * paywalls and "read more" folds hide text that is still in the DOM. As a last
 * guard every block is checked against the reader's own visible text
 * (registry.text): if the rebuilt block says more, the visible text is used.
 */

const SKIP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'meta',
  'link',
  'title',
  'base',
  'svg',
  'math',
  'object',
  'embed',
  'option',
  'datalist',
  HOST_TAG,
]);

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'dialog',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'ul',
]);

/** What makes a figure more than a picture and its caption. */
const LIVE_IN_FIGURE =
  'video, audio, iframe, canvas, button, input, select, textarea, [role="button"]';

/** Players, frames and drawing surfaces: never re-presented, offered on the page. */
const ON_PAGE_TAGS = new Set(['video', 'audio', 'iframe', 'canvas']);

/** Inline formatting kept as is. */
const INLINE_KEEP: Readonly<
  Record<string, 'strong' | 'em' | 'code' | 'sup' | 'sub'>
> = {
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  cite: 'em',
  code: 'code',
  kbd: 'code',
  samp: 'code',
  sup: 'sup',
  sub: 'sub',
};

const MAX_BLOCKS = 1500;
const MAX_TABLE_ROWS = 400;
const MAX_TABLE_COLS = 24;

type Checker = {
  view: Window;
  clip: Map<Element, DOMRect | null>;
  blocks: number;
};

function checker(ctx: RenderCtx): Checker {
  return {
    view: ctx.doc.defaultView ?? window,
    clip: new Map(),
    blocks: 0,
  };
}

type VisibilityTarget = Element & {
  checkVisibility?: (o?: Record<string, boolean>) => boolean;
};

/** The intersection of the clip boxes of `el`'s overflow:hidden/clip ancestors. */
function clipRect(ck: Checker, el: Element | null): DOMRect | null {
  if (!el || el === el.ownerDocument.documentElement) return null;
  if (ck.clip.has(el)) return ck.clip.get(el) ?? null;
  const parent = clipRect(ck, el.parentElement);
  const cs = ck.view.getComputedStyle(el);
  let own: DOMRect | null = null;
  const clips = (v: string): boolean => v === 'hidden' || v === 'clip';
  if (clips(cs.overflowX) || clips(cs.overflowY)) {
    const r = el.getBoundingClientRect();
    own = new DOMRect(
      clips(cs.overflowX) ? r.left : -1e9,
      clips(cs.overflowY) ? r.top : -1e9,
      clips(cs.overflowX) ? r.width : 2e9,
      clips(cs.overflowY) ? r.height : 2e9,
    );
  }
  let out: DOMRect | null = own ?? parent;
  if (own && parent) {
    const x = Math.max(own.left, parent.left);
    const y = Math.max(own.top, parent.top);
    const r = Math.min(own.right, parent.right);
    const b = Math.min(own.bottom, parent.bottom);
    out = new DOMRect(x, y, Math.max(0, r - x), Math.max(0, b - y));
  }
  ck.clip.set(el, out);
  return out;
}

/**
 * The share (0-1) of an element's height that is on screen: rendered, not
 * screen-reader-only, not clipped away by an overflow-hidden ancestor.
 */
export function visibleShare(ck: Checker, el: Element): number {
  const v = el as VisibilityTarget;
  if (
    typeof v.checkVisibility === 'function' &&
    !v.checkVisibility({
      visibilityProperty: true,
      opacityProperty: true,
      contentVisibilityAuto: false,
    })
  )
    return 0;
  const r = el.getBoundingClientRect();
  if (r.width < 2 && r.height < 2) {
    // display:contents has no box but its children may.
    return ck.view.getComputedStyle(el).display === 'contents' ? 1 : 0;
  }
  const clip = clipRect(ck, el.parentElement);
  if (!clip) return 1;
  const w = Math.min(r.right, clip.right) - Math.max(r.left, clip.left);
  const hgt = Math.min(r.bottom, clip.bottom) - Math.max(r.top, clip.top);
  if (w <= 1 || hgt <= 1) return 0;
  return Math.min(1, hgt / Math.max(1, r.height));
}

/** Anything of it is on screen (containers, inline content). */
export function isVisible(ck: Checker, el: Element): boolean {
  return visibleShare(ck, el) > 0;
}

/**
 * A text block cut by a clipping box (a "read more" fold, a soft paywall):
 * under half of it showing counts as hidden; otherwise only the share that
 * shows is kept, cut at a word, so no hidden line reaches the view.
 */
function clipToShare(ck: Checker, src: Element, out: HTMLElement): boolean {
  const share = visibleShare(ck, src);
  if (share < 0.5) return false;
  if (share >= 0.95) return true;
  const text = clean(out.textContent);
  const cut = text.slice(0, Math.floor(text.length * share));
  const word = cut.replace(/\s+\S*$/, '');
  out.textContent = `${word || cut}…`;
  return true;
}

function isBlock(ck: Checker, el: Element): boolean {
  if (BLOCK_TAGS.has(el.localName)) return true;
  if (ON_PAGE_TAGS.has(el.localName)) return true;
  const d = ck.view.getComputedStyle(el).display;
  return !(d.startsWith('inline') || d === 'contents' || d === 'none');
}

function childNodesOf(el: Element): NodeListOf<ChildNode> {
  const sr = (el as HTMLElement).shadowRoot;
  return (sr ?? el).childNodes;
}

function hasBlockChild(ck: Checker, el: Element): boolean {
  for (const c of childNodesOf(el)) {
    if (c.nodeType === 1 && !SKIP.has((c as Element).localName)) {
      if (isBlock(ck, c as Element)) return true;
    }
  }
  return false;
}

/** The nearest node id at or above `el` (for inline links that are not skeleton nodes). */
function nearestId(ctx: RenderCtx, el: Element): string | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const id = ctx.index.byElement.get(n);
    if (id) return id;
  }
  return null;
}

/** Every node the reader found at or inside `el`. */
function nodesWithin(ctx: RenderCtx, el: Element): string[] {
  const own = ctx.index.byElement.get(el);
  if (own) return subtreeIds(ctx.index, own);
  if (!el.firstElementChild) return [];
  const out: string[] = [];
  for (const [node, id] of ctx.index.byElement)
    if (el.contains(node)) out.push(...subtreeIds(ctx.index, id));
  return out;
}

/** Everything inside an element the view does not show (it is not visible). */
function hideWithin(ctx: RenderCtx, el: Element): void {
  for (const id of nodesWithin(ctx, el)) ctx.hide(id);
}

/** Everything inside an element rendered as a whole (code blocks). */
function emitWithin(ctx: RenderCtx, el: Element): void {
  for (const id of nodesWithin(ctx, el)) ctx.emit(id);
}

/**
 * Inline content of `el` into `out`: text, kept formatting, links (proxied,
 * href pinned) and inline controls.
 */
export function renderInline(
  ctx: RenderCtx,
  el: Element,
  out: HTMLElement,
  ck: Checker = checker(ctx),
): void {
  for (const n of childNodesOf(el)) {
    if (n.nodeType === 3) {
      const t = (n.nodeValue ?? '').replace(/\s+/g, ' ');
      if (t) out.append(ctx.doc.createTextNode(t));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const c = n as Element;
    const tag = c.localName;
    if (SKIP.has(tag)) continue;
    if (tag === 'br') {
      out.append(h(ctx.doc, 'br'));
      continue;
    }
    if (!isVisible(ck, c)) {
      hideWithin(ctx, c);
      continue;
    }
    const id = ctx.index.byElement.get(c);
    if (id) ctx.emit(id);
    if (tag === 'img') {
      const alt = clean(c.getAttribute('alt'));
      if (alt) out.append(ctx.doc.createTextNode(alt));
      continue;
    }
    if (tag === 'a') {
      out.append(inlineLink(ctx, c, ck));
      continue;
    }
    if (isFormField(c) || c.localName === 'button') {
      const owner = id ?? null;
      const control = owner
        ? isFormField(c)
          ? renderField(ctx, owner, c)
          : siteControl(ctx, owner, c, { variant: 'inline' })
        : null;
      if (control) out.append(control);
      else {
        const t = clean(ctx.registry.text(c));
        if (t) out.append(ctx.doc.createTextNode(t));
      }
      continue;
    }
    const keep = INLINE_KEEP[tag];
    if (keep) {
      const k = h(ctx.doc, keep);
      renderInline(ctx, c, k, ck);
      if (k.childNodes.length) out.append(k);
      continue;
    }
    renderInline(ctx, c, out, ck);
  }
}

function inlineLink(ctx: RenderCtx, a: Element, ck: Checker): Node {
  const href = safeHref(ctx.registry.href(a));
  const id = ctx.index.byElement.get(a) ?? nearestId(ctx, a);
  const holder = h(ctx.doc, 'span');
  renderInline(ctx, a, holder, ck);
  const text = clean(holder.textContent);
  if (!href || !id || !text) {
    // Not a navigable link (javascript:, no href) or nothing visible in it.
    if (id && ctx.index.byElement.get(a) === id) {
      const b = siteControl(ctx, id, a, { variant: 'inline' });
      if (b) return b;
    }
    return ctx.doc.createTextNode(holder.textContent ?? '');
  }
  const link = h(ctx.doc, 'a', 'fv-inline');
  link.href = href;
  while (holder.firstChild) link.append(holder.firstChild);
  // An inline link inside a text block is not a skeleton node of its own: the
  // target is the block, and the pinned href tells the live layer which link.
  ctx.bind(
    link,
    makeTarget(ctx, id, a, 'link', {
      href,
      name: clean(ctx.registry.name(a)) || text,
    }),
  );
  return link;
}

/** Trim leading and trailing whitespace of a rebuilt block. */
function trimBlock(el: HTMLElement): void {
  const first = el.firstChild;
  if (first?.nodeType === 3)
    first.nodeValue = (first.nodeValue ?? '').replace(/^\s+/, '');
  const last = el.lastChild;
  if (last?.nodeType === 3)
    last.nodeValue = (last.nodeValue ?? '').replace(/\s+$/, '');
}

/**
 * The last guard on page text: a rebuilt block may never say more than the
 * reader sees. If it does (text hidden in ways the walk missed), the visible
 * text replaces it, without links.
 */
function guardVisible(ctx: RenderCtx, src: Element, out: HTMLElement): boolean {
  const mine = clean(out.textContent);
  if (!mine) return false;
  const seen = clean(ctx.registry.text(src));
  if (!seen) return false;
  if (mine.length > seen.length * 1.15 + 12) {
    out.textContent = seen;
  }
  return true;
}

/** One paragraph-like block of inline content; null when nothing in it is visible. */
export function renderTextBlock(
  ctx: RenderCtx,
  src: Element,
  tag: 'p' | 'li' | 'figcaption' | 'dt' | 'dd' | 'span' = 'p',
  cls = 't-body',
  ck: Checker = checker(ctx),
): HTMLElement | null {
  const out = h(ctx.doc, tag, cls);
  renderInline(ctx, src, out, ck);
  trimBlock(out);
  if (!guardVisible(ctx, src, out) || !clipToShare(ck, src, out)) {
    hideWithin(ctx, src);
    return null;
  }
  const id = ctx.index.byElement.get(src);
  if (id) ctx.emit(id);
  out.dataset.y = String(Math.round(src.getBoundingClientRect().top));
  return out;
}

function headingFor(
  ctx: RenderCtx,
  src: Element,
  level: number,
  ck: Checker,
): HTMLElement | null {
  // The page's title already leads the view (docs/11 R1): never twice.
  if (ctx.titleEl && (src === ctx.titleEl || src.contains(ctx.titleEl))) {
    emitWithin(ctx, src);
    return null;
  }
  let tag: 'h1' | 'h2' | 'h3' | 'h4';
  let cls: string;
  if (level <= 1 && !ctx.hasH1) {
    tag = 'h1';
    cls = 't-page';
    ctx.hasH1 = true;
  } else if (level <= 2) {
    tag = 'h2';
    cls = 't-section';
  } else if (level === 3) {
    tag = 'h3';
    cls = 't-title';
  } else {
    tag = 'h4';
    cls = 't-title';
  }
  const out = h(ctx.doc, tag, `${cls} cue`);
  renderInline(ctx, src, out, ck);
  trimBlock(out);
  if (!guardVisible(ctx, src, out) || !clipToShare(ck, src, out)) {
    hideWithin(ctx, src);
    return null;
  }
  // A title of a paragraph's length stays the h1 at the section size.
  if (tag === 'h1' && clean(out.textContent).length > LONG_TITLE_CHARS)
    out.classList.add(LONG_TITLE_CLASS);
  const id = ctx.index.byElement.get(src);
  if (id) ctx.emit(id);
  return out;
}

type SegmenterCtor = new (
  lang?: string,
  o?: { granularity: 'sentence' },
) => { segment(s: string): Iterable<{ index: number; segment: string }> };

/** Short paragraphs are never split, however many sentences they have. */
const SPLIT_MIN_CHARS = 160;

/**
 * Short paragraphs (docs/11 R5): a running-text paragraph longer than
 * `structure.splitSentences` sentences is shown as several of that many
 * sentences, cut only at sentence ends (Intl.Segmenter) and never inside an
 * inline element, so links and emphasis stay whole. The words do not change.
 */
export function splitParagraph(ctx: RenderCtx, p: HTMLElement): Node {
  const n = ctx.layout.structure?.splitSentences;
  if (!n || n < 1) return p;
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  const text = p.textContent ?? '';
  if (!Seg || text.length < SPLIT_MIN_CHARS) return p;
  let seg: InstanceType<SegmenterCtor>;
  try {
    seg = new Seg(ctx.skeleton.lang || undefined, { granularity: 'sentence' });
  } catch {
    seg = new Seg(undefined, { granularity: 'sentence' });
  }
  const ends: number[] = [];
  for (const x of seg.segment(text)) ends.push(x.index + x.segment.length);
  if (ends.length <= n) return p;
  // Where a cut may fall: at a child boundary, or inside a plain text node.
  const spans: Array<{ node: ChildNode; start: number; end: number }> = [];
  let off = 0;
  for (const k of Array.from(p.childNodes)) {
    const len = (k.textContent ?? '').length;
    spans.push({ node: k, start: off, end: off + len });
    off += len;
  }
  const cuttable = (at: number): boolean => {
    for (const sp of spans) {
      if (at === sp.start || at === sp.end) return true;
      if (at > sp.start && at < sp.end) return sp.node.nodeType === 3;
    }
    return false;
  };
  const cuts: number[] = [];
  let count = 0;
  for (let i = 0; i < ends.length - 1; i++) {
    count++;
    const at = ends[i] as number;
    if (count >= n && cuttable(at)) {
      cuts.push(at);
      count = 0;
    }
  }
  if (!cuts.length) return p;
  // Split text nodes at the cuts, then deal the nodes out into paragraphs.
  for (const at of cuts) {
    for (const sp of spans) {
      if (at > sp.start && at < sp.end && sp.node.nodeType === 3) {
        const tail = (sp.node as Text).splitText(at - sp.start);
        const i = spans.indexOf(sp);
        spans.splice(i + 1, 0, { node: tail, start: at, end: sp.end });
        sp.end = at;
        break;
      }
    }
  }
  const frag = ctx.doc.createDocumentFragment();
  let cur = p.cloneNode(false) as HTMLElement;
  let next = 0;
  for (const sp of spans) {
    if (next < cuts.length && sp.start >= (cuts[next] as number)) {
      trimBlock(cur);
      if (clean(cur.textContent) || cur.childElementCount) frag.append(cur);
      cur = p.cloneNode(false) as HTMLElement;
      next++;
    }
    cur.append(sp.node);
  }
  trimBlock(cur);
  if (clean(cur.textContent) || cur.childElementCount) frag.append(cur);
  return frag;
}

/** A data table, rebuilt cell by cell (structure kept: tables are 2D content). */
export function renderTable(
  ctx: RenderCtx,
  table: HTMLTableElement,
  ck: Checker = checker(ctx),
): HTMLElement | null {
  const wrap = h(ctx.doc, 'div', 'fv-table-wrap');
  const out = h(ctx.doc, 'table', 'fv-table t-body');
  const cap = table.caption;
  if (cap && isVisible(ck, cap)) {
    const c = h(ctx.doc, 'caption', 't-title');
    renderInline(ctx, cap, c, ck);
    trimBlock(c);
    if (clean(c.textContent)) out.append(c);
  }
  let head: HTMLTableSectionElement | null = null;
  let body: HTMLTableSectionElement | null = null;
  let rows = 0;
  for (const tr of Array.from(table.rows)) {
    if (rows >= MAX_TABLE_ROWS) break;
    if (!isVisible(ck, tr)) continue;
    const inHead = tr.parentElement?.localName === 'thead';
    const row = h(ctx.doc, 'tr');
    let cols = 0;
    for (const cell of Array.from(tr.cells)) {
      if (cols >= MAX_TABLE_COLS) break;
      if (!isVisible(ck, cell)) continue;
      const c = h(ctx.doc, cell.localName === 'th' ? 'th' : 'td');
      if (cell.colSpan > 1) c.colSpan = Math.min(cell.colSpan, MAX_TABLE_COLS);
      if (cell.rowSpan > 1) c.rowSpan = Math.min(cell.rowSpan, MAX_TABLE_ROWS);
      if (cell.localName === 'th') {
        const scope = cell.getAttribute('scope');
        if (scope === 'row' || scope === 'col') c.scope = scope;
      }
      renderInline(ctx, cell, c, ck);
      trimBlock(c);
      row.append(c);
      cols++;
    }
    if (!cols) continue;
    if (inHead) {
      head ??= out.createTHead();
      head.append(row);
    } else {
      body ??= out.createTBody();
      body.append(row);
    }
    rows++;
  }
  if (!rows) return null;
  const id = ctx.index.byElement.get(table);
  if (id) ctx.emit(id);
  wrap.append(out);
  return wrap;
}

const CELL_ROLES =
  '[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]';

/**
 * A table drawn with ARIA roles (a comparison grid of divs) as a real table:
 * one row per role=row (or per child), one cell per role=cell (or child).
 * Each cell keeps its own words, so a column of "Shop now" links stays one
 * per product, never a run of "Shop now Shop now Shop now".
 */
function ariaTable(ctx: RenderCtx, el: Element, ck: Checker): Node | null {
  const rowEls = Array.from(el.querySelectorAll('[role="row"]')).filter(
    (r) => r.closest('[role="table"], [role="grid"]') === el,
  );
  const rows = rowEls.length ? rowEls : Array.from(el.children);
  const wrap = h(ctx.doc, 'div', 'fv-table-wrap');
  const out = h(ctx.doc, 'table', 'fv-table t-body');
  const body = out.createTBody();
  let n = 0;
  for (const r of rows.slice(0, MAX_TABLE_ROWS)) {
    if (!isVisible(ck, r)) {
      hideWithin(ctx, r);
      continue;
    }
    const cellEls = Array.from(r.querySelectorAll(CELL_ROLES)).filter(
      (c) => c.closest('[role="row"]') === r || !rowEls.length,
    );
    const cells = cellEls.length ? cellEls : Array.from(r.children);
    const tr = h(ctx.doc, 'tr');
    for (const c of cells.slice(0, MAX_TABLE_COLS)) {
      if (!isVisible(ck, c)) {
        hideWithin(ctx, c);
        continue;
      }
      const role = c.getAttribute('role');
      const td = h(
        ctx.doc,
        role === 'columnheader' || role === 'rowheader' ? 'th' : 'td',
      );
      if (hasBlockChild(ck, c)) {
        const holder = h(ctx.doc, 'div', 'fv-stack');
        renderBlocks(ctx, c, holder, ck);
        td.append(...Array.from(holder.childNodes));
      } else {
        renderInline(ctx, c, td, ck);
        trimBlock(td);
      }
      tr.append(td);
    }
    if (!tr.childNodes.length) continue;
    body.append(tr);
    n++;
  }
  if (!n) return null;
  const id = ctx.index.byElement.get(el);
  if (id) ctx.emit(id);
  emitWithin(ctx, el);
  wrap.append(out);
  return wrap;
}

/** Short lines (a name, a price, one link, a button) that read as one row. */
const SHORT_LINE = 28;
function shortLine(el: Element): boolean {
  if (el.localName === 'button' || el.classList.contains('fv-btn'))
    return clean(el.textContent).length <= SHORT_LINE;
  if (el.localName !== 'p') return false;
  const t = clean(el.textContent);
  if (!t || t.length > SHORT_LINE || /[.!?…]$/.test(t)) return false;
  return Array.from(el.children).every((c) => c.localName === 'a');
}

/** Lines further apart than this on the page (CSS px) were not one row there. */
const SAME_BAND_PX = 72;

/**
 * Short lines that sat side by side on the page (a product name, "Starting
 * at", "CA$277", "Shop all") are set on one wrapping row again instead of a
 * tall stack of one-word paragraphs. Order and words are unchanged.
 */
export function groupShortLines(col: HTMLElement): void {
  let run: HTMLElement[] = [];
  const flush = (): void => {
    if (run.length >= 3) {
      const row = col.ownerDocument.createElement('div');
      row.className = 'fv-lines';
      run[0]?.before(row);
      row.append(...run);
    }
    run = [];
  };
  const y = (e: HTMLElement): number => Number(e.dataset.y ?? NaN);
  for (const c of Array.from(col.children) as HTMLElement[]) {
    if (!shortLine(c)) {
      flush();
      continue;
    }
    const first = run[0];
    if (first && !(Math.abs(y(c) - y(first)) <= SAME_BAND_PX)) flush();
    run.push(c);
  }
  flush();
}

/**
 * A link that is the whole of its line (a paragraph, a list item, a table
 * cell) is a target of its own, not a link inside running text: it gets
 * the person's target size (WCAG 2.5.8's inline exception does not apply).
 */
export function markSoloLinks(col: HTMLElement): void {
  for (const a of Array.from(
    col.querySelectorAll<HTMLElement>('a.fv-inline'),
  )) {
    const line = a.parentElement?.closest('p, li, td, th, dd, figcaption');
    if (!line) continue;
    if (clean(line.textContent) === clean(a.textContent))
      a.classList.add('fv-solo');
  }
}

/**
 * A section's players ("Video", "Play video of a young man walking...")
 * become one quiet line where the first one was: "3 videos · Watch on the
 * page", whose button shows the first of them on the page. A card per
 * player reads as more things to do than the section has.
 */
export function quietPlayers(ctx: RenderCtx, col: HTMLElement): void {
  const cards = Array.from(
    col.querySelectorAll<HTMLElement>('.fv-onpage[data-player]'),
  );
  if (!cards.length) return;
  const heads = Array.from(col.querySelectorAll('h2'));
  const sectionOf = (c: HTMLElement): Element | null => {
    let last: Element | null = null;
    for (const hd of heads)
      if (hd.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)
        last = hd;
    return last;
  };
  const groups = new Map<Element | null, HTMLElement[]>();
  for (const c of cards) {
    const k = sectionOf(c);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  for (const group of groups.values()) {
    const first = group[0] as HTMLElement;
    const kind = first.dataset.player ?? 'video';
    const same = group.every((c) => c.dataset.player === kind);
    const words =
      FV_COPY.players[same ? kind : 'iframe'] ?? FV_COPY.players.iframe;
    const [one, many, go] = words as readonly [string, string, string];
    const n = group.length;
    const target = ON_PAGE_TARGETS.get(first) ?? { id: null, el: null };
    const line = quietLine(
      ctx,
      `${n} ${n === 1 ? one : many}`,
      go,
      target.id,
      target.el,
    );
    first.replaceWith(line);
    for (const c of group.slice(1)) {
      // Drop the card and any wrapper it leaves empty (a list item).
      let gone: Element = c;
      while (
        gone.parentElement &&
        gone.parentElement !== col &&
        gone.parentElement.childElementCount === 1
      )
        gone = gone.parentElement;
      gone.remove();
    }
  }
  for (const w of Array.from(col.querySelectorAll('ul:empty, ol:empty')))
    w.remove();
}

function figureFor(
  ctx: RenderCtx,
  src: Element,
  ck: Checker,
): HTMLElement | null {
  const fig = h(ctx.doc, 'figure');
  const imgs =
    src.localName === 'img' || src.localName === 'picture'
      ? [src]
      : Array.from(src.querySelectorAll('img, picture')).filter(
          (i) =>
            !(
              i.localName === 'img' && i.parentElement?.localName === 'picture'
            ),
        );
  const cap = src.querySelector('figcaption');
  for (const img of imgs) {
    if (!isVisible(ck, img)) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const box = mediaBox(ctx, img, 'fv-thumb');
    box.style.setProperty('max-width', `${Math.round(r.width / ctx.zoom)}px`);
    const id = ctx.index.byElement.get(img);
    if (id) ctx.emit(id);
    // An image that is a link (a file page, a larger view) opens through it.
    const link = img.closest('a');
    const linkId =
      link && src.contains(link) ? ctx.index.byElement.get(link) : undefined;
    const href = link ? safeHref(ctx.registry.href(link)) : null;
    if (link && linkId && href) {
      const name =
        clean(ctx.registry.name(link)) ||
        (cap ? clean(ctx.registry.text(cap)) : '');
      const a = h(ctx.doc, 'a', 'fv-thumb-open');
      a.href = href;
      if (name) a.setAttribute('aria-label', name);
      else {
        // Nothing names it: a pointer shortcut only, not an unnamed tab stop.
        a.tabIndex = -1;
        a.setAttribute('aria-hidden', 'true');
      }
      a.append(box);
      ctx.bind(a, makeTarget(ctx, linkId, link, 'link', { href, name }));
      ctx.emit(linkId);
      fig.append(a);
    } else fig.append(box);
  }
  if (cap && isVisible(ck, cap)) {
    const c = renderTextBlock(ctx, cap, 'figcaption', 't-meta', ck);
    if (c) fig.append(c);
  }
  // Other words on the figure (a photo credit) stay with it.
  for (const id of nodesWithin(ctx, src)) {
    const n = ctx.index.nodes.get(id);
    if (n?.kind !== 'stext' && n?.kind !== 'text') continue;
    if (ctx.isEmitted(id)) continue;
    const t = ctx.registry.element(id);
    if (!t || (cap && cap.contains(t))) continue;
    const line = renderTextBlock(ctx, t, 'p', 't-meta', ck);
    if (line) fig.append(line);
  }
  if (!fig.childNodes.length) return null;
  const id = ctx.index.byElement.get(src);
  if (id) ctx.emit(id);
  return fig;
}

/**
 * Block content of `root` into `out`, flattening containers. Runs of loose
 * text and inline elements become paragraphs.
 */
export function renderBlocks(
  ctx: RenderCtx,
  root: Element,
  out: HTMLElement,
  ck: Checker = checker(ctx),
): void {
  let loose: HTMLElement | null = null;
  const flush = (): void => {
    if (!loose) return;
    trimBlock(loose);
    if (clean(loose.textContent)) out.append(splitParagraph(ctx, loose));
    loose = null;
  };
  for (const n of childNodesOf(root)) {
    if (ck.blocks > MAX_BLOCKS) break;
    if (n.nodeType === 3) {
      const t = (n.nodeValue ?? '').replace(/\s+/g, ' ');
      if (!t.trim() && !loose) continue;
      loose ??= h(ctx.doc, 'p', 't-body');
      loose.append(ctx.doc.createTextNode(t));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (SKIP.has(el.localName)) continue;
    if (!isVisible(ck, el)) {
      hideWithin(ctx, el);
      continue;
    }
    if (!isBlock(ck, el)) {
      // Inline element in a block context: part of a loose paragraph.
      loose ??= h(ctx.doc, 'p', 't-body');
      renderInlineElement(ctx, el, loose, ck);
      continue;
    }
    flush();
    ck.blocks++;
    const block = renderBlock(ctx, el, ck);
    if (block) out.append(block);
  }
  flush();
}

/** One inline element (and its subtree) into `out`. */
function renderInlineElement(
  ctx: RenderCtx,
  el: Element,
  out: HTMLElement,
  ck: Checker,
): void {
  const tag = el.localName;
  const id = ctx.index.byElement.get(el);
  if (id) ctx.emit(id);
  if (tag === 'a') {
    out.append(inlineLink(ctx, el, ck));
    return;
  }
  if (isFormField(el) || tag === 'button') {
    const control = id
      ? isFormField(el)
        ? renderField(ctx, id, el)
        : siteControl(ctx, id, el, { variant: 'inline' })
      : null;
    if (control) out.append(control);
    else {
      const t = clean(ctx.registry.text(el));
      if (t) out.append(ctx.doc.createTextNode(` ${t} `));
    }
    return;
  }
  if (tag === 'img') {
    const alt = clean(el.getAttribute('alt'));
    if (alt) out.append(ctx.doc.createTextNode(alt));
    return;
  }
  const keep = INLINE_KEEP[tag];
  if (keep) {
    const k = h(ctx.doc, keep);
    renderInline(ctx, el, k, ck);
    if (k.childNodes.length) out.append(k);
    return;
  }
  renderInline(ctx, el, out, ck);
}

function renderBlock(ctx: RenderCtx, el: Element, ck: Checker): Node | null {
  const tag = el.localName;
  const id = ctx.index.byElement.get(el);
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return headingFor(ctx, el, Number(heading[1]), ck);
  if (el.getAttribute('role') === 'heading') {
    const lvl = Number(el.getAttribute('aria-level') ?? 2);
    return headingFor(ctx, el, Number.isFinite(lvl) ? lvl : 2, ck);
  }
  switch (tag) {
    case 'p':
    case 'address':
    case 'summary':
      if (tag === 'summary' && id) {
        return siteControl(ctx, id, el, { variant: 'btn' });
      }
      if (hasBlockChild(ck, el)) return container(ctx, el, ck);
      return prose(ctx, renderTextBlock(ctx, el, 'p', 't-body', ck));
    case 'ul':
    case 'ol': {
      const list = h(ctx.doc, tag);
      for (const li of Array.from(el.children)) {
        if (li.localName !== 'li') continue;
        if (!isVisible(ck, li)) {
          hideWithin(ctx, li);
          continue;
        }
        const item = h(ctx.doc, 'li', 't-body');
        if (hasBlockChild(ck, li)) renderBlocks(ctx, li, item, ck);
        else {
          renderInline(ctx, li, item, ck);
          trimBlock(item);
          if (!guardVisible(ctx, li, item) || !clipToShare(ck, li, item)) {
            hideWithin(ctx, li);
            continue;
          }
        }
        const lid = ctx.index.byElement.get(li);
        if (lid) ctx.emit(lid);
        if (
          clean(item.textContent) ||
          item.querySelector('a,button,input,select,textarea,img')
        )
          list.append(item);
      }
      if (!list.childNodes.length) return null;
      if (id) ctx.emit(id);
      return list;
    }
    case 'blockquote': {
      const q = h(ctx.doc, 'blockquote');
      renderBlocks(ctx, el, q, ck);
      if (!q.childNodes.length) return null;
      if (id) ctx.emit(id);
      return q;
    }
    case 'pre': {
      const pre = h(ctx.doc, 'pre', 't-body');
      const seen = ctx.registry.text(el);
      // Code keeps its line breaks; the reader's text is whitespace-normalised.
      const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
      pre.textContent =
        clean(raw).length <= clean(seen).length * 1.15 + 12 ? raw : seen;
      if (!clean(pre.textContent)) return null;
      emitWithin(ctx, el);
      return pre;
    }
    case 'table':
      return renderTable(ctx, el as HTMLTableElement, ck);
    case 'figure':
    case 'picture':
      // A figure holding a player or a control is walked like any container,
      // so the player's card and its buttons are kept.
      if (el.querySelector(LIVE_IN_FIGURE)) return container(ctx, el, ck);
      return figureFor(ctx, el, ck);
    case 'hr':
      return null;
    case 'dl': {
      const wrap = h(ctx.doc, 'div', 'fv-stack');
      for (const c of Array.from(el.children)) {
        if (!isVisible(ck, c)) continue;
        if (c.localName === 'dt') {
          const t = renderTextBlock(ctx, c, 'p', 't-body fv-strong', ck);
          if (t) wrap.append(t);
        } else if (c.localName === 'dd') {
          const d = hasBlockChild(ck, c)
            ? container(ctx, c, ck)
            : renderTextBlock(ctx, c, 'p', 't-body', ck);
          if (d) wrap.append(d);
        } else {
          const b = renderBlock(ctx, c, ck);
          if (b) wrap.append(b);
        }
      }
      if (id) ctx.emit(id);
      return wrap.childNodes.length ? wrap : null;
    }
    default:
      break;
  }
  if (tag === 'img') return figureFor(ctx, el, ck);
  if (ON_PAGE_TAGS.has(tag)) {
    const label =
      clean(ctx.registry.name(el)) ||
      clean(el.getAttribute('title')) ||
      (FV_COPY.player[tag] ?? '');
    const card = onPageCard(ctx, id ?? null, el, label);
    card.dataset.player = tag;
    return card;
  }
  if (
    (el.getAttribute('role') === 'table' ||
      el.getAttribute('role') === 'grid') &&
    tag !== 'table'
  )
    return ariaTable(ctx, el, ck);
  if (isFormField(el)) return id ? renderField(ctx, id, el) : null;
  if (tag === 'button' || el.getAttribute('role') === 'button') {
    const b = id ? siteControl(ctx, id, el, { variant: 'btn' }) : null;
    if (b) b.dataset.y = String(Math.round(el.getBoundingClientRect().top));
    return b;
  }
  if (tag === 'a') {
    const p = h(ctx.doc, 'p', 't-body');
    p.append(inlineLink(ctx, el, ck));
    if (!clean(p.textContent)) return null;
    if (id) ctx.emit(id);
    p.dataset.y = String(Math.round(el.getBoundingClientRect().top));
    return p;
  }
  if (
    el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('contenteditable') === ''
  ) {
    return onPageCard(
      ctx,
      id ?? null,
      el,
      clean(ctx.registry.name(el)),
      FV_COPY.doOnPage,
    );
  }
  // Generic container: flatten.
  return hasBlockChild(ck, el)
    ? container(ctx, el, ck)
    : prose(ctx, renderTextBlock(ctx, el, 'p', 't-body', ck));
}

/** A rebuilt running-text paragraph, split at sentence ends when it is long. */
function prose(ctx: RenderCtx, p: HTMLElement | null): Node | null {
  return p ? splitParagraph(ctx, p) : null;
}

/** A flattening container: its blocks, with no box of its own. */
function container(ctx: RenderCtx, el: Element, ck: Checker): Node | null {
  const holder = h(ctx.doc, 'div');
  renderBlocks(ctx, el, holder, ck);
  if (!holder.childNodes.length) return null;
  const id = ctx.index.byElement.get(el);
  if (id) ctx.emit(id);
  const frag = ctx.doc.createDocumentFragment();
  while (holder.firstChild) frag.append(holder.firstChild);
  return frag;
}

/**
 * "On this page" (docs/11 R6): text with 3 or more headings gets a list of
 * its top-level headings above it. Each entry scrolls to its heading and
 * moves focus there; the words are the headings' own.
 */
export function outlineFor(
  ctx: RenderCtx,
  col: HTMLElement,
): HTMLElement | null {
  const all = Array.from(col.querySelectorAll<HTMLElement>('h2, h3'));
  const top = all.some((x) => x.localName === 'h2')
    ? all.filter((x) => x.localName === 'h2')
    : all;
  const heads = top.filter((x) => clean(x.textContent));
  if (heads.length < 3) return null;
  const nav = h(ctx.doc, 'nav', 'fv-outline');
  const label = h(ctx.doc, 'h2', 't-title', FV_COPY.onThisPage);
  label.id = ctx.uid('o');
  nav.setAttribute('aria-labelledby', label.id);
  const list = h(ctx.doc, 'ol', 'fv-plain');
  // A long outline shows its first sections (fewer for a person who needs
  // calm); the rest are one click away.
  const shown =
    (ctx.layout.structure?.level ?? 0) === 2
      ? OUTLINE_SHOWN_CALM
      : OUTLINE_SHOWN;
  const rest = h(ctx.doc, 'ol', 'fv-plain');
  rest.id = ctx.uid('o');
  rest.hidden = true;
  heads.forEach((hd, i) => {
    hd.id ||= ctx.uid('s');
    hd.tabIndex = -1;
    const li = h(ctx.doc, 'li');
    const b = h(ctx.doc, 'button', 'fv-jump', clean(hd.textContent));
    b.type = 'button';
    b.addEventListener('click', () => {
      const scroller = hd.closest<HTMLElement>('.fv-scroller');
      if (scroller) {
        const strip = scroller.querySelector<HTMLElement>(
          '.fv-strip.is-sticky',
        );
        const below = strip ? strip.getBoundingClientRect().height : 0;
        scroller.scrollTop +=
          hd.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          below -
          ctx.layout.space.unitPx / ctx.zoom;
      } else hd.scrollIntoView({ block: 'start' });
      hd.focus({ preventScroll: true });
    });
    li.append(b);
    (i < shown ? list : rest).append(li);
  });
  nav.append(label, list);
  if (rest.childNodes.length) {
    rest.start = shown + 1;
    const more = waButton(
      ctx,
      FV_COPY.allSections(heads.length),
      () => {
        const open = rest.hidden;
        rest.hidden = !open;
        more.setAttribute('aria-expanded', String(open));
        more.textContent = open
          ? FV_COPY.fewerSections
          : FV_COPY.allSections(heads.length);
      },
      { expanded: false },
    );
    more.setAttribute('aria-controls', rest.id);
    nav.append(rest, more);
  }
  return nav;
}

/** Outline entries shown before "All n sections". */
export const OUTLINE_SHOWN = 6;
export const OUTLINE_SHOWN_CALM = 4;

/** The readable column for an article section's nodes. */
export function renderArticle(
  ctx: RenderCtx,
  ids: string[],
  opts: { outline?: boolean } = {},
): HTMLElement {
  const col = h(ctx.doc, 'div', 'fv-prose');
  const ck = checker(ctx);
  for (const id of ids) {
    const el = ctx.registry.element(id);
    if (!el) continue;
    const before = col.childNodes.length;
    if (BLOCK_TAGS.has(el.localName) && !hasBlockChild(ck, el)) {
      const b = renderBlock(ctx, el, ck);
      if (b) col.append(b);
    } else if (
      ON_PAGE_TAGS.has(el.localName) ||
      el.localName === 'table' ||
      el.localName === 'img'
    ) {
      const b = renderBlock(ctx, el, ck);
      if (b) col.append(b);
    } else {
      renderBlocks(ctx, el, col, ck);
    }
    if (col.childNodes.length > before) ctx.emit(id);
    // Lists the reader found inside the text (a README's nested lists, a
    // run of paragraphs) were drawn as text, in place: they are in the view.
    for (const sub of subtreeIds(ctx.index, id)) {
      if (ctx.index.nodes.get(sub)?.kind !== 'collection') continue;
      const cel = ctx.registry.element(sub);
      if (cel && el.contains(cel) && isVisible(ck, cel)) ctx.emit(sub);
    }
  }
  groupShortLines(col);
  quietPlayers(ctx, col);
  markSoloLinks(col);
  if (opts.outline) {
    const nav = outlineFor(ctx, col);
    if (nav) col.prepend(nav);
  }
  return col;
}

/**
 * The reading sheet (docs/12 §5 Reading): a raised sheet on the canvas
 * holding an article section's columns, one per node id (each in its own
 * control scope), with "On this page" above them when `outline` is set and
 * the text has 3 or more headings.
 */
export function readingSheet(
  ctx: RenderCtx,
  ids: readonly string[],
  opts: { outline?: boolean } = {},
): HTMLElement {
  const sheet = h(ctx.doc, 'div', 'fv-article');
  for (const id of ids)
    withScope(ctx, id, () => sheet.append(renderArticle(ctx, [id])));
  if (opts.outline) {
    const nav = outlineFor(ctx, sheet);
    if (nav) sheet.prepend(nav);
  }
  return sheet;
}

export { checker as articleChecker };
