import type { Metadata } from 'next';
import { SitesView } from './SitesView';

export const metadata: Metadata = { title: 'Sites' };

/**
 * /app/sites: sites that keep settings of their own, read from this browser's
 * extension over the bridge while the page is open. A list of sites is
 * browsing history, so it stays on this device and never reaches the server.
 */
export default function SitesPage() {
  return <SitesView />;
}
