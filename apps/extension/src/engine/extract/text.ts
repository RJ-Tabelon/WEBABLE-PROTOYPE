// Owner: X (round 7). Tree helpers and text classifiers for the extractors (pure; no DOM).

import type { SNode } from './types';

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

/** Set parent links and pre-order indexes. Returns the nodes in document order. */
export function link(root: SNode): SNode[] {
  const out: SNode[] = [];
  const stack: Array<[SNode, SNode | null]> = [[root, null]];
  while (stack.length) {
    const top = stack.pop();
    if (!top) break;
    const [n, p] = top;
    n.parent = p;
    n.i = out.length;
    out.push(n);
    for (let k = n.kids.length - 1; k >= 0; k--) {
      const c = n.kids[k];
      if (c) stack.push([c, n]);
    }
  }
  return out;
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const FIELD_TAGS = new Set(['input', 'select', 'textarea', 'option', 'optgroup', 'datalist']);

/** Form controls carry no text here (their values are never read). */
export function isField(n: SNode): boolean {
  return FIELD_TAGS.has(n.tag);
}

const textMemo = new WeakMap<SNode, string>();

/** All visible text under a node, in document order, collapsed. Form controls contribute nothing. */
export function textOf(n: SNode): string {
  const have = textMemo.get(n);
  if (have !== undefined) return have;
  let out: string;
  if (isField(n)) out = '';
  else if (!n.kids.length) out = n.text;
  else {
    const parts: string[] = [];
    if (!n.segs) {
      if (n.text) parts.push(n.text);
      for (const k of n.kids) {
        const t = textOf(k);
        if (t) parts.push(t);
      }
    } else {
      let s = 0;
      const segs = n.segs;
      n.kids.forEach((k, idx) => {
        const at = k.ci ?? idx;
        while (s < segs.length && (segs[s]?.[0] ?? 0) <= at) {
          const t = segs[s]?.[1];
          if (t) parts.push(t);
          s++;
        }
        const t = textOf(k);
        if (t) parts.push(t);
      });
      while (s < segs.length) {
        const t = segs[s]?.[1];
        if (t) parts.push(t);
        s++;
      }
    }
    out = collapse(parts.join(' '));
  }
  textMemo.set(n, out);
  return out;
}

/** Every node under `n` (inclusive), pre-order. */
export function descendants(n: SNode, out: SNode[] = []): SNode[] {
  const stack: SNode[] = [n];
  while (stack.length) {
    const x = stack.pop();
    if (!x) break;
    out.push(x);
    for (let k = x.kids.length - 1; k >= 0; k--) {
      const c = x.kids[k];
      if (c) stack.push(c);
    }
  }
  return out;
}

export function contains(outer: SNode, inner: SNode): boolean {
  for (let p: SNode | null | undefined = inner; p; p = p.parent) if (p === outer) return true;
  return false;
}

export function ancestors(n: SNode, max = 64): SNode[] {
  const out: SNode[] = [];
  for (let p = n.parent; p && out.length < max; p = p.parent) out.push(p);
  return out;
}

/** Lowest common ancestor (both nodes linked). */
export function lca(a: SNode, b: SNode): SNode | null {
  const seen = new Set<SNode>();
  for (let p: SNode | null | undefined = a; p; p = p.parent) seen.add(p);
  for (let p: SNode | null | undefined = b; p; p = p.parent) if (seen.has(p)) return p;
  return null;
}

export function area(n: SNode): number {
  return Math.max(0, n.w) * Math.max(0, n.h);
}

const CONTROL_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
const CONTROL_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'combobox', 'textbox', 'option']);

export function isControl(n: SNode): boolean {
  if (n.tag === 'a') return n.attrs?.href !== undefined;
  return CONTROL_TAGS.has(n.tag) || (n.role !== undefined && CONTROL_ROLES.has(n.role));
}

export function isImage(n: SNode): boolean {
  return n.tag === 'img' || n.tag === 'svg' || n.tag === 'canvas';
}

export function isHeading(n: SNode): boolean {
  return /^h[1-6]$/.test(n.tag) || n.role === 'heading';
}

/** Class words of a node (split on punctuation and camelCase), lowercase. */
export function words(cls: string): string[] {
  return cls
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 2);
}

export function hasWord(n: SNode, re: RegExp): boolean {
  return words(n.cls).some((w) => re.test(w));
}

