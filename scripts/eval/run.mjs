#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { ANSWER_KEY } from './answer-key.mjs';
import { buildBundles } from './lib/bundle.mjs';
import {
  attachWorld,
  blocked,
  declineConsent,
  dismissInterstitials,
  launch,
  openPage,
  quiet,
  restoreScale,
  setScale,
  settle,
  shot,
  watchers,
} from './lib/browser.mjs';
import { FIT_FONT, OUTPUT_ROOT } from './lib/paths.mjs';
import { planOnce } from './lib/planner.mjs';
import { startFixtureServer } from './lib/server.mjs';
import { Ledger } from './openai.mjs';
import {
  personas as buildPersonas,
  textOnly,
  TRIAGE_SWEEP,
} from './personas.mjs';
import { writeReport } from './report.mjs';
import { SITES } from './sites.mjs';

/**
 * WebAble v2 real-site evaluation (docs/10 §10).
 *
 *   node scripts/eval/run.mjs [--sites a,b] [--personas x,y] [--no-planner]
 *                             [--no-smoke] [--fresh-planner] [--budget 3.5]
 *                             [--out dir]
 *
 * For every page: load in installed Chrome (headless, 1440x900, en-US),
 * decline consent, settle, inject the bundles in a CDP isolated world, then
 * per persona: read + triage (timed), Tailor at the triaged page scale (CDP
 * device metrics reproduce browser zoom), Fit view from the heuristic spec,
 * and Fit view from the planner spec (one planner call per page, rendered
 * for every persona). Each Fit view is scored against the original page with
 * the docs/11 §4 restructure scorecard (fitview/metrics.ts, the same function
 * on both). Four pages get an interaction smoke test. Screenshots and raw
 * JSON go to the gitignored output folder with report.html and summary.json;
 * the scorecard is also printed. The OpenAI key is read from .env and never
 * printed.
 */

