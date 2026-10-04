import { Button, ErrorPanel } from '@webable/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';

import {
  activityTable,
  askedLine,
  rowsForWeek,
  totalsOf,
  weekSentence,
} from '../../../components/app/changes/activity';
import { ActivityTable } from '../../../components/app/changes/ActivityTable';
import { ChangesEmpty } from '../../../components/app/changes/ChangesEmpty';
import { learnedRows } from '../../../components/app/changes/learned';
import { LearnedSection } from '../../../components/app/changes/LearnedSection';
import { formatDay, formatShortDay } from '../../../components/app/format';
import { AppSection, PageHead } from '../../../components/app/PageHead';
import { getWeeklyActivity } from '../../../lib/data/activity';
import { loadCurrentFit, loadUser } from '../data';
import { getLearnedState } from './learning';

export const metadata: Metadata = { title: 'Changes' };

const WEEKS = 8;

/**
 * /app/changes: what WebAble changed on pages, as one sentence about this week
 * and one table by kind of change over 8 weeks, then what it has learned (each
 * part undoable). Domain-free: only weekly counts per change are stored, never
 * sites or pages.
 */
export default async function ChangesPage() {
  await connection();
  const now = new Date();
  const [activity, learned, user, fit] = await Promise.all([
    getWeeklyActivity({ weeks: WEEKS }, now),
    getLearnedState(now),
    loadUser(),
    loadCurrentFit(),
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
  const firstWeek = weeks[0] ?? thisWeek;
  const table = activityTable(rows, thisWeek);
  const week = totalsOf(rowsForWeek(rows, thisWeek));
  const asked = askedLine(totalsOf(rows));
  const learnedOk = learned.ok ? learned.data : null;
  const learnedList = learnedOk ? learnedRows(learnedOk) : [];
  const hasFit = fit.ok && fit.data !== null;

  return (
    <div className="wa-page">
      {head}

      {table.length === 0 ? (
        <ChangesEmpty hasFit={hasFit} email={user?.email ?? null} />
      ) : (
        <AppSection
          id="recent"
          title={`Last ${WEEKS} weeks`}
          eyebrow={`Since ${formatShortDay(`${firstWeek}T00:00:00Z`)}`}
        >
          <div className="wa-changes-summary">
            <p className="wa-changes-summary__sentence">{weekSentence(week)}</p>
            {asked ? <p className="wa-app-meta">{asked}</p> : null}
          </div>
          <ActivityTable rows={table} weeks={WEEKS} />
        </AppSection>
      )}

      {!learned.ok ? (
        <AppSection id="learned" title="What WebAble has learned">
          <ErrorPanel title="This part didn’t load" as="h3">
            <p>{learned.error.message}</p>
          </ErrorPanel>
        </AppSection>
      ) : table.length > 0 || learnedList.length > 0 ? (
        <LearnedSection
          initial={learnedList}
          eyebrow={
            learnedOk?.updatedAt
              ? `Last updated ${formatDay(learnedOk.updatedAt)}`
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
