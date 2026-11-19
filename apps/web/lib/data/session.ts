import { type BrowserSupabase, createClient } from '../supabase/client';
import { type DataResult, fail, ok } from './result';

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface SessionInfo {
  user: SessionUser;
  /** Access-token expiry, seconds since epoch. */
  expiresAt: number | null;
}

/** A signed-in person: the browser's client and the verified user. */
export interface DataContext {
  supabase: BrowserSupabase;
  user: SessionUser;
}

type Claims = { sub?: unknown; email?: unknown; exp?: unknown };

async function verifiedClaims(
  supabase: BrowserSupabase,
): Promise<Claims | null> {
  try {
    // getClaims verifies the JWT (JWKS for asymmetric keys, the Auth server otherwise).
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;
    return data.claims as Claims;
  } catch {
    return null;
  }
}

function userFrom(claims: Claims | null): SessionUser | null {
  if (!claims || typeof claims.sub !== 'string' || claims.sub.length === 0)
    return null;
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
  };
}

/** The signed-in person, verified, or null. */
export async function getUser(): Promise<SessionUser | null> {
  return userFrom(await verifiedClaims(createClient()));
}

/** The signed-in person and when their access token expires, or null. */
export async function getSession(): Promise<SessionInfo | null> {
  const claims = await verifiedClaims(createClient());
  const user = userFrom(claims);
  if (!user) return null;
  return {
    user,
    expiresAt: typeof claims?.exp === 'number' ? claims.exp : null,
  };
}

/** For data functions: a client plus verified user, or `not_signed_in`. */
export async function getDataContext(): Promise<DataResult<DataContext>> {
  let supabase: BrowserSupabase;
  try {
    supabase = createClient();
  } catch (error) {
    console.error(
      '[data] could not create a Supabase client',
      error instanceof Error ? error.message : error,
    );
    return fail('unavailable');
  }
  const user = userFrom(await verifiedClaims(supabase));
  return user ? ok({ supabase, user }) : fail('not_signed_in');
}
