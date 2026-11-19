import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import type { PageSpec, SpecSection } from '@webable/core/compose/spec';
import {
  composeResponseSchema,
  type ComposeDegradedReason,
  type ComposeResponse,
} from '@webable/core/compose/wire';
import {
  decideRequestSchema,
  type DecideResponse,
} from '@webable/core/decide/wire';
import { REGION_ROLES, type RegionRole } from '@webable/core/page/types';
import {
  CATALOG_VERSION,
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
  JEV_PINNED_MODEL,
} from '@webable/core/versions';

/**
 * A local stand-in for the Supabase project the e2e build talks to
 * (E2E_SUPABASE_ORIGIN in lib/sw/config.ts). It serves two Edge Function
 * contracts and records exactly what arrived:
 *
 * - `decide`: validates the body with the shared strict schema and answers
 *   every region as a likely ad that the main task does not need.
 * - `compose`: checks only the envelope (no vocabulary or record checks) and
 *   answers a valid PageSpec over the request's own node ids, so the planner
 *   path runs offline; `compose` (the mode) switches to a degraded answer.
 *
 * Everything else answers 404. The extension reaches it without host access,
 * so it answers CORS like the real gateway.
 */

export const STUB_PORT = 4175;

/**
 * How `compose` answers: 'spec' (default), a degraded reason (200, or 429
 * with retryAfterMs for 'quota'), or 'consent_required' (403).
 */
export type ComposeStubMode =
  'spec' | ComposeDegradedReason | 'consent_required';

export interface StubOptions {
  compose?: ComposeStubMode;
  /** Simulated planner time before `compose` answers. */
  composeDelayMs?: number;
}

