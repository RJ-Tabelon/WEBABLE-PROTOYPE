'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import AppLoading from '../../app/app/loading';
import { loadAccount, loadCurrentFit, loadUser } from '../../app/app/data';
import { signInPath } from '../../lib/auth/routes';
import { stripBase } from '../../lib/base-path';
import type { Account } from '../../lib/data/account';
import type { FitVersion } from '../../lib/data/fit';
import { useDataVersion } from '../../lib/data/refresh';
import type { DataResult } from '../../lib/data/result';
import type { SessionUser } from '../../lib/data/session';
import { AppShell } from '../shell/AppShell';
import { AppSync } from './AppSync';
import { fitUiFor } from './fit/ui';

interface Frame {
  user: SessionUser;
  account: DataResult<Account>;
  fit: DataResult<FitVersion | null>;
}

/**
 * The signed-in app's frame. It checks the session in the browser before any
 * page reads data: signed-out visitors go to sign in and come back here after.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const version = useDataVersion();
  const [frame, setFrame] = useState<Frame | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const user = await loadUser();
      if (!live) return;
      if (!user) {
        const here = stripBase(window.location.pathname);
        router.replace(signInPath(`${here}${window.location.search}`));
        return;
      }
      const [account, fit] = await Promise.all([
        loadAccount(),
        loadCurrentFit(),
      ]);
      if (live) setFrame({ user, account, fit });
    })().catch((error: unknown) => {
      if (live) setFailure(error);
    });
    return () => {
      live = false;
    };
  }, [version, router]);

  if (failure) throw failure;

  return (
    <AppShell
      railFooter={
        frame?.user.email ? (
          <p className="wa-app-meta">
            Signed in as{' '}
            <span className="wa-app-meta__email">{frame.user.email}</span>
          </p>
        ) : null
      }
    >
      {frame ? (
        <>
          <AppSync
            theme={frame.account.ok ? frame.account.data.theme : null}
            themeSetAt={frame.account.ok ? frame.account.data.themeSetAt : null}
            fitUi={
              frame.fit.ok && frame.fit.data
                ? fitUiFor(frame.fit.data.profile)
                : null
            }
          />
          {children}
        </>
      ) : (
        <AppLoading />
      )}
    </AppShell>
  );
}
