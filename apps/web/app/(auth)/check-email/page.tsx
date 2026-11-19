import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CheckEmailView } from './CheckEmailView';

export const metadata: Metadata = { title: 'Check your email' };

/**
 * /check-email?kind=sign-in|sign-up|reset&next=/connect. The address itself
 * never travels in the URL; `next` is kept for "Use a different email".
 */
export default function CheckEmailPage() {
  return (
    <Suspense fallback={null}>
      <CheckEmailView />
    </Suspense>
  );
}
