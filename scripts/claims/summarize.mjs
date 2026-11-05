#!/usr/bin/env node
// Claim numbers from one or more eval-harness runs (scripts/eval/run.mjs output). Read-only. Prints a table per run and
// writes claims-fit.json into each run folder.
//
//   node scripts/claims/summarize.mjs <run dir> [<run dir> ...] [--md out.md]
//
// The fit-rate definition (docs/CLAIMS.md, claim "fitted X of 50"):
//   loaded   the page answered (HTTP < 400) and WebAble's engine reported a phase
//   read     Jev answered for the page (phase understood or calm)
//   larger   the text change stayed on: the text zoom on screen is above 100% and the page_zoom change was not reversed
//   broken   anything WebAble left broken:
//              - more overlapping lines of text after than before (harness count, top of page and at the main task)
//              - the page scrolls sideways after (counted even when the site scrolled sideways before; noted apart)
//              - one of WebAble's own checks failed, was traced to one of its changes, and that change is still on
//                (by construction the verifier reverses every change it traces a failure to, so this is a guard)
//   caught   changes WebAble reversed itself after one of its checks failed and was traced to them. A failed page
//            column try is reversed and dropped from the ops list ("a failed try leaves no op behind"), so a traced
//            failure whose op is gone counts as caught. Column tries are counted apart: narrowing the page is a
//            deliberate try-and-widen search, not a mistake.
//   clean    larger AND NOT broken. "Zero broken" alone would be empty: reversing everything also scores zero.
//   strict   clean AND no more text spilling out of its box than before AND no failed check WebAble could not trace
//            to one change ("left as is": often the site changing by itself, but it could be ours)
//
// review.json (optional, in the run folder), written by a person after looking at the screenshots:
//   { "blocked": { "<site>": "why" } }   the "after" load showed a bot check or an error page, not the site: counted
//                                        as not loaded, whatever the numbers say
//
// Jev read time and cost: live reads of loaded pages only (the page's first read in the run's fresh profile is sent
// with noCache; a bot check or error page is a different, smaller page, so it is left out).
// A later cached view is replaced by its firstRead numbers (the live read it came from) and flagged.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { frac, median, percentile, wilson } from './lib.mjs';

const { values: opt, positionals: dirs } = parseArgs({ allowPositionals: true, options: { md: { type: 'string' } } });
if (!dirs.length) {
  console.error('usage: node scripts/claims/summarize.mjs <eval run dir> [...] [--md out.md]');
  process.exit(2);
}

const PHASES = new Set(['understood', 'calm']);

