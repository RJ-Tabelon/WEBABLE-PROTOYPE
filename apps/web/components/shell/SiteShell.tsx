import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

/**
 * Reading-density page frame for the public site: header, `<main id="main">` (the
 * skip link target) and footer. Use it in the site's route-group layout.
 */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="wa-site">
      <SiteHeader />
      <main id="main" tabIndex={-1} className="wa-site__main">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
