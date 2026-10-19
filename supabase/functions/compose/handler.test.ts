// deno test --no-config --allow-env supabase/functions/compose
//
// The handler runs against the mock Responses API (a contract-faithful fetch
// that sees only what OpenAI would), with auth, consent and quota injected.
// No network, no database.

import {
  assert,
  assertEquals,
  assertFalse,
  assertMatch,
} from 'jsr:@std/assert@1';

import type { AuthResult, VerifiedUser } from '../_shared/auth.ts';
import { corsPolicyFromEnv } from '../_shared/cors.ts';
import {
  COMPOSE_SCHEMA_VERSION,
  composeResponseSchema,
  type ComposeRequest,
  type PageSpec,
} from '../_shared/core.bundle.js';
import { MissingEnvError } from '../_shared/supabase.ts';
import {
  OPENAI_RESPONSES_URL,
  PLANNER_TIMEOUT_MS,
  type PlannerConfig,
} from './config.ts';
import { composeRequest, largeRequest, NEWS, YOUTUBE } from './fixtures.ts';
import {
  createComposeHandler,
  degradeFor,
  GLOBAL_QUOTA_RETRY_AFTER_MS,
  MAX_BODY_BYTES,
  parseQuotaDecision,
  quotaRetryAfterMs,
  type ComposeDeps,
  type QuotaDecision,
} from './handler.ts';
import { createMockPlannerFetch, type MockPlannerOptions } from './mock.ts';

const EXT = 'chrome-extension://bbnblnlbgcccbbbbihngngbecbobedie';
const WEB = 'http://localhost:3000';
const KEY = 'sk-test-planner-key';
const USER: VerifiedUser = {
  id: '6f1c3c1e-3b7a-4c55-9d0e-6a8b7f1d2e3a',
  email: 'person@example.com',
  isAnonymous: false,
  sessionId: 'b0e1d8a4-9a4f-4a55-8a34-0c5b0d1e2f3a',
};
/** 2026-10-15 14:20:00 UTC: 40 minutes to the next hour. */
const NOW = Date.UTC(2026, 9, 15, 14, 20, 0);

type Behaviour<T> = T | Promise<T> | Error | 'hang';

interface HarnessOptions {
  planner?: MockPlannerOptions | 'unconfigured';
  timeoutMs?: number;
  consent?: Behaviour<boolean>;
  quota?: Behaviour<QuotaDecision>;
  auth?: AuthResult;
  disabled?: boolean;
  deadlines?: ComposeDeps['deadlines'];
}

interface Sent {
  body: Record<string, unknown>;
  headers: Headers;
}

interface Calls {
  verify: number;
  consent: number;
  quota: number;
  openai: Sent[];
  aborted: boolean;
  logs: Array<{ event: string; fields: Record<string, unknown> }>;
}

function behave<T>(b: Behaviour<T>): Promise<T> {
  if (b === 'hang') return new Promise<T>(() => {});
  if (b instanceof Promise) return b;
  if (b instanceof Error) return Promise.reject(b);
  return Promise.resolve(b);
}

function harness(opts: HarnessOptions = {}) {
  const calls: Calls = {
    verify: 0,
    consent: 0,
    quota: 0,
    openai: [],
    aborted: false,
    logs: [],
  };
  const mockOpts = opts.planner === 'unconfigured' ? {} : (opts.planner ?? {});
  const inner = createMockPlannerFetch({
    ...mockOpts,
    onRequest: (body, headers) => calls.openai.push({ body, headers }),
  });
  const fetchSpy: typeof fetch = (input, init) => {
    init?.signal?.addEventListener('abort', () => {
      calls.aborted = true;
    });
    return inner(input, init);
  };
  const planner: PlannerConfig =
    opts.planner === 'unconfigured'
      ? { status: 'unconfigured', reason: 'no_key' }
      : {
          status: 'ready',
          settings: {
            apiKey: KEY,
            endpoint: OPENAI_RESPONSES_URL,
            timeoutMs: opts.timeoutMs ?? PLANNER_TIMEOUT_MS,
            fetch: fetchSpy,
          },
        };
  const deps: ComposeDeps = {
    cors: corsPolicyFromEnv(
      { get: (n) => ({ WEB_ORIGINS: WEB, EXTENSION_ORIGINS: EXT })[n] },
      ['web', 'extension'],
      { methods: ['GET', 'POST'] },
    ),
    verify: () => {
      calls.verify += 1;
      return Promise.resolve(
        opts.auth ?? { ok: true, user: USER, token: 'a.b.c' },
      );
    },
    readConsent: () => {
      calls.consent += 1;
      return behave(opts.consent ?? true);
    },
    consumeQuota: () => {
      calls.quota += 1;
      return behave(opts.quota ?? { userOk: true, globalOk: true });
    },
    planner,
    disabled: () => opts.disabled ?? false,
    clock: () => NOW,
    log: (event, fields = {}) => {
      calls.logs.push({ event, fields });
    },
    ...(opts.deadlines ? { deadlines: opts.deadlines } : {}),
  };
  return { handle: createComposeHandler(deps), calls };
}

