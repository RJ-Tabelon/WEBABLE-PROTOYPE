import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import type { TuneServerActions } from '../../../components/tune/flow/persist';
import { previousFitFor } from '../../../components/tune/flow/previous';
import { SavePending } from '../../../components/tune/save/SavePending';
import { signInPath } from '../../../lib/auth/routes';
import {
  abandonCalibrationSessionAction,
  completeCalibrationSessionAction,
  saveFitAction,
  startCalibrationSessionAction,
} from '../../../lib/data/actions';
import { getCurrentFit } from '../../../lib/data/fit';
import { getUser } from '../../../lib/data/session';

export const metadata: Metadata = { title: 'Save your fit' };

const SERVER_ACTIONS: TuneServerActions = {
  startCalibrationSession: startCalibrationSessionAction,
  completeCalibrationSession: completeCalibrationSessionAction,
  saveFit: saveFitAction,
  abandonCalibrationSession: abandonCalibrationSessionAction,
};

/**
 * /tune/save: after signing up or in, store the fit a signed-out Tune left in
 * this browser, then clear it. The fit itself is read in the browser. When the
 * account already has a fit, it is loaded here: the waiting fit is derived
 * again against it and compared (Keep new / Keep old) before anything is saved.
 */
export default async function TuneSavePage() {
  const user = await getUser();
  if (!user) redirect(signInPath('/tune/save'));
  const previous = await previousFitFor(true, getCurrentFit);
  return <SavePending actions={SERVER_ACTIONS} previous={previous} />;
}