/**
 * "Text leaves": the highest nodes whose text is all their own (no element child carries text of its own beside
 * them), skipping form controls. For a card `<div><div>Wins</div><div>54</div></div>` this is ['Wins', '54'].
 */
export function textLeaves(n: SNode, out: SNode[] = [], skip?: (x: SNode) => boolean): SNode[] {
  if (skip?.(n) || isField(n)) return out;
  if (!textOf(n)) return out;
  const withText = n.kids.filter((k) => !isField(k) && textOf(k));
  const textKids = withText.filter((k) => !skip?.(k));
  const skipped = withText.length !== textKids.length;
  if (skipped) {
    // Some children are left out: this node can only stand for its own text.
    if (n.text) out.push({ ...n, kids: [], segs: undefined });
    for (const k of textKids) textLeaves(k, out, skip);
    return out;
  }
  if (textKids.length === 0) {
    out.push(n);
    return out;
  }
  if (!n.text && textKids.length === 1) return textLeaves(textKids[0] as SNode, out, skip);
  // Mixed content (a sentence with a link inside) and one-line inline runs ("<span>L</span> <span>7-38</span>") are
  // one leaf each.
  if (n.text || inlineRun(n, textKids)) {
    out.push(n);
    return out;
  }
  for (const k of n.kids) textLeaves(k, out, skip);
  return out;
}

function inlineRun(n: SNode, textKids: SNode[]): boolean {
  if (textOf(n).length > 32) return false;
  if (n.h > Math.max(40, 2.2 * (n.fs || 16))) return false;
  const y0 = textKids[0]?.y ?? n.y;
  return textKids.every((k) => Math.abs(k.y - y0) <= 8 && k.h <= n.h + 2);
}

/* ------------------------------------------------------------------ */
/* Text classifiers                                                    */
/* ------------------------------------------------------------------ */

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const WEEKDAY = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?\\.?';
const DATE_ONE = `(?:${WEEKDAY},?\\s+)?(?:${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}(?:T[\\d:.]+Z?)?|${MONTH}\\s+\\d{4})`;
const DATE_RE = new RegExp(`^${DATE_ONE}(?:\\s*[-–—]\\s*${DATE_ONE})?$`, 'i');
const DATE_IN = new RegExp(`\\b${DATE_ONE}\\b`, 'i');

/** A date or a date range: "11/8/2025", "Saturday, November 8", "Oct 10", "9/10/2016 - 11/8/2025". */
export function isDateText(t: string): boolean {
  const s = collapse(t);
  return s.length <= 48 && DATE_RE.test(s);
}

export function hasDate(t: string): boolean {
  return DATE_IN.test(t);
}

const NUM = /^[+\-−]?[$€£¥]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?$|^[+\-−]?[$€£¥]?\d+(?:\.\d+)?%?$/;
const RECORD = /^\d{1,3}\s?[-–—]\s?\d{1,3}(?:\s?[-–—]\s?\d{1,3})?$/;
const RESULT = /^[WLTD]\s?\d{1,3}\s?[-–—]\s?\d{1,3}(?:\s?\(\d?OT\))?$/;
const STREAK = /^[WLT]\s?\d{1,3}$/;
const MEASURE = /^[+\-−]?\d+(?:[.,]\d+)?\s?(?:½|¼|¾)?\s?(?:mins?|minutes?|hrs?|hours?|h|secs?|seconds?|days?|weeks?|months?|years?|yrs?|g|kg|mg|lbs?|oz|cal|kcal|servings?|dozen|cups?|pts?|points?|yds?|yards?|ft|in|m|km|mi|miles?|games?|wins?|%)\b[\w\s,.'’-]{0,24}$/i;
const CLOCK = /^\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?:\s?[-–]\s?\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?))?$/i;

/** A short value a stat card shows: "54", "30-6", "W 73-7", "L1", "$4.00", "20 mins", "4 dozen cookies". */
export function isValueText(t: string): boolean {
  const s = collapse(t);
  if (!s || s.length > 28) return false;
  if (isDateText(s)) return false;
  return NUM.test(s) || RECORD.test(s) || RESULT.test(s) || STREAK.test(s) || MEASURE.test(s) || CLOCK.test(s);
}

/** A score on a scoreboard: a whole number 0..299. */
export function isScoreText(t: string): boolean {
  return /^\d{1,3}$/.test(collapse(t)) && Number(collapse(t)) < 300;
}

