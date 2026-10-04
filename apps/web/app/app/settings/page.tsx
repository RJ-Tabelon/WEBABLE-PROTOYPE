import { Button, ErrorPanel } from '@webable/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';

import { AppSection, PageHead } from '../../../components/app/PageHead';
import {
  EmailRow,
  PasswordRow,
} from '../../../components/app/settings/AccountForms';
import { Installs } from '../../../components/app/settings/Installs';
import { SignOut } from '../../../components/app/settings/SignOut';
import { ThemeRow } from '../../../components/app/settings/ThemeSetting';
import { listInstalls } from '../../../lib/data/installs';
import { createClient } from '../../../lib/supabase/server';
import { loadUser } from '../data';
import { hasPasswordFromClaims, type PasswordClaims } from './password';

export const metadata: Metadata = { title: 'Settings' };

/** Whether this account has a password, from the verified session claims. */
async function accountHasPassword(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    return data?.claims
      ? hasPasswordFromClaims(data.claims as PasswordClaims)
      : false;
  } catch {
    return false;
  }
}

/**
 * /app/settings, as a document: the account (email, password, theme) as
 * hairline rows that open in place, the browsers connected to it, and signing
 * out last.
 */
export default async function SettingsPage() {
  await connection();
  const [user, installs, hasPassword] = await Promise.all([
    loadUser(),
    listInstalls(),
    accountHasPassword(),
  ]);

  return (
    <div className="wa-page">
      <PageHead title="Settings" />

      <AppSection id="account" title="Account">
        <ul role="list" className="wa-rows">
          <EmailRow current={user?.email ?? null} />
          <PasswordRow hasPassword={hasPassword} />
          <ThemeRow />
        </ul>
      </AppSection>

      <AppSection id="browsers" title="Connected browsers">
        {installs.ok ? (
          <Installs initial={installs.data} />
        ) : (
          <ErrorPanel
            title="Connected browsers didn’t load"
            as="h3"
            action={
              <Button
                href="/app/settings"
                variant="secondary"
                iconStart="refresh-cw"
              >
                Try again
              </Button>
            }
          >
            <p>{installs.error.message}</p>
          </ErrorPanel>
        )}
      </AppSection>

      {/* Signing out closes the page: rows under their own (visually hidden) heading. */}
      <section aria-labelledby="sign-out-title" className="wa-app-section">
        <h2 id="sign-out-title" className="sr-only">
          Sign out
        </h2>
        <SignOut />
      </section>
    </div>
  );
}
