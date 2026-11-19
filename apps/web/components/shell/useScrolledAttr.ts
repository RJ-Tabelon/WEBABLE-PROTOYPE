'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Sets `data-scrolled` on `ref`'s element once the page has scrolled more than
 * `threshold` px (8 by default), and removes it at the top. The site header, the
 * app's calm frame and any other sticky bar use it to show their hairline
 * (design-final §7.8). It writes the attribute directly: no re-render per scroll.
 */
export function useScrolledAttr(
  ref: RefObject<HTMLElement | null>,
  threshold = 8,
): void {
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      ref.current?.toggleAttribute('data-scrolled', window.scrollY > threshold);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, threshold]);
}
