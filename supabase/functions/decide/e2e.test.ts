// End to end over real HTTP: decide handler -> callJev -> scripts/jev-mock-server.mjs.
// Needs loopback network access; skipped (and says so) without it:
//   deno test --no-config --allow-env --allow-net=127.0.0.1 supabase/functions/decide

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';

import { corsPolicyFromEnv } from '../_shared/cors.ts';
import { startJevMockServer } from '../../../scripts/jev-mock-server.mjs';
import { jevConfigFromEnv } from './config.ts';
import { decideRequest } from './fixtures.ts';
import { createDecideHandler } from './handler.ts';

interface JevMock {
  url: string;
  setScenario(scenario: Record<string, unknown>): void;
  reset(): void;
  requests(): unknown[];
  close(): Promise<void>;
}

const net = await Deno.permissions.query({ name: 'net', host: '127.0.0.1' });

function handlerFor(mock: JevMock, timeoutMs: number) {
  const config = jevConfigFromEnv({
    get: (n) => ({ TYPESAFE_API_KEY: 'mock', JEV_BASE_URL: mock.url })[n],
  });
  assert(config.status === 'ready');
  return createDecideHandler({
    cors: corsPolicyFromEnv({ get: () => undefined }, ['extension']),
    verify: () =>
      Promise.resolve({
        ok: true,
        token: 'a.b.c',
        user: {
          id: '6f1c3c1e-3b7a-4c55-9d0e-6a8b7f1d2e3a',
          email: 'person@example.com',
          isAnonymous: false,
          sessionId: null,
        },
      }),
    readConsent: () => Promise.resolve(true),
    consumeQuota: () => Promise.resolve({ userOk: true, globalOk: true }),
    jev: { status: 'ready', settings: { ...config.settings, timeoutMs } },
    now: () => performance.now(),
    log: () => {},
  });
}

const request = () =>
  new Request('http://functions.local/decide', {
    method: 'POST',
    headers: {
      authorization: 'Bearer a.b.c',
      'content-type': 'application/json',
    },
    body: JSON.stringify(decideRequest()),
  });

Deno.test({
  name: 'e2e: decide answers through the local Jev mock server',
  ignore: net.state !== 'granted',
  async fn(t) {
    const mock = (await startJevMockServer({
      port: 0,
      latency: [5, 25],
    })) as JevMock;
    try {
      const handle = handlerFor(mock, 400);

      await t.step('answers with probabilities only', async () => {
        const res = await handle(request());
        assertEquals(res.status, 200);
        const body = await res.json();
        assert(body.ok);
        assertEquals(Object.keys(body.regions), ['r1', 'r2', 'r3']);
        assertFalse(JSON.stringify(body).includes('confidence'));
        const [sent] = mock.requests() as Array<{
          model: string;
          questions: object;
        }>;
        assertEquals(sent?.model, 'jev-1.13.0');
        assertEquals(Object.keys(sent?.questions ?? {}).length, 8);
      });

      await t.step('slow upstream -> timeout', async () => {
        mock.setScenario({ delayMs: 2_000, times: 1 });
        assertEquals(await (await handle(request())).json(), {
          v: 1,
          ok: false,
          degraded: 'timeout',
        });
      });

      await t.step('model drift', async () => {
        mock.setScenario({ model: 'jev-1.14.0', times: 1 });
        assertEquals(
          (await (await handle(request())).json()).degraded,
          'model_drift',
        );
      });

      await t.step('rate limited with a retry hint', async () => {
        mock.setScenario({
          status: 429,
          headers: { 'retry-after': '3' },
          times: 1,
        });
        assertEquals(await (await handle(request())).json(), {
          v: 1,
          ok: false,
          degraded: 'rate_limited',
          retryAfterMs: 3_000,
        });
      });

      await t.step('connection reset -> upstream', async () => {
        // No `times`: fetch retries a reset pooled connection once by itself.
        mock.setScenario({ networkError: true });
        assertEquals(
          (await (await handle(request())).json()).degraded,
          'upstream',
        );
        mock.reset();
      });

      await t.step('answers resume once the upstream recovers', async () => {
        assertEquals((await handle(request())).status, 200);
      });
    } finally {
      await mock.close();
    }
  },
});
