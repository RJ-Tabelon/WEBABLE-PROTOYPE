import { createClient, type ServerSupabase } from '../supabase/server';
import { type DataResult, fail, ok } from './result';

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface SessionInfo {
  user: SessionUser;
  /** Access-token expiry, seconds since epoch. The token itself never leaves the server. */
  expiresAt: number | null;
}

/** An authenticated request: a per-request client and the verified user. */
export interface DataContext {
  supabase: ServerSupabase;
  user: SessionUser;
}

type Claims = { sub?: unknown; email?: unknown; exp?: unknown };

async function verifiedClaims(
  supabase: ServerSupabase,
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
  return userFrom(await verifiedClaims(await createClient()));
}

/** The signed-in person and when their access token expires, or null. */
export async function getSession(): Promise<SessionInfo | null> {
  const claims = await verifiedClaims(await createClient());
  const user = userFrom(claims);
  if (!user) return null;
  return {
    user,
    expiresAt: typeof claims?.exp === 'number' ? claims.exp : null,
  };
}

/** For data functions: a client plus verified user, or `not_signed_in`. */
export async function getDataContext(): Promise<DataResult<DataContext>> {
  let supabase: ServerSupabase;
  try {
    supabase = await createClient();
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
