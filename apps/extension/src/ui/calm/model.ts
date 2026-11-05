// Owner: C, D (round 4: story pairing, picture recovery, captions). Reads the live page into a small block model for
// the Calm view. Read-only: nothing here writes to the page. Every word comes from the page's visible text at render
// time, on the device. Controls keep a reference to their original element so the view can proxy them.
//
// Pictures (design.md §3–§4): a news card often splits one story into a picture-only link and a headline link to the
// same address; a pre-pass pairs them so the headline carries its picture (F1). Alt text is never a title, and file-name
// alts count as empty (F2). Logos are only small or chrome pictures (F4). The real source is recovered in a fixed order
// (F5), and captions come from the page's caption element with the credit after it (F7).
import { cleanAlt, hrefKey, isKickerText, isLogoPicture, isPlaceholderSrc, isTimeText, parseSrcset, pickSrcset } from '@webable/core';

/** Emphasis the page shows on a run of words: bold (b) and italic (i). Parts with different flags never merge. */
export interface Emphasis { b?: true; i?: true }
export interface LinkPart extends Emphasis { t: 'link'; el: Element; text: string; href: string | null; help: boolean }
export interface TextPart extends Emphasis { t: 'text'; text: string }
export type Inline = TextPart | LinkPart | { t: 'br' };

interface Base { key: string; src: Node }
export interface HeadingBlock extends Base { b: 'heading'; level: number; text: string; el: Element }
export interface FlowBlock extends Base { b: 'flow'; parts: Inline[]; text: string; help: boolean }
export interface ControlBlock extends Base {
  b: 'control'; el: Element; role: 'button' | 'link'; text: string; href: string | null;
  primary: boolean; help: boolean; selected: boolean; popup: boolean;
  /** A link that holds the page's heading (Google's result titles): drawn as a heading-styled link. */
  head?: boolean;
}
export interface FieldBlock extends Base {
  b: 'field'; el: HTMLInputElement | HTMLTextAreaElement; label: string; hint: string; required: boolean;
  multiline: boolean; type: string; search: boolean;
}
export interface ChoiceBlock extends Base {
  b: 'choice'; el: Element; type: 'checkbox' | 'radio'; name: string; title: string; meta: string[]; extra: Block[];
}
export interface ChoicesBlock extends Base { b: 'choices'; type: 'checkbox' | 'radio'; items: ChoiceBlock[] }
export interface SelectBlock extends Base { b: 'select'; el: HTMLSelectElement; label: string; hint: string; required: boolean }
export interface ImageBlock extends Base {
  b: 'image'; url: string;
  /** The picture's description for assistive technology only (file-name alts are ''). Never shown as text. */
  alt: string;
  /** Rendered size on the page, and the picture's own size when known (0 when not loaded yet). */
  w: number; h: number; nw: number; nh: number;
  fit: 'cover' | 'contain';
  /** A logo or brand mark (never shown: the site's name is in the top bar). */
  logo: boolean;
  /** The page's own caption (figcaption, a caption element in the card, or the JSON-LD caption). */
  caption: string;
  /** The photo credit the page prints with it ("Getty Images"), shown after the caption. */
  credit: string;
  /** Inside a link (an image-only link keeps its picture). */
  linked: boolean;
  /** Inside a hero, carousel or banner (stock photography, never needed for the task). */
  banner: boolean;
  /** A story's own picture (paired with its headline), the lead or a product picture: never dropped as a banner. */
  important: boolean;
}
export interface ListBlock extends Base { b: 'list'; ordered: boolean; items: Block[][] }
export interface TableBlock extends Base { b: 'table'; rows: string[][]; head: boolean }
/** A table whose cells hold links or controls: each cell keeps its blocks. */
export interface RichTableBlock extends Base { b: 'rtable'; rows: Array<{ cells: Block[][]; head: boolean }> }
export interface GroupBlock extends Base { b: 'group'; legend: string; blocks: Block[] }
export interface CardLinkBlock extends Base {
  b: 'cardlink'; el: Element; href: string | null; title: string;
  /** The card's other lines, without the kicker, dek and time below. */
  lines: string[];
  image: ImageBlock | null;
  /** A short label above the headline ("Analysis", "Live Updates"). */
  kicker: string | null;
  /** The summary line under the headline. */
  dek: string | null;
  /** "20 min ago", "Oct 23, 2026". */
  time: string | null;
  /** Where the page shows it: top in page px, and the headline's font size (prominence for the news index). */
  top: number;
  headPx: number;
}
export interface PeekBlock extends Base {
  b: 'peek'; el: Element; label: string; why: 'sensitive' | 'media' | 'editor' | 'file' | 'frame' | 'rest';
}
export type Block =
  | HeadingBlock | FlowBlock | ControlBlock | FieldBlock | ChoiceBlock | ChoicesBlock | SelectBlock | ImageBlock
  | ListBlock | TableBlock | RichTableBlock | GroupBlock | CardLinkBlock | PeekBlock;

export interface ReadCtx {
  /** Element → placement key. An element placed in another placement is skipped here (it renders there). */
  placed: Map<Element, string>;
  current: string;
  /** Never rendered inline (for example headings used as section titles). */
  skip: Set<Element>;
  /** Jev-folded parts met inside an open section: moved to the end drawer, never deleted. */
  folded: Set<Element>;
  foldedHits: Element[];
  primary: Element | null;
  primarySeen: boolean;
  help: Set<Element>;
  budget: { left: number };
  /** Story pairing for the whole page (F1), computed once per read. */
  pairs: StoryPairs;
  /** Drawn elsewhere (an article's byline, date and dek in its header): never read, even as a placed root. */
  elsewhere: Set<Element>;
  /** Round 7: logos Jev's page model says identify something (a team's mark): shown like content pictures. */
  keepLogos?: Set<Element>;
}

export function newCtx(partial: Partial<ReadCtx> = {}): ReadCtx {
  return {
    placed: new Map(), current: '', skip: new Set(), folded: new Set(), foldedHits: [], primary: null,
    primarySeen: false, help: new Set(), budget: { left: 4000 }, pairs: partial.pairs ?? storyPairs(), elsewhere: new Set(),
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Story pairing (F1)                                                  */
/* ------------------------------------------------------------------ */

export interface StoryPairs {
  /** Headline link → the picture of its picture-only twin (same address, same card). */
  pic: Map<Element, Element>;
  /** Picture-only links drawn with their headline (or byline headshots beside the name): never read on their own. */
  skip: Set<Element>;
  /** Picture-only link with no headline twin → the card's own heading, which becomes its title. */
  head: Map<Element, Element>;
  /** Headings adopted as a picture link's title (read once, as that title). */
  adopted: Set<Element>;
}

/** A link's visible words without its picture's caption or credit (CNN prints the credit inside the picture link). */
function linkWords(a: Element): string {
  const h = a as HTMLElement;
  let t = clean(typeof h.innerText === 'string' ? h.innerText : a.textContent);
  if (!t) return '';
  for (const c of Array.from(a.querySelectorAll('figcaption,[class*="caption" i],[class*="credit" i]'))) {
    const ct = clean((c as HTMLElement).innerText ?? c.textContent);
    if (ct) t = clean(t.replace(ct, ''));
  }
  return t;
}

/** The picture a link shows: an <img>/<picture>/<svg>, else a box with a CSS background picture (F5 step 6). */
function linkPicture(a: Element): Element | null {
  const m = a.querySelector('img,picture,svg');
  if (m) return m.localName === 'picture' ? (m.querySelector('img') ?? m) : m;
  for (const x of [a, ...Array.from(a.querySelectorAll('div,span,figure')).slice(0, 12)]) {
    if (bgUrlOf(x)) return x;
  }
  return null;
}

let pairCache: { at: number; links: number; pairs: StoryPairs } | null = null;

/**
 * For each link that shows a picture and no words, walk up at most 4 boxes (stopping once a box holds a second
 * address) to find its headline twin: a link to the same address (ignoring #hash) with at least 12 characters. The
 * twin then carries the picture and the picture link is not read again. Small pictures (a byline headshot beside the
 * author's name) are dropped, not attached. A picture link with no twin takes the nearest heading in its card.
 */
export function storyPairs(): StoryPairs {
  const now = performance.now();
  const nLinks = document.links.length;
  if (pairCache && now - pairCache.at < 1000 && pairCache.links === nLinks) return pairCache.pairs;
  const pairs: StoryPairs = { pic: new Map(), skip: new Set(), head: new Map(), adopted: new Set() };
  const words = new Map<Element, string>();
  const wordsOf = (a: Element): string => {
    let t = words.get(a);
    if (t === undefined) {
      t = linkWords(a);
      words.set(a, t);
    }
    return t;
  };
  const all = Array.from(document.querySelectorAll('a[href]')).slice(0, 2000);
  for (const a of all) {
    if (a.closest('webable-ui')) continue;
    // A picture link may carry a short label over the picture ("• Travel"): it is still the story's picture.
    const w = wordsOf(a).replace(/^[•·|\s]+/, '');
    if (w && !isKickerText(w)) continue;
    const pic = linkPicture(a);
    if (!pic) continue;
    const r = pic.getBoundingClientRect();
    if (r.width < 32 || r.height < 32) continue;
    if (w && Math.max(r.width, r.height) < 100) continue;
    const key = hrefKey((a as HTMLAnchorElement).href);
    const small = Math.max(r.width, r.height) < 100;
    let mate: Element | null = null;
    let box: Element | null = null;
    for (let x = a.parentElement, i = 0; x && i < 4 && x !== document.body; x = x.parentElement, i++) {
      const hrefs = new Set<string>();
      for (const l of Array.from(x.querySelectorAll('a[href]')).slice(0, 40)) {
        const k = hrefKey((l as HTMLAnchorElement).href);
        hrefs.add(k);
        if (!mate && l !== a && k === key && wordsOf(l).length >= (small ? 2 : 12)) mate = l;
      }
      if (mate || hrefs.size > 1) break;
      box = x;
    }
    if (mate) {
      pairs.skip.add(a);
      if (!small && !pairs.pic.has(mate)) pairs.pic.set(mate, pic);
      continue;
    }
    if (box) {
      const h = box.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]');
      if (h && !h.contains(a) && !a.contains(h) && clean(h.textContent) && !h.querySelector('a[href]')) {
        pairs.head.set(a, h);
        pairs.adopted.add(h);
      }
    }
  }
  pairCache = { at: now, links: nLinks, pairs };
  return pairs;
}

/* ------------------------------------------------------------------ */
/* Stable keys (so mirrors keep focus across re-reads)                */
/* ------------------------------------------------------------------ */

const keys = new WeakMap<Node, string>();
let keyN = 0;
export function keyOf(n: Node, suffix = ''): string {
  let k = keys.get(n);
  if (!k) {
    k = `k${++keyN}`;
    keys.set(n, k);
  }
  return suffix ? `${k}${suffix}` : k;
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/[\s ​]+/g, ' ').trim();
}

