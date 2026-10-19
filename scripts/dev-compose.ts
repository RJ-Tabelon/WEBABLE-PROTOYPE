// Local dev planner: the real `compose` handler on 127.0.0.1, with Supabase
// auth, consent and quota stubbed (docs/10 §8).
//
//   pnpm dev:compose                 live: OPENAI_API_KEY from the root .env, gpt-6-sol
//   pnpm dev:compose -- --mock       deterministic planner, no key, no network
//   pnpm dev:compose -- --port 54401 --token <dev token> --delay 3000
//
// Point the extension's development build at it with
// WXT_COMPOSE_URL=http://127.0.0.1:54400/compose. Only that build's Origin
// (chrome-extension://bbnblnlbgcccbbbbihngngbecbobedie) may POST, and the Host
// header must name 127.0.0.1 or localhost on this port. No account is needed;
// with --token, every request must also carry that bearer token. Production
// builds ignore loopback URLs.
//
//   --mock        answer with a heuristic-like spec built from the request's outline
//   --port N      listen on 127.0.0.1:N (default 54400)
//   --token T     require `Authorization: Bearer T` (default: none required)
//   --delay MS    with --mock, simulated model time (to see the "better layout" chip)
//
// The key is read from the file at startup and never printed or logged.
// Requires Deno: deno run --allow-net=127.0.0.1,api.openai.com --allow-read --allow-env scripts/dev-compose.ts

import { COMPOSE_PINNED_MODEL } from '../supabase/functions/_shared/core.bundle.js';
import {
  OPENAI_RESPONSES_URL,
  PLANNER_TIMEOUT_MS,
  type PlannerConfig,
} from '../supabase/functions/compose/config.ts';
import {
  createDevComposeHandler,
  DEV_COMPOSE_PORT,
} from '../supabase/functions/compose/dev.ts';
import { createMockPlannerFetch } from '../supabase/functions/compose/mock.ts';

interface Args {
  mock: boolean;
  port: number;
  token?: string;
  delayMs: number;
}

function fail(message: string): never {
  console.error(message);
  Deno.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mock: false, port: DEV_COMPOSE_PORT, delayMs: 0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} needs a value.`);
      return v;
    };
    if (arg === '--') continue;
    else if (arg === '--mock') args.mock = true;
    else if (arg === '--port') {
      const port = Number(value());
      if (!Number.isInteger(port) || port < 1024 || port > 65535)
        fail('--port must be a number from 1024 to 65535.');
      args.port = port;
    } else if (arg === '--token') {
      const token = value();
      if (!/^[\x21-\x7e]{8,8192}$/.test(token))
        fail('--token must be 8 or more printable characters, without spaces.');
      args.token = token;
    } else if (arg === '--delay') {
      const ms = Number(value());
      if (!Number.isInteger(ms) || ms < 0 || ms > 60_000)
        fail('--delay must be milliseconds from 0 to 60000.');
      args.delayMs = ms;
    } else fail(`Unknown argument: ${arg}`);
  }
  return args;
}

/** OPENAI_API_KEY from a dotenv file, or undefined. Handles `export`, quotes and comments. */
export function readKey(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[1]!;
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    return v.trim() || undefined;
  }
  return undefined;
}

function plannerConfig(args: Args): PlannerConfig {
  if (args.mock) {
    return {
      status: 'ready',
      settings: {
        apiKey: 'mock',
        endpoint: OPENAI_RESPONSES_URL,
        timeoutMs: PLANNER_TIMEOUT_MS,
        fetch: createMockPlannerFetch(
          args.delayMs ? { delayMs: args.delayMs } : {},
        ),
      },
    };
  }
  const envFile = new URL('../.env', import.meta.url);
  let text = '';
  try {
    text = Deno.readTextFileSync(envFile);
  } catch {
    fail('No .env at the repo root. Use --mock for a planner without a key.');
  }
  const apiKey = readKey(text);
  if (!apiKey)
    fail(
      'OPENAI_API_KEY is not set in .env. Use --mock for a planner without a key.',
    );
  return {
    status: 'ready',
    settings: {
      apiKey,
      endpoint: OPENAI_RESPONSES_URL,
      timeoutMs: PLANNER_TIMEOUT_MS,
    },
  };
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const planner = plannerConfig(args);
  const handler = createDevComposeHandler({
    port: args.port,
    planner,
    ...(args.token !== undefined ? { token: args.token } : {}),
  });
  Deno.serve(
    {
      hostname: '127.0.0.1',
      port: args.port,
      onListen: () => {
        console.log(
          args.mock
            ? 'planner: mock'
            : `planner: live (${COMPOSE_PINNED_MODEL})`,
        );
        console.log(`compose: http://127.0.0.1:${args.port}/compose`);
      },
    },
    handler,
  );
}
