'use client';

import type { FitRow as CoreFitRow } from '@webable/core/profile/describe';
import { cx, FitDigits, FitUnit, FitValue } from '@webable/ui';

import { diffValue, fitValueOf } from '../../app/fit/value';

/**
 * Fit values in Tune (design-final §7.20): "Text size 16 → 20 px" on rest
 * screens, previews, the fit preview legend and the end screen. Only real
 * values: every number comes from the person's answers or the site's default.
 */

type FitValueShape = Parameters<typeof FitValue>[0]['value'];
export type { FitValueShape };

const SPOKEN: Readonly<Record<string, string>> = {
  px: 'pixels',
  ms: 'milliseconds',
  characters: 'characters',
};

/** A change between two numbers, with the spoken phrase ("16 to 20 pixels"). */
export function changeValue(
  before: number | string,
  after: number | string,
  unit?: string,
): FitValueShape {
  const spoken = unit ? ` ${SPOKEN[unit] ?? unit}` : '';
  return {
    kind: 'change',
    before,
    after,
    ...(unit ? { unit } : {}),
    srText: `${before} to ${after}${spoken}`,
  };
}

/**
 * The value a fit row shows. `@webable/core` describes it (`row.value`); rows
 * from an older core are described exactly as the app describes them.
 */
export function rowValue(
  row: CoreFitRow,
  options: {
    /** Recalibration rows: the change from the previous fit, even back to a site default. */
    diff?: boolean;
  } = {},
): FitValueShape {
  const described = (row as CoreFitRow & { value?: FitValueShape }).value;
  if (described) return described;
  if (options.diff) {
    return row.changed
      ? diffValue(row.before, row.after, row.srText)
      : { kind: 'same', srText: row.srText };
  }
  return fitValueOf(row);
}

/** The source line under a changed row (design-final §9.4). */
export function rowSource(row: CoreFitRow): string {
  return (row.sourceKind as string) === 'answered'
    ? 'From your answers in Tune'
    : row.source;
}

export interface FitLineProps {
  label: string;
  value: FitValueShape;
  className?: string;
}

/** A label and one inline fit value: "Text size  16 → 20 px". */
export function FitLine({ label, value, className }: FitLineProps) {
  return (
    <span className={cx('tn-fitline', className)}>
      <span className="tn-fitline__label">{label}</span>
      <FitValue value={value} size="inline" />
    </span>
  );
}

/**
 * A value shown as the site made it, in ink with no arrow ("16 px"): the
 * Original side of a preview. Not a fit value, so never fern.
 */
export function PlainLine({
  label,
  value,
  unit,
  spoken,
}: {
  label: string;
  value: number | string;
  unit?: string;
  /** Screen-reader phrase ("16 pixels"). */
  spoken: string;
}) {
  return (
    <span className="tn-fitline tn-fitline--plain">
      <span className="tn-fitline__label">{label}</span>
      <span className="tn-fitline__plain">
        <span aria-hidden="true">
          <FitDigits>{value}</FitDigits>
          {unit ? <FitUnit unit={unit} /> : null}
        </span>
        <span className="sr-only">{spoken}</span>
      </span>
    </span>
  );
}
