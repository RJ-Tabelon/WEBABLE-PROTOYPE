import { createServerClient } from '@supabase/ssr';
import type { Database } from '@webable/core';
import { type NextRequest, NextResponse } from 'next/server';

import { isProtectedPath, signInPath } from '../auth/routes';
import { getPublicEnv } from '../env';

/**
 * Refresh the Supabase session on every matched request and keep signed-out
 * people out of protected paths. Called from apps/web/proxy.ts.
 *
 * Rules from @supabase/ssr: run nothing between createServerClient and
 * getClaims(), and return the response whose cookies the client set, so
 * refreshed tokens reach both the browser and the Server Components rendering
 * this request. Pages and actions still check auth themselves; the proxy is an
 * optimistic gate, not the authorization boundary.
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  let env: ReturnType<typeof getPublicEnv>;
  try {
    env = getPublicEnv();
  } catch (error) {
    console.error(
      '[proxy]',
      error instanceof Error ? error.message : 'invalid environment',
    );
    return isProtectedPath(request.nextUrl.pathname)
      ? redirectToSignIn(request, response)
      : response;
  }

  const supabase = createServerClient<Database>(
    env.supabaseUrl,
    env.supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet)
            request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet)
            response.cookies.set(name, value, options);
          // Cache-Control and friends, so a CDN never caches a response that sets auth cookies.
          for (const [key, value] of Object.entries(headers ?? {}))
            response.headers.set(key, value);
        },
      },
    },
  );

  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = typeof data?.claims?.sub === 'string';
  } catch {
    signedIn = false;
  }

  if (!signedIn && isProtectedPath(request.nextUrl.pathname)) {
    return redirectToSignIn(request, response);
  }
  return response;
}

/** Redirect to sign-in, carrying any refreshed or cleared auth cookies along. */
function redirectToSignIn(
  request: NextRequest,
  from: NextResponse,
): NextResponse {
  const { pathname, search } = request.nextUrl;
  const redirect = NextResponse.redirect(
    new URL(signInPath(`${pathname}${search}`), request.nextUrl.origin),
  );
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  redirect.headers.set('Cache-Control', 'private, no-store');
  return redirect;
}
