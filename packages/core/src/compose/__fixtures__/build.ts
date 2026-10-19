import {
  SKEL_TAGS,
  type SkelFlag,
  type SkelHrefKind,
  type SkelInputType,
  type SkelKind,
  type SkelPattern,
  type SkelRole,
  type SkelTag,
} from '../../skeleton/constants';
import type { Skeleton, SkeletonNode } from '../../skeleton/types';
import { SKELETON_VERSION } from '../../versions';

/**
 * Builder for Skeleton test fixtures (tests and evaluation only).
 *
 * Fixtures are written as nested trees, like the v2 probe's `tree.json`, and
 * flattened here into the core `Skeleton` shape: ids in document order (a
 * collection's exemplar subtree follows the collection node), parents, depths,
 * implicit roles, text shapes and slot marks. Ids therefore match the probe's
 * outlines for the pages converted from it, so ground truth written against
 * those outlines applies unchanged.
 */

export type Box = [number, number, number, number];

export interface FxNode {
  /** Tag; custom elements are written as 'custom'. */
  t: SkelTag;
  k: SkelKind;
  b: Box;
  /** Role; omitted = the tag's implicit role, null = none. */
  r?: SkelRole | null;
  /** Heading level (h1-h6 imply it). */
  lv?: number;
  fs?: number;
  w?: number;
  f?: SkelFlag[];
  it?: SkelInputType;
  /** <select> option count. */
  o?: number;
  /** Local label: accessible name, visible short text or alt text. */
  l?: string;
  /** Text shape; derived from the label for short texts, headings and controls when omitted. */
  tx?: { chars: number; pat?: SkelPattern[]; links?: number };
  /** Link destination relative to the tab's site (links default to 'same'). */
  hr?: SkelHrefKind;
  /** v1 region component key. */
  ck?: string;
  c?: FxNode[];
  /** Collection: item count, item tag and the exemplar item subtree. */
  n?: number;
  itm?: SkelTag;
  ex?: FxNode;
}

export interface FxPage {
  name: string;
  viewport: [number, number];
  doc: [number, number];
  lang?: string;
  typed?: string[];
  truncated?: boolean;
  root: FxNode;
}

const IMPLICIT_ROLE: Partial<Record<SkelTag, SkelRole>> = {
  a: 'link',
  article: 'article',
  aside: 'complementary',
  button: 'button',
  dialog: 'dialog',
  figure: 'figure',
  footer: 'contentinfo',
  form: 'form',
  header: 'banner',
  img: 'img',
  li: 'listitem',
  main: 'main',
  nav: 'navigation',
  ol: 'list',
  select: 'combobox',
  table: 'table',
  textarea: 'textbox',
  ul: 'list',
};

const INPUT_ROLE: Partial<Record<SkelInputType, SkelRole>> = {
  search: 'searchbox',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  select: 'combobox',
};

/*
 * Shapes of a short text, mirroring the shipping extractor
 * (apps/extension/lib/engine/skeleton/text.ts) so fixtures carry the pattern
 * tags a real extraction would: prices, durations, counts, ratings, dates,
 * percentages and bare numbers. One addition: compact relative times
 * ("2d ago", "3h ago"), which YouTube shows and the extractor should tag too.
 */
const CURRENCY =
  /[$€£¥₹₩₽₺₪₫฿]\s?\d|\d\s?[$€£¥₹₩₽₺₪₫฿]|\d\s?(?:USD|CAD|AUD|EUR|GBP|JPY|INR|CHF|SEK|NOK|DKK|kr|zł)\b|\b(?:USD|CAD|AUD|EUR|GBP|JPY|INR|CHF|SEK|NOK|DKK)\s?\d/;
const DURATION = /^(?:\d{1,2}:)?\d{1,2}:\d{2}$/;
const COUNT_WORDS =
  /\d[\d.,]*\s?[KMBkmb]?\+?\s*(?:views?|likes?|ratings?|reviews?|comments?|replies|subscribers?|followers?|bought|sold|watching|answers?|votes?|downloads?|items?|results?|messages?|members?|points?|shares?|retweets?|reposts?)\b/i;
const PAREN_COUNT = /^\(?\d[\d,.]*\s?[KMBkmb]?\+?\)?$/;
const RATING =
  /\bout of (?:5|10)\b|★|☆|\b\d(?:[.,]\d)?\s?(?:\/\s?(?:5|10)|stars?)\b|\brated\b/i;
const MONTHS =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;
const RELATIVE =
  /\b(?:a|an|one|\d+)\s+(?:sec|second|min|minute|hour|hr|day|week|wk|month|mo|year|yr)s?\s+ago\b|\b\d+\s?(?:s|m|h|d|w|mo|y|yr)\s+ago\b|\bjust now\b|^(?:today|yesterday|tomorrow)(?:$|,|\s+(?:at\s+)?\d)|^\d{1,2}:\d{2}\s?(?:am|pm)$|^\d{1,2}\s?(?:am|pm)$/i;
const DATE_WORD = /\b(?:ago|yesterday|today|tomorrow|now)\b/i;
const NUMERIC_DATE = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b|\b\d{1,2}\/\d{1,2}\b/;
const WEEKDAY =
  /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?\.?$/i;
