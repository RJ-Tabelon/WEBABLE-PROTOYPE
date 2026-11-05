// Owner: X (round 7). The page's top-level content regions (about 4 to 12), for Jev's "which region is the information
// this page exists to show?" pick.
//
// Site chrome (the header band, site navigation, the footer) and floating overlays are left out: they are never what a
// page exists to show. The rest is cut into blocks from the outside in: the biggest block is split into its parts while
// there are fewer than 4 regions or one block still holds over a fifth of the content, never past 12 regions. Tables,
// lists, forms, prose, figures, card grids and the boxes that hold extracted data (a stats grid, a scoreboard, a
// recipe) stay whole.

import { area, descendants, hasWord, isControl, isHeading, isImage, textOf } from './text';
import type { SNode } from './types';

export const MIN_REGIONS = 4;
export const MAX_REGIONS = 12;
/** A block holding more than this share of the content is split (when it can be). */
export const SPLIT_SHARE = 0.2;

const CHROME_TAGS = new Set(['header', 'footer', 'nav']);
const CHROME_ROLES = new Set(['banner', 'contentinfo', 'navigation', 'search']);
const HEADER_WORDS = /^(header|masthead|navbar|topbar|topnav|sitenav|globalnav|menubar|nav|navigation|menu|utility|skip)$/;
const FOOTER_WORDS = /^(footer|colophon|sitefooter|copyright)$/;
// <article> is not here: many sites wrap the whole page in one. Article bodies stay whole by `isProse`.
const UNIT_TAGS = new Set(['table', 'ul', 'ol', 'dl', 'form', 'fieldset', 'figure', 'pre', 'blockquote', 'details', 'iframe', 'video', 'picture', 'img', 'svg', 'canvas']);
const UNIT_ROLES = new Set(['table', 'grid', 'list', 'form', 'dialog', 'tablist', 'radiogroup', 'feed', 'figure']);

/**
 * Chrome boxes: header/footer/nav and banner/contentinfo/navigation landmarks outside the main content and outside any
 * article, plus boxes whose class says header (near the top) or footer.
 */
export function chromeOf(nodes: SNode[], main: SNode | null, docH: number): Set<SNode> {
  const out = new Set<SNode>();
  const inMain = (n: SNode) => {
    if (!main || main.tag === 'body') return false;
    for (let p: SNode | null | undefined = n; p; p = p.parent) if (p === main) return true;
    return false;
  };
  const holdsMain = (n: SNode) => {
    if (!main) return false;
    for (let p: SNode | null | undefined = main; p; p = p.parent) if (p === n) return true;
    return false;
  };
  const inArticle = (n: SNode) => {
    for (let p = n.parent; p; p = p.parent) if (p.tag === 'article' || p.tag === 'main' || p.role === 'main') return true;
    return false;
  };
  for (const n of nodes) {
    if (n.tag === 'body' || inMain(n) || holdsMain(n)) continue;
    let under = false;
    for (let p = n.parent; p && !under; p = p.parent) under = out.has(p);
    if (under) continue;
    const landmark = (CHROME_TAGS.has(n.tag) && !inArticle(n)) || (n.role !== undefined && CHROME_ROLES.has(n.role));
    const ws = wordsOf(n);
    const headerish = n.y < Math.max(400, 0.15 * docH) && ws.some((w) => HEADER_WORDS.test(w));
    const footerish = ws.some((w) => FOOTER_WORDS.test(w)) && n.y > 0.4 * docH;
    if (landmark || headerish || footerish) out.add(n);
  }
  return out;
}

function wordsOf(n: SNode): string[] {
  return n.cls.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2);
}

function isWithin(n: SNode, outer: SNode): boolean {
  for (let p: SNode | null | undefined = n; p; p = p.parent) if (p === outer) return true;
  return false;
}

export interface RegionOptions {
  /** Boxes that are never regions and never split into (chrome, overlays). */
  excluded: (n: SNode) => boolean;
  /** Boxes that stay whole (extracted data). */
  units: Set<SNode>;
  /**
   * Stats grids and scoreboards: a block made only of these (a record grid beside the last matchup) is one dashboard
   * and stays whole, so "the record and the last matchup" is one region.
   */
  dashboard?: Set<SNode>;
}

