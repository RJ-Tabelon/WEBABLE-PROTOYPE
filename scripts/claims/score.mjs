#!/usr/bin/env node
// Score Jev (and optionally a GPT model) against blind human labels.
//
//   node scripts/claims/score.mjs --in <export dir> [--labels to-label.csv] [--pages pages-blind.csv] [--gpt <dir>/gpt-gpt-6-sol.csv]
//
// The labellers fill to-label.csv (y/n columns) and pages-blind.csv (main action label or "none") with WebAble OFF,
// without seeing jev.csv. Reports, for each model:
//   fold precision      folded elements that people say are ads / promos / teasers / popups
//   help kept           elements people say are help or contact that were NOT folded (must be 100%)
//   task kept           elements people say the main task needs that were NOT folded (must be 100%)
//   main action         Jev's main pick matches the person's (label match, or both "none"), and promoted ones only
//   calibration         Brier score and expected calibration error of P(ad/promo/teaser/popup) and P(help)
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readCsv } from './lib.mjs';

const { values: opt } = parseArgs({
  options: { in: { type: 'string', default: './export' }, labels: { type: 'string' }, pages: { type: 'string' }, gpt: { type: 'string' } },
});
const yes = (v) => /^\s*y/i.test(v ?? '');
const no = (v) => /^\s*n/i.test(v ?? '');
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const frac = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : 'n/a');
// Claim 7 ("when Jev says 90%, it is right about X% of the time") needs 200+ labelled rows and a clear gap.
const MIN_ROWS_FOR_CALIBRATION_CLAIM = 200;

function calib(pairs, bins = 5) {
  if (!pairs.length) return 'n/a';
  const brier = pairs.reduce((a, [p, y]) => a + (p - y) ** 2, 0) / pairs.length;
  let ece = 0;
  const table = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const inBin = pairs.filter(([p]) => (p >= lo && p < hi) || (b === bins - 1 && p === 1));
    if (!inBin.length) continue;
    const conf = inBin.reduce((a, [p]) => a + p, 0) / inBin.length;
    const acc = inBin.reduce((a, [, y]) => a + y, 0) / inBin.length;
    ece += (inBin.length / pairs.length) * Math.abs(conf - acc);
    table.push(`${lo.toFixed(1)}-${hi.toFixed(1)}: said ${conf.toFixed(2)}, true ${acc.toFixed(2)} (n=${inBin.length})`);
  }
  return `Brier ${brier.toFixed(3)}, ECE ${ece.toFixed(3)} over ${pairs.length}\n      ${table.join('\n      ')}`;
}

const labels = readCsv(opt.labels ?? path.join(opt.in, 'to-label.csv'));
const pagesHuman = readCsv(opt.pages ?? path.join(opt.in, 'pages-blind.csv'));
const pagesJev = readCsv(path.join(opt.in, 'pages-jev.csv'));
const models = { jev: readCsv(path.join(opt.in, 'jev.csv')) };
if (opt.gpt) models[path.basename(opt.gpt, '.csv')] = readCsv(opt.gpt);
const AD = 'ad_promo_teaser_or_popup (y/n)', HELP = 'help_or_contact (y/n)', TASK = 'needed_for_the_main_task (y/n)';
const labelled = labels.filter((l) => yes(l[AD]) || no(l[AD]));
console.log(`${labelled.length} labelled element rows on ${new Set(labelled.map((l) => l.page)).size} pages`);
if (labelled.length < MIN_ROWS_FOR_CALIBRATION_CLAIM) console.log(`(fewer than ${MIN_ROWS_FOR_CALIBRATION_CLAIM} rows: report the calibration numbers as early, not as a claim)`);

for (const [name, rows] of Object.entries(models)) {
  const key = (r) => `${r.page}|${r.id}`;
  const by = new Map(rows.map((r) => [key(r), r]));
  const joined = labelled.map((l) => ({ l, m: by.get(key(l)) })).filter((x) => x.m);
  // Rows carry WebAble's verdicts (jev-vs-gpt.mjs runs the same policy on GPT's probabilities). Older GPT files have
  // none: apply WebAble's fold rule to the probabilities (fold >= 0.90, task <= 0.20, help <= 0.10).
  const folded = (m) => (m.verdict ? m.verdict === 'fold' : Number(m.foldP) >= 0.9 && Number(m.task) <= 0.2 && Number(m.help) <= 0.1);
  const f = joined.filter((x) => folded(x.m));
  const helpRows = joined.filter((x) => yes(x.l[HELP]));
  const taskRows = joined.filter((x) => yes(x.l[TASK]));
  console.log(`\n== ${name}`);
  console.log(`  fold precision:  ${frac(f.filter((x) => yes(x.l[AD])).length, f.length)}`);
  console.log(`  help kept:       ${frac(helpRows.filter((x) => !folded(x.m)).length, helpRows.length)}`);
  console.log(`  task kept:       ${frac(taskRows.filter((x) => !folded(x.m)).length, taskRows.length)}`);
  console.log(`  P(ad/promo/popup) ${calib(joined.map((x) => [Number(x.m.foldP), yes(x.l[AD]) ? 1 : 0]))}`);
  console.log(`  P(help)           ${calib(joined.filter((x) => yes(x.l[HELP]) || no(x.l[HELP])).map((x) => [Number(x.m.help), yes(x.l[HELP]) ? 1 : 0]))}`);
}
const jm = new Map(pagesJev.map((p) => [p.page, p]));
const scored = pagesHuman.filter((p) => norm(p['main action (label, or none)']));
let ok = 0, promoted = 0, promotedOk = 0;
for (const p of scored) {
  const j = jm.get(p.page);
  const hit = norm(j?.jev_main) === norm(p['main action (label, or none)']);
  ok += hit ? 1 : 0;
  if (Number(j?.jev_main_p) >= 0.9 && norm(j?.jev_main) !== 'none') { promoted++; promotedOk += hit ? 1 : 0; }
}
console.log(`\nmain action (Jev pick = person's pick): ${frac(ok, scored.length)} · when p >= 0.90 (the ones WebAble outlines): ${frac(promotedOk, promoted)}`);
