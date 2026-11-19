// deno test --no-config --allow-env supabase/functions/ingest
//
// The handler with auth and the store injected. The store double applies the
// same consent and quota rules the SQL does, so the flows read end to end.

import {
  assert,
  assertEquals,
  assertFalse,
  assertMatch,
} from 'jsr:@std/assert@1';

import type { AuthResult, VerifiedUser } from '../_shared/auth.ts';
import { corsPolicyFromEnv } from '../_shared/cors.ts';
import type { AggReport } from '../_shared/core.bundle.js';
import { MissingEnvError } from '../_shared/supabase.ts';
import {
  createIngestHandler,
  GRACE_MS,
  MAX_BODY_BYTES,
  REPORTS_PER_WINDOW,
  type IngestDeps,
} from './handler.ts';
import type { IngestOutcome, IngestStore, IngestSubmission } from './store.ts';
import { MIN_SECRET_LENGTH } from './tag.ts';

const EXT = 'chrome-extension://bbnblnlbgcccbbbbihngngbecbobedie';
const USER: VerifiedUser = {
  id: '6f1c3c1e-3b7a-4c55-9d0e-6a8b7f1d2e3a',
  email: 'person@example.com',
  isAnonymous: false,
  sessionId: null,
};
const SECRET = 'k'.repeat(MIN_SECRET_LENGTH);
/** 2026-09-29, inside window 2026-W37/4 (2026-09-07 .. 2026-10-05). */
const NOW = Date.UTC(2026, 8, 29, 12);

function report(overrides: Partial<AggReport> = {}): AggReport {
  return {
    v: 1,
    window: '2026-W37/4',
    libVer: 'ops-1.0.0',
    priorRelease: 'p0-2026.09',
    cells: [
      {
        op: 'text_floor',
        need: 2,
        cat: 'article',
        mode: 'auto',
        trigger: 'profile',
        y: 1,
      },
      {
        op: 'calm_motion',
        need: 1,
        cat: 'feed_social',
        mode: 'offer',
        trigger: 'friction',
        y: 0,
      },
    ],
    engine: [{ op: 'line_length', cat: 'docs_reference', vcode: 'clip', c: 2 }],
    ai: [{ op: 'dim_distractions', label: 'likely', y: 1 }],
    ...overrides,
  };
}

/** In-memory store with the SQL's consent and quota semantics. */
function memoryStore(opts: { consent?: boolean; fail?: Error | 'hang' } = {}) {
  const quota = new Map<string, number>();
  const counts = new Map<string, { n: number; ones: number }>();
  const submissions: IngestSubmission[] = [];
  const store: IngestStore = {
    submit: (s) => {
      submissions.push(s);
      if (opts.fail === 'hang') return new Promise<IngestOutcome>(() => {});
      if (opts.fail) return Promise.reject(opts.fail);
      if (opts.consent === false) return Promise.resolve('no_consent');
      const used = quota.get(s.tag) ?? 0;
      if (used >= s.limit) return Promise.resolve('already_reported');
      quota.set(s.tag, used + 1);
      for (const c of s.cells) {
        const key = [
          s.windowId,
          s.libVer,
          c.op,
          c.need,
          c.cat,
          c.mode,
          c.trigger,
        ].join('|');
        const row = counts.get(key) ?? { n: 0, ones: 0 };
        counts.set(key, { n: row.n + 1, ones: row.ones + c.y });
      }
      return Promise.resolve('stored');
    },
  };
  return { store, quota, counts, submissions };
}

function harness(
  opts: {
    auth?: AuthResult;
    secret?: string;
    now?: number;
    store?: ReturnType<typeof memoryStore>;
    storeThrows?: Error;
    storeDeadlineMs?: number;
  } = {},
) {
  const mem = opts.store ?? memoryStore();
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  let verifies = 0;
  const deps: IngestDeps = {
    cors: corsPolicyFromEnv({ get: (n) => ({ EXTENSION_ORIGINS: EXT })[n] }, [
      'extension',
    ]),
    verify: () => {
      verifies += 1;
      return Promise.resolve(
        opts.auth ?? { ok: true, user: USER, token: 'a.b.c' },
      );
    },
    store: () => {
      if (opts.storeThrows) throw opts.storeThrows;
      return mem.store;
    },
    tagSecret: 'secret' in opts ? opts.secret : SECRET,
    now: () => opts.now ?? NOW,
    log: (event, fields = {}) => {
      logs.push({ event, fields });
    },
    ...(opts.storeDeadlineMs ? { storeDeadlineMs: opts.storeDeadlineMs } : {}),
  };
  return {
    handle: createIngestHandler(deps),
    mem,
    logs,
    verifies: () => verifies,
  };
}