/** The words of the text nodes the page shows under `el`, in their own case (no CSS text-transform). */
function shownWords(el: Element): string {
  const out: string[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n = 0;
  for (let t = walk.nextNode(); t && n < 200; t = walk.nextNode(), n++) {
    const p = t.parentElement;
    if (!p) continue;
    const r = p.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push((t as Text).data);
  }
  return clean(out.join(' '));
}

export function textOf(el: Element): string {
  const h = el as HTMLElement;
  const t = clean(typeof h.innerText === 'string' ? h.innerText : el.textContent);
  // Words the page shouts only through CSS (text-transform: uppercase) are shown in their own case.
  if (t.length > 3 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
    try {
      if (getComputedStyle(el).textTransform === 'uppercase') {
        const raw = clean(el.textContent);
        if (raw && raw.toUpperCase() === t) return raw;
        // Hidden alternates inside (a short and a long date): only the shown text nodes, in their own case.
        const shown = shownWords(el);
        if (shown && shown.toUpperCase() === t) return shown;
      }
    } catch {
      /* detached */
    }
  }
  return t;
}

export function linesOf(el: Element): string[] {
  const h = el as HTMLElement;
  const raw = typeof h.innerText === 'string' ? h.innerText : (el.textContent ?? '');
  const lines = raw.split(/\n+/).map(clean).filter(Boolean);
  // A line the page shouts only through CSS ("SLEEP" from "Sleep") is shown in its own case.
  return lines.map((l) => {
    if (l.length < 4 || l !== l.toUpperCase() || !/[A-Z]/.test(l)) return l;
    for (const d of Array.from(el.querySelectorAll('*')).slice(0, 80)) {
      const t = clean(d.textContent);
      if (t && t !== l && t.toUpperCase() === l) {
        try {
          if (getComputedStyle(d).textTransform === 'uppercase') return t;
        } catch {
          /* ignore */
        }
      }
    }
    return l;
  });
}

function labelledBy(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  const doc = el.ownerDocument;
  return clean(
    ids
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter((x): x is HTMLElement => !!x)
      .map((x) => textOf(x))
      .join(' '),
  );
}

/** How many fields name this element in aria-describedby (a hint shared by Day / Month / Year is shown once). */
function describerCount(d: Element): number {
  if (!d.id) return 0;
  try {
    return d.ownerDocument.querySelectorAll(`[aria-describedby~="${CSS.escape(d.id)}"]`).length;
  } catch {
    return 0;
  }
}

/** A field's own hint: description elements only this field points to (shared hints stay as text in the page's place). */
function describedBy(el: Element): string {
  const ids = el.getAttribute('aria-describedby');
  if (!ids) return '';
  const doc = el.ownerDocument;
  return clean(
    ids
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter((x): x is HTMLElement => !!x && describerCount(x) === 1 && !x.matches('input,select,textarea,button'))
      .map((x) => textOf(x))
      .join(' '),
  );
}

/** Hint elements drawn under their one field: not read again as text. */
function ownHints(root: Element): Set<Element> {
  const out = new Set<Element>();
  const fields: Element[] = root.matches('[aria-describedby]') ? [root] : [];
  fields.push(...Array.from(root.querySelectorAll('[aria-describedby]')));
  for (const f of fields) {
    if (!f.matches('input,select,textarea')) continue;
    for (const id of (f.getAttribute('aria-describedby') ?? '').split(/\s+/)) {
      const d = id ? f.ownerDocument.getElementById(id) : null;
      if (d && describerCount(d) === 1 && !d.contains(f) && !d.matches('input,select,textarea,button')) out.add(d);
    }
  }
  return out;
}

/** The page's required-field marker ("First name *") is dropped where the view says "(required)". */
export function stripMarker(s: string): string {
  return s.replace(/\s*[*＊]\s*$/, '').trim();
}

/** A label's visible words without the text of controls inside it (a select's options, for example). */
function labelText(label: Element): string[] {
  if (!label.querySelector('input,select,textarea,button')) return linesOf(label);
  const c = label.cloneNode(true) as Element;
  c.querySelectorAll('input,select,textarea,button,datalist,option').forEach((x) => x.remove());
  return (c.textContent ?? '').split(/\n+/).map(clean).filter(Boolean);
}

type FormEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function labelLinesOf(el: Element): string[] {
  const lb = labelledBy(el);
  if (lb) return [lb];
  const labels = (el as FormEl).labels ? Array.from((el as FormEl).labels ?? []) : [];
  const lines = labels.flatMap((l) => labelText(l));
  if (lines.length) return lines;
  for (const a of ['aria-label', 'placeholder', 'title']) {
    const v = clean(el.getAttribute(a));
    if (v) return [v];
  }
  return [];
}

export function labelOf(el: Element): string {
  return labelLinesOf(el).join(' ');
}

/** The visible name of a button or link. */
export function nameOf(el: Element): string {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'image') return clean(el.alt) || clean(el.getAttribute('aria-label'));
    if (['button', 'submit', 'reset'].includes(el.type)) {
      return clean(el.value) || clean(el.getAttribute('aria-label')) || (el.type === 'submit' ? 'Submit' : el.type === 'reset' ? 'Reset' : '');
    }
  }
  const t = textOf(el);
  const aria = clean(el.getAttribute('aria-label')) || labelledBy(el) || clean(el.getAttribute('title'));
  // A glyph ("–", "×", "›") or a bare badge count ("1") says less than the control's own accessible name.
  if (t && (!aria || /\p{L}/u.test(t))) return t.length > 160 ? `${t.slice(0, 157)}…` : t;
  if (aria) return aria;
  if (t) return t;
  const img = el.querySelector('img[alt]');
  if (img) return cleanAlt(img.getAttribute('alt'));
  const st = el.querySelector('svg title');
  return st ? clean(st.textContent) : '';
}

const ABBREV_END = /\b(?:Mr|Mrs|Ms|Dr|St|No|Nos|Rx|Inc|Ltd|Co|Corp|vs|etc|e\.g|i\.e|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|a\.m|p\.m|[A-Z])\.$/;

/** Split running text into sentences (never inside "$4.00", "e.g." or "Dr."). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /([.!?]+["\u201d\u2019)\]]*)\s+(?=["\u201c(\[]?[A-Z0-9])/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + (m[1]?.length ?? 0);
    const piece = text.slice(start, end);
    if (ABBREV_END.test(piece)) continue;
    const t = piece.trim();
    if (t) out.push(t);
    start = re.lastIndex;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out.length ? out : [text.trim()];
}

/** Indexes in `text` where a new sentence starts. */
export function sentenceBreaks(text: string): number[] {
  const out: number[] = [];
  const re = /([.!?]+["\u201d\u2019)\]]*)\s+(?=["\u201c(\[]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + (m[1]?.length ?? 0);
    if (ABBREV_END.test(text.slice(Math.max(0, end - 14), end))) continue;
    out.push(re.lastIndex);
  }
  return out;
}

/** Split inline parts into paragraphs of at most n sentences; links stay inside their sentence. */
export function splitParts(parts: Inline[], n: number): Inline[][] {
  if (!Number.isFinite(n) || n < 1) return [parts];
  const paras: Inline[][] = [[]];
  let count = 0;
  for (const p of parts) {
    if (p.t !== 'text') {
      paras[paras.length - 1]!.push(p);
      continue;
    }
    let rest = p.text;
    let offset = 0;
    for (const at of sentenceBreaks(p.text)) {
      count++;
      if (count % n !== 0) continue;
      const head = p.text.slice(offset, at);
      paras[paras.length - 1]!.push({ ...p, text: head.trimEnd() });
      paras.push([]);
      offset = at;
      rest = p.text.slice(at);
    }
    if (rest) paras[paras.length - 1]!.push({ ...p, text: offset ? rest.trimStart() : rest });
  }
  return paras.filter((ps) => ps.some((x) => x.t !== 'text' || /\S/.test(x.text)));
}

/** Page tools (Print, Save, Listen, Share): quiet icon links, and in an article they move to "More on this page". */
export const TOOL_RE = /^(print( this)?( page)?|save( to (my )?list)?|share( this)?( (article|story|page))?|share (with|on|to|via) [\w .+-]{1,24}|listen( to (this )?(article|story))?|play( pronunciation| audio)?|email( this)?( page)?|bookmark|download( pdf)?|copy( the)? link( to( the)? clipboard)?)$/i;

export const PRICE_RE = /(?:[$€£¥]\s?\d|\d[\d,.]*\s?(?:USD|EUR|GBP))/;
export const HELP_RE = /\b(help|contact( us)?|support|customer (service|care)|faqs?|call (us|your|our)|chat with( us)?)\b/i;

/* ------------------------------------------------------------------ */
/* Emphasis                                                            */
/* ------------------------------------------------------------------ */

/** While reading: the nearest block's own weight and style, and whether the words inside are bold or italic. */
export interface EmphasisState { bw: number; bi: boolean; b: boolean; i: boolean }
export const PLAIN: EmphasisState = { bw: 400, bi: false, b: false, i: false };
type FontStyle = Pick<CSSStyleDeclaration, 'fontWeight' | 'fontStyle'>;

/** A CSS font-weight as a number (NaN when no style is known, as in a test DOM). */
function weightOf(w: string): number {
  if (w === 'bold' || w === 'bolder') return 700;
  if (w === 'normal' || w === 'lighter') return 400;
  return w ? Number(w) : NaN;
}

/** A block's words start plain; its own weight and style are what an inline element's are measured against. */
export function blockEmphasis(cs: FontStyle): EmphasisState {
  const w = weightOf(cs.fontWeight);
  return { bw: Number.isFinite(w) ? w : 400, bi: /italic|oblique/.test(cs.fontStyle), b: false, i: false };
}

/**
 * The emphasis inside an inline element. Its computed style wins when known (a site that bolds with CSS font-weight,
 * or un-bolds its <b>): bold at 600 or more while its block is under 600; italic while its block is not. With no
 * computed style the tags say it. <mark> (a highlight) is always bold: the view draws no highlight.
 */
export function inlineEmphasis(tag: string, cs: FontStyle, outer: EmphasisState): EmphasisState {
  const w = weightOf(cs.fontWeight);
  const b = tag === 'mark' || (Number.isFinite(w) ? w >= 600 && outer.bw < 600 : outer.b || tag === 'b' || tag === 'strong');
  const i = cs.fontStyle ? /italic|oblique/.test(cs.fontStyle) && !outer.bi : outer.i || tag === 'em' || tag === 'i';
  return { ...outer, b, i };
}

/** The flags a part carries (none when plain, so plain parts look as they always did). */
export function flagsOf(em: EmphasisState): Emphasis {
  return em.b ? (em.i ? { b: true, i: true } : { b: true }) : em.i ? { i: true } : {};
}

const sameEmphasis = (a: Emphasis, b: Emphasis): boolean => !a.b === !b.b && !a.i === !b.i;

/* ------------------------------------------------------------------ */
/* Visibility                                                          */
/* ------------------------------------------------------------------ */

const IGNORE = new Set([
  'script', 'style', 'noscript', 'template', 'link', 'meta', 'head', 'title', 'base', 'datalist', 'option', 'optgroup',
  'param', 'track', 'source', 'map', 'area', 'webable-ui', 'legend',
]);
const INLINE = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'ruby', 'inline-table']);

