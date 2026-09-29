import type { Metadata } from 'next';
import { HelpDoc } from '../../../components/site/doc/HelpDoc';

export const metadata: Metadata = {
  title: 'Help',
  description:
    'Short answers about setting up WebAble, what it changes, how to undo or pause it, what it sends, and how to reach us.',
  alternates: { canonical: '/help' },
};

export default function HelpPage() {
  return <HelpDoc />;
}
