'use client';

import { Anchor, Button, Sheet, Wordmark } from '@webable/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  GET_STARTED,
  SIGN_IN,
  SITE_NAV,
  YOUR_FIT,
  isCurrent,
  type NavLink,
} from './nav';
import { useScrolledAttr } from './useScrolledAttr';

export interface SiteHeaderProps {
  /**
   * The visitor is signed in (read on the server by the site layout). "Sign in"
   * goes away and the primary action becomes "Your fit", to the app.
   */
  signedIn?: boolean;
}

/**
 * Site header (design-final §7.8). 56 px, 64 at ≥64em. Sticky only when the viewport
 * is at least 37.5em tall, so at 400% zoom it scrolls away instead of covering the
 * page. It never hides on scroll direction. A hairline appears after 8 px of scroll.
 *
 * Its breakpoints are container queries in the header's own em, so they follow
 * the person's text scale:
 * - ≥64em: the lockup, the links, Sign in and the primary action.
 * - 30–64em: the word alone (the mark would sit beside the Menu glyph), the
 *   primary action and Menu with its visible word.
 * - <30em: the word and a 48 px icon-only Menu (named "Menu").
 * At a large text scale the row wraps rather than scrolling sideways.
 */
export function SiteHeader({ signedIn = false }: SiteHeaderProps) {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useScrolledAttr(headerRef, 8);

  // Following a link closes the menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const primary: NavLink = signedIn ? YOUR_FIT : GET_STARTED;
  const menuLinks: readonly NavLink[] = signedIn
    ? SITE_NAV
    : [...SITE_NAV, SIGN_IN];

  return (
    <header ref={headerRef} className="wa-site-header">
      <div className="wa-site-header__inner wa-shell-container">
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
          {signedIn ? null : (
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
          )}
          <Button
            href={primary.href}
            variant="primary"
            size="md"
            arrow="forward"
            className="wa-site-header__cta"
          >
            {primary.label}
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
        headerStart={<Wordmark withMark={false} />}
        footer={
          <Button
            href={primary.href}
            variant="primary"
            size="lg"
            arrow="forward"
            block
            onClick={() => setMenuOpen(false)}
          >
            {primary.label}
          </Button>
        }
      >
        <nav aria-label="Main">
          <ul role="list" className="wa-menu-list">
            {menuLinks.map((link) => (
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
