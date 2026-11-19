import type { NextRequest } from 'next/server';

import { completeAuthRedirect } from '../../../lib/auth/complete';

/**
 * PKCE email links (the default Supabase templates) land here with ?code=...&next=...
 * Also accepts token_hash links, so either template works.
 */
export async function GET(request: NextRequest) {
  return completeAuthRedirect(request);
}
