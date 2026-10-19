// Entry point: wires the compose handler to the environment and Supabase clients.
// config.toml: [functions.compose] verify_jwt = false (the handler verifies the
// session itself, so ES256 sessions work; see _shared/auth.ts).
//
// Environment:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  injected by Supabase
//   OPENAI_API_KEY     planner key; absent -> degraded 'unconfigured' (see config.ts)
//   COMPOSE_DISABLED   kill switch; '1' -> degraded 'disabled' (see config.ts)
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
import { composeDisabled, plannerConfigFromEnv } from './config.ts';
import { createComposeHandler, parseQuotaDecision } from './handler.ts';

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

const handler = createComposeHandler({
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
      .select('ai_layout')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new DatabaseError('consent read', error.code);
    // No account row means no consent.
    return (data as { ai_layout?: unknown } | null)?.ai_layout === true;
  },
  consumeQuota: async (userId) => {
    const { data, error } = await service().rpc('consume_compose_quota', {
      p_user: userId,
    });
    if (error) throw new DatabaseError('consume_compose_quota', error.code);
    const decision = parseQuotaDecision(data);
    if (!decision)
      throw new DatabaseError('consume_compose_quota result', 'shape');
    return decision;
  },
  planner: plannerConfigFromEnv(denoEnv),
  disabled: () => composeDisabled(denoEnv),
});

Deno.serve(handler);
