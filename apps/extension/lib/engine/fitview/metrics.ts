import { HOST_TAG } from '../util/dom';

/**
 * The restructure scorecard (docs/11 §4): one function measures a surface,
 * the original page (its Document, before Fit view opens) and Fit view (its
 * shadow root), with the same definitions, so before and after compare like
 * with like. Everything is read from layout and computed style; no page text
 * leaves this function, only counts.
 *
 *   itemsInView         visible text blocks, images and controls intersecting
 *                       the first screen (a link inside running text is part
 *                       of its text block, not an item of its own; the
 *                       view's own strip controls are counted apart)
 *   choicesInView       visible interactive controls in the first screen,
 *                       except links inside running text (reading, counted
 *                       as inlineLinks) and the view's own strip controls
 *                       (counted as ownChoicesInView)
 *   inlineLinks         links inside running text in the first screen
 *   ownChoicesInView    Fit view's own strip controls in the first screen
 *                       (Text −, Text +, Original page, More)
 *   textStyles          distinct font-size x weight pairs over all visible text
 *   adsInView           visible ad or sponsored slots in the first screen
 *   moving              running animations, playing media, carousels
 *   mainStartShare      top of the primary content / viewport height
 *   maxGroup            most records between two group breaks (a record
 *                       is a repeated, titled box no taller than the screen)
 *   recordsBeforeMore   records rendered in the largest list before anything
 *                       folds the rest away
 *   templateMismatches  records whose fields come in another order, or at a
 *                       text size the rest of their list does not use
 *   belowFloorText      visible text blocks below F (when F is given)
 *   belowTargetControls visible controls below T in either side (inline links
 *                       inside running text are exempt, WCAG 2.5.8)
 *
 * "Text block" is the element that styles a run of text: the nearest
 * ancestor of a text node that is not display:inline (a paragraph, a
 * heading, a button). Inline emphasis inside a paragraph is part of that
 * paragraph, not a style of its own.
 */

export interface SurfaceViewport {
  width: number;
  height: number;
}

export interface SurfaceOptions {
  /** The person's body size (CSS px at 100%): counts text below it. */
  F?: number;
  /** The person's target size: counts controls below it. */
  T?: number;
  /** Device px per CSS px on this surface (tab zoom), default 1. */
  zoom?: number;
  /** The primary content; default `[data-primary]`, then main / role=main. */
  primary?: Element | null;
  /** Also say which controls are small and which records break their list (local report). */
  explain?: boolean;
  /** Selector for the surface's own controls (Fit view's strip), counted apart from the page's choices. */
  own?: string;
}

/** What `explain` adds: short element descriptions, never page text beyond a few words. */
export interface SurfaceExplain {
  smallControls: string[];
  mismatched: string[][];
  /** The items in the first screen, as tag.class. */
  items: string[];
}

export interface SurfaceMetrics {
  itemsInView: number;
  choicesInView: number;
  inlineLinks: number;
  ownChoicesInView: number;
  textStyles: number;
  adsInView: number;
  moving: number;
  mainStartShare: number | null;
  maxGroup: number;
  recordsBeforeMore: number;
  templateMismatches: number;
  belowFloorText: number | null;
  belowTargetControls: number | null;
  explain?: SurfaceExplain;
}

const SKIP_TAGS = new Set([
  HOST_TAG,
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'title',
  'meta',
  'link',
]);

export const CHOICE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[contenteditable="true"]',
].join(',');

const MEDIA_SELECTOR = 'img, svg, video, canvas, picture, [role="img"]';

/** Words that mark an ad slot when they are an element's whole text. */
const AD_WORDS =
  /^(sponsored|ad|ads|advertisement|promoted|anzeige|publicité)$/i;
const AD_SELECTOR = [
  'iframe[src*="doubleclick"]',
  'iframe[src*="googlesyndication"]',
  'iframe[src*="amazon-adsystem"]',
  'iframe[id^="google_ads"]',
  '[id^="div-gpt-ad"]',
  'ins.adsbygoogle',
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  '[data-ad-slot]',
  '[data-adunit]',
  '[data-component-type="sp-sponsored-result"]',
].join(',');

type Root = Document | ShadowRoot;

function viewOf(root: Root): Window {
  const doc = root instanceof Document ? root : root.ownerDocument;
  return doc.defaultView ?? window;
}

type Vis = Element & {
  checkVisibility?: (o?: Record<string, boolean>) => boolean;
};

/** Rendered with a box, not visibility:hidden, not fully transparent. */
function shown(el: Element): boolean {
  const v = el as Vis;
  if (
    typeof v.checkVisibility === 'function' &&
    !v.checkVisibility({ visibilityProperty: true, opacityProperty: true })
  )
    return false;
  const r = el.getBoundingClientRect();
  return r.width >= 1 && r.height >= 1;
}

