import type { Metadata } from 'next';
import { connection } from 'next/server';

import { BrowserStatus } from '../../../components/app/BrowserStatus';
import { AppSection, PageHead } from '../../../components/app/PageHead';
import { SitesPanel } from '../../../components/app/sites/SitesPanel';
import { SitesPrivacyLine } from '../../../components/app/sites/SitesPrivacyLine';
import { loadUser } from '../data';

export const metadata: Metadata = { title: 'Sites' };

/**
 * /app/sites: sites that keep settings of their own, read from this browser's
 * extension over the bridge while the page is open. A list of sites is
 * browsing history, so it stays on this device and never reaches the server.
 */
export default async function SitesPage() {
  await connection();
  const user = await loadUser();
  return (
    <div className="wa-page">
      <PageHead
        title="Sites"
        deck="Sites where you paused WebAble or changed a setting."
      >
        <SitesPrivacyLine />
        <div className="wa-page-head__status">
          <BrowserStatus email={user?.email ?? null} />
        </div>
      </PageHead>

      <AppSection id="sites" title="In this browser">
        <SitesPanel />
      </AppSection>
    </div>
  );
}
