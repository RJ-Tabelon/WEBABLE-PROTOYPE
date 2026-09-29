import { Button, ErrorPanel } from '@webable/ui';
import type { Metadata } from 'next';

import { AppSection, PageHead } from '../../../components/app/PageHead';
import {
  EmailForm,
  PasswordForm,
} from '../../../components/app/settings/AccountForms';
import { Installs } from '../../../components/app/settings/Installs';
import { SignOut } from '../../../components/app/settings/SignOut';
import { ThemeSetting } from '../../../components/app/settings/ThemeSetting';
import { listInstalls } from '../../../lib/data/installs';
import { loadUser } from '../data';
import { connection } from 'next/server';

export const metadata: Metadata = { title: 'Settings' };

/** /app/settings: appearance, sign-in details, connected browsers, sign out. */
export default async function SettingsPage() {
  await connection();
  const [user, installs] = await Promise.all([loadUser(), listInstalls()]);

  return (
    <div className="wa-page">
      <PageHead
        title="Settings"
        deck="How WebAble looks, how you sign in, and where it’s connected."
      />

      <AppSection id="appearance" title="Appearance">
        <ThemeSetting />
      </AppSection>

      <AppSection id="email" title="Email">
        <EmailForm current={user?.email ?? null} />
      </AppSection>

      <AppSection id="password" title="Password">
        <PasswordForm />
      </AppSection>

      <AppSection
        id="browsers"
        title="Connected browsers"
        deck="Each browser where WebAble is signed in to your account."
      >
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

      <AppSection id="sign-out" title="Sign out">
        <SignOut />
      </AppSection>
    </div>
  );
}
