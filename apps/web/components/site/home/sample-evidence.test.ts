import { regionEvidenceSchema } from '@webable/core/page/types';
import { DROPPED_MARK, VOCAB_V1 } from '@webable/core/page/vocab';
import { describe, expect, it } from 'vitest';
import { SAMPLE_REGION_EVIDENCE, payloadLines } from './sample-evidence';

describe('the sample payload shown on the website', () => {
  it('is a valid region description under the real contract', () => {
    expect(() =>
      regionEvidenceSchema.parse(SAMPLE_REGION_EVIDENCE),
    ).not.toThrow();
  });

  it('uses only public vocabulary words', () => {
    const words = [
      ...SAMPLE_REGION_EVIDENCE.class_words,
      ...SAMPLE_REGION_EVIDENCE.heading_words.split(' '),
      ...SAMPLE_REGION_EVIDENCE.control_words.flatMap((c) => c.split(' ')),
    ].filter((w) => w && w !== DROPPED_MARK);
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) expect(VOCAB_V1.has(word), word).toBe(true);
  });

  it('renders one line per field, in contract order', () => {
    const lines = payloadLines(SAMPLE_REGION_EVIDENCE);
    expect(lines.map((l) => l.key)).toEqual(
      Object.keys(SAMPLE_REGION_EVIDENCE),
    );
    expect(lines.find((l) => l.key === 'class_words')?.value).toBe(
      '["sidebar", "popular"]',
    );
    expect(lines.find((l) => l.key === 'video')?.value).toBe('false');
  });
});
