#!/usr/bin/env node
// Passive fit, simulated through the shipped code: simulated clickers feed page views into core's addEvidence and
// buildPassiveState (packages/core/src/fit/passive.ts) and we read the action WebAble would take for "bigger click
// areas". Simulated people, not people: quote these numbers as a simulation.
//
//   node scripts/claims/sim-passive.mjs [--runs 2000] [--runs-a 1000] [--seed 7] [--json out.json]
//
// A. The brief's table (signals.md §4), one browsing day: 1,000 clicks, 40 per page view, 5 sites in turn. Read twice:
//    after every click (the page's running, capped total replaces its record each time, as the brief's script reads
//    it: this checks the shipped rules reproduce the brief) and once per finished page view (fewer, later offers).
//    What it can show: how soon an offer comes; that nothing turns on by default from one day.
// B. Two weeks of ordinary browsing: 14 days, 4 page views a day of 25 clicks each, on 3 of 8 sites, read once per
//    finished page view.
//    Clickers: misses 28.3% (Hurst 2008, people who need help pointing), 6.3% (typical), 15% (borderline), and a
//    typical clicker with one bad day (25% on day 3).
// Miss rates per click are the only input; nothing about the person is simulated or kept.
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, median, serverRequire } from './lib.mjs';

const { values: opt } = parseArgs({
  options: { runs: { type: 'string', default: '2000' }, 'runs-a': { type: 'string', default: '1000' }, seed: { type: 'string', default: '7' }, json: { type: 'string' } },
});
const RUNS = Math.max(50, Number(opt.runs) || 2000);
const RUNS_A = Math.max(50, Number(opt['runs-a']) || 1000);

const tsxApi = serverRequire.resolve('tsx/esm/api').replace(/index\.cjs$/, 'index.mjs');
const { tsImport } = await import(pathToFileURL(tsxApi).href);
const core = await tsImport(pathToFileURL(path.join(ROOT, 'packages/core/src/index.ts')).href, import.meta.url);
for (const name of ['emptyPassiveStore', 'addEvidence', 'buildPassiveState', 'pageClickWeight']) {
  if (typeof core[name] !== 'function') throw new Error(`core has no ${name}(): the passive fit engine changed; update this script.`);
}

/** mulberry32: a small seeded generator, so every run of this script gives the same numbers. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIM = 'targets';
const SITES = ['cvs.com', 'cnn.com', 'irs.gov', 'target.com', 'wikipedia.org', 'weather.gov', 'chase.com', 'npr.org'];
const START = Date.UTC(2026, 9, 5, 13, 0, 0); // a Monday, 9 am Eastern
const DAY = 86_400_000;

/** A page view's clicks so far, as the record the content script would send (weight = the page's capped log-odds). */
function pageRecord(outcomes, site, t, id) {
  const misses = outcomes.filter(Boolean).length;
  return {
    dim: DIM, kind: 'clicks', weight: core.pageClickWeight(outcomes), what: `${misses} of ${outcomes.length} clicks landed beside a button`,
    site, at: new Date(t).toISOString(), layer: 'now', clicks: outcomes.length, misses, page: `view-${String(id).padStart(4, "0")}`,
  };
}

/**
 * Feed page views in order and read the belief after each page view, or after each click (`everyClick`: the page's
 * running total replaces its record each time). Returns when the first offer and the first default-on came.
 */
function simulate(rand, schedule, everyClick = false) {
  let store = core.emptyPassiveStore(new Date(START - DAY));
  let clicks = 0;
  const out = { offerAtClick: null, offerAtDay: null, applyAtClick: null, applyAtDay: null, askAtDay: null, finalP: null, finalAction: 'none' };
  const read = (pv, t) => {
    const b = core.buildPassiveState(store, { now: new Date(t + 1000), sessionStart: new Date(pv.dayStart).toISOString() }).beliefs[DIM];
    if (b.action === 'ask' && out.askAtDay == null) out.askAtDay = pv.day;
    if ((b.action === 'offer' || b.action === 'apply') && out.offerAtClick == null) { out.offerAtClick = clicks; out.offerAtDay = pv.day; }
    if (b.action === 'apply' && out.applyAtClick == null) { out.applyAtClick = clicks; out.applyAtDay = pv.day; }
    out.finalP = b.p;
    out.finalAction = b.action;
  };
  schedule.forEach((pv, i) => {
    const outcomes = [];
    for (let c = 0; c < pv.clicks; c++) {
      outcomes.push(rand() < pv.missRate);
      clicks += 1;
      if (everyClick || c === pv.clicks - 1) {
        const t = pv.t + c * 3000;
        store = core.addEvidence(store, [pageRecord(outcomes, pv.site, t, i)], new Date(t));
        read(pv, t);
      }
    }
  });
  return out;
}

