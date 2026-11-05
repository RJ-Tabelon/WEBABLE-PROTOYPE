#!/usr/bin/env node
// Round 10 live probe: the WebAble page as components, on real reading pages, for three readers (none, Maya, Dan).
// Starts its OWN test server (apps/server, PORT=--port, default 41763; never 41741 or 41742) and stops only that
// server at the end. Fetches each page (node fetch), splits its main content at headings into groups (<p>, <ul>/<ol>,
// <table>, <blockquote> -> units; links -> ⟦n⟧ + linkTexts; at most 10 units and 3,000 characters a group), imports
// each AI answer through POST /v1/reader (scripts/reword/fixtures) and posts every group to /v1/compose.
//   node scripts/compose/probe.mjs [--port 41763] [--fresh] [--pages irs,cnn,cfpb] [--people none,maya,dan]
//     [--groups 8] [--batch 1] [--quiet] [--server http://127.0.0.1:PORT (use a running test server)]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const PORT = Number(arg('port', '41763'));
if (PORT === 41741 || PORT === 41742) {
  console.error('Use a port of your own (41741 is the shared server, 41742 the usual test server).');
  process.exit(1);
}
const EXISTING = arg('server', null);
const BASE = EXISTING ?? `http://127.0.0.1:${PORT}`;
const FRESH = flag('fresh');
const QUIET = flag('quiet');
const MAX_GROUPS = Number(arg('groups', '8'));
const BATCH = Number(arg('batch', '1'));

const PAGES = {
  irs: 'https://www.irs.gov/refunds',
  cnn: 'https://www.cnn.com/2026/10/24/health/gen-z-stare-wellness',
  cfpb: 'https://www.consumerfinance.gov/ask-cfpb/what-is-a-credit-score-en-315/',
};
/** What Jev reads these pages as (the extension sends Jev's purpose; the probe does not ask Jev). */
const PURPOSE = { irs: 'info_guide', cnn: 'article', cfpb: 'faq' };
const pageIds = arg('pages', 'irs,cnn,cfpb').split(',');
const people = arg('people', 'none,maya,dan').split(',');

const log = (...a) => {
  if (!QUIET) console.log(...a);
};

/* ------------------------------ test server ------------------------------ */

let server = null;
async function startServer() {
  server = spawn('npx', ['tsx', '--env-file=../../.env', 'src/index.ts'], {
    cwd: join(root, 'apps', 'server'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so stopping it stops npx, tsx and the server under them (and nothing else).
    detached: true,
  });
  const lines = [];
  const keep = (d) => {
    for (const l of String(d).split('\n')) if (l.trim()) lines.push(l);
    if (lines.length > 400) lines.splice(0, lines.length - 400);
  };
  server.stdout.on('data', keep);
  server.stderr.on('data', keep);
  server.lines = lines;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
  }
  console.error(lines.slice(-20).join('\n'));
  throw new Error('test server did not start');
}
function stopServer() {
  if (!server || server.stopped) return;
  server.stopped = true;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
process.on('exit', stopServer);
process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});

