import type { Metadata } from 'next';
import { SettingsView } from './SettingsView';

export const metadata: Metadata = { title: 'Settings' };

/**
 * /app/settings, as a document: the account (email, password, theme) as
 * hairline rows that open in place, the browsers connected to it, and signing
 * out last.
 */
export default function SettingsPage() {
  return <SettingsView />;
}
