import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { z } from 'zod';

import {
  type DataErrorCode,
  type DataResult,
  fail,
  guarded,
  ok,
} from './result';
import { getDataContext } from './session';

/**
 * Sign-in handoff for the extension. The extension-link Edge Function mints a
 * single-use token hash for the signed-in person (no email is sent). The page
 * passes it to the extension over externally_connectable as
 * { type: 'wa:connect', tokenHash, email }, and the extension exchanges it for
 * its own session with verifyOtp({ type: 'magiclink', token_hash }).
 * This app's session and refresh token are never shared.
 */

export interface ExtensionLink {
  tokenHash: string;
  email: string;
}

const responseSchema = z.strictObject({
  tokenHash: z.string().min(16).max(256),
  email: z.email(),
});

function statusOf(error: FunctionsHttpError): number {
  const context: unknown = error.context;
  return context instanceof Response ? context.status : 0;
}

function mapFunctionError(error: unknown): DataErrorCode {
  if (error instanceof FunctionsHttpError) {
    const status = statusOf(error);
    if (status === 401) return 'not_signed_in';
    if (status === 429) return 'rate_limited';
    if (status === 400 || status === 403) return 'invalid_input';
    return 'unavailable';
  }
  if (
    error instanceof FunctionsRelayError ||
    error instanceof FunctionsFetchError
  )
    return 'unavailable';
  return 'unknown';
}

export async function requestExtensionLink(): Promise<
  DataResult<ExtensionLink>
> {
  return guarded('requestExtensionLink', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    // The client sends this request's verified access token as the bearer.
    const { data, error } = await supabase.functions.invoke<unknown>(
      'extension-link',
      {
        method: 'POST',
        body: {},
      },
    );
    if (error) return fail(mapFunctionError(error));

    const parsed = responseSchema.safeParse(data);
    if (!parsed.success) return fail('unknown');
    // Defense in depth: the link must be for the person this request is signed in as.
    if (
      user.email &&
      parsed.data.email.toLowerCase() !== user.email.toLowerCase()
    )
      return fail('unknown');
    return ok(parsed.data);
  });
}
