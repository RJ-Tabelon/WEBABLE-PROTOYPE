// pnpm --filter @webable/server check:live [--url http://127.0.0.1:41741] [--skip redesign,overlay] [--visual] [--fresh]
// Sends the Alderra fixtures through the real routes and prints metrics. Uses the running server when it answers
// on /health, otherwise the same app in-process. Never prints keys or page text beyond the fixture's own labels.
import type { PageUnderstanding, RedesignResult, StruggleJudgment, VisualVerdict } from '@webable/core';
import { PORT } from './config';
import {
  FIXTURE_DIGEST, FIXTURE_FIT, FIXTURE_OUTLINE, FIXTURE_OVERLAY, FIXTURE_OVERLAY_BUTTONS, FIXTURE_ROLES,
  FIXTURE_SIGNALS, fixtureVisual,
} from './fixtures';
import type { OverlayCloseResponse } from './routes/overlay';
import type { RedesignResponse } from './routes/redesign';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = opt('url') ?? `http://127.0.0.1:${PORT}`;
const skip = new Set((opt('skip') ?? '').split(',').filter(Boolean));
const fresh = flag('fresh');

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

async function pickFetcher(): Promise<{ fetcher: Fetcher; mode: string }> {
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_000) });
    if (r.ok || r.status === 503) return { fetcher: (p, init) => fetch(`${base}${p}`, init), mode: `server at ${base}` };
  } catch {
    // not running: fall through
  }
  const { createApp } = await import('./app');
  const app = createApp();
  return { fetcher: async (p, init) => app.request(p, init), mode: 'in-process (no server answered)' };
}

