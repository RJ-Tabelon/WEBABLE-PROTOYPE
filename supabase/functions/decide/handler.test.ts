// deno test --no-config --allow-env supabase/functions/decide
//
// The handler runs against the core Jev mock (a contract-faithful fetch), with
// auth, consent and quota injected. No network, no database.

import {
  assert,
  assertEquals,
  assertFalse,
  assertMatch,
} from 'jsr:@std/assert@1';

import type { AuthResult, VerifiedUser } from '../_shared/auth.ts';
import { corsPolicyFromEnv } from '../_shared/cors.ts';
import {
  createMockJevFetch,
  decideResponseSchema,
  JEV_ENDPOINT,
  PAGE_CATEGORIES,
  REGION_ROLES,
  type DecideRequest,
  type MockJevFetchOptions,
} from '../_shared/core.bundle.js';
import { MissingEnvError } from '../_shared/supabase.ts';
import { JEV_TIMEOUT_MS, type JevConfig } from './config.ts';
import { decideRequest, evidence, fixtureWords, REGIONS } from './fixtures.ts';
import {
  createDecideHandler,
  degradeFor,
  MAX_BODY_BYTES,
  parseQuotaDecision,
  type DecideDeps,
  type QuotaDecision,
} from './handler.ts';

const EXT = 'chrome-extension://bbnblnlbgcccbbbbihngngbecbobedie';
const WEB = 'http://localhost:3000';
const USER: VerifiedUser = {
  id: '6f1c3c1e-3b7a-4c55-9d0e-6a8b7f1d2e3a',
  email: 'person@example.com',
  isAnonymous: false,
  sessionId: 'b0e1d8a4-9a4f-4a55-8a34-0c5b0d1e2f3a',
};

type Behaviour<T> = T | Promise<T> | Error | 'hang';

interface HarnessOptions {
  jev?: MockJevFetchOptions | 'unconfigured';
  apiKey?: string;
  timeoutMs?: number;
  consent?: Behaviour<boolean>;
  quota?: Behaviour<QuotaDecision>;
  auth?: AuthResult;
  deadlines?: DecideDeps['deadlines'];
}

interface Calls {
  verify: number;
  consent: number;
  quota: number;
  jev: Array<{ url: string; body: unknown; headers: Headers }>;
  jevAborted: boolean;
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
    jev: [],
    jevAborted: false,
    logs: [],
  };
  const inner = createMockJevFetch(
    opts.jev === 'unconfigured' ? {} : (opts.jev ?? {}),
  );
  const fetchSpy: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.jev.push({
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: new Headers(init?.headers),
    });
    init?.signal?.addEventListener('abort', () => {
      calls.jevAborted = true;
    });
    return inner(input, init);
  };
  const jev: JevConfig =
    opts.jev === 'unconfigured'
      ? { status: 'unconfigured', reason: 'no_key' }
      : {
          status: 'ready',
          settings: {
            apiKey: opts.apiKey ?? 'test-key',
            endpoint: JEV_ENDPOINT,
            timeoutMs: opts.timeoutMs ?? JEV_TIMEOUT_MS,
            fetch: fetchSpy,
          },
        };
  const deps: DecideDeps = {
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
    jev,
    now: () => performance.now(),
    log: (event, fields = {}) => {
      calls.logs.push({ event, fields });
    },
    ...(opts.deadlines ? { deadlines: opts.deadlines } : {}),
  };
  return { handle: createDecideHandler(deps), calls };
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
  return new Request('http://functions.local/decide', {
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
  v: 1,
  ok: false,
  degraded,
  ...extra,
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

Deno.test('fixture words are all in the vocabulary', async () => {
  const { isVocabWord } = await import('../_shared/core.bundle.js');
  for (const word of fixtureWords(decideRequest()))
    assert(isVocabWord(word), word);
});

Deno.test('answers with probabilities for every region asked', async () => {
  const { handle, calls } = harness();
  const res = await handle(post(decideRequest()));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('access-control-allow-origin'), EXT);
  assertEquals(res.headers.get('cache-control'), 'no-store');

  const body = await res.json();
  const parsed = decideResponseSchema.safeParse(body);
  assert(parsed.success);
  assert(body.ok);
  assertEquals(body.catalog, 'wa-cat-1.0.0');
  assertEquals(body.model, 'jev-1.13.0');
  assertEquals(Object.keys(body.regions).sort(), ['r1', 'r2', 'r3']);
  for (const rid of ['r1', 'r2', 'r3']) {
    assertEquals(Object.keys(body.regions[rid].role), [...REGION_ROLES]);
    const task = body.regions[rid].task;
    assert(task >= 0 && task <= 1);
  }
  assertEquals(Object.keys(body.pageType), [...PAGE_CATEGORIES]);
  assertEquals(Object.keys(body.mainPick), ['c1', 'c2', 'c3', 'c4', 'none']);
  assertEquals(body.mainPick.c3, 0, 'candidates not sent get probability 0');
  assert(body.inputTokens > 0);
  assert(body.ms.jev >= 0 && body.ms.edge >= body.ms.jev);

  // The mock's evidence cues come through: the chat launcher reads as a chat widget.
  const chat = body.regions.r2.role;
  assertEquals(
    Object.entries(chat as Record<string, number>).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0],
    'chat_widget',
  );
  assertEquals(calls.consent, 1);
  assertEquals(calls.quota, 1);
  assertEquals(calls.jev.length, 1);
});

