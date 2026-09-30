import type { Metadata } from 'next';

import { TuneFlow } from '../../components/tune/TuneFlow';
import type { TuneServerActions } from '../../components/tune/flow/persist';
import { previousFitFor } from '../../components/tune/flow/previous';
import {
  abandonCalibrationSessionAction,
  completeCalibrationSessionAction,
  saveFitAction,
  startCalibrationSessionAction,
} from '../../lib/data/actions';
import { getCurrentFit } from '../../lib/data/fit';
import { getUser } from '../../lib/data/session';

export const metadata: Metadata = { title: 'Tune' };

const SERVER_ACTIONS: TuneServerActions = {
  startCalibrationSession: startCalibrationSessionAction,
  completeCalibrationSession: completeCalibrationSessionAction,
  saveFit: saveFitAction,
  abandonCalibrationSession: abandonCalibrationSessionAction,
};

/**
 * /tune: the calibration tasks. Open to everyone: signed in, the fit is saved
 * to the account; signed out, it waits in this browser until /tune/save.
 * Signed in with a current fit, Tune always compares against it (Keep new /
 * Keep old) and keeps what the person set, whatever the entry point
 * (/tune?recalibrate=1 still works; it is no longer needed).
 */
export default async function TunePage() {
  const user = await getUser();
  const previous = await previousFitFor(user !== null, getCurrentFit);

  return (
    <TuneFlow
      actions={user ? SERVER_ACTIONS : null}
      previous={previous?.profile ?? null}
      previousDate={previous?.createdAt ?? null}
    />
  );
}
