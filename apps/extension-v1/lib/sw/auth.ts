import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { Database } from '@webable/core/db/types';

import type { KvArea } from '../storage/area';
import { KEYS } from '../storage/keys';

/**
 * The extension's Supabase Auth client (platform.md 3.3, D4-D5). The service
 * worker is the only component that holds a session:
 * - its own session, from a single-use token hash the web app passes over the
 *   bridge (verifyOtp, type 'magiclink'); the web app's refresh token is
 *   never shared;
 * - stored in chrome.storage.local (trusted contexts only);
 * - autoRefreshToken is off (a worker cannot keep a 30 s ticker alive):
 *   getSession() refreshes on demand within 90 s of expiry, and an alarm
 *   refreshes ahead of time;
 * - a session that ends without the person signing out means "sign in again".
 */

export type DbClient = SupabaseClient<Database>;

export type ConnectResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; code: 'auth_failed' | 'email_mismatch' };

export interface AuthService {
  readonly client: DbClient;
  /** A valid access token, refreshing if needed; null when signed out. */
  accessToken(): Promise<string | null>;
  session(): Promise<Session | null>;
  connect(tokenHash: string, email: string): Promise<ConnectResult>;
  /** Local sign-out: this extension's session only (the web app stays signed in). */
  signOut(): Promise<void>;
  /** Alarm tick: refresh ahead of expiry. */
  refresh(): Promise<'ok' | 'signed_out' | 'error'>;
  /** Refresh now (the server rejected the access token); false when the session is gone. */
  refreshNow(): Promise<boolean>;
  /** Called when the session ends without a sign-out (refresh token rejected). */
  onLost(cb: () => void): void;
}

/** supabase-js storage adapter over chrome.storage.local. */
export function chromeAuthStorage(area: KvArea) {
  return {
    async getItem(key: string): Promise<string | null> {
      const got = await area.getMany([key]);
      const v = got[key];
      return typeof v === 'string' ? v : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      await area.set({ [key]: value });
    },
    async removeItem(key: string): Promise<void> {
      await area.remove([key]);
    },
  };
}

/** Refresh when the token has less than this left (the alarm runs every 30 min). */
export const REFRESH_AHEAD_S = 45 * 60;

export function createAuthService(opts: {
  url: string;
  publishableKey: string;
  area: KvArea;
  fetch?: typeof fetch;
}): AuthService {
  const client = createClient<Database>(opts.url, opts.publishableKey, {
    auth: {
      storage: chromeAuthStorage(opts.area),
      storageKey: KEYS.auth,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      headers: { 'x-client-info': 'webable-extension' },
    },
  });

  let signingOut = false;
  const lostListeners: Array<() => void> = [];
  client.auth.onAuthStateChange((event: AuthChangeEvent) => {
    if (event !== 'SIGNED_OUT' || signingOut) return;
    for (const cb of lostListeners) {
      try {
        cb();
      } catch {
        // A listener failing must not break auth.
      }
    }
  });

  async function session(): Promise<Session | null> {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) return null;
      return data.session;
    } catch {
      return null;
    }
  }

  return {
    client,
    session,
    async accessToken() {
      return (await session())?.access_token ?? null;
    },
    async connect(tokenHash, email) {
      try {
        const { data, error } = await client.auth.verifyOtp({
          type: 'magiclink',
          token_hash: tokenHash,
        });
        const user = data.user ?? data.session?.user ?? null;
        if (error || !data.session || !user)
          return { ok: false, code: 'auth_failed' };
        const actual = (user.email ?? '').toLowerCase();
        if (actual !== email.toLowerCase()) {
          // The token was not for the person the web app says is signed in.
          signingOut = true;
          try {
            await client.auth.signOut({ scope: 'local' });
          } finally {
            signingOut = false;
          }
          return { ok: false, code: 'email_mismatch' };
        }
        return { ok: true, userId: user.id, email: actual };
      } catch {
        return { ok: false, code: 'auth_failed' };
      }
    },
    async signOut() {
      signingOut = true;
      try {
        await client.auth.signOut({ scope: 'local' });
      } catch {
        // Even if the server is unreachable, the local session is removed.
        await opts.area.remove([KEYS.auth]);
      } finally {
        signingOut = false;
      }
    },
    async refresh() {
      const current = await session();
      if (!current) return 'signed_out';
      const expiresAt = current.expires_at ?? 0;
      if (expiresAt - Date.now() / 1000 > REFRESH_AHEAD_S) return 'ok';
      try {
        const { data, error } = await client.auth.refreshSession();
        if (data.session) return 'ok';
        return error ? 'error' : 'signed_out';
      } catch {
        return 'error';
      }
    },
    async refreshNow() {
      if (!(await session())) return false;
      try {
        const { data } = await client.auth.refreshSession();
        return data.session !== null;
      } catch {
        return false;
      }
    },
    onLost(cb) {
      lostListeners.push(cb);
    },
  };
}