Deno.test(
  'response carries no confidence, legend or choice fields',
  async () => {
    const { handle } = harness();
    const body = await (await handle(post(decideRequest()))).json();
    const keys = allKeys(body);
    for (const forbidden of [
      'confidence',
      'legend',
      'choice',
      'probabilities',
      'answers',
      'usage',
    ]) {
      assertFalse(keys.has(forbidden), forbidden);
    }
  },
);

Deno.test(
  'sends Jev only the pinned model, page state and catalog questions',
  async () => {
    const { handle, calls } = harness();
    await handle(post(decideRequest()));
    const [sent] = calls.jev;
    assert(sent);
    assertEquals(sent.url, JEV_ENDPOINT);
    assertEquals(sent.headers.get('authorization'), 'Bearer test-key');

    const body = sent.body as Record<string, unknown>;
    assertEquals(Object.keys(body), ['model', 'state', 'questions']);
    assertEquals(body.model, 'jev-1.13.0');
    assertEquals(Object.keys(body.state as object), ['page']);
    assertEquals(Object.keys(body.questions as object), [
      'page_type',
      'role_r1',
      'task_r1',
      'role_r2',
      'task_r2',
      'role_r3',
      'task_r3',
      'main_pick',
    ]);
    // The person never reaches Jev: no user id, email, token or profile.
    const text = JSON.stringify(body);
    for (const secret of [USER.id, USER.email as string, 'a.b.c', 'profile']) {
      assertFalse(text.includes(secret), secret);
    }
  },
);

Deno.test('logs carry codes, counts and ids only', async () => {
  const { handle, calls } = harness();
  await handle(post(decideRequest()));
  assertEquals(
    calls.logs.map((l) => l.event),
    ['decide_ok'],
  );
  const fields = calls.logs[0]?.fields ?? {};
  assertEquals(Object.keys(fields).sort(), [
    'edgeMs',
    'jevMs',
    'jevRequestId',
    'regions',
    'tokens',
    'trimmed',
  ]);
  assertMatch(String(fields.jevRequestId), /^req_[0-9a-f]{32}$/);
  const text = JSON.stringify(calls.logs);
  for (const leak of [
    USER.id,
    USER.email as string,
    'sidebar',
    'popular',
    'chat',
  ]) {
    assertFalse(text.includes(leak), leak);
  }
});

