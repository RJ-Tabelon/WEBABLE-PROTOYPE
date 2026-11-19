'use client';

import { CheckGlyph, ErrorPanel, Icon, TextLink } from '@webable/ui';
import { useSearchParams } from 'next/navigation';

import { useSignedInRedirect } from '../../../components/app/forms/useSignedInRedirect';
import { authErrorMessage } from '../../../lib/auth/errors';
import { safeNextPath } from '../../../lib/auth/routes';
import { AuthHeading, AuthNotice } from '../_components/AuthHeading';
import { SignInForm } from './SignInForm';

/** /sign-in?next=/app/sites&error=link_expired&signed_out=1&deleted=1 */
export function SignInView() {
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  // Already signed in: go where they were headed.
  useSignedInRedirect(next);

  const linkError = authErrorMessage(params.get('error'));
  const signedOut = params.get('signed_out') === '1';
  const deleted = params.get('deleted') === '1';
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
