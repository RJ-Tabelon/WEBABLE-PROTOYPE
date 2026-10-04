import { defaultFitProfile } from '@webable/core';
import { describe, expect, it } from 'vitest';

import { applyValue } from './adjust';
import { describeHistory, type HistoryInput, sourceLabel } from './history';

const v1 = defaultFitProfile(undefined, new Date('2026-09-20T10:00:00Z'));
const v2 = applyValue(v1, { row: 'textSize', value: 21 });
const v3 = applyValue(v2, { row: 'targets', value: 56 });

const entries: HistoryInput[] = [
  {
    id: 'c',
    version: 3,
    source: 'adjustment',
    createdAt: '2026-09-29T09:00:00Z',
    isCurrent: true,
    profile: v3,
  },
  {
    id: 'b',
    version: 2,
    source: 'recalibration',
    createdAt: '2026-09-25T09:00:00Z',
    isCurrent: false,
    profile: v2,
  },
  {
    id: 'a',
    version: 1,
    source: 'calibration',
    createdAt: '2026-09-20T09:00:00Z',
    isCurrent: false,
    profile: v1,
  },
];

describe('describeHistory', () => {
  it('lists what each version changed from the one before', () => {
    const items = describeHistory(entries, true);
    expect(items.map((i) => i.version)).toEqual([3, 2, 1]);
    expect(items[0]).toMatchObject({
      sourceLabel: 'Adjusted by you',
      date: 'Sep 29, 2026',
      isCurrent: true,
      first: false,
    });
    expect(items[0]?.changes).toEqual([
      expect.objectContaining({
        id: 'targets',
        before: '24\u00a0px',
        after: '56\u00a0px',
      }),
    ]);
    expect(items[1]?.changes.map((c) => c.id)).toEqual(['textSize']);
    expect(items[2]).toMatchObject({
      first: true,
      changes: [],
      sourceLabel: 'From Tune',
    });
  });

  it('says what using an earlier version would change, from the current fit', () => {
    const items = describeHistory(entries, true);
    expect(items[0]?.restore).toBeNull();
    expect(items[2]?.restore?.map((c) => [c.id, c.before, c.after])).toEqual([
      ['textSize', '21\u00a0px', '16\u00a0px'],
      ['targets', '56\u00a0px', '24\u00a0px'],
    ]);
    expect(items[2]?.restore?.[0]?.value).toMatchObject({
      kind: 'change',
      before: '21',
      after: '16',
      unit: 'px',
    });
  });

  it('does not call a truncated oldest entry the first fit', () => {
    const items = describeHistory(entries.slice(0, 2), false);
    expect(items[1]?.first).toBe(false);
  });

  it('marks versions that no longer parse', () => {
    const items = describeHistory(
      [{ ...entries[0]!, profile: null }, entries[1]!],
      true,
    );
    expect(items[0]).toMatchObject({ unreadable: true, changes: [] });
  });

  it('labels every source', () => {
    expect(sourceLabel('recalibration')).toBe('Tuned again');
    expect(sourceLabel('learned')).toBe('Learned as you browse');
    expect(sourceLabel('import')).toBe('Imported');
    expect(sourceLabel('restore')).toBe('An earlier version, used again');
  });
});
