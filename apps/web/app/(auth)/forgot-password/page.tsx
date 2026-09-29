import { TextLink } from '@webable/ui';
import type { Metadata } from 'next';

import { AuthHeading } from '../_components/AuthHeading';
import { ForgotForm } from './ForgotForm';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading
        title="Reset your password"
        deck="Enter the email you use for WebAble. We’ll send a link to choose a new password."
      />
      <ForgotForm />
      <div className="wa-auth-foot">
        <p>
          Remembered it? <TextLink href="/sign-in">Sign in</TextLink>
        </p>
        <p>
          You can also sign in with an email link, with no password.{' '}
          <TextLink href="/sign-in">Get a sign-in link</TextLink>
        </p>
      </div>
    </>
  );
}
