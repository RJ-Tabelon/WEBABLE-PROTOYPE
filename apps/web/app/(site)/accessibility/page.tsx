import type { Metadata } from 'next';
import { AccessibilityDoc } from '../../../components/site/doc/AccessibilityDoc';

export const metadata: Metadata = {
  title: 'Accessibility',
  description:
    'The rules WebAble builds its own pages to, how we check them, and what we know is still missing.',
  alternates: { canonical: '/accessibility' },
};

export default function AccessibilityPage() {
  return <AccessibilityDoc />;
}
