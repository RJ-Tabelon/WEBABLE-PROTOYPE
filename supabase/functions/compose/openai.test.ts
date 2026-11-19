// The Responses API client against the mock (no network): request shape,
// output reading, error classification, the fallback and the deadline.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';

import { wireOutline } from '../_shared/core.bundle.js';
import { OPENAI_RESPONSES_URL, type PlannerSettings } from './config.ts';
import { YOUTUBE } from './fixtures.ts';
import { createMockPlannerFetch, type MockPlannerOptions } from './mock.ts';
import {
  callPlanner,
  isModelUnavailable,
  MAX_RESPONSE_BYTES,
  readOutput,
} from './openai.ts';

const OUTLINE = wireOutline(YOUTUBE);
const MODELS = ['gpt-6-sol', 'gpt-5.6-terra'] as const;

function settings(
  opts: MockPlannerOptions = {},
  timeoutMs = 1_000,
): { settings: PlannerSettings; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    settings: {
      apiKey: 'sk-test',
      endpoint: OPENAI_RESPONSES_URL,
      timeoutMs,
      fetch: createMockPlannerFetch({
        ...opts,
        onRequest: (body) => sent.push(body),
      }),
    },
  };
}

/** A fetch that answers one fixed Response, recording the init it got. */
function fixed(res: () => Response, seen: RequestInit[] = []): typeof fetch {
  return (_input, init) => {
    seen.push(init ?? {});
    return Promise.resolve(res());
  };
}

const message = (...content: unknown[]) => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content,
});

// ---------------------------------------------------------------------------
// readOutput
// ---------------------------------------------------------------------------

Deno.test('readOutput joins output_text parts and skips other items', () => {
  assertEquals(
    readOutput({
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        message(
          { type: 'output_text', text: '{"a":', annotations: [] },
          { type: 'output_text', text: '1}', annotations: [] },
        ),
      ],
    }),
    { ok: true, text: '{"a":1}' },
  );
});

Deno.test('readOutput: a refusal part wins', () => {
  assertEquals(
    readOutput({
      status: 'completed',
      output: [
        message(
          { type: 'output_text', text: '{}' },
          { type: 'refusal', refusal: 'No.' },
        ),
      ],
    }),
    { ok: false, error: { kind: 'refused' } },
  );
});

Deno.test('readOutput: incomplete answers', () => {
  const out = [message({ type: 'output_text', text: '{"v":1,' })];
  assertEquals(
    readOutput({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: out,
    }),
    { ok: false, error: { kind: 'incomplete' } },
  );
  assertEquals(
    readOutput({
      status: 'incomplete',
      incomplete_details: { reason: 'content_filter' },
      output: out,
    }),
    { ok: false, error: { kind: 'refused' } },
  );
});

Deno.test('readOutput: anything else is shape', () => {
  for (const body of [
    null,
    'text',
    [],
    {},
    { status: 'completed', output: 'x' },
    { status: 'completed', output: [] },
    { status: 'completed', output: [{ type: 'reasoning' }] },
    { status: 'completed', output: [message({ type: 'output_text' })] },
    {
      status: 'failed',
      output: [message({ type: 'output_text', text: '{}' })],
    },
    {
      status: 'in_progress',
      output: [message({ type: 'output_text', text: '{}' })],
    },
  ]) {
    assertEquals(readOutput(body), { ok: false, error: { kind: 'shape' } });
  }
});

// ---------------------------------------------------------------------------
// isModelUnavailable
// ---------------------------------------------------------------------------

