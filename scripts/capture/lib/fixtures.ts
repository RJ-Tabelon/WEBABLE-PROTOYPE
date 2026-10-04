/**
 * Data the capture harness needs from the TypeScript side of the repo, bundled
 * at run time by esbuild (see lib/bundle.mjs) so the harness itself stays plain
 * Node. Everything is re-exported from the existing test helpers, so the
 * captures show the same fits, activity and extension states the e2e suites
 * assert on.
 */
import {
  fakeState,
  installFakeExtension,
} from '../../../apps/web/e2e/support/fake-extension';
import {
  LAST_WEEK,
  THIS_WEEK,
  mondayOf,
} from '../../../apps/web/e2e/support/activity';
import { measuredFit } from '../../../apps/web/e2e/support/fit';
import {
  fakeSession,
  startDecideStub,
} from '../../../apps/extension/tests/e2e/supabase-stub';
import {
  focusProfile,
  strongReaderProfile,
} from '../../../packages/core/src/policy/fixtures';
import { READING_SENTENCES } from '../../../packages/core/src/calibration/stimuli';
import type { FitProfile } from '../../../packages/core/src/profile/schema';

export {
  fakeSession,
  fakeState,
  focusProfile,
  installFakeExtension,
  measuredFit,
  mondayOf,
  READING_SENTENCES,
  startDecideStub,
  strongReaderProfile,
};

const DAY_MS = 86_400_000;

/** The e2e strong reader fit with a 16 px text floor: WebAble's own UI stays at text scale 1. */
export function readerProfile(): FitProfile {
  const p = strongReaderProfile();
  p.vision.textMinPx = {
    value: 16,
    source: 'measured',
    confidence: 0.85,
    measured: 16,
  };
  return p;
}

/** The e2e focus fit (distraction and motion needs) at text scale 1. */
export function focusReaderProfile(): FitProfile {
  const p = focusProfile();
  p.vision.textMinPx = {
    value: 16,
    source: 'measured',
    confidence: 0.85,
    measured: 16,
  };
  return p;
}

/** A reader fit whose text floor puts WebAble's own UI at text scale 1.5 (24 / 16). */
export function largeTextProfile(): FitProfile {
  const p = strongReaderProfile();
  p.vision.textMinPx = {
    value: 24,
    source: 'measured',
    confidence: 0.85,
    measured: 24,
  };
  return p;
}

/** An earlier fit, for the history list on Your fit. */
export function earlierFit(now: Date): FitProfile {
  const p = measuredFit(new Date(now.getTime() - 21 * DAY_MS));
  p.vision.textMinPx = {
    value: 16,
    source: 'measured',
    confidence: 0.6,
    measured: 16,
  };
  p.modules = { reading: 'measured', pointing: 'skipped', focus: 'skipped' };
  p.confidence = 0.5;
  return p;
}

export interface WeeklyRow {
  week: string;
  op: string;
  applied: number;
  kept: number;
  undone: number;
  undone_by_checks: number;
  offered: number;
  accepted: number;
}

/** The e2e two-week history (THIS_WEEK / LAST_WEEK) as weekly_activity rows. */
export function weeklyActivityRows(now: Date): WeeklyRow[] {
  const rows: WeeklyRow[] = [];
  const weeks = [
    [mondayOf(new Date(now.getTime() - 7 * DAY_MS)), LAST_WEEK],
    [mondayOf(now), THIS_WEEK],
  ] as const;
  for (const [week, counts] of weeks) {
    for (const [op, c] of Object.entries(counts)) {
      const v = c as Partial<Omit<WeeklyRow, 'week' | 'op'>>;
      rows.push({
        week,
        op,
        applied: v.applied ?? 0,
        kept: v.kept ?? 0,
        undone: v.undone ?? 0,
        undone_by_checks: v.undone_by_checks ?? 0,
        offered: v.offered ?? 0,
        accepted: v.accepted ?? 0,
      });
    }
  }
  return rows;
}

/** The learning state seedActivity() writes (apps/web/e2e/support/activity.ts). */
export function learningState(now: Date): unknown {
  const today = Math.floor(now.getTime() / DAY_MS);
  return {
    v: 1,
    ops: {
      text_floor: { c: { s: 9, f: 1, t: today }, src: 'profile' },
      target_size: { c: { s: 1, f: 5, t: today }, src: 'profile' },
      calm_motion: { c: { s: 0, f: 0, t: today }, src: 'none', blocked: true },
    },
    dims: {
      textPx: {
        m: Math.log(20),
        v: 0.01,
        t: today,
        mCal: Math.log(18),
        vCal: 0.02,
      },
    },
  };
}
