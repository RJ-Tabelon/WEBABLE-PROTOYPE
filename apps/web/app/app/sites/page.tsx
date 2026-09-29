import { Icon } from '@webable/ui';
import type { Metadata } from 'next';

import { AppSection, PageHead } from '../../../components/app/PageHead';
import { SitesPanel } from '../../../components/app/sites/SitesPanel';
import { loadUser } from '../data';
import { connection } from 'next/server';

export const metadata: Metadata = { title: 'Sites' };

/**
 * /app/sites: per-site settings, read from this browser's extension over the
 * bridge while the page is open. A list of sites is browsing history, so it
 * stays on this device and never reaches the server.
 */
export default async function SitesPage() {
  await connection();
  const user = await loadUser();
  return (
    <div className="wa-page">
      <PageHead
        title="Sites"
        deck="Sites where you paused WebAble or turned a change off or on. Change them here."
      >
        <div className="wa-page-head__status">
          <div className="wa-app-note">
            <Icon name="lock" size={20} />
            <div className="wa-app-note__body">
              <p className="wa-app-note__title">
                This list stays on this device.
              </p>
              <p>
                It’s read from WebAble in this browser while this page is open.
                WebAble never sends the sites you visit to its server.
              </p>
            </div>
          </div>
        </div>
      </PageHead>

      <AppSection id="sites" title="In this browser">
        <SitesPanel email={user?.email ?? null} />
      </AppSection>
    </div>
  );
}
