import '../../components/app/calm.css';
import '../../components/app/app.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CalmFrame } from '../../components/app/CalmFrame';

export const metadata: Metadata = {
  title: 'Connect WebAble',
  robots: { index: false, follow: false },
};

/** The extension handoff: one calm, wider column (--w-task). */
export default function ConnectLayout({ children }: { children: ReactNode }) {
  return <CalmFrame width="task">{children}</CalmFrame>;
}
