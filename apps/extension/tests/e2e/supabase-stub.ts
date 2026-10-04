import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import {
  decideRequestSchema,
  type DecideResponse,
} from '@webable/core/decide/wire';
import { REGION_ROLES, type RegionRole } from '@webable/core/page/types';
import { CATALOG_VERSION, JEV_PINNED_MODEL } from '@webable/core/versions';

/**
 * A local stand-in for the Supabase project the e2e build talks to
 * (E2E_SUPABASE_ORIGIN in lib/sw/config.ts). It serves the `decide` Edge
 * Function contract: validates the body with the shared strict schema,
 * answers every region as a likely ad that the main task does not need, and
 * records exactly what arrived. Everything else answers 404. The extension
 * reaches it without host access, so it answers CORS like the real gateway.
 */

export const STUB_PORT = 4175;

export interface DecideStub {
  /** Raw request bodies that reached `decide`, oldest first. */
  bodies: string[];
  /** Authorization headers seen (the JWT, never a refresh token). */
  authorizations: string[];
  close(): Promise<void>;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function roles(top: RegionRole): Record<RegionRole, number> {
  const rest =
    Math.round(((1 - 0.9) / (REGION_ROLES.length - 1)) * 1000) / 1000;
  return Object.fromEntries(
    REGION_ROLES.map((r) => [r, r === top ? 0.9 : rest]),
  ) as Record<RegionRole, number>;
}

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startDecideStub(port = STUB_PORT): Promise<DecideStub> {
  const bodies: string[] = [];
  const authorizations: string[] = [];
  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      if (req.method !== 'POST' || req.url !== '/functions/v1/decide') {
        send(res, 404, { error: { code: 'not_found' } });
        return;
      }
      const raw = await read(req);
      bodies.push(raw);
      authorizations.push(String(req.headers.authorization ?? ''));
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
      const parsed = decideRequestSchema.safeParse(json);
      if (!parsed.success) {
        send(res, 422, {
          v: 1,
          ok: false,
          degraded: 'bad_input',
        } satisfies DecideResponse);
        return;
      }
      const reply: DecideResponse = {
        v: 1,
        ok: true,
        catalog: CATALOG_VERSION,
        model: JEV_PINNED_MODEL,
        regions: Object.fromEntries(
          parsed.data.regions.map((r) => [
            r.rid,
            { role: roles('promo_ad'), task: 0.04 },
          ]),
        ),
        ...(parsed.data.mainCandidates
          ? {
              mainPick: {
                [parsed.data.mainCandidates[0]!.cid]: 0.9,
                none: 0.05,
              },
            }
          : {}),
        inputTokens: raw.length,
        ms: { jev: 90, edge: 12 },
      };
      send(res, 200, reply);
    })().catch(() => send(res, 500, { error: { code: 'internal' } }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return {
    bodies,
    authorizations,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A session in supabase-js's stored shape, valid for an hour (no network needed to read it). */
export function fakeSession(email = 'person@example.com') {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: '00000000-0000-4000-8000-000000000e2e',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}
