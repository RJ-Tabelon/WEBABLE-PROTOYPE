#!/usr/bin/env node
// Round 9 live probe: two people (fixtures/maya.txt, fixtures/dan.txt) on real reading pages.
// Imports each AI answer through POST /v1/reader, fetches the pages (node fetch), takes their <p> paragraphs of
// 25+ words (links -> ⟦n⟧), scores them for each person and writes the picked ones in batches of 4.
// Run against a TEST server, never the shared one:
//   (cd apps/server && PORT=41742 npx tsx --env-file=../../.env src/index.ts) &
//   node scripts/reword/probe.mjs [--port 41742] [--fresh] [--pages irs,cnn,wiki] [--people maya,dan] [--quiet]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const PORT = Number(arg('port', '41742'));
if (PORT === 41741) {
  console.error('Use a test server (PORT=41742), not the shared one.');
  process.exit(1);
}
const BASE = `http://127.0.0.1:${PORT}`;
const FRESH = flag('fresh');
const QUIET = flag('quiet');
/** The pick rule skips paragraphs under REWORD_PICK.minWords (18); the probe sends the same ones. */
const MIN_WORDS = Number(arg('min', '18'));
/** --no-link-words sends paragraphs exactly as the RewordPara contract has them (markers only). */
const NO_LINK_WORDS = flag('no-link-words');

const PAGES = {
  irs: 'https://www.irs.gov/refunds',
  cnn: 'https://www.cnn.com/2026/10/24/health/gen-z-stare-wellness',
  wiki: 'https://en.wikipedia.org/wiki/Exposure_(photography)',
};
const pageIds = arg('pages', 'irs,cnn,wiki').split(',');
const people = arg('people', 'maya,dan').split(',');

async function post(path, body) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(FRESH ? { 'X-WebAble-Fresh': '1' } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`${path} ${res.status}: ${json.error} ${json.message ?? ''}`);
  return { json, ms };
}

/* ---------------------------- page extraction ---------------------------- */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

export function extractParas(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, '');
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim());
  const paras = [];
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    let n = 0;
    const linkTexts = [];
    const text = decode(
      m[1]
        .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (_, inner) => {
          const words = decode(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
          if (!words) return '';
          linkTexts.push(words);
          return `⟦${++n}⟧`;
        })
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/\s+/g, ' ')
      .trim();
    const words = text.replace(/⟦\d+⟧/g, ' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    if (words < MIN_WORDS) continue;
    if (paras.some((p) => p.text === text)) continue;
    paras.push({ id: `w${paras.length + 1}`, text: text.slice(0, 1_800), links: n, ...(NO_LINK_WORDS ? {} : { linkTexts }) });
    if (paras.length >= 40) break;
  }
  return { title, paras };
}

/* --------------------------------- run ---------------------------------- */

const log = (...a) => {
  if (!QUIET) console.log(...a);
};
const pct = (x) => (x == null ? '  - ' : `${Math.round(x * 100)}`.padStart(3) + '%');

const pages = {};
for (const id of pageIds) {
  const url = PAGES[id] ?? id;
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', Accept: 'text/html' } });
  const html = await res.text();
  const { title, paras } = extractParas(html);
  pages[id] = { url, host: new URL(url).hostname, title, paras };
  console.log(`page ${id}: ${res.status}, ${paras.length} paragraphs of ${MIN_WORDS}+ words, ${Math.round(performance.now() - t0)} ms`);
}

const summary = [];
for (const who of people) {
  const text = readFileSync(join(here, 'fixtures', `${who}.txt`), 'utf8');
  const { json: reader, ms: importMs } = await post('/v1/reader', { req: { text, source: 'ChatGPT' } });
  console.log(`\n=== ${who}: reader in ${importMs} ms (${reader.metrics?.model}, Jev ${reader.metrics?.jev?.wallMs} ms) level=${reader.level} length=${reader.length} shape=${reader.shape} answerFirst=${reader.answerFirst}`);
  console.log(`headline: ${reader.headline}`);
  for (const p of reader.points) console.log(`  ${p.id} ${p.kind.padEnd(8)} ${pct(p.support)}  ${p.says}   <- "${p.evidence.slice(0, 80)}"`);

  for (const id of pageIds) {
    const page = pages[id];
    if (!page.paras.length) continue;
    const pageInfo = { title: page.title, host: page.host, purpose: null };
    const { json: score, ms: scoreMs } = await post('/v1/reword/score', { req: { reader, page: pageInfo, paras: page.paras } });
    const picked = score.scores.filter((s) => s.pick);
    log(`\n--- ${who} on ${id}: score ${scoreMs} ms (server ${score.ms} ms, Jev ${score.jev.wallMs} ms, ${score.jev.calls} calls, ${score.jev.inputTokens} tok), picked ${picked.length}/${score.scores.length}`);
    for (const s of score.scores) {
      const para = page.paras.find((p) => p.id === s.id);
      const top = Object.entries(s.how).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).slice(0, 3).join(', ');
      log(`  ${s.id.padEnd(4)} need ${pct(s.need)}  ${(s.pick ?? '-').padEnd(11)} [${top}]  ${para.text.slice(0, 70)}`);
    }
    const batches = [];
    for (let i = 0; i < picked.length; i += 4) batches.push(picked.slice(i, i + 4));
    const writes = await Promise.all(
      batches.map((b) =>
        post('/v1/reword/write', {
          req: { reader, page: pageInfo, items: b.map((s) => ({ ...page.paras.find((p) => p.id === s.id), kind: s.pick })) },
        }),
      ),
    );
    const results = writes.flatMap((w) => w.json.results);
    for (const r of results) {
      const para = page.paras.find((p) => p.id === r.id);
      log(`\n  [${r.id} ${r.kind}] ${r.ok ? 'OK' : `FAILED (${r.reason})`} dropped ${pct(r.checks.dropped)} added ${pct(r.checks.added)} numbers ${r.checks.numbersKept} conditions ${r.checks.conditionWordsKept} links ${r.checks.linksKept}`);
      log(`    was: ${para.text}`);
      if (r.out) {
        log(`    now: ${r.out.lead}`);
        r.out.items.forEach((it, i) => log(`         ${r.out.ordered ? `${i + 1}.` : '•'} ${it}`));
      }
    }
    const batchMs = writes.map((w) => w.ms);
    const reasons = results.filter((r) => !r.ok).map((r) => r.reason);
    summary.push({
      who, page: id, paras: page.paras.length, picked: picked.length, ok: results.filter((r) => r.ok).length,
      failed: reasons.join(',') || '-', kinds: picked.map((s) => s.pick).join(','), scoreMs, writeMs: batchMs.join('/'), importMs,
    });
  }
}

console.log('\nSUMMARY');
console.table(summary);
