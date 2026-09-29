import { Anchor, Wordmark } from '@webable/ui';
import type { ReactNode } from 'react';

export interface CalmFrameProps {
  children: ReactNode;
  /** `form` (30rem) for account forms; `task` (45rem) for the extension handoff. */
  width?: 'form' | 'task';
}

/**
 * The calm frame for account pages and the extension handoff.
 *
 * Landmarks: banner (wordmark and Help, which stays in the same place on every
 * page: WCAG 3.2.6), main (#main, the skip-link target), contentinfo (the
 * honesty line and Privacy). Pages supply exactly one h1.
 */
export function CalmFrame({ children, width = 'form' }: CalmFrameProps) {
  return (
    <div className="wa-calm">
      <header className="wa-calm__bar">
        <Anchor href="/" className="wa-calm__brand" aria-label="WebAble home">
          <Wordmark />
        </Anchor>
        <nav aria-label="Support">
          <ul role="list" className="wa-calm__links">
            <li>
              <Anchor href="/help">Help</Anchor>
            </li>
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="wa-calm__main">
        <div className={`wa-calm__column wa-calm__column--${width}`}>
          {children}
        </div>
      </main>
      <footer className="wa-calm__footer">
        <p className="wa-calm__honesty">
          WebAble changes how pages look and work for you. It doesn’t make any
          site accessible or compliant.
        </p>
        <ul role="list" className="wa-calm__links">
          <li>
            <Anchor href="/privacy">Privacy</Anchor>
          </li>
          <li>
            <Anchor href="/privacy#what-webable-sends">
              What WebAble sends
            </Anchor>
          </li>
        </ul>
      </footer>
    </div>
  );
}
