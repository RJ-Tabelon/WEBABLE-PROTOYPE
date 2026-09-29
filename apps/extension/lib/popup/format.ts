import { formatLevel } from '@webable/core/explain/templates';
import { OP_CATALOG } from '@webable/core/ops/catalog';
import type { AppliedChange } from '@webable/core/policy/types';

import type { FitValue } from '@webable/ui';

const NUMBER_UNIT =
  /^\s*(-?\d+(?:\.\d+)?)[\s\u00a0]*(px|ms|%|ch|characters|s)?\s*$/i;

interface Parsed {
  value: string;
  unit: string | undefined;
}

function parse(raw: string): Parsed | null {
  const m = NUMBER_UNIT.exec(raw);
  if (!m || m[1] === undefined) return null;
  const unit = m[2]?.toLowerCase();
  return { value: m[1], unit: unit === 'characters' ? 'ch' : unit };
}

/**
 * The fit mark for a change, from the engine's measured before/after values.
 * "13 px" -> "18 px" becomes 13 -> 18 px; values that are not numbers with the
 * same unit ("2 playing" -> "2 paused") show only the after value. Without
 * measured values the level itself is shown ("18 px"). Never invents numbers.
 */
export function fitValue(
  change: Pick<AppliedChange, 'op' | 'level' | 'fit'>,
): FitValue {
  const fit = change.fit;
  if (fit) {
    const before = parse(fit.before);
    const after = parse(fit.after);
    if (
      before &&
      after &&
      before.unit === after.unit &&
      before.value !== after.value
    ) {
      return withUnit(after.unit, { from: before.value, to: after.value });
    }
    if (after) return withUnit(after.unit, { to: after.value });
    return { to: fit.after.replace(/\s+/g, ' ') };
  }
  const level = formatLevel(change.op, change.level);
  const parsed = parse(level);
  if (parsed) return withUnit(parsed.unit, { to: parsed.value });
  return { to: level === 'on' ? 'On' : level };
}

/**
 * Word units follow a no-break space ("18 px"); a percent sign sits on the
 * number ("125%"), which screen readers already say as "percent".
 */
function withUnit(
  unit: string | undefined,
  v: { from?: string; to: string },
): FitValue {
  if (unit === '%') {
    return {
      ...(v.from !== undefined ? { from: `${v.from}%` } : {}),
      to: `${v.to}%`,
    };
  }
  return { ...v, ...(unit ? { unit } : {}) };
}

/** Row label for a change ("Text size"). */
export const changeLabel = (op: AppliedChange['op']): string =>
  OP_CATALOG[op].label;

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2:41 PM" in the person's locale. */
export function clockTime(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(ms);
}

/** Text size ladder shown in Adjust (design-final 10.3): 14-32 px. */
export const TEXT_STEPS: readonly number[] =
  OP_CATALOG.text_floor.levels.filter((v) => v <= 32);
export const SPACING_STEPS: readonly number[] = OP_CATALOG.line_spacing.levels;

/** Level index for a ladder value (nearest). */
export function levelIndex(levels: readonly number[], value: number): number {
  let best = 0;
  let dist = Infinity;
  levels.forEach((v, i) => {
    const d = Math.abs(v - value);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

export function valueAt(levels: readonly number[], index: number): number {
  return (
    levels[Math.max(0, Math.min(levels.length - 1, Math.round(index)))] ??
    levels[0] ??
    0
  );
}

/** Bucketed counts from a receipt, in words: "4-10 headings, 1 form, 11-30 buttons". */
export function structureSummary(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const counts = (body as { page?: { counts?: Record<string, unknown> } }).page
    ?.counts;
  if (!counts) return null;
  const part = (key: string, one: string, many: string): string | null => {
    const v = counts[key];
    if (typeof v !== 'string' || v === '0') return null;
    return `${v.replace('-', '–')} ${v === '1' ? one : many}`;
  };
  const parts = [
    part('headings', 'heading', 'headings'),
    part('forms', 'form', 'forms'),
    part('buttons', 'button', 'buttons'),
    part('links', 'link', 'links'),
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(', ') : null;
}