function inView(r: DOMRect, vp: SurfaceViewport): boolean {
  return r.bottom > 0 && r.right > 0 && r.top < vp.height && r.left < vp.width;
}

/** Every element of the surface, shadow trees included, in document order. */
function* elements(root: Root): Generator<Element> {
  const stack: Element[] = [];
  const top =
    root instanceof Document
      ? root.documentElement
        ? [root.documentElement]
        : []
      : Array.from(root.children);
  for (let i = top.length - 1; i >= 0; i--) stack.push(top[i] as Element);
  while (stack.length) {
    const el = stack.pop() as Element;
    if (SKIP_TAGS.has(el.localName)) continue;
    yield el;
    const kids = Array.from(
      (el.shadowRoot && el.shadowRoot.mode === 'open' ? el.shadowRoot : el)
        .children,
    );
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as Element);
  }
}

function hasOwnText(el: Element): boolean {
  for (const n of Array.from(el.childNodes))
    if (n.nodeType === 3 && /\S/.test(n.nodeValue ?? '')) return true;
  return false;
}

/** The element that styles a text node: the nearest non-inline ancestor. */
function textOwner(el: Element, view: Window): Element {
  let cur: Element | null = el;
  while (cur) {
    const d = view.getComputedStyle(cur).display;
    if (d !== 'inline' && d !== 'contents') return cur;
    const parent: Element | null =
      cur.parentElement ??
      ((cur.parentNode as ShadowRoot | null)?.host as Element | undefined) ??
      null;
    if (!parent) return cur;
    cur = parent;
  }
  return el;
}

function isChoice(el: Element): boolean {
  if (!el.matches(CHOICE_SELECTOR)) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if (
    el.getAttribute('tabindex') === '-1' &&
    !el.matches('input, select, textarea')
  )
    return false;
  if ((el as HTMLButtonElement).disabled === true) return false;
  return true;
}

/** An inline link inside running text (exempt from the target size rule). */
function inlineInText(el: Element, view: Window): boolean {
  if (view.getComputedStyle(el).display !== 'inline') return false;
  const owner = textOwner(el, view);
  if (owner === el) return false;
  const own = (el.textContent ?? '').trim().length;
  return (owner.textContent ?? '').trim().length > own + 10;
}

function signature(el: Element): string {
  const cls = Array.from(el.classList)
    .filter((c) => !/^(is-|has-|active|selected|hover|focus)/.test(c))
    .sort()
    .join('.');
  return `${el.localName}.${cls}`;
}

interface Run {
  parent: Element;
  members: Element[];
}

/**
 * A record-like element: a title to open (a heading, or a link set as its
 * own block, not a link inside running text) and more than one thing to
 * read. A bulleted list of sentences with links in them is text, not records.
 */
function recordLike(el: Element, view: Window): boolean {
  const r = el.getBoundingClientRect();
  if (r.height < 20 || r.width < 40) return false;
  const titled =
    el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]') !== null ||
    Array.from(el.querySelectorAll('a[href]')).some(
      (a) => view.getComputedStyle(a).display !== 'inline',
    );
  if (!titled) return false;
  let owners = 0;
  let media = 0;
  const seen = new Set<Element>();
  const walk = (n: Element): void => {
    for (const c of Array.from(n.children)) {
      if (SKIP_TAGS.has(c.localName)) continue;
      if (c.matches(MEDIA_SELECTOR) && shown(c)) {
        media++;
        continue;
      }
      if (hasOwnText(c) && shown(c)) {
        const o = textOwner(c, view);
        if (!seen.has(o)) {
          seen.add(o);
          owners++;
        }
      }
      walk(c);
    }
  };
  if (hasOwnText(el)) owners++;
  walk(el);
  return owners >= 2 || (owners >= 1 && media >= 1);
}

/**
 * Runs of 3 or more consecutive, visible, same-signature record-like
 * siblings. A box taller than the screen is a part of the page (an
 * article, a section), not a record, and ends a run.
 */
