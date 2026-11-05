// Checks a rewrite of page text against the original, in code: every number kept, condition words never fewer.
// The paragraph rewrites (round 9) and the WebAble page's laid-out sections (round 10) both use them.

/** Split a passage into sentences (keeps abbreviations like "e.g." and decimals together). */
export function splitIntoSentences(passage: string): string[] {
  const t = String(passage ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  const re = /[^.!?]+(?:[.!?]+(?=\s+[A-Z0-9"“(\[]|$)|$)/g;
  let buf = '';
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    buf += m[0];
    const s = buf.trim();
    // keep going if the "sentence" ends with a common abbreviation
    if (/\b(?:e\.g|i\.e|etc|Mr|Mrs|Ms|Dr|St|No|vs|approx|Inc|Ltd)\.$/i.test(s)) continue;
    if (s) out.push(s);
    buf = '';
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/* ------------------------------------------------------------------ */
/* Deterministic checks                                                */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', ninety: '90',
  hundred: '100',
};
const PLACEHOLDER_RE = /\[[a-z ]+\]/g;

function numbersIn(s: string): string[] {
  const t = s.replace(PLACEHOLDER_RE, ' ');
  return (t.match(/\d+(?:[.,:]\d+)*/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, '').replace(/\.0+$/, ''));
}

function wordNumbersIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    const d = NUMBER_WORDS[m[0]];
    if (d !== undefined && m[0] !== 'one') out.push(d); // "one" is too often a pronoun
  }
  return out;
}

function countOf<T>(xs: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/**
 * Every number (and every redaction placeholder) in the original appears in the explanation, as digits or as a
 * number word. Thousands separators are ignored ("1,000" = "1000").
 */
export function numbersKept(original: string, explanation: string): boolean {
  const have = new Set([...numbersIn(explanation), ...wordNumbersIn(explanation)]);
  const haveText = explanation.replace(/,(?=\d{3}\b)/g, '');
  for (const n of numbersIn(original)) {
    if (have.has(n)) continue;
    // "4:30" in the original matched by "4:30" in the text; "1.5" by "1.5"
    if (haveText.includes(n)) continue;
    return false;
  }
  for (const n of wordNumbersIn(original)) if (!have.has(n)) return false;
  const want = countOf(original.match(PLACEHOLDER_RE) ?? []);
  const got = countOf(explanation.match(PLACEHOLDER_RE) ?? []);
  for (const [p, k] of want) if ((got.get(p) ?? 0) < k) return false;
  return true;
}

/** Condition groups: the explanation must not have fewer of any group than the original. */
export const CONDITION_GROUPS: ReadonlyArray<{ name: string; forms: string[] }> = Object.freeze([
  { name: 'only if', forms: ['only if', 'only when', 'provided that', 'as long as', 'on condition that'] },
  { name: 'if', forms: ['if', 'when', 'whenever', 'in case'] },
  { name: 'unless', forms: ['unless', 'except if', 'except when'] },
  { name: 'except', forms: ['except', 'excluding', 'other than', 'apart from', 'but not'] },
  { name: 'before', forms: ['before', 'prior to', 'earlier than', 'by the time'] },
  { name: 'after', forms: ['after', 'following', 'later than', 'once'] },
  { name: 'not', forms: ['not', 'never', 'no', 'none', 'nothing', 'without', 'neither', 'nor', 'cannot'] },
  { name: 'must', forms: ['must', 'have to', 'has to', 'need to', 'needs to', 'required', 'require', 'requires', 'shall', 'need', 'needs', 'needed'] },
  { name: 'may', forms: ['may', 'might', 'can', 'could', 'possibly'] },
  { name: 'within', forms: ['within', 'no later than', 'inside of'] },
  { name: 'at least', forms: ['at least', 'or more', 'minimum', 'no less than', 'no fewer than'] },
  { name: 'at most', forms: ['at most', 'up to', 'or less', 'or fewer', 'maximum', 'no more than', 'not more than', 'not exceed'] },
  { name: 'until', forms: ['until', 'till', 'up until'] },
  { name: 'only', forms: ['only', 'solely', 'just'] },
]);

function normalizeConditions(s: string): string {
  return ` ${s.toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/n't\b/g, ' not')
    .replace(/\bcannot\b/g, 'can not')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')} `;
}

function countForms(text: string, forms: string[]): number {
  // longest forms first, non-overlapping
  let t = text;
  let n = 0;
  for (const f of [...forms].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(` ${f.replace(/ /g, ' ')} `, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      n++;
      t = t.slice(0, m.index) + ' '.repeat(m[0].length - 1) + t.slice(m.index + m[0].length - 1);
      re.lastIndex = m.index + 1;
    }
  }
  return n;
}

/** Condition words (if, only if, unless, except, before, after, not, never, no, must, may, within, at least, ...). */
export function conditionWordsKept(original: string, explanation: string): boolean {
  const a = normalizeConditions(original);
  const b = normalizeConditions(explanation);
  for (const g of CONDITION_GROUPS) {
    if (countForms(b, g.forms) < countForms(a, g.forms)) return false;
  }
  return true;
}
