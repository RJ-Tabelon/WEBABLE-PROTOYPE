import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  formatDay,
  formatRelativeDay,
  formatShortDay,
  plural,
  splitValue,
  times,
} from './format';

describe('format', () => {
  it('formats days in UTC', () => {
    expect(formatDay('2026-09-29T23:30:00Z')).toBe('Sep 29, 2026');
    expect(formatShortDay('2026-01-02T00:00:00Z')).toBe('Jan 2');
    expect(formatDay('not a date')).toBe('');
  });

  it('formats relative days in local time', () => {
    const now = new Date(2026, 8, 29, 15, 0);
    expect(formatRelativeDay(new Date(2026, 8, 29, 8, 0), now)).toBe('Today');
    expect(formatRelativeDay(new Date(2026, 8, 28, 23, 0), now)).toBe(
      'Yesterday',
    );
    expect(formatRelativeDay(new Date(2026, 8, 20), now)).toBe('Sep 20');
    expect(formatRelativeDay(new Date(2025, 11, 31), now)).toBe('Dec 31, 2025');
  });

  it('counts in words and digits with units', () => {
    expect(times(1)).toBe('once');
    expect(times(2)).toBe('twice');
    expect(times(3)).toBe('3\u00a0times');
    expect(plural(1, 'change')).toBe('1\u00a0change');
    expect(plural(4, 'change')).toBe('4\u00a0changes');
    expect(formatBytes(1)).toBe('1\u00a0byte');
    expect(formatBytes(812)).toBe('812\u00a0bytes');
    expect(formatBytes(1234)).toBe('1.2\u00a0KB');
    expect(formatBytes(12_345)).toBe('12\u00a0KB');
  });

  it('splits a value from its unit at the no-break space', () => {
    expect(splitValue('18\u00a0px')).toEqual({ value: '18', unit: 'px' });
    expect(splitValue('80\u00a0characters')).toEqual({
      value: '80',
      unit: 'characters',
    });
    expect(splitValue('7:1')).toEqual({ value: '7:1', unit: null });
  });
});