function oneDay(missRate) {
  const sched = [];
  for (let i = 0; i < 25; i++) sched.push({ missRate, clicks: 40, site: SITES[i % 5], t: START + i * 120_000, dayStart: START - 3_600_000, day: 1 });
  return sched;
}

function twoWeeks(rand, missRateOn) {
  const sched = [];
  for (let d = 0; d < 14; d++) {
    const day0 = START + d * DAY;
    const sites = [...SITES].sort(() => rand() - 0.5).slice(0, 3);
    for (let k = 0; k < 4; k++) {
      sched.push({ missRate: missRateOn(d + 1), clicks: 25, site: sites[k % 3], t: day0 + k * 2 * 3_600_000, dayStart: day0 - 3_600_000, day: d + 1 });
    }
  }
  return sched;
}

const share = (xs, f) => xs.filter(f).length / xs.length;
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const results = { runs: RUNS, seed: Number(opt.seed), A: {}, B: {} };
const rand = rng(Number(opt.seed));

console.log(`A. One browsing day, 1,000 clicks (40 per page view, 5 sites), ${RUNS_A} runs, through core's passive engine`);
console.log('| clicker | read after | offered within 1,000 clicks | median clicks to the offer | on by default |');
console.log('|---|---|---|---|---|');
for (const [label, p] of [['misses 28.3%', 0.283], ['typical, 6.3%', 0.063], ['bad day, 10%', 0.1], ['borderline, 15%', 0.15]]) {
  for (const everyClick of [true, false]) {
    const rs = Array.from({ length: RUNS_A }, () => simulate(rand, oneDay(p), everyClick));
    const row = {
      offered: share(rs, (r) => r.offerAtClick != null),
      medianClicksToOffer: median(rs.map((r) => r.offerAtClick)),
      applied: share(rs, (r) => r.applyAtClick != null),
    };
    results.A[`${label}, read after each ${everyClick ? 'click' : 'page view'}`] = row;
    console.log(`| ${label} | each ${everyClick ? 'click' : 'page view'} | ${pct(row.offered)} | ${row.medianClicksToOffer ?? '—'} | ${pct(row.applied)} |`);
  }
}

console.log(`\nB. Two weeks, 4 page views a day of 25 clicks on 3 of 8 sites (1,400 clicks), ${RUNS} runs`);
console.log('| clicker | offered at some point | median day of the offer | on by default at some point | median day it turned on | asked once (0.4–0.7) | on by default at the end |');
console.log('|---|---|---|---|---|---|---|');
const people = [
  ['misses 28.3%', () => 0.283],
  ['typical, 6.3%', () => 0.063],
  ['borderline, 15%', () => 0.15],
  ['typical with one bad day (25% on day 3)', (d) => (d === 3 ? 0.25 : 0.063)],
];
for (const [label, f] of people) {
  const rs = Array.from({ length: RUNS }, () => simulate(rand, twoWeeks(rand, f)));
  const row = {
    offered: share(rs, (r) => r.offerAtDay != null),
    medianOfferDay: median(rs.map((r) => r.offerAtDay)),
    applied: share(rs, (r) => r.applyAtDay != null),
    medianApplyDay: median(rs.map((r) => r.applyAtDay)),
    asked: share(rs, (r) => r.askAtDay != null),
    onAtEnd: share(rs, (r) => r.finalAction === 'apply'),
  };
  results.B[label] = row;
  console.log(`| ${label} | ${pct(row.offered)} | ${row.medianOfferDay ?? '—'} | ${pct(row.applied)} | ${row.medianApplyDay ?? '—'} | ${pct(row.asked)} | ${pct(row.onAtEnd)} |`);
}
if (opt.json) writeFileSync(path.resolve(opt.json), `${JSON.stringify(results, null, 2)}\n`);
