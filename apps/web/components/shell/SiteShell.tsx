import type { ReactNode } from 'react';
import { RouteFocus } from './RouteFocus';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export interface SiteShellProps {
  children: ReactNode;
  /**
   * The visitor is signed in. The site layout reads it on the server
   * (`getUser()`), so the header shows "Your fit" instead of "Sign in" from the
   * first paint. Default false.
   */
  signedIn?: boolean;
}

/**
 * Reading-density page frame for the public site: header, `<main id="main">` (the
 * skip link target) and footer. Use it in the site's route-group layout. Route
 * changes move focus to the new page's h1.
 */
export function SiteShell({ children, signedIn = false }: SiteShellProps) {
  return (
    <div className="wa-site">
      <SiteHeader signedIn={signedIn} />
      <main id="main" tabIndex={-1} className="wa-site__main">
        {children}
      </main>
      <SiteFooter />
      <RouteFocus />
    </div>
  );
}