function post(
  body: unknown,
  init: {
    origin?: string | null;
    headers?: Record<string, string>;
    raw?: BodyInit;
  } = {},
): Request {
  const headers = new Headers({
    authorization: 'Bearer a.b.c',
    'content-type': 'application/json',
    ...init.headers,
  });
  if (init.origin !== null) headers.set('origin', init.origin ?? EXT);
  return new Request('http://functions.local/compose', {
    method: 'POST',
    headers,
    body: init.raw ?? JSON.stringify(body),
  });
}

/** Every key anywhere in a JSON value. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

const DEGRADED = (degraded: string, extra: Record<string, unknown> = {}) => ({
  ok: false,
  degraded,
  ...extra,
});

/** A spec for the YouTube fixture, optionally naming one id the request never had. */
function youtubeSpec(
  unknown?: 'section' | 'heading' | 'list' | 'open' | 'slot',
): PageSpec {
  const where = unknown ?? 'none';
  return {
    v: 1,
    page_type: 'listing_grid',
    primary_task: 'browse_and_choose',
    sections: [
      {
        kind: 'main_list',
        importance: 'primary',
        node_ids: [where === 'section' ? 'e999' : 'e23'],
        heading_ref: where === 'heading' ? 'e998' : 'e30',
        layout: 'card_grid',
      },
    ],
    collections: [
      {
        list_id: where === 'list' ? 'e997' : 'e51',
        item_kind: 'video',
        open_slot: where === 'open' ? 'e996' : 'e56',
        card: 'media',
        media: 'landscape',
        lead: 'none',
        fields: [
          {
            slot_id: where === 'slot' ? 'e995' : 'e53',
            role: 'thumbnail',
            show: 'always',
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

Deno.test('answers with a spec that uses only the request ids', async () => {
  const { handle, calls } = harness();
  const res = await handle(post(composeRequest()));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('access-control-allow-origin'), EXT);
  assertEquals(res.headers.get('cache-control'), 'no-store');

  const body = await res.json();
  assert(composeResponseSchema.safeParse(body).success);
  assertEquals(Object.keys(body).sort(), [
    'model',
    'ok',
    'schema',
    'spec',
    'v',
  ]);
  assertEquals(body.ok, true);
  assertEquals(body.v, 1);
  assertEquals(body.schema, COMPOSE_SCHEMA_VERSION);
  assertEquals(body.model, 'gpt-6-sol');
  assertEquals(body.spec.page_type, 'listing_grid');
  const known = new Set(YOUTUBE.nodes.map((n) => n.id));
  for (const s of body.spec.sections as PageSpec['sections'])
    for (const id of s.node_ids) assert(known.has(id), id);
  assertEquals(
    (body.spec.sections as PageSpec['sections']).filter(
      (s) => s.importance === 'primary',
    ).length,
    1,
  );
  assertEquals([calls.verify, calls.consent, calls.quota], [1, 1, 1]);
  assertEquals(calls.openai.length, 1);
});

Deno.test('plans an article page too', async () => {
  const { handle } = harness();
  const body = await (await handle(post(composeRequest(NEWS)))).json();
  assertEquals(body.ok, true);
  assertEquals(body.spec.page_type, 'article');
  assertEquals(body.spec.primary_task, 'read');
});

Deno.test(
  'never returns usage, cached tokens, tier, timing or the raw response',
  async () => {
    const { handle } = harness();
    const res = await handle(post(composeRequest()));
    const body = await res.json();
    const keys = allKeys(body);
    for (const forbidden of [
      'usage',
      'input_tokens',
      'cached_tokens',
      'output_tokens',
      'service_tier',
      'ms',
      'id',
      'output',
      'created_at',
      'instructions',
      'prompt_cache_key',
      'metadata',
    ]) {
      assertFalse(keys.has(forbidden), forbidden);
    }
    for (const header of ['openai-processing-ms', 'x-request-id'])
      assertEquals(res.headers.get(header), null, header);
  },
);

Deno.test('strips extra keys the model adds to the spec', async () => {
  const { handle } = harness({
    planner: {
      spec: (outline) => ({
        ...youtubeSpec(),
        heading: 'Injected title',
        sections: [{ ...youtubeSpec().sections[0], title: 'Free text' }],
        usage: { input_tokens: 1 },
        outline,
      }),
    },
  });
  const body = await (await handle(post(composeRequest()))).json();
  assertEquals(body.ok, true);
  const keys = allKeys(body);
  for (const extra of ['heading', 'title', 'usage', 'outline'])
    assertFalse(keys.has(extra), extra);
  const text = JSON.stringify(body);
  assertFalse(text.includes('Injected'));
  assertFalse(text.includes('Free text'));
});

Deno.test(
  'sends OpenAI the pinned settings, the outline and nothing about the person',
  async () => {
    const { handle, calls } = harness();
    await handle(post(composeRequest()));
    const [sent] = calls.openai;
    assert(sent);
    assertEquals(sent.headers.get('authorization'), `Bearer ${KEY}`);
    assertEquals(sent.headers.get('openai-organization'), null);

    const body = sent.body;
    assertEquals(body.model, 'gpt-6-sol');
    assertEquals(body.store, false);
    assertEquals(body.temperature, 0);
    assertEquals(body.service_tier, 'priority');
    assertEquals(body.reasoning, { effort: 'none' });
    assertEquals(body.max_output_tokens, 1800);
    assertEquals(body.prompt_cache_key, 'wa-compose-v2');
    assertEquals(
      (body.text as { format: Record<string, unknown> }).format.strict,
      true,
    );
    for (const key of ['user', 'metadata', 'safety_identifier', 'stream'])
      assertFalse(key in body, key);
    assertMatch(String(body.input), /^PAGE viewport=1280x800 doc=1280x6704/);
    assertMatch(String(body.input), /e51 div LIST n=51-100 item=custom/);

    // The person never reaches OpenAI: no user id, email, session or token.
    const text = JSON.stringify(body);
    for (const secret of [
      USER.id,
      USER.email as string,
      USER.sessionId as string,
      'a.b.c',
      KEY,
    ]) {
      assertFalse(text.includes(secret), secret);
    }
  },
);

Deno.test('logs carry event names, enums and counts only', async () => {
  const { handle, calls } = harness();
  await handle(post(composeRequest()));
  assertEquals(
    calls.logs.map((l) => l.event),
    ['compose_ok'],
  );
  assertEquals(Object.keys(calls.logs[0]?.fields ?? {}).sort(), [
    'collections',
    'fallback',
    'model',
    'sections',
  ]);
  const text = JSON.stringify(calls.logs);
  for (const leak of [USER.id, USER.email as string, 'search', 'guide', 'e23'])
    assertFalse(text.includes(leak), leak);
});

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

Deno.test(
  'a missing or invalid session is 401 before anything else',
  async (t) => {
    const cases: Array<[string, AuthResult]> = [
      [
        'missing',
        {
          ok: false,
          status: 401,
          code: 'missing_token',
          message: 'Send the access token as a Bearer token.',
        },
      ],
      [
        'invalid',
        {
          ok: false,
          status: 401,
          code: 'invalid_token',
          message: 'Token is invalid or expired.',
        },
      ],
    ];
    for (const [name, auth] of cases) {
      await t.step(name, async () => {
        const { handle, calls } = harness({ auth });
        const res = await handle(post(composeRequest()));
        assertEquals(res.status, 401);
        assertEquals(res.headers.get('www-authenticate'), 'Bearer');
        assertEquals((await res.json()).error.code, 'unauthorized');
        assertEquals(
          [calls.consent, calls.quota, calls.openai.length],
          [0, 0, 0],
        );
      });
    }
  },
);

Deno.test('auth unavailable is 503 with Retry-After', async () => {
  const { handle } = harness({
    auth: {
      ok: false,
      status: 503,
      code: 'auth_unavailable',
      message: 'Could not verify the session right now.',
    },
  });
  const res = await handle(post(composeRequest()));
  assertEquals(res.status, 503);
  assertEquals(res.headers.get('retry-after'), '5');
});

Deno.test(
  'consent off is 403 consent_required and nothing is sent',
  async () => {
    const { handle, calls } = harness({ consent: false });
    const res = await handle(post(composeRequest()));
    assertEquals(res.status, 403);
    assertEquals((await res.json()).error.code, 'consent_required');
    assertEquals([calls.quota, calls.openai.length], [0, 0]);
    assertEquals(
      calls.logs.map((l) => l.event),
      ['compose_no_consent'],
    );
  },
);

Deno.test('a consent read that fails or hangs is 503', async (t) => {
  for (const [name, consent] of [
    ['error', new Error('db down')],
    ['hang', 'hang'],
  ] as const) {
    await t.step(name, async () => {
      const { handle, calls } = harness({
        consent,
        deadlines: { consentMs: 20 },
      });
      const res = await handle(post(composeRequest()));
      assertEquals(res.status, 503);
      assertEquals((await res.json()).error.code, 'unavailable');
      assertEquals(calls.openai.length, 0);
    });
  }
});

Deno.test('missing Supabase configuration is 500 misconfigured', async () => {
  const { handle } = harness({
    consent: new MissingEnvError('SUPABASE_SERVICE_ROLE_KEY'),
  });
  const res = await handle(post(composeRequest()));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error.code, 'misconfigured');
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

Deno.test('enforces the body limit, content type and JSON', async () => {
  const { handle, calls } = harness();
  const big = 'x'.repeat(MAX_BODY_BYTES + 1);

  const declared = await handle(post(null, { raw: big }));
  assertEquals(declared.status, 413);
  assertEquals((await declared.json()).error.code, 'payload_too_large');

  const streamed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(big));
      controller.close();
    },
  });
  const res = await handle(
    new Request('http://functions.local/compose', {
      method: 'POST',
      headers: {
        authorization: 'Bearer a.b.c',
        'content-type': 'application/json',
        origin: EXT,
      },
      body: streamed,
    }),
  );
  assertEquals(res.status, 413);

  const text = await handle(
    post(null, { raw: '{}', headers: { 'content-type': 'text/plain' } }),
  );
  assertEquals(text.status, 415);

  const broken = await handle(post(null, { raw: '{"v":' }));
  assertEquals(broken.status, 400);
  assertEquals((await broken.json()).error.code, 'bad_request');
  assertEquals(calls.openai.length, 0);
});

Deno.test('a maximal 48 KB skeleton fits the body cap', async () => {
  const req = largeRequest(48 * 1024);
  const size = new TextEncoder().encode(JSON.stringify(req)).byteLength;
  assert(size >= 48 * 1024 && size <= MAX_BODY_BYTES, String(size));
  const { handle } = harness();
  const res = await handle(post(req));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
});

Deno.test(
  'rejects schema violations with 422 and logs no values',
  async (t) => {
    const base = composeRequest() as unknown as Record<string, unknown>;
    const sk = YOUTUBE;
    const withNode = (patch: Record<string, unknown>) => ({
      ...base,
      skeleton: {
        ...sk,
        nodes: sk.nodes.map((n, i) => (i === 5 ? { ...n, ...patch } : n)),
      },
    });
    const cases: Array<[string, unknown]> = [
      ['extra top-level key', { ...base, url: 'https://example.com/inbox' }],
      ['page text smuggled into a node', withNode({ text: 'Dear Caden' })],
      [
        'a title on the page',
        {
          ...base,
          skeleton: { ...sk, page: { ...sk.page, title: 'Inbox (3)' } },
        },
      ],
      ['uppercase label word', withNode({ l: ['Guide'] })],
      ['a label with digits', withNode({ l: ['room101'] })],
      [
        'seven label words',
        withNode({
          l: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((c) => `${c}${c}`),
        }),
      ],
      ['a bad id', withNode({ id: 'node-6' })],
      ['an unknown tag', withNode({ t: 'marquee' })],
      [
        'a box that is not rounded to integers',
        withNode({ b: [0.5, 0, 1, 1] }),
      ],
      ['an orphan node', withNode({ p: 'e999' })],
      ['no nodes', { ...base, skeleton: { ...sk, nodes: [] } }],
      ['wrong version', { ...base, v: 2 }],
      ['array body', [base]],
      ['empty body', undefined],
    ];
    for (const [name, body] of cases) {
      await t.step(name, async () => {
        const { handle, calls } = harness();
        const res = await handle(
          body === undefined ? post(null, { raw: '' }) : post(body),
        );
        assertEquals(res.status, 422);
        assertEquals((await res.json()).error.code, 'bad_input');
        assertEquals(
          [calls.consent, calls.quota, calls.openai.length],
          [0, 0, 0],
        );
        assertEquals(calls.logs[0]?.event, 'compose_bad_input');
        const text = JSON.stringify(calls.logs);
        for (const leak of [
          'Caden',
          'Inbox',
          'example.com',
          'marquee',
          'room101',
          'Guide',
          'node-6',
        ])
          assertFalse(text.includes(leak), `log leaked ${leak}`);
        assertFalse(
          /\.\d+[.@]?/.test(String(calls.logs[0]?.fields.issue ?? '')),
          'no indices',
        );
      });
    }
  },
);

Deno.test('another schema version is 409 schema_mismatch', async () => {
  const { handle, calls } = harness();
  // An extension from before the Showroom contract (v1 layouts, no cards).
  const res = await handle(
    post({ ...composeRequest(), schema: 'wa-compose-1.0.0' }),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, 'schema_mismatch');
  assertEquals([calls.consent, calls.quota, calls.openai.length], [0, 0, 0]);
});

Deno.test(
  'rejects words outside the vocabulary with 422, logging only a count',
  async (t) => {
    const withLabels = (labels: Record<string, string[]>): ComposeRequest => {
      const req = composeRequest();
      req.skeleton.nodes = req.skeleton.nodes.map((n) =>
        labels[n.id] ? { ...n, l: labels[n.id] } : n,
      );
      return req;
    };
    const cases: Array<[string, ComposeRequest, number]> = [
      ['a name in a button', withLabels({ e6: ['caden'] }), 1],
      [
        'two unknown words',
        withLabels({ e14: ['search', 'zzqx'], e41: ['qqzz'] }),
        2,
      ],
      [
        'subject line words (finance terms are not vocabulary)',
        withLabels({ e19: ['inbox', 'invoice', 'overdue', 'qbrz'] }),
        3,
      ],
    ];
    for (const [name, req, count] of cases) {
      await t.step(name, async () => {
        const { handle, calls } = harness();
        const res = await handle(post(req));
        assertEquals(res.status, 422);
        assertEquals((await res.json()).error.code, 'bad_input');
        assertEquals(
          [calls.consent, calls.quota, calls.openai.length],
          [0, 0, 0],
        );
        assertEquals(calls.logs[0]?.event, 'compose_bad_input');
        assertEquals(calls.logs[0]?.fields, { stage: 'vocabulary', count });
        const text = JSON.stringify(calls.logs);
        for (const leak of ['caden', 'zzqx', 'qqzz', 'qbrz', 'invoice'])
          assertFalse(text.includes(leak), `log leaked ${leak}`);
      });
    }
  },
);

Deno.test('rejects words on text or inside records with 422', async (t) => {
  const label = (id: string): ComposeRequest => {
    const req = composeRequest();
    req.skeleton.nodes = req.skeleton.nodes.map((n) =>
      n.id === id ? { ...n, l: ['open'] } : n,
    );
    return req;
  };
  // e36 is running text; e22 a nav slot; e56 a heading inside the video exemplar.
  for (const id of ['e36', 'e22', 'e56', 'e58']) {
    await t.step(id, async () => {
      const { handle, calls } = harness();
      const res = await handle(post(label(id)));
      assertEquals(res.status, 422);
      assertEquals(calls.logs[0]?.fields, { stage: 'record_words', count: 1 });
      assertEquals(calls.openai.length, 0);
    });
  }
});

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------

Deno.test('the kill switch degrades before the body is read', async () => {
  const { handle, calls } = harness({ disabled: true });
  const res = await handle(post(null, { raw: 'not even json' }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), DEGRADED('disabled'));
  assertEquals(
    [calls.verify, calls.consent, calls.quota, calls.openai.length],
    [1, 0, 0, 0],
  );
});

Deno.test('the kill switch still requires a session', async () => {
  const { handle } = harness({
    disabled: true,
    auth: { ok: false, status: 401, code: 'missing_token', message: 'x' },
  });
  assertEquals((await handle(post(composeRequest()))).status, 401);
});

Deno.test('without a key the answer is degraded unconfigured', async () => {
  const { handle, calls } = harness({ planner: 'unconfigured' });
  const res = await handle(post(composeRequest()));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), DEGRADED('unconfigured'));
  assertEquals([calls.consent, calls.quota], [0, 0]);
  assertEquals(
    calls.logs.map((l) => l.event),
    ['compose_unconfigured'],
  );
});

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

