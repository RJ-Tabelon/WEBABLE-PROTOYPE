'use client';

import { Button, ErrorPanel } from '@webable/ui';

import { AppSection, PageHead } from '../../../components/app/PageHead';
import { ConsentSwitches } from '../../../components/app/privacy/ConsentSwitches';
import { DataControls } from '../../../components/app/privacy/DataControls';
import { Receipts } from '../../../components/app/privacy/Receipts';
import { loadAccount } from '../data';
import type { ReactNode } from 'react';
import { AsyncView } from '../../../components/app/AsyncView';
import AppLoading from '../loading';

async function renderPrivacy(): Promise<ReactNode> {
  const account = await loadAccount();

  return (
    <div className="wa-page">
      <PageHead
        title="Privacy"
        deck="What WebAble may send, what it actually sent from this browser, and your data to download or delete."
      />

      <AppSection
        id="sharing"
        title="What WebAble may send"
        eyebrow="Each is off unless you turn it on"
        deck="Your fit works without any of them. Each one says exactly what it sends and to whom."
      >
        {account.ok ? (
          <ConsentSwitches
            cloudAnalysis={account.data.cloudAnalysis}
            aiLayout={account.data.aiLayout}
            productLearning={account.data.productLearning}
          />
        ) : (
          <ErrorPanel
            title="These settings didn’t load"
            as="h3"
            action={
              <Button
                href="/app/privacy"
                variant="secondary"
                iconStart="refresh-cw"
              >
                Try again
              </Button>
            }
          >
            <p>{account.error.message}</p>
          </ErrorPanel>
        )}
      </AppSection>

      <AppSection
        id="what-was-sent"
        title="What was sent"
        eyebrow="From this browser"
        deck="Every request that left this browser for page analysis or Fit view layouts, with its exact contents."
      >
        <Receipts
          cloudAnalysis={account.ok ? account.data.cloudAnalysis : false}
          aiLayout={account.ok ? account.data.aiLayout : false}
        />
      </AppSection>

      <AppSection
        id="your-data"
        title="Your data"
        eyebrow="Saved with your account"
      >
        <DataControls />
      </AppSection>
    </div>
  );
}

export function PrivacyView() {
  return <AsyncView render={renderPrivacy} fallback={<AppLoading />} />;
}
