import type { SkelPattern } from '@webable/core/skeleton/constants';

/**
 * Text shapes and labels (docs/10 §6). Pattern tags describe what a short
 * text looks like (a price, a duration, a date) so the planner can assign
 * field roles without seeing the text. Labels are page words and stay on
 * this device; they are cut to LABEL_MAX characters here.
 */

/** Longest label kept on a node (LOCAL ONLY). */
export const LABEL_MAX = 80;

/** Texts up to this many characters are 'stext' (pattern-tagged); longer ones are 'text'. */
export const SHORT_TEXT_MAX = 40;

export function normalizeSpace(s: string): string {
  return s.replace(/[\s\u00a0\u200b]+/g, ' ').trim();
}

/** Cut to at most `max` characters without splitting a surrogate pair; '…' marks a cut. */
export function cutLabel(s: string, max = LABEL_MAX): string {
  const t = normalizeSpace(s);
  if (t.length <= max) return t;
  let end = max - 1;
  const code = t.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return `${t.slice(0, end).trimEnd()}…`;
}

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

/** Pattern tags of a short text, in SKEL_PATTERNS order. Only the tags leave the device. */
export function textPatterns(raw: string): SkelPattern[] {
  const s = normalizeSpace(raw);
  if (!s || s.length > 80) return [];
  // Every pattern needs a digit, a star or a date word: skip the regexes otherwise.
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
  return ORDER.filter((p) => out.has(p));
}

const ORDER: readonly SkelPattern[] = [
  'price',
  'duration',
  'count',
  'rating',
  'date',
  'percent',
  'num',
];

/** Patterns whose text changes on its own (fingerprints leave these out). */
export const VOLATILE_PATTERNS: ReadonlySet<SkelPattern> = new Set([
  'duration',
  'count',
  'date',
  'percent',
  'num',
]);

/**
 * Normalised form for name hashes: lowercase, digits folded, so "Inbox (3)"
 * and "Inbox (4)" are the same control.
 */
export function nameKey(label: string): string {
  return normalizeSpace(label)
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)*/g, '#');
}
