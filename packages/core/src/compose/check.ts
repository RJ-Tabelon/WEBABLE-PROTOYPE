// Round 10: code checks on a group's components. They run after validateBlocks and before Jev; Jev never rescues a
// failure. All texts are compared without link markers (⟦2⟧ never counts as a 2) and without the page's bold marks
// (groupText, layoutText and runningText leave out every **).
// - numbersKept: every number of the page's text is in the layout (outside the 'key' callout, which only repeats);
// - noNewNumbers: no number in the layout (key callout included) that the page's text does not have, as digits or as
//   a number word ("one" aside);
// - linksKept: each ⟦n⟧ of the group exactly once across the blocks, none in the 'key' callout, none new, and no
//   link's own words written out right beside its marker (the page would show them twice);
// - quotesKept: a quote block's words are word for word in the page (an ellipsis may join two exact parts) and the
//   speaker is named there; quoted spans anywhere else are exact too;
// - conditionsKept: never fewer of the words that flip meaning; the softer ones (if, before, must, may, or) may move
//   into structure, one per step, row, tile, term or point (fair to lists);
// - plain: a layout that is only prose and barely changes the wording is not worth showing ('plain_is_better').
import { numbersKept } from '../jev/explain-check';
import { changeShare, conditionCounts, markersIn, quotesKept, stripMarkers } from '../reword/check';
import type { ComposeBlock, ComposeGroupIn } from '../types';
import { groupText, isKeyCallout, layoutText, runningText, stripBold, validateBlocks } from './blocks';

export type ComposeFailure =
  | 'invalid' | 'covered' | 'numbers' | 'new_numbers' | 'links' | 'quotes' | 'conditions' | 'plain_is_better';

/** Under this share of changed wording a prose-only layout is the page's own text again. */
export const COMPOSE_MIN_CHANGE = 0.15;

/** Cardinal number words ("one" is too often a pronoun). They count on both sides. */
const NUMBER_WORDS: Record<string, string> = {
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11',
  twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80',
  ninety: '90', hundred: '100', zero: '0',
};
/** Words the page may use for a number the layout writes in digits ("first" -> "1st"); never new in a layout. */
const SOFT_NUMBER_WORDS: Record<string, string> = { half: '0.5', twice: '2', once: '1', first: '1', second: '2', third: '3' };

/** Digits as written ("1,000" -> "1000", "2.0" -> "2"), the way explain-check's numbersKept reads them. */
export function digitsIn(s: string): string[] {
  return (stripMarkers(s).match(/\d+(?:[.,:]\d+)*/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, '').replace(/\.0+$/, ''));
}

function wordNumbersIn(s: string, soft = false): string[] {
  const out: string[] = [];
  for (const m of stripMarkers(s).toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    const d = NUMBER_WORDS[m[0]] ?? (soft ? SOFT_NUMBER_WORDS[m[0]] : undefined);
    if (d !== undefined) out.push(d);
  }
  return out;
}

/** Numbers of the page's text the layout does not have (for the retry note; numbersKept decides). */
export function missingNumbers(source: string, layout: string): string[] {
  const have = new Set([...digitsIn(layout), ...wordNumbersIn(layout, true)]);
  const flat = stripMarkers(layout).replace(/,(?=\d{3}\b)/g, '');
  return [...new Set(digitsIn(source).filter((n) => !have.has(n) && !flat.includes(n)))];
}

/**
 * Numbers in the layout the page's text does not have. A number counts as the page's when the page writes it in
 * digits, as a number word, or inside a longer number ("21" in "2021" does not count: whole numbers only).
 * Number words in the layout count too ("two ways" when the page never says two is invented).
 */
export function newNumbers(source: string, layout: string): string[] {
  const allowed = new Set([...digitsIn(source), ...wordNumbersIn(source, true)]);
  const srcFlat = stripMarkers(source).replace(/,(?=\d{3}\b)/g, '');
  const fresh = [...digitsIn(layout), ...wordNumbersIn(layout)];
  // A digit run that is part of the page's own longer token ("4:30" -> "4", "30") is the page's.
  return [...new Set(fresh.filter((n) => !allowed.has(n) && !new RegExp(`(?:^|[^\\d])${n.replace(/\./g, '\\.')}(?:[^\\d]|$)`).test(srcFlat)))];
}

