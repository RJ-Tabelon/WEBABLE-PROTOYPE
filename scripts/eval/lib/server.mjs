// Find the WebAble server on 127.0.0.1:41741, or start it for the run and stop it afterwards.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SERVER_DIR, SERVER_ORIGIN, sleep } from './common.mjs';

/** GET /health. Resolves to the parsed body, or null if the server is not answering. */
export async function health(origin = SERVER_ORIGIN, timeoutMs = 1500) {
  try {
    const r = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json().catch(() => ({}));
  } catch {
    return null;
  }
}

/**
 * Make sure the server is up. If it is already running, use it and leave it running.
 * Otherwise start `tsx src/index.ts` in apps/server (with the repo .env if present), log its
 * output to `logFile`, and return a stop() that ends it. Keys stay in the server process.
 */
export async function ensureServer({ logFile, start = true, log = console.log, origin = SERVER_ORIGIN } = {}) {
  const existing = await health(origin);
  if (existing) return { started: false, health: existing, stop: async () => {} };
  if (!start) throw new Error(`The WebAble server is not answering at ${origin}. Start it with: pnpm dev:server`);
  const port = new URL(origin).port || '41741';

  const tsx = path.join(SERVER_DIR, 'node_modules/.bin/tsx');
  if (!existsSync(tsx)) throw new Error('apps/server/node_modules/.bin/tsx is missing. Run pnpm install first.');
  const envFile = path.join(ROOT, '.env');
  const args = [...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), 'src/index.ts'];
  log(`Starting the WebAble server (${existsSync(envFile) ? 'with .env' : 'no .env, so no Jev or OpenAI'})…`);
  const child = spawn(tsx, args, { cwd: SERVER_DIR, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: port } });
  const out = logFile ? createWriteStream(logFile, { flags: 'a' }) : null;
  child.stdout.on('data', (d) => out?.write(d));
  child.stderr.on('data', (d) => out?.write(d));
  let exited = false;
  child.on('exit', () => { exited = true; });

  const stop = async () => {
    if (exited) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
    for (let i = 0; i < 30 && !exited; i++) await sleep(100);
    if (!exited) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
    out?.end();
  };

  for (let i = 0; i < 80; i++) {
    if (exited) break;
    const h = await health(origin);
    if (h) return { started: true, health: h, stop };
    await sleep(250);
  }
  await stop();
  throw new Error(`The WebAble server did not come up within 20 s${logFile ? ` (see ${logFile})` : ''}.`);
}
