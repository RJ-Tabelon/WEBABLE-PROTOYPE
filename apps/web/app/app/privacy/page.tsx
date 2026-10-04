import { Button, ErrorPanel } from '@webable/ui';
import type { Metadata } from 'next';

import { AppSection, PageHead } from '../../../components/app/PageHead';
import { ConsentSwitches } from '../../../components/app/privacy/ConsentSwitches';
import { DataControls } from '../../../components/app/privacy/DataControls';
import { Receipts } from '../../../components/app/privacy/Receipts';
import { loadAccount } from '../data';
import { connection } from 'next/server';

export const metadata: Metadata = { title: 'Privacy' };

/**
 * /app/privacy: what WebAble may send (two consents, both off by default, with
 * exactly what each sends), what this browser actually sent (receipts from the
 * extension, with the exact bodies), and the person's data: download or delete.
 */
export default async function PrivacyPage() {
  await connection();
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
        eyebrow="Both are off unless you turn them on"
        deck="Your fit works without either. Each one says exactly what it sends and to whom."
      >
        {account.ok ? (
          <ConsentSwitches
            cloudAnalysis={account.data.cloudAnalysis}
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
        deck="Every request that left this browser for page analysis, with its exact contents."
      >
        <Receipts
          cloudAnalysis={account.ok ? account.data.cloudAnalysis : false}
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
