'use client';

import { Actions, Button } from '@webable/ui';
import { useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { AsyncView } from '../../../components/app/AsyncView';
import { safeNextPath } from '../../../lib/auth/routes';
import { getUser } from '../../../lib/data/session';
import { AuthHeading } from '../_components/AuthHeading';
import { ResetForm } from './ResetForm';

async function renderReset(next: string) {
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

/**
 * The recovery email link lands here after /auth/callback has signed this
 * browser in. Without a session the link has expired or was already used.
 */
export function ResetView() {
  const next = safeNextPath(useSearchParams().get('next'));
  const render = useCallback(() => renderReset(next), [next]);
  return <AsyncView render={render} />;
}
