'use client';

import {
  Anchor,
  Button,
  Icon,
  Mark,
  Sheet,
  Wordmark,
  type IconName,
} from '@webable/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  APP_HELP,
  APP_NAV,
  isCurrent,
  type AppNavIcon,
  type AppNavLink,
} from './nav';

const ICONS: Record<Exclude<AppNavIcon, 'fit'>, IconName> = {
  changes: 'square-dashed',
  sites: 'monitor',
  privacy: 'lock',
  settings: 'settings',
  help: 'circle-help',
};

function NavIcon({ icon }: { icon: AppNavIcon }) {
  // "Your fit" wears the mark: a page, measured.
  if (icon === 'fit') return <Mark size={20} />;
  return <Icon name={ICONS[icon]} size={20} />;
}

function NavItem({
  link,
  pathname,
  onNavigate,
}: {
  link: AppNavLink;
  pathname: string | null;
  onNavigate?: () => void;
}) {
  return (
    <Anchor
      href={link.href}
      className="wa-app-nav__link"
      aria-current={isCurrent(pathname, link.href) ? 'page' : undefined}
      onClick={onNavigate}
    >
      <NavIcon icon={link.icon} />
      <span>{link.label}</span>
    </Anchor>
  );
}

function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string | null;
  onNavigate?: () => void;
}) {
  return (
    <ul role="list" className="wa-app-nav__list">
      {APP_NAV.map((link) => (
        <li key={link.href}>
          <NavItem link={link} pathname={pathname} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}

export interface AppShellProps {
  children: ReactNode;
  /** Optional block at the bottom of the rail, above Help (e.g. the signed-in email). */
  railFooter?: ReactNode;
}

/**
 * Working-density app frame (design-final §7.9). At ≥64em a 240 px rail with Your
 * fit, Changes, Sites, Privacy and Settings, and Help pinned at the bottom; below
 * that a 56 px top bar and a Menu sheet with the same items. App pages are
 * documents, not dashboards: an h2 title, index-ruled sections, hairline rows.
 */
export function AppShell({ children, railFooter }: AppShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="wa-app-root">
      <div className="wa-app">
        <header className="wa-app__bar">
          <Anchor
            href="/app"
            className="wa-app__brand"
            aria-label="WebAble, your fit"
          >
            <Wordmark />
          </Anchor>
          <Button
            variant="ghost"
            size="lg"
            iconStart="menu"
            className="wa-app__menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            Menu
          </Button>
        </header>

        <aside className="wa-app__rail" aria-label="App">
          <Anchor
            href="/app"
            className="wa-app__brand wa-app__brand--rail"
            aria-label="WebAble, your fit"
          >
            <Wordmark />
          </Anchor>
          <nav className="wa-app-nav" aria-label="App">
            <NavList pathname={pathname} />
          </nav>
          <div className="wa-app__rail-end">
            {railFooter ? (
              <div className="wa-app__rail-footer">{railFooter}</div>
            ) : null}
            <NavItem link={APP_HELP} pathname={pathname} />
          </div>
        </aside>

        <main id="main" tabIndex={-1} className="wa-app__main">
          <div className="wa-app__content">{children}</div>
        </main>

        <Sheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          placement="full"
          title="Menu"
          hideTitle
          headerStart={<Wordmark />}
        >
          <nav className="wa-app-nav wa-app-nav--sheet" aria-label="App">
            <NavList
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
            />
            <div className="wa-app-nav__end">
              {railFooter ? (
                <div className="wa-app__rail-footer">{railFooter}</div>
              ) : null}
              <NavItem
                link={APP_HELP}
                pathname={pathname}
                onNavigate={() => setMenuOpen(false)}
              />
            </div>
          </nav>
        </Sheet>
      </div>
    </div>
  );
}