function recordRuns(root: Root, view: Window, screenH: number): Run[] {
  const runs: Run[] = [];
  for (const el of elements(root)) {
    const kids = Array.from(el.children).filter(
      (k) => !SKIP_TAGS.has(k.localName),
    );
    if (kids.length < 3) continue;
    let cur: Element[] = [];
    let sig = '';
    const flush = (): void => {
      if (cur.length >= 3) runs.push({ parent: el, members: cur });
      cur = [];
    };
    for (const k of kids) {
      if (!shown(k)) continue;
      if (k.getBoundingClientRect().height > screenH) {
        flush();
        sig = '';
        continue;
      }
      const s = signature(k);
      if (s !== sig) {
        flush();
        sig = s;
      }
      cur.push(k);
    }
    flush();
  }
  // Only runs of records (not nav links, not pills).
  const records = runs.filter((run) => {
    const sample = run.members.slice(0, 4);
    return (
      sample.filter((m) => recordLike(m, view)).length >=
      Math.ceil(sample.length / 2)
    );
  });
  // A run of boxes that hold runs (groups of records) is not itself a list.
  return records.filter(
    (run) =>
      !records.some(
        (o) => o !== run && run.members.some((m) => m.contains(o.parent)),
      ),
  );
}

/** Runs whose parents are consecutive same-signature siblings form one list. */
function lists(runs: Run[]): Run[][] {
  const byParent = new Map<Element, Run[]>();
  for (const r of runs) {
    const l = byParent.get(r.parent);
    if (l) l.push(r);
    else byParent.set(r.parent, [r]);
  }
  const out: Run[][] = [];
  const used = new Set<Element>();
  for (const [parent, rs] of byParent) {
    if (used.has(parent)) continue;
    used.add(parent);
    const group = [...rs];
    const sig = signature(parent);
    for (
      let s = parent.nextElementSibling;
      s && signature(s) === sig;
      s = s.nextElementSibling
    ) {
      const more = byParent.get(s);
      if (!more) continue;
      used.add(s);
      group.push(...more);
    }
    out.push(group);
  }
  return out;
}

/** A record's fields: media and text blocks in order, by kind and size. */
function fields(rec: Element, view: Window): string[] {
  const out: string[] = [];
  const seen = new Set<Element>();
  const walk = (n: Element): void => {
    for (const c of Array.from(n.children)) {
      if (SKIP_TAGS.has(c.localName) || !shown(c)) continue;
      if (c.matches(MEDIA_SELECTOR)) {
        if (out[out.length - 1] !== 'm') out.push('m');
        continue;
      }
      if (hasOwnText(c)) {
        const o = textOwner(c, view);
        if (!seen.has(o)) {
          seen.add(o);
          const kind = o.closest('a[href], button') ? 'c' : 't';
          const px = Math.round(parseFloat(view.getComputedStyle(o).fontSize));
          const tok = `${kind}${px}`;
          if (out[out.length - 1] !== tok) out.push(tok);
        }
      }
      walk(c);
    }
  };
  walk(rec);
  return out;
}

/**
 * Records that break their list's template: a pair of fields in the opposite
 * order from most records, or a lead field (the first link, the first text)
 * at another size than in most records. A field some records simply lack is
 * not a mismatch.
 */
export function templateMismatches(records: string[][]): number {
  if (records.length < 3) return 0;
  const before = new Map<string, number>();
  const lead = new Map<string, Map<string, number>>();
  const leadOf = (toks: string[]): Map<string, string> => {
    const out = new Map<string, string>();
    for (const t of toks) {
      const kind = t[0] as string;
      if (t !== 'm' && !out.has(kind)) out.set(kind, t);
    }
    return out;
  };
  for (const r of records) {
    const toks = [...new Set(r)];
    for (const [kind, t] of leadOf(toks)) {
      let m = lead.get(kind);
      if (!m) lead.set(kind, (m = new Map()));
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    for (let i = 0; i < toks.length; i++)
      for (let j = i + 1; j < toks.length; j++) {
        const a = toks[i] as string;
        const b = toks[j] as string;
        before.set(`${a}<${b}`, (before.get(`${a}<${b}`) ?? 0) + 1);
      }
  }
  const usual = new Map<string, string>();
  for (const [kind, m] of lead) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) usual.set(kind, best[0]);
  }
  let bad = 0;
  for (const r of records) {
    const toks = [...new Set(r)];
    let off = false;
    for (const [kind, t] of leadOf(toks)) if (usual.get(kind) !== t) off = true;
    for (let i = 0; i < toks.length && !off; i++)
      for (let j = i + 1; j < toks.length; j++) {
        const a = toks[i] as string;
        const b = toks[j] as string;
        const ab = before.get(`${a}<${b}`) ?? 0;
        const ba = before.get(`${b}<${a}`) ?? 0;
        if (ba > ab) {
          off = true;
          break;
        }
      }
    if (off) bad++;
  }
  return bad;
}

function describeEl(el: Element | null): string {
  return el
    ? `${el.localName}.${Array.from(el.classList).slice(0, 2).join('.')}`
    : '';
}

