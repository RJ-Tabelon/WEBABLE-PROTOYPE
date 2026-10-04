import '../../components/tune/tune.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Tune', template: '%s · WebAble' },
  description:
    '3 short tasks, about 6 minutes. WebAble learns how you read, point and focus, then fits pages to you.',
  robots: { index: false, follow: false },
};

/**
 * Tune (Task density, design-final §9 and §14). Each page renders its own
 * <TaskShell>: the 64 px bar with the progress ruler, the centred --w-task
 * column and the 96 px action bar with Pause and Skip this part, because the
 * ruler and the actions follow the flow's state. This layout only brings the
 * Tune styles and keeps Tune out of search results.
 */
export default function TuneLayout({ children }: { children: ReactNode }) {
  return children;
}
