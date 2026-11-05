// Owner: X (round 7). Types for reading structured content on the device.
//
// The reader builds one light tree (SNode) of the visible page during its walk, with no extra layout work. Every
// extractor here works on that tree, so the heuristics are pure and testable in Node with hand-built trees. The live
// Element rides along as `el` in the browser only. Nothing in this folder reads form input values, and nothing it
// produces is sent to any model: `OutlineNode.data` stays on the device (the background strips it).

import type { ExtractedData } from '@webable/core';

/** One visible element, as the reader's walk saw it. */
export interface SNode {
  /** Lowercase tag name ('div', 'img', 'svg', 'table'). */
  tag: string;
  /** id and class attribute, lowercase, space separated (for class-word tests such as /logo|byline/). */
  cls: string;
  /** ARIA role, lowercase, when set. */
  role?: string;
  attrs?: SAttrs;
  /** Direct text of this element (its own text nodes, collapsed). Always '' for form controls. */
  text: string;
  /**
   * Direct text split by position, when the element mixes text and child elements: [k, text] means the text comes
   * after the k-th visible child element. Absent when all direct text comes before the children.
   */
  segs?: Array<[number, string]>;
  /** Page box, CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Font size (px) and weight of this element. */
  fs: number;
  fw: number;
  /** Fixed or sticky to the viewport (overlays, sticky bars). */
  fixed?: boolean;
  kids: SNode[];
  /** Index among the parent element's element children (to place `segs`). */
  ci?: number;
  /** Set by `link()` (never serialised). */
  parent?: SNode | null;
  /** Pre-order index, set by `link()`; document order. */
  i?: number;
  /** The live element (browser only). */
  el?: Element;
}

export interface SAttrs {
  alt?: string;
  /** Resolved image URL (currentSrc or src) for images; absent for anything else. */
  src?: string;
  href?: string;
  /** aria-label. */
  label?: string;
  title?: string;
  itemprop?: string;
  datetime?: string;
  colspan?: number;
  /** Image natural size, when known. */
  nw?: number;
  nh?: number;
}

/** Article metadata (NewsArticle JSON-LD first, then the page), for Calm view's article template. */
export interface ArticleMeta {
  headline: string;
  description?: string;
  image?: { src: string; alt?: string };
  authors: string[];
  published?: string;
  modified?: string;
  section?: string;
  source: 'json-ld' | 'page';
  /** Outline ids of the matching page elements, when found (filled by the reader). */
  headlineId?: string;
  bylineId?: string;
  leadImageId?: string;
  dateId?: string;
  bodyId?: string;
}

/** One structured item and the element it was read from. */
export interface ExtractItem {
  /** The element whose outline node carries the data (a data root). */
  node: SNode;
  data: ExtractedData;
  /** For stats: the value elements, in item order, so the reader can set `nodeId`. */
  valueNodes?: Array<SNode | null>;
  /** For scoreboards: each side's logo element, in side order (they also get logo data of their own). */
  logoNodes?: Array<SNode | null>;
  /** For schedules: each item's row element, in item order. */
  rowNodes?: Array<SNode | null>;
  /** For logos: the picture itself (an svg mark gets its src from the page). */
  mark?: SNode;
}

export interface ArticleNodes {
  meta: ArticleMeta;
  headline: SNode | null;
  byline: SNode | null;
  leadImage: SNode | null;
  date: SNode | null;
  body: SNode | null;
}

/** What one page yields. */
export interface PageExtract {
  items: ExtractItem[];
  /** Top-level content regions for Jev's main-region pick, in document order (4 to 12 when the page allows). */
  regions: SNode[];
  /** A structure-only description of what each region holds ('number cards x6, scoreboard with 2 logos'). */
  regionNotes: Map<SNode, string>;
  article: ArticleNodes | null;
  /** The site's own mark, when found (also one of `items`, as a logo). */
  siteLogo: SNode | null;
}

/** Inputs the extractors need besides the tree. */
export interface ExtractInput {
  root: SNode;
  /** The page's main content element, when the reader found one. */
  main: SNode | null;
  /** Raw text of every application/ld+json script (parsed here; never sent anywhere). */
  ld: string[];
  /** og:site_name, application-name or similar, when the page states one. */
  siteName?: string | null;
  /** The page's own URL (to tell links to the home page). */
  url: string;
  vw: number;
  vh: number;
}