export interface DecideStub {
  /** Raw request bodies that reached `decide`, oldest first. */
  bodies: string[];
  /** Authorization headers seen by `decide` (the JWT, never a refresh token). */
  authorizations: string[];
  /** Raw request bodies that reached `compose`, oldest first. */
  composeBodies: string[];
  /** Authorization headers seen by `compose`. */
  composeAuthorizations: string[];
  /** How `compose` answers next; may change between steps. */
  compose: ComposeStubMode;
  composeDelayMs: number;
  close(): Promise<void>;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

interface StubNode {
  id: string;
  p: string | null;
  t?: unknown;
  r?: unknown;
  k?: unknown;
  b?: unknown;
  ex?: unknown;
  s?: unknown;
}

const NODE_ID = /^e[0-9]{1,4}$/;

/** The envelope only: v, schema, and nodes with ids and parents. Null when unusable. */
function composeNodes(json: unknown): StubNode[] | null {
  if (typeof json !== 'object' || json === null) return null;
  const req = json as { v?: unknown; skeleton?: { nodes?: unknown } };
  const nodes = req.skeleton?.nodes;
  if (req.v !== 1 || !Array.isArray(nodes) || nodes.length === 0) return null;
  const ok = nodes.every(
    (n: unknown) =>
      typeof n === 'object' &&
      n !== null &&
      typeof (n as StubNode).id === 'string' &&
      NODE_ID.test((n as StubNode).id) &&
      ((n as StubNode).p === null || typeof (n as StubNode).p === 'string'),
  );
  return ok ? (nodes as StubNode[]) : null;
}

const area = (n: StubNode): number =>
  Array.isArray(n.b) ? Number(n.b[2]) * Number(n.b[3]) || 0 : 0;

/**
 * A valid spec over the request's own ids: one section per top-level region
 * (through single-child wrappers), the region holding a collection (else the
 * largest) as the one primary section, and one collection per list with its
 * exemplar slots.
 */
export function stubSpec(nodes: readonly StubNode[]): PageSpec {
  const kids = new Map<string, StubNode[]>();
  for (const n of nodes) {
    if (n.p === null) continue;
    const list = kids.get(n.p);
    if (list) list.push(n);
    else kids.set(n.p, [n]);
  }
  const under = (id: string): StubNode[] => {
    const out: StubNode[] = [];
    const stack = [...(kids.get(id) ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      stack.push(...(kids.get(n.id) ?? []));
    }
    return out;
  };
  const root = nodes[0]!;
  let regions = kids.get(root.id) ?? [];
  while (regions.length === 1 && (kids.get(regions[0]!.id) ?? []).length > 0)
    regions = kids.get(regions[0]!.id)!;
  if (regions.length === 0) regions = [root];
  regions = regions.slice(0, 24);

  const hasList = (n: StubNode): boolean =>
    n.k === 'collection' || under(n.id).some((d) => d.k === 'collection');
  const main =
    regions.find(hasList) ??
    regions.reduce((a, b) => (area(b) > area(a) ? b : a), regions[0]!);
  const sections: SpecSection[] = regions.map((n) =>
    n === main
      ? {
          kind: hasList(n) ? 'main_list' : 'article',
          importance: 'primary',
          node_ids: [n.id],
          heading_ref: null,
          layout: hasList(n) ? 'row_list' : 'reading',
        }
      : {
          kind: 'secondary',
          importance: 'secondary',
          node_ids: [n.id],
          heading_ref: null,
          layout: 'reading',
        },
  );
  const ids = new Set(nodes.map((n) => n.id));
  const collections = nodes
    .filter((n) => n.k === 'collection')
    .slice(0, 16)
    .map((list) => {
      const ex =
        typeof list.ex === 'string' && ids.has(list.ex) ? list.ex : null;
      const slots = ex
        ? [nodes.find((n) => n.id === ex)!, ...under(ex)].filter(
            (n) => n.s === true,
          )
        : [];
      return {
        list_id: list.id,
        item_kind: 'other' as const,
        open_slot: null,
        card: 'row' as const,
        media: 'none' as const,
        lead: 'none' as const,
        fields: slots.slice(0, 16).map((n) => ({
          slot_id: n.id,
          role: 'other' as const,
          show: 'always' as const,
        })),
      };
    });
  return {
    v: 1,
    page_type: 'other',
    primary_task: 'other',
    sections,
    collections,
  };
}

function composeReply(
  mode: ComposeStubMode,
  nodes: readonly StubNode[],
): { status: number; body: unknown } {
  if (mode === 'consent_required')
    return {
      status: 403,
      body: {
        error: {
          code: 'consent_required',
          message: 'Better Fit view layouts are off for this account.',
        },
      },
    };
  if (mode === 'quota')
    return {
      status: 429,
      body: {
        ok: false,
        degraded: 'quota',
        retryAfterMs: 60_000,
      } satisfies ComposeResponse,
    };
  if (mode !== 'spec')
    return {
      status: 200,
      body: { ok: false, degraded: mode } satisfies ComposeResponse,
    };
  const reply = composeResponseSchema.parse({
    ok: true,
    v: 1,
    schema: COMPOSE_SCHEMA_VERSION,
    model: COMPOSE_PINNED_MODEL,
    spec: stubSpec(nodes),
  });
  return { status: 200, body: reply };
}

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

export async function startDecideStub(
  port = STUB_PORT,
  opts: StubOptions = {},
): Promise<DecideStub> {
  const bodies: string[] = [];
  const authorizations: string[] = [];
  const stub = {
    composeBodies: [] as string[],
    composeAuthorizations: [] as string[],
    compose: opts.compose ?? ('spec' as ComposeStubMode),
    composeDelayMs: opts.composeDelayMs ?? 0,
  };
  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      if (req.method === 'GET' && req.url === '/functions/v1/compose/health') {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      if (req.method === 'POST' && req.url === '/functions/v1/compose') {
        const raw = await read(req);
        stub.composeBodies.push(raw);
        stub.composeAuthorizations.push(
          String(req.headers.authorization ?? ''),
        );
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          json = null;
        }
        if (stub.composeDelayMs > 0)
          await new Promise((r) => setTimeout(r, stub.composeDelayMs));
        const schema = (json as { schema?: unknown } | null)?.schema;
        if (typeof schema === 'string' && schema !== COMPOSE_SCHEMA_VERSION) {
          send(res, 409, { error: { code: 'schema_mismatch' } });
          return;
        }
        const nodes = composeNodes(json);
        if (!nodes) {
          send(res, 422, { error: { code: 'bad_input' } });
          return;
        }
        const reply = composeReply(stub.compose, nodes);
        send(res, reply.status, reply.body);
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
  return Object.assign(stub, {
    bodies,
    authorizations,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
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