Deno.test('isModelUnavailable separates model problems from the rest', () => {
  const yes: Array<[number, Record<string, unknown>]> = [
    [404, { code: 'model_not_found', param: null }],
    [403, { code: 'model_not_found' }],
    [400, { code: 'unsupported_model' }],
    [400, { code: 'invalid_value', param: 'model' }],
    [400, { code: 'unsupported_value', param: 'reasoning.effort' }],
    [400, { code: 'unsupported_parameter', param: 'temperature' }],
    [400, { code: 'unsupported_value', param: 'service_tier' }],
  ];
  const no: Array<[number, Record<string, unknown> | null]> = [
    [401, { code: 'invalid_api_key' }],
    [429, { code: 'rate_limit_exceeded' }],
    [429, { code: 'insufficient_quota' }],
    [500, { code: 'model_not_found' }],
    [400, { code: 'unsupported_value', param: 'text.format' }],
    [400, { code: 'invalid_value', param: 'input' }],
    [404, null],
  ];
  for (const [status, error] of yes)
    assert(isModelUnavailable(status, error), JSON.stringify([status, error]));
  for (const [status, error] of no)
    assertFalse(
      isModelUnavailable(status, error),
      JSON.stringify([status, error]),
    );
});

// ---------------------------------------------------------------------------
// callPlanner
// ---------------------------------------------------------------------------

Deno.test('sends one non-streaming JSON POST per attempt', async () => {
  const seen: RequestInit[] = [];
  const urls: string[] = [];
  const inner = createMockPlannerFetch();
  const result = await callPlanner(OUTLINE, {
    settings: {
      apiKey: 'sk-test',
      endpoint: OPENAI_RESPONSES_URL,
      timeoutMs: 1_000,
      fetch: (input, init) => {
        urls.push(String(input));
        seen.push(init ?? {});
        return inner(input, init);
      },
    },
    models: MODELS,
  });
  assert(result.ok);
  assertEquals(result.model, 'gpt-6-sol');
  assertEquals(result.fallback, false);
  assertEquals(urls, [OPENAI_RESPONSES_URL]);
  const init = seen[0]!;
  assertEquals(init.method, 'POST');
  const headers = new Headers(init.headers);
  assertEquals(headers.get('authorization'), 'Bearer sk-test');
  assertEquals(headers.get('content-type'), 'application/json');
  const body = JSON.parse(String(init.body));
  assertFalse('stream' in body);
  assertEquals(body.input, OUTLINE);
});

Deno.test('falls back once on model_not_found, and reports it', async () => {
  const { settings: s, sent } = settings({ unavailableModels: ['gpt-6-sol'] });
  const result = await callPlanner(OUTLINE, { settings: s, models: MODELS });
  assert(result.ok);
  assertEquals(result.model, 'gpt-5.6-terra');
  assertEquals(result.fallback, true);
  assertEquals(
    sent.map((b) => b.model),
    ['gpt-6-sol', 'gpt-5.6-terra'],
  );
  // The fallback request is the same plan with the other model.
  const { model: _a, ...first } = sent[0]!;
  const { model: _b, ...second } = sent[1]!;
  assertEquals(first, second);
});

Deno.test(
  'falls back when the pinned model rejects a planner setting',
  async () => {
    let calls = 0;
    const inner = createMockPlannerFetch();
    const result = await callPlanner(OUTLINE, {
      settings: {
        apiKey: 'sk-test',
        endpoint: OPENAI_RESPONSES_URL,
        timeoutMs: 1_000,
        fetch: (input, init) => {
          calls += 1;
          if (calls === 1)
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  error: {
                    message:
                      "Unsupported value: 'none' is not supported with this model.",
                    type: 'invalid_request_error',
                    param: 'reasoning.effort',
                    code: 'unsupported_value',
                  },
                }),
                { status: 400 },
              ),
            );
          return inner(input, init);
        },
      },
      models: MODELS,
    });
    assert(result.ok);
    assertEquals(result.model, 'gpt-5.6-terra');
  },
);

Deno.test('never retries other failures', async (t) => {
  const cases: Array<[string, MockPlannerOptions, string]> = [
    [
      'rate limited',
      { status: 429, error: { code: 'rate_limit_exceeded' } },
      'http',
    ],
    ['server error', { status: 500, error: { code: 'server_error' } }, 'http'],
    ['refusal', { refusal: true }, 'refused'],
  ];
  for (const [name, opts, kind] of cases) {
    await t.step(name, async () => {
      const { settings: s, sent } = settings(opts);
      const result = await callPlanner(OUTLINE, {
        settings: s,
        models: MODELS,
      });
      assertFalse(result.ok);
      assertEquals(result.error.kind, kind);
      assertEquals(result.fallback, false);
      assertEquals(sent.length, 1);
    });
  }
});

