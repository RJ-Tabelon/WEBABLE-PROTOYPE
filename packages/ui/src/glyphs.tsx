import type { SVGProps } from 'react';
import { cx } from './internal/cx';
import { remSize } from './internal/size';

type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'ref'>;

/**
 * The fit arrow (12 x 8): a horizontal line with a 45° open head. It replaces the
 * typed "→" everywhere, because the brand fonts do not contain U+2192. It scales
 * with the surrounding font size (0.8em wide) and keeps a 1.75 px stroke.
 */
export function FitArrow({ className, ...rest }: GlyphProps) {
  return (
    <svg
      className={cx('wa-fit-arrow', className)}
      viewBox="0 0 12 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M1 4h10M8 1l3 3-3 3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface MarkProps extends GlyphProps {
  /** Rendered size in px. Stroke is 1.5 px at 16 and below, 2 px above. Default 24. */
  size?: number;
  /** Accessible name. Omit when the mark sits beside the wordmark. */
  title?: string;
}

/**
 * The interim WebAble mark (design-final §11.3): a dimension line with end ticks
 * above two text bars. It reads as "a page, measured".
 */
export function Mark({
  size = 24,
  title,
  className,
  style,
  ...rest
}: MarkProps) {
  const stroke = size <= 16 ? 1.5 : 2;
  return (
    <svg
      className={cx('wa-mark', className)}
      width={size}
      height={size}
      style={remSize(size, style)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={(stroke * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(title
        ? { role: 'img', 'aria-label': title }
        : { 'aria-hidden': true })}
      {...rest}
    >
      <path d="M6 8h12M6 5v6M18 5v6M6 14h12M6 18h8" />
    </svg>
  );
}

/** Extension status states (design-final §7.13). */
export type StatusState =
  | 'on'
  | 'checking'
  | 'still-checking'
  | 'adapted'
  | 'paused'
  | 'attention'
  | 'cant-run';

export interface StatusShapeProps extends GlyphProps {
  state: StatusState;
  /** Rendered size in px: 16 in pills, 20 in the popup state line. */
  size?: 16 | 20;
}

/**
 * The status glyphs on a 16 grid with a 1.75 px stroke. Shape carries the state;
 * colour is the third cue after shape and word.
 */
export function StatusShape({
  state,
  size = 16,
  className,
  style,
  ...rest
}: StatusShapeProps) {
  const sw = (1.75 * 16) / size;
  const common = {
    width: size,
    height: size,
    style: remSize(size, style),
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
    className: cx('wa-status-glyph', `wa-status-glyph--${state}`, className),
    ...rest,
  };
  switch (state) {
    case 'on':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'checking':
      return (
        <svg {...common}>
          <circle className="wa-status-glyph__track" cx="8" cy="8" r="6" />
          <path className="wa-status-glyph__arc" d="M8 2a6 6 0 0 1 6 6" />
          {/* Shown instead of the turning arc under reduced motion. */}
          <path className="wa-status-glyph__half" d="M8 2a6 6 0 0 1 0 12" />
        </svg>
      );
    case 'still-checking':
      return (
        <svg {...common}>
          <circle className="wa-status-glyph__track" cx="8" cy="8" r="6" />
          <path d="M8 2a6 6 0 0 1 0 12" />
        </svg>
      );
    case 'adapted':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'paused':
      return (
        <svg {...common}>
          <rect
            x="5"
            y="4"
            width="2"
            height="8"
            rx="0.5"
            fill="currentColor"
            stroke="none"
          />
          <rect
            x="9"
            y="4"
            width="2"
            height="8"
            rx="0.5"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    case 'attention':
      return (
        <svg {...common}>
          <path d="M8 2.25 14 13.25H2Z" />
          <path d="M8 6.5v3" />
          <circle cx="8" cy="11.4" r="0.25" fill="currentColor" />
        </svg>
      );
    case 'cant-run':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="m3.76 3.76 8.48 8.48" />
        </svg>
      );
  }
}

export interface CheckGlyphProps extends GlyphProps {
  /** Rendered size in px: 12 in the switch thumb, 14 in the checkbox. */
  size?: number;
}

/** A check drawn at small sizes with an absolute 2 px stroke (switch thumb, checkbox). */
export function CheckGlyph({
  size = 12,
  className,
  style,
  ...rest
}: CheckGlyphProps) {
  return (
    <svg
      className={cx('wa-check-glyph', className)}
      width={size}
      height={size}
      style={remSize(size, style)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={(2 * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