/** A name for a value: "Wins", "Home Record", "Prep Time:", "Last 10 Matchups". Never a date or a value. */
export function isLabelText(t: string): boolean {
  const s = collapse(t).replace(/[:：]$/, '');
  if (!s || s.length > 48) return false;
  if (isValueText(s) || isDateText(s)) return false;
  const ws = s.split(' ');
  if (ws.length > 7) return false;
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  const chars = s.replace(/\s/g, '').length;
  if (chars === 0 || letters / chars < 0.6) return false;
  return ws.some((w) => (w.match(/\p{L}/gu) ?? []).length >= 2);
}

/** A number-like cell (for right-aligned table columns). */
export function isNumericCell(t: string): boolean {
  const s = collapse(t);
  if (!s) return false;
  return NUM.test(s) || RECORD.test(s) || RESULT.test(s) || STREAK.test(s) || /^[+\-−]?\d+(?:\.\d+)?\s?(?:%|pts?|yds?)$/i.test(s) || /^\d{4}(?:[-–]\d{2,4})?$/.test(s);
}

/** Joiner between two sides of a scoreboard ("at", "vs", "@"), normalised; null otherwise. */
export function joinerOf(t: string): string | null {
  const s = collapse(t).toLowerCase().replace(/\.$/, '');
  if (s === 'at' || s === '@') return 'at';
  if (s === 'vs' || s === 'v' || s === 'versus') return 'vs';
  return null;
}

/** Strip interface words from an image's alt or a link's label ("Visit Allrecipes' homepage" -> "Allrecipes"). */
export function cleanName(s: string): string {
  let t = collapse(s)
    .replace(/,?\s*opens in (a )?new (window|tab)\.?/gi, '')
    .replace(/\b(visit|go to|back to|return to)\b/gi, ' ')
    .replace(/\b(home ?page|home|logo|logotype|wordmark|brand mark|image|icon|link|official (web)?site)\b/gi, ' ')
    .replace(/['’]s\b/g, '')
    .replace(/['’]\s/g, ' ');
  t = collapse(t).replace(/^[-–|:·,\s]+|[-–|:·,\s]+$/g, '');
  return t;
}

/** Names that say nothing about who the logo is ("Team Logo", "Opponent Logo"). */
export function genericLogoName(s: string): boolean {
  const t = collapse(s).toLowerCase();
  return !t || /^(team|opponent|home|away|visitor|visiting team|home team|away team|school|club|logo|image|photo|picture|icon)( logo)?$/.test(t) || t.length < 2;
}

const ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓',
  frac23: '⅔', frac18: '⅛', deg: '°', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…',
  eacute: 'é', egrave: 'è', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', reg: '®', trade: '™', copy: '©',
};

/** Decode HTML entities and drop tags (JSON-LD strings sometimes carry both). */
export function plain(s: string): string {
  return collapse(
    String(s ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]{0,400}>/g, ' ')
      .replace(/&#(\d{1,6});/g, (_m, d: string) => safeChar(Number(d)))
      .replace(/&#x([0-9a-f]{1,6});/gi, (_m, h: string) => safeChar(parseInt(h, 16)))
      .replace(/&([a-z]{2,8}\d{0,2});/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m),
  );
}

function safeChar(code: number): string {
  try {
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

/** ISO 8601 duration ("PT1H20M") in plain words ("1 hr 20 min"); '' when unreadable or zero. */
export function isoDuration(s: string): string {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(collapse(String(s ?? '')));
  if (!m) return '';
  const d = Number(m[1] ?? 0);
  let h = Number(m[2] ?? 0);
  let min = Number(m[3] ?? 0);
  if (min >= 60) {
    h += Math.floor(min / 60);
    min %= 60;
  }
  const parts: string[] = [];
  if (d) parts.push(`${d} day${d === 1 ? '' : 's'}`);
  if (h) parts.push(`${h} hr`);
  if (min) parts.push(`${min} min`);
  return parts.join(' ');
}

/** Word-overlap similarity of two short texts, 0..1 (for matching JSON-LD text to page text). */
export function similar(a: string, b: string): number {
  const norm = (s: string) => collapse(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')).split(' ').filter((w) => w.length >= 2);
  const wa = norm(a);
  const wb = new Set(norm(b));
  if (!wa.length || !wb.size) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.max(wa.length, wb.size);
}
