import { Button, EmptyState, ErrorPanel } from '@webable/ui';
import type { Metadata } from 'next';

import { BrowserStatus } from '../../components/app/BrowserStatus';
import { FitDocument } from '../../components/app/fit/FitDocument';
import { FitHistory } from '../../components/app/fit/FitHistory';
import { describeHistory } from '../../components/app/fit/history';
import { formatDay } from '../../components/app/format';
import { AppSection, PageHead } from '../../components/app/PageHead';
import { listFitHistory } from '../../lib/data/fit';
import { getLearnedState } from './changes/learning';
import { loadCurrentFit, loadUser } from './data';
import { connection } from 'next/server';

export const metadata: Metadata = { title: 'Your fit' };

const HISTORY_LIMIT = 20;
const TUNE_AGAIN = '/tune?recalibrate=1';

/** /app: the current fit as rows, per-row Adjust, and the version history. */
export default async function YourFitPage() {
  await connection();
  const [user, current] = await Promise.all([loadUser(), loadCurrentFit()]);
  const email = user?.email ?? null;

  if (!current.ok) {
    const unreadable = current.error.code === 'invalid_data';
    return (
      <div className="wa-page">
        <PageHead title="Your fit" />
        <ErrorPanel
          title={
            unreadable
              ? 'Your saved fit couldn’t be read'
              : 'Your fit didn’t load'
          }
          action={
            unreadable ? (
              <Button href={TUNE_AGAIN} variant="secondary" arrow="forward">
                Tune again
              </Button>
            ) : (
              <Button href="/app" variant="secondary" iconStart="refresh-cw">
                Try again
              </Button>
            )
          }
        >
          <p>{current.error.message}</p>
        </ErrorPanel>
      </div>
    );
  }

  if (!current.data) {
    return (
      <div className="wa-page">
        <PageHead
          title="Your fit"
          deck="Your fit is how WebAble adjusts pages for you: text size, contrast, click areas and more."
        >
          <div className="wa-page-head__status">
            <BrowserStatus email={email} />
          </div>
        </PageHead>
        <EmptyState
          title="No fit yet"
          action={
            <Button href="/tune" variant="primary" arrow="forward">
              Tune WebAble
            </Button>
          }
        >
          Three short tasks, about 6 minutes. Then every site starts to fit.
        </EmptyState>
      </div>
    );
  }

  const fit = current.data;
  const now = new Date();
  const [history, learned] = await Promise.all([
    listFitHistory({ limit: HISTORY_LIMIT }),
    getLearnedState(now),
  ]);
  const items = history.ok
    ? describeHistory(history.data, history.data.length < HISTORY_LIMIT)
    : [];

  return (
    <div className="wa-page wa-page--fit">
      <FitDocument
        profile={fit.profile}
        version={fit.version}
        now={now.toISOString()}
        learned={learned.ok ? learned.data.dims : []}
        head={
          <PageHead
            eyebrow={`Version ${fit.version} · saved ${formatDay(fit.createdAt)}`}
            title="Your fit"
            deck="Here’s what WebAble changes on pages for you, and why. Pages with small text are zoomed toward your size, and busy pages can open in Fit view. You can adjust any of it."
          >
            <div className="wa-page-head__status">
              <BrowserStatus email={email} />
            </div>
          </PageHead>
        }
      />

      <AppSection
        id="history"
        title="History"
        eyebrow={
          history.ok
            ? `${history.data.length} ${history.data.length === 1 ? 'version' : 'versions'}`
            : undefined
        }
        deck="Each Tune and each adjustment is saved as a version. Nothing is overwritten."
      >
        {history.ok ? (
          <FitHistory items={items} />
        ) : (
          <ErrorPanel title="History didn’t load" as="h3">
            <p>{history.error.message}</p>
          </ErrorPanel>
        )}
        <div>
          <Button href={TUNE_AGAIN} variant="secondary" arrow="forward">
            Tune again
          </Button>
        </div>
      </AppSection>
    </div>
  );
}
