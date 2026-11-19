import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignInView } from './SignInView';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to WebAble to use your fit in this browser.',
};

/** Reads its query in the browser (the site is static). */
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInView />
    </Suspense>
  );
}
