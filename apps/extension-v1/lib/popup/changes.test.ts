import type { AppliedChange, PlannedOp } from '@webable/core/policy/types';
import { describe, expect, it } from 'vitest';

import { fitValue, isApplied, redoableOps, targetLimited } from './format';

const change = (
  op: AppliedChange['op'],
  status: AppliedChange['status'] = 'applied',
  extra: Partial<AppliedChange> = {},
): AppliedChange => ({
  op,
  level: 2,
  mode: 'auto',
  status,
  count: 2,
  trace: {
    op,
    mode: 'auto',
    source: 'profile' as PlannedOp['trace']['source'],
    level: 2,
    p: 0.9,
    pOk: 0.9,
    why: 't',
    evidence: [],
  },
  ...extra,
});

describe('motion fit marks', () => {
  it('reads "2 moving" -> "0 moving" as 2 -> 0 moving, like the toast and tag', () => {
    expect(
      fitValue(
        change('calm_motion', 'applied', {
          fit: { before: '2 moving', after: '0 moving' },
        }),
      ),
    ).toEqual({ from: '2', to: '0', unit: 'moving' });
  });

  it('reads autoplay as 2 -> 0 playing', () => {
    expect(
      fitValue(
        change('pause_media', 'applied', {
          fit: { before: '2 playing', after: '0 playing' },
        }),
      ),
    ).toEqual({ from: '2', to: '0', unit: 'playing' });
  });

  it('keeps symbol units and ratios as before', () => {
    expect(
      fitValue(
        change('text_floor', 'applied', {
          fit: { before: '13px', after: '18 px' },
        }),
      ),
    ).toEqual({ from: '13', to: '18', unit: 'px' });
    expect(
      fitValue(
        change('contrast', 'applied', {
          fit: { before: '3.2:1', after: '4.5:1' },
        }),
      ),
    ).toEqual({ to: '4.5:1' });
  });
});

describe('click targets limited by nearby buttons', () => {
  const targets = (
    after: string,
    status: AppliedChange['status'] = 'applied',
  ) => change('target_size', status, { fit: { before: '28 px', after } });

  it('is limited when the measured after value is under 44 px', () => {
    expect(targetLimited(targets('36 px'))).toBe(true);
    expect(targetLimited(targets('43.5px'))).toBe(true);
  });

  it('is not limited at 44 px or more, without a measure, or when not applied', () => {
    expect(targetLimited(targets('44 px'))).toBe(false);
    expect(targetLimited(targets('48 px'))).toBe(false);
    expect(targetLimited(change('target_size'))).toBe(false);
    expect(targetLimited(targets('36 px', 'undone_by_checks'))).toBe(false);
    expect(
      targetLimited(
        change('text_floor', 'applied', {
          fit: { before: '13 px', after: '18 px' },
        }),
      ),
    ).toBe(false);
  });
});

describe('undone rows and accents', () => {
  it('lists every op the person undid that is not back on the page, in undo order', () => {
    const changes = [
      change('text_floor', 'undone_by_checks'),
      change('line_spacing'),
    ];
    expect(
      redoableOps(['target_size', 'text_floor', 'line_spacing'], changes),
    ).toEqual(['target_size', 'text_floor']);
  });

  it('counts only applied changes as real changes', () => {
    const changes = [
      change('text_floor', 'undone_by_checks'),
      change('line_spacing'),
    ];
    expect(isApplied(changes, 'text_floor')).toBe(false);
    expect(isApplied(changes, 'line_spacing')).toBe(true);
    expect(isApplied(changes, 'target_size')).toBe(false);
  });
});