Deno.test('a personal quota denial aborts the model call', async () => {
  let release!: (q: QuotaDecision) => void;
  const quota = new Promise<QuotaDecision>((r) => (release = r));
  const { handle, calls } = harness({ quota, planner: { delayMs: 5_000 } });
  const pending = handle(post(composeRequest()));
  // The model call is in flight when the quota answers.
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(calls.openai.length, 1);
  release({ userOk: false, globalOk: true });
  const res = await pending;
  assert(calls.aborted, 'the OpenAI request was aborted');
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('retry-after'), '2400');
  assertEquals(
    await res.json(),
    DEGRADED('quota', { retryAfterMs: 2_400_000 }),
  );
  assertEquals(
    calls.logs.map((l) => l.event),
    ['compose_quota'],
  );
  assertEquals(calls.logs[0]?.fields, { scope: 'user' });
});

Deno.test('a product-wide denial asks again in a minute', async () => {
  const { handle } = harness({
    quota: { userOk: true, globalOk: false },
    planner: { delayMs: 5_000 },
  });
  const res = await handle(post(composeRequest()));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), DEGRADED('quota', { retryAfterMs: 60_000 }));
});

Deno.test(
  'a quota failure or hang is 503 and aborts the model call',
  async (t) => {
    for (const [name, quota] of [
      ['error', new Error('rpc failed')],
      ['hang', 'hang'],
    ] as const) {
      await t.step(name, async () => {
        const { handle, calls } = harness({
          quota,
          planner: { delayMs: 5_000 },
          deadlines: { quotaMs: 20 },
        });
        const res = await handle(post(composeRequest()));
        assertEquals(res.status, 503);
        assert(calls.aborted);
      });
    }
  },
);

