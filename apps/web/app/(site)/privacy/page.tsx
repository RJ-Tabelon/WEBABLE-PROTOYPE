import type { Metadata } from 'next';
import { PrivacyDoc } from '../../../components/site/doc/PrivacyDoc';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What WebAble keeps, where it keeps it, what it sends and when, and how to download or delete all of it.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return <PrivacyDoc />;
}
