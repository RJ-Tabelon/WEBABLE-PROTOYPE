// Aggregation windows for opt-in product learning (personalization.md 13.3, 14).
//
// A window is 4 ISO weeks, named `YYYY-Www/4` after its ISO week-year and its
// first ISO week. Windows start at weeks 1, 5, 9, ..., 45 and 49; the last one
// of a year runs from week 49 to the year's end (4 or 5 weeks), so windows never
// straddle ISO years. All arithmetic is UTC. Ids sort lexicographically in time
// order, which retention relies on.

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const LAST_START = 49;
const WINDOW_ID = /^(\d{4})-W(\d{2})\/4$/;

export interface AggWindow {
  id: string;
  isoYear: number;
  startWeek: number;
  /** Inclusive, Monday 00:00 UTC. */
  start: Date;
  /** Exclusive, Monday 00:00 UTC. */
  end: Date;
}

function utcMidnight(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** ISO 8601 week-year and week number of a UTC instant. */
export function isoWeek(at: Date): { isoYear: number; week: number } {
  const day = utcMidnight(at.getTime());
  const dow = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(day + (3 - dow) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const ordinal = Math.round(
    (thursday.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS,
  );
  return { isoYear, week: Math.floor(ordinal / 7) + 1 };
}

/** Monday 00:00 UTC of ISO week `week` of `isoYear`. */
export function isoWeekStart(isoYear: number, week: number): Date {
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return new Date(jan4 - jan4Dow * DAY_MS + (week - 1) * WEEK_MS);
}

export function weeksInIsoYear(isoYear: number): 52 | 53 {
  return isoWeek(new Date(Date.UTC(isoYear, 11, 28))).week === 53 ? 53 : 52;
}

function windowStartWeek(week: number): number {
  return week >= LAST_START ? LAST_START : 1 + 4 * Math.floor((week - 1) / 4);
}

function makeWindow(isoYear: number, startWeek: number): AggWindow {
  const start = isoWeekStart(isoYear, startWeek);
  const end =
    startWeek === LAST_START
      ? isoWeekStart(isoYear + 1, 1)
      : isoWeekStart(isoYear, startWeek + 4);
  return {
    id: `${isoYear}-W${String(startWeek).padStart(2, '0')}/4`,
    isoYear,
    startWeek,
    start,
    end,
  };
}

/** The window containing `at`. */
export function windowAt(at: Date): AggWindow {
  const { isoYear, week } = isoWeek(at);
  return makeWindow(isoYear, windowStartWeek(week));
}

/** Parse a window id; null unless it names a real window start. */
export function parseWindowId(id: string): AggWindow | null {
  const match = WINDOW_ID.exec(id);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const startWeek = Number(match[2]);
  if (isoYear < 2000 || isoYear > 9998) return null;
  if (
    startWeek < 1 ||
    startWeek > LAST_START ||
    windowStartWeek(startWeek) !== startWeek
  )
    return null;
  return makeWindow(isoYear, startWeek);
}

export type WindowCheck =
  | { ok: true; window: AggWindow; expiresAt: Date }
  | { ok: false; reason: 'malformed' | 'future' | 'closed' };

/**
 * Reports are accepted for the current window (starting up to `skewMs` early,
 * for device clocks that run ahead), and for a finished one until `graceMs`
 * after it ends. The quota row for a window lives exactly that long.
 */
export function checkWindow(
  id: string,
  now: Date,
  opts: { graceMs: number; skewMs: number },
): WindowCheck {
  const window = parseWindowId(id);
  if (!window) return { ok: false, reason: 'malformed' };
  if (window.start.getTime() > now.getTime() + opts.skewMs)
    return { ok: false, reason: 'future' };
  const expiresAt = new Date(window.end.getTime() + opts.graceMs);
  if (now.getTime() >= expiresAt.getTime())
    return { ok: false, reason: 'closed' };
  return { ok: true, window, expiresAt };
}
