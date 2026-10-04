import { describe, expect, it } from 'vitest';
import {
  ADAPTATIONS,
  DECISION_EVIDENCE,
  NOT_OFFERED,
  SOURCES,
  SOURCE_BY_ID,
  TUNE_EVIDENCE,
} from './research-data';

const ALL = [
  ...ADAPTATIONS,
  ...TUNE_EVIDENCE,
  ...DECISION_EVIDENCE,
  ...NOT_OFFERED,
];

describe('research data', () => {
  it('has unique source and item ids', () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
    expect(new Set(ALL.map((i) => i.id)).size).toBe(ALL.length);
  });

  it('cites only listed sources, and lists only cited sources', () => {
    const cited = new Set(ALL.flatMap((i) => i.sources));
    for (const id of cited) expect(SOURCE_BY_ID.has(id), id).toBe(true);
    for (const s of SOURCES) expect(cited.has(s.id), s.id).toBe(true);
  });

  it('links every source over https', () => {
    for (const s of SOURCES)
      expect(new URL(s.url).protocol, s.id).toBe('https:');
  });

  it('gives every item at least one source', () => {
    for (const item of ALL)
      expect(item.sources.length, item.id).toBeGreaterThan(0);
  });

  it('sums up every change in a few words for the summary table', () => {
    for (const item of ADAPTATIONS) {
      expect(item.summary, item.id).toBeTruthy();
      expect(item.summary!.split(' ').length, item.id).toBeLessThanOrEqual(8);
    }
  });

  it('says which way the evidence points for ideas WebAble leaves out', () => {
    for (const item of NOT_OFFERED) {
      // Consensus alone is not evidence against anything.
      expect(item.polarity ?? 'for', item.id).toBe(
        item.strength === 'Consensus only' ? 'for' : 'against',
      );
    }
    for (const item of [...ADAPTATIONS, ...TUNE_EVIDENCE, ...DECISION_EVIDENCE])
      expect(item.polarity ?? 'for', item.id).toBe('for');
  });

  it('never names a condition or makes a conformance claim', () => {
    const text = ALL.map(
      (i) =>
        `${i.title} ${i.finding} ${i.practice} ${i.gap ?? ''} ${i.summary ?? ''}`,
    ).join(' ');
    expect(text).not.toMatch(
      /\b(disabilit\w*|impairment\w*|patients?|dyslexi\w*|ADHD|cataract\w*|tremor\w*|diagnos\w*)\b/i,
    );
    expect(text).not.toMatch(/\b(compliant|compliance|conformant)\b/i);
    for (const s of SOURCES) {
      expect(s.cite).not.toMatch(
        /\b(disabilit\w*|impairment\w*|dyslexi\w*|ADHD)\b/i,
      );
    }
  });
});
