#!/usr/bin/env node
// Sid's pilot: per-person numbers and the sign test, from the sheet he fills while running it (docs/CLAIMS.md, "Pilot").
//
//   node scripts/engine/claims/pilot-summary.mjs pilot.csv
//
// pilot.csv has one row per run (two per person), with this header:
//   participant,order,condition,seconds,presses,misses,near_misses,wrong
//     participant  P1..P8 (codes only; no names, no health questions)
//     order        on-first | off-first
//     condition    off | on
//     the rest     copied from the PILOT line pilot-logger.js prints when "Refill requested" appears
// Prints each person's off → on change and "N of M were faster", with a two-sided exact sign test (ties dropped).
import { existsSync } from 'node:fs';
import { median, readCsv, signTest } from './lib.mjs';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error(
    'usage: node scripts/engine/claims/pilot-summary.mjs pilot.csv   (header: participant,order,condition,seconds,presses,misses,near_misses,wrong)',
  );
  process.exit(2);
}
const rows = readCsv(file).map((r) => ({
  participant: String(r.participant ?? '').trim(),
  order: String(r.order ?? '').trim(),
  condition: String(r.condition ?? '')
    .trim()
    .toLowerCase(),
  seconds: Number(r.seconds),
  presses: Number(r.presses),
  misses: Number(r.misses),
  nearMisses: Number(r.near_misses),
  wrong: Number(r.wrong),
}));
const people = [...new Set(rows.map((r) => r.participant).filter(Boolean))];
const paired = [];
for (const p of people) {
  const off = rows.find((r) => r.participant === p && r.condition === 'off');
  const on = rows.find((r) => r.participant === p && r.condition === 'on');
  if (
    !off ||
    !on ||
    !Number.isFinite(off.seconds) ||
    !Number.isFinite(on.seconds)
  ) {
    console.log(`${p}: needs one "off" and one "on" row with seconds; skipped`);
    continue;
  }
  paired.push({ p, order: off.order || on.order, off, on });
}
const n = paired.length;
if (!n) {
  console.log('No complete pairs yet.');
  process.exit(0);
}
console.log(
  '| person | order | seconds off → on | misses off → on | wrong presses off → on |',
);
console.log('|---|---|---|---|---|');
for (const x of paired) {
  console.log(
    `| ${x.p} | ${x.order} | ${x.off.seconds} → ${x.on.seconds} | ${x.off.misses} → ${x.on.misses} | ${x.off.wrong} → ${x.on.wrong} |`,
  );
}
/** "k of n" for a paired comparison where lower is better, with ties dropped for the sign test. */
const compare = (key) => {
  const better = paired.filter((x) => x.on[key] < x.off[key]).length;
  const worse = paired.filter((x) => x.on[key] > x.off[key]).length;
  const p = signTest(better, better + worse);
  return { better, worse, ties: n - better - worse, p };
};
const t = compare('seconds');
const m = compare('misses');
const w = compare('wrong');
const fmtP = (p) => (p == null ? 'n/a' : p < 0.001 ? '< 0.001' : p.toFixed(3));
console.log();
console.log(
  `${t.better} of ${n} were faster with WebAble on (${t.worse} slower, ${t.ties} the same; sign test p = ${fmtP(t.p)}).`,
);
console.log(
  `${m.better} of ${n} missed less (${m.worse} more, ${m.ties} the same; p = ${fmtP(m.p)}). ${w.better} of ${n} made fewer wrong presses (${w.worse} more; p = ${fmtP(w.p)}).`,
);
console.log(
  `Median seconds: off ${median(paired.map((x) => x.off.seconds))}, on ${median(paired.map((x) => x.on.seconds))}. Median misses: off ${median(paired.map((x) => x.off.misses))}, on ${median(paired.map((x) => x.on.misses))}.`,
);
const firstRun = paired.map((x) =>
  x.order === 'on-first'
    ? x.on.seconds - x.off.seconds
    : x.off.seconds - x.on.seconds,
);
console.log(
  `Order check: the first run was slower than the second for ${firstRun.filter((d) => d > 0).length} of ${n} (practice effect; the swapped order balances it).`,
);
console.log(
  'Say it as counts ("7 of 8 were faster"), never as a percentage improvement for "people with" anything: the limit was situational.',
);
