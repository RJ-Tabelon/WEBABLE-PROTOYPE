import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@webable/core';

import { refreshData } from '../data/refresh';
import { getPublicEnv } from '../env';

let watching = false;
let lastUserId: string | null | undefined;

/**
 * The Supabase client. The site is static (GitHub Pages), so every read and
 * write goes from the browser straight to Supabase with the person's session;
 * row level security decides what they can see and change. The session lives
 * in this site's cookies. One client per browser tab.
 *
 * Email links are finished explicitly by /auth/callback (lib/auth/complete),
 * so the client doesn't also try to read the URL on its own.
 */
export function createClient() {
  const { supabaseUrl, supabaseKey } = getPublicEnv();
  const client = createBrowserClient<Database>(supabaseUrl, supabaseKey, {
    auth: { detectSessionInUrl: false },
  });
  if (!watching && typeof window !== 'undefined') {
    watching = true;
    // Someone else signed in (or out): every open view reads again.
    client.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      if (lastUserId !== undefined && id !== lastUserId) refreshData();
      lastUserId = id;
    });
  }
  return client;
}

export type BrowserSupabase = ReturnType<typeof createClient>;
