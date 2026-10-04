import type { NextRequest } from 'next/server';

import { completeAuthRedirect } from '../../../lib/auth/complete';

/**
 * Token-hash email links land here:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/app
 * They verify on the server, so they work even when the link opens in another browser.
 */
export async function GET(request: NextRequest) {
  return completeAuthRedirect(request);
}
