import type { Metadata } from 'next';
import { TuneSaveView } from './TuneSaveView';

export const metadata: Metadata = { title: 'Save your fit' };

/** Preserve account saves for legacy Tune results already waiting in this browser.
 * New setup runs save their native fit directly in the extension. */
export default function TuneSavePage() {
  return <TuneSaveView />;
}
