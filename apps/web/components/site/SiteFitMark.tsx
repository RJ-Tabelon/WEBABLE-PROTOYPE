import { FitArrow } from '@webable/ui';
import type { CSSProperties } from 'react';

const NBSP = ' ';

export interface SiteFitMarkProps {
  /** What changed, from the op catalog ("Text size"). */
  label: string;
  from?: number | string;
  to: number | string;
  unit?: string;
  /** `h` spans the element's width; `v` spans its height (for example a 44 px hit area). */
  orientation?: 'h' | 'v';
  /** Where the label plate sits relative to the dimension line. */
  side?: 'above' | 'below' | 'end';
  /**
   * `draw`: the line draws once (stroke-dashoffset over `--dur-draw`), then the label
   * fades in over 100 ms. Static under reduced motion. `static`: already drawn.
   */
  mode?: 'draw' | 'static';
  className?: string;
  style?: CSSProperties;
}

/**
 * Block fit mark for captures on the website (design-final §7.20, §8): a 1 px
 * dimension line with 8 px end ticks, and a Mono label on a radius-4 plate whose
 * after-value is fern. It is decorative: the sample page carries the spoken text.
 */
export function SiteFitMark({
  label,
  from,
  to,
  unit,
  orientation = 'h',
  side = 'above',
  mode = 'static',
  className,
  style,
}: SiteFitMarkProps) {
  const horizontal = orientation === 'h';
  return (
    <span
      className={['ws-mark', className].filter(Boolean).join(' ')}
      data-orient={orientation}
      data-side={side}
      data-mode={mode}
      style={style}
      aria-hidden="true"
    >
      <span className="ws-mark__plate">
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
            {unit ? (
              <span className="ws-mark__unit">{`${NBSP}${unit}`}</span>
            ) : null}
          </span>
        </span>
      </span>
      <svg className="ws-mark__rule" focusable="false">
        {horizontal ? (
          <>
            <line
              className="ws-mark__tick ws-mark__tick--a"
              x1="0.5"
              y1="0"
              x2="0.5"
              y2="8"
              pathLength={1}
            />
            <line
              className="ws-mark__line"
              x1="0.5"
              y1="4"
              x2="100%"
              y2="4"
              pathLength={1}
            />
            <line
              className="ws-mark__tick ws-mark__tick--b"
              x1="100%"
              y1="0"
              x2="100%"
              y2="8"
              pathLength={1}
            />
          </>
        ) : (
          <>
            <line
              className="ws-mark__tick ws-mark__tick--a"
              x1="0"
              y1="0.5"
              x2="8"
              y2="0.5"
              pathLength={1}
            />
            <line
              className="ws-mark__line"
              x1="4"
              y1="0.5"
              x2="4"
              y2="100%"
              pathLength={1}
            />
            <line
              className="ws-mark__tick ws-mark__tick--b"
              x1="0"
              y1="100%"
              x2="8"
              y2="100%"
              pathLength={1}
            />
          </>
        )}
      </svg>
    </span>
  );
}
