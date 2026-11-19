import { createServerClient } from '@supabase/ssr';
import type { Database } from '@webable/core';
import { cookies } from 'next/headers';

import { getPublicEnv } from '../env';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * bound to this request's cookies. Create one per request; never cache it in a
 * module-level variable.
 *
 * Authorize with `supabase.auth.getClaims()`, never with getSession(): cookies
 * are user-controlled until the JWT is verified.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseKey } = getPublicEnv();

  return createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the session
          // on every request, so a token refreshed here is written there instead.
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
