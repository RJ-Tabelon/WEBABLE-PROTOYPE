import type { CSSProperties, ReactNode } from 'react';
import { FitArrow } from './glyphs';
import { cx } from './internal/cx';

const SPOKEN_UNITS: Record<string, string> = {
  px: 'pixels',
  '%': 'percent',
  ms: 'milliseconds',
  s: 'seconds',
  em: 'em',
  min: 'minutes',
};

/** Speaks a unit in words for screen readers ("px" becomes "pixels"). */
export function spokenUnit(unit: string | undefined): string {
  if (!unit) return '';
  return SPOKEN_UNITS[unit] ?? unit;
}

export interface FitValue {
  /** The value before WebAble changed it. Omit for a single after-value ("2 paused"). */
  from?: number | string;
  /** The value now. Only real values: a fit mark with invented numbers is a bug. */
  to: number | string;
  /** Unit after the value, joined with a no-break space ("18 px"). */
  unit?: string;
  /** Spoken unit. Default derived from `unit` ("px" to "pixels"). */
  unitSpoken?: string;
}

function spokenValue({ from, to, unit, unitSpoken }: FitValue): string {
  const u = unitSpoken ?? spokenUnit(unit);
  const tail = u ? ` ${u}` : '';
  return from === undefined ? `${to}${tail}` : `${from} to ${to}${tail}`;
}

export interface FitMarkProps extends FitValue {
  /** Row label (16 / medium), for example "Text size". */
  label?: ReactNode;
  /** `inline` (Mono 15) for lists and popup rows; `readout` (Mono 28) for Your fit. */
  size?: 'inline' | 'readout';
  className?: string;
}

const NBSP = '\u00a0';

/** The visible value: before, fit arrow, after and unit. Decorative; pair with sr text. */
function FitVisual({
  from,
  to,
  unit,
  className,
}: FitValue & { className: string }) {
  return (
    <span aria-hidden="true" className={className}>
      {from !== undefined ? (
        <>
          <span className="wa-fit-mark__from">{from}</span>
          <FitArrow />
        </>
      ) : null}
      <span className="wa-fit-mark__after">
        <span className="wa-fit-mark__to">{to}</span>
        {unit ? (
          <span className="wa-fit-mark__unit">{`${NBSP}${unit}`}</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Fit mark, component form (design-final §7.20): the before value in secondary
 * ink, the SVG fit arrow, the after value in fern at 540, then the unit.
 * Screen readers hear "13 to 18 pixels".
 */
export function FitMark({
  label,
  size = 'inline',
  className,
  ...value
}: FitMarkProps) {
  return (
    <span
      className={cx(
        'wa-fit-mark',
        size === 'readout' && 'wa-fit-mark--readout',
        className,
      )}
    >
      {label ? <span className="wa-fit-mark__label">{label}</span> : null}
      <span className="wa-fit-mark__value">
        <FitVisual {...value} className="wa-fit-mark__visual" />
        <span className="sr-only">{spokenValue(value)}</span>
      </span>
    </span>
  );
}

export interface FitMarkBlockProps extends FitValue {
  /** What was measured, for the accessible name ("Text size"). */
  label: string;
  /** Put the value on a radius-4 canvas plate, for use over imagery. */
  plate?: boolean;
  /**
   * Draw the line once (`--dur-draw`, then a 100 ms label fade). Website hero only,
   * once per session; static under reduced motion.
   */
  draw?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Block fit mark (annotations on captures): a 1 px dimension line with 1 x 8 end
 * ticks and the value centred above it in Mono 15. It spans its container's width.
 */
export function FitMarkBlock({
  label,
  plate = false,
  draw = false,
  className,
  style,
  ...value
}: FitMarkBlockProps) {
  return (
    <span
      role="img"
      aria-label={`${label}: ${spokenValue(value)}`}
      className={cx(
        'wa-fit-block',
        plate && 'wa-fit-block--plate',
        draw && 'wa-fit-block--draw',
        className,
      )}
      style={style}
    >
      <FitVisual {...value} className="wa-fit-block__value" />
      <span className="wa-fit-block__line" aria-hidden="true" />
    </span>
  );
}
