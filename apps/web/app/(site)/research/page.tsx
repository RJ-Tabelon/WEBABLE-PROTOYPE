import type { Metadata } from 'next';
import { ResearchDoc } from '../../../components/site/doc/ResearchDoc';

export const metadata: Metadata = {
  title: 'Research',
  description:
    'The studies behind each change WebAble makes and behind Tune, with what the evidence does not show yet.',
  alternates: { canonical: '/research' },
};

export default function ResearchPage() {
  return <ResearchDoc />;
}