function siteRow(dir, r, review) {
  const slug = r.sheet?.slug ?? r.name;
  const f = path.join(dir, slug, 'report.json');
  const rep = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  const ops = Array.isArray(rep?.ops) ? rep.ops : [];
  const checks = Array.isArray(rep?.checks) ? rep.checks : [];
  const byId = new Map(ops.map((o) => [o.id, o]));
  const failed = checks.filter((c) => c && c.pass === false);
  const traced = failed.filter((c) => c.opId);
  const stillOn = (c) => { const o = byId.get(c.opId); return !!o && o.status !== 'reversed'; };
  const leftBroken = traced.filter(stillOn);
  const reversedIds = [...new Set(traced.filter((c) => !stillOn(c)).map((c) => c.opId))];
  const columnTries = reversedIds.filter((id) => /^column/.test(id) || byId.get(id)?.kind === 'column').length;
  const caught = reversedIds.length - columnTries;
  const untraced = failed.filter((c) => !c.opId);
  const stepBacks = (Array.isArray(rep?.ledger) ? rep.ledger : []).filter((l) => l.source === 'check' && l.action === 'skipped').length;

  const rd = r.reading ?? null;
  const textZoom = typeof rd?.zoom === 'number' ? rd.zoom : typeof r.tabZoom === 'number' ? r.tabZoom : null;
  // A reversed zoom is often followed by a smaller one that holds (150% made the page scroll sideways, 125% fits).
  const zoomOps = ops.filter((o) => o.kind === 'page_zoom');
  const zoomKept = zoomOps.length ? zoomOps.some((o) => o.status !== 'reversed') : textZoom != null && textZoom > 1.01;
  const zoomAttempted = zoomOps.length > 0;
  const larger = textZoom != null && textZoom > 1.01 && zoomKept;
  const overlapsBefore = rd?.overlaps?.before ?? null;
  const overlapsAfter = rd?.overlaps?.after ?? null;
  const overlapsAdded = overlapsAfter != null && overlapsBefore != null ? overlapsAfter > overlapsBefore : false;
  const sideways = !!rd?.overflow?.scroll;
  const beforeReading = r.firstScreen?.before?.reading;
  const sidewaysBefore = beforeReading && !beforeReading.error ? !!beforeReading.overflow?.scroll : null;
  const broken = leftBroken.length > 0 || overlapsAdded || sideways;
  const spillsAdded = rd?.spills?.added ?? 0;
  const strictBroken = broken || spillsAdded > 0 || untraced.length > 0;

  const u = rep?.understanding ?? null;
  let m = null;
  let readKind = null;
  if (u?.metrics?.calls > 0 && !u.cached) { m = u.metrics; readKind = 'live'; }
  else if (u?.cached && u.firstRead?.calls > 0) { m = u.firstRead; readKind = 'first read (cached view)'; }

  const status = r.status ?? null;
  const phase = r.phase ?? rep?.phase ?? null;
  const blocked = review?.blocked?.[r.name] ?? null;
  const loaded = phase != null && !(typeof status === 'number' && status >= 400) && !r.timedOut && !blocked;
  const read = PHASES.has(phase);
  const why = [];
  if (!loaded) why.push(blocked ? `blocked: ${blocked}` : r.timedOut ? 'timed out' : typeof status === 'number' && status >= 400 ? `HTTP ${status}` : 'no engine report');
  else {
    if (!read) why.push(`Jev did not answer (phase ${phase})`);
    if (!larger) {
      why.push(textZoom == null ? 'no zoom reading'
        : !zoomAttempted && textZoom <= 1.01 ? 'text not larger: WebAble did not try a zoom'
          : textZoom <= 1.01 ? `text not larger: every zoom tried was reversed (${zoomOps.length})` : 'zoom reversed');
    }
    if (leftBroken.length) why.push(`check failed and kept: ${[...new Set(leftBroken.map((c) => c.name))].join(', ')}`);
    if (overlapsAdded) why.push(`overlapping text ${overlapsBefore}→${overlapsAfter}`);
    if (sideways) why.push(`sideways scroll ${rd?.overflow?.px ?? '?'} px${sidewaysBefore ? ' (the site scrolled sideways before too)' : ''}`);
  }
  const strictWhy = [];
  if (spillsAdded > 0) strictWhy.push(`${spillsAdded} more text out of its box`);
  if (untraced.length) strictWhy.push(`untraced failed check: ${[...new Set(untraced.map((c) => c.name))].join(', ')}`);
  return {
    name: r.name,
    url: r.url,
    status,
    phase,
    loaded,
    read,
    textZoom,
    bodyBefore: rd?.body?.before ?? null,
    bodyScreenAfter: rd?.body?.screen ?? null,
    larger,
    zoomAttempted,
    zoomTries: zoomOps.map((o) => `${o.status}: ${o.reason ?? ''}`),
    leftBroken: leftBroken.map((c) => ({ name: c.name, opId: c.opId, detail: c.detail })),
    overlapsBefore,
    overlapsAfter,
    overlapsAdded,
    sideways,
    sidewaysBefore,
    broken,
    caught,
    columnTries,
    stepBacks,
    spillsAdded,
    untraced: untraced.map((c) => ({ name: c.name, detail: c.detail })),
    strict: loaded && larger && !strictBroken,
    strictWhy,
    opsApplied: ops.filter((o) => o.status === 'applied').length,
    opsReversed: ops.filter((o) => o.status === 'reversed').length,
    clean: loaded && larger && !broken,
    why,
    decisions: u?.decisions ?? null,
    jevMs: m?.wallMs ?? null,
    jevServerMs: m?.serverMs ?? null,
    jevUsd: m?.costUsd ?? null,
    jevTokens: m?.inputTokens ?? null,
    jevCalls: m?.calls ?? null,
    readKind,
    msToUnderstood: r.msToUnderstood ?? null,
  };
}

const fmtMs = (x) => (x == null ? '—' : `${Math.round(x)}`);
const fmtUsd = (x) => (x == null ? '—' : x.toFixed(4));
const pctRange = (k, n) => {
  const w = wilson(k, n);
  return w ? `${Math.round(w[0] * 100)}–${Math.round(w[1] * 100)}%` : '—';
};

