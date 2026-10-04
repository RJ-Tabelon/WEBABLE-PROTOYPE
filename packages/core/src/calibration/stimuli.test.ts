import { describe, expect, it } from 'vitest';

import { seededRandom } from './pointing';
import {
  CONTRAST_WORDS,
  FIND_TEXT_PASSAGES,
  passageLayout,
  READING_SENTENCES,
  shuffleStimuli,
} from './stimuli';

const words = (s: string) =>
  s.replace(/[.,]/g, '').split(/\s+/).filter(Boolean);

/** Topics the bank must stay away from, and clinical or exam words. */
const DENYLIST =
  /\b(money|price|pay|bank|dollar|cash|doctor|nurse|hospital|medicine|pill|sick|ill|health|vote|election|president|government|war|police|test|score|normal)\b/i;

describe('reading sentences', () => {
  it('has at least 36 unique sentences, balanced between true and false', () => {
    expect(READING_SENTENCES.length).toBeGreaterThanOrEqual(36);
    expect(new Set(READING_SENTENCES.map((s) => s.id)).size).toBe(
      READING_SENTENCES.length,
    );
    expect(new Set(READING_SENTENCES.map((s) => s.text)).size).toBe(
      READING_SENTENCES.length,
    );
    const trues = READING_SENTENCES.filter((s) => s.answer).length;
    expect(trues).toBe(READING_SENTENCES.length - trues);
  });

  it.each(READING_SENTENCES.map((s) => [s.id, s.text] as const))(
    '%s is 9-11 words and 55-60 characters',
    (_id, text) => {
      expect(text.length).toBeGreaterThanOrEqual(55);
      expect(text.length).toBeLessThanOrEqual(60);
      expect(words(text).length).toBeGreaterThanOrEqual(9);
      expect(words(text).length).toBeLessThanOrEqual(11);
      expect(text).toMatch(/^[A-Z][a-z ,]+\.$/);
      expect(text).not.toMatch(DENYLIST);
    },
  );
});

describe('contrast words', () => {
  it('has at least 24 common five-letter words with three same-length distractors', () => {
    expect(CONTRAST_WORDS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(CONTRAST_WORDS.map((w) => w.word)).size).toBe(
      CONTRAST_WORDS.length,
    );
    for (const w of CONTRAST_WORDS) {
      expect(w.word).toMatch(/^[a-z]{5}$/);
      expect(w.distractors).toHaveLength(3);
      for (const d of w.distractors) expect(d).toMatch(/^[a-z]{5}$/);
      expect(new Set([w.word, ...w.distractors]).size).toBe(4);
      expect(w.id).toBe(w.word);
    }
  });
});

describe('find-in-text passages', () => {
  it('has four passages of about 120 words with a valid answer and choices', () => {
    expect(FIND_TEXT_PASSAGES).toHaveLength(4);
    for (const p of FIND_TEXT_PASSAGES) {
      const count = words(p.sentences.join(' ')).length;
      expect(count).toBeGreaterThanOrEqual(105);
      expect(count).toBeLessThanOrEqual(135);
      expect(p.answerIndex).toBeGreaterThanOrEqual(0);
      expect(p.answerIndex).toBeLessThan(p.sentences.length);
      expect(p.choices).toContain(p.answerIndex);
      expect(new Set(p.choices).size).toBe(3);
      for (const c of p.choices) expect(p.sentences[c]).toBeDefined();
      expect(p.question.endsWith('?')).toBe(true);
      expect(p.sentences.join(' ')).not.toMatch(DENYLIST);
    }
  });

  it('chunks every sentence exactly once, in order, and bolds terms that exist', () => {
    for (const p of FIND_TEXT_PASSAGES) {
      expect(p.chunked.paragraphs).toHaveLength(3);
      expect(p.chunked.paragraphs.flat()).toEqual(
        p.sentences.map((_s, i) => i),
      );
      for (const term of p.chunked.keyTerms)
        expect(p.sentences.join(' ')).toContain(term);
    }
  });

  it('lays out dense and chunked variants with scorable sentence indices', () => {
    const p = FIND_TEXT_PASSAGES[0];
    if (!p) throw new Error('missing passage');
    const dense = passageLayout(p, 'dense');
    expect(dense.heading).toBeNull();
    expect(dense.paragraphs).toHaveLength(1);
    expect(
      dense.paragraphs[0]?.every((s) => s.runs.every((r) => !r.strong)),
    ).toBe(true);

    const chunked = passageLayout(p, 'chunked');
    expect(chunked.heading).toBe(p.chunked.heading);
    expect(chunked.paragraphs).toHaveLength(3);
    const answer = chunked.paragraphs
      .flat()
      .find((s) => s.index === p.answerIndex);
    expect(answer?.runs.map((r) => r.text).join('')).toBe(
      p.sentences[p.answerIndex],
    );
    expect(answer?.runs.some((r) => r.strong && r.text === 'three weeks')).toBe(
      true,
    );
  });
});

describe('shuffleStimuli', () => {
  it('is a deterministic permutation for a given seed', () => {
    const a = shuffleStimuli(READING_SENTENCES, seededRandom(4));
    const b = shuffleStimuli(READING_SENTENCES, seededRandom(4));
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      [...READING_SENTENCES].sort((x, y) => x.id.localeCompare(y.id)),
    );
    expect(a).not.toEqual(READING_SENTENCES);
  });
});
