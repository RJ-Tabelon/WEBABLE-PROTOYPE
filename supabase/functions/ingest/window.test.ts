import { assert, assertEquals } from 'jsr:@std/assert@1';

import {
  checkWindow,
  isoWeek,
  isoWeekStart,
  parseWindowId,
  weeksInIsoYear,
  windowAt,
} from './window.ts';

const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;

Deno.test('ISO week numbers, including year boundaries', () => {
  const cases: Array<[string, number, number]> = [
    ['2026-09-29T12:00:00Z', 2026, 40],
    ['2026-01-01T00:00:00Z', 2026, 1], // Thursday
    ['2025-12-29T00:00:00Z', 2026, 1], // Monday of 2026-W01
    ['2025-12-28T23:59:59Z', 2025, 52],
    ['2021-01-01T00:00:00Z', 2020, 53], // Friday in 2020-W53
    ['2021-01-04T00:00:00Z', 2021, 1],
    ['2027-01-01T00:00:00Z', 2026, 53],
  ];
  for (const [iso, isoYear, week] of cases)
    assertEquals(isoWeek(at(iso)), { isoYear, week }, iso);
});

Deno.test('weeks per ISO year and week starts', () => {
  assertEquals(weeksInIsoYear(2020), 53);
  assertEquals(weeksInIsoYear(2025), 52);
  assertEquals(weeksInIsoYear(2026), 53);
  assertEquals(isoWeekStart(2026, 1).toISOString(), '2025-12-29T00:00:00.000Z');
  assertEquals(
    isoWeekStart(2026, 37).toISOString(),
    '2026-09-07T00:00:00.000Z',
  );
});

Deno.test('4-week windows start at weeks 1, 5, ..., 45 and 49', () => {
  const w = windowAt(at('2026-09-29T12:00:00Z'));
  assertEquals(w.id, '2026-W37/4');
  assertEquals(w.start.toISOString(), '2026-09-07T00:00:00.000Z');
  assertEquals(w.end.toISOString(), '2026-10-05T00:00:00.000Z');
  assertEquals(windowAt(at('2026-10-05T00:00:00Z')).id, '2026-W41/4');
  assertEquals(windowAt(at('2026-01-01T00:00:00Z')).id, '2026-W01/4');
});

Deno.test('the last window of a year runs to the next ISO year', () => {
  // 2020 has 53 ISO weeks: its last window is 5 weeks long.
  const last = windowAt(at('2021-01-01T00:00:00Z'));
  assertEquals(last.id, '2020-W49/4');
  assertEquals(last.end.toISOString(), isoWeekStart(2021, 1).toISOString());
  assertEquals((last.end.getTime() - last.start.getTime()) / (7 * DAY), 5);
  assertEquals(windowAt(at('2021-01-04T00:00:00Z')).id, '2021-W01/4');
});

Deno.test('every instant falls in exactly one window, with no gaps', () => {
  let t = Date.UTC(2019, 11, 1);
  let prev = windowAt(new Date(t));
  const end = Date.UTC(2028, 0, 31);
  while (t < end) {
    t += DAY;
    const w = windowAt(new Date(t));
    if (w.id !== prev.id) {
      assertEquals(
        w.start.getTime(),
        prev.end.getTime(),
        `${prev.id} -> ${w.id}`,
      );
      assert(w.id > prev.id, 'ids sort in time order');
    }
    assert(w.start.getTime() <= t && t < w.end.getTime());
    prev = w;
  }
});

Deno.test('parseWindowId accepts only real window starts', () => {
  assertEquals(parseWindowId('2026-W37/4')?.startWeek, 37);
  assertEquals(parseWindowId('2026-W49/4')?.startWeek, 49);
  for (const bad of [
    '2026-W38/4',
    '2026-W53/4',
    '2026-W00/4',
    '2026-W37',
    '26-W37/4',
    '2026-W37/4 ',
  ]) {
    assertEquals(parseWindowId(bad), null, bad);
  }
});

Deno.test(
  'reports are accepted for the current window and a grace period after it',
  () => {
    const opts = { graceMs: 7 * DAY, skewMs: 15 * 60_000 };
    const now = at('2026-10-06T00:00:00Z'); // early in 2026-W41/4

    const current = checkWindow('2026-W41/4', now, opts);
    assert(current.ok);
    assertEquals(current.expiresAt.toISOString(), '2026-11-09T00:00:00.000Z');

    const previous = checkWindow('2026-W37/4', now, opts);
    assert(previous.ok);
    assertEquals(previous.expiresAt.toISOString(), '2026-10-12T00:00:00.000Z');

    assertEquals(checkWindow('2026-W37/4', at('2026-10-12T00:00:00Z'), opts), {
      ok: false,
      reason: 'closed',
    });
    assertEquals(checkWindow('2026-W45/4', now, opts), {
      ok: false,
      reason: 'future',
    });
    assertEquals(checkWindow('2026-W38/4', now, opts), {
      ok: false,
      reason: 'malformed',
    });
  },
);

Deno.test(
  'a device clock slightly ahead may report into the next window',
  () => {
    const opts = { graceMs: 7 * DAY, skewMs: 15 * 60_000 };
    const justBefore = at('2026-10-04T23:50:00Z');
    assert(checkWindow('2026-W41/4', justBefore, opts).ok);
    assertEquals(checkWindow('2026-W41/4', at('2026-10-04T23:00:00Z'), opts), {
      ok: false,
      reason: 'future',
    });
  },
);