const PERCENT = /\d(?:[.,]\d+)?\s?%/;
const NUMBER_ONLY = /^[+-]?[\d.,\s]+[KMBkmb]?$/;
const PATTERN_ORDER: readonly SkelPattern[] = [
  'price',
  'duration',
  'count',
  'rating',
  'date',
  'percent',
  'num',
];

export function textPatterns(raw: string): SkelPattern[] {
  const s = raw.replace(/[\s\u00a0\u200b]+/g, ' ').trim();
  if (!s || s.length > 80) return [];
  if (!/[\d★☆]/.test(s) && !DATE_WORD.test(s) && !WEEKDAY.test(s)) return [];
  const out = new Set<SkelPattern>();
  if (CURRENCY.test(s)) out.add('price');
  if (DURATION.test(s)) out.add('duration');
  if (COUNT_WORDS.test(s) || (PAREN_COUNT.test(s) && /^\(/.test(s)))
    out.add('count');
  if (RATING.test(s)) out.add('rating');
  const numericDate =
    NUMERIC_DATE.test(s) && !out.has('rating') && !out.has('price');
  if (
    !out.has('duration') &&
    (MONTHS.test(s) || RELATIVE.test(s) || WEEKDAY.test(s) || numericDate)
  )
    out.add('date');
  if (PERCENT.test(s)) out.add('percent');
  if (out.size === 0 && NUMBER_ONLY.test(s) && /\d/.test(s)) out.add('num');
  return PATTERN_ORDER.filter((p) => out.has(p));
}

const TAGS: ReadonlySet<string> = new Set(SKEL_TAGS);

function implicitRole(n: FxNode): SkelRole | null {
  if (n.k === 'heading') return 'heading';
  if (n.k === 'input') {
    if (n.t === 'select') return 'combobox';
    if (n.t === 'textarea') return 'textbox';
    return (n.it && INPUT_ROLE[n.it]) ?? 'textbox';
  }
  return IMPLICIT_ROLE[n.t] ?? null;
}

/** Flatten a fixture tree into a Skeleton. */
export function buildSkeleton(page: FxPage): Skeleton {
  const nodes: SkeletonNode[] = [];
  let next = 0;

  const visit = (
    fx: FxNode,
    parent: string | null,
    depth: number,
    inExemplar: boolean,
  ): string => {
    if (!TAGS.has(fx.t)) throw new Error(`fixture ${page.name}: tag ${fx.t}`);
    const id = `e${++next}`;
    const role = fx.r === undefined ? implicitRole(fx) : fx.r;
    const node: SkeletonNode = {
      id,
      parent,
      depth,
      tag: fx.t,
      role,
      kind: fx.k,
      box: [...fx.b],
      flags: [...(fx.f ?? [])],
    };
    if (fx.fs !== undefined) node.fontPx = fx.fs;
    const bold = fx.f?.includes('bold');
    if (fx.w !== undefined) node.weight = fx.w;
    else if (fx.k === 'heading' || bold) node.weight = 700;
    else if (fx.fs !== undefined) node.weight = 400;
    if (fx.k === 'heading') {
      const m = /^h([1-6])$/.exec(fx.t);
      node.level = fx.lv ?? (m ? Number(m[1]) : 2);
    }
    if (fx.it) node.inputType = fx.it;
    else if (fx.k === 'input') {
      node.inputType =
        fx.t === 'select'
          ? 'select'
          : fx.t === 'textarea'
            ? 'textarea'
            : 'text';
    }
    if (fx.o !== undefined) node.options = fx.o;
    if (fx.l !== undefined) node.label = fx.l.slice(0, 80);
    const icon = fx.f?.includes('icon');
    if (fx.tx) node.text = { ...fx.tx };
    else if (
      fx.l &&
      !icon &&
      (fx.k === 'stext' || fx.k === 'heading' || fx.k === 'control')
    ) {
      const pat = textPatterns(fx.l);
      node.text = { chars: fx.l.length, ...(pat.length ? { pat } : {}) };
    }
    if (fx.hr) node.href = fx.hr;
    else if (fx.k === 'control' && role === 'link') node.href = 'same';
    if (fx.ck) node.ck = fx.ck;
    if (inExemplar) node.slot = true;
    nodes.push(node);

    if (fx.k === 'collection') {
      if (!fx.ex || fx.n === undefined) {
        throw new Error(
          `fixture ${page.name}: collection ${id} needs n and ex`,
        );
      }
      const exemplar = visit(fx.ex, id, depth + 1, true);
      node.collection = {
        count: fx.n,
        itemTag: fx.itm ?? fx.ex.t,
        exemplar,
      };
    }
    for (const child of fx.c ?? []) visit(child, id, depth + 1, inExemplar);
    return id;
  };

  visit(page.root, null, 0, false);
  return {
    v: 1,
    version: SKELETON_VERSION,
    extractionId: `fx-${page.name}`,
    viewport: { width: page.viewport[0], height: page.viewport[1], zoom: 1 },
    doc: { width: page.doc[0], height: page.doc[1] },
    lang: page.lang ?? 'en',
    nodes,
    truncated: page.truncated ?? false,
    structure: `fx-${page.name}`,
    typed: [...(page.typed ?? [])],
    perf: { ms: 0, nodes: nodes.length },
  };
}
