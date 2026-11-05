#!/usr/bin/env node
// What leaves the laptop when Jev reads a page: scan the digests export-decisions.mjs saved (exactly what the content
// script hands the background for POST /v1/understand) for personal details and for anything about the person.
// The server (on this laptop) runs its own sanitizeDigest before calling Jev, so each digest is scanned twice: as the
// extension sends it, and as the server passes it on to Jev (what actually leaves the laptop).
//
//   node scripts/claims/privacy-scan.mjs <export dir> [--needles "Rosa,Atorvastatin,6214-0387"]
//
// Checks, per digest:
//   shape     only the PageDigest fields (v, page, elements, mainCandidates, hasSensitiveFields, lang) and, per element,
//             only ElementEvidence fields: no fit, settings, history, zoom levels or anything learned about the person
//   strings   every string (title, path, headings, labels, class words) through core's stillSensitive(): emails, links,
//             phone, card, ID and account numbers, street addresses, long numbers
//   person    no key or value that names the fit or the learning (bodyPx, fit, belief, passive, evidence, zoom factor)
//   needles   personal details known to be on the pages (the Alderra demo's patient name, drugs and Rx numbers) must
//             not appear anywhere in a digest
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, serverRequire } from './lib.mjs';

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { needles: { type: 'string', default: '' } } });
const dir = positionals[0];
const needles = opt.needles.split(',').map((x) => x.trim()).filter(Boolean);
if (!dir) {
  console.error('usage: node scripts/claims/privacy-scan.mjs <export dir>');
  process.exit(2);
}
const tsxApi = serverRequire.resolve('tsx/esm/api').replace(/index\.cjs$/, 'index.mjs');
const { tsImport } = await import(pathToFileURL(tsxApi).href);
const core = await tsImport(pathToFileURL(path.join(ROOT, 'packages/core/src/index.ts')).href, import.meta.url);
const server = await tsImport(pathToFileURL(path.join(ROOT, 'apps/server/src/sanitize.ts')).href, import.meta.url);

const TOP = new Set(['v', 'page', 'elements', 'mainCandidates', 'hasSensitiveFields', 'lang']);
const PAGE = new Set(['title', 'url_path', 'headings', 'landmarks', 'viewport', 'element_count']);
const EL = new Set(['id', 'tag', 'role_hint', 'label', 'zone', 'landmark', 'size', 'position', 'fixed', 'class_words', 'visual_weight', 'iframe_kind', 'link_target', 'text_chars', 'cards']);
const PERSON = /\b(bodyPx|fit|belief|beliefs|passive|evidence|steady|tremor|age|zoomFactor|defaultZoom|fontSize|settings|history)\b/i;

const files = readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('jev-vs-'));
let bad = 0;
for (const stage of ['sent by the extension', 'passed on to Jev by the server']) {
  let pages = 0;
  let strings = 0;
  let words = 0;
  const flagged = [];
  const shape = [];
  const person = [];
  const found = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(path.join(dir, f), 'utf8')).digest;
    if (!raw) continue;
    const digest = stage.startsWith('sent') ? raw : server.sanitizeDigest(raw).digest;
    pages++;
    for (const k of Object.keys(digest)) if (!TOP.has(k)) shape.push(`${f}: top-level "${k}"`);
    for (const k of Object.keys(digest.page ?? {})) if (!PAGE.has(k)) shape.push(`${f}: page."${k}"`);
    for (const e of digest.elements ?? []) for (const k of Object.keys(e)) if (!EL.has(k)) shape.push(`${f}: element."${k}"`);
    const texts = [
      ['title', digest.page?.title], ['url_path', digest.page?.url_path],
      ...(digest.page?.headings ?? []).map((h) => ['heading', h]),
      ...(digest.elements ?? []).flatMap((e) => [['label', e.label], ...(e.class_words ?? []).map((w) => ['class word', w])]),
    ];
    for (const [kind, s] of texts) {
      if (typeof s !== 'string' || !s) continue;
      strings++;
      words += s.split(/\s+/).filter(Boolean).length;
      if (core.stillSensitive(s)) flagged.push(`${f} ${kind}: "${s.slice(0, 60)}"`);
    }
    const json = JSON.stringify(digest);
    const keys = [...json.matchAll(/"([A-Za-z_]+)":/g)].map((m) => m[1]);
    for (const k of new Set(keys)) if (PERSON.test(k)) person.push(`${f}: key "${k}"`);
    const where = (n) => {
      const hits = [];
      const walk = (o, p) => {
        if (typeof o === 'string') { if (o.toLowerCase().includes(n.toLowerCase())) hits.push(p); return; }
        if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`);
      };
      walk(digest, 'digest');
      return hits;
    };
    for (const n of needles) {
      const hits = where(n);
      if (hits.length) found.push(`${f}: "${n}" at ${hits.slice(0, 3).join(', ')}`);
    }
  }
  console.log(`\n== ${stage}`);
  console.log(`${pages} digests · ${strings} strings (${words} words) checked`);
  console.log(`shape: ${shape.length ? `${shape.length} unexpected fields\n  ${shape.slice(0, 20).join('\n  ')}` : 'only page-structure fields'}`);
  console.log(`personal details still in a string: ${flagged.length}${flagged.length ? `\n  ${flagged.slice(0, 20).join('\n  ')}` : ''}`);
  console.log(`fields about the person or the fit: ${person.length}${person.length ? `\n  ${person.join('\n  ')}` : ''}`);
  if (needles.length) console.log(`known personal details found (${needles.length} looked for): ${found.length}${found.length ? `\n  ${found.join('\n  ')}` : ''}`);
  bad += flagged.length + person.length + shape.length + found.length;
}
process.exit(bad ? 1 : 0);
