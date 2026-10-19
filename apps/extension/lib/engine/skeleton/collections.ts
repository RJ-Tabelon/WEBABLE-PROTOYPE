import { insideAd } from './ads';
import { classTokens, SKEL_SKIP, shadowOf, type OpenClosed } from './dom';
import { explicitRole } from './roles';
import { normalizeSpace } from './text';
import { isVisible } from './visible';

/**
 * Record detection (docs/10 §3.1, §4.1): a collection is a run of at least
 * three similar siblings, after MDR/DEPTA (review 10.md §5) but with
 * geometry, not class names alone, because modern sites hash their classes:
 *
 *   same template   tag + role equal, class-token Jaccard >= 0.5
 *   contiguous      at most one non-member between consecutive members
 *   same structure  mean pairwise Jaccard of descendant fingerprints >= 0.5
 *   same size       widths or heights vary by less than 35% (CV)
 *   not prose       not a run of paragraphs or of headed long sections
 *                   (document flow); inside an <article>, most members
 *                   must be records (a link, media or a control of their
 *                   own, ad slots aside)
 *
 * Shared by the skeleton (collections with an exemplar) and the extraction's
 * layout features (records >= 5 for triage).
 */

export interface MemberSig {
  /** localName|explicit role */
  key: string;
  cls: readonly string[];
}

export function memberSig(el: Element): MemberSig {
  return {
    key: `${el.localName}|${explicitRole(el) ?? ''}`,
    cls: classTokens(el),
  };
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const A = new Set(a);
  let inter = 0;
  for (const x of b) if (A.has(x)) inter++;
  return inter / (a.length + b.length - inter);
}

export function setJaccard(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function sameTemplate(a: MemberSig, b: MemberSig): boolean {
  return a.key === b.key && jaccard(a.cls, b.cls) >= 0.5;
}

/** Coefficient of variation (1 when the mean is 0). */
export function cv(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const mu = values.reduce((s, v) => s + v, 0) / values.length;
  if (!mu) return 1;
  const varc = values.reduce((s, v) => s + (v - mu) ** 2, 0) / values.length;
  return Math.sqrt(varc) / mu;
}

/** Tags that are document flow or table structure, never items of a collection. */
export const NO_COLLECTION_TAGS: ReadonlySet<string> = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'hr',
  'br',
  'td',
  'th',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'colgroup',
  'col',
  'dt',
  'dd',
  'figcaption',
  'legend',
  'summary',
  'main',
  'header',
  'footer',
  'body',
  'html',
  'slot',
]);

/**
 * Candidate runs among `children`: indexes of same-template siblings with at
 * most one other sibling between consecutive members, at least `minRun` long.
 * Same-tag groups that share a class every member carries are one template
 * (Gmail's read and unread rows: "zA yO" and "zA zE"). Sorted by first index.
 */
export function groupRuns(
  children: readonly Element[],
  minRun = 3,
): number[][] {
  interface Group {
    sig: MemberSig;
    idx: number[];
    common: Set<string>;
  }
  const groups: Group[] = [];
  const limit = Math.min(children.length, 3000);
  for (let i = 0; i < limit; i++) {
    const c = children[i] as Element;
    if (NO_COLLECTION_TAGS.has(c.localName) || SKEL_SKIP.has(c.localName))
      continue;
    const s = memberSig(c);
    let g = groups.find((G) => sameTemplate(G.sig, s));
    if (!g) {
      if (groups.length >= 64) continue;
      g = { sig: s, idx: [], common: new Set(s.cls) };
      groups.push(g);
    } else {
      for (const t of g.common) if (!s.cls.includes(t)) g.common.delete(t);
    }
    g.idx.push(i);
  }
  for (let a = 0; a < groups.length; a++) {
    const ga = groups[a] as Group;
    for (let b = a + 1; b < groups.length; b++) {
      const gb = groups[b] as Group;
      if (gb.sig.key !== ga.sig.key) continue;
      if (![...gb.common].some((t) => ga.common.has(t))) continue;
      ga.idx = [...ga.idx, ...gb.idx].sort((x, y) => x - y);
      for (const t of ga.common) if (!gb.common.has(t)) ga.common.delete(t);
      groups.splice(b, 1);
      b--;
    }
  }
  const runs: number[][] = [];
  for (const g of groups) {
    if (g.idx.length < minRun) continue;
    let run: number[] = [g.idx[0] as number];
    const flush = (): void => {
      if (run.length >= minRun) runs.push(run);
    };
    for (let k = 1; k < g.idx.length; k++) {
      const i = g.idx[k] as number;
      if (i - (run[run.length - 1] as number) <= 2) run.push(i);
      else {
        flush();
        run = [i];
      }
    }
    flush();
  }
  return runs.sort((a, b) => (a[0] as number) - (b[0] as number));
}