async function post(path, body) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(FRESH ? { 'X-WebAble-Fresh': '1' } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`${path} ${res.status}: ${json.error} ${json.message ?? ''} ${JSON.stringify(json.details ?? '')}`);
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
const plain = (s) => decode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const wordCount = (s) => s.replace(/⟦\d+⟧/g, ' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

/** The main content: <main>, else <article>, else <body>, without scripts, navigation, forms and asides. */
function mainHtml(html) {
  let body = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? html;
  for (const tag of ['script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'figure', 'iframe']) {
    body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }
  return body;
}

export function extractGroups(html) {
  const title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const body = mainHtml(html);
  const groups = [];
  let cur = null;
  const open = (heading) => {
    cur = { heading, units: [], linkTexts: [], chars: 0 };
    groups.push(cur);
  };
  // Links -> ⟦n⟧, n counting from 1 in the group.
  const withMarkers = (inner) =>
    inner.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (_, a) => {
      const words = plain(a);
      if (!words) return '';
      cur.linkTexts.push(words);
      return `⟦${cur.linkTexts.length}⟧`;
    });
  const addUnit = (kind, build) => {
    if (!cur) open(null);
    // A full group starts a new one under the same heading (markers restart there).
    if (cur.units.length >= 10) open(cur.heading);
    let before = cur.linkTexts.length;
    let text = build().slice(0, 1_800);
    if (cur.units.length && cur.chars + text.length > 3_000) {
      cur.linkTexts.length = before;
      open(cur.heading);
      before = 0;
      text = build().slice(0, 1_800);
    }
    const kept = text.match(/⟦\d+⟧/g)?.length ?? 0;
    cur.linkTexts.length = before + kept; // markers cut off by the slice
    if (!text || wordCount(text) < (kind === 'para' ? 6 : 3)) {
      cur.linkTexts.length = before;
      return;
    }
    cur.units.push({ id: `u${cur.units.length + 1}`, kind, text });
    cur.chars += text.length;
  };
  const re = /<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>|<p\b[^>]*>([\s\S]*?)<\/p>|<(ul|ol)\b[^>]*>([\s\S]*?)<\/\4>|<table\b[^>]*>([\s\S]*?)<\/table>|<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi;
  for (const m of body.matchAll(re)) {
    if (m[1]) {
      const h = plain(m[2]);
      if (h) open(h);
    } else if (m[3] !== undefined) {
      addUnit('para', () => plain(withMarkers(m[3])));
    } else if (m[4]) {
      const items = [...m[5].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
      addUnit('list', () => items.map((li) => `• ${plain(withMarkers(li[1]))}`).filter((l) => l.length > 2).join('\n'));
    } else if (m[6] !== undefined) {
      const rows = [...m[6].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
      addUnit('table', () =>
        rows
          .map((r) => [...r[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => plain(withMarkers(c[1]))).join(' | '))
          .filter((l) => l.replace(/[\s|]/g, ''))
          .join('\n'),
      );
    } else if (m[7] !== undefined) {
      addUnit('quote', () => plain(withMarkers(m[7])));
    }
  }
  return {
    title,
    groups: groups
      .filter((g) => g.units.length && wordCount(g.units.map((u) => u.text).join(' ')) >= 15)
      .slice(0, MAX_GROUPS)
      .map((g) => ({
        id: 'g' + createHash('sha1').update(JSON.stringify([g.heading, g.units, g.linkTexts])).digest('hex').slice(0, 12),
        heading: g.heading,
        units: g.units,
        linkTexts: g.linkTexts,
      })),
  };
}

/* ------------------------------- rendering ------------------------------- */

function render(blocks) {
  const out = [];
  const t = (x) => (x ? ` "${x}"` : '');
  const ic = (x) => (x ? ` <${x}>` : '');
  for (const b of blocks) {
    const src = `{${b.src.join(',')}}`;
    switch (b.k) {
      case 'prose': out.push(`PROSE ${src}: ${b.text.replace(/\n\n/g, ' ¶ ')}`); break;
      case 'keyfacts': out.push(`KEYFACTS${t(b.title)}${ic(b.icon)} ${src}`, ...b.rows.map((r) => `    ${r.label}${ic(r.icon)} = ${r.value}`)); break;
      case 'steps': out.push(`STEPS${t(b.title)} ${src}${b.lead ? ` lead: ${b.lead}` : ''}`, ...b.steps.map((s, i) => `    ${i + 1}. ${s.title}${s.detail ? ` -- ${s.detail}` : ''}`)); break;
      case 'stats': out.push(`STATS ${src}`, ...b.tiles.map((x) => `    [${x.label}${ic(x.icon)}] ${x.value}${x.note ? ` (${x.note})` : ''}`)); break;
      case 'compare': out.push(`COMPARE${t(b.title)} ${src}`, `    ${b.columns.join(' | ')}`, ...b.rows.map((r) => `    ${[r.label, ...r.cells].join(' | ')}`)); break;
      case 'callout': out.push(`CALLOUT/${b.tone}${ic(b.icon)} ${src} "${b.title}": ${b.text}`); break;
      case 'definitions': out.push(`DEFINITIONS${t(b.title)} ${src}`, ...b.items.map((d) => `    ${d.term}: ${d.meaning}`)); break;
      case 'quote': out.push(`QUOTE ${src} “${b.text}” — ${b.who}${b.role ? `, ${b.role}` : ''}`); break;
      case 'contact': out.push(`CONTACT${t(b.title)} ${src}`, ...b.rows.map((r) => `    ${r.kind} ${r.label}: ${r.value}`)); break;
      case 'points': out.push(`POINTS${t(b.title)} ${src}`, ...b.items.map((p) => `    •${ic(p.icon)} ${p.title}: ${p.text}`)); break;
      default: out.push(`?? ${JSON.stringify(b)}`);
    }
  }
  return out;
}

/* --------------------------------- run ---------------------------------- */

const pct = (x) => (x == null ? '  -' : `${Math.round(x * 100)}`.padStart(3) + '%');

if (!EXISTING) {
  const t0 = performance.now();
  await startServer();
  console.log(`test server on ${BASE} in ${Math.round(performance.now() - t0)} ms`);
}

try {
  const pages = {};
  for (const id of pageIds) {
    const url = PAGES[id] ?? id;
    const t0 = performance.now();
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', Accept: 'text/html' } });
    const html = await res.text();
    const { title, groups } = extractGroups(html);
    pages[id] = { url, host: new URL(url).hostname, title, groups };
    console.log(`page ${id}: ${res.status}, ${groups.length} groups (${groups.map((g) => g.units.length).join('/')} units), ${Math.round(performance.now() - t0)} ms`);
  }

  const summary = [];
  const allMs = [];
  for (const who of people) {
    let reader = null;
    if (who !== 'none') {
      const text = readFileSync(join(root, 'scripts', 'reword', 'fixtures', `${who}.txt`), 'utf8');
      const { json, ms } = await post('/v1/reader', { req: { text, source: 'ChatGPT' } });
      reader = json;
      console.log(`\n=== ${who}: reader in ${ms} ms, level=${reader.level} length=${reader.length} shape=${reader.shape} answerFirst=${reader.answerFirst}`);
    } else console.log('\n=== none: general reader');

    for (const id of pageIds) {
      const page = pages[id];
      if (!page.groups.length) continue;
      const pageInfo = { title: page.title, host: page.host, purpose: PURPOSE[id] ?? null };
      const batches = [];
      for (let i = 0; i < page.groups.length; i += BATCH) batches.push(page.groups.slice(i, i + BATCH));
      const answers = await Promise.all(batches.map((b) => post('/v1/compose', { req: { reader, page: pageInfo, groups: b } })));
      const results = answers.flatMap((a) => a.json.results.map((r) => ({ ...r, ms: a.ms, serverMs: a.json.ms })));
      log(`\n--- ${who} on ${id}: ${results.filter((r) => r.ok).length}/${results.length} groups as components`);
      const kinds = {};
      for (const r of results) {
        const g = page.groups.find((x) => x.id === r.id);
        const chars = g.units.reduce((n, u) => n + u.text.length, 0);
        allMs.push(r.serverMs);
        log(`\n  [${g.heading ?? '(no heading)'}] ${g.units.length} units, ${chars} chars, ${g.linkTexts.length} links -> ${r.ok ? 'OK' : `KEPT (${r.reason})`}  better ${pct(r.better)} dropped ${pct(r.checks.dropped)} added ${pct(r.checks.added)}  ${r.serverMs} ms`);
        const c = r.checks;
        log(`    was: ${g.units.map((u) => `[${u.id}] ${u.text.replace(/\n/g, ' / ')}`).join(' ').slice(0, 700)}`);
        if (!r.ok && r.blocks) log(`    checks: covered ${c.covered} numbers ${c.numbersKept} noNew ${c.noNewNumbers} links ${c.linksKept} quotes ${c.quotesKept}`);
        if (r.blocks) for (const line of render(r.blocks)) log(`    ${line}`);
        if (r.ok) for (const b of r.blocks) kinds[b.k === 'callout' ? `callout/${b.tone}` : b.k] = (kinds[b.k === 'callout' ? `callout/${b.tone}` : b.k] ?? 0) + 1;
      }
      const ms = results.map((r) => r.serverMs).sort((a, b) => a - b);
      summary.push({
        who, page: id, groups: results.length, ok: results.filter((r) => r.ok).length,
        kept: results.filter((r) => !r.ok).map((r) => r.reason).join(',') || '-',
        kinds: Object.entries(kinds).map(([k, n]) => `${k}:${n}`).join(' ') || '-',
        medMs: ms[Math.floor(ms.length / 2)], maxMs: ms[ms.length - 1],
      });
    }
  }
  console.log('\nSUMMARY');
  console.table(summary);
  const s = allMs.sort((a, b) => a - b);
  console.log(`server ms per request: median ${s[Math.floor(s.length / 2)]}, p90 ${s[Math.floor(s.length * 0.9)]}, max ${s[s.length - 1]} (batch ${BATCH})`);
  if (server) {
    const fails = server.lines.filter((l) => /compose retry|openai error|compose:/.test(l));
    console.log(`server log: ${server.lines.filter((l) => /compose retry/.test(l)).length} retries; ${fails.filter((l) => /openai error/.test(l)).length} model errors`);
    for (const l of fails.filter((l) => /openai error|compose:/.test(l)).slice(0, 5)) console.log('  ' + l.slice(0, 300));
  }
} finally {
  stopServer();
}
