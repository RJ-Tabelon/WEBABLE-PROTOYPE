import type { Metadata } from 'next';

import { GatorhackOnboarding } from '../../components/tune/GatorhackOnboarding';

export const metadata: Metadata = { title: 'Set up WebAble' };

/** One onboarding implementation: the extension's original Gatorhack fitting page. */
export default function TunePage() {
  return <GatorhackOnboarding />;
}
