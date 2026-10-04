import type { Metadata } from 'next';
import { GetPage } from '../../../components/site/GetPage';
import { chromeStoreUrl } from '../../../lib/extension/store';

export const metadata: Metadata = {
  title: 'Add to Chrome',
  description:
    'Add WebAble to Chrome. It works on the first page you open. Tune it later for your own fit.',
  alternates: { canonical: '/get' },
};

/** The public install path: reachable signed out, one activation from the store. */
export default function Get() {
  return <GetPage storeUrl={chromeStoreUrl()} />;
}
