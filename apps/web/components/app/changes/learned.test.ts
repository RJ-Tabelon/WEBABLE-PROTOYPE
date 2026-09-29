import { describe, expect, it } from 'vitest';

import { dayOf, learnedRows, learnedSummary } from './learned';

const TODAY = dayOf(new Date('2026-09-29T00:00:00Z'));

describe('learnedSummary', () => {
  it('reports clear keep and undo patterns, blocks and pins', () => {
    const summary = learnedSummary(
      {
        ops: {
          text_floor: { c: { s: 9, f: 1, t: TODAY }, src: 'profile' },
          line_spacing: { c: { s: 1, f: 6, t: TODAY }, src: 'none' },
          contrast: { c: { s: 2, f: 2, t: TODAY } },
          target_size: { c: { s: 1, f: 0, t: TODAY } },
          dim_distractions: { c: { s: 0, f: 0, t: TODAY }, blocked: true },
          reading_guide: { c: { s: 0, f: 0, t: TODAY }, src: 'pinned' },
        },
        dims: {},
      },
      TODAY,
    );
    expect(summary.ops).toEqual([
      {
        op: 'text_floor',
        label: 'Text size',
        sentence: 'You usually keep this change.',
      },
      {
        op: 'line_spacing',
        label: 'Line spacing',
        sentence: 'You usually undo this change.',
      },
      {
        op: 'contrast',
        label: 'Contrast',
        sentence: 'You keep this change about as often as you undo it.',
      },
      {
        op: 'dim_distractions',
        label: 'Busy areas',
        sentence: 'You turned this off everywhere.',
      },
      {
        op: 'reading_guide',
        label: 'Reading guide',
        sentence: 'You asked for this on every site.',
      },
    ]);
  });

  it('lets old evidence fade (90-day half-life)', () => {
    const old = learnedSummary(
      { ops: { text_floor: { c: { s: 4, f: 0, t: TODAY - 180 } } } },
      TODAY,
    );
    expect(old.ops).toEqual([]);
  });

  it('shows settled values only when they moved from Tune', () => {
    const summary = learnedSummary(
      {
        dims: {
          textPx: {
            m: Math.log(21),
            v: 0.01,
            mCal: Math.log(18),
            t: TODAY,
            vCal: 0.02,
          },
          targetPx: {
            m: Math.log(44.5),
            v: 0.01,
            mCal: Math.log(44),
            t: TODAY,
            vCal: 0.02,
          },
          unknownDim: { m: 1, v: 1, mCal: 0 },
        },
      },
      TODAY,
    );
    expect(summary.dims).toEqual([
      {
        dim: 'textPx',
        label: 'Text size',
        from: '18\u00a0px',
        to: '21\u00a0px',
        srText: '18 to 21 pixels',
      },
    ]);
  });

  it('tolerates missing or malformed state', () => {
    expect(learnedSummary(null, TODAY)).toEqual({ ops: [], dims: [] });
    expect(
      learnedSummary(
        { ops: { text_floor: 'nope' }, dims: { textPx: {} } },
        TODAY,
      ),
    ).toEqual({
      ops: [],
      dims: [],
    });
  });
});

describe('learnedRows', () => {
  it('puts a settled value and the change with the same label in one row', () => {
    const rows = learnedRows(
      learnedSummary(
        {
          ops: {
            text_floor: { c: { s: 9, f: 1, t: TODAY } },
            target_size: { c: { s: 1, f: 6, t: TODAY } },
          },
          dims: { textPx: { m: Math.log(21), v: 0.01, mCal: Math.log(18) } },
        },
        TODAY,
      ),
    );
    expect(
      rows.map((r) => [r.label, Boolean(r.dim), r.sentence ?? null]),
    ).toEqual([
      ['Text size', true, 'You usually keep this change.'],
      ['Click targets', false, 'You usually undo this change.'],
    ]);
    expect(rows[0]?.dim?.srText).toBe('18 to 21 pixels');
  });

  it('is empty when nothing has been learned', () => {
    expect(learnedRows({ ops: [], dims: [] })).toEqual([]);
  });
});