function hidden(el: Element, cs: CSSStyleDeclaration): boolean {
  if (cs.display === 'none') return true;
  if (cs.display === 'contents') return false;
  if (cs.opacity === '0') return true;
  if (cs.contentVisibility === 'hidden') return true;
  if (cs.position === 'absolute' || cs.position === 'fixed') {
    const r = el.getBoundingClientRect();
    if (r.width <= 2 && r.height <= 2) return true; // screen-reader-only text
    if (r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0) return true; // parked off-screen
  }
  // Clipped to nothing (visually-hidden helpers) or a closed box (height 0, overflow hidden).
  if (/inset\(50%\)/.test(cs.clipPath) || cs.clip === 'rect(0px, 0px, 0px, 0px)') return true;
  if ((cs.overflow === 'hidden' || cs.overflow === 'clip' || cs.overflowY === 'hidden' || cs.overflowY === 'clip') && cs.position !== 'static') {
    const r = el.getBoundingClientRect();
    if (r.height <= 1 || r.width <= 1) return true;
  } else if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') {
    const r = el.getBoundingClientRect();
    if (r.height <= 1) return true;
  }
  return false;
}

/** Hidden from everyone: not rendered, aria-hidden (itself or a near wrapper), or a 0×0 box with nothing visible inside. */
export function isGone(el: Element): boolean {
  if (!isShown(el)) return true;
  const ah = el.closest('[aria-hidden="true"]');
  if (ah && (ah === el || el.contains(ah) || depthBetween(ah, el) <= 3)) return true;
  const r = el.getBoundingClientRect();
  return r.width < 1 || r.height < 1;
}

function depthBetween(anc: Element, el: Element): number {
  let d = 0;
  for (let x: Element | null = el; x && x !== anc; x = x.parentElement) d++;
  return d;
}

export function isShown(el: Element): boolean {
  if (!el.isConnected) return false;
  const cs = getComputedStyle(el);
  if (hidden(el, cs)) return false;
  if (cs.display === 'contents') return true;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0 && el.childElementCount === 0) return false;
  return typeof (el as HTMLElement).checkVisibility === 'function'
    ? (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true, checkOpacity: true } as CheckVisibilityOptions)
    : true;
}

export function safeHref(el: Element): string | null {
  const raw = (el as HTMLAnchorElement).href;
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw, location.href);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol)) return null;
    if (u.origin === location.origin && u.pathname === location.pathname && u.search === location.search && u.hash) return null;
    return u.href;
  } catch {
    return null;
  }
}

export function safeImageUrl(u: string): boolean {
  if (!u) return false;
  try {
    const url = new URL(u, location.href);
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'data:') return /^data:image\//i.test(u);
    if (url.protocol === 'http:' || url.protocol === 'blob:') return url.origin === location.origin;
    return false;
  } catch {
    return false;
  }
}

function svgDataUrl(svg: SVGSVGElement, r: DOMRect): string | null {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('script,foreignObject,use').forEach((n) => n.remove());
  for (const n of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name) || /href$/i.test(a.name)) n.removeAttribute(a.name);
  }
  // Nothing left to draw (icons drawn through <use> or page CSS): show no picture rather than an empty well.
  if (!clone.querySelector('path,rect,circle,ellipse,line,polyline,polygon,text,image')) return null;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(r.width)));
  clone.setAttribute('height', String(Math.round(r.height)));
  const cs = getComputedStyle(svg);
  clone.setAttribute('color', cs.color);
  if (!clone.getAttribute('fill') && cs.fill && cs.fill !== 'rgb(0, 0, 0)') clone.setAttribute('fill', cs.fill);
  const xml = new XMLSerializer().serializeToString(clone);
  if (xml.length > 80_000) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}

const SUPPORTED_TYPES = /^image\/(avif|webp|jpeg|jpg|png|gif|svg\+xml|apng|bmp|x-icon)$/i;

function absUrl(u: string | null | undefined): string | null {
  const v = (u ?? '').trim();
  if (!v) return null;
  try {
    return new URL(v, location.href).href;
  } catch {
    return null;
  }
}

/** The CSS background picture of a media box of at least 160 × 90 (F5 step 6). */
function bgUrlOf(el: Element): string | null {
  let bg = '';
  try {
    bg = getComputedStyle(el).backgroundImage;
  } catch {
    return null;
  }
  const m = /url\(["']?([^"')]+)["']?\)/.exec(bg ?? '');
  if (!m) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 160 || r.height < 90) return null;
  const u = absUrl(m[1]);
  return u && !isPlaceholderSrc(u) ? u : null;
}

/**
 * The picture's real address, tried in order (design.md F5): what it shows now when complete and large enough; the
 * <picture><source> whose media matches and whose type is supported, taking the srcset candidate at least the box ×
 * DPR; the image's own srcset; data-src / data-srcset / data-lazy-src / data-original / data-hi-res-src; an ancestor's
 * data-url / data-src / data-bg (up to 3 levels: CNN's `.image[data-url]`); a <noscript><img>; then its src.
 * `want` is the CSS width the Calm view will draw it at.
 */
function bestSrc(img: HTMLImageElement, want: number): string | null {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const ok = (u: string | null): u is string => !!u && !isPlaceholderSrc(u);
  const current = img.complete && img.naturalWidth > 2 && ok(img.currentSrc) ? img.currentSrc : null;
  if (current && img.naturalWidth >= 0.75 * want * Math.min(dpr, 2)) return current;
  const pic = img.parentElement?.localName === 'picture' ? img.parentElement : null;
  if (pic) {
    for (const s of Array.from(pic.querySelectorAll(':scope > source'))) {
      const media = s.getAttribute('media');
      try {
        if (media && !window.matchMedia(media).matches) continue;
      } catch {
        continue;
      }
      const type = s.getAttribute('type');
      if (type && !SUPPORTED_TYPES.test(type.trim())) continue;
      const set = s.getAttribute('srcset') || s.getAttribute('data-srcset');
      const u = set ? absUrl(pickSrcset(set, want, dpr)) : null;
      if (ok(u)) return u;
    }
  }
  const own = img.getAttribute('srcset');
  if (own) {
    const u = absUrl(pickSrcset(own, want, dpr));
    if (ok(u)) return u;
  }
  for (const a of ['data-src', 'data-srcset', 'data-lazy-src', 'data-original', 'data-hi-res-src']) {
    const v = img.getAttribute(a);
    if (!v) continue;
    const u = absUrl(a === 'data-srcset' ? pickSrcset(v, want, dpr) : v);
    if (ok(u)) return u;
  }
  if (current) return current;
  for (let x = img.parentElement, i = 0; x && i < 3; x = x.parentElement, i++) {
    for (const a of ['data-url', 'data-src', 'data-bg']) {
      const v = x.getAttribute(a);
      if (v && /^(https?:)?\/\//i.test(v.trim())) {
        const u = absUrl(v);
        if (ok(u)) return u;
      }
    }
  }
  const ns = img.parentElement?.querySelector('noscript');
  const m = ns ? /<img[^>]+src=["']([^"']+)["']/i.exec(ns.textContent ?? '') : null;
  if (m) {
    const u = absUrl(m[1]);
    if (ok(u)) return u;
  }
  return ok(img.src) ? img.src : null;
}

const LOGO_RE = /\b(logo|logotype|brand ?mark|wordmark)\b/i;
const CHROME_SEL = 'header,nav,footer,[role=banner],[role=navigation],[role=contentinfo]';

/** A logo (F4): named so and small (or in the header, navigation or footer), or the header's home link. */
function isLogoImage(img: Element, rawAlt: string, url: string, r: DOMRect): boolean {
  const home = img.closest('a[href]');
  const named =
    LOGO_RE.test(rawAlt) || LOGO_RE.test(img.getAttribute('class') ?? '') || LOGO_RE.test(img.id) ||
    /[/_-]logo[s]?[._/-]|logo\.(svg|png|jpe?g|webp)/i.test(url.split('?')[0] ?? '') ||
    LOGO_RE.test(img.parentElement?.getAttribute('class') ?? '') || LOGO_RE.test(home?.getAttribute('class') ?? '');
  let homeLink = false;
  if (home && img.closest('header,[role=banner]')) {
    try {
      const u = new URL((home as HTMLAnchorElement).href, location.href);
      homeLink = u.origin === location.origin && (u.pathname === '/' || u.pathname === '');
    } catch {
      homeLink = false;
    }
  }
  return isLogoPicture({ w: r.width, h: r.height, named, inChrome: !!img.closest(CHROME_SEL), homeLink });
}

const BANNER_SEL = '[class*="hero" i],[class*="carousel" i],[class*="slider" i],[class*="swiper" i],[class*="slick" i],[class*="banner" i],[aria-roledescription="carousel"],[aria-roledescription="slide"]';

/** Caption and credit elements drawn with their picture: never read again as text. */
const captionEls = new WeakSet<Element>();
/**
 * Captions and credits by their markup. A gallery or slide's description is its picture's caption too (AP News:
 * "CarouselSlide-infoDescription"), not the story's first paragraph or its dek.
 */
export const CAPTION_SEL =
  'figcaption,[class*="caption" i],[class*="credit" i],[itemprop="caption"],' +
  '[class*="slide" i][class*="desc" i],[class*="carousel" i][class*="desc" i],[class*="gallery" i][class*="desc" i]';

/**
 * A caption or credit drawn under its picture (F7), whichever the reader meets first: an element the picture claimed,
 * or a short caption-like element with no controls whose card (at most 4 boxes up) holds exactly one picture of at
 * least 120 px. "credit-card" fields and captions with links or controls are never taken.
 */
export function isCaptionEl(el: Element): boolean {
  if (captionEls.has(el)) return true;
  if (!el.matches(CAPTION_SEL)) return false;
  const cls = el.getAttribute('class') ?? '';
  if (/card|cvv|payment|score/i.test(cls) && !/caption/i.test(cls)) return false;
  if (el.querySelector('input,select,textarea,button,a[href],img,picture,video,iframe')) return false;
  const t = clean(el.textContent);
  if (!t || t.length > 400) return false;
  // The same card captionFor walks from the picture's side (pictures of 60 px or more end it; at most 4 boxes up).
  for (let x = el.parentElement, i = 0; x && i < 4 && x !== document.body; x = x.parentElement, i++) {
    const pics = Array.from(x.querySelectorAll('img')).filter((p) => p.getBoundingClientRect().width >= 60);
    if (pics.length > 1) return false;
    const pic = pics[0];
    if (pic) {
      if (pic.getBoundingClientRect().width < 120 || depthBetween(x, pic) > 4) return false;
      captionEls.add(el);
      return true;
    }
  }
  return false;
}

let ldCache: { at: number; byPath: Map<string, { url: string; caption: string }>; first: { url: string; caption: string } | null } | null = null;