Deno.test(
  'a denial after the model answered still refuses the spec',
  async () => {
    let release!: (q: QuotaDecision) => void;
    const quota = new Promise<QuotaDecision>((r) => (release = r));
    const { handle } = harness({ quota });
    const pending = handle(post(composeRequest()));
    await new Promise((r) => setTimeout(r, 20));
    release({ userOk: false, globalOk: false });
    const res = await pending;
    assertEquals(res.status, 429);
    assertEquals((await res.json()).ok, false);
  },
);

// ---------------------------------------------------------------------------
// Model outcomes
// ---------------------------------------------------------------------------

Deno.test('a slow model is degraded timeout, without a retry', async () => {
  const { handle, calls } = harness({
    planner: { delayMs: 5_000 },
    timeoutMs: 30,
  });
  const res = await handle(post(composeRequest()));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), DEGRADED('timeout'));
  assertEquals(calls.openai.length, 1);
  assert(calls.aborted);
  assertEquals(calls.logs.at(-1)?.fields, {
    reason: 'timeout',
    model: 'gpt-6-sol',
    kind: 'timeout',
  });
});

Deno.test('a refusal is degraded refused', async () => {
  const { handle } = harness({ planner: { refusal: true } });
  assertEquals(
    await (await handle(post(composeRequest()))).json(),
    DEGRADED('refused'),
  );
});

