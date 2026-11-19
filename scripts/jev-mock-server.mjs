#!/usr/bin/env node
// A local stand-in for TypeSafe Jev: POST /v1/systemone, for extension e2e tests
// and for `decide` running under `supabase functions serve` with JEV_BASE_URL.
//
//   node scripts/jev-mock-server.mjs [--port 8787] [--host 127.0.0.1]
//                                    [--latency 70-200] [--model jev-1.13.0] [--verbose]
//
// Answers come from the core mock (createMockJevFetch -> mockJevAnswer, via
// supabase/functions/_shared/core.bundle.js): deterministic probabilities from
// the same structural evidence the real model reads, shaped exactly like the
// real API, including its checks (403 without a bearer key, 401 for the key
// "invalid", 422 for invalid bodies). Latency is drawn from 70-200 ms, skewed
// low like the measured server time (median about 100 ms).
//
// Pointing `decide` at it:
//   TYPESAFE_API_KEY=mock JEV_BASE_URL=http://127.0.0.1:8787            (functions on the host)
//   TYPESAFE_API_KEY=mock JEV_BASE_URL=http://host.docker.internal:8787 (supabase functions serve;
//                                                                        add --host 0.0.0.0 if the
//                                                                        container cannot reach loopback)
//
// Test controls (bound to --host only; this is a development tool):
//   GET  /health            { ok, model, requests }
//   GET  /__mock/requests   the last 50 request bodies, newest last (what left `decide`)
//   POST /__mock/scenario   { status?, headers?, model?, delayMs?, rawBody?, body?,
//                             networkError?, times? }  applies to the next `times`
//                             requests (default: until reset). Examples:
//                             { "status": 429, "headers": { "retry-after": "2" } }
//                             { "delayMs": 3000 }            -> decide times out
//                             { "model": "jev-1.14.0" }      -> model drift
//                             { "networkError": true }        -> connection reset (leave out
//                                                               "times": fetch retries a reset
//                                                               pooled connection once itself)
//   POST /__mock/reset      clear the scenario and the request log
//
// Programmatic use (Playwright global setup):
//   const jev = await startJevMockServer({ port: 0 });  // jev.url, jev.setScenario(), jev.close()

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  createMockJevFetch,
  JEV_PINNED_MODEL,
} from '../supabase/functions/_shared/core.bundle.js';

const JEV_PATH = '/v1/systemone';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_LOGGED_REQUESTS = 50;
const SCENARIO_KEYS = new Set([
  'status',
  'headers',
  'model',
  'delayMs',
  'rawBody',
  'body',
  'networkError',
  'times',
]);

/** A latency in [min, max] ms, skewed toward min (u^2), like the real server time. */
export function sampleLatency([min, max], random = Math.random) {
  const u = random();
  return Math.round(min + (max - min) * u * u);
}

export function parseLatency(value) {
  const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(String(value).trim());
  if (!match)
    throw new Error(`--latency must look like 70-200, got "${value}".`);
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  if (max < min)
    throw new Error('--latency: the maximum is below the minimum.');
  return [min, max];
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

function validateScenario(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('A scenario is a JSON object.');
  }
  for (const key of Object.keys(input)) {
    if (!SCENARIO_KEYS.has(key))
      throw new Error(`Unknown scenario key "${key}".`);
  }
  if (
    input.times !== undefined &&
    !(Number.isInteger(input.times) && input.times > 0)
  ) {
    throw new Error('"times" is a positive integer.');
  }
  if (
    input.delayMs !== undefined &&
    !(Number.isFinite(input.delayMs) && input.delayMs >= 0)
  ) {
    throw new Error('"delayMs" is a non-negative number.');
  }
  if (
    input.status !== undefined &&
    !(
      Number.isInteger(input.status) &&
      input.status >= 100 &&
      input.status <= 599
    )
  ) {
    throw new Error('"status" is an HTTP status code.');
  }
  return input;
}

/**
 * Start the mock. Resolves once listening.
 * @param {{ port?: number, host?: string, latency?: [number, number], model?: string, verbose?: boolean }} [options]
 */
