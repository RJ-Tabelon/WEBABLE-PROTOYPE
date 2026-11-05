// Round 9: Jev's questions for paragraphs fitted to the person. Design B throughout: each paragraph's (or point's,
// or rewrite's) evidence sits inside its own questions; the shared state holds only the reader brief and the page.
//   score    per paragraph: need_<id> (Noul: harder than it needs to be FOR THIS READER?) and how_<id> (Choice over
//            keep | plain | list | shorter | point_first, contrastive criteria, keep as the escape). Code counts the
//            facts (sentences, words per sentence, long words, numbers, joins) and puts them in each question; Jev
//            never counts. More than SCORE_SPLIT_AT paragraphs go out as two parallel calls.
//   ground   per ReaderPoint: support_<id> (Noul: does the AI's answer support this statement about the person?).
//   rewrite  per rewritten paragraph: dropped_<id> and added_<id> (Nouls), original and new text inside each.
// Code picks the change from Jev's probabilities (pickChange); every missing answer fails closed.
import { choiceOf, noulOf } from '../jev/api';
import type { JevQuestion, JevResponse } from '../jev/api';
import { splitIntoSentences } from '../jev/explain-check';
import { REWORD_KINDS } from '../types';
import type { ReaderPoint, RewordKind, RewordPage, RewordPara, RewordScore } from '../types';
import { markersIn, stripMarkers } from './check';

export const REWORD_CATALOG_VERSION = 'wa-reword-1';

/** Thresholds that turn Jev's answers into a change (tuned on IRS refunds and a CNN article, two readers). */
export const REWORD_PICK = Object.freeze({
  /** Jev's need probability at or above this, or the paragraph stays as it is. */
  needMin: 0.6,
  /** The best change must reach this and beat keep. */
  kindMin: 0.35,
  /** Paragraphs shorter than this stay as they are. */
  minWords: 18,
  /** A list needs at least this many joins or sentences to split into items. */
  listMinItems: 2,
});

/**
 * A paragraph with the words of its links, when the extension sends them (optional; not yet in the RewordPara
 * contract). The models read "⟦1⟧ = file an amended return" so a rewrite still reads well once the page's own
 * link is back at the marker; without them a marker is an unnamed link.
 */
export type RewordParaIn = RewordPara & { linkTexts?: string[] };

/** "⟦1⟧": "file an amended return", for every marker with known words (null when none are known). */
export function linkWords(p: RewordParaIn): Record<string, string> | null {
  if (!p.linkTexts?.length) return null;
  const out: Record<string, string> = {};
  p.linkTexts.forEach((t, i) => {
    const w = t.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (w) out[`⟦${i + 1}⟧`] = w;
  });
  return Object.keys(out).length ? out : null;
}

/** At most this many paragraphs per call; more go out as two parallel calls. */
export const SCORE_SPLIT_AT = 20;
export const SCORE_MAX_PARAS = 40;

/**
 * Rewrite check: dropped or added at or above these fails the rewrite (the page's own words stay). Measured on 13
 * controls and two readers on IRS and CNN: faithful rewrites 0.02-0.49 dropped, 0.03-0.31 added; a fact, condition or
 * number left out 0.75-0.98 dropped; advice or a fact added 0.80-0.97 added.
 */
export const REWRITE_CHECK = Object.freeze({ droppedMax: 0.65, addedMax: 0.5 });

/** Points whose support is under this are dropped at import. */
export const GROUND_MIN_SUPPORT = 0.5;

/* ------------------------------------------------------------------ */
/* Facts code counts for Jev                                          */
/* ------------------------------------------------------------------ */

export interface ParaFacts {
  words: number;
  sentences: number;
  wordsPerSentence: number;
  /** Share of words with three or more syllables, 0..1. */
  longWords: number;
  numbers: number;
  /** if, or, unless, and, when, plus semicolons: how many conditions, options or items run together. */
  joins: number;
  links: number;
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length);
}

