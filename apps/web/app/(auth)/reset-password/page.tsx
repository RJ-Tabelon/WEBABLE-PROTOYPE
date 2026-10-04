import { Actions, Button } from '@webable/ui';
import type { Metadata } from 'next';

import { safeNextPath } from '../../../lib/auth/routes';
import { getUser } from '../../../lib/data/session';
import { AuthHeading } from '../_components/AuthHeading';
import { firstParam } from '../../../components/app/forms/auth-forms';
import { ResetForm } from './ResetForm';

export const metadata: Metadata = { title: 'Choose a new password' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The recovery email link lands here after /auth/callback has signed this
 * browser in. Without a session the link has expired or was already used.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const next = safeNextPath(firstParam((await searchParams).next));
  const user = await getUser();

  if (!user) {
    return (
      <>
        <AuthHeading
          title="This link has expired"
          deck="Reset links work once, for a short time. Ask for a new one, and use it soon."
        />
        <Actions>
          <Button href="/forgot-password" variant="primary" arrow="forward">
            Ask for a new link
          </Button>
          <Button href="/sign-in" variant="secondary">
            Sign in
          </Button>
        </Actions>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title="Choose a new password"
        deck={
          user.email
            ? `For ${user.email}.`
            : 'For the account you just opened the link for.'
        }
      />
      <ResetForm next={next} />
    </>
  );
}
