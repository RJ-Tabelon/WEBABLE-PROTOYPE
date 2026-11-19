import { Icon } from '@webable/ui';
import type { ReactNode } from 'react';

export interface BrowserWindowProps {
  /** Domain shown in the address field. */
  domain: string;
  /**
   * The toolbar's end: where an extension's badge or control sits. It stays in
   * the accessibility tree (it may hold a real control); the lights and the
   * address are decoration.
   */
  toolbarEnd?: ReactNode;
  /** Smaller chrome, for pictures inside cards. */
  compact?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A desktop browser window drawn around a picture of a page: three window
 * lights, a centred address field and an optional toolbar end. Used for the
 * hero's live sample and the smaller pictures in cards.
 */
export function BrowserWindow({
  domain,
  toolbarEnd,
  compact = false,
  className,
  children,
}: BrowserWindowProps) {
  return (
    <div
      className={['wm-window', compact ? 'wm-window--compact' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="wm-window__bar">
        <span className="wm-window__lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="wm-window__address" aria-hidden="true">
          <Icon name="lock" size={16} />
          <span className="wm-window__domain">{domain}</span>
        </span>
        <span className="wm-window__end">{toolbarEnd}</span>
      </div>
      <div className="wm-window__view">{children}</div>
    </div>
  );
}