function topOf(el: Element): number {
  return el.getBoundingClientRect().top;
}

export function measureSurface(
  root: Root,
  viewport: SurfaceViewport,
  opts: SurfaceOptions = {},
): SurfaceMetrics {
  const view = viewOf(root);
  const z = opts.zoom && opts.zoom > 0 ? opts.zoom : 1;
  const items = new Set<Element>();
  const styles = new Set<string>();
  const small = new Set<Element>();
  const choices: Element[] = [];
  let adsInView = 0;
  const adEls: Element[] = [];
  let moving = 0;
  for (const el of elements(root)) {
    const isMedia = el.matches(MEDIA_SELECTOR);
    const choice = isChoice(el);
    const own = hasOwnText(el);
    // The surface's own controls are counted apart, not as page items.
    const mine = opts.own ? el.closest(opts.own) !== null : false;
    if (!isMedia && !choice && !own && !el.matches(AD_SELECTOR)) {
      if (el.localName !== 'video' && el.localName !== 'marquee') continue;
    }
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const here = inView(r, viewport);
    if (own) {
      const o = textOwner(el, view);
      const ob = o.getBoundingClientRect();
      // Screen-reader-only text (a 1 px box) is not on screen.
      if (ob.width < 2 || ob.height < 2) continue;
      if (here && !mine) items.add(o);
      if (here && AD_WORDS.test((el.textContent ?? '').trim())) adEls.push(el);
      // The text's own size; emphasis inside a block at the block's size is
      // part of the block's style, not a style of its own.
      const cs = view.getComputedStyle(el);
      const px = parseFloat(cs.fontSize);
      if (px > 0) {
        let weight = cs.fontWeight;
        if (o !== el) {
          const os = view.getComputedStyle(o);
          if (Math.round(parseFloat(os.fontSize)) === Math.round(px))
            weight = os.fontWeight;
        }
        styles.add(`${Math.round(px)}x${weight}`);
        if (opts.F && px * z < opts.F - 0.5) small.add(o);
      }
    }
    if (isMedia) {
      if (r.width >= 12 && r.height >= 12 && here) items.add(el);
      if (
        el instanceof HTMLVideoElement &&
        !el.paused &&
        !el.ended &&
        el.readyState > 2
      )
        moving++;
    }
    if (choice) {
      // A control inside another control is part of it; a link inside
      // running text is part of its text block.
      const outer = el.parentElement?.closest(CHOICE_SELECTOR);
      if (!outer || !isChoice(outer)) {
        choices.push(el);
        if (here && !mine && !inlineInText(el, view)) items.add(el);
      }
    }
    if (here && el.matches(AD_SELECTOR)) adEls.push(el);
    if (el.localName === 'marquee') moving++;
    if (
      here &&
      /carousel|slideshow/i.test(el.getAttribute('aria-roledescription') ?? '')
    )
      moving++;
  }
  // One ad slot is counted once, whatever marks it.
  const ads = new Set<Element>();
  for (const a of adEls) {
    let nested = false;
    for (const b of adEls)
      if (
        b !== a &&
        b.contains(a) &&
        !AD_WORDS.test((b.textContent ?? '').trim())
      )
        nested = true;
    if (!nested) ads.add(a);
  }
  adsInView = ads.size;
  const anims = (
    root as unknown as { getAnimations?: () => Animation[] }
  ).getAnimations?.();
  for (const a of anims ?? []) {
    if (a.playState !== 'running') continue;
    const t = (a.effect as KeyframeEffect | null)?.target;
    if (t && t instanceof Element && shown(t)) moving++;
  }

  let choicesInView = 0;
  let inlineLinks = 0;
  let ownChoicesInView = 0;
  for (const c of choices) {
    if (!inView(c.getBoundingClientRect(), viewport)) continue;
    if (opts.own && c.closest(opts.own)) ownChoicesInView++;
    else if (inlineInText(c, view)) inlineLinks++;
    else choicesInView++;
  }

  const belowFloor = small.size;
  let belowTarget = 0;
  const smallControls: string[] = [];
  if (opts.T) {
    for (const c of choices) {
      if (inlineInText(c, view)) continue;
      const target = c.closest('label') ?? c;
      const r = target.getBoundingClientRect();
      if (Math.min(r.width, r.height) * z < opts.T - 0.5) {
        belowTarget++;
        if (opts.explain && smallControls.length < 8)
          smallControls.push(
            `${c.localName}.${Array.from(c.classList).slice(0, 2).join('.')} ${Math.round(r.width)}x${Math.round(r.height)} "${(c.textContent ?? '').trim().slice(0, 16)}"`,
          );
      }
    }
  }

  const primary =
    opts.primary ??
    root.querySelector('[data-primary="true"]') ??
    root.querySelector('main, [role="main"]');
  const mainStartShare =
    primary && shown(primary)
      ? Math.round((Math.max(0, topOf(primary)) / viewport.height) * 100) / 100
      : null;

  const runs = recordRuns(root, view, viewport.height);
  const maxGroup = runs.reduce((n, r) => Math.max(n, r.members.length), 0);
  let recordsBeforeMore = 0;
  let mismatches = 0;
  const mismatched: string[][] = [];
  for (const l of lists(runs)) {
    const recs = l.flatMap((r) => r.members);
    recordsBeforeMore = Math.max(recordsBeforeMore, recs.length);
    const sigs = recs.map((r) => fields(r, view));
    const n = templateMismatches(sigs);
    mismatches += n;
    // Which list, then a few of its records' fields.
    if (opts.explain && n)
      mismatched.push(
        [`@${describeEl(l[0]?.parent ?? null)}`],
        ...sigs.slice(0, 6),
      );
  }

  return {
    itemsInView: items.size,
    choicesInView,
    inlineLinks,
    ownChoicesInView,
    textStyles: styles.size,
    adsInView,
    moving,
    mainStartShare,
    maxGroup,
    recordsBeforeMore,
    templateMismatches: mismatches,
    belowFloorText: opts.F ? belowFloor : null,
    belowTargetControls: opts.T ? belowTarget : null,
    ...(opts.explain
      ? {
          explain: {
            smallControls,
            mismatched,
            items: [...items].slice(0, 60).map(describeEl),
          },
        }
      : {}),
  };
}

