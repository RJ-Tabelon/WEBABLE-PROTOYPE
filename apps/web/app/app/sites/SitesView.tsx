'use client';

import { BrowserStatus } from '../../../components/app/BrowserStatus';
import { AppSection, PageHead } from '../../../components/app/PageHead';
import { SitesPanel } from '../../../components/app/sites/SitesPanel';
import { SitesPrivacyLine } from '../../../components/app/sites/SitesPrivacyLine';
import { loadUser } from '../data';
import type { ReactNode } from 'react';
import { AsyncView } from '../../../components/app/AsyncView';
import AppLoading from '../loading';

async function renderSites(): Promise<ReactNode> {
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

export function SitesView() {
  return <AsyncView render={renderSites} fallback={<AppLoading />} />;
}
