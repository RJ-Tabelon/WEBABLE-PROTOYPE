// Owner: B (round 9). Paragraphs fitted to the person, from what their AI assistant knows about them.
//
// On a page once it is fitted (in parallel with Jev's read): collect the reading paragraphs (each link becomes a ⟦n⟧
// marker; the page's own anchors are kept) -> Jev scores every paragraph for this person (need, and which change) ->
// code takes at most 12 picks, first screen first -> gpt-5.4-mini rewrites them in batches of 4, 2 in flight -> the
// server's code and Jev check every rewrite, and code here checks links and numbers again -> each passing rewrite is
// swapped into its paragraph in place (clones of the page's anchors at the markers), with a thin green mark at the
// paragraph's left that flips between WebAble's words and the page's own.
//
// Never changes what the person is reading: in the first 4 s and before they click, type or scroll, a visible paragraph
// may change (one 220 ms fade, none under reduced motion); after that only one that is off screen (it waits until it
// leaves). Verify or roll back: a swap that ends up clipped or spilling out of its box puts the page's own nodes back.
// Off on pages with password or payment fields, on mail, chat and banking sites, and on pages not in English.

import type {
  BgRequest, LedgerEntry, ReaderProfile, RewordKind, RewordOut, RewordPage, RewordPara, RewordScore, RewordScoreResult,
  RewordWriteResult, RewordWritten,
} from '@webable/core';
import type { EngineState, RewordInline, RewordItem, RewordView } from '../contracts';
import { plainError } from './bus';
import { isExcludedHost } from './hosts';

export const MAX_PARAS = 40;
export const MAX_PICKS = 24;
export const BATCH = 4;
export const IN_FLIGHT = 3;
/** Before the person clicks, types or scrolls, and this soon after the page is fitted, a visible paragraph may change. */
export const APPLY_ANYWAY_MS = 6000;
export const FADE_MS = 220;
const SCORE_TIMEOUT_MS = 12_000;
const WRITE_TIMEOUT_MS = 28_000;

// Lower than a typical article paragraph so plain government pages count (irs.gov/refunds writes in 12–15 word
// paragraphs); Jev decides which of them need anything.
const MIN_WORDS = 12;
const MIN_CHARS = 70;
/** div and section blocks count only when they hold this much text (sites that don't use <p>). */
const LEAF_MIN_WORDS = 40;
const MAX_CHARS = 1800;
const MAX_LINK_SHARE = 0.5;

/** What a paragraph may hold: text and inline elements only (no controls, pictures or frames). */
const INLINE = new Set(['A', 'B', 'STRONG', 'EM', 'I', 'SPAN', 'SUP', 'SUB', 'ABBR', 'CODE', 'SMALL', 'BR', 'MARK', 'TIME', 'CITE', 'Q', 'U', 'S', 'FONT']);
/** Places that are not reading text, and WebAble's own UI (and paragraphs already rewritten). */
const SKIP_INSIDE = [
  'nav', 'header', 'footer', 'aside', 'form', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="complementary"]', '[contenteditable]:not([contenteditable="false"])', 'dialog', '[role="dialog"]',
  '[role="alertdialog"]', '[aria-modal="true"]', 'a[href]', 'webable-ui', '[data-wa-rw]',
].join(', ');
/** Where a paragraph hidden by a closed section (an accordion, a tab) still counts: the page's main content. */
const MAIN_CONTENT = 'main, [role="main"], article';

const MARK_RE = /⟦(\d{1,3})⟧/g;
const TITLE_NEW = 'Rewritten for you by WebAble. Click to see the original.';
const TITLE_OLD = 'The page’s own words. Click to see WebAble’s version.';

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ */
/* Collecting paragraphs                                               */
/* ------------------------------------------------------------------ */

export interface Candidate {
  id: string; // 'w<k>'
  el: HTMLElement;
  /** What the models see: each link replaced by ⟦n⟧, n from 1 in reading order. */
  text: string;
  /** What the person reads (link text in place). */
  plain: string;
  /** The page's own anchors, in marker order (⟦1⟧ is links[0]). */
  links: HTMLAnchorElement[];
}

export interface CollectOptions {
  doc?: Document;
  visible?: (el: Element) => boolean;
  isOurs?: (el: Element) => boolean;
  /** The k of the first id ('w<k>'); ids stay unique across pages of one document. */
  firstId?: number;
}

/** A candidate as the models get it; the link words let the writer place each ⟦n⟧ where it reads right. */
export function paraOf(c: Candidate): RewordPara {
  return {
    id: c.id,
    text: c.text,
    links: c.links.length,
    linkTexts: c.links.map((a) => (a.textContent ?? '').replace(/[⟦⟧]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)),
  };
}

