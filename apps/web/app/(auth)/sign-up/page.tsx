import { TextLink } from '@webable/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { safeNextPath } from '../../../lib/auth/routes';
import { getUser } from '../../../lib/data/session';
import { AuthHeading } from '../_components/AuthHeading';
import { firstParam } from '../../../components/app/forms/auth-forms';
import { SignUpForm } from './SignUpForm';

export const metadata: Metadata = {
  title: 'Create your account',
  description:
    'A WebAble account keeps your fit, so every browser you use can apply it.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  if (await getUser()) redirect(next);
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
