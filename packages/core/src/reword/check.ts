// Round 9: code checks on a rewritten paragraph. They run before Jev's check and Jev can never rescue a failure.
// - linksKept: every ⟦n⟧ of the original appears exactly once across lead and items, and no new marker appears;
// - numbersKept: every number of the original survives (markers are taken out first, so ⟦2⟧ never counts as a 2);
// - conditionsKept: never fewer of the words that flip meaning (not, no, never, unless, only, except, at least,
//   at most, within, until). The softer ones (if, when, before, after, must, may, or) may move into a list's
//   structure: a list may turn "if you filed on paper, ..." into an item, so a list is allowed a few fewer of them.
//   Plain prose kinds get a small allowance of one per soft group (Jev's dropped check backs this up).
import { numbersKept } from '../jev/explain-check';
import type { RewordKind, RewordOut } from '../types';

export const LINK_MARKER_RE = /⟦(\d{1,3})⟧/g;

/** The rewrite as one text: the lead, then each item on its own line. */
export function outText(out: RewordOut): string {
  return [out.lead, ...out.items].map((s) => s.trim()).filter(Boolean).join('\n');
}

/** The ⟦n⟧ numbers in a text, in order (repeats kept). */
export function markersIn(text: string): number[] {
  return [...text.matchAll(LINK_MARKER_RE)].map((m) => Number(m[1]));
}

/** The text with every ⟦n⟧ taken out (for counting words and numbers). */
export function stripMarkers(text: string): string {
  return text.replace(LINK_MARKER_RE, ' ').replace(/[ \t]+/g, ' ').trim();
}

