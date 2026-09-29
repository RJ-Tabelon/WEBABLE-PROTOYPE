import { Button, EmptyState, ErrorPanel } from '@webable/ui';
import type { Metadata } from 'next';

import {
  type ActivityItem,
  rowsForWeek,
  summarize,
} from '../../../components/app/changes/activity';
import { FitReadout } from '../../../components/app/fit/FitReadout';
import { formatDay, formatShortDay } from '../../../components/app/format';
import { AppSection, PageHead } from '../../../components/app/PageHead';
import { getWeeklyActivity } from '../../../lib/data/activity';
import { learnedRows } from '../../../components/app/changes/learned';
import { getLearnedState } from './learning';
import { connection } from 'next/server';

export const metadata: Metadata = { title: 'Changes' };

const WEEKS = 8;

function ActivityList({
  items,
  label,
}: {
  items: ActivityItem[];
  label: string;
}) {
  return (
    <ul role="list" className="wa-rows" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="wa-activity-row">
          <p className="wa-row__label">{item.label}</p>
          <p className="wa-row__detail">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * /app/changes: what WebAble changed on pages, week by week, as sentences and a
 * short list per kind of change, plus what it has learned. Domain-free: only
 * weekly counts per change are stored, never sites or pages.
 */
export default async function ChangesPage() {
  await connection();
  const now = new Date();
  const [activity, learned] = await Promise.all([
    getWeeklyActivity({ weeks: WEEKS }, now),
    getLearnedState(now),
  ]);

  const head = (
    <PageHead
      title="Changes"
      deck="What WebAble changed on pages, and what you kept. Only weekly counts are saved, never the sites or pages."
    />
  );

  if (!activity.ok) {
    return (
      <div className="wa-page">
        {head}
        <ErrorPanel
          title="Changes didn’t load"
          action={
            <Button
              href="/app/changes"
              variant="secondary"
              iconStart="refresh-cw"
            >
              Try again
            </Button>
          }
        >
          <p>{activity.error.message}</p>
        </ErrorPanel>
      </div>
    );
  }

  const { weeks, rows } = activity.data;
  const thisWeek = weeks[weeks.length - 1] ?? '';
  const week = summarize(rowsForWeek(rows, thisWeek), 'this week');
  const period = summarize(rows, `in the last ${WEEKS} weeks`);
  const learnedOk = learned.ok ? learned.data : null;
  const hasLearned = Boolean(
    learnedOk && (learnedOk.ops.length > 0 || learnedOk.dims.length > 0),
  );

  if (period.items.length === 0 && !hasLearned) {
    return (
      <div className="wa-page">
        {head}
        <EmptyState
          title="No changes yet"
          action={
            <Button href="/connect" variant="secondary" arrow="forward">
              Check this browser
            </Button>
          }
        >
          Each week, the changes WebAble makes on pages are counted here.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="wa-page">
      {head}

      <AppSection
        id="this-week"
        title="This week"
        eyebrow={`Since Monday, ${formatShortDay(`${thisWeek}T00:00:00Z`)}`}
      >
        {week.items.length > 0 ? (
          <>
            <p className="wa-sentences">{week.sentences.join(' ')}</p>
            <ActivityList
              items={week.items}
              label="This week, by kind of change"
            />
          </>
        ) : (
          <p className="wa-sentences">Nothing yet this week.</p>
        )}
      </AppSection>

      <AppSection
        id="recent"
        title={`Last ${WEEKS} weeks`}
        eyebrow={`Since ${formatDay(`${weeks[0] ?? thisWeek}T00:00:00Z`)}`}
      >
        <p className="wa-sentences">{period.sentences.join(' ')}</p>
        <ActivityList
          items={period.items}
          label={`Last ${WEEKS} weeks, by kind of change`}
        />
      </AppSection>

      <AppSection
        id="learned"
        title="What WebAble has learned"
        eyebrow={
          learnedOk?.updatedAt
            ? `Last updated ${formatDay(learnedOk.updatedAt)}`
            : undefined
        }
        deck="From the changes you keep and undo. It’s saved with your account, without any sites."
      >
        {!learned.ok ? (
          <ErrorPanel title="This part didn’t load" as="h3">
            <p>{learned.error.message}</p>
          </ErrorPanel>
        ) : hasLearned && learnedOk ? (
          <ul
            role="list"
            className="wa-rows"
            aria-label="What WebAble has learned"
          >
            {learnedRows(learnedOk).map((row) => (
              <li key={row.key} className="wa-activity-row">
                <p className="wa-row__label">{row.label}</p>
                <div className="wa-row__detail wa-learned">
                  {row.dim ? (
                    <p>
                      Adjusted as you browse{' '}
                      <FitReadout
                        size="inline"
                        before={row.dim.from}
                        after={row.dim.to}
                        srText={row.dim.srText}
                        changed
                      />
                    </p>
                  ) : null}
                  {row.sentence ? <p>{row.sentence}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wa-app-prose">
            Nothing yet. WebAble learns from the changes you keep and undo.
          </p>
        )}
      </AppSection>
    </div>
  );
}
