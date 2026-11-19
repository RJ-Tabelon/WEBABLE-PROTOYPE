import type { ReactNode } from 'react';
import { LogoMark } from './glyphs';
import { cx } from './internal/cx';

export interface WordmarkProps {
  /** Show the W before the word (the lockup). Default true. */
  withMark?: boolean;
  /**
   * Height of the W in px. Default 15: the W beside the 20 px word, 8 px
   * apart. Keep the default unless a surface has a reason.
   */
  glyphSize?: number;
  /**
   * @deprecated The old 24-grid box size (24 on the site, 20 in the popup).
   * Mapped to the lockup's W (24 → 15); use the default lockup instead.
   */
  markSize?: number;
  /** Replace the visible word (rare). Default "WebAble". */
  children?: ReactNode;
  className?: string;
}

/**
 * The lockup: the W logo (15 px tall, about the word's cap height), 8 px before
 * "WebAble" in WebAble Sans at medium weight, −0.01em, 20 px. The tailed l is
 * native to Atkinson Hyperlegible Next: legibility made visible. Every surface
 * (site, app, Tune, popup, welcome) uses this same lockup.
 */
export function Wordmark({
  withMark = true,
  glyphSize,
  markSize,
  children = 'WebAble',
  className,
}: WordmarkProps) {
  const glyph =
    glyphSize ?? (markSize !== undefined ? (markSize * 15) / 24 : 15);
  return (
    <span
      className={cx(
        'wa-wordmark',
        withMark && 'wa-wordmark--lockup',
        className,
      )}
    >
      {withMark ? (
        <LogoMark size={glyph} className="wa-wordmark__mark" />
      ) : null}
      <span className="wa-wordmark__word">{children}</span>
    </span>
  );
}
