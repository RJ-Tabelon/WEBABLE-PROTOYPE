import { describe, expect, it, vi } from 'vitest';

import {
  DATA_ERROR_MESSAGES,
  fail,
  guarded,
  issuePaths,
  jsonbTextBytes,
  mapPostgrestError,
  ok,
} from './result';

describe('mapPostgrestError', () => {
  it.each([
    [{ code: '', message: 'TypeError: fetch failed' }, 'unavailable'],
    [{ code: '42501' }, 'not_signed_in'],
    [{ code: 'PGRST301' }, 'not_signed_in'],
    [{ code: 'PGRST116' }, 'not_found'],
    [{ code: '23505' }, 'conflict'],
    [{ code: '40001' }, 'conflict'],
    [{ code: '23514' }, 'invalid_input'],
    [{ code: '23503' }, 'invalid_input'],
    [{ code: '22023' }, 'invalid_input'],
    [{ code: '22P02' }, 'invalid_input'],
    [{ code: '57014' }, 'unavailable'],
    [{ code: '08006' }, 'unavailable'],
    [{ code: 'XX000' }, 'unknown'],
  ])('%j -> %s', (error, expected) => {
    expect(mapPostgrestError(error)).toBe(expected);
  });

  it('treats a missing error object as an outage', () => {
    expect(mapPostgrestError(null)).toBe('unavailable');
  });
});

describe('fail and ok', () => {
  it('attaches the plain-language message and optional issues', () => {
    expect(fail('conflict')).toEqual({
      ok: false,
      error: { code: 'conflict', message: DATA_ERROR_MESSAGES.conflict },
    });
    expect(fail('invalid_input', ['modules.reading'])).toMatchObject({
      error: { issues: ['modules.reading'] },
    });
    expect(fail('invalid_input', [])).not.toHaveProperty('error.issues');
    expect(ok(3)).toEqual({ ok: true, data: 3 });
  });
});

describe('issuePaths', () => {
  it('joins paths and caps the list', () => {
    expect(issuePaths([{ path: ['a', 0, 'b'] }, { path: [] }])).toEqual([
      'a.0.b',
      '(root)',
    ]);
    expect(
      issuePaths(Array.from({ length: 30 }, () => ({ path: ['x'] }))),
    ).toHaveLength(10);
  });
});

describe('jsonbTextBytes', () => {
  // Expected values were checked against Postgres: octet_length(x::jsonb::text).
  it('matches the way Postgres prints jsonb', () => {
    expect(jsonbTextBytes({ a: 1, b: [1, 2] })).toBe(
      '{"a": 1, "b": [1, 2]}'.length,
    );
    expect(
      jsonbTextBytes({
        a: [1, 2, { b: 'é\n"x"' }],
        c: null,
        d: true,
        e: 1.25,
        f: [],
        g: {},
      }),
    ).toBe(84);
    expect(jsonbTextBytes([])).toBe(2);
    expect(jsonbTextBytes('é')).toBe(4);
  });

  it('ignores undefined properties like JSON does', () => {
    expect(jsonbTextBytes({ a: 1, b: undefined })).toBe(
      jsonbTextBytes({ a: 1 }),
    );
    expect(jsonbTextBytes(undefined)).toBe(0);
  });
});

describe('guarded', () => {
  it('turns an unexpected throw into an unknown error without leaking it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await guarded('x', async () => {
      throw new TypeError('secret detail');
    });
    expect(result).toEqual(fail('unknown'));
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret detail');
  });
});
