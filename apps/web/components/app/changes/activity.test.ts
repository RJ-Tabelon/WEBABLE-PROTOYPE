import { describe, expect, it } from 'vitest';

import { copyProblems } from '../../../lib/auth/copy-lint';
import {
  type ActivityRow,
  detailFor,
  groupByOp,
  rowsForWeek,
  sentencesFor,
  summarize,
  zeroCounts,
} from './activity';

function row(
  week: string,
  op: string,
  counts: Partial<ActivityRow> = {},
): ActivityRow {
  return { ...zeroCounts(), week, op, ...counts };
}

const rows: ActivityRow[] = [
  row('2026-09-21', 'text_floor', { applied: 30, kept: 29, undone: 1 }),
  row('2026-09-28', 'text_floor', { applied: 48, kept: 46, undone: 2 }),
  row('2026-09-28', 'line_spacing', { applied: 12, undoneByChecks: 1 }),
  row('2026-09-28', 'target_size', { offered: 3, accepted: 2, applied: 2 }),
  row('2026-09-28', 'mystery_op', { applied: 1 }),
  row('2026-09-28', 'contrast'),
];

describe('detailFor', () => {
  it('reads as a calm line, with once and twice in words', () => {
    expect(detailFor({ ...zeroCounts(), applied: 48, undone: 2 })).toBe(
      'Applied 48\u00a0times · you undid it twice',
    );
    expect(detailFor({ ...zeroCounts(), applied: 1, undoneByChecks: 1 })).toBe(
      'Applied once · undone once by WebAble’s checks',
    );
    expect(detailFor({ ...zeroCounts(), offered: 3 })).toBe(
      'Asked 3\u00a0times, you said not now',
    );
  });
});

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

describe('sentencesFor', () => {
  it('says what happened this week', () => {
    const { sentences, totals } = summarize(
      rowsForWeek(rows, '2026-09-28'),
      'this week',
    );
    expect(totals.applied).toBe(63);
    expect(sentences).toEqual([
      'WebAble made 63\u00a0changes this week.',
      'You undid 2 of them.',
      'WebAble’s checks put 1 back because it didn’t fit the page.',
      'WebAble asked before 3\u00a0changes. You said yes to 2.',
    ]);
    for (const sentence of sentences)
      expect(copyProblems(sentence), sentence).toEqual([]);
  });

  it('handles kept-everything, plural checks, and nothing at all', () => {
    expect(sentencesFor({ ...zeroCounts(), applied: 1 }, 'this week')).toEqual([
      'WebAble made 1\u00a0change this week.',
      'You kept it.',
    ]);
    expect(sentencesFor({ ...zeroCounts(), applied: 4 }, 'this week')[1]).toBe(
      'You kept every one of them.',
    );
    // Reversed by the checks is not "kept": say only what the person did.
    expect(
      sentencesFor(
        { ...zeroCounts(), applied: 4, undoneByChecks: 1 },
        'this week',
      )[1],
    ).toBe('You didn’t undo any of them.');
    expect(
      sentencesFor(
        { ...zeroCounts(), applied: 5, undoneByChecks: 2 },
        'this week',
      )[2],
    ).toBe('WebAble’s checks put 2 back because they didn’t fit the page.');
    expect(sentencesFor(zeroCounts(), 'this week')).toEqual([]);
  });
});