export function paraFacts(text: string): ParaFacts {
  const plain = stripMarkers(text);
  const words = plain.match(/[A-Za-z0-9][A-Za-z0-9’'.,%$-]*/g) ?? [];
  const sentences = Math.max(1, splitIntoSentences(plain).length);
  const alpha = words.filter((w) => /[A-Za-z]/.test(w));
  const long = alpha.filter((w) => syllables(w) >= 3).length;
  const numbers = (plain.match(/\d+(?:[.,:]\d+)*/g) ?? []).length;
  const joins = (plain.toLowerCase().match(/\b(?:if|or|unless|and|when)\b/g) ?? []).length + (plain.match(/;/g) ?? []).length;
  return {
    words: words.length,
    sentences,
    wordsPerSentence: Math.round((words.length / sentences) * 10) / 10,
    longWords: alpha.length ? Math.round((long / alpha.length) * 100) / 100 : 0,
    numbers,
    joins,
    links: markersIn(text).length,
  };
}

/** The facts as Jev reads them (plain words, code's numbers). */
function factsForJev(f: ParaFacts): Record<string, string | number> {
  return {
    words: f.words,
    sentences: f.sentences,
    average_words_per_sentence: f.wordsPerSentence,
    long_words: `${Math.round(f.longWords * 100)}% of words have 3 or more syllables`,
    numbers: f.numbers,
    if_or_unless_and_when: f.joins,
  };
}

/* ------------------------------------------------------------------ */
/* Score: need and how, per paragraph                                  */
/* ------------------------------------------------------------------ */

export const Q_REWORD_NEED = 'Would THIS reader find this paragraph harder to read than it needs to be?';
export const NEED_CRITERIA = Object.freeze({
  true:
    'Harder than it needs to be for this reader: it uses terms or jargon from a field this reader is new to without saying what they mean, runs long sentences for this reader, packs several steps, options or conditions into sentences when this reader likes steps, is longer than this reader likes, or hides the answer this reader wants first.',
  false:
    "Already right for this reader: they know this field's words, the sentences are short and clear for them, it is a quote, a caption, a byline or a short note, or changing it would lose precision this reader wants. A paragraph that is merely about a topic the reader knows well is not hard for them.",
});

export const Q_REWORD_HOW = 'Which one change would make this paragraph easiest for THIS reader to read, without losing anything it says?';
export const HOW_CRITERIA: Readonly<Record<RewordKind | 'keep', string>> = Object.freeze({
  keep: 'Keep it as it is, not change it: it already suits this reader, it is a quote, caption or byline, or rewording would lose precise wording this reader wants.',
  plain:
    'Plain words, not a new shape: the trouble is terms, jargon or long sentences this reader would struggle with; the paragraph is one idea, not a set of steps or options.',
  list:
    'Steps or items, not running prose: the paragraph packs two or more steps, options, conditions or items into sentences, and this reader likes steps or bullet points.',
  shorter:
    'Shorter, not simpler: the words are fine for this reader but the paragraph is wordy or repeats itself, and this reader wants short text.',
  point_first:
    'Main point first, not reworded: the answer or the action this reader needs comes only at the end, after background, and this reader wants the direct answer first.',
});

export const needId = (id: string): string => `need_${id}`;
export const howId = (id: string): string => `how_${id}`;

export interface RewordJevCall {
  state: unknown;
  questions: Record<string, JevQuestion>;
}

/** One call per SCORE_SPLIT_AT paragraphs (at most two for SCORE_MAX_PARAS); the same state in each. */
export function buildScoreCall(brief: string, page: RewordPage, paras: RewordParaIn[]): RewordJevCall[] {
  const list = paras.slice(0, SCORE_MAX_PARAS);
  const state = {
    reader: brief,
    page: { title: page.title, site: page.host, kind: page.purpose ?? 'unknown' },
    note: 'Each question holds one paragraph from this page. ⟦1⟧, ⟦2⟧ … stand for links on the page (link_words gives their words when known). Judge for this reader only.',
  };
  const chunks: RewordParaIn[][] = [];
  if (list.length <= SCORE_SPLIT_AT) chunks.push(list);
  else {
    const half = Math.ceil(list.length / 2);
    chunks.push(list.slice(0, half), list.slice(half));
  }
  return chunks
    .filter((c) => c.length > 0)
    .map((chunk) => {
      const questions: Record<string, JevQuestion> = {};
      for (const p of chunk) {
        const links = linkWords(p);
        const ins = { question: Q_REWORD_NEED, paragraph: p.text, ...(links ? { link_words: links } : {}), facts: factsForJev(paraFacts(p.text)) };
        questions[needId(p.id)] = { type: 'noul', instructions: ins, criteria: { true: NEED_CRITERIA.true, false: NEED_CRITERIA.false } };
        questions[howId(p.id)] = {
          type: 'choice',
          instructions: { ...ins, question: Q_REWORD_HOW },
          criteria: { ...HOW_CRITERIA },
        };
      }
      return { state, questions };
    });
}

const KEYS: ReadonlyArray<RewordKind | 'keep'> = ['keep', ...REWORD_KINDS];

/**
 * Code's pick from Jev's answers: need >= needMin, the best non-keep change beats keep and reaches kindMin; a list
 * only when the paragraph has two or more joins or three or more sentences (else the next best change); paragraphs
 * under minWords stay as they are.
 */
export function pickChange(need: number, how: Record<RewordKind | 'keep', number>, facts: ParaFacts): RewordKind | null {
  if (facts.words < REWORD_PICK.minWords) return null;
  if (need < REWORD_PICK.needMin) return null;
  const listable = facts.joins >= REWORD_PICK.listMinItems || facts.sentences >= 3;
  const ranked = REWORD_KINDS.filter((k) => k !== 'list' || listable).sort((a, b) => (how[b] ?? 0) - (how[a] ?? 0));
  const best = ranked[0];
  if (!best) return null;
  const p = how[best] ?? 0;
  return p >= REWORD_PICK.kindMin && p > (how.keep ?? 0) ? best : null;
}

/** Scores for every paragraph asked (missing answers: need 0, keep 1, no change). */
export function parseScore(paras: RewordPara[], responses: JevResponse[]): RewordScore[] {
  const merged: JevResponse = { model: responses[0]?.model ?? '', answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
  for (const r of responses) Object.assign(merged.answers, r?.answers ?? {});
  return paras.slice(0, SCORE_MAX_PARAS).map((p) => {
    const need = noulOf(merged, needId(p.id));
    const c = choiceOf(merged, howId(p.id));
    const how = Object.fromEntries(KEYS.map((k) => [k, c?.probs[k] ?? (k === 'keep' ? 1 : 0)])) as Record<RewordKind | 'keep', number>;
    if (need === null || !c) return { id: p.id, need: need ?? 0, how, pick: null };
    return { id: p.id, need, how, pick: pickChange(need, how, paraFacts(p.text)) };
  });
}

/* ------------------------------------------------------------------ */
/* Ground: is each point supported by the AI's answer?                 */
/* ------------------------------------------------------------------ */

export const Q_SUPPORT = "Does the AI assistant's answer support this statement about the person it describes?";
export const SUPPORT_CRITERIA = Object.freeze({
  true: 'Supported: the answer says this about the person, or clearly shows it with a stated habit or an example from their conversations.',
  false:
    'Not supported: the answer does not say this, says something different, or the statement goes beyond it (a guess about causes, health, age, job or personal details the answer does not give).',
});

export const supportId = (id: string): string => `support_${id}`;

export function buildGroundCall(answerText: string, points: Array<Pick<ReaderPoint, 'id' | 'says' | 'evidence'>>): RewordJevCall {
  const questions: Record<string, JevQuestion> = {};
  for (const p of points) {
    questions[supportId(p.id)] = {
      type: 'noul',
      instructions: { question: Q_SUPPORT, statement: p.says, quoted_from_the_answer: p.evidence },
      criteria: { true: SUPPORT_CRITERIA.true, false: SUPPORT_CRITERIA.false },
    };
  }
  return {
    state: { ai_answer: answerText, note: 'ai_answer is what a person\'s AI assistant wrote about how that person likes things explained. In each statement, "you" is that person.' },
    questions,
  };
}

/** Support per point id (missing: 0, so the point is dropped). */
export function parseGround(ids: string[], resp: JevResponse): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, noulOf(resp, supportId(id)) ?? 0]));
}

