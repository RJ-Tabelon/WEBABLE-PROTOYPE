import type { Metadata } from 'next';
import { PrivacyView } from './PrivacyView';

export const metadata: Metadata = { title: 'Privacy' };

/**
 * /app/privacy: what WebAble may send (three consents, all off by default,
 * with exactly what each sends and to whom), what this browser actually sent
 * (receipts from the extension, with the exact bodies), and the person's
 * data: download or delete.
 */
export default function PrivacyPage() {
  return <PrivacyView />;
}