/** JSON-LD pictures of the page (NewsArticle / Product `image`), by URL path. */
export function ldImages(): { byPath: Map<string, { url: string; caption: string }>; first: { url: string; caption: string } | null } {
  const now = performance.now();
  if (ldCache && now - ldCache.at < 5000) return ldCache;
  const byPath = new Map<string, { url: string; caption: string }>();
  let first: { url: string; caption: string } | null = null;
  const add = (v: unknown): void => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(add);
    if (typeof v === 'string') {
      const u = absUrl(v);
      if (u && !isPlaceholderSrc(u)) {
        const it = { url: u, caption: '' };
        first ??= it;
        try {
          byPath.set(new URL(u).pathname, it);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const u = absUrl(typeof o.contentUrl === 'string' ? o.contentUrl : typeof o.url === 'string' ? o.url : null);
      if (u && !isPlaceholderSrc(u)) {
        const it = { url: u, caption: clean(typeof o.caption === 'string' ? o.caption : typeof o.description === 'string' ? o.description : '').slice(0, 300) };
        first ??= it;
        try {
          byPath.set(new URL(u).pathname, it);
        } catch {
          /* ignore */
        }
      }
    }
  };
  const visit = (node: unknown, depth: number): void => {
    if (!node || depth > 4) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.image) add(o.image);
    if (o['@graph']) visit(o['@graph'], depth + 1);
    if (o.mainEntity) visit(o.mainEntity, depth + 1);
  };
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 12)) {
    try {
      visit(JSON.parse(s.textContent ?? ''), 0);
    } catch {
      /* not JSON */
    }
  }
  ldCache = { at: now, byPath, first };
  return ldCache;
}

/**
 * The picture's caption and credit (F7): its figcaption, else a caption element in its own card (never a credit), else
 * the JSON-LD caption with the same URL path. The card is at most 4 boxes up, while it holds no other picture.
 */
function captionFor(img: Element, url: string): { caption: string; credit: string } {
  let capEl: Element | null = null;
  let creditEl: Element | null = null;
  for (let x = img.parentElement, i = 0; x && i < 4 && x !== document.body; x = x.parentElement, i++) {
    if (Array.from(x.querySelectorAll('img')).some((o) => o !== img && o.getBoundingClientRect().width >= 60)) break;
    for (const c of Array.from(x.querySelectorAll(CAPTION_SEL))) {
      if (c.contains(img) || !clean(c.textContent)) continue;
      const isCredit = /credit|copyright|byline/i.test(c.getAttribute('class') ?? '');
      if (isCredit) creditEl ??= c;
      else capEl ??= c;
    }
    if (capEl || x.localName === 'figure') break;
  }
  const textAt = (e: Element | null): string => (e ? clean((e as HTMLElement).innerText ?? e.textContent) : '');
  let caption = textAt(capEl);
  let credit = textAt(creditEl);
  if (capEl && creditEl && capEl.contains(creditEl)) caption = clean(caption.replace(credit, ''));
  if (caption && credit && caption === credit) caption = '';
  if (!caption) {
    try {
      caption = ldImages().byPath.get(new URL(url).pathname)?.caption ?? '';
    } catch {
      /* ignore */
    }
  }
  if (capEl) captionEls.add(capEl);
  if (creditEl) captionEls.add(creditEl);
  return { caption: caption.slice(0, 280), credit: credit.slice(0, 80) };
}

function imageMeta(img: Element, rawAlt: string, url: string, r: DOMRect): Pick<ImageBlock, 'logo' | 'caption' | 'credit' | 'linked' | 'banner'> {
  let banner = false;
  try {
    banner = !!img.closest(BANNER_SEL);
  } catch {
    banner = false;
  }
  const logo = isLogoImage(img, rawAlt, url, r);
  const { caption, credit } = logo ? { caption: '', credit: '' } : captionFor(img, url);
  return { logo, caption, credit, linked: !!img.closest('a[href]'), banner };
}

/**
 * The picture's own size, also before a lazy picture has loaded: the decoded size, else the size the page records on
 * its media box (`data-original-width`, CNN), else the widest srcset candidate at the shown ratio, else its width and
 * height attributes. A low-resolution placeholder never counts as the picture's size.
 */
function sourceSize(img: HTMLImageElement, r: DOMRect): { nw: number; nh: number } {
  const decoded = img.complete && img.naturalWidth > 2 && img.naturalWidth >= 0.5 * r.width ? { nw: img.naturalWidth, nh: img.naturalHeight } : null;
  for (let x = img.parentElement, i = 0; x && i < 4 && x !== document.body; x = x.parentElement, i++) {
    const w = Number(x.getAttribute('data-original-width'));
    const h = Number(x.getAttribute('data-original-height'));
    if (w > 0 && h > 0) return decoded && decoded.nw > w ? decoded : { nw: w, nh: h };
  }
  if (decoded) return decoded;
  const aw = Number(img.getAttribute('width'));
  const ah = Number(img.getAttribute('height'));
  const ratio = aw > 0 && ah > 0 ? aw / ah : r.width / Math.max(1, r.height);
  const sets = [img.getAttribute('srcset'), img.getAttribute('data-srcset')];
  if (img.parentElement?.localName === 'picture') for (const s of Array.from(img.parentElement.querySelectorAll('source'))) sets.push(s.getAttribute('srcset'));
  let best = 0;
  for (const set of sets) for (const c of parseSrcset(set ?? '')) if (c.w && c.w > best) best = c.w;
  if (best > 0) return { nw: best, nh: Math.round(best / Math.max(0.1, ratio)) };
  return aw > 0 && ah > 0 ? { nw: aw, nh: ah } : { nw: 0, nh: 0 };
}

/**
 * One picture as a block, or null when it is too small, hidden decoration or has no usable source. `important`
 * (a story's own picture, the lead, a product picture) skips the decoration rule and asks for a larger source.
 */
