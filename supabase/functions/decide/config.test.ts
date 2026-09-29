import { assertEquals } from 'jsr:@std/assert@1';

import { JEV_ENDPOINT } from '../_shared/core.bundle.js';
import { jevConfigFromEnv, jevEndpoint, JEV_TIMEOUT_MS } from './config.ts';

const env = (values: Record<string, string>) => ({
  get: (n: string) => values[n],
});

Deno.test('production endpoint unless JEV_BASE_URL is set', () => {
  assertEquals(jevEndpoint(undefined), JEV_ENDPOINT);
  assertEquals(jevEndpoint('   '), JEV_ENDPOINT);
});

Deno.test('JEV_BASE_URL: https anywhere, plain http only on loopback', () => {
  const cases: Array<[string, string | null]> = [
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787/v1/systemone'],
    ['http://localhost:8787/', 'http://localhost:8787/v1/systemone'],
    ['http://[::1]:8787', 'http://[::1]:8787/v1/systemone'],
    [
      'http://host.docker.internal:8787',
      'http://host.docker.internal:8787/v1/systemone',
    ],
    ['http://jev.localhost', 'http://jev.localhost/v1/systemone'],
    [
      'https://jev-proxy.example.com/jev/',
      'https://jev-proxy.example.com/jev/v1/systemone',
    ],
    ['http://jev-proxy.example.com', null],
    ['http://10.0.0.5:8787', null],
    ['ftp://127.0.0.1', null],
    ['https://user:pass@jev-proxy.example.com', null],
    ['https://jev-proxy.example.com/?key=1', null],
    ['not a url', null],
  ];
  for (const [base, expected] of cases)
    assertEquals(jevEndpoint(base), expected, base);
});

Deno.test('unconfigured without a key; the key is trimmed', () => {
  assertEquals(jevConfigFromEnv(env({})), {
    status: 'unconfigured',
    reason: 'no_key',
  });
  assertEquals(jevConfigFromEnv(env({ TYPESAFE_API_KEY: '  ' })), {
    status: 'unconfigured',
    reason: 'no_key',
  });
  assertEquals(jevConfigFromEnv(env({ TYPESAFE_API_KEY: ' k ' })), {
    status: 'ready',
    settings: {
      apiKey: 'k',
      endpoint: JEV_ENDPOINT,
      timeoutMs: JEV_TIMEOUT_MS,
    },
  });
});

Deno.test('a bad JEV_BASE_URL disables analysis rather than guessing', () => {
  assertEquals(
    jevConfigFromEnv(
      env({ TYPESAFE_API_KEY: 'k', JEV_BASE_URL: 'http://jev.example.com' }),
    ),
    { status: 'unconfigured', reason: 'bad_base_url' },
  );
});

Deno.test('the Jev deadline is 2 s', () => {
  assertEquals(JEV_TIMEOUT_MS, 2_000);
});
