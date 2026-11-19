'use client';

import { Anchor, Wordmark } from '@webable/ui';
import { useRef } from 'react';

import { useScrolledAttr } from '../shell/useScrolledAttr';

/**
 * The calm frame's bar, built like the site header (design-final §7.8): the
 * wordmark on the same content edge (.wa-shell-container), Help as a header
 * link, no border at rest and a hairline after 8 px of scroll.
 */
export function CalmBar() {
  const ref = useRef<HTMLElement>(null);
  useScrolledAttr(ref, 8);
  return (
    <header ref={ref} className="wa-calm__bar">
      <div className="wa-calm__bar-inner wa-shell-container">
        <Anchor href="/" className="wa-calm__brand" aria-label="WebAble home">
          <Wordmark />
        </Anchor>
        <nav aria-label="Support">
          <ul role="list" className="wa-calm__links">
            <li>
              <Anchor href="/help" className="wa-nav-link">
                Help
              </Anchor>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
