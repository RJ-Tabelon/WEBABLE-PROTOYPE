// Owner: P (round 7). The page side of the meaning-first planner: what the page is for, read from Jev's page model v2
// (core's readMeaning) with the main region's members worked out from the live page, and which page elements a
// purpose component already draws (so they are not drawn twice). Used by Calm view and by the engine's meaning check.
import {
  type ExtractedData, MAIN_REGION_MIN_P, type PageMeaning, type PageOutline, type PageUnderstanding, readMeaning,
} from '@webable/core';
import { COMPONENT_WORDS, dataStrings } from './purpose-props';
import { type CoverTree, contentShare, coverTree, tokens } from './cover';
import { textOf } from './model';

export interface MeaningPageInputs {
  outline: PageOutline;
  understanding: Pick<PageUnderstanding, 'purpose' | 'mainRegion' | 'elements'> | null;
  elementFor: (id: string) => Element | null;
}

function safeEl(elementFor: (id: string) => Element | null, id: string): Element | null {
  try {
    const e = elementFor(id);
    return e && e.isConnected ? e : null;
  } catch {
    return null;
  }
}

/** Outline ids whose element sits inside the region's element (the region is a digest region, not always a node). */
export function regionMembers(regionId: string, outline: PageOutline, elementFor: (id: string) => Element | null): string[] {
  const root = safeEl(elementFor, regionId);
  if (!root) return [];
  const out: string[] = [];
  for (const n of outline.nodes) {
    const e = safeEl(elementFor, n.id);
    if (e && (e === root || root.contains(e))) out.push(n.id);
  }
  return out;
}

/** What this page is for and what leads, for Calm view and the meaning check (same inputs, same answer). */
export function pageMeaning(i: MeaningPageInputs): PageMeaning {
  const u = i.understanding;
  const mr = u?.mainRegion;
  let members: string[] | null = null;
  if (mr && mr.id !== 'none' && mr.p >= MAIN_REGION_MIN_P && !i.outline.nodes.some((n) => n.id === mr.id)) {
    members = regionMembers(mr.id, i.outline, i.elementFor);
  }
  return readMeaning({ outline: i.outline, understanding: u, mainMembers: members });
}

/* ------------------------------------------------------------------ */
/* What a component already draws                                     */
/* ------------------------------------------------------------------ */

const CONTROL_SEL = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],summary';

function visibleKids(el: Element): Element[] {
  const out: Element[] = [];
  for (const k of Array.from(el.children)) {
    if (['script', 'style', 'template', 'noscript', 'link', 'meta'].includes(k.localName) || k.closest('webable-ui')) continue;
    out.push(k);
  }
  return out;
}

function domTree(): CoverTree<Element> {
  const texts = new Map<Element, string>();
  return {
    text: (n) => {
      let t = texts.get(n);
      if (t === undefined) {
        t = textOf(n);
        texts.set(n, t);
      }
      return t;
    },
    children: visibleKids,
    isControl: (n) => n.matches(CONTROL_SEL),
    isTable: (n) => n.localName === 'table' || n.getAttribute('role') === 'table' || n.getAttribute('role') === 'grid',
  };
}

/** The words of the content itself (what the page must hold for an element to be its source). */
export function dataWords(d: ExtractedData): Set<string> {
  const set = new Set<string>();
  for (const s of dataStrings(d)) for (const w of tokens(s ?? '')) set.add(w);
  return set;
}

/** The words a component draws for this content, plus its own heading words. */
export function contentWords(d: ExtractedData): Set<string> {
  const set = dataWords(d);
  for (const w of COMPONENT_WORDS[d.kind]) set.add(w);
  // A recipe's steps are numbered on the page ("Step 1").
  if (d.kind === 'recipe') for (let k = 1; k <= Math.min(60, d.steps.length + 1); k++) set.add(String(k));
  return set;
}

/**
 * The page element that holds a piece of content: the node it was read from, or the nearest ancestor that holds most
 * of its words (a recipe read from JSON-LD is attached to a small node; its ingredients sit in a box above it).
 */
export function contentRoot(start: Element, d: ExtractedData): Element {
  const words = dataWords(d);
  const tree = domTree();
  let best = start;
  let x: Element | null = start;
  for (let i = 0; x && i < 8 && x !== document.body && x !== document.documentElement; i++, x = x.parentElement) {
    const share = contentShare(tokens(tree.text(x)), words);
    best = x;
    if (share >= 0.6) break;
  }
  return best;
}

export interface Covered {
  /** Elements the component draws (left out of Calm view's sections). */
  covered: Element[];
  /** The part's own links that are not content (a "Full box score" link, a table's row buttons), shown with it. */
  links: Element[];
}

/** Which elements under `root` hold only this content, and which of the part's links go with the component. */
export function coverContent(root: Element, d: ExtractedData): Covered {
  const words = contentWords(d);
  const tree = domTree();
  const res = coverTree(root, tree, words);
  const covered = res.covered;
  const inCovered = (e: Element): boolean => covered.some((c) => c === e || c.contains(e));
  // Links that belong with the part: controls inside covered elements that are not content themselves, and the
  // part's other controls when the part is small (a scoreboard's "Box score"), never a whole page's.
  const links = [...res.orphans];
  const rootText = tree.text(root).length;
  const contentText = dataStrings(d).join(' ').length;
  if (rootText <= Math.max(400, 3 * contentText)) {
    for (const c of Array.from(root.querySelectorAll(CONTROL_SEL))) {
      if (links.includes(c) || inCovered(c) || links.some((l) => l.contains(c))) continue;
      if (c.closest('webable-ui')) continue;
      links.push(c);
    }
  }
  return { covered, links: links.filter((l, i) => !links.some((o, j) => j !== i && o.contains(l))) };
}
