import { FitArrow } from '@webable/ui';
import type { CSSProperties, Ref } from 'react';

export interface SiteFitMarkProps {
  /** What changed, from the op catalog ("Text size"). */
  label: string;
  from?: number | string;
  to: number | string;
  unit?: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLSpanElement>;
}

/**
 * The fit-mark label plate used on the website's captures (design-final §7.20 block
 * form, §8): one line, label in Atkinson Next 15 / 540, value in Mono 15 with the
 * after-value in fern, on a radius-4 canvas plate with a 1 px hairline. It is
 * decorative: the sample page carries the spoken text ("13 to 18 pixels").
 * Dimension lines and leaders are drawn separately, from measured rects.
 */
export function SiteFitMark({
  label,
  from,
  to,
  unit,
  className,
  style,
  ref,
}: SiteFitMarkProps) {
  return (
    <span
      ref={ref}
      className={['ws-mark', className].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    >
      <span className="ws-mark__label">{label}</span>
      <span className="ws-mark__value">
        {from !== undefined ? (
          <>
            <span className="ws-mark__from">{from}</span>
            <FitArrow className="ws-mark__arrow" />
          </>
        ) : null}
        <span className="ws-mark__after">
          <span className="ws-mark__to">{to}</span>
          {unit ? <span className="ws-mark__unit">{unit}</span> : null}
        </span>
      </span>
    </span>
  );
}
