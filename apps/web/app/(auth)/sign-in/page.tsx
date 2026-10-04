import { CheckGlyph, ErrorPanel, Icon, TextLink } from '@webable/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { authErrorMessage } from '../../../lib/auth/errors';
import { safeNextPath } from '../../../lib/auth/routes';
import { getUser } from '../../../lib/data/session';
import { AuthHeading, AuthNotice } from '../_components/AuthHeading';
import { firstParam } from '../../../components/app/forms/auth-forms';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to WebAble to use your fit in this browser.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /sign-in?next=/app/sites&error=link_expired&signed_out=1&deleted=1 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));

  // Already signed in: go where they were headed.
  if (await getUser()) redirect(next);

  const linkError = authErrorMessage(firstParam(params.error));
  const signedOut = firstParam(params.signed_out) === '1';
  const deleted = firstParam(params.deleted) === '1';
  const signUpHref =
    next === '/app' ? '/sign-up' : `/sign-up?next=${encodeURIComponent(next)}`;

  return (
    <>
      <AuthHeading
        title="Sign in"
        deck="Your fit comes with you. Sign in to use it in this browser."
      />

      {linkError ? (
        <ErrorPanel
          title="That link didn’t sign you in"
          className="wa-auth-error"
        >
          <p>{linkError}</p>
        </ErrorPanel>
      ) : null}
      {deleted ? (
        <AuthNotice icon={<CheckGlyph size={20} />}>
          <p>Your account and everything WebAble stored for it were deleted.</p>
        </AuthNotice>
      ) : signedOut ? (
        <AuthNotice icon={<Icon name="info" size={20} />}>
          <p>You’re signed out in this browser.</p>
        </AuthNotice>
      ) : null}

      <SignInForm next={next} />

      <div className="wa-auth-foot">
        <p>
          New to WebAble?{' '}
          <TextLink href={signUpHref}>Create an account</TextLink>
        </p>
      </div>
    </>
  );
}