export function imageFor(el: Element, opts: { important?: boolean } = {}): ImageBlock | null {
  let img: Element = el;
  if (el.localName === 'picture') img = el.querySelector('img') ?? el;
  const r = img.getBoundingClientRect();
  if (r.width < 32 || r.height < 32) return null;
  const important = !!opts.important;
  // Decoration the page hides from assistive technology (an icon drawn on a coloured tile) is not a picture to show.
  const hiddenDeco = important ? null : img.closest('[aria-hidden="true"],[role="presentation"],[role="none"]');
  if (hiddenDeco && depthBetween(hiddenDeco, img) <= 3 && !(img instanceof HTMLImageElement && cleanAlt(img.alt))) return null;
  if (img instanceof HTMLImageElement) {
    // The width the Calm view may draw it at: a story picture can become the lead (wide), so it asks for more.
    const url = bestSrc(img, Math.max(important ? 480 : 320, Math.min(960, r.width * (important ? 1.5 : 1.25))));
    if (!url || !safeImageUrl(url)) return null;
    const { nw, nh } = sourceSize(img, r);
    // Photos fill their box; cut-outs, drawings and near-square product shots sit in a well.
    const ratio = nw && nh ? nw / nh : r.width / Math.max(1, r.height);
    const art = /\.(png|svg|gif)(\?|#|$)|^data:image\/(png|svg|gif)/i.test(url) || (ratio > 0.8 && ratio < 1.25);
    const rawAlt = clean(img.alt);
    return {
      b: 'image', url, alt: cleanAlt(rawAlt), w: r.width, h: r.height, nw, nh, fit: art ? 'contain' : 'cover',
      ...imageMeta(img, rawAlt, url, r), important, key: keyOf(img), src: img,
    };
  }
  if (img instanceof SVGSVGElement) {
    if (r.width < 40 || r.height < 40) return null;
    const url = svgDataUrl(img, r);
    if (!url) return null;
    const raw = clean(img.getAttribute('aria-label')) || clean(img.querySelector('title')?.textContent);
    return {
      b: 'image', url, alt: cleanAlt(raw), w: r.width, h: r.height, nw: r.width, nh: r.height, fit: 'contain',
      ...imageMeta(img, raw, '', r), important, key: keyOf(img), src: img,
    };
  }
  // A media box with a CSS background picture (F5 step 6).
  const bg = bgUrlOf(img);
  if (bg && safeImageUrl(bg)) {
    const raw = clean(img.getAttribute('aria-label')) || clean(img.getAttribute('title'));
    return {
      b: 'image', url: bg, alt: cleanAlt(raw), w: r.width, h: r.height, nw: 0, nh: 0, fit: 'cover',
      ...imageMeta(img, raw, bg, r), important, key: keyOf(img), src: img,
    };
  }
  return null;
}

/**
 * Which pictures earn a place (design.md "Important pictures"): never logos; always a story's own picture, the lead
 * and product pictures (`important`), captioned figures and alts that name a chart, graph, map or diagram; never wide
 * stock banners; in a tile or row (`framed`) any picture; in running text a picture of at least 300 px with a real
 * description, or a picture link of at least 120 px. Icons, headshots and decoration are left out.
 */
export function keepImage(b: ImageBlock, framed: boolean): boolean {
  if (b.logo) return false;
  if (b.important) return true;
  if (b.caption || /\b(chart|graph|map|diagram|figure)\b/i.test(b.alt)) return true;
  // Wide stock pictures in heroes and carousels carry no part of the task.
  if (b.banner && b.w >= 360) return false;
  if (framed) return true;
  if (b.w >= 560 && b.w / Math.max(1, b.h) >= 1.45) return false;
  const long = Math.max(b.w, b.h);
  return (!!b.alt && long >= 300) || (b.linked && long >= 120);
}

/** The page's lead picture from its JSON-LD, else og:image unless it is a placeholder (F5 step 7, the lead only). */
export function pageLeadImage(): ImageBlock | null {
  // The page's own copy of its share picture (the same alt words), when it shows one: it loads from the page like its
  // other pictures (a saved copy of the page can't reach the site's image host) and brings its caption.
  const shareAlt = clean(document.querySelector('meta[property="og:image:alt"],meta[name="twitter:image:alt"]')?.getAttribute('content'));
  if (shareAlt.length >= 12) {
    for (const img of Array.from(document.querySelectorAll('img'))) {
      if (clean(img.getAttribute('alt')) !== shareAlt || img.closest('webable-ui')) continue;
      const b = imageFor(img, { important: true });
      if (b && Math.max(b.w, b.h) >= 240) return { ...b, banner: false };
    }
  }
  const ld = ldImages().first;
  const og = absUrl(document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content);
  const pick = ld ?? (og && !isPlaceholderSrc(og) ? { url: og, caption: '' } : null);
  if (!pick || !safeImageUrl(pick.url)) return null;
  const head = document.head ?? document.documentElement;
  return {
    b: 'image', url: pick.url, alt: '', w: 0, h: 0, nw: 0, nh: 0, fit: 'cover', logo: false, caption: pick.caption, credit: '',
    linked: false, banner: false, important: true, key: keyOf(head, 'leadimg'), src: head,
  };
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

const BUTTON_ROLES = new Set(['button', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'option', 'treeitem', 'link']);
const CHECKABLE = 'input[type=checkbox],input[type=radio]';
const ROW_STOP = new Set(['form', 'fieldset', 'ul', 'ol', 'table', 'tbody', 'thead', 'main', 'body', 'html', 'section', 'article', 'nav', 'header', 'footer', 'aside', 'dialog']);
const TEXTLIKE = new Set(['text', 'email', 'tel', 'url', 'number', 'search', 'date', 'time', 'datetime-local', 'month', 'week', '']);

function isHeading(el: Element): number {
  const m = /^h([1-6])$/.exec(el.localName);
  if (m) return Number(m[1]);
  if (el.getAttribute('role') === 'heading') return Math.min(6, Math.max(1, Number(el.getAttribute('aria-level')) || 2));
  return 0;
}

function isButtonLike(el: Element): boolean {
  const tag = el.localName;
  if (tag === 'button' || tag === 'summary') return true;
  if (tag === 'input') return ['button', 'submit', 'reset', 'image'].includes((el as HTMLInputElement).type);
  const role = el.getAttribute('role');
  return !!role && BUTTON_ROLES.has(role) && tag !== 'a';
}

/** A textarea that is really a one-line search box: a combobox, a one-row box, or inside a search form. */
export function isSearchTextarea(el: HTMLTextAreaElement): boolean {
  const role = el.getAttribute('role');
  if (role === 'combobox' || role === 'searchbox') return true;
  if (el.hasAttribute('aria-autocomplete') && el.rows <= 2) return true;
  const named = /^(q|query|search|search_query|p|k)$/i.test(el.name) || /\bsearch\b/i.test(`${el.getAttribute('aria-label') ?? ''} ${el.title}`);
  return el.rows <= 1 && (named || !!el.closest('form[role=search],[role=search],search'));
}

function sensitiveField(el: HTMLInputElement): boolean {
  if (el.type === 'password') return true;
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  if (/\bcc-|one-time-code|current-password|new-password/.test(ac)) return true;
  return /(card.?num|cardnumber|cvc|cvv|csc|securitycode|iban)/i.test(`${el.name} ${el.id}`);
}

function countFormControls(el: Element): number {
  return el.querySelectorAll('input:not([type=hidden]),select,textarea').length;
}

interface Prep {
  rows: Map<Element, Element>; // row element → its checkbox / radio
  consumed: Set<Element>; // labels drawn as part of their control
  hints: Set<Element>; // hints drawn under their field
}

function prepare(root: Element): Prep {
  const rows = new Map<Element, Element>();
  const consumed = new Set<Element>();
  const inputs: Element[] = root.matches(CHECKABLE) ? [root] : Array.from(root.querySelectorAll(CHECKABLE));
  for (const input of inputs) {
    let row: Element = input;
    const lab = (input as HTMLInputElement).labels?.[0];
    if (lab && lab.contains(input) && root.contains(lab)) row = lab;
    while (row !== root && row.parentElement) {
      const p = row.parentElement;
      if (!root.contains(p) || ROW_STOP.has(p.localName)) break;
      if (countFormControls(p) !== 1) break;
      if (p.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]')) break;
      if (textOf(p).length > 360) break;
      row = p;
    }
    rows.set(row, input);
  }
  root.querySelectorAll('label').forEach((l) => {
    if ((l as HTMLLabelElement).control) consumed.add(l);
  });
  if (root instanceof HTMLLabelElement && root.control) consumed.add(root);
  return { rows, consumed, hints: ownHints(root) };
}

/* ------------------------------------------------------------------ */
/* Story cards                                                         */
/* ------------------------------------------------------------------ */

const HEADING_SEL = 'h1,h2,h3,h4,h5,h6,[role=heading]';
const HEADLINE_SEL = '[class*="headline" i],[class*="title" i]';
const KICKER_SEL = '[class*="label" i],[class*="kicker" i],[class*="eyebrow" i],[class*="category" i],[class*="overline" i],[class*="flag" i]';
const DEK_SEL = '[class*="description" i],[class*="dek" i],[class*="summary" i],[class*="standfirst" i],[class*="excerpt" i],[class*="teaser" i],p';

/** Top of an element on the page (a display: contents card has no box: its first child's). */
function pageTopOf(el: Element, depth = 0): number {
  const r = el.getBoundingClientRect();
  if (r.width || r.height) return r.top + window.scrollY;
  if (depth > 3) return Infinity;
  for (const c of Array.from(el.children).slice(0, 8)) {
    const t = pageTopOf(c, depth + 1);
    if (Number.isFinite(t)) return t;
  }
  return Infinity;
}

/** The innermost of several matches that has words (a headline span inside a headline wrapper). */
function innermost(els: Element[]): Element | null {
  const withText = els.filter((e) => !!clean(textOf(e)));
  return withText.find((e) => !withText.some((o) => o !== e && e.contains(o))) ?? null;
}

export interface StoryParts {
  title: string; kicker: string | null; dek: string | null; time: string | null; lines: string[]; top: number; headPx: number;
}

/**
 * A card link's parts in the page's own words: the headline (a heading inside it, else its headline element, else its
 * first line; never the picture's alt text), a short kicker label, the dek (its description element, else the first
 * long line) and a time line. Caption and credit lines of its picture are left out.
 */
export function storyParts(el: Element, adopted: Element | null): StoryParts {
  const capTexts = new Set(
    Array.from(el.querySelectorAll('figcaption,[class*="caption" i],[class*="credit" i]')).map((c) => clean(c.textContent)).filter(Boolean),
  );
  const raw = linesOf(el).filter((l) => !capTexts.has(l));
  const okHead = (h: Element): boolean => !capTexts.has(clean(h.textContent)) && !/\b(sub|dek|desc)/i.test(h.getAttribute('class') ?? '');
  const headEl =
    adopted ??
    innermost(Array.from(el.querySelectorAll(HEADING_SEL)).filter(okHead)) ??
    innermost(Array.from(el.querySelectorAll(HEADLINE_SEL)).filter(okHead));
  let title = headEl ? textOf(headEl) : '';
  const unbullet = (s: string): string => s.replace(/^[•·|\s]+/, '');
  const kEl = Array.from(el.querySelectorAll(KICKER_SEL)).find((k) => {
    const t = unbullet(clean(textOf(k)));
    return !!t && isKickerText(t) && !(headEl && headEl === k);
  });
  const kicker = kEl ? unbullet(clean(textOf(kEl))) : null;
  const isKick = (l: string): boolean => !!kicker && unbullet(l) === kicker;
  const tEl = el.querySelector('time');
  const time = (tEl && clean(textOf(tEl))) || raw.find((l) => isTimeText(l)) || null;
  if (!title) title = raw.find((l) => !isKick(l) && l !== time) ?? '';
  if (!title) title = cleanAlt(el.getAttribute('aria-label'));
  // "Live Updates Obama ties Trump…" when the label sits inside the headline element.
  if (kicker && title.startsWith(`${kicker} `) && title.length > kicker.length + 12) title = title.slice(kicker.length + 1);
  const dEl = Array.from(el.querySelectorAll(DEK_SEL)).find((d) => {
    if (headEl && (d.contains(headEl) || headEl.contains(d))) return false;
    const t = clean(textOf(d));
    return t.length >= 20 && t !== title && !isTimeText(t);
  });
  let dek = (dEl && clean(textOf(dEl))) || raw.find((l) => l !== title && !isKick(l) && l !== time && l.length >= 40) || null;
  // A section name in the headline slot ("Travel" over "Travel"): the label stays the kicker, the dek is the headline.
  if (kicker && title.toLowerCase() === kicker.toLowerCase()) {
    const next = dek ?? raw.find((l) => !isKick(l) && l !== time && l.length >= 12) ?? null;
    if (next) {
      title = next;
      dek = null;
    }
  }
  const lines = raw.filter((l) => l !== title && !isKick(l) && l !== time && l !== dek && !title.includes(l) && !(dek ?? '').includes(l));
  let headPx = 16;
  try {
    headPx = parseFloat(getComputedStyle(headEl ?? el).fontSize) || 16;
  } catch {
    /* detached */
  }
  return { title, kicker, dek, time, lines, top: pageTopOf(headEl ?? el), headPx };
}

/** A headline link the page shows without a card (a list of headlines) as a story card with no picture. */
export function storyFromLink(c: ControlBlock): CardLinkBlock {
  let headPx = 16;
  try {
    headPx = parseFloat(getComputedStyle(c.el).fontSize) || 16;
  } catch {
    /* detached */
  }
  const top = pageTopOf(c.el);
  return {
    b: 'cardlink', el: c.el, href: c.href, title: c.text, lines: [], image: null, kicker: null, dek: null, time: null,
    top: Number.isFinite(top) ? top : 0, headPx, key: `${c.key}s`, src: c.src,
  };
}

/* ------------------------------------------------------------------ */
/* The reader                                                          */
/* ------------------------------------------------------------------ */

class Run {
  out: Block[] = [];
  parts: Inline[] = [];
  flowSrc: Node | null = null;
  /** Bold and italic the page shows on the words being read. */
  em: EmphasisState = PLAIN;
  constructor(readonly ctx: ReadCtx, readonly prep: Prep, readonly root: Element) {}

  push(b: Block): void {
    if (this.ctx.budget.left <= 0) return;
    this.ctx.budget.left--;
    this.out.push(b);
  }

  close(): void {
    if (!this.parts.length) return;
    const parts = this.parts;
    const src = this.flowSrc ?? this.root;
    this.parts = [];
    this.flowSrc = null;
    for (const b of finishFlow(parts, src)) this.push(b);
  }

  text(s: string, node: Node): void {
    if (!s) return;
    if (!/\S/.test(s)) {
      if (this.parts.length) this.parts.push({ t: 'text', text: ' ', ...flagsOf(this.em) });
      return;
    }
    if (!this.flowSrc) this.flowSrc = node;
    this.parts.push({ t: 'text', text: s.replace(/[\s ]+/g, ' '), ...flagsOf(this.em) });
  }

  visitChildren(el: Element | ShadowRoot, vis: boolean): void {
    const kids: Node[] = [];
    if (el instanceof Element && el.shadowRoot) kids.push(...Array.from(el.shadowRoot.childNodes));
    else kids.push(...Array.from(el.childNodes));
    for (const k of kids) {
      if (this.ctx.budget.left <= 0) return;
      this.visit(k, vis);
    }
  }

  visit(node: Node, vis: boolean): void {
    if (node.nodeType === Node.TEXT_NODE) {
      if (vis) this.text((node as Text).data, node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const ctx = this.ctx;
    if (IGNORE.has(el.localName) || el.hasAttribute(RW_MARK)) return;
    if (el !== this.root) {
      const p = ctx.placed.get(el);
      if (p !== undefined && p !== ctx.current) return;
      if (ctx.skip.has(el)) return;
      // Drawn elsewhere: a picture link with its headline, a heading as a picture's title, a caption with its picture.
      if (ctx.pairs.skip.has(el) || ctx.pairs.adopted.has(el) || isCaptionEl(el)) return;
      if (ctx.folded.has(el)) {
        this.close();
        ctx.foldedHits.push(el);
        return;
      }
    }
    if (el.localName === 'slot') {
      for (const n of (el as HTMLSlotElement).assignedNodes({ flatten: true })) this.visit(n, vis);
      return;
    }
    const cs = getComputedStyle(el);
    if (hidden(el, cs)) return;
    const v = cs.visibility === 'visible' ? true : cs.visibility === 'hidden' || cs.visibility === 'collapse' ? false : vis;
    const block = !INLINE.has(cs.display);

    // Round 9: a paragraph WebAble rewrote in place (its lead, any list, the mark) is one block, drawn from the rewrite.
    if (el.hasAttribute(RW_ATTR)) {
      if (!v) return;
      this.close();
      for (const b of finishFlow(rewrittenParts(el, (a, t) => this.isHelp(a, t)), el)) this.push(b);
      return;
    }

    // Choice rows: a checkbox or radio with its label and meta lines.
    const rowInput = this.prep.rows.get(el);
    if (rowInput && v) {
      this.close();
      this.push(this.choice(el, rowInput));
      return;
    }
    if (this.prep.hints.has(el)) return;
    if (this.prep.consumed.has(el)) {
      // Drawn by its control; still reach controls nested inside it.
      el.querySelectorAll('input,select,textarea,button,a[href],[role=button]').forEach((c) => this.visit(c, v));
      return;
    }

    const level = isHeading(el);
    if (level) {
      if (!v) return;
      const t = textOf(el);
      if (!t) return;
      this.close();
      this.push({ b: 'heading', level, text: t, el, key: keyOf(el), src: el });
      return;
    }

    const tag = el.localName;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (!v) return;
      this.close();
      const b = this.formControl(el as FormEl);
      if (b) this.push(b);
      return;
    }
    const role = el.getAttribute('role');
    if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      if (!v) return;
      this.close();
      this.push(this.choice(el, el));
      return;
    }
    if (isButtonLike(el) || (ctx.primary === el && tag !== 'a')) {
      if (!v) return;
      this.close();
      const b = this.control(el, role === 'link' ? 'link' : 'button');
      if (b) this.push(b);
      return;
    }
    if (tag === 'a' && (el.hasAttribute('href') || el.hasAttribute('onclick') || el.hasAttribute('tabindex'))) {
      if (!v) return;
      if (ctx.primary === el || ctx.primary && el.contains(ctx.primary)) {
        this.close();
        const b = this.control(el, 'link');
        if (b) this.push(b);
        return;
      }
      // A headline paired with its picture, or a picture link titled by its card's heading: one story card.
      if (ctx.pairs.pic.has(el) || ctx.pairs.head.has(el)) {
        this.close();
        const b = this.cardLink(el);
        if (b) this.push(b);
        return;
      }
      // A link wrapping a card (picture, headline and summary) is one tappable card, whatever its own display.
      if (block || el.querySelector('h1,h2,h3,h4,h5,h6,p,div,img,picture')) {
        const media = el.querySelector('img,picture,svg') ? linkPicture(el) : null;
        const lines = linesOf(el);
        if ((media && imageFor(media)) || (lines.length >= 2 && lines.join(' ').length > 24)) {
          this.close();
          const b = this.cardLink(el);
          if (b) this.push(b);
          return;
        }
        // A link around one heading is a heading link (a text link drawn at the heading's size), never a pill.
        if (el.querySelector(HEADING_SEL)) {
          this.close();
          const b = this.control(el, 'link');
          if (b) this.push({ ...b, head: true });
          return;
        }
      }
      const text = nameOf(el);
      if (!text) return;
      if (!this.flowSrc) this.flowSrc = el;
      // Keep the spaces at the link's edges ("…Middle East </a>as" must not read "Eastas").
      const raw = el.textContent ?? '';
      if (/^\s/.test(raw) && this.parts.length) this.parts.push({ t: 'text', text: ' ' });
      this.parts.push({ t: 'link', el, text, href: safeHref(el), help: this.isHelp(el, text), ...flagsOf(inlineEmphasis(tag, cs, this.em)) });
      if (/\s$/.test(raw)) this.parts.push({ t: 'text', text: ' ' });
      return;
    }
    if (tag === 'img' || tag === 'picture' || tag === 'svg') {
      if (!v) return;
      const keep = !!ctx.keepLogos?.size && keptLogo(el, ctx.keepLogos);
      const img = imageFor(el, keep ? { important: true } : {});
      if (img && keep) img.logo = false;
      if (img) {
        this.close();
        this.push(img);
      }
      return;
    }
    if (tag === 'video' || tag === 'audio' || tag === 'iframe' || tag === 'embed' || tag === 'object' || tag === 'canvas') {
      if (!v) return;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 50) return;
      this.close();
      const label = clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title'));
      // An ad frame is not part of the task: Calm view leaves it on the page (it is in Original page).
      if (tag === 'iframe' && (AD_FRAME_SRC.test(el.getAttribute('src') ?? '') || /^(google_ads_iframe|aswift_|ad[-_])/i.test(`${el.id} ${el.getAttribute('name') ?? ''}`.trim()) || /^(advertisement|ad|ads|sponsored( content)?|3rd party ad content)$/i.test(label))) return;
      const why = tag === 'video' || tag === 'audio' || tag === 'canvas' ? 'media' : 'frame';
      this.push({ b: 'peek', el, label, why, key: keyOf(el), src: el });
      return;
    }
    if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) {
      if (!v) return;
      this.close();
      this.push({ b: 'peek', el, label: clean(el.getAttribute('aria-label')), why: 'editor', key: keyOf(el), src: el });
      return;
    }
    if (tag === 'br') {
      if (v) this.parts.push({ t: 'br' });
      return;
    }
    if (tag === 'hr') {
      this.close();
      return;
    }
    if (tag === 'ul' || tag === 'ol' || role === 'list') {
      this.close();
      const items: Block[][] = [];
      for (const li of Array.from(el.children)) {
        if (IGNORE.has(li.localName)) continue;
        const lp = ctx.placed.get(li);
        if ((lp !== undefined && lp !== ctx.current) || ctx.skip.has(li)) continue;
        if (ctx.folded.has(li)) {
          ctx.foldedHits.push(li);
          continue;
        }
        const lcs = getComputedStyle(li);
        if (hidden(li, lcs)) continue;
        const lv = lcs.visibility === 'visible' ? true : lcs.visibility === 'hidden' ? false : v;
        const blocks = readBlocksFrom(li, this.ctx, li, lv);
        if (blocks.length) items.push(blocks);
      }
      if (items.length) this.push({ b: 'list', ordered: tag === 'ol', items, key: keyOf(el), src: el });
      return;
    }
    if (tag === 'table' && v && !el.querySelector('input,select,textarea,button,a[href]')) {
      const rows = Array.from((el as HTMLTableElement).rows)
        .slice(0, 120)
        .map((r) => Array.from(r.cells).slice(0, 12).map((c) => textOf(c)))
        .filter((r) => r.some(Boolean));
      if (rows.length && rows.every((r) => r.every((c) => c.length < 400))) {
        this.close();
        const first = (el as HTMLTableElement).rows[0];
        const head = !!(el as HTMLTableElement).tHead || (!!first && Array.from(first.cells).every((c) => c.localName === 'th'));
        this.push({ b: 'table', rows, head, key: keyOf(el), src: el });
        return;
      }
    }
    if (tag === 'table' && v) {
      const trs = Array.from((el as HTMLTableElement).rows).slice(0, 120);
      const big = trs.some((r) => Array.from(r.cells).some((c) => textOf(c).length > 600));
      if (trs.length && !big) {
        this.close();
        const rows: Array<{ cells: Block[][]; head: boolean }> = [];
        for (const tr of trs) {
          const tcs = getComputedStyle(tr);
          if (hidden(tr, tcs)) continue;
          const cells = Array.from(tr.cells)
            .slice(0, 12)
            .map((c) => readBlocksFrom(c, this.ctx, c, v))
            .filter((b) => b.length);
          if (cells.length) rows.push({ cells, head: Array.from(tr.cells).every((c) => c.localName === 'th') });
        }
        if (rows.length) this.push({ b: 'rtable', rows, key: keyOf(el), src: el });
        return;
      }
    }
    if (tag === 'details' && v) {
      // A question and its answer (FAQ): the summary is the heading, the answer shows under it.
      this.close();
      const summary = el.querySelector(':scope > summary');
      const legend = summary ? textOf(summary) : '';
      const blocks = readBlocksFrom(el, this.ctx, el, v, summary);
      if (legend || blocks.length) this.push({ b: 'group', legend, blocks, key: keyOf(el), src: el });
      return;
    }
    if (tag === 'fieldset' || role === 'radiogroup' || role === 'group' && el.querySelector(CHECKABLE)) {
      this.close();
      const legendEl = tag === 'fieldset' ? el.querySelector(':scope > legend') : null;
      let legend = stripMarker(legendEl ? textOf(legendEl) : labelledBy(el) || clean(el.getAttribute('aria-label')));
      const blocks = readBlocksFrom(el, this.ctx, el, v, legendEl);
      // A visually hidden legend ("Prescriptions to refill") under a visible card title ("Your prescriptions (3)"):
      // the visible title is the group's heading, shown once.
      const lr = legendEl?.getBoundingClientRect();
      const first = blocks[0];
      const hiddenLegend = !legend || (!!lr && (lr.width <= 2 || lr.height <= 2));
      if (hiddenLegend && first && ((first.b === 'flow' && first.text.length <= 48 && !first.parts.some((p) => p.t === 'link')) || first.b === 'heading')) {
        legend = first.text;
        blocks.shift();
      }
      if (blocks.length) this.push({ b: 'group', legend, blocks, key: keyOf(el), src: el });
      return;
    }

    if (block) this.close();
    const outer = this.em;
    this.em = block ? blockEmphasis(cs) : inlineEmphasis(tag, cs, outer);
    this.visitChildren(el, v);
    this.em = outer;
    if (block) this.close();
  }

  isHelp(el: Element, text: string): boolean {
    if (this.ctx.help.has(el)) return true;
    for (const h of this.ctx.help) if (h.contains(el)) return true;
    const href = (el as HTMLAnchorElement).href;
    if (typeof href === 'string' && /^(tel|mailto):/i.test(href)) return true;
    return HELP_RE.test(text) && text.length <= 60;
  }

  control(el: Element, role: 'button' | 'link'): ControlBlock | null {
    const text = nameOf(el);
    const primary = this.ctx.primary === el || (!!this.ctx.primary && el.contains(this.ctx.primary));
    if (!text && !primary) return null; // a nameless icon control has no words to show
    if (primary) this.ctx.primarySeen = true;
    const selected =
      el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' ||
      (el.getAttribute('aria-current') ?? 'false') !== 'false';
    const popup = el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded') || el.getAttribute('role') === 'combobox';
    return {
      b: 'control', el, role, text: text || 'Main button on this page', href: role === 'link' ? safeHref(el) : null,
      primary, help: this.isHelp(el, text), selected, popup, key: keyOf(el), src: el,
    };
  }

  /**
   * One story or tile link as a card: its headline (never the picture's alt text), the kicker above it, the dek and
   * time under it, and its picture (its own, or its paired picture link's). An untitled picture link keeps the picture.
   */
  cardLink(el: Element): CardLinkBlock | null {
    const pairs = this.ctx.pairs;
    const paired = pairs.pic.get(el) ?? null;
    const media = paired ?? (el.querySelector('img,picture,svg') ? linkPicture(el) : null);
    const image = media ? imageFor(media, { important: !!paired }) : null;
    const story = storyParts(el, pairs.head.get(el) ?? null);
    // A logo link is the site's name: it is in the top bar, never a card.
    if ((image?.logo || /\blogo\b/i.test(story.title)) && story.lines.length <= 1 && !story.dek) return null;
    if (!story.title && !image) return null;
    let top = story.top;
    if (image?.src instanceof Element) {
      const r = image.src.getBoundingClientRect();
      if (r.width || r.height) top = Math.min(top, r.top + window.scrollY);
    }
    return {
      b: 'cardlink', el, href: safeHref(el), title: story.title, lines: story.lines.slice(0, 6), image,
      kicker: story.kicker, dek: story.dek, time: story.time, top: Number.isFinite(top) ? top : 0, headPx: story.headPx,
      key: keyOf(el), src: el,
    };
  }

  choice(row: Element, input: Element): ChoiceBlock {
    const isInput = input instanceof HTMLInputElement;
    const role = input.getAttribute('role');
    const type: 'checkbox' | 'radio' = isInput ? ((input as HTMLInputElement).type === 'radio' ? 'radio' : 'checkbox') : role === 'radio' ? 'radio' : 'checkbox';
    const extrasEls = row === input ? [] : Array.from(row.querySelectorAll('a[href],button,[role=button]')).filter((e) => !e.contains(input));
    const extraTexts = new Set(extrasEls.map((e) => nameOf(e)));
    const labelLines = isInput ? labelLinesOf(input) : [nameOf(input)].filter(Boolean);
    const rowLines = row === input ? [] : linesOf(row).filter((l) => !extraTexts.has(l));
    const title = labelLines[0] ?? rowLines[0] ?? '';
    const meta: string[] = [];
    // A link drawn below the row ("Change store") is not repeated at the end of a meta line.
    const trimExtra = (l: string): string => {
      let out = l;
      for (const t of extraTexts) {
        if (t && out.endsWith(t)) out = out.slice(0, -t.length).replace(/[\s·•|,–—-]+$/, '');
      }
      return out;
    };
    for (const raw of [...labelLines.slice(1), ...rowLines]) {
      const l = trimExtra(raw);
      if (l && l !== title && !meta.includes(l) && !title.includes(l)) meta.push(l);
    }
    const extra: Block[] = [];
    for (const e of extrasEls) {
      const b = this.control(e, e.localName === 'a' ? 'link' : 'button');
      if (b) extra.push(b);
    }
    return {
      b: 'choice', el: input, type, name: isInput ? (input as HTMLInputElement).name : '', title: title || 'Option',
      meta: meta.slice(0, 4), extra, key: keyOf(input), src: row,
    };
  }

  formControl(el: FormEl): Block | null {
    const key = keyOf(el);
    if (el instanceof HTMLSelectElement) {
      if (el.multiple) return { b: 'peek', el, label: labelOf(el), why: 'file', key, src: el };
      return { b: 'select', el, label: labelOf(el), hint: describedBy(el), required: el.required || el.getAttribute('aria-required') === 'true', key, src: el };
    }
    if (el instanceof HTMLTextAreaElement) {
      // A one-line search box built from a textarea (Google's): a normal single-line search field, not a big box.
      if (isSearchTextarea(el)) {
        return {
          b: 'field', el, label: labelOf(el) || 'Search', hint: describedBy(el), required: false,
          multiline: false, type: 'search', search: true, key, src: el,
        };
      }
      return {
        b: 'field', el, label: labelOf(el), hint: describedBy(el), required: el.required || el.getAttribute('aria-required') === 'true',
        multiline: true, type: 'text', search: false, key, src: el,
      };
    }
    const type = el.type;
    if (type === 'hidden') return null;
    if (type === 'checkbox' || type === 'radio') return this.choice(el, el);
    if (['button', 'submit', 'reset', 'image'].includes(type)) return this.control(el, 'button');
    if (sensitiveField(el)) return { b: 'peek', el, label: labelOf(el), why: 'sensitive', key, src: el };
    if (!TEXTLIKE.has(type)) return { b: 'peek', el, label: labelOf(el), why: 'file', key, src: el };
    const search = type === 'search' || el.getAttribute('role') === 'searchbox' || !!el.closest('[role=search],search');
    return {
      b: 'field', el, label: labelOf(el), hint: describedBy(el), required: el.required || el.getAttribute('aria-required') === 'true',
      multiline: false, type: type || 'text', search, key, src: el,
    };
  }
}

