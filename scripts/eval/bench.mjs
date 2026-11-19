#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { loadCore } from './lib/bundle.mjs';
import { OUTPUT_ROOT } from './lib/paths.mjs';
import { planOnce } from './lib/planner.mjs';
import { agreement, score } from './lib/rubric.mjs';
import { Ledger } from './openai.mjs';

/**
 * Planner re-benchmark (docs/10 §4.1, §6) on skeletons frozen by run.mjs,
 * with the shipped wire, outline, prompt and schema:
 *
 *   node scripts/eval/bench.mjs [--frozen <dir>] [--runs 2] [--pages a,b]
 *                               [--budget 3.5]
 *
 * Per page: the heuristic spec (core, local) and `runs` fresh planner calls
 * on the fast tier, each through the compose function's checks, then the
 * validator. Reports validity, unknown ids, repairs, latency, agreement
 * between heuristic and planner, and the answer-key rubric for both.
 * Writes <frozen>/../bench.json. No answer is cached: every run is a call.
 */

function parseArgs(argv) {
  const a = { frozen: null, runs: 2, pages: null, budget: 3.5 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--frozen') a.frozen = resolve(argv[++i]);
    else if (k === '--runs') a.runs = Number(argv[++i]);
    else if (k === '--pages') a.pages = argv[++i].split(',');
    else if (k === '--budget') a.budget = Number(argv[++i]);
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

async function latestFrozen() {
  const runs = (await readdir(OUTPUT_ROOT))
    .filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d))
    .sort();
  if (!runs.length) throw new Error('no evaluation run in eval-output/');
  return join(OUTPUT_ROOT, runs.at(-1), 'frozen');
}

