import type { Metadata } from 'next';
import { YourFitView } from './YourFitView';

export const metadata: Metadata = { title: 'Your fit' };

/** /app: the current fit as rows, per-row Adjust, and the version history. */
export default function YourFitPage() {
  return <YourFitView />;
}