function post(
  body: unknown,
  init: { origin?: string | null; raw?: string } = {},
): Request {
  const headers = new Headers({
    authorization: 'Bearer a.b.c',
    'content-type': 'application/json',
  });
  if (init.origin !== null) headers.set('origin', init.origin ?? EXT);
  return new Request('http://functions.local/ingest', {
    method: 'POST',
    headers,
    body: init.raw ?? JSON.stringify(body),
  });
}

async function errorCode(res: Response): Promise<string> {
  return (await res.json()).error.code;
}

Deno.test(
  'stores a report: 204, counts incremented, identity dropped',
  async () => {
    const { handle, mem, logs } = harness();
    const res = await handle(post(report()));
    assertEquals(res.status, 204);
    assertEquals(res.headers.get('access-control-allow-origin'), EXT);

    const [s] = mem.submissions;
    assert(s);
    assertMatch(s.tag, /^[0-9a-f]{64}$/);
    assertEquals(s.period, '2026-W37/4');
    assertEquals(s.windowId, '2026-W37/4');
    assertEquals(s.limit, REPORTS_PER_WINDOW);
    assertEquals(s.expiresAt.getTime(), Date.UTC(2026, 9, 5) + GRACE_MS);
    assertEquals(s.libVer, 'ops-1.0.0');
    assertEquals(s.retentionCutoff, '2025-W33/4');
    assertEquals(s.cells.length, 2);
    assertEquals(
      [...mem.counts.values()],
      [
        { n: 1, ones: 1 },
        { n: 1, ones: 0 },
      ],
    );
    assertEquals(logs, [{ event: 'ingest_stored', fields: { cells: 2 } }]);
  },
);

Deno.test(
  'the only identity-bearing field is the read-only consent lookup',
  async () => {
    const { handle, mem } = harness();
    await handle(post(report()));
    const [s] = mem.submissions;
    assert(s);
    const { userId, ...written } = s;
    assertEquals(userId, USER.id);
    const text = JSON.stringify(written);
    assertFalse(text.includes(USER.id));
    assertFalse(text.includes(USER.email as string));
    assertFalse(text.includes('priorRelease'));
  },
);

Deno.test('one report per account per window', async () => {
  const { handle, mem, logs } = harness();
  assertEquals((await handle(post(report()))).status, 204);
  const again = await handle(post(report()));
  assertEquals(again.status, 409);
  assertEquals(await errorCode(again), 'already_reported');
  assertEquals(
    [...mem.counts.values()][0],
    { n: 1, ones: 1 },
    'not counted twice',
  );
  assertEquals(logs.at(-1)?.event, 'ingest_duplicate');

  // The previous window, still within its grace period, is a separate slot.
  const later = harness({ now: Date.UTC(2026, 9, 6), store: mem });
  assertEquals(
    (await later.handle(post(report({ window: '2026-W41/4' })))).status,
    204,
  );
  assertEquals((await later.handle(post(report()))).status, 409);
});

Deno.test('refuses without product-learning consent', async () => {
  const { handle, mem } = harness({ store: memoryStore({ consent: false }) });
  const res = await handle(post(report()));
  assertEquals(res.status, 403);
  assertEquals(await errorCode(res), 'consent_required');
  assertEquals(mem.counts.size, 0);
});

Deno.test('rejects reports that do not match AggReport v1', async (t) => {
  const base = report() as unknown as Record<string, unknown>;
  const cell = report().cells[0]!;
  const cases: Array<[string, unknown]> = [
    ['extra key', { ...base, domain: 'example.com' }],
    [
      'user id smuggled into a cell',
      { ...base, cells: [{ ...cell, user: USER.id }] },
    ],
    ['unknown op', { ...base, cells: [{ ...cell, op: 'hide_everything' }] }],
    ['need out of range', { ...base, cells: [{ ...cell, need: 3 }] }],
    ['non-binary outcome', { ...base, cells: [{ ...cell, y: 0.7 }] }],
    [
      'more than four cells',
      {
        ...base,
        cells: (
          [
            'article',
            'feed_social',
            'search_results',
            'web_app',
            'other',
          ] as const
        ).map((cat) => ({ ...cell, cat })),
      },
    ],
    ['duplicate cells', { ...base, cells: [cell, cell] }],
    [
      'three ai rows',
      {
        ...base,
        ai: [1, 2, 3].map(() => ({ op: 'focus_view', label: 'clear', y: 0 })),
      },
    ],
    [
      'engine count not clipped',
      {
        ...base,
        engine: [{ op: 'line_length', cat: 'other', vcode: 'clip', c: 9 }],
      },
    ],
    ['free-text prior release', { ...base, priorRelease: 'Hello there' }],
    ['bad library version', { ...base, libVer: '1.0' }],
    ['window with a day', { ...base, window: '2026-09-29' }],
    ['version 2', { ...base, v: 2 }],
    ['empty body', undefined],
  ];
  for (const [name, body] of cases) {
    await t.step(name, async () => {
      const { handle, mem, logs } = harness();
      const res = await handle(
        body === undefined ? post(null, { raw: '' }) : post(body),
      );
      assertEquals(res.status, 422);
      assertEquals(await errorCode(res), 'invalid_report');
      assertEquals(mem.submissions.length, 0);
      const text = JSON.stringify(logs);
      assertFalse(text.includes('example.com'));
      assertFalse(text.includes(USER.id));
    });
  }
});

