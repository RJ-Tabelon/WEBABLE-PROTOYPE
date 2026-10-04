import { defaultFitProfile } from '@webable/core';
import { fitRows } from '@webable/core/profile/describe';
import { describe, expect, it } from 'vitest';

import type { LearnedDim } from '../changes/learned';
import { applyValue } from './adjust';
import { learnedOverrides } from './learned-fit';

const now = new Date('2026-09-29T10:00:00Z');
const profile = applyValue(defaultFitProfile(undefined, now), {
  row: 'textSize',
  value: 18,
});
const rows = fitRows(profile, undefined, { now });

function dim(extra: Partial<LearnedDim>): LearnedDim {
  return {
    dim: 'textPx',
    label: 'Text size',
    from: '18 px',
    to: '20 px',
    srText: '18 to 20 pixels',
    toValue: 20,
    value: { kind: 'change', before: 18, after: 20, unit: 'px', srText: '' },
    ...extra,
  };
}

describe('learnedOverrides', () => {
  it('shows the value in effect, where the fit’s came from, and a way back', () => {
    const override = learnedOverrides(profile, rows, [dim({})]).get('textSize');
    expect(override?.dim).toBe('textPx');
    expect(override?.value).toMatchObject({ kind: 'change', after: 20 });
    expect(override?.source).toMatch(/: 18\spx · adjusted as you browse$/);
    expect(override?.useLabel).toMatch(/^Use 18\spx$/);
  });

  it('leaves a row alone when the learned value is the fit’s own', () => {
    expect(learnedOverrides(profile, rows, [dim({ toValue: 18.2 })]).size).toBe(
      0,
    );
  });

  it('ignores dimensions that no row shows', () => {
    expect(
      learnedOverrides(profile, rows, [
        dim({ dim: 'zoom' as LearnedDim['dim'] }),
      ]).size,
    ).toBe(0);
  });
});
