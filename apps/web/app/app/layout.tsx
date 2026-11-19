import '../../components/app/app.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppFrame } from '../../components/app/AppFrame';

export const metadata: Metadata = {
  title: { default: 'Your fit', template: '%s · WebAble' },
  robots: { index: false, follow: false },
};

/**
 * The signed-in app (Working density). AppFrame checks the session in the
 * browser and sends signed-out visitors to sign in; Supabase's row level
 * security is the real boundary for the data.
 *
 * Landmarks (from AppShell): banner (the 56 px bar below 64em), complementary
 * "App" rail with the "App" navigation and Help pinned at the bottom (64em and
 * wider), main (#main). Each page supplies one h1.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
