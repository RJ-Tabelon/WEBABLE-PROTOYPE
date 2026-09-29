// Entry point: wires the decide handler to the environment and Supabase clients.
// config.toml: [functions.decide] verify_jwt = true (the handler verifies again).
//
// Environment:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  injected by Supabase
//   TYPESAFE_API_KEY   Jev key; absent -> degraded 'unconfigured' (see config.ts)
//   JEV_BASE_URL       optional, local testing only (scripts/jev-mock-server.mjs)
//   WEB_ORIGINS        web app origins allowed by CORS
//   EXTENSION_ORIGINS  chrome-extension://<id> origins allowed by CORS
//   JWT_ISSUER         optional; pins the token `iss`

import { verifierFromClient, verifyRequest } from '../_shared/auth.ts';
import { corsPolicyFromEnv } from '../_shared/cors.ts';
import {
  createAuthClient,
  createServiceClient,
  denoEnv,
  type SupabaseClient,
} from '../_shared/supabase.ts';
import { jevConfigFromEnv } from './config.ts';
import { createDecideHandler, parseQuotaDecision } from './handler.ts';

class DatabaseError extends Error {
  constructor(operation: string, code: string | undefined) {
    super(`${operation} failed${code ? ` (${code})` : ''}.`);
    this.name = 'DatabaseError';
  }
}

let authClient: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;
const service = (): SupabaseClient =>
  (serviceClient ??= createServiceClient(denoEnv));

const handler = createDecideHandler({
  cors: corsPolicyFromEnv(denoEnv, ['web', 'extension'], {
    methods: ['GET', 'POST'],
  }),
  verify: (req) => {
    authClient ??= createAuthClient(denoEnv);
    return verifyRequest(req, {
      env: denoEnv,
      verifier: verifierFromClient(authClient),
    });
  },
  readConsent: async (userId) => {
    const { data, error } = await service()
      .from('accounts')
      .select('cloud_analysis')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new DatabaseError('consent read', error.code);
    // No account row means no consent.
    return (
      (data as { cloud_analysis?: unknown } | null)?.cloud_analysis === true
    );
  },
  consumeQuota: async (userId) => {
    const { data, error } = await service().rpc('consume_ai_quota', {
      p_user: userId,
    });
    if (error) throw new DatabaseError('consume_ai_quota', error.code);
    const decision = parseQuotaDecision(data);
    if (!decision) throw new DatabaseError('consume_ai_quota result', 'shape');
    return decision;
  },
  jev: jevConfigFromEnv(denoEnv),
  now: () => performance.now(),
});

Deno.serve(handler);
