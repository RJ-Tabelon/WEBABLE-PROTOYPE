import type { SVGProps } from 'react';
import { cx } from './internal/cx';
import { remSize } from './internal/size';

type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'ref'>;

export interface FitArrowProps extends GlyphProps {
  /**
   * Icon size in px (for example 20 in the app rail, design-final §11.3). The
   * arrow is then drawn on the 24 icon grid like the Lucide set, with an
   * absolute 1.75 px stroke. Omit it inside values: the arrow follows the
   * surrounding font size (0.8em wide).
   */
  size?: number;
}

/**
 * The fit arrow (12 x 8): a horizontal line with a 45° open head. It replaces the
 * typed "→" everywhere, because the brand fonts do not contain U+2192. It scales
 * with the surrounding font size (0.8em wide) and keeps a 1.75 px stroke.
 */
export function FitArrow({ size, className, style, ...rest }: FitArrowProps) {
  if (size !== undefined) {
    return (
      <svg
        className={cx('wa-fit-arrow', 'wa-fit-arrow--icon', className)}
        width={size}
        height={size}
        style={remSize(size, style)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={(1.75 * 24) / size}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        <path d="M4.5 12h15M15 7.5l4.5 4.5-4.5 4.5" />
      </svg>
    );
  }
  return (
    <svg
      className={cx('wa-fit-arrow', className)}
      style={style}
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
  /**
   * Rendered size in px. On the 24 grid (default) it is the box; with `tight`
   * it is the glyph's height. Stroke is 1.5 px at 16 and below, 2 px above.
   * Default 24 (16 with `tight`).
   */
  size?: number;
  /**
   * Crop the box to the glyph (viewBox `5 4 14 15`), so the drawing fills its
   * box and lines up with the wordmark's cap height. The lockup uses this.
   */
  tight?: boolean;
  /** Accessible name. Omit when the mark sits beside the wordmark. */
  title?: string;
}

/** The glyph's own bounds on the 24 grid, stroke included (x 5-19, y 4-19). */
const MARK_TIGHT = { x: 5, y: 4, w: 14, h: 15 } as const;

/**
 * The fit glyph (design-final §11.3): a dimension line with end ticks above two
 * text bars. It reads as "a page, measured". It was the interim logo; the logo
 * is now the W (`LogoMark`), and this stays as the icon for a person's fit.
 */
export function Mark({
  size,
  tight = false,
  title,
  className,
  style,
  ...rest
}: MarkProps) {
  const px = size ?? (tight ? 16 : 24);
  const stroke = px <= 16 ? 1.5 : 2;
  const box = tight ? MARK_TIGHT : { x: 0, y: 0, w: 24, h: 24 };
  // Height is the size; width follows the box's aspect ratio.
  const width = (px * box.w) / box.h;
  return (
    <svg
      className={cx('wa-mark', tight && 'wa-mark--tight', className)}
      width={width}
      height={px}
      style={{ width: `${width / 16}rem`, height: `${px / 16}rem`, ...style }}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={(stroke * box.h) / px}
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

export interface LogoMarkProps extends GlyphProps {
  /** Height in px; the width follows the logo (about 3:2). Default 16. */
  size?: number;
  /** Accessible name. Omit when the logo sits beside the word "WebAble". */
  title?: string;
}

/** The W's drawing bounds, from the brand file (webable-logo-black.svg). */
const LOGO_BOX = { x: -1, y: 0, w: 684, h: 457 } as const;

/** The W: two long strokes and a short one, filled with the current colour. */
const LOGO_PATHS = [
  'M95.5 0.5L118.5 4.5L137.5 12.5L153.5 23.5L164.5 34.5L172.5 45.5L195.5 95.5L197.5 102.5L221.5 156.5L225.5 168.5L233.5 184.5L246.5 217.5L251.5 226.5L255.5 238.5L267.5 264.5L271.5 276.5L275.5 283.5L301.5 346.5L304.5 361.5L303.5 382.5L299.5 396.5L289.5 414.5L275.5 430.5L259.5 442.5L243.5 450.5L220.5 456.5L196.5 456.5L176.5 451.5L158.5 442.5L151.5 437.5L138.5 424.5L128.5 410.5L108.5 365.5L102.5 348.5L77.5 291.5L71.5 274.5L59.5 248.5L36.5 191.5L29.5 177.5L25.5 165.5L7.5 125.5L1.5 107.5L0.5 92.5L-0.5 91.5L1.5 70.5L6.5 55.5L12.5 43.5L20.5 32.5L34.5 19.5L55.5 7.5L71.5 2.5L87.5 0.5Z',
  'M330.5 0.5L351.5 4.5L370.5 12.5L388.5 25.5L396.5 33.5L405.5 45.5L414.5 63.5L437.5 120.5L442.5 129.5L450.5 151.5L455.5 160.5L464.5 184.5L488.5 238.5L517.5 310.5L521.5 317.5L530.5 342.5L533.5 358.5L532.5 380.5L526.5 399.5L515.5 418.5L498.5 435.5L483.5 445.5L467.5 452.5L449.5 456.5L427.5 456.5L408.5 452.5L391.5 444.5L382.5 438.5L367.5 424.5L355.5 407.5L335.5 362.5L331.5 350.5L319.5 324.5L291.5 255.5L284.5 241.5L278.5 224.5L274.5 217.5L243.5 141.5L238.5 132.5L229.5 105.5L228.5 84.5L230.5 71.5L235.5 56.5L240.5 46.5L247.5 36.5L264.5 19.5L277.5 11.5L294.5 4.5L316.5 0.5Z',
  'M571.5 0.5L592.5 4.5L613.5 13.5L625.5 21.5L641.5 37.5L648.5 47.5L654.5 59.5L671.5 101.5L679.5 124.5L682.5 141.5L682.5 153.5L679.5 171.5L672.5 190.5L661.5 207.5L644.5 224.5L627.5 235.5L607.5 243.5L593.5 246.5L566.5 246.5L552.5 243.5L532.5 235.5L515.5 223.5L503.5 210.5L492.5 191.5L487.5 177.5L479.5 161.5L475.5 149.5L465.5 128.5L460.5 109.5L460.5 84.5L462.5 74.5L470.5 54.5L484.5 34.5L501.5 19.5L523.5 7.5L536.5 3.5L553.5 0.5Z',
] as const;

/**
 * WebAble's logo, the W. It fills with `currentColor`, so it follows the ink
 * and the theme, and it scales with the root font size like the word beside it.
 */
export function LogoMark({
  size = 16,
  title,
  className,
  style,
  ...rest
}: LogoMarkProps) {
  const width = (size * LOGO_BOX.w) / LOGO_BOX.h;
  return (
    <svg
      className={cx('wa-logo-mark', className)}
      width={width}
      height={size}
      style={{ width: `${width / 16}rem`, height: `${size / 16}rem`, ...style }}
      viewBox={`${LOGO_BOX.x} ${LOGO_BOX.y} ${LOGO_BOX.w} ${LOGO_BOX.h}`}
      fill="currentColor"
      focusable="false"
      {...(title
        ? { role: 'img', 'aria-label': title }
        : { 'aria-hidden': true })}
      {...rest}
    >
      {LOGO_PATHS.map((d) => (
        <path key={d.slice(0, 12)} d={d} />
      ))}
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
