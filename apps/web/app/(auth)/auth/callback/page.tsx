import type { Metadata } from 'next';

import { AuthComplete } from '../../_components/AuthComplete';

export const metadata: Metadata = { title: 'Signing you in' };

/**
 * PKCE email links (the default Supabase templates) land here with
 * ?code=...&next=... Token-hash links work here too, so either template works.
 */
export default function AuthLinkPage() {
  return <AuthComplete />;
}
