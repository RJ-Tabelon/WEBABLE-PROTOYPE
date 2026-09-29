// The RPC-backed store: exact arguments, outcome mapping, and that nothing but
// the cell key and randomized bit is sent.

import { assertEquals, assertRejects } from 'jsr:@std/assert@1';

import { createRpcIngestStore, type IngestSubmission, type RpcClient } from './store.ts';

const USER = '6f1c3c1e-3b7a-4c55-9d0e-6a8b7f1d2e3a';
const TAG = 'ab'.repeat(32);

function submission(overrides: Partial<IngestSubmission> = {}): IngestSubmission {
  return {
    userId: USER,
    tag: TAG,
    period: '2026-W37/4',
    expiresAt: new Date('2026-10-12T00:00:00Z'),
    limit: 1,
    windowId: '2026-W37/4',
    libVer: 'ops-1.0.0',
    cells: [
      { op: 'text_floor', need: 2, cat: 'article', mode: 'auto', trigger: 'profile', y: 1 },
      { op: 'dim_distractions', need: 1, cat: 'feed_social', mode: 'offer', trigger: 'friction', y: 0 },
    ],
    retentionCutoff: '2025-W37/4',
    ...overrides,
  };
}

function scripted(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client: RpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

Deno.test('sends one RPC with exactly the report fields', async () => {
  const { client, calls } = scripted({ data: 'stored', error: null });
  const outcome = await createRpcIngestStore(client).submit(submission());
  assertEquals(outcome, 'stored');
  assertEquals(calls.length, 1);
  assertEquals(calls[0]!.fn, 'ingest_agg_report');
  assertEquals(Object.keys(calls[0]!.args).sort(), [
    'p_cells',
    'p_expires',
    'p_lib',
    'p_limit',
    'p_period',
    'p_retention_cutoff',
    'p_tag',
    'p_user',
    'p_window',
  ]);
  assertEquals(calls[0]!.args.p_expires, '2026-10-12T00:00:00.000Z');
  const cells = calls[0]!.args.p_cells as Array<Record<string, unknown>>;
  for (const cell of cells) {
    assertEquals(Object.keys(cell).sort(), ['cat', 'mode', 'need', 'op', 'trigger', 'y']);
  }
});

Deno.test('maps database outcomes', async () => {
  for (const data of ['no_consent', 'already_reported'] as const) {
    const { client } = scripted({ data, error: null });
    assertEquals(await createRpcIngestStore(client).submit(submission()), data);
  }
});

Deno.test('fails closed on errors and unexpected results', async () => {
  const failing = scripted({ data: null, error: { message: 'boom' } });
  await assertRejects(() => createRpcIngestStore(failing.client).submit(submission()));
  const odd = scripted({ data: 'maybe', error: null });
  await assertRejects(() => createRpcIngestStore(odd.client).submit(submission()));
});
