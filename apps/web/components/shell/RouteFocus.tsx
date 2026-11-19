'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Focuses an element that is not a control, as a starting point (no ring). */
function focusStart(target: HTMLElement) {
  if (!target.hasAttribute('tabindex')) {
    target.tabIndex = -1;
    target.setAttribute('data-route-focus', '');
  }
  target.focus({ preventScroll: true });
}

/**
 * Route changes take 0 ms and focus moves to the new page's h1 (design-final
 * §12), so keyboard and screen-reader users start at the top of what changed.
 * A link to a fragment of another page ("/#how" from /help) starts at that
 * fragment instead. Not on the first render (the browser owns focus on a full
 * load), and not when the new page already put focus inside its main region.
 */
export function RouteFocus() {
  const pathname = usePathname();
  // The last path seen. Comparing paths (not a "first run" flag) also holds
  // when effects run twice in development.
  const last = useRef<string | null>(null);
  useEffect(() => {
    const previous = last.current;
    last.current = pathname;
    if (previous === null || previous === pathname) return;
    const main = document.querySelector('main');
    const active = document.activeElement;
    if (main && active && active !== main && main.contains(active)) return;
    const hash = window.location.hash.slice(1);
    let fragment: HTMLElement | null = null;
    if (hash) {
      try {
        fragment = document.getElementById(decodeURIComponent(hash));
      } catch {
        fragment = null;
      }
    }
    const target = fragment ?? main?.querySelector<HTMLElement>('h1') ?? null;
    if (target) focusStart(target);
  }, [pathname]);
  return null;
}
