import '../../components/site/sample/sample.css';
import '../../components/site/site.css';

import type { ReactNode } from 'react';
import { SiteShell } from '../../components/shell/SiteShell';

/**
 * The public website: home, privacy, research, accessibility and help. Reading
 * density (design-final §14) inside the site header and footer.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <SiteShell>
      <div className="ws-root">{children}</div>
    </SiteShell>
  );
}
