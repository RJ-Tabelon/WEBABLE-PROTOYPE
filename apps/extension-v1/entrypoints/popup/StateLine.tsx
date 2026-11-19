import type { Ref } from 'react';
import { StatusShape, useStillChecking } from '@webable/ui';

import type { StateGlyph } from '@/lib/popup/copy';

export interface StateLineProps {
  glyph: StateGlyph;
  title: string;
  /** Shown once the arc has turned for 5 s (nothing loops forever). */
  stillTitle?: string;
  ref?: Ref<HTMLHeadingElement>;
}

/**
 * The popup state line (design-final 7.13 line size): a 20 px glyph and a
 * 20 / medium title in the view's h1. Focusable by script so the popup can
 * announce the state first. Shape carries the state; the word says it.
 */
export function StateLine({
  glyph,
  title,
  stillTitle = 'Still checking',
  ref,
}: StateLineProps) {
  const still = useStillChecking(glyph === 'checking' ? 'checking' : 'on');
  const shape = glyph === 'checking' && still ? 'still-checking' : glyph;
  const text = glyph === 'checking' && still ? stillTitle : title;
  return (
    <h1 ref={ref} tabIndex={-1} className="wa-status-line pp-state__title">
      <StatusShape state={shape} size={20} />
      <span className="wa-status-line__title">{text}</span>
    </h1>
  );
}