export async function startJevMockServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const latency = options.latency ?? [70, 200];
  const defaultModel = options.model ?? JEV_PINNED_MODEL;
  const verbose = options.verbose ?? false;

  /** @type {null | (Record<string, unknown> & { remaining: number })} */
  let scenario = null;
  const requests = [];
  let served = 0;

  const takeScenario = () => {
    if (!scenario) return null;
    const current = scenario;
    current.remaining -= 1;
    if (current.remaining <= 0) scenario = null;
    const { remaining: _r, times: _t, ...rest } = current;
    return rest;
  };

  async function answerJev(req, res) {
    const started = performance.now();
    const text = await readBody(req, MAX_BODY_BYTES);
    served += 1;
    try {
      requests.push(JSON.parse(text));
    } catch {
      requests.push(null);
    }
    if (requests.length > MAX_LOGGED_REQUESTS) requests.shift();

    const active = takeScenario();
    if (active?.networkError) {
      req.socket.destroy();
      return;
    }

    // Abort the simulated server time if the caller gives up (its own timeout).
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const mockFetch = createMockJevFetch({
      model: defaultModel,
      ...active,
      delayMs:
        typeof active?.delayMs === 'number'
          ? active.delayMs
          : sampleLatency(latency),
    });
    let upstream;
    try {
      upstream = await mockFetch(`http://${host}${JEV_PATH}`, {
        method: 'POST',
        headers: {
          authorization: req.headers.authorization ?? '',
          'content-type': 'application/json',
        },
        body: text,
        signal: abort.signal,
      });
    } catch {
      if (!res.writableEnded) res.destroy();
      return;
    }
    const body = await upstream.text();
    const headers = Object.fromEntries(upstream.headers.entries());
    res.writeHead(upstream.status, {
      ...headers,
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
    if (verbose) {
      const ms = Math.round(performance.now() - started);
      console.log(
        `POST ${JEV_PATH} ${upstream.status} ${ms}ms ${headers['x-typesafe-request-id'] ?? ''}`,
      );
    }
  }

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://mock').pathname;
    const route = `${req.method} ${path}`;
    const handle = async () => {
      switch (route) {
        case `POST ${JEV_PATH}`:
          return answerJev(req, res);
        case 'GET /health':
          return sendJson(res, 200, {
            ok: true,
            model: defaultModel,
            requests: served,
          });
        case 'GET /__mock/requests':
          return sendJson(res, 200, requests);
        case 'POST /__mock/scenario': {
          const input = validateScenario(
            JSON.parse((await readBody(req, 64 * 1024)) || '{}'),
          );
          scenario = {
            ...input,
            remaining: input.times ?? Number.POSITIVE_INFINITY,
          };
          return sendJson(res, 200, { ok: true });
        }
        case 'POST /__mock/reset':
          scenario = null;
          requests.length = 0;
          served = 0;
          return sendJson(res, 200, { ok: true });
        default:
          return sendJson(res, path === JEV_PATH ? 405 : 404, {
            detail: path === JEV_PATH ? 'Method Not Allowed' : 'Not Found',
          });
      }
    };
    handle().catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = typeof error?.status === 'number' ? error.status : 400;
      sendJson(res, status, {
        detail: error instanceof Error ? error.message : 'Bad request',
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8787, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address ? address.port : options.port;
  const urlHost = host.includes(':') ? `[${host}]` : host;

  return {
    url: `http://${urlHost}:${port}`,
    port,
    /** @param {Record<string, unknown>} next */
    setScenario(next) {
      const input = validateScenario(next);
      scenario = {
        ...input,
        remaining: input.times ?? Number.POSITIVE_INFINITY,
      };
    },
    reset() {
      scenario = null;
      requests.length = 0;
      served = 0;
    },
    requests: () => [...requests],
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function parseArgs(argv) {
  const out = {
    port: Number(process.env.JEV_MOCK_PORT ?? 8787),
    host: '127.0.0.1',
    latency: [70, 200],
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=')
      ? arg.split(/=(.*)/s)
      : [arg, undefined];
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case '--port':
        out.port = Number(value());
        break;
      case '--host':
        out.host = value();
        break;
      case '--latency':
        out.latency = parseLatency(value());
        break;
      case '--model':
        out.model = value();
        break;
      case '--verbose':
        out.verbose = true;
        break;
      case '--':
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) {
    throw new Error('--port must be 0-65535.');
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const mock = await startJevMockServer(args);
  console.log(
    `Jev mock listening on ${mock.url}${JEV_PATH} (latency ${args.latency.join('-')} ms, model ${args.model ?? JEV_PINNED_MODEL})`,
  );
  const stop = async () => {
    await mock.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
