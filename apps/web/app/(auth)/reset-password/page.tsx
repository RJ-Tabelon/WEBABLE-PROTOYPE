import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ResetView } from './ResetView';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetView />
    </Suspense>
  );
}
