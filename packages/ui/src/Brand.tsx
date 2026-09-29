import type { ReactNode } from 'react';
import { Mark } from './glyphs';
import { cx } from './internal/cx';

export interface WordmarkProps {
  /** Show the mark before the word. Default true. */
  withMark?: boolean;
  /** Mark size in px: 24 on the site, 20 in the popup and task bar. Default 24. */
  markSize?: number;
  /** Replace the visible word (rare). Default "WebAble". */
  children?: ReactNode;
  className?: string;
}

/**
 * The wordmark: "WebAble" in WebAble Sans at medium weight, −0.01em, 20 px. The
 * tailed l is native to Atkinson Hyperlegible Next: legibility made visible.
 */
export function Wordmark({
  withMark = true,
  markSize = 24,
  children = 'WebAble',
  className,
}: WordmarkProps) {
  return (
    <span className={cx('wa-wordmark', className)}>
      {withMark ? <Mark size={markSize} className="wa-wordmark__mark" /> : null}
      <span className="wa-wordmark__word">{children}</span>
    </span>
  );
}
