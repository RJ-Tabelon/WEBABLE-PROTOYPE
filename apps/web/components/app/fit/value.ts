import type { FitRow } from '@webable/core/profile/describe';
import type { FitValue } from '@webable/ui';

/**
 * Fit values for the app's rows and lists, in the shape `@webable/ui`'s
 * FitValue draws. Pure.
 */

const NUMBER_WITH_UNIT = /^([\d.:]+)[\u00a0 ](px|ms|characters)$/;
const NUMBER = /^[\d.:]+$/;

/** "16 px" → { n: '16', unit: 'px' }; words stay words ("Site colors"). */
export function splitShown(shown: string): { n: string; unit?: string } {
  const match = NUMBER_WITH_UNIT.exec(shown);
  if (match?.[1] && match[2]) return { n: match[1], unit: match[2] };
  return { n: shown };
}

/**
 * A change between two shown values ("16 px" → "18 px"): Mono digits when
 * both are numbers in the same unit, words otherwise.
 */
export function diffValue(
  before: string,
  after: string,
  srText: string,
): FitValue {
  const from = splitShown(before);
  const to = splitShown(after);
  if (
    NUMBER.test(from.n) &&
    NUMBER.test(to.n) &&
    (from.unit ?? '') === (to.unit ?? '')
  ) {
    return {
      kind: 'change',
      before: from.n,
      after: to.n,
      ...(to.unit ? { unit: to.unit } : {}),
      srText,
    };
  }
  return { kind: 'word', before, after, srText };
}

/**
 * The value a "Your fit" row shows: `@webable/core` describes it (`row.value`).
 * Rows without one (stored by an older core) are described here: a row that
 * doesn't change pages reads "As the site made it".
 */
export function fitValueOf(row: FitRow | Omit<FitRow, 'value'>): FitValue {
  if ('value' in row && row.value) return row.value;
  if (!row.changesPages) return { kind: 'same', srText: row.srText };
  if (!row.changed)
    return { kind: 'word', after: row.after, srText: row.srText };
  return diffValue(row.before, row.after, row.srText);
}

/** The same value with a different after-value (a draft, or what was learned). */
export function withAfter(
  value: FitValue,
  after: number | string,
  srText: string,
): FitValue {
  switch (value.kind) {
    case 'change':
      return { ...value, after, srText };
    case 'floor':
      return { ...value, after, srText };
    case 'word':
      return { ...value, after: String(after), srText };
    case 'same':
      return value;
  }
}
