'use client';

import { TextLink } from '@webable/ui';
import { useSearchParams } from 'next/navigation';

import { useSignedInRedirect } from '../../../components/app/forms/useSignedInRedirect';
import { safeNextPath } from '../../../lib/auth/routes';
import { AuthHeading } from '../_components/AuthHeading';
import { SignUpForm } from './SignUpForm';

export function SignUpView() {
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  useSignedInRedirect(next);
  const signInHref =
    next === '/app' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <>
      <AuthHeading
        title="Create your account"
        deck="Your account keeps your fit, so every browser you use can apply it."
      />
      <SignUpForm next={next} />
      <div className="wa-auth-foot">
        <p>
          Already have an account?{' '}
          <TextLink href={signInHref}>Sign in</TextLink>
        </p>
        <p>
          Your account stores your fit and settings. It never stores the sites
          you visit.{' '}
          <TextLink href="/privacy">How WebAble handles data</TextLink>
        </p>
      </div>
    </>
  );
}
