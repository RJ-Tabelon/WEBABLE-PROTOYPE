'use client';

import { ConnectFlow } from '../../components/app/connect/ConnectFlow';
import { signInPath } from '../../lib/auth/routes';
import { getCurrentFit } from '../../lib/data/fit';
import { getUser } from '../../lib/data/session';
import { chromeStoreUrl } from '../../lib/extension/store';
import type { ReactNode } from 'react';
import { AsyncView, redirectTo } from '../../components/app/AsyncView';
import ConnectLoading from './loading';

async function renderConnect(): Promise<ReactNode> {
  const user = await getUser();
  if (!user) redirectTo(signInPath('/connect'));
  const fit = await getCurrentFit();
  const development = process.env.NODE_ENV !== 'production';

  return (
    <ConnectFlow
      email={user.email}
      hasFit={fit.ok && fit.data !== null}
      storeUrl={chromeStoreUrl()}
      showDevSteps={development}
    />
  );
}

export function ConnectView() {
  return <AsyncView render={renderConnect} fallback={<ConnectLoading />} />;
}
