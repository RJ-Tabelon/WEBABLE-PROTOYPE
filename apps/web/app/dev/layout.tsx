import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import './dev.css';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Design-review pages. Never indexed, and not served by a production build
 * unless WEBABLE_DEV_PAGES=1 (the capture harness sets it).
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.WEBABLE_DEV_PAGES !== '1'
  )
    notFound();
  return children;
}
