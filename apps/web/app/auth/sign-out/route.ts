import { type NextRequest, NextResponse } from 'next/server';

import { SIGN_IN_PATH } from '../../../lib/auth/routes';
import { createClient } from '../../../lib/supabase/server';

/**
 * POST /auth/sign-out  (a plain <form method="post" action="/auth/sign-out">)
 * Optional form field `scope=global` ends every session, including the extension's.
 * Route handlers get no built-in CSRF check, so a cross-site Origin is refused.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 });
  }

  let scope: 'local' | 'global' = 'local';
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('form')) {
    const form = await request.formData().catch(() => null);
    if (form?.get('scope') === 'global') scope = 'global';
  }

  try {
    const supabase = await createClient();
    // Clears this browser's session cookies even if the server call fails.
    await supabase.auth.signOut({ scope });
  } catch {
    // The redirect below still lands on sign-in; the proxy treats a broken session as signed out.
  }

  const response = NextResponse.redirect(
    new URL(`${SIGN_IN_PATH}?signed_out=1`, request.nextUrl.origin),
    {
      status: 303,
    },
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
