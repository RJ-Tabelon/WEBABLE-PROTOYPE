import type { Metadata } from 'next';

import { AuthComplete } from '../../_components/AuthComplete';

export const metadata: Metadata = { title: 'Signing you in' };

/**
 * Token-hash email links land here:
 *   {{ .SiteURL }}/auth/confirm/?token_hash={{ .TokenHash }}&type=email&next=/app
 * They verify with Supabase directly, so they work even when the link opens in
 * another browser.
 */
export default function AuthLinkPage() {
  return <AuthComplete />;
}
