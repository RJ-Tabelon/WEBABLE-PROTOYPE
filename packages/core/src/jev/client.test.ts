import { describe, expect, it, vi } from 'vitest';

import { buildQuestions } from '../decide/catalog';
import {
  createMockJevFetch,
  mockJevAnswer,
  type MockJevFetchOptions,
} from '../decide/mock';
import { workedExampleEvidence, workedExamplePage } from '../policy/fixtures';
import { CATALOG_VERSION, JEV_PINNED_MODEL } from '../versions';
import {
  JEV_ENDPOINT,
  type JevModelId,
  type JevQuestion,
  type JevState,
} from './api';
import { callJev, checkJevShape, parseRetryAfter } from './client';

const built = buildQuestions({
  v: 1,
  catalog: CATALOG_VERSION,
  lang: 'en',
  page: workedExamplePage(),
  regions: [{ rid: 'r4', ev: workedExampleEvidence() }],
  ask: { pageType: true },
});
const req: {
  state: JevState;
  model: JevModelId;
  questions: Record<string, JevQuestion>;
} = {
  model: JEV_PINNED_MODEL,
  state: built.state,
  questions: built.questions,
};
const good = mockJevAnswer(req);

function call(
  mock: MockJevFetchOptions = {},
  opts: Partial<Parameters<typeof callJev>[1]> = {},
) {
  const fetchSpy = vi.fn(createMockJevFetch(mock));
  const result = callJev(req, {
    apiKey: 'test-key',
    timeoutMs: 2000,
    pinnedModel: JEV_PINNED_MODEL,
    fetch: fetchSpy as unknown as typeof fetch,
    ...opts,
  });
  return { result, fetchSpy };
}

describe('callJev success', () => {
  it('returns shape-checked data, the request id and elapsed time', async () => {
    const { result, fetchSpy } = call();
    const res = await result;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual(good);
    expect(res.requestId).toMatch(/^req_/);
    expect(res.ms).toBeGreaterThanOrEqual(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends only model, state and questions with a bearer key to the endpoint', async () => {
    let seen: unknown = null;
    let init: RequestInit | undefined;
    const { result, fetchSpy } = call({
      onRequest: (body, i) => ((seen = body), (init = i)),
    });
    await result;
    expect(fetchSpy.mock.calls[0]![0]).toBe(JEV_ENDPOINT);
    expect(Object.keys(seen as object)).toEqual([
      'model',
      'state',
      'questions',
    ]);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init?.method).toBe('POST');
  });

  it('uses an endpoint override', async () => {
    const { result, fetchSpy } = call(
      {},
      { endpoint: 'http://127.0.0.1:8787/v1/systemone' },
    );
    expect((await result).ok).toBe(true);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      'http://127.0.0.1:8787/v1/systemone',
    );
  });
});