/** Round 9: the engine marks a paragraph it rewrote in place with this attribute, and its in-page mark with RW_MARK. */
export const RW_ATTR = 'data-wa-rw';
export const RW_MARK = 'data-wa-rw-mark';

/** A rewritten paragraph is a FlowBlock whose source is the paragraph itself. */
export function isRewritten(b: Block): boolean {
  return b.b === 'flow' && b.src instanceof Element && b.src.hasAttribute(RW_ATTR);
}

/** The words of a rewritten paragraph as one run of inline parts: list items run on, the in-page mark is skipped. */
function rewrittenParts(p: Element, isHelp: (a: Element, text: string) => boolean): Inline[] {
  const out: Inline[] = [];
  const walk = (n: Node, em: EmphasisState): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      const s = (n as Text).data;
      if (s) out.push({ t: 'text', text: s.replace(/[\s ]+/g, ' '), ...flagsOf(em) });
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as Element;
    if (IGNORE.has(e.localName) || e.hasAttribute(RW_MARK)) return;
    let cs: FontStyle & { display: string } = { fontWeight: '', fontStyle: '', display: 'inline' };
    try {
      const c = getComputedStyle(e);
      if (hidden(e, c)) return;
      cs = c;
    } catch {
      /* detached */
    }
    const tag = e.localName;
    const inner = INLINE.has(cs.display) ? inlineEmphasis(tag, cs, em) : blockEmphasis(cs);
    if (tag === 'br') {
      out.push({ t: 'br' });
      return;
    }
    if (tag === 'a' && (e.hasAttribute('href') || e.hasAttribute('onclick'))) {
      const text = nameOf(e);
      if (!text) return;
      const raw = e.textContent ?? '';
      if (/^\s/.test(raw)) out.push({ t: 'text', text: ' ' });
      out.push({ t: 'link', el: e, text, href: safeHref(e), help: isHelp(e, text), ...flagsOf(inner) });
      if (/\s$/.test(raw)) out.push({ t: 'text', text: ' ' });
      return;
    }
    const item = tag === 'li' || tag === 'ul' || tag === 'ol';
    if (item) out.push({ t: 'text', text: ' ' });
    e.childNodes.forEach((c) => walk(c, inner));
    if (item) out.push({ t: 'text', text: ' ' });
  };
  let root = PLAIN;
  try {
    root = blockEmphasis(getComputedStyle(p));
  } catch {
    /* detached */
  }
  p.childNodes.forEach((c) => walk(c, root));
  return out;
}