/* ------------------------------------------------------------------ */
/* Rewrite check: dropped and added, per rewritten paragraph           */
/* ------------------------------------------------------------------ */

export const Q_DROPPED =
  'Does the new version leave out any fact, number, date, name, condition, limit or warning that the original states?';
export const DROPPED_CRITERIA = Object.freeze({
  true: 'Something is missing or weakened: a fact, number, date, deadline, name, condition (if, unless, only), limit or warning in the original is not in the new version, or is said less strictly.',
  false:
    'Nothing is missing: every fact, number, date, name, condition, limit and warning of the original is in the new version, even if it is said in other words, split into items, or in a different order.',
});

export const Q_ADDED = 'Does the new version state a new claim (a fact, number, promise or advice) that the original does not state?';
export const ADDED_CRITERIA = Object.freeze({
  true: 'Something is new: a fact, number, date, promise, recommendation or consequence that the original does not state, or a claim that says something different from the original.',
  false:
    'Nothing is new: the new version only says what the original says, in other words, in another order or as a list. A short meaning of a word, given in passing, is not a new claim.',
});

export const droppedId = (id: string): string => `dropped_${id}`;
export const addedId = (id: string): string => `added_${id}`;

export function buildRewriteCheckCall(
  items: Array<{ id: string; original: string; rewrite: string; links?: Record<string, string> | null }>,
): RewordJevCall {
  const questions: Record<string, JevQuestion> = {};
  for (const it of items) {
    const links = it.links ? { link_words: it.links } : {};
    questions[droppedId(it.id)] = {
      type: 'noul',
      instructions: { question: Q_DROPPED, original: it.original, new_version: it.rewrite, ...links },
      criteria: { true: DROPPED_CRITERIA.true, false: DROPPED_CRITERIA.false },
    };
    questions[addedId(it.id)] = {
      type: 'noul',
      instructions: { question: Q_ADDED, original: it.original, new_version: it.rewrite, ...links },
      criteria: { true: ADDED_CRITERIA.true, false: ADDED_CRITERIA.false },
    };
  }
  return {
    state: {
      note: 'Each question compares a paragraph from a web page (original) with a version rewritten for one reader (new_version). ⟦1⟧, ⟦2⟧ … are the same links in both. Lines in the new version are list items.',
    },
    questions,
  };
}

/** dropped and added per id (missing answers: 1, so the rewrite fails). */
export function parseRewriteCheck(ids: string[], resp: JevResponse): Record<string, { dropped: number; added: number }> {
  return Object.fromEntries(ids.map((id) => [id, { dropped: noulOf(resp, droppedId(id)) ?? 1, added: noulOf(resp, addedId(id)) ?? 1 }]));
}
