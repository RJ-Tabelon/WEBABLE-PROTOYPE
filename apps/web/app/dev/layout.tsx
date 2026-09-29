import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './dev.css';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Design-review pages. Never indexed. */
export default function DevLayout({ children }: { children: ReactNode }) {
  return children;
}
