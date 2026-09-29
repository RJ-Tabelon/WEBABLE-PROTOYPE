import type { FitProfile } from '@webable/core';
import type { Metadata } from 'next';

import { TuneFlow } from '../../components/tune/TuneFlow';
import type { TuneServerActions } from '../../components/tune/flow/persist';
import {
  abandonCalibrationSessionAction,
  completeCalibrationSessionAction,
  saveFitAction,
  startCalibrationSessionAction,
} from '../../lib/data/actions';
import { getCurrentFit } from '../../lib/data/fit';
import { getUser } from '../../lib/data/session';

export const metadata: Metadata = { title: 'Tune' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SERVER_ACTIONS: TuneServerActions = {
  startCalibrationSession: startCalibrationSessionAction,
  completeCalibrationSession: completeCalibrationSessionAction,
  saveFit: saveFitAction,
  abandonCalibrationSession: abandonCalibrationSessionAction,
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * /tune: the calibration tasks. Open to everyone: signed in, the fit is saved
 * to the account; signed out, it waits in this browser until /tune/save.
 * /tune?recalibrate=1 compares against the current fit (Keep new / Keep old).
 */
export default async function TunePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const user = await getUser();
  const wantsRecalibration = first(params.recalibrate) === '1';

  let previous: { profile: FitProfile; createdAt: string } | null = null;
  if (user && wantsRecalibration) {
    const current = await getCurrentFit();
    if (current.ok && current.data) {
      previous = {
        profile: current.data.profile,
        createdAt: current.data.createdAt,
      };
    }
  }

  return (
    <TuneFlow
      actions={user ? SERVER_ACTIONS : null}
      previous={previous?.profile ?? null}
      previousDate={previous?.createdAt ?? null}
    />
  );
}