function parseArgs(argv) {
  const a = {
    sites: null,
    personas: null,
    planner: true,
    smoke: true,
    freshPlanner: false,
    budget: 3.5,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--sites') a.sites = next().split(',');
    else if (k === '--personas') a.personas = next().split(',');
    else if (k === '--no-planner') a.planner = false;
    else if (k === '--no-smoke') a.smoke = false;
    else if (k === '--fresh-planner') a.freshPlanner = true;
    else if (k === '--budget') a.budget = Number(next());
    else if (k === '--out') a.out = resolve(next());
    else if (k === '--help' || k === '-h') {
      console.log(
        'node scripts/eval/run.mjs [--sites a,b] [--personas x,y] [--no-planner] [--no-smoke] [--fresh-planner] [--budget 3.5] [--out dir]',
      );
      process.exit(0);
    } else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

const today = () => new Date().toISOString().slice(0, 10);
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

function rezoom(plan, z, core) {
  const ops = plan.ops
    .filter((p) => p.op !== 'page_zoom' || z > 1)
    .map((p) =>
      p.op === 'page_zoom'
        ? {
            ...p,
            level: core.zoomLevel(z),
            trace: { ...p.trace, level: core.zoomLevel(z) },
          }
        : p,
    );
  return { ...plan, zoom: z, ops };
}

const planOps = (plan) =>
  plan.ops.map((p) => ({ op: p.op, level: p.level, mode: p.mode }));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out ?? join(OUTPUT_ROOT, today());
  await mkdir(join(out, 'sites'), { recursive: true });
  await mkdir(join(out, 'frozen'), { recursive: true });
  const ledger = await new Ledger(
    join(OUTPUT_ROOT, 'openai-ledger.json'),
    args.budget,
  ).load();
  log(`output ${out}; OpenAI spent so far $${ledger.spent.toFixed(3)}`);

  const bundles = await buildBundles();
  const core = bundles.core;
  const personas = buildPersonas(core, args.personas);
  const font = (await readFile(FIT_FONT)).toString('base64');
  const fixtures = await startFixtureServer();
  const { browser, context } = await launch();
  const sites = SITES.filter((s) => !args.sites || args.sites.includes(s.id));

  const results = [];
  try {
    for (const site of sites) {
      log(`== ${site.id}`);
      const res = await runSite(site, {
        out,
        core,
        bundles,
        personas,
        sweepBase: textOnly(core),
        font,
        fixtures,
        context,
        ledger,
        args,
      });
      results.push(res);
      await writeFile(
        join(out, 'sites', site.id, 'result.json'),
        JSON.stringify(res, null, 1),
      );
      log(`   ${res.status}${res.blocked ? ` (${res.blocked})` : ''}`);
    }
  } finally {
    await browser.close().catch(() => undefined);
    await fixtures.close();
  }
  // Results of sites not re-run this time are kept (a partial re-run).
  const merged = [];
  for (const s of SITES) {
    const fresh = results.find((r) => r.id === s.id);
    if (fresh) merged.push(fresh);
    else {
      try {
        merged.push(
          JSON.parse(
            await readFile(join(out, 'sites', s.id, 'result.json'), 'utf8'),
          ),
        );
      } catch {
        // never run
      }
    }
  }
  await writeReport(out, merged, {
    personas: personas.map((p) => ({ id: p.id, label: p.label })),
    ledger: { spent: ledger.spent, calls: ledger.calls, budget: ledger.budget },
    versions: {
      skeleton: core.SKELETON_VERSION,
      compose: core.COMPOSE_SCHEMA_VERSION,
      model: core.COMPOSE_PINNED_MODEL,
      triage: core.TRIAGE_VERSION,
      solver: core.FIT_SOLVER_VERSION,
    },
  });
  log(
    `report ${join(out, 'report.html')}; OpenAI spent $${ledger.spent.toFixed(3)}`,
  );
}

// ---------------------------------------------------------------------------

async function loadSite(site, page, ctx) {
  let url = site.local ? `${ctx.fixtures.origin}/${site.local}` : site.url;
  if (site.resolve) url = await site.resolve(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(site.local ? 300 : 2500);
  if (site.setup) await site.setup(page);
  const consent = await declineConsent(page);
  const interstitial = await dismissInterstitials(page);
  return { url, consent, interstitial };
}

async function runSite(site, ctx) {
  const { out, core, bundles, personas } = ctx;
  const dir = join(out, 'sites', site.id);
  await mkdir(dir, { recursive: true });
  const res = {
    id: site.id,
    label: site.label,
    url: site.url ?? site.local,
    smoke: !!site.smoke,
    status: 'ok',
    startedAt: new Date().toISOString(),
    personas: {},
    notes: [],
  };
  const { page, cdp } = await openPage(ctx.context, bundles);
  try {
    const loaded = await loadSite(site, page, ctx);
    res.resolvedUrl = loaded.url;
    res.consent = [loaded.consent];
    res.interstitial = loaded.interstitial;
    const why = await blocked(page);
    if (why) {
      res.status = 'blocked';
      res.blocked = why;
      await shot(cdp, join(dir, 'blocked.jpg')).catch(() => undefined);
      return res;
    }
    res.settle = await settle(page);
    if (loaded.consent === 'none') res.consent.push(await declineConsent(page));
    res.finalUrl = page.url();
    const w = await attachWorld(cdp, bundles.entry);
    res.firewall = await w.call('firewall');
    await w.call('scrollTop');
    await shot(cdp, join(dir, 'before.jpg'));
    res.prepare = await w.call('prepare');

    // The planner's skeleton, read once at 100% (the spec is person-independent).
    const ps = await w.call('plannerSkeleton');
    let plannerP = null;
    // The planner spec, stored once (as locators) and re-bound for every render.
    const st = { stored: null };
    if (ps.ok) {
      res.skeleton = {
        readMs: ps.readMs,
        readBusyMs: ps.readBusyMs,
        nodes: ps.nodes,
        truncated: ps.truncated,
        wireError: ps.wireError,
        heuristic: ps.heuristic.validated,
        heuristicMs: {
          spec: ps.heuristic.specMs,
          validate: ps.heuristic.validateMs,
        },
      };
      const key = ANSWER_KEY[site.id];
      const resolved = key ? await w.call('resolveKey', key.select) : null;
      await writeFile(
        join(out, 'frozen', `${site.id}.json`),
        JSON.stringify({
          id: site.id,
          url: res.finalUrl,
          capturedAt: new Date().toISOString(),
          skeleton: ps.skeleton,
          context: ps.context,
          wire: ps.wire,
          key: key ? { ...key, ids: resolved } : null,
        }),
      );
      res.keyResolved = resolved;
      await writeFile(
        join(dir, 'label-outline.txt'),
        await w.call('labelOutline', 7),
      );
      if (ctx.args.planner && ps.wire)
        plannerP = planOnce(core, ps.wire, {
          ledger: ctx.ledger,
          cacheDir: ctx.args.freshPlanner
            ? null
            : join(OUTPUT_ROOT, 'planner-cache'),
        }).catch((e) => ({ ok: false, stage: 'error', error: String(e) }));
    } else {
      res.skeleton = { ok: false, why: ps.why };
      res.notes.push(`skeleton: ${ps.why}`);
    }

    let first = true;
    for (const p of personas) {
      log(`   ${p.id}`);
      try {
        res.personas[p.id] = await runPersona(
          { site, page, cdp, w, dir, persona: p, first, plannerP, st },
          ctx,
        );
      } catch (e) {
        res.personas[p.id] = { error: String(e.message ?? e).slice(0, 400) };
        res.notes.push(`${p.id}: ${String(e.message ?? e).slice(0, 200)}`);
        await restoreScale(cdp).catch(() => undefined);
        await w.call('closeFitView').catch(() => undefined);
        await w.call('undoAll').catch(() => undefined);
      }
      first = false;
    }
    if (plannerP) {
      const pl = await plannerP;
      res.planner = {
        stored: st.stored,
        ok: pl.ok,
        stage: pl.stage,
        check: pl.check ?? null,
        call: pl.call ?? null,
        meta: pl.meta ?? null,
        input: pl.input ?? null,
        spec: pl.spec
          ? {
              page_type: pl.spec.page_type,
              primary_task: pl.spec.primary_task,
              sections: pl.spec.sections.length,
              collections: pl.spec.collections.length,
            }
          : null,
      };
      if (pl.outline)
        await writeFile(join(dir, 'planner-outline.txt'), pl.outline);
      if (pl.spec)
        await writeFile(
          join(dir, 'planner-spec.json'),
          JSON.stringify(pl.spec, null, 1),
        );
    }
    if (site.smoke && ctx.args.smoke) {
      log('   smoke');
      try {
        res.smoke = await smoke({ site, page, cdp, w, dir }, ctx);
      } catch (e) {
        res.smoke = { error: String(e.message ?? e).slice(0, 400) };
      }
    }
  } catch (e) {
    res.status = 'error';
    res.error = String(e.stack ?? e).slice(0, 800);
    await shot(cdp, join(dir, 'error.jpg')).catch(() => undefined);
  } finally {
    res.finishedAt = new Date().toISOString();
    await page.close().catch(() => undefined);
  }
  return res;
}

async function runPersona(s, ctx) {
  const { page, cdp, w, dir, persona, first, plannerP, st } = s;
  const { core } = ctx;
  const pr = {};
  await restoreScale(cdp);
  await w.call('scrollTop');

  // Read: extraction + triage + plan, timed.
  const r = await w.call(
    'read',
    persona.profile,
    first ? TRIAGE_SWEEP : [],
    ctx.sweepBase,
  );
  pr.read = {
    perf: r.perf,
    verdict: r.verdict,
    plan: { zoom: r.plan.zoom ?? 1, ops: planOps(r.plan) },
  };
  // The original page's scorecard (docs/11 §4), as the person meets it.
  pr.original = await w.call(
    'measureOriginal',
    persona.profile.vision.textMinPx.value,
    persona.profile.motor.minTargetPx.value,
  );
  if (first) {
    pr.signals = r.signals;
    pr.pageSignals = r.pageSignals;
    pr.sweep = r.sweep;
  }

  // Tailor at the triaged page scale, with the worker's zoom guard.
  pr.snapB = await w.call('snapshot', 'B', 1);
  const nav = r.signals.layout?.nav;
  const baseline = nav
    ? { links: nav.primaryLinks, search: nav.searchVisible }
    : null;
  let z = r.plan.zoom ?? 1;
  const trail = [];
  while (z > 1) {
    await setScale(cdp, z);
    await page.waitForTimeout(400);
    await quiet(page, 1200, 5000);
    const g = await w.call('guard');
    const verdict = core.guardVerdict({ zoom: z, ...g }, baseline);
    trail.push({ z, ...g, verdict });
    if (verdict === 'ok') break;
    z = core.stepDown(z);
    if (z <= 1) {
      await restoreScale(cdp);
      trail.push({ z: 1 });
    }
  }
  pr.zoom = { planned: r.plan.zoom ?? 1, applied: z, trail, baseline };
  const plan = z === (r.plan.zoom ?? 1) ? r.plan : rezoom(r.plan, z, core);
  await w.call('scrollTop');
  pr.snapZ = await w.call('snapshot', 'Z', z);
  const autoOps = plan.ops.filter((o) => o.mode === 'auto').length;
  if (autoOps > 0) {
    pr.tailor = await w.call('tailor', plan);
    await quiet(page, 1200, 5000);
    pr.tailor.changesLater = await w.call('changes');
  } else {
    pr.tailor = { applyMs: 0, changes: [], skipped: 'no automatic ops' };
  }
  await w.call('scrollTop');
  await page.waitForTimeout(300);
  pr.snapT = await w.call('snapshot', 'T', z);
  await shot(cdp, join(dir, `tailor-${persona.id}.jpg`));
  pr.metrics = {
    vsOriginal: await w.call('compare', 'B', 'T'),
    opsOnly: await w.call('compare', 'Z', 'T'),
    zoomOnly: await w.call('compare', 'B', 'Z'),
  };
  await w.call('undoAll');
  await restoreScale(cdp);
  await quiet(page, 1000, 4000);
  await w.call('scrollTop');

  // Fit view from the heuristic spec.
  pr.fitHeuristic = await fitView(s, ctx, 'heuristic');

  // Fit view from the planner spec (one call per page, rendered per persona).
  if (plannerP) {
    const pl = await plannerP;
    if (pl.ok && pl.spec && !st.stored)
      st.stored = await w.call('storePlannerSpec', pl.spec);
    if (st.stored?.ok) pr.fitPlanner = await fitView(s, ctx, 'planner');
    else
      pr.fitPlanner = {
        skipped: pl.ok ? `stored: ${st.stored?.why}` : `planner ${pl.stage}`,
      };
  }
  return pr;
}

async function fitView(s, ctx, source) {
  const { page, cdp, w, dir, persona } = s;
  await w.call('domSig', 'A');
  await page.waitForTimeout(1200);
  await w.call('domSig', 'B');
  const open = await w.call('openFitView', {
    profile: persona.profile,
    source,
    font: ctx.font,
  });
  if (!open.ok) return { open };
  await page.waitForTimeout(700);
  const metrics = await w.call('fitMetrics');
  // Fit view's scorecard against the original's (before any scrolling).
  const score = await w.call('measureView');
  metrics.records2 = await w.call(
    'recordFidelity',
    ANSWER_KEY[s.site.id]?.select.lists?.[0]?.title ?? null,
  );
  await shot(cdp, join(dir, `fv-${source}-${persona.id}.jpg`));
  await page.waitForTimeout(1300);
  const later = await w.call('fitMetrics');
  await w.call('scrollView');
  await page.waitForTimeout(500);
  await shot(cdp, join(dir, `fv-${source}-${persona.id}-2.jpg`));
  const close = await w.call('closeFitView');
  await page.waitForTimeout(300);
  await w.call('domSig', 'C');
  return {
    open,
    metrics,
    score,
    shift: {
      primaryTop: [metrics.primaryTop, later.primaryTop],
      scrollHeight: [metrics.scrollHeight, later.scrollHeight],
    },
    close,
    dom: {
      drift: await w.call('domDiff', 'A', 'B'),
      diff: await w.call('domDiff', 'B', 'C'),
    },
  };
}

// ---------------------------------------------------------------------------
// Interaction smoke (docs/10 §10 proxies and privacy rows)
// ---------------------------------------------------------------------------

async function waitFor(fn, ms = 3000, step = 150) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, step));
  }
}