/** Nodes under `n` outside excluded boxes (chrome inside a wrapper does not count as the wrapper's content). */
function liveNodes(n: SNode, excluded: (x: SNode) => boolean, out: SNode[] = []): SNode[] {
  if (excluded(n)) return out;
  out.push(n);
  for (const k of n.kids) liveNodes(k, excluded, out);
  return out;
}

function hasContent(n: SNode, excluded: (x: SNode) => boolean): boolean {
  const live = liveNodes(n, excluded);
  let chars = 0;
  for (const d of live) {
    chars += d.text.length;
    if (chars >= 15) return true;
  }
  return live.some((d) => (isImage(d) && d.w * d.h >= 4000) || d.tag === 'video' || d.tag === 'iframe' || isControl(d));
}

/**
 * Prose: most of the text sits in 3+ paragraphs that are this box's own children or grandchildren (an article body
 * stays one region; a page wrapper whose text is mostly one article does not count).
 */
function isProse(n: SNode): boolean {
  const ps = descendants(n).filter((d) => d.tag === 'p' && textOf(d).length >= 40 && (d.parent === n || d.parent?.parent === n));
  if (ps.length < 3) return false;
  const pt = ps.reduce((s, p) => s + textOf(p).length, 0);
  return pt >= 0.6 * textOf(n).length;
}

/** A picture with its caption: one image covering a good part of the box, little text. */
function isFigureLike(n: SNode): boolean {
  if (textOf(n).length > 400) return false;
  const pics = descendants(n).filter((d) => (d.tag === 'img' || d.tag === 'video' || d.tag === 'picture' || d.tag === 'svg') && d.w * d.h >= 0.3 * area(n));
  return pics.length >= 1 && !descendants(n).some((d) => isControl(d) && d !== n);
}

/** Four or more similar children (a card grid or a list of rows). */
function isCardGrid(n: SNode): boolean {
  const kids = n.kids.filter((k) => k.w * k.h > 0);
  if (kids.length < 4) return false;
  const sig = (k: SNode) => `${k.tag}|${k.cls.split(' ').slice(0, 2).join(' ')}`;
  const counts = new Map<string, number>();
  for (const k of kids) counts.set(sig(k), (counts.get(sig(k)) ?? 0) + 1);
  return Math.max(...counts.values()) >= Math.max(4, 0.7 * kids.length);
}

/** Find the regions under `root` (usually the body). */
export function findRegions(root: SNode, opt: RegionOptions): SNode[] {
  const rootArea = Math.max(1, area(root));
  const minArea = Math.max(9000, 0.004 * rootArea);
  const substantial = (n: SNode) =>
    !opt.excluded(n) && n.w >= 120 && n.h >= 40 && area(n) >= minArea && hasContent(n, opt.excluded);
  const contentKids = (n: SNode): SNode[] => {
    const out: SNode[] = [];
    for (const k of n.kids) {
      if (opt.excluded(k)) continue;
      if (substantial(k)) out.push(k);
      else if (k.w * k.h === 0 && k.kids.length) out.push(...contentKids(k)); // zero-size wrappers (display: contents-like)
    }
    return out;
  };
  /** Children to split into: wrappers with one content child are looked through. */
  const partsOf = (n: SNode): SNode[] => {
    let kids = contentKids(n);
    let guard = 0;
    while (kids.length === 1 && guard++ < 30) {
      const only = kids[0] as SNode;
      if (isUnit(only)) return kids;
      kids = contentKids(only);
      if (!kids.length) return [only];
    }
    return kids;
  };
  const dash = opt.dashboard ?? new Set<SNode>();
  const dashMemo = new Map<SNode, boolean>();
  /** Made only of stats grids and scoreboards (2 or more), looking through wrappers. */
  const madeOfDash = (n: SNode): boolean => {
    if (dash.has(n)) return true;
    const have = dashMemo.get(n);
    if (have !== undefined) return have;
    const parts = contentKids(n);
    const v = parts.length >= 1 && parts.every(madeOfDash);
    dashMemo.set(n, v);
    return v;
  };
  const isDashboard = (n: SNode): boolean =>
    dash.size >= 2 && !dash.has(n) && madeOfDash(n) && [...dash].filter((d) => isWithin(d, n)).length >= 2;
  const isUnit = (n: SNode): boolean =>
    opt.units.has(n) || UNIT_TAGS.has(n.tag) || (n.role !== undefined && UNIT_ROLES.has(n.role)) || isProse(n) || isCardGrid(n)
    || isFigureLike(n) || isDashboard(n);

  let regions = partsOf(root);
  if (!regions.length) return [];
  const stuck = new Set<SNode>();
  const total = () => regions.reduce((s, r) => s + area(r), 0) || 1;
  for (let guard = 0; guard < 40; guard++) {
    const cand = regions
      .filter((r) => !stuck.has(r) && !isUnit(r))
      .sort((a, b) => area(b) - area(a))[0];
    if (!cand) break;
    if (regions.length >= MIN_REGIONS && area(cand) < SPLIT_SHARE * total()) break;
    const parts = partsOf(cand);
    if (parts.length < 2 || regions.length - 1 + parts.length > MAX_REGIONS) {
      stuck.add(cand);
      continue;
    }
    const at = regions.indexOf(cand);
    regions = [...regions.slice(0, at), ...parts, ...regions.slice(at + 1)];
  }
  return regions.sort((a, b) => (a.i ?? 0) - (b.i ?? 0)).slice(0, MAX_REGIONS);
}

