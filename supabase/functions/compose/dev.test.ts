// The local dev planner's gate, in process (no sockets): Host, Origin, bearer
// token and paths in front of the real handler with the mock planner.

import { assert, assertEquals } from 'jsr:@std/assert@1';

import { readKey } from '../../../scripts/dev-compose.ts';
import { composeResponseSchema } from '../_shared/core.bundle.js';
import { OPENAI_RESPONSES_URL, PLANNER_TIMEOUT_MS } from './config.ts';
import {
  createDevComposeHandler,
  DEV_EXTENSION_ORIGIN,
  type DevGateOptions,
} from './dev.ts';
import { composeRequest } from './fixtures.ts';
import { createMockPlannerFetch } from './mock.ts';

const PORT = 54400;
const OTHER_EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

function gate(opts: Partial<DevGateOptions> = {}) {
  const events: string[] = [];
  const handle = createDevComposeHandler({
    port: PORT,
    planner: {
      status: 'ready',
      settings: {
        apiKey: 'mock',
        endpoint: OPENAI_RESPONSES_URL,
        timeoutMs: PLANNER_TIMEOUT_MS,
        fetch: createMockPlannerFetch(),
      },
    },
    log: (event, fields = {}) => {
      events.push(`${event}${fields.reason ? `:${fields.reason}` : ''}`);
    },
    ...opts,
  });
  return { handle, events };
}

function req(
  init: {
    method?: string;
    path?: string;
    host?: string | null;
    origin?: string | null;
    token?: string | null;
    body?: unknown;
  } = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (init.host !== null) headers.set('host', init.host ?? `127.0.0.1:${PORT}`);
  if (init.origin !== null)
    headers.set('origin', init.origin ?? DEV_EXTENSION_ORIGIN);
  if (init.token !== null)
    headers.set('authorization', `Bearer ${init.token ?? 'dev-session-token'}`);
  const method = init.method ?? 'POST';
  return new Request(`http://127.0.0.1:${PORT}${init.path ?? '/compose'}`, {
    method,
    headers,
    ...(method === 'POST'
      ? { body: JSON.stringify(init.body ?? composeRequest()) }
      : {}),
  });
}

Deno.test('the dev extension gets a spec from the real handler', async () => {
  const { handle } = gate();
  for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`]) {
    const res = await handle(req({ host }));
    assertEquals(res.status, 200);
    assertEquals(
      res.headers.get('access-control-allow-origin'),
      DEV_EXTENSION_ORIGIN,
    );
    const body = await res.json();
    assert(composeResponseSchema.safeParse(body).success);
    assertEquals(body.ok, true);
    assertEquals(body.model, 'gpt-6-sol');
  }
  const prefixed = await handle(req({ path: '/functions/v1/compose' }));
  assertEquals(prefixed.status, 200);
});

Deno.test(
  'another Host is refused (DNS rebinding, LAN names, other ports)',
  async () => {
    const { handle, events } = gate();
    for (const host of [
      'evil.example',
      `evil.example:${PORT}`,
      `127.0.0.1:${PORT + 1}`,
      '127.0.0.1',
      `192.168.1.20:${PORT}`,
      `[::1]:${PORT}`,
    ]) {
      const res = await handle(req({ host }));
      assertEquals(res.status, 403, host);
      assertEquals((await res.json()).error.code, 'forbidden_host');
    }
    assertEquals((await handle(req({ host: null }))).status, 403);
    assert(events.every((e) => e === 'dev_compose_refused:host'));
  },
);

Deno.test('POST requires the dev extension Origin', async () => {
  const { handle } = gate();
  for (const origin of [
    null,
    'https://example.com',
    'http://127.0.0.1:3000',
    OTHER_EXTENSION,
    'null',
  ]) {
    const res = await handle(req({ origin }));
    assertEquals(res.status, 403, String(origin));
    assertEquals((await res.json()).error.code, 'forbidden_origin');
  }
});

Deno.test(
  'no token is needed by default; the pinned one is when set',
  async () => {
    const open = gate();
    // The development build calls without an account.
    assertEquals((await open.handle(req({ token: null }))).status, 200);
    assertEquals(
      (await open.handle(req({ token: 'dev-session-token' }))).status,
      200,
    );
    // A header that is present must be a well-formed bearer token.
    assertEquals((await open.handle(req({ token: 'short' }))).status, 401);

    const pinned = gate({ token: 'dev-planner-token-1234' });
    assertEquals((await pinned.handle(req({ token: null }))).status, 401);
    assertEquals(
      (await pinned.handle(req({ token: 'dev-session-token' }))).status,
      401,
    );
    assertEquals(
      (await pinned.handle(req({ token: 'dev-planner-token-12345' }))).status,
      401,
    );
    assertEquals(
      (await pinned.handle(req({ token: 'dev-planner-token-1234' }))).status,
      200,
    );
  },
);

Deno.test('CORS is for the dev extension only', async () => {
  const { handle } = gate();
  const ok = await handle(req({ method: 'OPTIONS' }));
  assertEquals(ok.status, 204);
  assertEquals(
    ok.headers.get('access-control-allow-origin'),
    DEV_EXTENSION_ORIGIN,
  );
  const web = await handle(
    req({ method: 'OPTIONS', origin: 'http://localhost:3000' }),
  );
  assertEquals(web.status, 403);
  assertEquals(web.headers.get('access-control-allow-origin'), null);
});

Deno.test(
  'health answers without an Origin; unknown paths are 404',
  async () => {
    const { handle } = gate();
    const health = await handle(
      req({
        method: 'GET',
        path: '/compose/health',
        origin: null,
        token: null,
      }),
    );
    assertEquals(health.status, 204);
    for (const path of ['/', '/decide', '/compose/x', '/v1/responses'])
      assertEquals((await handle(req({ path }))).status, 404, path);
  },
);

Deno.test('the dev planner still validates every request', async () => {
  const { handle } = gate();
  const bad = composeRequest();
  bad.skeleton.nodes[5] = { ...bad.skeleton.nodes[5]!, l: ['caden'] };
  const res = await handle(req({ body: bad }));
  assertEquals(res.status, 422);
});

Deno.test('readKey reads OPENAI_API_KEY from dotenv text', () => {
  assertEquals(readKey('A=1\nOPENAI_API_KEY=sk-abc\n'), 'sk-abc');
  assertEquals(readKey('export OPENAI_API_KEY="sk-q # x"'), 'sk-q # x');
  assertEquals(readKey("OPENAI_API_KEY='sk-s'"), 'sk-s');
  assertEquals(readKey('OPENAI_API_KEY=sk-c # comment'), 'sk-c');
  assertEquals(
    readKey('# OPENAI_API_KEY=sk-off\nOPENAI_API_KEY_2=x'),
    undefined,
  );
  assertEquals(readKey('OPENAI_API_KEY='), undefined);
});