/** Each ⟦n⟧ of the original exactly once across lead and items; no marker the original does not have. */
export function linksKept(originalText: string, out: RewordOut): boolean {
  const want = new Set(markersIn(originalText));
  const got = markersIn(outText(out));
  if (got.length !== want.size) return false;
  const seen = new Set<number>();
  for (const n of got) {
    if (!want.has(n) || seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}

/** numbersKept on the texts without link markers. */
export function rewordNumbersKept(originalText: string, out: RewordOut): boolean {
  return numbersKept(stripMarkers(originalText), stripMarkers(outText(out)));
}

/** Words that flip or limit meaning: a rewrite may never have fewer of any group. */
export const STRICT_CONDITION_GROUPS: ReadonlyArray<{ name: string; forms: string[] }> = Object.freeze([
  { name: 'not', forms: ['not', 'never', 'no', 'none', 'nothing', 'without', 'neither', 'nor'] },
  { name: 'unless', forms: ['unless', 'except if', 'except when'] },
  { name: 'only', forms: ['only', 'solely'] },
  { name: 'except', forms: ['except', 'excluding', 'other than', 'apart from', 'but not'] },
  { name: 'at least', forms: ['at least', 'or more', 'minimum', 'no less than', 'no fewer than'] },
  { name: 'at most', forms: ['at most', 'up to', 'or less', 'or fewer', 'maximum', 'no more than', 'not more than', 'not exceed'] },
  { name: 'within', forms: ['within', 'no later than'] },
  { name: 'until', forms: ['until', 'till'] },
]);

/** Words a list can carry in its structure, and prose can sometimes say another way. */
export const SOFT_CONDITION_GROUPS: ReadonlyArray<{ name: string; forms: string[] }> = Object.freeze([
  { name: 'if', forms: ['if', 'when', 'whenever', 'in case'] },
  { name: 'before', forms: ['before', 'prior to', 'earlier than'] },
  { name: 'after', forms: ['after', 'later than', 'once'] },
  { name: 'must', forms: ['must', 'have to', 'has to', 'need to', 'needs to', 'required', 'require', 'requires', 'shall'] },
  { name: 'may', forms: ['may', 'might', 'can', 'could'] },
  { name: 'or', forms: ['or'] },
]);

function normalize(s: string): string {
  return ` ${stripMarkers(s)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/n't\b/g, ' not')
    .replace(/\bcannot\b/g, 'can not')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')} `;
}

/** Non-overlapping count of the forms (longest first) in a normalized text. */
export function countConditionForms(normalized: string, forms: string[]): number {
  let t = normalized;
  let n = 0;
  for (const f of [...forms].sort((a, b) => b.length - a.length)) {
    const needle = ` ${f} `;
    let at = t.indexOf(needle);
    while (at !== -1) {
      n++;
      t = t.slice(0, at) + ' '.repeat(needle.length - 1) + t.slice(at + needle.length - 1);
      at = t.indexOf(needle, at + 1);
    }
  }
  return n;
}

/** Per group: how many the original has and how many the rewrite has (for logs and tests). */
export function conditionCounts(original: string, rewritten: string): Array<{ name: string; strict: boolean; was: number; now: number }> {
  const a = normalize(original);
  const b = normalize(rewritten);
  return [
    ...STRICT_CONDITION_GROUPS.map((g) => ({ name: g.name, strict: true, was: countConditionForms(a, g.forms), now: countConditionForms(b, g.forms) })),
    ...SOFT_CONDITION_GROUPS.map((g) => ({ name: g.name, strict: false, was: countConditionForms(a, g.forms), now: countConditionForms(b, g.forms) })),
  ];
}

/**
 * Strict groups: never fewer. Soft groups: a list may have up to as many fewer as it has items (each item can carry
 * one in its structure); prose kinds may have one fewer per group ("when you file" -> "after you file").
 */
export function conditionsKept(originalText: string, out: RewordOut, kind: RewordKind): boolean {
  const allowance = kind === 'list' ? Math.max(1, out.items.length) : 1;
  for (const c of conditionCounts(originalText, outText(out))) {
    if (c.strict ? c.now < c.was : c.now < c.was - allowance) return false;
  }
  return true;
}

function plainForCompare(s: string): string {
  return stripMarkers(s)
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The spans inside double quotation marks (“…” or "…"), at least two words long. */
export function quotedSpans(text: string): string[] {
  const t = plainForCompare(text);
  const out: string[] = [];
  for (const m of t.matchAll(/"([^"]+)"/g)) {
    const span = m[1]!.replace(/[\s,.;:!?]+$/, '').trim();
    if (span.split(' ').length >= 2) out.push(span);
  }
  return out;
}

/** Every quotation in the rewrite is word for word in the original (a rewrite never changes what someone said). */
export function quotesKept(originalText: string, out: RewordOut): boolean {
  const original = plainForCompare(originalText);
  const spans = quotedSpans(outText(out));
  if (!spans.every((q) => original.includes(q))) return false;
  // Quotation marks dropped but the speaker's "I" or "we" kept: someone's words would read as the page's own.
  if (spans.length === 0 && quotedSpans(originalText).length > 0) {
    return !/\b(?:i|i'm|i've|we|we're|we've|our|my|me|us)\b/.test(plainForCompare(outText(out)));
  }
  return true;
}

function wordsOf(s: string): string[] {
  return plainForCompare(s).replace(/[^a-z0-9' ]+/g, ' ').split(' ').filter(Boolean);
}

/**
 * How much of the wording changed, 0..1: 1 - (longest common word sequence / the longer text's words). A near copy
 * scores under about 0.1; real rewrites score 0.3 and up.
 */
export function changeShare(originalText: string, out: RewordOut): number {
  const a = wordsOf(originalText).slice(0, 400);
  const b = wordsOf(outText(out)).slice(0, 400);
  if (!a.length || !b.length) return a.length || b.length ? 1 : 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    prev = cur;
  }
  return Math.round((1 - prev[b.length]! / Math.max(a.length, b.length)) * 1000) / 1000;
}

/** Under this share of changed wording a rewrite is a near copy and is not used (point_first only moves a sentence). */
export const MIN_CHANGE: Readonly<Record<RewordKind, number>> = Object.freeze({ plain: 0.15, list: 0.1, shorter: 0.15, point_first: 0.05 });

/**
 * The rewrite writes a link's own words as well as its marker ("return the refund ⟦1⟧" where ⟦1⟧ shows "return
 * the refund"): the page would show them twice. Link words of 2+ words only, outside what the original already says.
 */
export function linkWordsRepeated(originalText: string, out: RewordOut, linkTexts: string[] | undefined): boolean {
  if (!linkTexts?.length) return false;
  const original = ` ${wordsOf(originalText).join(' ')} `;
  const now = ` ${wordsOf(outText(out)).join(' ')} `;
  return linkTexts.some((t) => {
    const w = wordsOf(t);
    if (w.length < 2) return false;
    const needle = ` ${w.join(' ')} `;
    const count = (hay: string) => hay.split(needle).length - 1;
    return count(now) > count(original);
  });
}