/**
 * A structure-only description of what a region holds, for Jev ('number cards x6, scoreboard with 2 logos, links x2').
 * Counts and kinds only: no page text.
 */
export function describeRegion(n: SNode, inside: Array<{ node: SNode; kind: string; size?: string }>): string {
  const parts: string[] = [];
  // Same-kind items read as one phrase: two grids of 6 number cards are "number cards x12 in 2 groups".
  const byKind = new Map<string, Array<{ kind: string; size?: string }>>();
  for (const it of inside) byKind.set(it.kind, [...(byKind.get(it.kind) ?? []), it]);
  for (const [kind, list] of byKind) {
    const first = list[0] as { kind: string; size?: string };
    if (list.length === 1) {
      parts.push(first.size ? `${kind} ${first.size}` : kind);
      continue;
    }
    const counts = list.map((x) => /^x(\d+)$/.exec(x.size ?? '')?.[1]).map(Number);
    parts.push(counts.every((c) => Number.isFinite(c) && c > 0)
      ? `${kind} x${counts.reduce((a, b) => a + b, 0)} in ${list.length} groups`
      : `${kind} x${list.length}`);
  }
  const ds = descendants(n);
  const covered = (d: SNode) => inside.some((it) => isWithin(d, it.node));
  const free = ds.filter((d) => !covered(d));
  const count = (pred: (d: SNode) => boolean) => free.filter(pred).length;
  const paras = count((d) => d.tag === 'p' && textOf(d).length >= 60);
  const heads = count((d) => isHeading(d));
  const imgs = count((d) => (d.tag === 'img' || d.tag === 'svg' || d.tag === 'picture') && d.w * d.h >= 10000);
  const videos = count((d) => d.tag === 'video' || d.tag === 'iframe');
  const fields = count((d) => d.tag === 'input' || d.tag === 'select' || d.tag === 'textarea');
  const buttons = count((d) => d.tag === 'button' || d.role === 'button');
  const links = count((d) => d.tag === 'a' && d.attrs?.href !== undefined);
  const tables = count((d) => d.tag === 'table');
  const lists = count((d) => (d.tag === 'ul' || d.tag === 'ol') && d.kids.length >= 2);
  const grid = free.find((d) => isCardGrid(d) && d.kids.some((k) => descendants(k).some((x) => x.tag === 'img' || x.tag === 'picture')));
  if (grid) parts.push(`cards with pictures x${grid.kids.length}`);
  if (heads) parts.push(`headings x${heads}`);
  if (paras) parts.push(`paragraphs x${paras}`);
  if (imgs && !grid) parts.push(`pictures x${imgs}`);
  if (videos) parts.push(`video or embed x${videos}`);
  if (tables) parts.push(`tables x${tables}`);
  if (lists && !grid) parts.push(`lists x${lists}`);
  if (fields) parts.push(`form fields x${fields}`);
  if (buttons) parts.push(`buttons x${buttons}`);
  if (links) parts.push(`links x${links}`);
  if (hasWord(n, /^(ad|ads|advert|advertisement|sponsored|sponsor)$/)) parts.push('marked as an ad');
  return parts.slice(0, 8).join(', ');
}