/** docs/11 §4 targets for a structure level; `original` is the page's own items in view. */
export interface ScoreTargets {
  itemsInView: number;
  choicesInView: number;
  ownChoicesInView: number;
  textStyles: number;
  adsInView: number;
  moving: number;
  mainStartShare: number;
  maxGroup: number;
  recordsBeforeMore: number | null;
  templateMismatches: number;
  belowFloorText: number;
  belowTargetControls: number;
}

/** An original with this many items in view or more is busy (docs/11 §4). */
export const BUSY_ITEMS = 40;
/** Fit view's own strip controls: Text −, Text +, Original page, More, and room for two. */
export const OWN_CHOICES_MAX = 6;

export function scoreTargets(
  level: 0 | 1 | 2,
  original: SurfaceMetrics,
  structure: { groupEvery: number; listFirst: number | null },
): ScoreTargets {
  const strong = level === 2;
  // Halving (or cutting by 30%) applies to a busy original; a calm one
  // (fewer than BUSY_ITEMS items in view) only must not get busier.
  const busy = original.itemsInView >= BUSY_ITEMS;
  const share = strong ? 0.5 : 0.7;
  const fromOriginal = busy
    ? Math.floor(original.itemsInView * share)
    : original.itemsInView;
  return {
    itemsInView: strong ? Math.min(30, fromOriginal) : fromOriginal,
    choicesInView: strong ? 15 : 25,
    ownChoicesInView: OWN_CHOICES_MAX,
    textStyles: 5,
    adsInView: 0,
    moving: 0,
    mainStartShare: strong ? 0.5 : 0.6,
    maxGroup: strong ? structure.groupEvery : 6,
    recordsBeforeMore: strong ? structure.listFirst : null,
    templateMismatches: 0,
    belowFloorText: 0,
    belowTargetControls: 0,
  };
}

/** Which targets a measured surface meets (null: no target at this level). */
export function meets(
  m: SurfaceMetrics,
  t: ScoreTargets,
): Record<keyof ScoreTargets, boolean | null> {
  const le = (v: number | null, max: number | null): boolean | null =>
    max === null || v === null ? null : v <= max;
  return {
    itemsInView: le(m.itemsInView, t.itemsInView),
    choicesInView: le(m.choicesInView, t.choicesInView),
    ownChoicesInView: le(m.ownChoicesInView, t.ownChoicesInView),
    textStyles: le(m.textStyles, t.textStyles),
    adsInView: le(m.adsInView, t.adsInView),
    moving: le(m.moving, t.moving),
    mainStartShare: le(m.mainStartShare, t.mainStartShare),
    maxGroup: le(m.maxGroup, t.maxGroup),
    recordsBeforeMore: le(m.recordsBeforeMore, t.recordsBeforeMore),
    templateMismatches: le(m.templateMismatches, t.templateMismatches),
    belowFloorText: le(m.belowFloorText, t.belowFloorText),
    belowTargetControls: le(m.belowTargetControls, t.belowTargetControls),
  };
}