Deno.test(
  'asks without page type or main pick when the client does not',
  async () => {
    const { handle, calls } = harness();
    const req = decideRequest({
      ask: { pageType: false },
      regions: REGIONS.slice(0, 1),
    });
    delete req.mainCandidates;
    const body = await (await handle(post(req))).json();
    assertEquals(
      Object.keys(calls.jev[0]?.body as { questions: object }).length,
      3,
    );
    assertEquals(
      Object.keys((calls.jev[0]?.body as { questions: object }).questions),
      ['role_r1', 'task_r1'],
    );
    assertEquals('pageType' in body, false);
    assertEquals('mainPick' in body, false);
    assertEquals(Object.keys(body.regions), ['r1']);
  },
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

Deno.test(
  'rejects words outside the vocabulary with 422 before anything else',
  async (t) => {
    const withRegion = (ev: Partial<DecideRequest['regions'][number]['ev']>) =>
      decideRequest({ regions: [{ rid: 'r1', ev: evidence(ev) }] });
    const cases: Array<[string, DecideRequest]> = [
      ['unknown class word', withRegion({ class_words: ['sidebar', 'zzqx'] })],
      [
        'a name in the heading',
        withRegion({ heading_words: 'welcome back caden' }),
      ],
      [
        'unknown control word',
        withRegion({ control_words: ['open', 'pay zzqx'] }),
      ],
      ['double space', withRegion({ heading_words: 'most  popular' })],
      ['trailing space', withRegion({ heading_words: 'most popular ' })],
      [
        'heading over six words',
        withRegion({ heading_words: 'the most popular story of the site' }),
      ],
      [
        'control over four words',
        withRegion({ control_words: ['sign in to your account'] }),
      ],
      [
        'unknown word in a main candidate',
        decideRequest({
          mainCandidates: [
            { cid: 'c1', ev: evidence({ class_words: ['zzqx'] }) },
            { cid: 'c2', ev: evidence() },
          ],
        }),
      ],
    ];
    for (const [name, req] of cases) {
      await t.step(name, async () => {
        const { handle, calls } = harness();
        const res = await handle(post(req));
        assertEquals(res.status, 422);
        assertEquals(await res.json(), DEGRADED('bad_input'));
        assertEquals([calls.consent, calls.quota, calls.jev.length], [0, 0, 0]);
        assertEquals(calls.logs[0]?.event, 'decide_bad_input');
        assertEquals(calls.logs[0]?.fields.stage, 'vocabulary');
        const text = JSON.stringify(calls.logs);
        for (const leak of ['zzqx', 'caden', 'welcome', 'account']) {
          assertFalse(text.includes(leak), `log leaked ${leak}`);
        }
      });
    }
  },
);

Deno.test('rejects schema violations with 422', async (t) => {
  const base = decideRequest() as unknown as Record<string, unknown>;
  const eleven = Array.from({ length: 11 }, (_, i) => ({
    rid: `r${i}`,
    ev: evidence(),
  }));
  const cases: Array<[string, unknown]> = [
    ['extra top-level key', { ...base, url: 'https://example.com/' }],
    [
      'page text smuggled into evidence',
      {
        ...base,
        regions: [{ rid: 'r1', ev: { ...evidence(), text: 'hello' } }],
      },
    ],
    [
      'uppercase class word',
      {
        ...base,
        regions: [{ rid: 'r1', ev: evidence({ class_words: ['Sidebar'] }) }],
      },
    ],
    ['missing lang', { ...base, lang: undefined }],
    ['non-English page', { ...base, lang: 'de' }],
    ['more than ten regions', { ...base, regions: eleven }],
    [
      'bad region id',
      { ...base, regions: [{ rid: 'region-1', ev: evidence() }] },
    ],
    [
      'one main candidate',
      { ...base, mainCandidates: [{ cid: 'c1', ev: evidence() }] },
    ],
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
      assertEquals(await res.json(), DEGRADED('bad_input'));
      assertEquals(calls.jev.length, 0);
      const text = JSON.stringify(calls.logs);
      assertFalse(text.includes('hello'));
      assertFalse(text.includes('example.com'));
    });
  }
});

