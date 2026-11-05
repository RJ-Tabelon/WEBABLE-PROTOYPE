import { describe, expect, it } from 'vitest';
import { evidenceObject, safeClassWords } from '../../src/index';
import type { ElementEvidence } from '../../src/types';

describe('class words sent as evidence', () => {
  it('drops ids that carry a medication name and keeps structure words', () => {
    expect(safeClassWords(['rx', 'atorvastatin'])).toEqual(['rx']);
    expect(safeClassWords(['upsell', 'btn', 'promo', 'hero'])).toEqual(['upsell', 'btn', 'promo', 'hero']);
  });

  it('the server-side evidence object never carries an unknown long word', () => {
    const e = {
      id: 'e1', tag: 'input', role_hint: 'checkbox', label: 'x', zone: 'main', landmark: 'main', size: '20 x 20 px',
      position: 'top', fixed: false, class_words: ['rx-lisinopril', 'rx'], visual_weight: 0.2,
    } as unknown as ElementEvidence;
    expect(evidenceObject(e).class_words).toEqual(['rx']);
  });
});