interface Serialized { text: string; plain: string; links: HTMLAnchorElement[]; linkChars: number }

function inlineOnly(e: Element): boolean {
  for (const c of Array.from(e.getElementsByTagName('*'))) if (!INLINE.has(c.tagName.toUpperCase())) return false;
  return true;
}

/** The paragraph's text with ⟦n⟧ for each link, or null when it holds anything but text and inline elements. */
export function serialize(root: Element): Serialized | null {
  let text = '';
  let plain = '';
  let linkChars = 0;
  const links: HTMLAnchorElement[] = [];
  const walk = (node: Node): boolean => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === 3) {
        const t = (c as Text).data.replace(/[⟦⟧]/g, '');
        text += t;
        plain += t;
      } else if (c.nodeType === 1) {
        const e = c as Element;
        const tag = e.tagName.toUpperCase();
        if (!INLINE.has(tag)) return false;
        if (tag === 'BR') {
          text += ' ';
          plain += ' ';
        } else if (tag === 'A' && e.hasAttribute('href')) {
          if (!inlineOnly(e)) return false;
          const t = (e.textContent ?? '').replace(/[⟦⟧]/g, '');
          links.push(e as HTMLAnchorElement);
          text += `⟦${links.length}⟧`;
          plain += t;
          linkChars += squash(t).length;
        } else if (!walk(e)) return false;
      }
    }
    return true;
  };
  if (!walk(root)) return null;
  return { text: squash(text), plain: squash(plain), links, linkChars };
}

/**
 * Shown, or in the main content behind a closed section (an accordion or tab the person may open: changing it while
 * closed changes nothing they are reading). Never text hidden on purpose (display none on itself, screen-reader only).
 */
function defaultVisible(el: Element): boolean {
  const he = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  const shown = typeof he.checkVisibility !== 'function' || he.checkVisibility({ visibilityProperty: true });
  const r = el.getBoundingClientRect();
  if (shown && r.width >= 40 && r.height >= 8) return true;
  return behindClosedSection(el);
}

function behindClosedSection(el: Element): boolean {
  if (!el.closest(MAIN_CONTENT)) return false;
  try {
    if (getComputedStyle(el).display === 'none') return false;
  } catch {
    return false;
  }
  // hidden="until-found" accordions (irs.gov), closed <details>, or an ancestor that is display: none.
  const closed = el.parentElement?.closest('[hidden], details:not([open])');
  if (closed && closed.closest(MAIN_CONTENT)) return true;
  return el.getClientRects().length === 0;
}