Deno.test('answers 409 for another catalog version', async () => {
  const { handle, calls } = harness();
  const res = await handle(
    post({ ...decideRequest(), catalog: 'wa-cat-2.0.0' }),
  );
  assertEquals(res.status, 409);
  assertEquals(await res.json(), DEGRADED('catalog_mismatch'));
  assertEquals([calls.consent, calls.quota, calls.jev.length], [0, 0, 0]);
});

Deno.test('answers 422 when there is nothing to ask', async () => {
  const { handle, calls } = harness();
  const req = decideRequest({ regions: [], ask: { pageType: false } });
  delete req.mainCandidates;
  const res = await handle(post(req));
  assertEquals(res.status, 422);
  assertEquals(calls.quota, 0);
});

Deno.test('enforces the body limit, content type and JSON', async () => {
  const { handle } = harness();
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
    new Request('http://functions.local/decide', {
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

  const broken = await handle(post(null, { raw: '{"v":1,' }));
  assertEquals(broken.status, 400);
  assertEquals((await broken.json()).error.code, 'bad_request');
});

// ---------------------------------------------------------------------------
// Consent and quota
// ---------------------------------------------------------------------------

Deno.test('refuses when cloud analysis is off for the account', async () => {
  const { handle, calls } = harness({ consent: false });
  const res = await handle(post(decideRequest()));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, 'consent_required');
  assertEquals([calls.quota, calls.jev.length], [0, 0]);
});

Deno.test('fails closed when consent cannot be read', async (t) => {
  await t.step('read error', async () => {
    const { handle, calls } = harness({ consent: new Error('boom') });
    const res = await handle(post(decideRequest()));
    assertEquals(res.status, 503);
    assertEquals(res.headers.get('retry-after'), '5');
    assertEquals(calls.jev.length, 0);
  });
  await t.step('read too slow', async () => {
    const { handle, calls } = harness({
      consent: 'hang',
      deadlines: { consentMs: 20 },
    });
    const res = await handle(post(decideRequest()));
    assertEquals(res.status, 503);
    assertEquals(calls.jev.length, 0);
  });
});

Deno.test('a quota denial aborts the Jev call and answers 429', async () => {
  const { handle, calls } = harness({
    jev: { delayMs: 1_000 },
    quota: { userOk: false, globalOk: true },
  });
  const t0 = performance.now();
  const res = await handle(post(decideRequest()));
  const elapsed = performance.now() - t0;
  assertEquals(res.status, 429);
  assertEquals(await res.json(), DEGRADED('quota', { retryAfterMs: 60_000 }));
  assertEquals(res.headers.get('retry-after'), '60');
  assert(calls.jevAborted, 'Jev request was aborted');
  assert(elapsed < 500, `answered in ${elapsed} ms, without waiting for Jev`);
  assertEquals(calls.logs.at(-1)?.fields.scope, 'user');
});

Deno.test('the product-wide cap is a quota denial too', async () => {
  const { handle, calls } = harness({
    quota: { userOk: true, globalOk: false },
  });
  const res = await handle(post(decideRequest()));
  assertEquals(res.status, 429);
  assertEquals(calls.logs.at(-1)?.fields.scope, 'global');
});

Deno.test('a quota failure fails closed and aborts Jev', async (t) => {
  await t.step('rpc error', async () => {
    const { handle, calls } = harness({
      jev: { delayMs: 1_000 },
      quota: new Error('rpc'),
    });
    const res = await handle(post(decideRequest()));
    assertEquals(res.status, 503);
    assert(calls.jevAborted);
  });
  await t.step('rpc too slow', async () => {
    const { handle, calls } = harness({
      jev: { delayMs: 1_000 },
      quota: 'hang',
      deadlines: { quotaMs: 30 },
    });
    const res = await handle(post(decideRequest()));
    assertEquals(res.status, 503);
    assert(calls.jevAborted);
  });
});

Deno.test('a late quota denial still wins over a Jev answer', async () => {
  let release: (q: QuotaDecision) => void = () => {};
  const late = new Promise<QuotaDecision>((resolve) => {
    release = resolve;
  });
  const { handle, calls } = harness({ quota: late });
  const pending = handle(post(decideRequest()));
  setTimeout(() => release({ userOk: false, globalOk: true }), 50);
  const res = await pending;
  assertEquals(res.status, 429);
  assertEquals(calls.jev.length, 1, 'Jev answered first');
});

// ---------------------------------------------------------------------------
// Degrade semantics
// ---------------------------------------------------------------------------

Deno.test(
  'unconfigured without a TypeSafe key, before touching the database',
  async () => {
    const { handle, calls } = harness({ jev: 'unconfigured' });
    const res = await handle(post(decideRequest()));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), DEGRADED('unconfigured'));
    assertEquals([calls.consent, calls.quota], [0, 0]);
    assertEquals(calls.logs[0]?.event, 'decide_unconfigured');
  },
);

