import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@webable/core';

import { getPublicEnv } from '../env';

/**
 * Supabase client for Client Components. It shares the session cookies that the
 * proxy and server client maintain, and is a singleton in the browser.
 *
 * Prefer server-side data access (lib/data) for reads and writes; use this for
 * browser-only needs such as reacting to auth state changes.
 */
export function createClient() {
  const { supabaseUrl, supabaseKey } = getPublicEnv();
  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}

export type BrowserSupabase = ReturnType<typeof createClient>;