function pct(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[
    Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))
  ];
}
const mean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length
    ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100
    : null;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const frozen = args.frozen ?? (await latestFrozen());
  const core = await loadCore();
  const ledger = await new Ledger(
    join(OUTPUT_ROOT, 'openai-ledger.json'),
    args.budget,
  ).load();
  const files = (await readdir(frozen))
    .filter((f) => f.endsWith('.json'))
    .sort();
  const pages = [];
  for (const f of files) {
    const page = JSON.parse(await readFile(join(frozen, f), 'utf8'));
    if (args.pages && !args.pages.includes(page.id)) continue;
    if (!page.wire) continue;
    const siteHost = new URL(page.url).hostname;
    const t0 = performance.now();
    const hSpec = core.heuristicSpec(page.skeleton, page.context ?? {});
    const t1 = performance.now();
    const hVal = core.validateSpec(hSpec, page.skeleton, { siteHost });
    const t2 = performance.now();
    const key = page.key;
    const out = {
      id: page.id,
      url: page.url,
      nodes: page.skeleton.nodes.length,
      key: key ? { pageTypes: key.pageTypes, ids: key.ids } : null,
      heuristic: {
        ms: Math.round((t1 - t0) * 100) / 100,
        validateMs: Math.round((t2 - t1) * 100) / 100,
        page_type: hVal?.spec.page_type ?? null,
        primary: hVal ? hVal.spec.sections[hVal.primary]?.kind : null,
        repairs: hVal?.repairs.map((r) => r.kind) ?? null,
        rubric: key ? score(hVal, page.skeleton, key) : null,
      },
      runs: [],
    };
    for (let i = 0; i < args.runs; i++) {
      if (!ledger.allows()) {
        out.runs.push({ ok: false, stage: 'budget' });
        continue;
      }
      const r = await planOnce(core, page.wire, { ledger, cacheDir: null });
      const run = {
        ok: r.ok,
        stage: r.stage,
        ms: r.call?.totalMs ?? null,
        ttftMs: r.call?.ttftMs ?? null,
        usage: r.call?.usage ?? null,
        cost: r.call?.cost ?? 0,
        meta: r.meta ?? null,
        unknown: r.check?.stage === 'unknown_id' ? r.check.count : 0,
        referenced: r.check?.total ?? null,
      };
      // The function rejects specs with unknown ids; the validator could still repair them.
      const spec = r.spec ?? null;
      const raw = spec ?? null;
      if (raw) {
        const v = core.validateSpec(raw, page.skeleton, { siteHost });
        run.page_type = v?.spec.page_type ?? null;
        run.primary = v ? v.spec.sections[v.primary]?.kind : null;
        run.sections = raw.sections.length;
        run.collections = raw.collections.length;
        run.repairs = v?.repairs.map((x) => x.kind) ?? null;
        run.rubric = key ? score(v, page.skeleton, key) : null;
        run.agreement = agreement(hVal, v, page.skeleton);
      }
      out.runs.push(run);
      console.log(
        `${page.id} run ${i + 1}: ${r.ok ? 'valid' : r.stage} ${run.ms} ms${run.rubric ? ` rubric ${run.rubric.score}` : ''} (heuristic ${out.heuristic.rubric?.score ?? '–'})`,
      );
    }
    pages.push(out);
  }

  const runs = pages.flatMap((p) => p.runs.filter((r) => r.stage !== 'budget'));
  const valid = runs.filter((r) => r.ok);
  const summary = {
    frozen,
    model: core.COMPOSE_PINNED_MODEL,
    schema: core.COMPOSE_SCHEMA_VERSION,
    pages: pages.length,
    calls: runs.length,
    validity: runs.length
      ? Math.round((valid.length / runs.length) * 1000) / 1000
      : null,
    stages: Object.fromEntries(
      [...new Set(runs.map((r) => r.stage))].map((s) => [
        s,
        runs.filter((r) => r.stage === s).length,
      ]),
    ),
    unknownIdCalls: runs.filter((r) => r.unknown > 0).length,
    unknownIdRate: (() => {
      const ref = runs.reduce((n, r) => n + (r.referenced ?? 0), 0);
      const unk = runs.reduce((n, r) => n + (r.unknown ?? 0), 0);
      return ref ? Math.round((unk / ref) * 10000) / 10000 : null;
    })(),
    repairsPerSpec: mean(valid.map((r) => r.repairs?.length ?? 0)),
    repairKinds: valid
      .flatMap((r) => r.repairs ?? [])
      .reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}),
    latencyMs: {
      p50: pct(
        runs.map((r) => r.ms),
        50,
      ),
      p95: pct(
        runs.map((r) => r.ms),
        95,
      ),
      max: pct(
        runs.map((r) => r.ms),
        100,
      ),
      ttftP50: pct(
        runs.map((r) => r.ttftMs),
        50,
      ),
      over12s: runs.filter((r) => r.ms > 12_000).length,
    },
    tokens: {
      inputP50: pct(
        runs.map((r) => r.usage?.input),
        50,
      ),
      cachedP50: pct(
        runs.map((r) => r.usage?.cached),
        50,
      ),
      outputP50: pct(
        runs.map((r) => r.usage?.output),
        50,
      ),
    },
    cost: Math.round(runs.reduce((n, r) => n + (r.cost ?? 0), 0) * 1000) / 1000,
    rubric: {
      heuristic: mean(pages.map((p) => p.heuristic.rubric?.score)),
      planner: mean(
        pages.map((p) =>
          mean(p.runs.filter((r) => r.ok).map((r) => r.rubric?.score)),
        ),
      ),
      criteria: Object.fromEntries(
        ['pageType', 'primary', 'search', 'nav', 'records', 'clutter'].map(
          (c) => [
            c,
            {
              heuristic: mean(
                pages.map((p) => p.heuristic.rubric?.criteria[c]),
              ),
              planner: mean(
                pages.flatMap((p) =>
                  p.runs.filter((r) => r.ok).map((r) => r.rubric?.criteria[c]),
                ),
              ),
            },
          ],
        ),
      ),
    },
    agreement: {
      pageType: mean(valid.map((r) => (r.agreement?.pageType ? 1 : 0))),
      primaryKind: mean(valid.map((r) => (r.agreement?.primaryKind ? 1 : 0))),
      primaryJaccard: mean(valid.map((r) => r.agreement?.primaryJaccard)),
      runToRunPageType: mean(
        pages
          .filter((p) => p.runs.filter((r) => r.ok).length >= 2)
          .map((p) => {
            const [a, b] = p.runs.filter((r) => r.ok);
            return a.page_type === b.page_type ? 1 : 0;
          }),
      ),
    },
  };
  const file = join(frozen, '..', 'bench.json');
  await writeFile(file, JSON.stringify({ summary, pages }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  console.log(`bench ${file}; OpenAI spent $${ledger.spent.toFixed(3)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