const md = [];
const say = (s = '') => { console.log(s); md.push(s); };
const all = [];
for (const d of dirs) {
  const dir = path.resolve(d);
  const sum = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const reviewFile = path.join(dir, 'review.json');
  const review = existsSync(reviewFile) ? JSON.parse(readFileSync(reviewFile, 'utf8')) : null;
  const rows = (sum.results ?? []).map((r) => siteRow(dir, r, review));
  const n = rows.length;
  const loaded = rows.filter((x) => x.loaded);
  const live = loaded.filter((x) => x.jevMs != null);
  const agg = {
    run: path.basename(dir),
    dir,
    fit: sum.fit,
    browser: sum.browser,
    viewport: sum.viewport,
    dpr: sum.dpr,
    ext: sum.ext ?? null,
    ai: sum.ai ?? null,
    server: sum.server,
    durationMin: sum.durationMs ? Math.round(sum.durationMs / 6000) / 10 : null,
    attempted: n,
    loaded: loaded.length,
    read: loaded.filter((x) => x.read).length,
    larger: rows.filter((x) => x.loaded && x.larger).length,
    broken: rows.filter((x) => x.loaded && x.broken).length,
    clean: rows.filter((x) => x.clean).length,
    cleanOfLoaded: loaded.filter((x) => x.clean).length,
    strict: rows.filter((x) => x.strict).length,
    caught: rows.reduce((a, x) => a + x.caught, 0),
    sitesWithCatch: rows.filter((x) => x.caught > 0).length,
    columnTries: rows.reduce((a, x) => a + x.columnTries, 0),
    stepBacks: rows.reduce((a, x) => a + x.stepBacks, 0),
    sidewaysPreexisting: rows.filter((x) => x.sideways && x.sidewaysBefore).length,
    jev: {
      liveReads: live.length,
      firstReadFallbacks: live.filter((x) => x.readKind !== 'live').length,
      medianMs: median(live.map((x) => x.jevMs)),
      p90Ms: percentile(live.map((x) => x.jevMs), 90),
      maxMs: live.length ? Math.max(...live.map((x) => x.jevMs)) : null,
      minMs: live.length ? Math.min(...live.map((x) => x.jevMs)) : null,
      underHalfSecond: live.filter((x) => x.jevMs < 500).length,
      medianServerMs: median(live.map((x) => x.jevServerMs)),
      medianUsd: median(live.map((x) => x.jevUsd)),
      maxUsd: live.length ? Math.max(...live.map((x) => x.jevUsd ?? 0)) : null,
      totalUsd: live.reduce((a, x) => a + (x.jevUsd ?? 0), 0),
      medianDecisions: median(live.map((x) => x.decisions)),
      medianTokens: median(live.map((x) => x.jevTokens)),
      medianMsToDecisions: median(rows.map((x) => x.msToUnderstood)),
    },
  };
  all.push({ ...agg, rows });
  writeFileSync(path.join(dir, 'claims-fit.json'), `${JSON.stringify({ ...agg, rows }, null, 2)}\n`);

  say(`## ${agg.run}`);
  say(`fit ${agg.fit} · ${agg.browser} · ${agg.viewport?.width}×${agg.viewport?.height} @${agg.dpr}x · AI layouts ${agg.ai === false ? 'off' : 'on'} · ${agg.durationMin ?? '—'} min · ${agg.server}`);
  say();
  say('| site | loaded | Jev ms | $ | decisions | text zoom | larger | broken left | caught (+column tries) | clean | strict | why not |');
  say('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of rows) {
    say(`| ${x.name} | ${x.loaded ? 'yes' : 'NO'} | ${fmtMs(x.jevMs)}${x.readKind && x.readKind !== 'live' ? '*' : ''} | ${fmtUsd(x.jevUsd)} | ${x.decisions ?? '—'} | ${x.textZoom != null ? `${Math.round(x.textZoom * 100)}%` : '—'} | ${x.larger ? 'yes' : 'no'} | ${x.broken ? 'YES' : 'no'} | ${x.caught}${x.columnTries ? ` (+${x.columnTries})` : ''} | ${x.clean ? 'yes' : 'no'} | ${x.strict ? 'yes' : 'no'} | ${[...x.why, ...x.strictWhy.map((w) => `strict: ${w}`)].join('; ')} |`);
  }
  say();
  say(`Attempted ${n} · loaded ${frac(agg.loaded, n)} · loaded pages read by Jev ${frac(agg.read, agg.loaded)} · text larger on ${frac(agg.larger, agg.loaded)} of loaded`);
  say(`**Clean fit (larger, nothing left broken, no sideways scroll): ${frac(agg.clean, n)} of attempted (95% CI ${pctRange(agg.clean, n)}); ${frac(agg.cleanOfLoaded, agg.loaded)} of loaded.**`);
  say(`Strict (also no more text out of its box, no untraced failed check): ${frac(agg.strict, n)} of attempted.`);
  say(`Own changes reversed after a failed check: ${agg.caught} on ${agg.sitesWithCatch} sites, plus ${agg.columnTries} page-column tries widened or dropped, plus ${agg.stepBacks} element-level step-backs (click areas or headings kept at the site's size) · loaded sites left with something broken: ${agg.broken}${agg.sidewaysPreexisting ? ` (${agg.sidewaysPreexisting} of them already scrolled sideways before WebAble)` : ''}`);
  const j = agg.jev;
  say(`Jev, ${j.liveReads} live reads of loaded pages${j.firstReadFallbacks ? ` (${j.firstReadFallbacks} from a cached view's first read, marked *)` : ''}: median ${fmtMs(j.medianMs)} ms (p90 ${fmtMs(j.p90Ms)}, range ${fmtMs(j.minMs)}–${fmtMs(j.maxMs)}; ${frac(j.underHalfSecond, j.liveReads)} under 0.5 s) · median $${fmtUsd(j.medianUsd)} per read (max $${fmtUsd(j.maxUsd)}, total $${fmtUsd(j.totalUsd)}) · median ${j.medianDecisions ?? '—'} decisions, ${j.medianTokens ?? '—'} input tokens · page load to decisions applied: median ${fmtMs(j.medianMsToDecisions)} ms`);
  say();
}
if (opt.md) writeFileSync(path.resolve(opt.md), `${md.join('\n')}\n`);