const ms = (n: number | null | undefined) => (n === null || n === undefined ? '-' : `${Math.round(n)} ms`);
const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 5 : 4)}`;
const p2 = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n.toFixed(2));

let failures = 0;

async function post<T>(f: Fetcher, path: string, body: unknown, soft: number[] = []): Promise<{ data: T; ms: number; cache: string | null } | null> {
  const t0 = performance.now();
  const r = await f(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(fresh ? { 'X-WebAble-Fresh': '1' } : {}) },
    body: JSON.stringify(body),
  });
  const took = performance.now() - t0;
  const text = await r.text();
  if (!r.ok) {
    if (soft.includes(r.status)) {
      console.log(`  not available (${r.status}): ${text.slice(0, 200)}`);
      return null;
    }
    failures++;
    console.log(`  FAILED ${r.status}: ${text.slice(0, 400)}`);
    return null;
  }
  return { data: JSON.parse(text) as T, ms: took, cache: r.headers.get('x-webable-cache') };
}

async function main(): Promise<void> {
  const { fetcher, mode } = await pickFetcher();
  console.log(`WebAble live check · ${mode}${fresh ? ' · fresh (cache skipped)' : ''}`);

  const health = await (await fetcher('/health')).json();
  console.log('\n/health', JSON.stringify(health));

  console.log(`\nPOST /v1/understand  (${FIXTURE_DIGEST.elements.length} elements)`);
  const u = await post<PageUnderstanding>(fetcher, '/v1/understand', { digest: FIXTURE_DIGEST });
  if (u) {
    const m = u.data.metrics;
    console.log(`  ${m.questions} decisions in ${m.calls} call(s) · wall ${ms(m.wallMs)} · server ${ms(m.serverMs)} · ${m.inputTokens} tokens · ${usd(m.costUsd)} · ${m.model}${u.data.cached ? ' · cached' : ''} · route ${ms(u.ms)}`);
    const again = await post<PageUnderstanding>(fetcher, '/v1/understand', { digest: FIXTURE_DIGEST });
    if (again) {
      const a = again.data;
      const fr = a.firstRead;
      console.log(`  same page again: ${a.cached ? 'from cache' : 'live'} · this view ${ms(a.metrics.wallMs)} ${usd(a.metrics.costUsd)} · ${a.metrics.calls} call(s)${fr ? ` · first read ${ms(fr.wallMs)} ${usd(fr.costUsd)}` : ''}`);
    }
    const main = u.data.mainPick;
    console.log(`  main action: ${main.id} (p ${p2(main.p)})`);
    for (const e of u.data.elements) {
      const label = FIXTURE_DIGEST.elements.find((d) => d.id === e.id)?.label.slice(0, 44) ?? '';
      console.log(`  ${e.id.padEnd(4)} ${e.role.padEnd(16)} ${p2(e.roleP)}  task ${p2(e.task)}  main ${p2(e.main)}  help ${p2(e.help)}  ${label}`);
    }
  }

  console.log('\nPOST /v1/struggle');
  const s = await post<StruggleJudgment>(fetcher, '/v1/struggle', { signals: FIXTURE_SIGNALS });
  if (s) {
    const kinds = Object.entries(s.data.kinds)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${p2(v)}`)
      .join(' · ');
    console.log(`  level ${p2(s.data.level)} · ${kinds}`);
    console.log(`  ${s.data.metrics.questions} questions · ${ms(s.data.metrics.wallMs)} · ${usd(s.data.metrics.costUsd)}`);
  }

  if (!skip.has('redesign')) {
    console.log(`\nPOST /v1/redesign  (${FIXTURE_OUTLINE.nodes.length} outline nodes)`);
    const r = await post<RedesignResult & Partial<RedesignResponse>>(fetcher, '/v1/redesign', { outline: FIXTURE_OUTLINE, fit: FIXTURE_FIT, roles: FIXTURE_ROLES });
    if (r) {
      const d = r.data;
      const src = d.sources ? ` · sources heuristic ${d.sources.heuristic} local ${d.sources.local} ai ${d.sources.ai}` : '';
      console.log(`  ai ${d.ai ?? '-'}${src} · chosen ${d.chosen} · autoApply ${d.autoApply} · llm ${d.llm.model} ${ms(d.llm.ms)} ${usd(d.llm.costUsd)} · judge ${d.judge.questions} q ${ms(d.judge.wallMs)} ${usd(d.judge.costUsd)} · route ${ms(r.ms)} · cache ${r.cache ?? '-'}`);
      for (const c of d.candidates) {
        const open = c.spec.sections.filter((x) => x.state === 'open').length;
        const source = (c as { source?: string }).source ?? '-';
        console.log(`  ${source.padEnd(9)} ${c.name.padEnd(9)} easier ${p2(c.pEasier)} hides ${p2(c.pHides)} fit ${p2(c.fitScore)} composite ${p2(c.composite)} · ${c.spec.sections.length} sections (${open} open) · ${c.spec.form_steps.length} steps · primary ${c.spec.primary_action ?? '-'} · ${c.repairs.length} repairs`);
      }
    }
  }

  if (!skip.has('overlay')) {
    console.log('\nPOST /v1/overlay-close  (the self-opened chat panel, 3 buttons)');
    const o = await post<OverlayCloseResponse>(fetcher, '/v1/overlay-close', { overlay: FIXTURE_OVERLAY, candidates: FIXTURE_OVERLAY_BUTTONS }, [503]);
    if (o) {
      const d = o.data;
      console.log(`  pick ${d.pick} · fwd ${p2(d.pFwd)} rev ${p2(d.pRev)} side ${p2(d.sideEffect)} · accept ${d.accept}${d.skipped ? ` · skipped ${d.skipped}` : ''} · ${d.metrics.questions} q ${ms(d.metrics.wallMs)} ${usd(d.metrics.costUsd)}`);
    }
    const consent = await post<OverlayCloseResponse>(fetcher, '/v1/overlay-close', { overlay: { ...FIXTURE_OVERLAY, id: 'ov2', kind_hint: 'consent' }, candidates: FIXTURE_OVERLAY_BUTTONS }, [503]);
    if (consent) console.log(`  consent notice: pick ${consent.data.pick} · accept ${consent.data.accept} · skipped ${consent.data.skipped ?? '-'} · ${consent.data.metrics.calls} Jev calls`);
  }

  if (flag('visual')) {
    console.log('\nPOST /v1/verify-visual  (synthetic 1280x800 blocks; plumbing only)');
    const v = await post<VisualVerdict>(fetcher, '/v1/verify-visual', await fixtureVisual());
    if (v) {
      const d = v.data;
      console.log(`  rollback ${d.rollback} · controls ${p2(d.keepsControls)} · help ${p2(d.keepsHelp)} · clipped ${p2(d.clipped)} · faint ${p2(d.faint)} · main ${p2(d.mainVisible)}`);
      console.log(`  ${d.metrics.questions} q · ${ms(d.metrics.wallMs)} · ${d.metrics.inputTokens} tokens · ${usd(d.metrics.costUsd)}`);
    }
  }

  const stats = await (await fetcher('/v1/stats')).json();
  console.log('\n/v1/stats', JSON.stringify({ ai: stats.ai, jev: stats.jev, openai: { calls: stats.openai.calls, costUsd: stats.openai.costUsd, errors: stats.openai.errors }, totalUsd: stats.totalUsd }));
  console.log(failures ? `\n${failures} step(s) failed.` : '\nAll steps answered.');
  process.exit(failures ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error('live check crashed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