Deno.test('a content-filter stop is degraded refused', async () => {
  const { handle } = harness({ planner: { incomplete: 'content_filter' } });
  assertEquals(
    await (await handle(post(composeRequest()))).json(),
    DEGRADED('refused'),
  );
});

Deno.test('output cut off at the token cap is invalid_output', async () => {
  const { handle } = harness({
    planner: { incomplete: 'max_output_tokens', outputText: '{"v":1,"page_' },
  });
  assertEquals(
    await (await handle(post(composeRequest()))).json(),
    DEGRADED('invalid_output'),
  );
});

Deno.test('invalid output is rejected whole', async (t) => {
  const cases: Array<[string, MockPlannerOptions, string]> = [
    ['not JSON', { outputText: 'Here is your layout: {' }, 'json'],
    ['not a spec', { spec: () => ({ v: 1, sections: [] }) }, 'schema'],
    [
      'free text in an enum',
      { spec: () => ({ ...youtubeSpec(), page_type: 'Gmail inbox' }) },
      'schema',
    ],
    [
      'unknown section id',
      { spec: () => youtubeSpec('section') },
      'unknown_id',
    ],
    [
      'unknown heading_ref',
      { spec: () => youtubeSpec('heading') },
      'unknown_id',
    ],
    ['unknown list_id', { spec: () => youtubeSpec('list') }, 'unknown_id'],
    ['unknown open_slot', { spec: () => youtubeSpec('open') }, 'unknown_id'],
    ['unknown slot_id', { spec: () => youtubeSpec('slot') }, 'unknown_id'],
  ];
  for (const [name, planner, stage] of cases) {
    await t.step(name, async () => {
      const { handle, calls } = harness({ planner });
      const res = await handle(post(composeRequest()));
      assertEquals(res.status, 200);
      assertEquals(await res.json(), DEGRADED('invalid_output'));
      const last = calls.logs.at(-1);
      assertEquals(last?.event, 'compose_degraded');
      assertEquals(last?.fields.stage, stage);
      const text = JSON.stringify(calls.logs);
      for (const leak of [
        'Gmail',
        'layout:',
        'e999',
        'e998',
        'e997',
        'e996',
        'e995',
      ])
        assertFalse(text.includes(leak), `log leaked ${leak}`);
    });
  }
});

