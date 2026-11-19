import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignUpView } from './SignUpView';

export const metadata: Metadata = {
  title: 'Create your account',
  description:
    'A WebAble account keeps your fit, so every browser you use can apply it.',
};

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpView />
    </Suspense>
  );
}
