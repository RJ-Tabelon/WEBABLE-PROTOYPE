'use client';

import { Anchor, Button, Sheet, Wordmark } from '@webable/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GET_STARTED, SIGN_IN, SITE_NAV, isCurrent } from './nav';

/** True after the page has scrolled more than 8 px (the header hairline appears). */
function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > threshold);
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
  }, [threshold]);
  return scrolled;
}

/**
 * Site header (design-final §7.8). 56 px, 64 at ≥64em. Sticky only when the viewport
 * is at least 37.5em tall, so at 400% zoom it scrolls away instead of covering the
 * page. It never hides on scroll direction. A hairline appears after 8 px of scroll.
 * Below 64em the links move into a full-screen Menu sheet.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const scrolled = useScrolled();
  const [menuOpen, setMenuOpen] = useState(false);

  // Following a link closes the menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="wa-site-header" data-scrolled={scrolled || undefined}>
      <div className="wa-site-header__inner">
        <Anchor
          href="/"
          className="wa-site-header__brand"
          aria-label="WebAble home"
        >
          <Wordmark />
        </Anchor>

        <nav className="wa-site-header__nav" aria-label="Main">
          <ul role="list">
            {SITE_NAV.map((link) => (
              <li key={link.href}>
                <Anchor
                  href={link.href}
                  className="wa-nav-link"
                  aria-current={
                    isCurrent(pathname, link.href) ? 'page' : undefined
                  }
                >
                  {link.label}
                </Anchor>
              </li>
            ))}
          </ul>
        </nav>

        <div className="wa-site-header__actions">
          <Button
            href={SIGN_IN.href}
            variant="ghost"
            size="md"
            className="wa-site-header__sign-in"
            aria-current={
              isCurrent(pathname, SIGN_IN.href) ? 'page' : undefined
            }
          >
            {SIGN_IN.label}
          </Button>
          <Button
            href={GET_STARTED.href}
            variant="primary"
            size="md"
            arrow="forward"
            className="wa-site-header__cta"
          >
            {GET_STARTED.label}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            iconStart="menu"
            className="wa-site-header__menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            Menu
          </Button>
        </div>
      </div>

      <Sheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        placement="full"
        title="Menu"
        hideTitle
        headerStart={<Wordmark />}
        footer={
          <Button
            href={GET_STARTED.href}
            variant="primary"
            size="lg"
            arrow="forward"
            block
          >
            {GET_STARTED.label}
          </Button>
        }
      >
        <nav aria-label="Main">
          <ul role="list" className="wa-menu-list">
            {[...SITE_NAV, SIGN_IN].map((link) => (
              <li key={link.href}>
                <Anchor
                  href={link.href}
                  className="wa-menu-list__link"
                  aria-current={
                    isCurrent(pathname, link.href) ? 'page' : undefined
                  }
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </Anchor>
              </li>
            ))}
          </ul>
        </nav>
      </Sheet>
    </header>
  );
}
