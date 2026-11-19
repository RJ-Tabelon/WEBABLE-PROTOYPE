'use client';

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
import type { ReactNode } from 'react';
import { AsyncView, redirectTo } from '../../../components/app/AsyncView';

const SERVER_ACTIONS: TuneServerActions = {
  startCalibrationSession: startCalibrationSessionAction,
  completeCalibrationSession: completeCalibrationSessionAction,
  saveFit: saveFitAction,
  abandonCalibrationSession: abandonCalibrationSessionAction,
};

async function renderTuneSave(): Promise<ReactNode> {
  const user = await getUser();
  if (!user) redirectTo(signInPath('/tune/save'));
  const previous = await previousFitFor(true, getCurrentFit);
  return <SavePending actions={SERVER_ACTIONS} previous={previous} />;
}

export function TuneSaveView() {
  return <AsyncView render={renderTuneSave} fallback={null} />;
}