const sameState = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The page went where the view's link pointed: same origin and path, and the
 * query of one is contained in the other (sites drop or add tracking
 * parameters on the way, as YouTube's `pp` does).
 */
function sameTarget(shown, landed) {
  try {
    const a = new URL(shown);
    const b = new URL(landed);
    if (a.origin !== b.origin || a.pathname !== b.pathname) return false;
    const sub = (x, y) =>
      [...x.searchParams].every(([k, v]) => y.searchParams.get(k) === v);
    return sub(a, b) || sub(b, a);
  } catch {
    return shown === landed;
  }
}

async function reopen(s, ctx) {
  const { page, cdp, site } = s;
  await loadSite(site, page, ctx);
  await quiet(page, 1500, 6000);
  const w = await attachWorld(cdp, ctx.bundles.entry);
  await w.call('prepare');
  const open = await w.call('openFitView', {
    profile: ctx.personas[0].profile,
    source: 'heuristic',
    font: ctx.font,
  });
  await page.waitForTimeout(700);
  return { w, open };
}

async function smoke(s, ctx) {
  const { page, cdp, dir } = s;
  let { w } = s;
  const out = { steps: [] };
  await restoreScale(cdp);
  await w.call('scrollTop');
  const open = await w.call('openFitView', {
    profile: ctx.personas[0].profile,
    source: 'heuristic',
    font: ctx.font,
  });
  out.open = open.ok ? 'ok' : open.why;
  if (!open.ok) return out;
  await page.waitForTimeout(700);
  await watchers(page, true);
  const startUrl = page.url();

  // 1. Type into the view's search field: the original input gets it, the page's key handlers don't.
  const sp = await w.call('pick', 'search');
  if (sp.ok) {
    await page.mouse.click(sp.x, sp.y);
    // Replace whatever the field mirrors (Amazon keeps the current query).
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('large print', { delay: 35 });
    const TYPED = 'large print';
    const st = await waitFor(async () => {
      const x = await w.call('chosenState');
      if (x.state?.value === TYPED) return x;
      const found = await w.call('inputsWith', TYPED);
      return found.length ? { ...x, found } : null;
    }, 2500);
    const after = st ?? (await w.call('chosenState'));
    const found = await w.call('inputsWith', TYPED);
    const view = await w.call('viewState');
    const wt = await watchers(page);
    out.steps.push({
      step: 'search',
      control: sp.label,
      original: sp.original,
      ok: after.state?.value === TYPED || found.length > 0,
      originalValue: after.state?.value ?? null,
      landedIn: found,
      viewNotices: view.notices ?? [],
      sheetRows: view.sheetRows ?? 0,
      leaks: wt.leaks,
      proxyFailed: after.proxyFailed,
    });
    await shot(cdp, join(dir, 'smoke-search.jpg'));
    // A person dismisses the mirrored suggestions before moving on (Escape
    // with no sheet open would close Fit view itself).
    if (view.sheetOpen) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const wt2 = await watchers(page);
      out.steps.at(-1).leaks = wt2.leaks;
      out.steps.at(-1).sheetClosed = !(await w.call('viewState')).sheetOpen;
    }
  } else out.steps.push({ step: 'search', ok: null, why: sp.why });

  // 2. A chip, tab or filter: the original reacts (state or navigation).
  const cp = await w.call('pick', 'chip');
  if (cp.ok) {
    await watchers(page, true);
    await page.mouse.click(cp.x, cp.y);
    const changed = await waitFor(async () => {
      if (page.url() !== startUrl) return { navigated: page.url() };
      const x = await w.call('chosenState');
      if (x.href !== startUrl) return { navigated: x.href, x };
      if (!sameState(x.state, cp.state)) return { state: x.state, x };
      // A menu or dialog the original opened: mirrored as a sheet, or a peek.
      const vs = await w.call('viewState');
      if (vs.sheetOpen) return { opened: `sheet (${vs.sheetRows} rows)`, x };
      if ((x.events ?? []).includes('peek')) return { opened: 'peek', x };
      return null;
    }, 3500);
    const wt = await watchers(page);
    out.steps.push({
      step: 'chip',
      control: cp.label,
      original: cp.original,
      before: cp.state,
      after: changed?.state ?? null,
      navigated: changed?.navigated ?? null,
      opened: changed?.opened ?? null,
      ok: !!changed,
      proxiedClicks: wt.proxied,
      leaks: wt.leaks,
      proxyFailed: changed?.x?.proxyFailed ?? [],
    });
    await shot(cdp, join(dir, 'smoke-chip.jpg')).catch(() => undefined);
    // Back from a peek (the view stepped aside for a site menu or dialog).
    const vs = await w.call('viewState').catch(() => null);
    if (vs?.peekBack) {
      await page.mouse.click(vs.peekBack.x, vs.peekBack.y);
      await page.waitForTimeout(700);
      out.steps.at(-1).peekBack = !(await w.call('viewState')).peeking;
    }
    if (changed?.navigated || page.url() !== startUrl) {
      ({ w } = await reopen(s, ctx));
    }
  } else out.steps.push({ step: 'chip', ok: null, why: cp.why });

  // 3. Record titles (or an article link): the original opens the record the
  // view showed. The second record checks that fields resolve per record.
  const titleSel = ANSWER_KEY[s.site.id]?.select.lists?.[0]?.title ?? null;
  for (const nth of [0, 1]) {
    const step = nth === 0 ? 'title' : 'title-2';
    if (nth === 1 && page.url() !== startUrl) ({ w } = await reopen(s, ctx));
    const tp = await w.call('pick', 'title', nth, titleSel);
    if (!tp.ok) {
      out.steps.push({ step, ok: null, why: tp.why });
      continue;
    }
    await watchers(page, true);
    const before = page.url();
    await page.mouse.click(tp.x, tp.y);
    const nav = await waitFor(
      async () => (page.url() !== before ? page.url() : null),
      6000,
    );
    const wt = await watchers(page);
    const tstate = await w.call('chosenState').catch(() => null);
    const byText = tp.truth
      ? wt.proxied.some((d) => d.includes(tp.truth.slice(0, 24)))
      : null;
    out.steps.push({
      step,
      control: tp.label,
      truth: tp.truth,
      original: tp.original,
      shownHref: tp.href,
      navigatedTo: nav,
      ok: !!nav,
      rightTarget:
        nav && tp.href
          ? sameTarget(tp.href, nav)
          : wt.proxied.length
            ? byText
            : null,
      proxyFailed: tstate?.proxyFailed ?? null,
      events: tstate?.events ?? null,
      proxiedClicks: wt.proxied,
      leaks: wt.leaks,
    });
    await page.waitForTimeout(1500);
    await shot(cdp, join(dir, `smoke-${step}.jpg`)).catch(() => undefined);
  }
  await w.call('closeFitView').catch(() => undefined);
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