function finishFlow(parts: Inline[], src: Node): Block[] {
  // Runs of words merge only with the same emphasis (a space joins whatever run is before it).
  const merged: Inline[] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (p.t === 'text' && last?.t === 'text' && (sameEmphasis(last, p) || !/\S/.test(p.text))) last.text += p.text;
    else merged.push(p.t === 'text' ? { ...p } : p);
  }
  while (merged.length && (merged[0]!.t === 'br' || (merged[0]!.t === 'text' && !/\S/.test((merged[0] as { text: string }).text)))) merged.shift();
  while (merged.length) {
    const l = merged[merged.length - 1]!;
    if (l.t === 'br' || (l.t === 'text' && !/\S/.test(l.text))) merged.pop();
    else break;
  }
  if (!merged.length) return [];
  const first = merged[0]!;
  if (first.t === 'text') first.text = first.text.replace(/^\s+/, '');
  const lastPart = merged[merged.length - 1]!;
  if (lastPart.t === 'text') lastPart.text = lastPart.text.replace(/\s+$/, '');
  const links = merged.filter((p): p is LinkPart => p.t === 'link');
  const plain = clean(merged.filter((p) => p.t === 'text').map((p) => (p as { text: string }).text).join(' '));
  if (links.length && /^[\s·•|/,–—\-:]*$/.test(plain)) {
    return links.map((l) => ({
      b: 'control', el: l.el, role: 'link', text: l.text, href: l.href, primary: false, help: l.help,
      selected: (l.el.getAttribute('aria-current') ?? 'false') !== 'false', popup: false, key: keyOf(l.el), src: l.el,
    }));
  }
  const text = clean(merged.map((p) => (p.t === 'br' ? ' ' : p.text)).join(''));
  if (!text) return [];
  const help = links.some((l) => l.help && /^(tel|mailto):/i.test(l.href ?? '')) || (links.some((l) => l.help) && text.length < 200);
  return [{ b: 'flow', parts: merged, text, help, key: keyOf(src, 'f'), src }];
}

/** Group consecutive choices into one grouped list (radios by name). */
function groupChoices(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.b === 'choice') {
      const last = out[out.length - 1];
      if (last?.b === 'choices' && last.type === b.type && (b.type === 'checkbox' || last.items[0]?.name === b.name)) {
        last.items.push(b);
        continue;
      }
      out.push({ b: 'choices', type: b.type, items: [b], key: `${b.key}g`, src: b.src });
      continue;
    }
    if (b.b === 'group') b.blocks = groupChoices(b.blocks);
    if (b.b === 'list') b.items = b.items.map(groupChoices);
    out.push(b);
  }
  return out;
}

function readBlocksFrom(el: Element, ctx: ReadCtx, root: Element, vis: boolean, skipChild: Element | null = null): Block[] {
  const run = new Run(ctx, prepare(root), root);
  const rowInput = run.prep.rows.get(root);
  if (rowInput && vis) {
    run.push(run.choice(root, rowInput));
    return groupChoices(run.out);
  }
  for (const k of Array.from(el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes)) {
    if (k === skipChild) continue;
    run.visit(k, vis);
  }
  run.close();
  return groupChoices(run.out);
}

/** Read one placed element (and its subtree) into blocks. */
/** A picture that is (or sits in) a logo Jev's page model says to keep: up to two wrappers (a link around the image). */
function keptLogo(el: Element, keep: Set<Element>): boolean {
  for (let x: Element | null = el, i = 0; x && i < 3; x = x.parentElement, i++) if (keep.has(x)) return true;
  return false;
}

export function readBlocks(root: Element, ctx: ReadCtx): Block[] {
  if (!root.isConnected) return [];
  // A placed element that is drawn elsewhere (an article's byline or date in its header, a caption under its picture,
  // a picture link drawn with its headline) is not read again, even when the page outline places it on its own.
  // The outline may also place pieces of one (each name of a byline, the text inside a caption): those go too.
  for (let x: Element | null = root; x && x !== document.body; x = x.parentElement) {
    if (ctx.elsewhere.has(x) || ctx.pairs.skip.has(x) || ctx.pairs.adopted.has(x) || isCaptionEl(x)) return [];
  }
  const run = new Run(ctx, prepare(root), root);
  run.visit(root, true);
  run.close();
  if (ctx.budget.left <= 0 && root.isConnected) {
    run.out.push({ b: 'peek', el: root, label: '', why: 'rest', key: keyOf(root, 'rest'), src: root });
  }
  return dropEchoes(groupChoices(run.out));
}

const AD_FRAME_SRC = /(doubleclick\.net|googlesyndication\.com|googleadservices|adnxs\.com|amazon-adsystem|taboola|outbrain|criteo|adsrvr|moatads|pubmatic|rubiconproject|openx\.net|\/ads?\/|[?&]ad_?unit=)/i;

/** The words a block shows, for spotting echoes (lower case, no trailing ellipsis). */
function echoText(b: Block): string {
  const t = b.b === 'flow' || b.b === 'control' || b.b === 'heading' ? b.text : b.b === 'cardlink' ? [b.title, ...b.lines].join(' ') : '';
  return clean(t).toLowerCase().replace(/(\.{3}|…)$/, '').trim();
}

/**
 * A news card often repeats its summary as a cut-off link right after it ("…and past scrutiny" then "…and past…"):
 * a short echo of the block just before it is dropped (the element stays on the page and in Original page).
 */