/**
 * The template of a run's members: their tag and role, and the class
 * tokens every member carries. Members are re-found live by it.
 */
export function runTemplate(members: readonly Element[]): MemberSig {
  const first = memberSig(members[0] as Element);
  const common = new Set(first.cls);
  for (const m of members.slice(1)) {
    const cls = classTokens(m);
    for (const t of common) if (!cls.includes(t)) common.delete(t);
  }
  return { key: first.key, cls: [...common].sort() };
}

/** `el` is an item of the template: same tag and role, carries its common classes. */
export function matchesTemplate(el: Element, t: MemberSig): boolean {
  if (`${el.localName}|${explicitRole(el) ?? ''}` !== t.key) return false;
  for (const c of t.cls) if (!el.classList.contains(c)) return false;
  return true;
}

/** Descendant structure (depth:tag#role), the first `maxNodes` nodes to depth 4. */
export function structureFingerprint(
  el: Element,
  kids: (e: Element) => Element[],
  maxNodes = 80,
  maxDepth = 4,
): Set<string> {
  const set = new Set<string>();
  let count = 0;
  const walk = (x: Element, d: number): void => {
    for (const c of kids(x)) {
      if (count >= maxNodes) return;
      if (SKEL_SKIP.has(c.localName)) continue;
      count++;
      set.add(`${d}:${c.localName}#${explicitRole(c) ?? ''}`);
      if (d < maxDepth) walk(c, d + 1);
    }
  };
  walk(el, 0);
  return set;
}

const CONTENT_SELECTOR =
  'img, svg, video, canvas, picture, iframe, input, select, textarea, button, a[href], [role="button"], [role="link"], [role="checkbox"]';

/** The member shows something: text, media or a control (light or shadow tree). */
function hasContent(m: Element, openClosed?: OpenClosed): boolean {
  if (m.matches(CONTENT_SELECTOR) || m.querySelector(CONTENT_SELECTOR))
    return true;
  const doc = m.ownerDocument;
  const scan = (root: Node): boolean => {
    const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let steps = 0;
    for (let n = w.nextNode(); n && steps < 400; n = w.nextNode(), steps++)
      if (/\S/.test(n.nodeValue ?? '')) return true;
    return false;
  };
  if (scan(m)) return true;
  const sr = shadowOf(m, openClosed);
  return sr ? !!sr.querySelector(CONTENT_SELECTOR) || scan(sr) : false;
}

export interface RunEnv {
  vw: number;
  vh: number;
  kids: (e: Element) => Element[];
  openClosed?: OpenClosed;
}

export interface QualifiedRun {
  /** Visible members, in document order. */
  members: Element[];
  /** Their viewport rects at read time. */
  rects: DOMRect[];
}

const STRUCTURAL = 'main, [role="main"], body, html';
const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const RECORD_PART =
  'img, picture, video, canvas, svg, iframe, input, select, textarea, button, [role="button"], [role="checkbox"]';
const ARTICLE = 'article, [role="article"]';

/** Media or a control of the member's own (ad slots inside it do not count). */
function hasRecordPart(m: Element): boolean {
  if (m.matches(RECORD_PART)) return true;
  let seen = 0;
  for (const el of m.querySelectorAll(RECORD_PART)) {
    if (++seen > 40) return true;
    if (!insideAd(el, m)) return true;
  }
  return false;
}

/** Normalised text length, read from at most `cap` raw characters. */
function textLength(el: Element, cap = 20_000): number {
  const raw = el.textContent ?? '';
  return normalizeSpace(raw.length > cap ? raw.slice(0, cap) : raw).length;
}

/**
 * A paragraph-like block: at least 60 characters of text, no media or
 * controls, little of the text in links, and not led by a link (a title
 * link followed by a snippet is a record). Articles' text blocks, bullet
 * points and quotes are prose; records carry a link, an image or a control.
 */
export function isProseBlock(m: Element): boolean {
  const raw = m.textContent ?? '';
  const text = normalizeSpace(raw.length > 20_000 ? raw.slice(0, 20_000) : raw);
  if (text.length < 60) return false;
  if (hasRecordPart(m)) return false;
  const links = m.querySelectorAll('a[href]');
  if (links.length === 0) return true;
  const lead = normalizeSpace((links[0] as Element).textContent ?? '');
  if (lead.length >= 10 && text.startsWith(lead)) return false;
  let linked = 0;
  for (const a of links) {
    linked += textLength(a, 2000);
    if (linked >= 0.3 * text.length) return false;
  }
  return true;
}

