/**
 * Small formatting helpers for the app's copy (design-final.md 13): digits with
 * units and a no-break space, dates as "Sep 29" or "Sep 29, 2026", counts in
 * words where that reads better ("once", "twice"). Pure.
 */

export const NBSP = '\u00a0';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "Sep 29, 2026" in UTC. Server-rendered dates use UTC so the markup is the same
 * wherever it renders.
 */
export function formatDay(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return '';
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** "Sep 29" (UTC), for dates in the current year. */
export function formatShortDay(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return '';
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** Calendar-day distance in the viewer's local time: 0 today, 1 yesterday. */
function localDaysAgo(date: Date, now: Date): number {
  const start = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(now) - start(date)) / 86_400_000);
}

/** "Today", "Yesterday", "Sep 28" or "Sep 28, 2025", in the viewer's local time. Client use. */
export function formatRelativeDay(
  value: string | number | Date,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return '';
  const days = localDaysAgo(date, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const month = MONTHS[date.getMonth()];
  return date.getFullYear() === now.getFullYear()
    ? `${month} ${date.getDate()}`
    : `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

/** "10:42" style local time with the day: "Today, 10:42". Client use. */
export function formatMoment(value: number, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${formatRelativeDay(date, now)}, ${hh}:${mm}`;
}

/** "once", "twice", "3 times". */
export function times(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n}${NBSP}times`;
}

/** "1 change", "3 changes". */
export function plural(
  n: number,
  one: string,
  many: string = `${one}s`,
): string {
  return `${n}${NBSP}${n === 1 ? one : many}`;
}

/** "812 bytes", "1.2 KB", "3 KB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return `0${NBSP}bytes`;
  if (n < 1000) return `${Math.round(n)}${NBSP}${n === 1 ? 'byte' : 'bytes'}`;
  const kb = n / 1000;
  const shown = kb < 10 ? Math.round(kb * 10) / 10 : Math.round(kb);
  return `${shown}${NBSP}KB`;
}

/** Split a fit value like "18 px" into number and unit for a fit mark. */
export function splitValue(value: string): {
  value: string;
  unit: string | null;
} {
  const index = value.indexOf(NBSP);
  if (index < 0) return { value, unit: null };
  return { value: value.slice(0, index), unit: value.slice(index + 1) };
}