describe('callJev failure taxonomy (no retries)', () => {
  it('times out on a slow server', async () => {
    const { result, fetchSpy } = call({ delayMs: 200 }, { timeoutMs: 20 });
    const res = await result;
    expect(res).toMatchObject({
      ok: false,
      error: { kind: 'timeout' },
      requestId: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reports a failed connection as network', async () => {
    expect(await call({ networkError: true }).result).toMatchObject({
      ok: false,
      error: { kind: 'network' },
    });
  });

  it('reports a caller abort as network, not timeout', async () => {
    const controller = new AbortController();
    const pending = call({ delayMs: 200 }, { signal: controller.signal });
    controller.abort();
    expect(await pending.result).toMatchObject({
      ok: false,
      error: { kind: 'network' },
    });
  });

  it.each([
    [{ 'retry-after': '2' }, 2000],
    [{ 'retry-after-ms': '1500' }, 1500],
    [{ 'retry-after-ms': '250', 'retry-after': '9' }, 250],
    [{}, undefined],
  ])(
    'maps 429 to rate_limited with retryAfterMs (%j)',
    async (headers, expected) => {
      const { result, fetchSpy } = call({ status: 429, headers });
      const res = await result;
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.kind).toBe('rate_limited');
      expect(
        res.error.kind === 'rate_limited' ? res.error.retryAfterMs : null,
      ).toBe(expected);
      expect(res.requestId).toMatch(/^req_/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('maps 529 to overloaded without retrying', async () => {
    const { result, fetchSpy } = call({ status: 529 });
    expect(await result).toMatchObject({
      ok: false,
      error: { kind: 'overloaded' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('maps 401 and 403 to auth', async () => {
    expect(await call({}, { apiKey: 'invalid' }).result).toMatchObject({
      error: { kind: 'auth', status: 401 },
    });
    expect(await call({ status: 403 }).result).toMatchObject({
      error: { kind: 'auth', status: 403 },
    });
  });

  it('never sends a request without a key', async () => {
    const { result, fetchSpy } = call({}, { apiKey: '' });
    expect(await result).toMatchObject({
      ok: false,
      error: { kind: 'auth', status: 403 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps 400 and 422 to invalid with the body', async () => {
    const res422 = await call({
      status: 422,
      body: { detail: [{ loc: ['body', 'state'], msg: 'bad', type: 'x' }] },
    }).result;
    expect(res422).toMatchObject({
      ok: false,
      error: {
        kind: 'invalid',
        status: 422,
        body: { detail: [{ msg: 'bad' }] },
      },
    });
    expect(
      await call({ status: 400, body: { detail: 'Too many choices' } }).result,
    ).toMatchObject({
      error: {
        kind: 'invalid',
        status: 400,
        body: { detail: 'Too many choices' },
      },
    });
  });

  it.each([500, 502, 503, 504, 404])('maps %i to server', async (status) => {
    const { result, fetchSpy } = call({ status });
    expect(await result).toMatchObject({
      ok: false,
      error: { kind: 'server', status },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('maps malformed bodies to shape', async () => {
    expect(
      await call({ rawBody: '{"model": "jev-1.13.0", ' }).result,
    ).toMatchObject({ error: { kind: 'shape', issue: 'json' } });
    expect(
      await call({ body: { model: JEV_PINNED_MODEL, answers: good.answers } })
        .result,
    ).toMatchObject({
      error: { kind: 'shape', issue: 'envelope' },
    });
    const missing = { ...good, answers: { ...good.answers } };
    delete missing.answers.task_r4;
    expect(await call({ body: missing }).result).toMatchObject({
      error: { kind: 'shape', issue: 'missing_or_type:task_r4' },
    });
    const wrongChoice = structuredClone(good);
    (wrongChoice.answers.role_r4 as { choice: string }).choice = 'sidebar';
    expect(await call({ body: wrongChoice }).result).toMatchObject({
      error: { kind: 'shape', issue: 'choice:role_r4' },
    });
    const badProb = structuredClone(good);
    (badProb.answers.task_r4 as { noul: number }).noul = 1.2;
    expect(await call({ body: badProb }).result).toMatchObject({
      error: { kind: 'shape', issue: 'noul:task_r4' },
    });
    const extraOption = structuredClone(good);
    (
      extraOption.answers.role_r4 as { probabilities: Record<string, number> }
    ).probabilities.sidebar = 0.1;
    expect(await call({ body: extraOption }).result).toMatchObject({
      error: { kind: 'shape', issue: 'probs:role_r4' },
    });
  });

  it('refuses answers from a model other than the pinned one', async () => {
    expect(await call({ model: 'jev-1.14.0' }).result).toMatchObject({
      ok: false,
      error: { kind: 'model_drift', got: 'jev-1.14.0' },
    });
  });
});

describe('parseRetryAfter / checkJevShape', () => {
  it('parses HTTP dates relative to now', () => {
    const now = Date.UTC(2026, 8, 29, 12, 0, 0);
    const headers = new Headers({
      'retry-after': new Date(now + 3000).toUTCString(),
    });
    expect(parseRetryAfter(headers, now)).toBe(3000);
    expect(
      parseRetryAfter(new Headers({ 'retry-after': 'soon' }), now),
    ).toBeUndefined();
  });

  it('checks score levels', () => {
    const questions: Record<string, JevQuestion> = {
      s: { type: 'score', criteria: ['a', 'b'] },
    };
    const ok = {
      model: 'm',
      usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        s: {
          type: 'score',
          score: 0.5,
          confidence: 0,
          legend: {},
          probabilities: { 0: 0.5, 1: 0.5 },
        },
      },
    };
    expect(checkJevShape(questions, ok)).toBeNull();
    const bad = structuredClone(ok);
    (bad.answers.s.probabilities as Record<string, number>)['2'] = 0;
    expect(checkJevShape(questions, bad)).toBe('levels:s');
  });
});
