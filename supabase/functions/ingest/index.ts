// Entry point: wires the ingest handler to the environment.
// config.toml: [functions.ingest] verify_jwt = true (the handler verifies again).
//
// Environment:
//   SUPABASE_URL, SUPABASE_ANON_KEY  injected by Supabase (token verification)
//   SUPABASE_SERVICE_ROLE_KEY        injected by Supabase (calls ingest_agg_report)
//   INGEST_TAG_SECRET                >= 32 characters; derives the per-window salts
//   EXTENSION_ORIGINS                chrome-extension://<id> origins allowed by CORS
//   JWT_ISSUER                       optional; pins the token `iss`

import { verifierFromClient, verifyRequest } from '../_shared/auth.ts';
import { corsPolicyFromEnv } from '../_shared/cors.ts';
import {
  createAuthClient,
  createServiceClient,
  denoEnv,
  type SupabaseClient,
} from '../_shared/supabase.ts';
import { createIngestHandler } from './handler.ts';
import {
  createRpcIngestStore,
  type IngestStore,
  type RpcClient,
} from './store.ts';

let authClient: SupabaseClient | null = null;
let store: IngestStore | null = null;

const handler = createIngestHandler({
  cors: corsPolicyFromEnv(denoEnv, ['extension'], { methods: ['POST'] }),
  verify: (req) => {
    authClient ??= createAuthClient(denoEnv);
    return verifyRequest(req, {
      env: denoEnv,
      verifier: verifierFromClient(authClient),
    });
  },
  store: () => {
    store ??= createRpcIngestStore(
      createServiceClient(denoEnv) as unknown as RpcClient,
    );
    return store;
  },
  tagSecret: denoEnv.get('INGEST_TAG_SECRET'),
  now: () => Date.now(),
});

Deno.serve(handler);
