import { FitArrow } from '@webable/ui';

import { splitValue } from '../format';

export interface FitReadoutProps {
  /** Formatted value before ("16 px", "Site colors"). */
  before: string;
  /** Formatted value now. */
  after: string;
  /** Whole screen-reader phrase from the fit ("16 to 19 pixels"). */
  srText: string;
  /** False when WebAble leaves this as it is: shown as one value in ink. */
  changed: boolean;
  /** `readout` (Mono 28) on Your fit, `inline` (Mono 15) in lists. */
  size?: 'readout' | 'inline';
}

/**
 * A fit mark built from real profile values (§7.20): before in secondary ink,
 * the SVG fit arrow, after in fern with its unit. An unchanged value is a single
 * ink value, because fern means "WebAble changed this".
 */
export function FitReadout({
  before,
  after,
  srText,
  changed,
  size = 'readout',
}: FitReadoutProps) {
  const to = splitValue(after);
  const from = splitValue(before);
  const sameUnit = from.unit === to.unit;
  return (
    <span
      className={[
        'wa-fit-mark',
        size === 'readout' ? 'wa-fit-mark--readout' : '',
        'wa-fit-value',
        changed ? '' : 'wa-fit-value--same',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="wa-fit-mark__value">
        <span aria-hidden="true" className="wa-fit-mark__visual">
          {changed ? (
            <>
              <span className="wa-fit-mark__from">
                {sameUnit || !from.unit ? from.value : before}
              </span>
              <FitArrow />
            </>
          ) : null}
          <span className="wa-fit-mark__after">
            <span className="wa-fit-mark__to">{to.value}</span>
            {to.unit ? (
              <span className="wa-fit-mark__unit">{`\u00a0${to.unit}`}</span>
            ) : null}
          </span>
        </span>
        <span className="sr-only">{srText}</span>
      </span>
    </span>
  );
}
