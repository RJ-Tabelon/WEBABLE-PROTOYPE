import '../../components/app/calm.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CalmFrame } from '../../components/app/CalmFrame';

export const metadata: Metadata = {
  // Account pages are not search results.
  robots: { index: false, follow: false },
};

/** Sign in, sign up, check email, forgot and reset password: one calm column (--w-form). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <CalmFrame width="form">{children}</CalmFrame>;
}