Deno.test(
  'only the current window, or a recent one, accepts reports',
  async (t) => {
    await t.step('unaligned window id', async () => {
      const { handle } = harness();
      const res = await handle(post(report({ window: '2026-W38/4' })));
      assertEquals(res.status, 422);
      assertEquals(await errorCode(res), 'invalid_report');
    });
    await t.step('future window', async () => {
      const { handle } = harness();
      const res = await handle(post(report({ window: '2026-W41/4' })));
      assertEquals(res.status, 422);
      assertEquals(await errorCode(res), 'window_future');
    });
    await t.step('closed window', async () => {
      const { handle } = harness();
      const res = await handle(post(report({ window: '2026-W29/4' })));
      assertEquals(res.status, 422);
      assertEquals(await errorCode(res), 'window_closed');
    });
  },
);

Deno.test('engine and ai rows are validated but not stored', async () => {
  const { handle, mem } = harness();
  assertEquals((await handle(post(report()))).status, 204);
  const s = mem.submissions[0] as unknown as Record<string, unknown>;
  assertFalse('engine' in s);
  assertFalse('ai' in s);
});

Deno.test(
  'a missing or short tag secret is a configuration error',
  async () => {
    for (const secret of [undefined, 'short']) {
      const { handle, mem } = harness({ secret });
      const res = await handle(post(report()));
      assertEquals(res.status, 500);
      assertEquals(await errorCode(res), 'misconfigured');
      assertEquals(mem.submissions.length, 0);
    }
  },
);

Deno.test('a missing database URL is a configuration error', async () => {
  const { handle } = harness({
    storeThrows: new MissingEnvError('SUPABASE_DB_URL'),
  });
  const res = await handle(post(report()));
  assertEquals(res.status, 500);
  assertEquals(await errorCode(res), 'misconfigured');
});

Deno.test('store failures and timeouts answer 503', async (t) => {
  await t.step('error', async () => {
    const { handle, logs } = harness({
      store: memoryStore({ fail: new Error('connection reset') }),
    });
    const res = await handle(post(report()));
    assertEquals(res.status, 503);
    assertEquals(res.headers.get('retry-after'), '60');
    assertFalse(
      JSON.stringify(logs).includes('connection reset'),
      'messages are not logged',
    );
  });
  await t.step('timeout', async () => {
    const { handle } = harness({
      store: memoryStore({ fail: 'hang' }),
      storeDeadlineMs: 20,
    });
    const res = await handle(post(report()));
    assertEquals(res.status, 503);
  });
});

Deno.test('transport: origins, methods, auth and size', async (t) => {
  await t.step('preflight for the extension only', async () => {
    const { handle } = harness();
    const ok = await handle(
      new Request('http://f/ingest', {
        method: 'OPTIONS',
        headers: { origin: EXT },
      }),
    );
    assertEquals(ok.status, 204);
    const web = await handle(
      new Request('http://f/ingest', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3000' },
      }),
    );
    assertEquals(web.status, 403);
  });
  await t.step('unlisted origin', async () => {
    const { handle, verifies } = harness();
    const res = await handle(
      post(report(), { origin: 'https://evil.example' }),
    );
    assertEquals(res.status, 403);
    assertEquals(verifies(), 0);
  });
  await t.step('method', async () => {
    const { handle } = harness();
    assertEquals((await handle(new Request('http://f/ingest'))).status, 405);
  });
  await t.step('invalid token', async () => {
    const { handle, mem } = harness({
      auth: { ok: false, status: 401, code: 'invalid_token', message: 'no' },
    });
    const res = await handle(post(report()));
    assertEquals(res.status, 401);
    assertEquals(res.headers.get('www-authenticate'), 'Bearer');
    assertEquals(mem.submissions.length, 0);
  });
  await t.step('body limit', async () => {
    const { handle } = harness();
    const res = await handle(
      post(null, { raw: 'x'.repeat(MAX_BODY_BYTES + 1) }),
    );
    assertEquals(res.status, 413);
  });
});
