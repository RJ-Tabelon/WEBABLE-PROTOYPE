import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Tune', template: '%s · WebAble' },
  description:
    'Three short parts: reading, pointing and finding. About two minutes. There are no wrong answers.',
  robots: { index: false, follow: false },
};

/** The original Gatorhack flow owns its styles inside the extension frame. */
export default function TuneLayout({ children }: { children: ReactNode }) {
  return children;
}
