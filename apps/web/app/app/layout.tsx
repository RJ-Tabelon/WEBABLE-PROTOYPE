import '../../components/app/app.css';

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { AppSync } from '../../components/app/AppSync';
import { fitUiFor } from '../../components/app/fit/ui';
import { AppShell } from '../../components/shell/AppShell';
import { signInPath } from '../../lib/auth/routes';
import { loadAccount, loadCurrentFit, loadUser } from './data';

export const metadata: Metadata = {
  title: { default: 'Your fit', template: '%s · WebAble' },
  robots: { index: false, follow: false },
};

/**
 * The signed-in app (Working density). The proxy already sends signed-out
 * visitors to sign in; this check is the real boundary for the whole subtree.
 *
 * Landmarks (from AppShell): banner (the 56 px bar below 64em), complementary
 * "App" rail with the "App" navigation and Help pinned at the bottom (64em and
 * wider), main (#main). Each page supplies one h1.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Per-person pages: render at request time, never at build time.
  await connection();
  const user = await loadUser();
  if (!user) redirect(signInPath('/app'));

  const [account, fit] = await Promise.all([loadAccount(), loadCurrentFit()]);

  return (
    <AppShell
      railFooter={
        user.email ? (
          <p className="wa-app-meta">
            Signed in as{' '}
            <span className="wa-app-meta__email">{user.email}</span>
          </p>
        ) : null
      }
    >
      <AppSync
        theme={account.ok ? account.data.theme : null}
        fitUi={fit.ok && fit.data ? fitUiFor(fit.data.profile) : null}
      />
      {children}
    </AppShell>
  );
}