/** A member that is clearly a record: its own link with text, or media, or a control. */
function recordEvidence(m: Element): boolean {
  if (hasRecordPart(m)) return true;
  const a = m.matches('a[href]') ? m : m.querySelector('a[href]');
  return !!a && textLength(a, 2000) > 0 && !isProseBlock(m);
}

const LINKED_HEADING = [
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]'].map(
    (h) => `${h} a[href]:not([href^="#"])`,
  ),
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(
    (h) => `a[href]:not([href^="#"]) ${h}`,
  ),
].join(', ');
const PAGE_HEADING = 'h1, [role="heading"][aria-level="1"]';

/** Paragraph text over 500 characters. */
function headedProse(m: Element): boolean {
  let chars = 0;
  for (const p of m.querySelectorAll('p')) {
    chars += textLength(p, 4000);
    if (chars > 500) return true;
  }
  return false;
}

/** The visible members of a candidate run if it is a collection, else null. */
export function qualifyRun(
  candidates: readonly Element[],
  env: RunEnv,
): QualifiedRun | null {
  const members: Element[] = [];
  const rects: DOMRect[] = [];
  // Items of one template are alike: the first dozen show whether they have
  // content; past them, a visible box is enough (long lists stay cheap).
  let checked = 0;
  let empty = 0;
  for (const m of candidates) {
    const r = m.getBoundingClientRect();
    if (r.width * r.height <= 16) continue;
    if (!isVisible(m)) continue;
    if (checked < 12) {
      checked++;
      if (!hasContent(m, env.openClosed)) {
        empty++;
        continue;
      }
    } else if (empty > checked / 2 && !hasContent(m, env.openClosed)) continue;
    members.push(m);
    rects.push(r);
  }
  if (members.length < 3) return null;
  const probe = members.slice(0, 6);
  if (
    probe.some(
      (m) => m.matches(STRUCTURAL) || m.querySelector('main, [role="main"]'),
    )
  )
    return null;
  // Prose: a run of paragraphs is the text itself, not a list of items.
  const prose = probe.filter(isProseBlock).length;
  if (prose * 2 >= probe.length) return null;
  // Inside an article (its own blocks included) only records are items;
  // its text, image and byline blocks are the article.
  const container = members[0]?.parentElement;
  if (container?.closest(ARTICLE)) {
    const records = probe.filter(recordEvidence).length;
    if (records * 2 <= probe.length) return null;
  }
  // Structure: members share their descendant shape.
  const fps = probe.map((m) => structureFingerprint(m, env.kids));
  let sum = 0;
  let pairs = 0;
  for (let a = 0; a < fps.length; a++)
    for (let b = a + 1; b < fps.length; b++) {
      sum += setJaccard(fps[a] as Set<string>, fps[b] as Set<string>);
      pairs++;
    }
  if ((pairs ? sum / pairs : 1) < 0.5) return null;
  // Size: one axis is regular (a grid row, a list column).
  const sample = rects.slice(0, 12);
  if (
    Math.min(cv(sample.map((r) => r.width)), cv(sample.map((r) => r.height))) >=
    0.35
  )
    return null;
  // The page's own heading inside one member: these are the page's parts
  // (a product's title block, its price block, its details).
  const h1 = probe.filter((m) => m.querySelector(PAGE_HEADING)).length;
  if (h1 > 0 && h1 < probe.length) return null;
  // Document flow: page-sized bands, and headed sections whose heading is
  // not a link (a record's title links to it) that are full-width or long.
  const head = members.slice(0, 4);
  const flow = head.filter((m, i) => {
    if (!m.querySelector(HEADING)) return false;
    const r = rects[i] as DOMRect;
    if (r.width * r.height >= 0.45 * env.vw * env.vh) return true;
    if (m.querySelector(LINKED_HEADING)) return false;
    return r.width >= 0.6 * env.vw || textLength(m) > 500 || headedProse(m);
  }).length;
  if (flow >= Math.min(3, members.length - 1)) return null;
  return { members, rects };
}

/** Area covered by a run's members (to pick between interleaved runs). */
export function runArea(run: QualifiedRun): number {
  return run.rects.reduce((s, r) => s + r.width * r.height, 0);
}