Deno.test(
  'falls back once to the fallback model when the pinned one is not found',
  async () => {
    const { handle, calls } = harness({
      planner: { unavailableModels: ['gpt-6-sol'] },
    });
    const res = await handle(post(composeRequest()));
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.model, 'gpt-5.6-terra');
    assertEquals(
      calls.openai.map((c) => c.body.model),
      ['gpt-6-sol', 'gpt-5.6-terra'],
    );
    assertEquals(
      calls.logs.map((l) => l.event),
      ['compose_fallback', 'compose_ok'],
    );
    assertEquals(calls.logs.at(-1)?.fields.fallback, true);
  },
);

Deno.test(
  'when neither model is available the answer is model_error',
  async () => {
    const { handle, calls } = harness({
      planner: { unavailableModels: ['gpt-6-sol', 'gpt-5.6-terra'] },
    });
    const res = await handle(post(composeRequest()));
    assertEquals(await res.json(), DEGRADED('model_error'));
    assertEquals(calls.openai.length, 2);
  },
);

Deno.test(
  'other upstream errors are model_error with no retry or fallback',
  async (t) => {
    const cases: Array<[string, MockPlannerOptions]> = [
      [
        'bad key',
        {
          status: 401,
          error: { code: 'invalid_api_key', type: 'invalid_request_error' },
        },
      ],
      [
        'rate limited',
        {
          status: 429,
          error: { code: 'rate_limit_exceeded', type: 'requests' },
        },
      ],
      [
        'out of credit',
        {
          status: 429,
          error: { code: 'insufficient_quota', type: 'insufficient_quota' },
        },
      ],
      [
        'server error',
        { status: 500, error: { code: 'server_error', type: 'server_error' } },
      ],
      [
        'overloaded',
        { status: 503, error: { code: null, type: 'server_error' } },
      ],
      ['connection failed', { networkError: true }],
    ];
    for (const [name, planner] of cases) {
      await t.step(name, async () => {
        const { handle, calls } = harness({ planner });
        const res = await handle(post(composeRequest()));
        assertEquals(res.status, 200);
        assertEquals(await res.json(), DEGRADED('model_error'));
        assertEquals(calls.openai.length, planner.networkError ? 0 : 1);
      });
    }
  },
);

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