/** Laid out where the person can see it (not behind a closed section). */
function laidOut(el: Element): boolean {
  const he = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (typeof he.checkVisibility === 'function' && !he.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}

/** Inside something fixed or sticky (a consent bar, a pinned panel): not reading text. */
function floating(el: Element): boolean {
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    try {
      const pos = getComputedStyle(e).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** The page's reading paragraphs, in document order, at most 40. English pages only. */
export function collectParagraphs(o: CollectOptions = {}): Candidate[] {
  const doc = o.doc ?? document;
  const lang = (doc.documentElement.getAttribute('lang') ?? '').trim().toLowerCase();
  if (lang && !lang.startsWith('en')) return [];
  const visible = o.visible ?? defaultVisible;
  const out: Candidate[] = [];
  let k = o.firstId ?? 1;
  const els = doc.body ? doc.body.querySelectorAll<HTMLElement>('p, div, section') : [];
  for (const el of Array.from(els)) {
    if (out.length >= MAX_PARAS) break;
    const isP = el.tagName.toUpperCase() === 'P';
    // Cheap tests first: most divs hold blocks.
    if (!isP && Array.from(el.children).some((c) => !INLINE.has(c.tagName.toUpperCase()))) continue;
    if ((el.textContent ?? '').length < MIN_CHARS) continue;
    const s = serialize(el);
    if (!s) continue;
    const words = s.plain ? s.plain.split(' ').length : 0;
    if (words < (isP ? MIN_WORDS : LEAF_MIN_WORDS) || s.plain.length < MIN_CHARS || s.text.length > MAX_CHARS) continue;
    if (s.linkChars / Math.max(1, s.plain.length) >= MAX_LINK_SHARE) continue;
    if (el.closest(SKIP_INSIDE)) continue;
    if (o.isOurs?.(el)) continue;
    if (!visible(el) || floating(el)) continue;
    out.push({ id: `w${k++}`, el, text: s.text, plain: s.plain, links: s.links });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pure rules (tested)                                                 */
/* ------------------------------------------------------------------ */

/** Whether a written paragraph may change now (never what the person is reading after they started). */
export function canSwapNow(o: { sinceStartMs: number; interacted: boolean; onScreen: boolean; calmOpen: boolean }): boolean {
  if (!o.interacted && o.sinceStartMs <= APPLY_ANYWAY_MS) return true;
  // The simplified page covers this one and WebAble can't tell what is on its screen: wait until it closes.
  if (o.calmOpen) return false;
  return !o.onScreen;
}

/** Picks in the order they are written: first-screen ones nearest the top first, then document order; at most `cap`. */
export function orderPicks<T extends { idx: number; top: number; bottom: number }>(items: T[], vh: number, cap = MAX_PICKS): T[] {
  const first = (x: T) => x.bottom > 0 && x.top < vh;
  const a = items.filter(first).sort((x, y) => Math.max(0, x.top) - Math.max(0, y.top) || x.idx - y.idx);
  const b = items.filter((x) => !first(x)).sort((x, y) => x.idx - y.idx);
  return [...a, ...b].slice(0, cap);
}

/** Numbers as written (thousands separators and trailing .0 ignored). */
export function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,.]*\d|\d/g) ?? []).map((x) => x.replace(/,/g, '').replace(/\.0+$/, ''));
}

/** Text and ⟦n⟧ markers, in order. */
export function pieces(s: string): Array<string | number> {
  const out: Array<string | number> = [];
  let last = 0;
  for (const m of s.matchAll(MARK_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(s.slice(last, at));
    out.push(Number(m[1]));
    last = at + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/**
 * Code's own check of a rewrite before it touches the page (the server's code and Jev checked it already): every link
 * marker exactly once and no others, some words, and every number of the original still there. Null when it passes.
 */
export function checkOut(out: RewordOut | null, links: number, original: string): string | null {
  if (!out || typeof out.lead !== 'string' || !Array.isArray(out.items) || out.items.some((x) => typeof x !== 'string')) return 'empty';
  const all = [out.lead, ...out.items].join(' ');
  const seen = new Map<number, number>();
  for (const m of all.matchAll(MARK_RE)) seen.set(Number(m[1]), (seen.get(Number(m[1])) ?? 0) + 1);
  for (let n = 1; n <= links; n++) if (seen.get(n) !== 1) return 'links';
  for (const n of seen.keys()) if (n < 1 || n > links) return 'links';
  const words = all.replace(MARK_RE, ' ');
  if (/[⟦⟧]/.test(words)) return 'links';
  if (!squash(words)) return 'empty';
  const has = new Set(numbersIn(words));
  for (const n of numbersIn(original.replace(MARK_RE, ' '))) if (!has.has(n)) return 'numbers';
  return null;
}

/* ------------------------------------------------------------------ */
/* Building the new words, and the mark                                */
/* ------------------------------------------------------------------ */

interface Built { nodes: Node[]; lead: RewordInline[]; items: RewordInline[][]; ordered: boolean }

function important(el: HTMLElement, styles: Record<string, string>): void {
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v, 'important');
}

/** New nodes for a rewrite: text nodes, and clones of the page's own anchors at each ⟦n⟧; a list for 'list'. */
export function buildNodes(doc: Document, out: RewordOut, anchors: HTMLAnchorElement[]): Built {
  const clones = anchors.map((a) => a.cloneNode(true) as HTMLAnchorElement);
  const put = (s: string, sink: Node[]): RewordInline[] => {
    const inl: RewordInline[] = [];
    for (const p of pieces(s)) {
      if (typeof p === 'string') {
        sink.push(doc.createTextNode(p));
        inl.push({ t: 'text', text: p });
      } else {
        const a = clones[p - 1];
        if (!a) continue;
        sink.push(a);
        inl.push({ t: 'link', el: a, text: squash(a.textContent ?? ''), href: a.getAttribute('href') });
      }
    }
    return inl;
  };
  const nodes: Node[] = [];
  const texts = out.items.map((x) => x.trim()).filter(Boolean);
  const leadText = out.lead.trim();
  const lead = put(texts.length && leadText ? `${leadText} ` : leadText, nodes);
  const items: RewordInline[][] = [];
  if (texts.length) {
    const list = doc.createElement(out.ordered ? 'ol' : 'ul');
    list.setAttribute('data-wa-rw-list', '');
    // Inline and important, so bullets and numbers show even on sites that reset lists.
    important(list, {
      display: 'block', 'list-style-type': out.ordered ? 'decimal' : 'disc', 'list-style-position': 'outside',
      'list-style-image': 'none', 'padding-left': '1.4em', 'margin-top': '.4em', 'margin-bottom': '.4em', 'margin-left': '0',
    });
    for (const t of texts) {
      const li = doc.createElement('li');
      important(li, { display: 'list-item', 'margin-top': '.2em', 'margin-bottom': '.2em' });
      const sink: Node[] = [];
      items.push(put(t, sink));
      li.append(...sink);
      list.append(li);
    }
    nodes.push(list);
  }
  return { nodes, lead, items, ordered: !!out.ordered };
}

const MARK_CSS = `
[data-wa-rw][data-wa-rw-rel]{position:relative !important}
[data-wa-rw][data-wa-rw-edge]{padding-left:16px !important}
[data-wa-rw-mark]{all:initial !important;font-size:inherit !important;display:block !important;position:absolute !important;
  left:-13px !important;top:.15em !important;bottom:.15em !important;width:3px !important;border-radius:2px !important;
  box-sizing:border-box !important;background:#17694A !important;cursor:pointer !important;z-index:1 !important;
  pointer-events:auto !important}
[data-wa-rw-edge]>[data-wa-rw-mark]{left:3px !important}
[data-wa-rw-mark][data-showing="original"]{background:transparent !important;border:1px solid #9C998F !important}
[data-wa-rw-mark]::before{content:"" !important;position:absolute !important;top:0 !important;bottom:0 !important;
  left:-8px !important;right:-7px !important}
@media (prefers-reduced-motion: no-preference){[data-wa-rw-mark]{transition:background-color .2s cubic-bezier(.2,.8,.2,1) !important}}
`;

let markSheet: CSSStyleSheet | null = null;
/** One adopted stylesheet for the marks (never CSS url()); put back if the page dropped it. */
function ensureSheet(doc: Document): void {
  try {
    if (!markSheet) {
      markSheet = new CSSStyleSheet();
      markSheet.replaceSync(MARK_CSS);
    }
    const cur = doc.adoptedStyleSheets;
    if (!cur.includes(markSheet)) doc.adoptedStyleSheets = [...cur, markSheet];
  } catch {
    /* no constructed sheets here: the swap still works, without the mark's look */
  }
}

function setMark(mark: HTMLElement, showing: 'new' | 'original'): void {
  mark.setAttribute('data-showing', showing);
  mark.title = showing === 'new' ? TITLE_NEW : TITLE_OLD;
}

/* ------------------------------------------------------------------ */
/* The runner                                                          */
/* ------------------------------------------------------------------ */

export type RewordState = NonNullable<EngineState['reword']>;

export interface RewordSummary {
  opId: string;
  /** The assistant the answer came from ('ChatGPT'), or 'your AI'. */
  source: string;
  looked: number; // paragraphs Jev read for this person
  picked: number; // paragraphs Jev picked
  changed: number; // rewrites that passed every check and are (or will be) on the page
  failed: number; // rewrites that kept the page's own words because a check failed
  overCap: number; // picks left as they are (at most 12 a page)
  ms: number;
}

export interface RewordHost {
  ask<T>(req: BgRequest, timeoutMs?: number): Promise<T>;
  isOurs(el: Element): boolean;
  /** Password or payment fields on the page. */
  sensitive(): boolean;
  /** Jev's page purpose when already known. */
  purpose(): string | null;
  calmOpen(): boolean;
  reducedMotion(): boolean;
  publish(s: RewordState): void;
  log(e: Omit<LedgerEntry, 'at'>): void;
  /** Every write for this page is finished (the controller adds the one ledger entry and the toast). */
  finished(s: RewordSummary): void;
  /** Tests: which paragraphs count as visible (default: has a box and isn't hidden). */
  visible?: (el: Element) => boolean;
  /** Tests: the layout check after a swap (default: not clipped, not spilling out of its box). */
  layoutOk?: (el: HTMLElement, before: LayoutBefore) => boolean;
}

interface Entry extends RewordItem {
  cand: Candidate;
  /** Document order on its page. */
  idx: number;
  kind: RewordKind | null;
  out: RewordOut | null;
  showing: 'new' | 'original';
  /** The paragraph's own child nodes exactly as the page had them (taken at the swap). */
  orig: Node[] | null;
  built: Built | null;
  mark: HTMLElement | null;
  /** WebAble's words or the page's (with the mark) are in the paragraph now. */
  attached: boolean;
  /** Written and checked, waiting to be swapped in. */
  pending: boolean;
  /** Our attributes on the paragraph. */
  rel: boolean;
  edge: boolean;
}

export interface RewordRunner {
  /** Run on the page as it is now (after it is fitted). */
  start(): Promise<void>;
  /** A same-document navigation: stop this page's run; keep rewrites whose paragraphs are still in the document. */
  newPage(): void;
  /** WebAble turned off or paused: every paragraph back to the page's own nodes, nothing kept. */
  reset(): void;
  /** "Original page": the untouched page, marks and all (true), or WebAble's version again (false). */
  pageOriginal(on: boolean): void;
  showOriginalWords(on: boolean): void;
  toggleParagraph(id: string): void;
  rewordFor(node: Node): RewordView | null;
  elementFor(id: string): Element | null;
  /** The simplified page closed: paragraphs waiting on it may change once they are off screen. */
  calmClosed(): void;
  ownsOp(opId: string): boolean;
  lastSummary(): RewordSummary | null;
  dispose(): void;
}

export interface LayoutBefore {
  clips: Array<{ el: Element; x: boolean; y: boolean; overX: boolean; overY: boolean }>;
  overX: boolean;
  overY: boolean;
}

const SLACK = 2;

function layoutBefore(el: HTMLElement): LayoutBefore {
  const clips: LayoutBefore['clips'] = [];
  let e: Element | null = el;
  for (let i = 0; e && i < 8 && e !== document.body && e !== document.documentElement; i++, e = e.parentElement) {
    const cs = getComputedStyle(e);
    const x = /hidden|clip/.test(cs.overflowX);
    const y = /hidden|clip/.test(cs.overflowY);
    if (x || y) clips.push({ el: e, x, y, overX: e.scrollWidth > e.clientWidth + SLACK, overY: e.scrollHeight > e.clientHeight + SLACK });
  }
  return { clips, overX: el.scrollWidth > el.clientWidth + SLACK, overY: el.scrollHeight > el.clientHeight + SLACK };
}

/** After a swap: no clipping box newly overflows or cuts the paragraph off, and the paragraph doesn't spill out of its box. */
function defaultLayoutOk(el: HTMLElement, before: LayoutBefore): boolean {
  if (!before.overX && el.scrollWidth > el.clientWidth + SLACK) return false;
  if (!before.overY && el.scrollHeight > el.clientHeight + SLACK) return false;
  const r = el.getBoundingClientRect();
  for (const c of before.clips) {
    if (!c.el.isConnected) continue;
    if (c.x && !c.overX && c.el.scrollWidth > c.el.clientWidth + SLACK) return false;
    if (c.y && !c.overY && c.el.scrollHeight > c.el.clientHeight + SLACK) return false;
    if (c.el === el) continue;
    const b = c.el.getBoundingClientRect();
    if (c.y && r.bottom > b.bottom + SLACK) return false;
    if (c.x && r.right > b.right + SLACK) return false;
  }
  return true;
}

const ZERO_HOW: Record<RewordKind | 'keep', number> = { keep: 1, plain: 0, list: 0, shorter: 0, point_first: 0 };

function snippetOf(plain: string): string {
  const words = plain.split(' ');
  return words.length > 10 ? `${words.slice(0, 10).join(' ')}…` : plain;
}

function isScoreResult(x: unknown): x is RewordScoreResult {
  return !!x && typeof x === 'object' && Array.isArray((x as RewordScoreResult).scores);
}

function isWriteResult(x: unknown): x is RewordWriteResult {
  return !!x && typeof x === 'object' && Array.isArray((x as RewordWriteResult).results);
}

export function createReword(host: RewordHost): RewordRunner {
  const entries = new Map<string, Entry>();
  const byEl = new WeakMap<Element, string>();
  let order: string[] = [];
  let status: RewordState['status'] = 'off';
  let source: string | null = null;
  let version = 0;
  let run = 0;
  let nextK = 1;
  let startedAt = 0;
  let interacted = false;
  let pageOriginalOn = false;
  /** The person asked for the page's own words (Undo, or the sheet): later rewrites arrive showing them too. */
  let wordsOriginal = false;
  let summary: RewordSummary | null = null;
  const ops = new Set<string>();
  let io: IntersectionObserver | null = null;
  let listening = false;

  const now = () => performance.now();

  const publish = () => {
    version++;
    const applied = [...entries.values()].filter((e) => e.state === 'rewritten' || e.state === 'original');
    host.publish({
      status,
      source,
      items: order.map((id) => entries.get(id)).filter((e): e is Entry => !!e).map((e) => {
        const item: RewordItem = { id: e.id, need: e.need, how: e.how, pick: e.pick, state: e.state, snippet: e.snippet };
        if (e.reason) item.reason = e.reason;
        return item;
      }),
      showingOriginal: pageOriginalOn || (applied.length > 0 && applied.every((e) => e.showing === 'original')),
      version,
    });
  };

  const onInteract = (e: Event) => {
    if (e.isTrusted) interacted = true;
  };
  const INTERACT = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  const listen = () => {
    if (listening) return;
    listening = true;
    for (const t of INTERACT) window.addEventListener(t, onInteract, { capture: true, passive: true });
  };

  const onScreen = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    const vh = document.documentElement.clientHeight || innerHeight;
    const vw = document.documentElement.clientWidth || innerWidth;
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && (r.width > 0 || r.height > 0);
  };

  /* ---------------- the DOM side ---------------- */

  /** Put WebAble's words (or, with the mark, the page's own) into the paragraph. */
  const attach = (e: Entry, showing: 'new' | 'original') => {
    if (!e.built || !e.orig || !e.mark) return;
    ensureSheet(document);
    const el = e.cand.el;
    el.setAttribute('data-wa-rw', e.id);
    if (e.rel) el.setAttribute('data-wa-rw-rel', '');
    if (e.edge) el.setAttribute('data-wa-rw-edge', '');
    el.replaceChildren(...(showing === 'new' ? e.built.nodes : e.orig), e.mark);
    setMark(e.mark, showing);
    e.showing = showing;
    e.attached = true;
  };

  /** The page's own nodes back, exactly, and none of WebAble's attributes. */
  const detach = (e: Entry) => {
    if (!e.attached || !e.orig) return;
    const el = e.cand.el;
    el.replaceChildren(...e.orig);
    el.removeAttribute('data-wa-rw');
    el.removeAttribute('data-wa-rw-rel');
    el.removeAttribute('data-wa-rw-edge');
    e.attached = false;
  };

  const fail = (e: Entry, reason: string) => {
    e.state = 'failed';
    e.reason = reason;
    e.pending = false;
  };

  /** Swap a written paragraph in, check the layout, roll back if it broke. */
  const swap = (e: Entry, fade: boolean): void => {
    e.pending = false;
    io?.unobserve(e.cand.el);
    const el = e.cand.el;
    if (!el.isConnected || !e.out) return fail(e, 'gone');
    // The page may have changed this paragraph since it was read.
    const cur = serialize(el);
    if (!cur || cur.text !== e.cand.text) return fail(e, 'changed');
    e.orig = Array.from(el.childNodes);
    e.built = buildNodes(document, e.out, cur.links);
    if (!e.mark) {
      const mark = document.createElement('span');
      mark.setAttribute('data-wa-rw-mark', e.id);
      mark.setAttribute('aria-hidden', 'true');
      mark.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleParagraph(e.id);
      });
      e.mark = mark;
    }
    let cs: CSSStyleDeclaration | null = null;
    try {
      cs = getComputedStyle(el);
    } catch {
      cs = null;
    }
    e.rel = !cs || cs.position === 'static' || !cs.position;
    // Keep the mark visible on paragraphs at the window's left edge, or that clip their own overflow.
    // Behind a closed section (an accordion) the paragraph has no real layout to read or check.
    const shown = laidOut(el);
    e.edge = shown && (el.getBoundingClientRect().left < 18 || (!!cs && /hidden|clip/.test(cs.overflowX)));
    const checkable = shown || !!host.layoutOk;
    const before = layoutBefore(el);
    attach(e, 'new');
    if (checkable && !(host.layoutOk ?? defaultLayoutOk)(el, before)) {
      detach(e);
      fail(e, 'layout');
      host.log({
        source: 'check',
        title: `Kept a paragraph in the page’s own words: the new version didn’t fit its space`,
        detail: `“${e.snippet}” The rewrite was clipped or spilled out of its box, so the page’s own words came back.`,
        action: 'reversed',
      });
      return;
    }
    e.state = 'rewritten';
    if (wordsOriginal) {
      attach(e, 'original');
      e.state = 'original';
      return;
    }
    if (fade && !host.reducedMotion() && typeof el.animate === 'function') {
      try {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
      } catch {
        /* no fade */
      }
    }
  };

  const observer = (): IntersectionObserver | null => {
    if (io || typeof IntersectionObserver === 'undefined') return io;
    io = new IntersectionObserver((list) => {
      let changed = false;
      for (const it of list) {
        const id = byEl.get(it.target);
        const e = id ? entries.get(id) : undefined;
        if (!e || !e.pending) {
          io?.unobserve(it.target);
          continue;
        }
        if (it.isIntersecting || host.calmOpen() || pageOriginalOn) continue;
        swap(e, false);
        changed = true;
      }
      if (changed) publish();
    });
    return io;
  };

  /** A written, checked paragraph: swap it now if the person isn't reading it, else when it leaves the screen. */
  const place = (e: Entry): void => {
    if (pageOriginalOn) {
      e.pending = true;
      return;
    }
    const el = e.cand.el;
    const vis = onScreen(el);
    if (canSwapNow({ sinceStartMs: now() - startedAt, interacted, onScreen: vis, calmOpen: host.calmOpen() })) {
      swap(e, vis && !host.calmOpen());
      return;
    }
    e.pending = true;
    observer()?.observe(el);
  };

  /* ---------------- the run ---------------- */

  const writeBatch = async (my: number, page: RewordPage, batch: Entry[]): Promise<'ok' | 'down'> => {
    let res: RewordWriteResult;
    try {
      const got = await host.ask<unknown>({
        type: 'rewordWrite',
        req: { page, items: batch.map((e) => ({ ...paraOf(e.cand), kind: e.kind as RewordKind })) },
      }, WRITE_TIMEOUT_MS);
      if (!isWriteResult(got)) throw new Error('Unexpected answer');
      res = got;
    } catch {
      if (my !== run) return 'down';
      for (const e of batch) fail(e, 'llm_unavailable');
      publish();
      return 'down';
    }
    if (my !== run) return 'ok';
    const got = new Map<string, RewordWritten>(res.results.map((w) => [w.id, w] as const));
    for (const e of batch) {
      const w = got.get(e.id);
      if (!w) fail(e, 'llm_unavailable');
      else if (!w.ok || !w.out) fail(e, w.reason || 'check_unavailable');
      else {
        const bad = checkOut(w.out, e.cand.links.length, e.cand.text);
        if (bad) fail(e, bad);
        else {
          e.out = w.out;
          place(e);
        }
      }
    }
    publish();
    return 'ok';
  };

  async function start(): Promise<void> {
    const my = ++run;
    startedAt = now();
    interacted = false;
    listen();
    io?.disconnect();
    io = null;
    prune();
    let host0 = '';
    try {
      host0 = location.hostname;
    } catch {
      host0 = '';
    }
    if (host.sensitive() || isExcludedHost(host0)) {
      status = 'off';
      publish();
      return;
    }
    let reader: ReaderProfile | null = null;
    try {
      reader = await host.ask<ReaderProfile | null>({ type: 'getReader' }, 3000);
    } catch {
      reader = null;
    }
    if (my !== run) return;
    if (!reader || !Array.isArray(reader.points) || !reader.points.some((p) => p.on)) {
      status = 'off';
      publish();
      return;
    }
    source = reader.source || 'your AI';
    const cands = collectParagraphs({ visible: host.visible, isOurs: host.isOurs, firstId: nextK });
    nextK += cands.length;
    if (cands.length < 2) {
      status = 'off';
      publish();
      return;
    }
    const t0 = now();
    const fresh: Entry[] = cands.map((c, idx) => ({
      id: c.id, need: 0, how: { ...ZERO_HOW }, pick: null, state: 'kept', snippet: snippetOf(c.plain),
      cand: c, idx, kind: null, out: null, showing: 'new', orig: null, built: null, mark: null,
      attached: false, pending: false, rel: false, edge: false,
    }));
    for (const e of fresh) {
      entries.set(e.id, e);
      byEl.set(e.cand.el, e.id);
    }
    order = [...order, ...fresh.map((e) => e.id)];
    status = 'scoring';
    publish();

    let page: RewordPage = { title: document.title.slice(0, 200), host: host0, purpose: host.purpose() };
    let scores: RewordScore[];
    try {
      const paras: RewordPara[] = cands.map(paraOf);
      const got = await host.ask<unknown>({ type: 'rewordScore', req: { page, paras } }, SCORE_TIMEOUT_MS);
      if (!isScoreResult(got)) throw new Error('Unexpected answer from Jev');
      scores = got.scores;
    } catch (err) {
      if (my !== run) return;
      status = 'error';
      publish();
      host.log({ source: 'jev', title: 'Couldn’t rewrite paragraphs for you right now; the page keeps its own words', detail: plainError(err), action: 'skipped' });
      return;
    }
    if (my !== run) return;
    const byId = new Map(scores.map((s) => [s.id, s] as const));
    for (const e of fresh) {
      const s = byId.get(e.id);
      if (!s) continue;
      e.need = typeof s.need === 'number' ? s.need : 0;
      e.how = { ...ZERO_HOW, ...(s.how ?? {}) };
      e.pick = s.pick ?? null;
    }
    const picked = fresh.filter((e) => e.pick);
    const vh = document.documentElement.clientHeight || innerHeight;
    const ordered = orderPicks(picked.map((e) => {
      const r = e.cand.el.getBoundingClientRect();
      return { e, idx: e.idx, top: r.top, bottom: r.bottom };
    }), vh).map((x) => x.e);
    const chosen = new Set(ordered);
    for (const e of picked) {
      if (chosen.has(e)) {
        e.state = 'waiting';
        e.kind = e.pick;
      } else e.reason = 'limit';
    }
    if (!ordered.length) {
      status = 'none';
      publish();
      summary = { opId: `reword-${my}`, source, looked: fresh.length, picked: 0, changed: 0, failed: 0, overCap: 0, ms: Math.round(now() - t0) };
      host.finished(summary);
      return;
    }
    status = 'writing';
    publish();
    // Jev may have answered the page's purpose by now.
    page = { ...page, purpose: page.purpose ?? host.purpose() };
    const batches: Entry[][] = [];
    for (let i = 0; i < ordered.length; i += BATCH) batches.push(ordered.slice(i, i + BATCH));
    let next = 0;
    let down = 0;
    const worker = async () => {
      while (next < batches.length && my === run) {
        const b = batches[next++];
        if (b && (await writeBatch(my, page, b)) === 'down') down++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, batches.length) }, () => worker()));
    if (my !== run) return;
    const changed = ordered.filter((e) => e.state === 'rewritten' || e.state === 'original' || (e.pending && e.out)).length;
    const failed = ordered.filter((e) => e.state === 'failed').length;
    if (down === batches.length) {
      status = 'error';
      publish();
      host.log({ source: 'jev', title: 'Couldn’t rewrite paragraphs for you right now; the page keeps its own words', detail: 'The WebAble server could not write the new versions.', action: 'skipped' });
      return;
    }
    status = changed ? 'done' : 'none';
    publish();
    const opId = `reword-${my}`;
    ops.add(opId);
    summary = { opId, source, looked: fresh.length, picked: picked.length, changed, failed, overCap: picked.length - ordered.length, ms: Math.round(now() - t0) };
    host.finished(summary);
  }

  /** Keep only rewrites still on the page (a new page's paragraphs get new ids). */
  function prune(): void {
    for (const [id, e] of [...entries]) {
      if (e.cand.el.isConnected && (e.state === 'rewritten' || e.state === 'original')) continue;
      detach(e);
      entries.delete(id);
    }
    order = order.filter((id) => entries.has(id));
  }

  function newPage(): void {
    run++;
    io?.disconnect();
    io = null;
    summary = null;
    wordsOriginal = false;
    prune();
    status = entries.size ? status : 'off';
    publish();
  }

  function reset(): void {
    run++;
    io?.disconnect();
    io = null;
    for (const e of entries.values()) detach(e);
    entries.clear();
    order = [];
    status = 'off';
    summary = null;
    pageOriginalOn = false;
    wordsOriginal = false;
    publish();
  }

  function pageOriginal(on: boolean): void {
    if (on === pageOriginalOn) return;
    pageOriginalOn = on;
    for (const e of entries.values()) {
      if (on) detach(e);
      else if (e.state === 'rewritten' || e.state === 'original') attach(e, e.showing);
    }
    if (!on) for (const e of entries.values()) if (e.pending && e.out) place(e);
    publish();
  }

  function showOriginalWords(on: boolean): void {
    wordsOriginal = on;
    let any = false;
    for (const e of entries.values()) {
      if (e.state !== 'rewritten' && e.state !== 'original') continue;
      any = true;
      e.state = on ? 'original' : 'rewritten';
      e.showing = on ? 'original' : 'new';
      if (!pageOriginalOn) attach(e, e.showing);
    }
    if (any) publish();
  }

  function toggleParagraph(id: string): void {
    const e = entries.get(id);
    if (!e || (e.state !== 'rewritten' && e.state !== 'original')) return;
    const next = e.showing === 'new' ? 'original' : 'new';
    e.showing = next;
    e.state = next === 'new' ? 'rewritten' : 'original';
    if (!pageOriginalOn) attach(e, next);
    publish();
  }

  function rewordFor(node: Node): RewordView | null {
    const start = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const p = start?.closest('[data-wa-rw]');
    if (!p) return null;
    const id = byEl.get(p) ?? p.getAttribute('data-wa-rw');
    const e = id ? entries.get(id) : undefined;
    if (!e || !e.built || !e.attached || !e.kind || (e.state !== 'rewritten' && e.state !== 'original')) return null;
    return { id: e.id, kind: e.kind, showing: e.showing, lead: e.built.lead, items: e.built.items, ordered: e.built.ordered };
  }

  return {
    start,
    newPage,
    reset,
    pageOriginal,
    showOriginalWords,
    toggleParagraph,
    rewordFor,
    elementFor: (id) => entries.get(id)?.cand.el ?? null,
    calmClosed: () => {
      if (!io) return;
      // A fresh look at each waiting paragraph (the observer only speaks when something changes).
      for (const e of entries.values()) {
        if (!e.pending) continue;
        io.unobserve(e.cand.el);
        io.observe(e.cand.el);
      }
    },
    ownsOp: (opId) => ops.has(opId),
    lastSummary: () => summary,
    dispose: () => {
      reset();
      if (listening) for (const t of INTERACT) window.removeEventListener(t, onInteract, { capture: true });
      listening = false;
    },
  };
}
