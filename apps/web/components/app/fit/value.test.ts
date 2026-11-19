import { describe, expect, it } from 'vitest';

import type { FitRow } from '@webable/core/profile/describe';

import { diffValue, fitValueOf, splitShown, withAfter } from './value';

const row = (patch: Partial<FitRow>): FitRow => ({
  id: 'contrast',
  label: 'Contrast',
  value: { kind: 'floor', after: '7:1', srText: 'at least 7 to 1' },
  before: 'As the site made it',
  after: '7:1',
  srText: 'at least 7 to 1',
  changed: true,
  sentence: 'Faint text is darkened to at least 7:1 against its background.',
  source: 'Measured today',
  sourceKind: 'measured',
  confidence: 'medium',
  changesPages: true,
  ...patch,
});

describe('fit values for the app', () => {
  it('splits a number from its unit, and keeps words whole', () => {
    expect(splitShown('16 px')).toEqual({ n: '16', unit: 'px' });
    expect(splitShown('80 characters')).toEqual({
      n: '80',
      unit: 'characters',
    });
    expect(splitShown('Site colors')).toEqual({ n: 'Site colors' });
  });

  it('draws numbers in one unit as a change, anything else in words', () => {
    expect(diffValue('16 px', '18 px', 's')).toEqual({
      kind: 'change',
      before: '16',
      after: '18',
      unit: 'px',
      srText: 's',
    });
    expect(diffValue('4.5:1', '7:1', 's')).toMatchObject({
      kind: 'change',
      before: '4.5:1',
      after: '7:1',
    });
    expect(diffValue('Site colors', 'Dark', 's')).toEqual({
      kind: 'word',
      before: 'Site colors',
      after: 'Dark',
      srText: 's',
    });
  });

  it('draws the value core describes, and describes older rows itself', () => {
    expect(fitValueOf(row({}))).toEqual({
      kind: 'floor',
      after: '7:1',
      srText: 'at least 7 to 1',
    });
    const { value: _value, ...older } = row({
      before: '16\u00a0px',
      after: '19\u00a0px',
      srText: '16 to 19 pixels',
    });
    expect(fitValueOf(older)).toEqual({
      kind: 'change',
      before: '16',
      after: '19',
      unit: 'px',
      srText: '16 to 19 pixels',
    });
    const { value: _same, ...unchanged } = row({ changesPages: false });
    expect(fitValueOf(unchanged)).toEqual({
      kind: 'same',
      srText: 'at least 7 to 1',
    });
  });

  it('replaces only the after-value', () => {
    expect(
      withAfter(
        { kind: 'change', before: 16, after: 18, unit: 'px', srText: 'a' },
        21,
        'b',
      ),
    ).toEqual({
      kind: 'change',
      before: 16,
      after: 21,
      unit: 'px',
      srText: 'b',
    });
    expect(withAfter({ kind: 'same', srText: 'a' }, 21, 'b')).toEqual({
      kind: 'same',
      srText: 'a',
    });
  });
});
