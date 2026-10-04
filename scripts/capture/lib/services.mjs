import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { EXTENSION, FIXTURE_SERVER, WEB } from './paths.mjs';

/**
 * Child processes the capture needs (the web build and server, the engine
 * fixture servers, the extension build), each in its own process group so
 * stopping one stops everything it started.
 */

const children = new Set();

function run(command, args, { cwd, env, log }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.add(child);
  const lines = [];
  const collect = (chunk) => {
    const text = chunk.toString();
    lines.push(text);
    if (log) process.stdout.write(text.replace(/^/gm, `    [${log}] `));
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('exit', () => children.delete(child));
  child.output = () => lines.join('');
  return child;
}

function kill(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

export function stopAll() {
  for (const child of children) kill(child);
}

function exited(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function waitForUrl(url, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null)
      throw new Error(
        `${url}: the server exited (${child.exitCode}).\n${child.output().slice(-2000)}`,
      );
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not answer within ${timeoutMs} ms`);
}

/**
 * `next build` into its own dist dir. Next rewrites apps/web/tsconfig.json to
 * include that dir; the file is put back exactly as it was.
 */
export async function buildWeb({ distDir, env }) {
  const tsconfig = join(WEB, 'tsconfig.json');
  const before = await readFile(tsconfig, 'utf8');
  try {
    const child = run('npx', ['next', 'build'], {
      cwd: WEB,
      env: {
        ...env,
        NEXT_DIST_DIR: distDir,
        NEXT_TELEMETRY_DISABLED: '1',
        // The /dev gallery and shells are production-gated; the capture needs them.
        WEBABLE_DEV_PAGES: '1',
      },
      log: 'next build',
    });
    const code = await exited(child);
    if (code !== 0) throw new Error(`next build failed (${code})`);
  } finally {
    const after = await readFile(tsconfig, 'utf8').catch(() => null);
    if (after !== before) await writeFile(tsconfig, before);
  }
}

export async function startWeb({ distDir, env, port }) {
  const child = run('npx', ['next', 'start', '--port', String(port)], {
    cwd: WEB,
    env: {
      ...env,
      NEXT_DIST_DIR: distDir,
      NEXT_TELEMETRY_DISABLED: '1',
      WEBABLE_DEV_PAGES: '1',
    },
  });
  await waitForUrl(`http://localhost:${port}/sign-in`, 60_000, child);
  return { stop: () => kill(child), output: () => child.output() };
}

export async function buildExtension() {
  const child = run('npx', ['wxt', 'build', '--mode', 'e2e'], {
    cwd: EXTENSION,
    env: {},
    log: 'wxt build',
  });
  const code = await exited(child);
  if (code !== 0)
    throw new Error(`wxt build --mode e2e failed (${code})\n${child.output()}`);
}

/**
 * The engine fixture server (apps/extension/tests/engine/fixture-server.mjs) on
 * a port. 4173 is the e2e build's host access; any other port is a page the
 * extension has no access to.
 */
export async function startFixtureServer(port) {
  const url = `http://127.0.0.1:${port}/healthz`;
  try {
    const res = await fetch(url);
    if (res.ok) return { stop: () => undefined, reused: true };
  } catch {
    // Start one.
  }
  const child = run('node', [FIXTURE_SERVER], {
    cwd: EXTENSION,
    env: { ENGINE_FIXTURE_PORT: String(port) },
  });
  await waitForUrl(url, 20_000, child);
  return { stop: () => kill(child), reused: false };
}
