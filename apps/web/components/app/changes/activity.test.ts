import { describe, expect, it } from 'vitest';

import { copyProblems } from '../../../lib/auth/copy-lint';
import {
  type ActivityRow,
  activityTable,
  askedLine,
  groupByOp,
  narrowCounts,
  rowsForWeek,
  totalsOf,
  weekSentence,
  zeroCounts,
} from './activity';

function row(
  week: string,
  op: string,
  counts: Partial<ActivityRow> = {},
): ActivityRow {
  return { ...zeroCounts(), week, op, ...counts };
}

const THIS_WEEK = '2026-09-28';
const rows: ActivityRow[] = [
  row('2026-09-21', 'text_floor', { applied: 30, kept: 29, undone: 1 }),
  row(THIS_WEEK, 'text_floor', { applied: 48, kept: 46, undone: 2 }),
  row(THIS_WEEK, 'line_spacing', { applied: 12, undoneByChecks: 1 }),
  row(THIS_WEEK, 'target_size', { offered: 3, accepted: 2, applied: 2 }),
  row(THIS_WEEK, 'mystery_op', { applied: 1 }),
  row(THIS_WEEK, 'contrast'),
];

describe('groupByOp', () => {
  it('groups by op, most applied first, unknown ops last and empty rows dropped', () => {
    const items = groupByOp(rows);
    expect(items.map((i) => i.key)).toEqual([
      'text_floor',
      'line_spacing',
      'target_size',
      'other',
    ]);
    expect(items[0]).toMatchObject({ label: 'Text size' });
    expect(items[0]?.counts.applied).toBe(78);
    expect(items.at(-1)).toMatchObject({ label: 'Other changes' });
  });
});

describe('activityTable', () => {
  it('puts this week beside the whole period, one row per kind of change', () => {
    const table = activityTable(rows, THIS_WEEK);
    expect(table.map((r) => r.key)).toEqual([
      'text_floor',
      'line_spacing',
      'target_size',
      'other',
    ]);
    expect(table[0]?.week.applied).toBe(48);
    expect(table[0]?.period.applied).toBe(78);
    expect(table[0]?.period.undone).toBe(3);
    expect(table[1]?.period.undoneByChecks).toBe(1);
  });

  it('reads as one line on narrow screens', () => {
    const [text, spacing] = activityTable(rows, THIS_WEEK);
    expect(text && narrowCounts(text, 8)).toBe(
      '48 this week · 78 in 8 weeks · you undid 3',
    );
    expect(spacing && narrowCounts(spacing, 8)).toBe(
      '12 this week · 12 in 8 weeks · checks undid 1',
    );
  });
});

describe('weekSentence', () => {
  it('tells undo by the person and by the checks apart', () => {
    const week = totalsOf(rowsForWeek(rows, THIS_WEEK));
    expect(week.applied).toBe(63);
    const sentence = weekSentence(week);
    expect(sentence).toBe(
      '63 changes this week. You undid 2, and WebAble’s checks undid 1.',
    );
    expect(copyProblems(sentence), sentence).toEqual([]);
  });

  it('handles one change, kept changes and a quiet week', () => {
    expect(weekSentence({ ...zeroCounts(), applied: 1 })).toBe(
      '1 change this week. You kept it.',
    );
    expect(weekSentence({ ...zeroCounts(), applied: 4 })).toBe(
      '4 changes this week. You kept every one.',
    );
    expect(weekSentence({ ...zeroCounts(), applied: 4, undone: 1 })).toBe(
      '4 changes this week. You undid 1.',
    );
    expect(
      weekSentence({ ...zeroCounts(), applied: 5, undoneByChecks: 2 }),
    ).toBe('5 changes this week. WebAble’s checks undid 2.');
    expect(weekSentence(zeroCounts())).toBe('No changes this week.');
  });
});

describe('askedLine', () => {
  it('says how often WebAble asked first, and only when it did', () => {
    expect(askedLine({ ...zeroCounts(), offered: 3, accepted: 2 })).toBe(
      'Asked first: 3 · you said yes to 2',
    );
    expect(askedLine(zeroCounts())).toBeNull();
  });
});