const linkWordsOf = (s: string): string[] =>
  stripMarkers(s).toLowerCase().replace(/[‘’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').split(' ').filter(Boolean);

/**
 * How many markers have their own link's words (2+ words) written right beside them, within 8 words before or
 * after: "the refund tracker ⟦1⟧" where ⟦1⟧ shows "refund tracker" would show those words twice. A title, a label or
 * a defined term may name the link's words; runningText leaves those out.
 */
export function linkWordsBesideMarker(text: string, linkTexts: string[]): number {
  let n = 0;
  for (const m of text.matchAll(/⟦(\d{1,3})⟧/g)) {
    const words = linkWordsOf(linkTexts[Number(m[1]) - 1] ?? '');
    if (words.length < 2) continue;
    const at = m.index ?? 0;
    const before = linkWordsOf(text.slice(0, at)).slice(-8);
    const after = linkWordsOf(text.slice(at + m[0].length)).slice(0, 8);
    const needle = ` ${words.join(' ')} `;
    if (` ${before.join(' ')} `.includes(needle) || ` ${after.join(' ')} `.includes(needle)) n++;
  }
  return n;
}

export interface LinkCheck {
  ok: boolean;
  missing: number[];
  repeated: number[];
  extra: number[];
  inKey: boolean;
  wordsRepeated: boolean;
}

/** Each ⟦n⟧ of the group exactly once across the blocks that are not the key callout; none in it; none new. */
export function checkLinks(group: ComposeGroupIn, blocks: ComposeBlock[]): LinkCheck {
  const want = new Set(group.units.flatMap((u) => markersIn(u.text)));
  const got = markersIn(layoutText(blocks, { key: false }));
  const inKey = blocks.some((b) => isKeyCallout(b) && markersIn(layoutText([b])).length > 0);
  const count = new Map<number, number>();
  for (const n of got) count.set(n, (count.get(n) ?? 0) + 1);
  const missing = [...want].filter((n) => !count.has(n));
  const repeated = [...count].filter(([n, k]) => want.has(n) && k > 1).map(([n]) => n);
  const extra = [...count.keys()].filter((n) => !want.has(n));
  const wordsRepeated = linkWordsBesideMarker(runningText(blocks), group.linkTexts) > linkWordsBesideMarker(groupText(group), group.linkTexts);
  return { ok: !missing.length && !repeated.length && !extra.length && !inKey && !wordsRepeated, missing, repeated, extra, inKey, wordsRepeated };
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

/** A quote block's words are the page's own (parts joined by an ellipsis each exact) and its speaker is named there. */
export function quoteBlockKept(source: string, b: Extract<ComposeBlock, { k: 'quote' }>): boolean {
  const page = plainForCompare(source);
  const parts = plainForCompare(b.text)
    .replace(/^"+|"+$/g, '')
    .split(/\.\.\.|…|\[\.\.\.\]/)
    .map((p) => p.replace(/^[\s,.;:"]+|[\s,.;:"]+$/g, '').trim())
    .filter(Boolean);
  if (!parts.length || !parts.every((p) => page.includes(p))) return false;
  const who = plainForCompare(b.who).split(/[^a-z']+/).filter((w) => w.length >= 3);
  return who.some((w) => page.includes(w));
}

/** The text with each ⟦n⟧ replaced by its link's words (a quotation mark inside a link's words then pairs up). */
export function withLinkWords(text: string, linkTexts: string[]): string {
  return text.replace(/⟦(\d{1,3})⟧/g, (m, n: string) => linkTexts[Number(n) - 1] ?? m);
}

/** Quotes are compared with the links' words in place, on both sides: a link can hold a quotation mark. */
export function checkQuotes(group: ComposeGroupIn, blocks: ComposeBlock[]): boolean {
  const source = withLinkWords(groupText(group), group.linkTexts);
  for (const b of blocks) {
    if (b.k === 'quote' && !quoteBlockKept(source, { ...b, text: withLinkWords(stripBold(b.text), group.linkTexts), who: stripBold(b.who) })) return false;
  }
  return quotesKept(source, { lead: withLinkWords(layoutText(blocks), group.linkTexts), items: [], ordered: false });
}

/** How many pieces a layout splits text into (each may carry one soft condition word in its structure). */
function pieces(blocks: ComposeBlock[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.k === 'keyfacts' || b.k === 'contact') n += b.rows.length;
    else if (b.k === 'steps') n += b.steps.length;
    else if (b.k === 'stats') n += b.tiles.length;
    else if (b.k === 'compare') n += b.rows.length;
    else if (b.k === 'definitions' || b.k === 'points') n += b.items.length;
    else n += 1;
  }
  return n;
}

/** Strict condition words: never fewer. Soft ones: up to one fewer per piece of structure (at least one). */
export function checkConditions(group: ComposeGroupIn, blocks: ComposeBlock[]): { ok: boolean; lost: string[] } {
  const allowance = Math.max(1, pieces(blocks.filter((b) => !isKeyCallout(b))));
  const lost = conditionCounts(groupText(group), layoutText(blocks, { key: false }))
    .filter((c) => (c.strict ? c.now < c.was : c.now < c.was - allowance))
    .map((c) => c.name);
  return { ok: lost.length === 0, lost };
}

/** Only prose (no other kind at all) and nearly the page's own wording. */
export function plainIsBetter(group: ComposeGroupIn, blocks: ComposeBlock[]): boolean {
  if (!blocks.length || blocks.some((b) => b.k !== 'prose')) return false;
  const text = stripBold(blocks.map((b) => (b.k === 'prose' ? b.text : '')).join('\n\n'));
  return changeShare(groupText(group), { lead: text, items: [], ordered: false }) < COMPOSE_MIN_CHANGE;
}

export interface ComposeCodeChecks {
  covered: boolean;
  numbersKept: boolean;
  noNewNumbers: boolean;
  linksKept: boolean;
  quotesKept: boolean;
  conditionsKept: boolean;
  /** The first failure, in the order checked, or null when every check passes. */
  failure: ComposeFailure | null;
  /** What exactly failed, in plain words for the planner's retry (null when nothing failed). */
  note: string | null;
}

/** validateBlocks, then every code check. The planner sees `note` on a retry. */
export function composeChecks(group: ComposeGroupIn, blocks: ComposeBlock[]): ComposeCodeChecks {
  const v = validateBlocks(group, blocks);
  const source = groupText(group);
  const kept = layoutText(blocks, { key: false });
  const all = layoutText(blocks);
  const numbers = numbersKept(stripMarkers(source), stripMarkers(kept));
  const fresh = newNumbers(source, all);
  const links = checkLinks(group, blocks);
  const quotes = checkQuotes(group, blocks);
  const conds = checkConditions(group, blocks);
  const base = { covered: v.covered, numbersKept: numbers, noNewNumbers: fresh.length === 0, linksKept: links.ok, quotesKept: quotes, conditionsKept: conds.ok };
  const fail = (failure: ComposeFailure, note: string): ComposeCodeChecks => ({ ...base, failure, note });
  if (!v.covered) return fail('covered', `These units are not in any block (the main-point callout does not count): ${v.uncovered.join(', ')}. Every unit must be in a block's src and its content in that block.`);
  if (v.problems.length) return fail('invalid', v.problems.slice(0, 6).join(' '));
  if (!numbers) {
    const miss = missingNumbers(source, kept);
    return fail('numbers', `${miss.length ? `These numbers from the page are missing: ${miss.slice(0, 8).join(', ')}.` : 'A number from the page is missing or changed.'} Copy every number, amount and date exactly.`);
  }
  if (fresh.length) return fail('new_numbers', `These numbers are not on the page: ${fresh.slice(0, 8).join(', ')}. Never add a number, count or date the page does not state.`);
  if (!links.ok) {
    const bits = [
      links.missing.length ? `missing ${links.missing.map((n) => `⟦${n}⟧`).join(' ')}` : '',
      links.repeated.length ? `written more than once ${links.repeated.map((n) => `⟦${n}⟧`).join(' ')}` : '',
      links.extra.length ? `not on the page ${links.extra.map((n) => `⟦${n}⟧`).join(' ')}` : '',
      links.inKey ? 'a marker inside the main-point callout' : '',
      links.wordsRepeated ? "a link's own words written beside its marker" : '',
    ].filter(Boolean);
    return fail('links', `Link markers: ${bits.join('; ')}. Each ⟦n⟧ exactly once outside the main-point callout; never write its words.`);
  }
  if (!quotes) return fail('quotes', 'A quote is not word for word from the page, or its speaker is not named on the page. Copy quoted words exactly and name the speaker the page names.');
  if (!conds.ok) return fail('conditions', `Words that limit the meaning were lost (${conds.lost.join(', ')}). Keep every not, no, only, unless, except, at least, at most, within and until with what it limits.`);
  if (plainIsBetter(group, blocks)) return fail('plain_is_better', 'The layout is the page\'s own text again.');
  return { ...base, failure: null, note: null };
}