Deno.test('a slow Jev answer degrades to timeout', async () => {
  const { handle, calls } = harness({ jev: { delayMs: 400 }, timeoutMs: 50 });
  const t0 = performance.now();
  const res = await handle(post(decideRequest()));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), DEGRADED('timeout'));
  assert(performance.now() - t0 < 350);
  assertEquals(calls.logs.at(-1)?.fields.kind, 'timeout');
});

Deno.test('model drift is reported and its answers are not used', async () => {
  const { handle, calls } = harness({ jev: { model: 'jev-1.14.0' } });
  const res = await handle(post(decideRequest()));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), DEGRADED('model_drift'));
  assertEquals(calls.logs.at(-1)?.fields.got, 'jev-1.14.0');
});

Deno.test('maps upstream failures to degraded answers', async (t) => {
  const cases: Array<[string, HarnessOptions, Record<string, unknown>]> = [
    [
      '429 with retry-after',
      { jev: { status: 429, headers: { 'retry-after': '2' } } },
      DEGRADED('rate_limited', { retryAfterMs: 2_000 }),
    ],
    [
      '429 without retry-after',
      { jev: { status: 429 } },
      DEGRADED('rate_limited'),
    ],
    ['529 overloaded', { jev: { status: 529 } }, DEGRADED('overloaded')],
    ['500', { jev: { status: 500 } }, DEGRADED('upstream')],
    ['revoked key', { apiKey: 'invalid' }, DEGRADED('upstream')],
    ['422 from Jev', { jev: { status: 422 } }, DEGRADED('upstream')],
    ['malformed JSON', { jev: { rawBody: '{"model":' } }, DEGRADED('upstream')],
    [
      'wrong shape',
      {
        jev: {
          body: {
            model: 'jev-1.13.0',
            answers: {},
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      },
      DEGRADED('upstream'),
    ],
    [
      'connection failure',
      { jev: { networkError: true } },
      DEGRADED('upstream'),
    ],
  ];
  for (const [name, opts, expected] of cases) {
    await t.step(name, async () => {
      const { handle, calls } = harness(opts);
      const res = await handle(post(decideRequest()));
      assertEquals(res.status, 200);
      assertEquals(await res.json(), expected);
      assertEquals(calls.logs.at(-1)?.event, 'decide_degraded');
      assertFalse(
        JSON.stringify(calls.logs).includes('detail'),
        'Jev bodies are never logged',
      );
    });
  }
});

Deno.test('degradeFor clamps pass-through retry hints', () => {
  assertEquals(
    degradeFor({ kind: 'rate_limited', retryAfterMs: 10 * 60 * 60_000 }),
    {
      reason: 'rate_limited',
      retryAfterMs: 600_000,
    },
  );
  assertEquals(degradeFor({ kind: 'auth', status: 403 }), {
    reason: 'upstream',
  });
  assertEquals(degradeFor({ kind: 'shape', issue: 'envelope' }), {
    reason: 'upstream',
  });
});

Deno.test('parseQuotaDecision accepts only the RPC shape', () => {
  assertEquals(parseQuotaDecision({ user_ok: true, global_ok: false }), {
    userOk: true,
    globalOk: false,
  });
  assertEquals(parseQuotaDecision({ user_ok: 'true', global_ok: true }), null);
  assertEquals(parseQuotaDecision(null), null);
  assertEquals(parseQuotaDecision([{ user_ok: true, global_ok: true }]), null);
});

// ---------------------------------------------------------------------------
// Transport: CORS, health, methods, auth, configuration
// ---------------------------------------------------------------------------

Deno.test(
  'answers preflight for the web app and the extension only',
  async () => {
    const { handle } = harness();
    for (const origin of [EXT, WEB]) {
      const res = await handle(
        new Request('http://f/decide', {
          method: 'OPTIONS',
          headers: { origin },
        }),
      );
      assertEquals(res.status, 204);
      assertEquals(res.headers.get('access-control-allow-origin'), origin);
      assertMatch(
        res.headers.get('access-control-allow-methods') ?? '',
        /POST/,
      );
      assertMatch(res.headers.get('access-control-allow-methods') ?? '', /GET/);
    }
    const other = await handle(
      new Request('http://f/decide', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example' },
      }),
    );
    assertEquals(other.status, 403);
  },
);

Deno.test('refuses unlisted origins before verifying anything', async () => {
  const { handle, calls } = harness();
  const res = await handle(
    post(decideRequest(), { origin: 'https://evil.example' }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, 'forbidden_origin');
  assertEquals(calls.verify, 0);
});

Deno.test('health warm-up answers 204 without work', async () => {
  const { handle, calls } = harness();
  for (const path of [
    '/decide/health',
    '/functions/v1/decide/health',
    '/health/',
  ]) {
    const res = await handle(
      new Request(`http://f${path}`, {
        method: 'GET',
        headers: { origin: EXT },
      }),
    );
    assertEquals(res.status, 204);
    assertEquals(res.headers.get('access-control-allow-origin'), EXT);
  }
  const post = await handle(
    new Request('http://f/decide/health', { method: 'POST' }),
  );
  assertEquals(post.status, 405);
  assertEquals(
    [calls.verify, calls.consent, calls.quota, calls.jev.length],
    [0, 0, 0, 0],
  );
});

Deno.test('only POST analyses', async () => {
  const { handle } = harness();
  const res = await handle(new Request('http://f/decide', { method: 'GET' }));
  assertEquals(res.status, 405);
  assertEquals(res.headers.get('allow'), 'POST, OPTIONS');
});

Deno.test('passes auth failures through', async (t) => {
  await t.step('invalid token', async () => {
    const { handle, calls } = harness({
      auth: {
        ok: false,
        status: 401,
        code: 'invalid_token',
        message: 'Token is invalid or expired.',
      },
    });
    const res = await handle(post(decideRequest()));
    assertEquals(res.status, 401);
    assertEquals(res.headers.get('www-authenticate'), 'Bearer');
    assertEquals((await res.json()).error.code, 'unauthorized');
    assertEquals(calls.jev.length, 0);
  });
  await t.step('auth unavailable', async () => {
    const { handle } = harness({
      auth: {
        ok: false,
        status: 503,
        code: 'auth_unavailable',
        message: 'later',
      },
    });
    const res = await handle(post(decideRequest()));
    assertEquals(res.status, 503);
    assertEquals(res.headers.get('retry-after'), '5');
  });
});

Deno.test(
  'missing Supabase configuration is a 500, not a silent degrade',
  async () => {
    const { handle } = harness({
      consent: new MissingEnvError('SUPABASE_SERVICE_ROLE_KEY'),
    });
    const res = await handle(post(decideRequest()));
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error.code, 'misconfigured');
  },
);