function dropEchoes(bs: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of bs) {
    const prev = out[out.length - 1];
    const t = echoText(b);
    const p = prev ? echoText(prev) : '';
    if (prev && t.length >= 24 && p.length >= t.length && p.startsWith(t) && (b.b === 'flow' || b.b === 'control')) continue;
    // A card whose title only repeats the summary of the card before it (two links to one story).
    if (b.b === 'cardlink' && prev?.b === 'cardlink' && !b.lines.length) {
      const title = clean(b.title).toLowerCase().replace(/(\.{3}|…)$/, '').trim();
      if (title.length >= 24 && clean(prev.lines.join(' ')).toLowerCase().startsWith(title)) continue;
    }
    if (b.b === 'group') b.blocks = dropEchoes(b.blocks);
    if (b.b === 'list' && b.items.length > 1) {
      const items: Block[][] = [];
      for (const it of b.items) {
        const last = items[items.length - 1];
        const one = it.length === 1 ? it[0] : undefined;
        const before = last && last.length === 1 ? last[0] : undefined;
        if (one?.b === 'cardlink' && before?.b === 'cardlink' && dropEchoes([before, one]).length === 1) continue;
        items.push(it);
      }
      b.items = items;
    }
    out.push(b);
  }
  return out;
}

/** A control block for one element outside a read (the primary action when no section reached it). */
export function controlFor(el: Element, ctx: ReadCtx): ControlBlock | null {
  if (!el.isConnected) return null;
  const run = new Run(ctx, { rows: new Map(), consumed: new Set(), hints: new Set() }, el);
  return run.control(el, el.localName === 'a' || el.getAttribute('role') === 'link' ? 'link' : 'button');
}

function visibleChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (const k of Array.from(el.children)) {
    if (IGNORE.has(k.localName)) continue;
    const cs = getComputedStyle(k);
    if (cs.display === 'contents') {
      out.push(...visibleChildren(k));
      continue;
    }
    if (hidden(k, cs)) continue;
    if (!textOf(k) && !k.querySelector('img,svg,picture,input,select,textarea,button')) continue;
    out.push(k);
  }
  return out;
}

function signature(el: Element): string {
  return `${el.localName}.${(el.getAttribute('class') ?? '').trim().split(/\s+/)[0] ?? ''}`;
}

/**
 * Split placed roots into repeated records (cards, rows) and the rest (a heading, a "See all" link).
 * Records are the largest group of look-alike children; order is the page's own.
 */
export function recordsOf(roots: Element[]): { records: Element[]; heading: Element | null; before: Element[]; after: Element[]; uniform: boolean } {
  const alike = (els: Element[]): Element[] => {
    const groups = new Map<string, Element[]>();
    for (const k of els) {
      const s = signature(k);
      const g = groups.get(s);
      if (g) g.push(k);
      else groups.set(s, [k]);
    }
    let best: Element[] = [];
    for (const g of groups.values()) if (g.length > best.length) best = g;
    return best;
  };
  if (roots.length >= 2) {
    const best = alike(roots);
    return { records: roots, heading: null, before: [], after: [], uniform: best.length >= 2 && best.length >= 0.6 * roots.length };
  }
  let el = roots[0];
  if (!el) return { records: [], heading: null, before: [], after: [], uniform: false };
  let heading: Element | null = null;
  for (let depth = 0; depth < 6; depth++) {
    const kids = visibleChildren(el);
    const nonHead = kids.filter((k) => {
      if (isHeading(k)) {
        heading ??= k;
        return false;
      }
      return true;
    });
    if (nonHead.length === 1 && kids.length <= 2) {
      el = nonHead[0]!;
      continue;
    }
    if (nonHead.length >= 2) {
      const best = alike(nonHead);
      if (best.length < 2 || best.length < 0.5 * nonHead.length) return { records: [el], heading: null, before: [], after: [], uniform: false };
      const firstIdx = nonHead.indexOf(best[0]!);
      const lastIdx = nonHead.indexOf(best[best.length - 1]!);
      const set = new Set(best);
      return {
        records: best,
        heading,
        before: nonHead.slice(0, firstIdx),
        after: nonHead.slice(lastIdx + 1).concat(nonHead.slice(firstIdx, lastIdx + 1).filter((k) => !set.has(k))),
        uniform: true,
      };
    }
    break;
  }
  return { records: [el], heading, before: [], after: [], uniform: false };
}

/** Everything a block tree contains, flattened (for counting, recaps and finding controls). */
export function flatten(blocks: Block[]): Block[] {
  const out: Block[] = [];
  const walk = (bs: Block[]): void => {
    for (const b of bs) {
      out.push(b);
      if (b.b === 'group') walk(b.blocks);
      else if (b.b === 'list') b.items.forEach(walk);
      else if (b.b === 'choices') walk(b.items);
      else if (b.b === 'choice') walk(b.extra);
      else if (b.b === 'rtable') b.rows.forEach((r) => r.cells.forEach(walk));
    }
  };
  walk(blocks);
  return out;
}

/** Plain words of a block tree (for coverage checks and recaps). */
export function wordsOf(blocks: Block[]): string {
  return flatten(blocks)
    .map((b) => {
      switch (b.b) {
        case 'heading': case 'flow': case 'control': return b.text;
        case 'choice': return [b.title, ...b.meta].join(' ');
        case 'field': case 'select': return b.label;
        case 'table': return b.rows.map((r) => r.join(' ')).join(' ');
        case 'group': return b.legend;
        case 'cardlink': return [b.title, ...b.lines].join(' ');
        case 'image': return b.alt;
        default: return '';
      }
    })
    .filter(Boolean)
    .join(' ');
}

/** Visible dialogs and menus the page shows right now (to mirror a popup the person opened through a proxy). */
export function pagePopups(): Element[] {
  const out: Element[] = [];
  document.querySelectorAll('[role=dialog],[role=alertdialog],[role=listbox],[role=menu],[aria-modal=true],dialog[open]').forEach((el) => {
    if (el.closest('webable-ui')) return;
    if (!isShown(el)) return;
    if (out.some((o) => o.contains(el))) return;
    out.push(el);
  });
  return out;
}

const GENERIC_NAME = /^(home|homepage|home page|welcome|official site|official website|index|main|untitled|default)$/i;

function shortName(raw: string): string | null {
  let t = clean(raw);
  if (!t) return null;
  // og:site_name sometimes holds a URL ("https://www.wcjb.com"): use its host.
  if (/^(https?:\/\/|www\.)/i.test(t)) {
    try {
      t = new URL(/^https?:/i.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }
  if (GENERIC_NAME.test(t)) return null;
  return t.length <= 24 ? t : null;
}

/** The brand link's first line ("Lakeshore County" of "Lakeshore County / Family Services"). */
function brandLinkName(): string | null {
  const a = document.querySelector('header a[href], [role=banner] a[href]');
  if (!a) return null;
  try {
    const u = new URL((a as HTMLAnchorElement).href, location.href);
    if (u.origin !== location.origin) return null;
  } catch {
    return null;
  }
  const first = linesOf(a)[0] ?? clean(a.getAttribute('aria-label')) ?? '';
  return first && first.length <= 24 && !GENERIC_NAME.test(first) ? first : null;
}

/**
 * The site's short name for the strip (at most 24 characters): og:site_name, else the hostname. Pages served from a
 * bare address (127.0.0.1) use the title's site part or the brand link instead of the address.
 */
export function siteName(): string {
  const meta = (sel: string): string => clean(document.querySelector<HTMLMetaElement>(sel)?.content);
  const og = shortName(meta('meta[property="og:site_name"]')) ?? shortName(meta('meta[name="application-name"]'));
  if (og) return og;
  const host = location.hostname.replace(/^www\./, '');
  const bareHost = !host || /^[\d.]+$|^\[|^localhost$/i.test(host);
  if (!bareHost) return host.length <= 24 ? host : host.split('.').slice(-2).join('.');
  const parts = clean(document.title).split(/\s+[|–—·•-]\s+/).map(clean).filter(Boolean);
  const last = parts.length >= 2 ? shortName(parts[parts.length - 1]!) : null;
  return last ?? brandLinkName() ?? (shortName(parts[0] ?? '') || 'This page');
}

/* ------------------------------------------------------------------ */
/* Widgets the view treats specially                                   */
/* ------------------------------------------------------------------ */

const CHAT_ATTR = /\b(chat|chatbot|livechat|live-chat|webchat|messenger|intercom|drift|zendesk|zopim|olark|tawk|livehelp|helpbot|virtual[- ]?assistant)\b|chat|assistant/i;
const CHAT_WORDS = /\b(chat|virtual assistant|live agent|send (a )?message|message us|talk to us|ask us)\b/i;

function floating(el: Element): boolean {
  for (let x: Element | null = el, i = 0; x && i < 6; x = x.parentElement, i++) {
    const p = getComputedStyle(x).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

/** A chat widget (or its launcher): floating over the page and named, labelled or built as a chat. */
export function isChatWidget(el: Element): boolean {
  if (!floating(el)) return false;
  // A sticky header or a full-width bar that happens to hold a "Chat with us" link is not a chat widget.
  const r = el.getBoundingClientRect();
  if (r.width > Math.max(520, window.innerWidth * 0.5) && el.localName !== 'iframe') return false;
  const attrs = [el.id, el.getAttribute('class') ?? '', el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('data-testid') ?? ''].join(' ');
  if (CHAT_ATTR.test(attrs)) return true;
  if (el.localName === 'iframe' && CHAT_ATTR.test(`${el.getAttribute('title') ?? ''} ${(el as HTMLIFrameElement).src}`)) return true;
  const t = textOf(el).slice(0, 400);
  return CHAT_WORDS.test(t) || !!el.querySelector('[aria-label*="chat" i],[class*="chat" i],[id*="chat" i]');
}

/** The outermost chat widget holding `el`, if any (looks up a few levels). */
export function chatContainer(el: Element): Element | null {
  let found: Element | null = null;
  for (let x: Element | null = el, i = 0; x && x !== document.body && i < 8; x = x.parentElement, i++) {
    if (isChatWidget(x)) found = x;
  }
  return found;
}

/** The site's own progress rail for a multi-page flow ("Your application": steps with done / current). */
export function isProgressRail(el: Element): boolean {
  const label = `${el.getAttribute('aria-label') ?? ''} ${labelledBy(el)}`;
  if (/\b(steps?|progress|application|your (application|journey|progress))\b/i.test(label) && el.querySelector('ol,ul,[aria-current="step"]')) return true;
  return !!el.querySelector('[aria-current="step"]') && el.querySelectorAll('li').length >= 3 && !el.querySelector('input,select,textarea');
}

/** "Step 2 of 5" in the page's own words, if the page says it. */
export function siteStepText(root: ParentNode = document): string | null {
  const bar = root.querySelector('[role=progressbar][aria-valuetext]');
  const vt = clean(bar?.getAttribute('aria-valuetext'));
  if (/step\s+\d+\s+of\s+\d+/i.test(vt)) return vt;
  const cands = Array.from(root.querySelectorAll('p,span,div,li,h2,h3')).filter((e) => e.childElementCount <= 2);
  for (const e of cands.slice(0, 600)) {
    const t = textOf(e);
    if (t.length <= 60 && /\bstep\s+\d+\s+of\s+\d+\b/i.test(t)) return t;
  }
  return null;
}