Deno.test('CORS: preflight for listed origins only', async () => {
  const { handle } = harness();
  const ok = await handle(
    new Request('http://functions.local/compose', {
      method: 'OPTIONS',
      headers: { origin: WEB, 'access-control-request-method': 'POST' },
    }),
  );
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get('access-control-allow-origin'), WEB);
  assertMatch(ok.headers.get('access-control-allow-methods') ?? '', /POST/);
  assertMatch(
    ok.headers.get('access-control-allow-headers') ?? '',
    /authorization/,
  );

  const bad = await handle(
    new Request('http://functions.local/compose', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    }),
  );
  assertEquals(bad.status, 403);
  assertEquals(bad.headers.get('access-control-allow-origin'), null);
});

Deno.test('CORS: an unlisted origin is refused before auth', async () => {
  const { handle, calls } = harness();
  const res = await handle(
    post(composeRequest(), { origin: 'https://evil.example' }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, 'forbidden_origin');
  assertEquals(res.headers.get('access-control-allow-origin'), null);
  assertEquals(calls.verify, 0);
});

Deno.test(
  'a request without Origin (a server) is authorized by its token',
  async () => {
    const { handle } = harness();
    const res = await handle(post(composeRequest(), { origin: null }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('access-control-allow-origin'), null);
  },
);

Deno.test(
  'health answers 204 without auth; other methods are 405',
  async () => {
    const { handle, calls } = harness();
    const health = await handle(
      new Request('http://functions.local/compose/health', {
        headers: { origin: EXT },
      }),
    );
    assertEquals(health.status, 204);
    assertEquals(calls.verify, 0);
    const put = await handle(
      new Request('http://functions.local/compose', { method: 'PUT' }),
    );
    assertEquals(put.status, 405);
    assertEquals(put.headers.get('allow'), 'POST, OPTIONS');
    const get = await handle(new Request('http://functions.local/compose'));
    assertEquals(get.status, 405);
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

Deno.test('parseQuotaDecision reads the RPC shape and nothing else', () => {
  assertEquals(parseQuotaDecision({ user_ok: true, global_ok: false }), {
    userOk: true,
    globalOk: false,
  });
  for (const bad of [null, [], 'ok', { user_ok: 'true', global_ok: true }, {}])
    assertEquals(parseQuotaDecision(bad), null);
});

Deno.test('quota retry hints', () => {
  assertEquals(quotaRetryAfterMs('global', NOW), GLOBAL_QUOTA_RETRY_AFTER_MS);
  assertEquals(quotaRetryAfterMs('user', NOW), 40 * 60_000);
  assertEquals(
    quotaRetryAfterMs('user', Date.UTC(2026, 9, 15, 14, 59, 59, 900)),
    1_000,
  );
  assertEquals(
    quotaRetryAfterMs('user', Date.UTC(2026, 9, 15, 15, 0, 0)),
    3_600_000,
  );
});

Deno.test('degradeFor maps every failure kind', () => {
  assertEquals(degradeFor({ kind: 'timeout' }), 'timeout');
  assertEquals(degradeFor({ kind: 'refused' }), 'refused');
  assertEquals(degradeFor({ kind: 'incomplete' }), 'invalid_output');
  for (const kind of ['aborted', 'network', 'shape'] as const)
    assertEquals(degradeFor({ kind }), 'model_error');
  assertEquals(
    degradeFor({ kind: 'model_unavailable', status: 404 }),
    'model_error',
  );
  assertEquals(
    degradeFor({ kind: 'http', status: 429, code: null }),
    'model_error',
  );
});