Deno.test('http failures carry status and a sanitized code', async () => {
  const weird = fixed(
    () =>
      new Response(
        JSON.stringify({
          error: { code: 'Some Free Text: page words', message: 'x' },
        }),
        { status: 429 },
      ),
  );
  const result = await callPlanner(OUTLINE, {
    settings: {
      apiKey: 'k',
      endpoint: OPENAI_RESPONSES_URL,
      timeoutMs: 1_000,
      fetch: weird,
    },
    models: MODELS,
  });
  assertEquals(result, {
    ok: false,
    error: { kind: 'http', status: 429, code: 'other' },
    model: 'gpt-6-sol',
    fallback: false,
  });
  const plain = await callPlanner(OUTLINE, {
    settings: {
      apiKey: 'k',
      endpoint: OPENAI_RESPONSES_URL,
      timeoutMs: 1_000,
      fetch: fixed(
        () => new Response('<html>Bad gateway</html>', { status: 502 }),
      ),
    },
    models: MODELS,
  });
  assertFalse(plain.ok);
  assertEquals(plain.error, { kind: 'http', status: 502, code: null });
});

Deno.test('the deadline is reported as timeout', async () => {
  const { settings: s } = settings({ delayMs: 5_000 }, 20);
  const started = performance.now();
  const result = await callPlanner(OUTLINE, { settings: s, models: MODELS });
  assertFalse(result.ok);
  assertEquals(result.error, { kind: 'timeout' });
  assert(performance.now() - started < 1_000);
});

Deno.test('one deadline covers the fallback too', async () => {
  let calls = 0;
  const hang = createMockPlannerFetch({ delayMs: 5_000 });
  const result = await callPlanner(OUTLINE, {
    settings: {
      apiKey: 'k',
      endpoint: OPENAI_RESPONSES_URL,
      timeoutMs: 40,
      fetch: async (input, init) => {
        calls += 1;
        if (calls === 1) {
          await new Promise((r) => setTimeout(r, 25));
          return new Response(
            JSON.stringify({
              error: { code: 'model_not_found', message: 'x' },
            }),
            { status: 404 },
          );
        }
        return hang(input, init);
      },
    },
    models: MODELS,
  });
  assertEquals(result, {
    ok: false,
    error: { kind: 'timeout' },
    model: 'gpt-5.6-terra',
    fallback: true,
  });
});

Deno.test('caller cancellation is reported as aborted', async () => {
  const { settings: s } = settings({ delayMs: 5_000 });
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 10);
  const result = await callPlanner(OUTLINE, {
    settings: s,
    models: MODELS,
    signal: abort.signal,
  });
  assertFalse(result.ok);
  assertEquals(result.error, { kind: 'aborted' });
});

Deno.test('a failed connection is network', async () => {
  const { settings: s } = settings({ networkError: true });
  const result = await callPlanner(OUTLINE, { settings: s, models: MODELS });
  assertFalse(result.ok);
  assertEquals(result.error, { kind: 'network' });
});

Deno.test('an oversized or non-JSON success body is shape', async () => {
  for (const make of [
    () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), { status: 200 }),
    () => new Response('not json', { status: 200 }),
    () => new Response(null, { status: 200 }),
  ]) {
    const result = await callPlanner(OUTLINE, {
      settings: {
        apiKey: 'k',
        endpoint: OPENAI_RESPONSES_URL,
        timeoutMs: 1_000,
        fetch: fixed(make),
      },
      models: MODELS,
    });
    assertFalse(result.ok);
    assertEquals(result.error, { kind: 'shape' });
  }
});

Deno.test('a body that stalls mid-read hits the deadline', async () => {
  const stalled = fixed(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"status":'));
          },
        }),
        { status: 200 },
      ),
  );
  const result = await callPlanner(OUTLINE, {
    settings: {
      apiKey: 'k',
      endpoint: OPENAI_RESPONSES_URL,
      timeoutMs: 30,
      fetch: stalled,
    },
    models: MODELS,
  });
  assertFalse(result.ok);
  assertEquals(result.error, { kind: 'timeout' });
});
