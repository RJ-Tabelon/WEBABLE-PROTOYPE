// Shared helpers for the claims scripts. Read-only on the product: these scripts measure, they never change code.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SERVER = 'http://127.0.0.1:41741';

/** The eval harness helpers (Playwright loading, the core loader, slug, sleep). */
export const evalCommon = () => import(pathToFileURL(path.join(ROOT, 'scripts/eval/lib/common.mjs')).href);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Nearest-rank percentile (p in 0..100). */
export function percentile(xs, p) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[i];
}

export const frac = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : 'n/a');

/** Quoted CSV, one row per array. */
export const toCsv = (rows) => `${rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')}\n`;

/** A CSV file as objects keyed by the header row (handles quotes and doubled quotes; one record per line). */
export function readCsv(file) {
  const rows = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [head = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/**
 * Read one key from the repo .env into this process only. The value is never printed or written anywhere; callers pass
 * it straight to the client library.
 */
export function envKey(name) {
  if (process.env[name]) return process.env[name];
  try {
    for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\n]+?)"?\\s*$`).exec(line);
      if (m) return m[1];
    }
  } catch {
    /* no .env */
  }
  return null;
}

/** A module from apps/server's dependencies (openai, tsx), without installing anything at the root. */
export const serverRequire = createRequire(path.join(ROOT, 'apps/server/package.json'));

/** Two-sided exact sign test p-value for k successes out of n (ties dropped by the caller). */
export function signTest(k, n) {
  if (!n) return null;
  const choose = (a, b) => {
    let r = 1;
    for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i;
    return r;
  };
  const lo = Math.min(k, n - k);
  let tail = 0;
  for (let i = 0; i <= lo; i++) tail += choose(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}

/** Wilson score interval for a proportion (95% by default). */
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
