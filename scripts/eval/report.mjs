#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Report for a real-site evaluation run: <out>/report.html (self-contained:
 * inline CSS, screenshots referenced relatively) and <out>/summary.json (the
 * docs/10 §10 gates and the docs/11 §4 restructure scorecard, computed from
 * every site's result.json). The scorecard is also printed: before → after
 * per page and persona, ✓/✗ against the targets for the persona's structure
 * level.
 *
 *   node scripts/eval/report.mjs <out>     re-render from saved results
 */

const GUARD_OVERFLOW_PX = 8;

/** Same origin and path; one query contained in the other (run.mjs sameTarget). */
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

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (x, d = 1) =>
  typeof x === 'number' && Number.isFinite(x)
    ? Math.round(x * 10 ** d) / 10 ** d
    : null;

function pct(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.min(
    v.length - 1,
    Math.max(0, Math.ceil((p / 100) * v.length) - 1),
  );
  return v[i];
}

// ---------------------------------------------------------------------------
// Gates (docs/10 §10)
// ---------------------------------------------------------------------------

function tally(rows, pass) {
  const evaluated = rows.filter((r) => pass(r) !== null);
  const failed = evaluated.filter((r) => pass(r) === false);
  return {
    evaluated: evaluated.length,
    passed: evaluated.length - failed.length,
    failed: failed.map((r) => r.key),
  };
}

const tiersMonotone = (t) => {
  const order = ['pageHeading', 'sectionHeading', 'title', 'body', 'meta'];
  const v = order.map((k) => t?.[k]?.px).filter((x) => typeof x === 'number');
  return v.every((x, i) => i === 0 || v[i - 1] >= x);
};

/** One row per site x persona, flattened for the gates. */
export function rowsOf(results) {
  const rows = [];
  for (const site of results) {
    if (site.status !== 'ok') continue;
    for (const [pid, p] of Object.entries(site.personas ?? {})) {
      if (!p || p.error) {
        rows.push({
          key: `${site.id}/${pid}`,
          site: site.id,
          persona: pid,
          error: p?.error ?? 'missing',
        });
        continue;
      }
      rows.push({
        key: `${site.id}/${pid}`,
        site: site.id,
        persona: pid,
        p,
        siteRes: site,
      });
    }
  }
  return rows;
}

export function computeGates(results) {
  const rows = rowsOf(results).filter((r) => !r.error);
  const tailored = rows.filter(
    (r) =>
      r.p.metrics &&
      (r.p.zoom?.applied > 1 ||
        (r.p.tailor?.changes ?? []).some((c) => c.status === 'applied')),
  );
  const fitH = rows.filter((r) => r.p.fitHeuristic?.metrics?.open);
  const fitP = rows.filter((r) => r.p.fitPlanner?.metrics?.open);
  const fits = [
    ...fitH.map((r) => ({
      ...r,
      f: r.p.fitHeuristic,
      src: 'heuristic',
      key: `${r.key}/heuristic`,
    })),
    ...fitP.map((r) => ({
      ...r,
      f: r.p.fitPlanner,
      src: 'planner',
      key: `${r.key}/planner`,
    })),
  ];
  const v = (r) => r.p.metrics.vsOriginal;

  const gates = {
    hierarchy: {
      tailor: tally(tailored, (r) => v(r).hierarchy.inversions === 0),
      tailorOpsOnly: tally(
        tailored,
        (r) => r.p.metrics.opsOnly.hierarchy.inversions === 0,
      ),
      tailorLocal: tally(tailored, (r) =>
        v(r).hierarchy.localInversions === undefined
          ? null
          : v(r).hierarchy.localInversions === 0,
      ),
      fitView: tally(fits, (r) => {
        const h = r.f.metrics.health;
        if (!h) return null;
        return (
          h.tiers.every((t) => t.ok) && tiersMonotone(r.f.metrics.layoutTiers)
        );
      }),
    },
    consistency: {
      templateSize: tally(tailored, (r) => v(r).consistency.broken === 0),
      rowHeights: tally(tailored, (r) => v(r).rows.broken === 0),
    },
    health: {
      tailorOverflow: tally(
        tailored,
        (r) => v(r).overflow.after <= v(r).overflow.before + GUARD_OVERFLOW_PX,
      ),
      tailorOverlap: tally(tailored, (r) => v(r).overlap.new === 0),
      tailorTruncation: tally(tailored, (r) => v(r).truncation.new === 0),
      zoomKeepsNav: tally(
        rows.filter((r) => (r.p.zoom?.planned ?? 1) > 1),
        (r) => (r.p.zoom.trail[0]?.verdict ?? 'ok') === 'ok',
      ),
      zoomKeepsNavAfterGuard: tally(
        rows.filter((r) => (r.p.zoom?.planned ?? 1) > 1),
        (r) => {
          const last = r.p.zoom.trail.at(-1);
          return !last || last.z === 1 || last.verdict === 'ok';
        },
      ),
      navVisibleAfterTailor: tally(
        tailored.filter((r) => (r.p.zoom?.applied ?? 1) > 1),
        (r) => {
          const g = v(r).guard;
          return (
            g.after.navLinks >= g.before.navLinks &&
            (!g.before.searchVisible || g.after.searchVisible)
          );
        },
      ),
      guardBaselineMismatch: rows
        .filter(
          (r) =>
            r.p.zoom?.baseline &&
            r.p.snapB?.guard &&
            r.p.zoom.baseline.links !== r.p.snapB.guard.navLinks,
        )
        .map(
          (r) =>
            `${r.key}: layout.nav ${r.p.zoom.baseline.links} vs viewportGuard ${r.p.snapB.guard.navLinks}`,
        ),
      fitViewOverflow: tally(fits, (r) =>
        r.f.metrics.health ? r.f.metrics.health.overflowPx <= 1 : null,
      ),
      fitViewHealthOk: tally(fits, (r) =>
        r.f.metrics.health ? r.f.metrics.health.ok : null,
      ),
    },
    conservation: tally(fits, (r) =>
      r.f.metrics.conservation ? r.f.metrics.conservation.ok : null,
    ),
    targets: tally(fits, (r) =>
      r.f.metrics.health ? r.f.metrics.health.small === 0 : null,
    ),
    proxies: {
      allControlsBound: tally(
        fits,
        (r) => r.f.metrics.controls === r.f.metrics.bound,
      ),
    },
    records: {
      everyRecordTitled: tally(fits, (r) => {
        const x = r.f.metrics.records2;
        return x && x.rendered > 0 ? x.titled === x.rendered : null;
      }),
      titlesMatchPage: tally(fits, (r) => {
        const x = r.f.metrics.records2;
        return x && x.checked > 0 ? x.matched === x.checked : null;
      }),
    },
    ux: {
      primaryInFirstViewport: tally(fits, (r) =>
        r.f.metrics.primaryTop === null
          ? null
          : r.f.metrics.primaryTop < r.f.metrics.viewportH,
      ),
      noLayoutShift: tally(fits, (r) => {
        const s = r.f.shift;
        if (!s) return null;
        return Math.abs((s.primaryTop[0] ?? 0) - (s.primaryTop[1] ?? 0)) <= 1;
      }),
    },
    siteDom: tally(fits, (r) => {
      const d = r.f.dom?.diff;
      if (!d) return null;
      return Object.keys(d.sensitiveAttrs ?? {}).length === 0;
    }),
  };

  // Latency
  const readTriage = rows.map((r) =>
    r.p.read?.perf
      ? r.p.read.perf.extractBusyMs + r.p.read.perf.triageMs
      : null,
  );
  const firstRender = fitH.map((r) => r.p.fitHeuristic.open.ms.total);
  const firstRenderBusy = fitH.map((r) => {
    const m = r.p.fitHeuristic.open.ms;
    return m.readBusy + m.spec + m.validate + m.solve + m.open;
  });
  const cacheHit = fitP.map((r) => {
    const m = r.p.fitPlanner.open.ms;
    return m.spec + m.validate;
  });
  const cacheRender = fitP.map((r) => r.p.fitPlanner.open.ms.total);
  const planner = results
    .filter((s) => s.planner?.call && !s.planner.call.cached)
    .map((s) => s.planner.call.totalMs);
  gates.latency = {
    readTriageMs: {
      p50: pct(readTriage, 50),
      p95: pct(readTriage, 95),
      max: pct(readTriage, 100),
      over50: rows.filter((r, i) => readTriage[i] > 50).map((r) => r.key),
    },
    heuristicFirstRenderMs: {
      p50: pct(firstRender, 50),
      p95: pct(firstRender, 95),
      max: pct(firstRender, 100),
      over150: fitH.filter((r, i) => firstRender[i] > 150).map((r) => r.key),
      busyP50: num(pct(firstRenderBusy, 50)),
      busyP95: num(pct(firstRenderBusy, 95)),
    },
    plannerMs: {
      n: planner.length,
      p50: pct(planner, 50),
      p95: pct(planner, 95),
      max: pct(planner, 100),
    },
    cacheHitResolveMs: {
      p50: num(pct(cacheHit, 50), 2),
      p95: num(pct(cacheHit, 95), 2),
      max: num(pct(cacheHit, 100), 2),
    },
    cacheHitRenderMs: { p50: pct(cacheRender, 50), p95: pct(cacheRender, 95) },
  };

  // Smoke
  const steps = results.flatMap((s) =>
    (s.smoke?.steps ?? []).map((st) => ({
      ...st,
      site: s.id,
      // Recomputed from the stored hrefs (tracking parameters do not count).
      rightTarget:
        st.shownHref && st.navigatedTo
          ? sameTarget(st.shownHref, st.navigatedTo)
          : st.rightTarget,
    })),
  );
  const acted = steps.filter((s) => s.ok !== null && s.ok !== undefined);
  gates.smoke = {
    steps: steps.length,
    attempted: acted.length,
    effective: acted.filter((s) => s.ok).length,
    wrongTarget: steps
      .filter((s) => s.rightTarget === false)
      .map((s) => `${s.site}/${s.step}`),
    leaks: steps
      .filter((s) => (s.leaks ?? []).length > 0)
      .map((s) => `${s.site}/${s.step}: ${s.leaks.join(',')}`),
    notAttempted: steps
      .filter((s) => s.ok === null || s.ok === undefined)
      .map((s) => `${s.site}/${s.step}: ${s.why}`),
  };

  // Planner contract
  const pl = results.filter((s) => s.planner);
  gates.planner = {
    pages: pl.length,
    valid: pl.filter((s) => s.planner.ok).length,
    stages: Object.fromEntries(
      [...new Set(pl.map((s) => s.planner.stage))].map((k) => [
        k,
        pl.filter((s) => s.planner.stage === k).length,
      ]),
    ),
    untrustedSlotRepairs: pl.reduce(
      (n, s) =>
        n +
        (s.planner.stored?.validated?.repairs ?? []).filter(
          (r) => r === 'untrusted_slot',
        ).length,
      0,
    ),
    coverage: fitP
      .map((r) => r.p.fitPlanner.open.coverage)
      .filter((x) => x !== null),
  };

  // Triage sanity: the sweep per site
  gates.triage = results
    .filter((s) => s.status === 'ok')
    .map((s) => {
      const first = Object.values(s.personas ?? {}).find((p) => p?.sweep);
      return {
        site: s.id,
        bodyPx:
          first?.signals?.layout?.bodyPx ?? first?.signals?.mainFontPx ?? null,
        blockers: first?.read?.verdict?.blockers ?? [],
        sweep: first?.sweep ?? [],
      };
    });
  const at = (site, F) =>
    gates.triage.find((t) => t.site === site)?.sweep.find((x) => x.F === F)
      ?.verdict ?? null;
  gates.triageGovuk = ['govuk-passport', 'govuk-browse'].map((site) => ({
    site,
    F18: at(site, 18),
    F36: at(site, 36),
    pass: at(site, 18) === 'fits' && at(site, 36) === 'compose',
  }));
  return gates;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const CSS = `
:root{--ink:#1d2321;--muted:#5b6662;--line:#d9dfdc;--bg:#fbfcfb;--ok:#1f6f43;--bad:#a1260d;--warn:#8a5a00;--chip:#eef2f0}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:1500px;margin:0 auto;padding:24px 16px 80px}h1{font-size:26px;margin:0 0 4px}h2{font-size:21px;margin:40px 0 8px;padding-top:12px;border-top:2px solid var(--ink)}
h3{font-size:16px;margin:22px 0 6px}.muted{color:var(--muted)}table{border-collapse:collapse;margin:8px 0 14px;font-size:12.5px}
th,td{border:1px solid var(--line);padding:3px 7px;text-align:left;vertical-align:top}th{background:var(--chip)}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}.warn{color:var(--warn);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:8px 0}
.grid figure{margin:0}.grid img{width:100%;border:1px solid var(--line);display:block;background:#fff}
.grid figcaption{font-size:12px;color:var(--muted);margin-top:2px}.thumbs a{font-size:12px;margin-right:8px}
code{font-size:12px;background:var(--chip);padding:0 3px;border-radius:3px}.small{font-size:12px}
details{margin:6px 0}summary{cursor:pointer;color:var(--muted)}nav.toc a{margin-right:10px}
`;

const cls = (b) => (b === true ? 'ok' : b === false ? 'bad' : 'muted');
const yes = (b) => (b === true ? 'yes' : b === false ? 'no' : '–');
const pf = (t) =>
  `<span class="${t.failed.length ? 'bad' : 'ok'}">${t.passed}/${t.evaluated}</span>`;

function img(site, file, caption) {
  return `<figure><a href="sites/${esc(site)}/${esc(file)}"><img loading="lazy" src="sites/${esc(site)}/${esc(file)}" alt="${esc(caption)}"></a><figcaption>${esc(caption)}</figcaption></figure>`;
}

function opsCell(changes) {
  return (changes ?? [])
    .map(
      (c) =>
        `${esc(c.op)}:${c.status === 'applied' ? '<span class="ok">applied</span>' : c.status === 'undone_by_checks' ? `<span class="bad">rolled back (${esc(c.vcode)})</span>` : esc(c.status)}${c.fit ? ` ${esc(c.fit.before)}→${esc(c.fit.after)}` : ''}`,
    )
    .join('<br>');
}

function fitCell(f) {
  if (!f) return '–';
  if (!f.metrics)
    return `<span class="warn">${esc(f.skipped ?? f.open?.why ?? 'not rendered')}</span>`;
  const m = f.metrics;
  const o = f.open;
  return [
    `render ${num(o.ms.total)} ms (read ${num(o.ms.read)}, open ${num(o.ms.open)})${o.coverage !== null && o.coverage !== undefined ? `, coverage ${o.coverage}` : ''}`,
    `${esc(o.spec.page_type)} · primary ${esc(o.spec.sections[o.spec.primary]?.kind ?? '?')} · ${o.spec.sections.length} sections · ${o.spec.collections.length} collections · rest ${o.spec.rest}`,
    `records ${m.records} · controls ${m.controls} (bound ${m.bound}) · smallest ${m.smallestControlPx} px vs T ${m.T}`,
    m.records2?.rendered
      ? `primary records ${m.records2.rendered}: titled ${m.records2.titled}${m.records2.checked ? `, right title ${m.records2.matched}/${m.records2.checked}` : ''}${m.records2.mismatched?.length ? ` <span class="bad">${esc(m.records2.mismatched.join('; '))}</span>` : ''}`
      : '',
    `health <span class="${cls(m.health?.ok)}">${m.health?.ok ? 'ok' : esc((m.health?.failures ?? []).join(' '))}</span> · conservation <span class="${cls(m.conservation?.ok)}">${m.conservation?.ok ? 'ok' : `${m.conservation?.missing} missing`}</span>`,
    `primary at ${m.primaryTop} px of ${m.viewportH} · repairs ${esc((o.spec.repairs ?? []).join(', ') || 'none')}`,
    `tiers ${esc(
      Object.entries(m.layoutTiers ?? {})
        .map(([k, t]) => `${k[0]}${t.px}`)
        .join(' '),
    )}`,
    m.unbound?.length
      ? `<span class="bad">unbound: ${esc(m.unbound.join('; '))}</span>`
      : '',
    f.dom?.diff && Object.keys(f.dom.diff.sensitiveAttrs ?? {}).length
      ? `<span class="bad">site DOM attrs changed: ${esc(JSON.stringify(f.dom.diff.sensitiveAttrs))}</span>`
      : f.dom?.diff
        ? `site DOM diff ${f.dom.diff.added}+/${f.dom.diff.removed}− (idle drift ${f.dom.drift.added}+/${f.dom.drift.removed}−)`
        : '',
  ]
    .filter(Boolean)
    .join('<br>');
}

function personaBlock(site, pid, label, p) {
  if (!p) return '';
  if (p.error)
    return `<h3>${esc(label)}</h3><p class="bad">error: ${esc(p.error)}</p>`;
  const v = p.read?.verdict ?? {};
  const mo = p.metrics?.vsOriginal;
  const mops = p.metrics?.opsOnly;
  const z = p.zoom ?? {};
  const trail = (z.trail ?? [])
    .map(
      (t) =>
        `${t.z}×: ${t.verdict ?? ''} nav ${t.navLinks ?? ''} search ${yes(t.searchVisible)}`,
    )
    .join(' → ');
  const shots = `<div class="grid">
${img(site, 'before.jpg', 'before (100%)')}
${img(site, `tailor-${pid}.jpg`, `tailor (${z.applied ?? 1}×)`)}
${img(site, `fv-heuristic-${pid}.jpg`, 'Fit view, heuristic')}
${p.fitPlanner?.metrics ? img(site, `fv-planner-${pid}.jpg`, 'Fit view, planner') : `<figure><figcaption>planner: ${esc(p.fitPlanner?.skipped ?? 'not run')}</figcaption></figure>`}
</div><div class="thumbs"><a href="sites/${esc(site)}/fv-heuristic-${esc(pid)}-2.jpg">heuristic, scrolled</a>${p.fitPlanner?.metrics ? `<a href="sites/${esc(site)}/fv-planner-${esc(pid)}-2.jpg">planner, scrolled</a>` : ''}</div>`;
  const hier = (m) =>
    m
      ? `${m.hierarchy.inversions}${m.hierarchy.localInversions !== undefined ? ` [${m.hierarchy.localInversions} same screen]` : ''} (τmin ${m.hierarchy.tauMin})`
      : '–';
  return `<h3>${esc(label)}</h3>${shots}
<table><tr><th>triage</th><th>tailor</th><th>tailor checks (vs original · ops only)</th><th>Fit view, heuristic</th><th>Fit view, planner</th></tr>
<tr><td class="small">${esc(v.verdict)} · k ${v.k} · zoom ${v.zoom} (zMax ${v.zMax}) · residual ${v.residual}<br>needs ${esc(
    Object.entries(v.needs ?? {})
      .filter(([, b]) => b !== 'fits')
      .map(([n, b]) => `${n}:${b}`)
      .join(', ') || 'none',
  )}<br>representable ${yes(v.representable)} ${esc((v.blockers ?? []).join(', '))}<br>read ${num(p.read?.perf?.extractBusyMs)} ms + triage ${num(p.read?.perf?.triageMs, 2)} ms</td>
<td class="small">zoom ${z.planned}× → ${z.applied}×<br>${esc(trail)}<br>${opsCell(p.tailor?.changesLater ?? p.tailor?.changes)}</td>
<td class="small">${mo ? `inversions ${hier(mo)} · ${hier(mops)}<br>template sizes broken ${mo.consistency.broken}/${mo.consistency.groups} · rows ${mo.rows.broken}/${mo.rows.groups}<br>new truncation ${mo.truncation.new} · ${mops.truncation.new}<br>new overlap ${mo.overlap.new} · ${mops.overlap.new}<br>overflow ${mo.overflow.before}→${mo.overflow.after} px<br>nav links ${mo.guard.before.navLinks}→${mo.guard.after.navLinks}, search ${yes(mo.guard.before.searchVisible)}→${yes(mo.guard.after.searchVisible)}` : '–'}
${mo?.hierarchy.examples?.length ? `<details><summary>inversions</summary>${mo.hierarchy.examples.map(esc).join('<br>')}</details>` : ''}${mo?.consistency.examples?.length ? `<details><summary>template sizes</summary>${mo.consistency.examples.map(esc).join('<br>')}</details>` : ''}${mo?.truncation.examples?.length ? `<details><summary>truncation</summary>${mo.truncation.examples.map(esc).join('<br>')}</details>` : ''}${mo?.overlap.examples?.length ? `<details><summary>overlap</summary>${mo.overlap.examples.map(esc).join('<br>')}</details>` : ''}</td>
<td class="small">${fitCell(p.fitHeuristic)}</td><td class="small">${fitCell(p.fitPlanner)}</td></tr></table>`;
}

function siteBlock(s, personas) {
  const head = `<h2 id="${esc(s.id)}">${esc(s.label)} <span class="muted small">${esc(s.finalUrl ?? s.resolvedUrl ?? s.url)}</span></h2>`;
  if (s.status !== 'ok')
    return `${head}<p class="${s.status === 'blocked' ? 'warn' : 'bad'}">${esc(s.status)}: ${esc(s.blocked ?? s.error ?? '')}</p>${s.status === 'blocked' ? `<div class="grid">${img(s.id, 'blocked.jpg', 'what the browser got')}</div>` : ''}`;
  const first = Object.values(s.personas ?? {}).find((p) => p?.sweep);
  const sig = first?.signals ?? {};
  const L = sig.layout ?? {};
  const sweep = (first?.sweep ?? [])
    .map(
      (x) =>
        `<td class="small">${esc(x.verdict)}<br>k ${x.k} · ${x.zoom}×${x.representable ? '' : '<br>not repr.'}</td>`,
    )
    .join('');
  const sweepHead = (first?.sweep ?? [])
    .map((x) => `<th>F ${x.F}</th>`)
    .join('');
  const pl = s.planner;
  const plRow = pl
    ? `<p class="small">Planner (${esc(pl.call?.model ?? '')}, fast tier): ${pl.ok ? '<span class="ok">valid</span>' : `<span class="bad">${esc(pl.stage)}</span>`} · ${pl.call ? `${pl.call.totalMs} ms (first token ${pl.call.ttftMs} ms)${pl.call.cached ? ' cached' : ''} · tokens in ${pl.call.usage?.input} (cached ${pl.call.usage?.cached}) out ${pl.call.usage?.output} · $${pl.call.cost}` : ''} · wire ${pl.meta?.nodes} nodes, ${pl.meta?.bytes} B, outline ≈${pl.meta?.outlineTokens} tokens${pl.stored?.validated ? ` · ${esc(pl.stored.validated.page_type)}, ${pl.stored.validated.sections.length} sections, repairs: ${esc(pl.stored.validated.repairs.join(', ') || 'none')}` : ''}</p>`
    : '';
  const heur = s.skeleton?.heuristic;
  const smoke = s.smoke
    ? `<h3>Interaction smoke (heuristic Fit view, ${esc(personas[0]?.id ?? '')})</h3><table><tr><th>step</th><th>control</th><th>original</th><th>result</th><th>page saw</th></tr>${(
        s.smoke.steps ?? []
      )
        .map(
          (st) =>
            `<tr><td>${esc(st.step)}</td><td>${esc(st.control ?? '')}</td><td class="small">${esc(st.original ?? '')}</td><td class="${cls(st.ok)}">${st.ok === null || st.ok === undefined ? esc(st.why ?? 'not attempted') : st.ok ? 'took effect' : 'no effect'}${st.navigated || st.navigatedTo ? `<br><span class="small muted">→ ${esc(st.navigated ?? st.navigatedTo)}</span>` : ''}${st.originalValue !== undefined ? `<br><span class="small">value "${esc(st.originalValue)}"</span>` : ''}${(st.shownHref && st.navigatedTo ? sameTarget(st.shownHref, st.navigatedTo) : st.rightTarget) === false ? '<br><span class="bad">wrong target</span>' : ''}</td><td class="small">leaks ${esc((st.leaks ?? []).join(',') || 'none')}${st.proxiedClicks ? `<br>clicks: ${esc(st.proxiedClicks.join('; '))}` : ''}</td></tr>`,
        )
        .join(
          '',
        )}</table>${s.smoke.error ? `<p class="bad">${esc(s.smoke.error)}</p>` : ''}`
    : '';
  return `${head}
<p class="small">consent: ${esc((s.consent ?? []).join(' · '))} · category ${esc(sig.category)} · body ${L.bodyPx ?? sig.mainFontPx} px · records ${L.records?.count ?? '–'} (largest ${L.records?.largest ?? '–'}, main share ${num(L.records?.mainShare, 2)}) · readerable ${num(L.readerable)} · occlusion ${num(L.occlusion, 2)} · nav links ${L.nav?.primaryLinks} · skeleton ${s.skeleton?.nodes} nodes in ${s.skeleton?.readBusyMs} ms${s.skeleton?.truncated ? ' (truncated)' : ''}</p>
<table><tr><th>triage sweep</th>${sweepHead}</tr><tr><td class="small">verdict, k, zoom</td>${sweep}</tr></table>
<p class="small">Heuristic spec: ${heur ? `${esc(heur.page_type)} / ${esc(heur.primary_task)} · ${esc(heur.sections.map((x) => `${x.kind}${x.importance === 'primary' ? '*' : x.importance === 'fold' ? '(fold)' : ''}`).join(' '))} · collections ${esc(heur.collections.map((c) => c.item_kind).join(', '))}` : '–'}</p>
${plRow}
${personas.map((p) => personaBlock(s.id, p.id, p.label, s.personas?.[p.id])).join('\n')}
${smoke}
${(s.notes ?? []).length ? `<p class="warn small">notes: ${esc(s.notes.join(' · '))}</p>` : ''}`;
}

// ---------------------------------------------------------------------------
// Restructure scorecard (docs/11 §4)
// ---------------------------------------------------------------------------

/** Scorecard columns: metric key, short label. */
export const SCORE_METRICS = [
  ['itemsInView', 'items'],
  ['choicesInView', 'choices'],
  ['ownChoicesInView', 'own'],
  ['inlineLinks', 'inline'],
  ['textStyles', 'styles'],
  ['adsInView', 'ads'],
  ['moving', 'moving'],
  ['mainStartShare', 'main at'],
  ['maxGroup', 'group'],
  ['recordsBeforeMore', 'before more'],
  ['templateMismatches', 'template'],
  ['belowFloorText', '< F'],
  ['belowTargetControls', '< T'],
];

/**
 * One row per page × persona with a heuristic Fit view: before, after,
 * targets and which targets are met (conservation from the view's own
 * check). `met` counts the targets that apply at the persona's level.
 */
export function scorecard(results) {
  const rows = [];
  for (const s of results) {
    for (const [pid, p] of Object.entries(s.personas ?? {})) {
      const sc = p?.fitHeuristic?.score;
      if (!sc?.after) continue;
      const cons = p.fitHeuristic.metrics?.conservation?.ok ?? null;
      const m = { ...(sc.meets ?? {}), conservation: cons };
      const applied = Object.values(m).filter(
        (x) => x !== null && x !== undefined,
      );
      rows.push({
        site: s.id,
        persona: pid,
        level: sc.level,
        before: sc.before,
        after: sc.after,
        targets: sc.targets,
        meets: m,
        met: applied.filter(Boolean).length,
        of: applied.length,
        all: applied.every(Boolean),
      });
    }
  }
  const lvl2 = rows.filter((r) => r.level === 2);
  const perMetric = {};
  for (const [k] of [...SCORE_METRICS, ['conservation']]) {
    const xs = lvl2
      .map((r) => r.meets[k])
      .filter((x) => x !== null && x !== undefined);
    // Counts with no target (inline links) are reported, not scored.
    if (xs.length) perMetric[k] = `${xs.filter(Boolean).length}/${xs.length}`;
  }
  const allMet = lvl2.filter((r) => r.all).length;
  return {
    rows,
    level2: { pages: lvl2.length, allMet, perMetric },
    line: `level 2: ${allMet}/${lvl2.length} pages meet every target · ${Object.entries(
      perMetric,
    )
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}`,
  };
}

const fmt = (v) =>
  v === null || v === undefined
    ? '–'
    : typeof v === 'number'
      ? String(v)
      : String(v);
const mark = (b) => (b === true ? '✓' : b === false ? '✗' : ' ');

/** Plain-text scorecard for the console. */
export function scorecardText(sc) {
  const head = [
    'page',
    'persona',
    'L',
    ...SCORE_METRICS.map(([, l]) => l),
    'kept',
  ];
  const lines = sc.rows.map((r) => [
    r.site,
    r.persona,
    String(r.level),
    ...SCORE_METRICS.map(
      ([k]) => `${fmt(r.before?.[k])}→${fmt(r.after?.[k])}${mark(r.meets[k])}`,
    ),
    mark(r.meets.conservation),
  ]);
  const w = head.map((h, i) =>
    Math.max(h.length, ...lines.map((l) => (l[i] ?? '').length)),
  );
  const pad = (cells) => cells.map((c, i) => c.padEnd(w[i] ?? 0)).join('  ');
  return [pad(head), ...lines.map(pad), sc.line].join('\n');
}

function scorecardTable(sc) {
  if (!sc.rows.length)
    return '<p class="muted">No Fit view scorecards in this run.</p>';
  const head = `<tr><th>page</th><th>persona</th><th>level</th>${SCORE_METRICS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th>conservation</th><th>met</th></tr>`;
  const body = sc.rows
    .map(
      (r) =>
        `<tr><td><a href="#${esc(r.site)}">${esc(r.site)}</a></td><td>${esc(r.persona)}</td><td>${r.level}</td>${SCORE_METRICS.map(
          ([k]) =>
            `<td class="small ${cls(r.meets[k])}" title="target ≤ ${esc(fmt(r.targets?.[k]))}">${esc(fmt(r.before?.[k]))} → ${esc(fmt(r.after?.[k]))}</td>`,
        ).join(
          '',
        )}<td class="${cls(r.meets.conservation)}">${yes(r.meets.conservation)}</td><td class="${r.all ? 'ok' : 'warn'}">${r.met}/${r.of}</td></tr>`,
    )
    .join('');
  return `<p class="small">${esc(sc.line)}</p><table>${head}${body}</table>`;
}

function gatesTable(g) {
  const row = (name, target, cell, note = '') =>
    `<tr><td>${esc(name)}</td><td class="small">${esc(target)}</td><td>${cell}</td><td class="small">${note}</td></tr>`;
  const L = g.latency;
  return `<table><tr><th>gate</th><th>target</th><th>result</th><th>failing</th></tr>
${row('Hierarchy · Tailor', 'τ = 1 per region (0 inversions)', pf(g.hierarchy.tailor), esc(g.hierarchy.tailor.failed.join(', ')))}
${row('Hierarchy · Tailor ops only', 'ops after page scale', pf(g.hierarchy.tailorOpsOnly), esc(g.hierarchy.tailorOpsOnly.failed.join(', ')))}
${row('Hierarchy · Tailor, same screen', 'no inversion between texts within one screen height', pf(g.hierarchy.tailorLocal), esc(g.hierarchy.tailorLocal.failed.join(', ')))}
${row('Hierarchy · Fit view', 'tiers distinguishable, monotone', pf(g.hierarchy.fitView), esc(g.hierarchy.fitView.failed.join(', ')))}
${row('Consistency · template sizes', 'same field → same size', pf(g.consistency.templateSize), esc(g.consistency.templateSize.failed.join(', ')))}
${row('Consistency · row heights', 'rows in a template equal', pf(g.consistency.rowHeights), esc(g.consistency.rowHeights.failed.join(', ')))}
${row('Health · Tailor overflow', 'no new horizontal scroll', pf(g.health.tailorOverflow), esc(g.health.tailorOverflow.failed.join(', ')))}
${row('Health · Tailor overlap', 'no new overlap', pf(g.health.tailorOverlap), esc(g.health.tailorOverlap.failed.join(', ')))}
${row('Health · Tailor truncation', 'no new truncation', pf(g.health.tailorTruncation), esc(g.health.tailorTruncation.failed.join(', ')))}
${row('Health · zoom keeps nav (first scale)', 'visible nav and search not reduced', pf(g.health.zoomKeepsNav), esc(g.health.zoomKeepsNav.failed.join(', ')))}
${row('Health · zoom keeps nav (after guard)', 'after step-down', pf(g.health.zoomKeepsNavAfterGuard), esc(g.health.zoomKeepsNavAfterGuard.failed.join(', ')))}
${row('Health · visible nav after Tailor', 'nav links and search at the applied scale ≥ 100%', pf(g.health.navVisibleAfterTailor), esc(g.health.navVisibleAfterTailor.failed.join(', ')))}
${row('Guard baseline', 'layout.nav count = viewportGuard count at 100%', `${g.health.guardBaselineMismatch.length} mismatches`, esc(g.health.guardBaselineMismatch.slice(0, 8).join('; ')))}
${row('Health · Fit view overflow', 'none', pf(g.health.fitViewOverflow), esc(g.health.fitViewOverflow.failed.join(', ')))}
${row('Health · Fit view render health', 'health.ok', pf(g.health.fitViewHealthOk), esc(g.health.fitViewHealthOk.failed.join(', ')))}
${row('Conservation', '100% reachable', pf(g.conservation), esc(g.conservation.failed.join(', ')))}
${row('Targets', '100% of controls ≥ T', pf(g.targets), esc(g.targets.failed.join(', ')))}
${row('Proxies · bound', 'every view control drives an original', pf(g.proxies.allControlsBound), esc(g.proxies.allControlsBound.failed.join(', ')))}
${row('Records · titled', 'every primary record shows a title', pf(g.records.everyRecordTitled), esc(g.records.everyRecordTitled.failed.join(', ')))}
${row('Records · right title', "each title is that record's own title (answer key)", pf(g.records.titlesMatchPage), esc(g.records.titlesMatchPage.failed.join(', ')))}
${row('Proxies · smoke', '≥ 95% take effect; 0 wrong targets', `${g.smoke.effective}/${g.smoke.attempted}; wrong ${g.smoke.wrongTarget.length}`, esc([...g.smoke.wrongTarget, ...g.smoke.notAttempted].join(', ')))}
${row('Privacy · page shortcuts', '0 events reach the page', `<span class="${g.smoke.leaks.length ? 'bad' : 'ok'}">${g.smoke.leaks.length}</span>`, esc(g.smoke.leaks.join(', ')))}
${row('UX · primary in first viewport', 'yes', pf(g.ux.primaryInFirstViewport), esc(g.ux.primaryInFirstViewport.failed.join(', ')))}
${row('UX · layout shift after open', '0', pf(g.ux.noLayoutShift), esc(g.ux.noLayoutShift.failed.join(', ')))}
${row('Site DOM untouched', 'no ARIA/role/tabindex/inert/style changes', pf(g.siteDom), esc(g.siteDom.failed.join(', ')))}
${row('Latency · read + triage', '≤ 50 ms', `p50 ${num(L.readTriageMs.p50)} · p95 ${num(L.readTriageMs.p95)} · max ${num(L.readTriageMs.max)}`, esc(L.readTriageMs.over50.join(', ')))}
${row('Latency · heuristic first render', '≤ 150 ms', `p50 ${num(L.heuristicFirstRenderMs.p50)} · p95 ${num(L.heuristicFirstRenderMs.p95)} · max ${num(L.heuristicFirstRenderMs.max)} (busy p50 ${L.heuristicFirstRenderMs.busyP50})`, esc(L.heuristicFirstRenderMs.over150.join(', ')))}
${row('Latency · planner', 'p95 ≤ 8 s', `n ${L.plannerMs.n} · p50 ${L.plannerMs.p50} · p95 ${L.plannerMs.p95} · max ${L.plannerMs.max}`, '')}
${row('Latency · cache hit', '< 50 ms', `resolve p50 ${L.cacheHitResolveMs.p50} · p95 ${L.cacheHitResolveMs.p95} ms; render p50 ${num(L.cacheHitRenderMs.p50)} ms`, '')}
${row('Triage · gov.uk', 'F 18 fits, F 36 compose', g.triageGovuk.map((t) => `<span class="${cls(t.pass)}">${esc(t.site)}: ${esc(t.F18)} / ${esc(t.F36)}</span>`).join('<br>'), '')}
</table>`;
}

export async function writeReport(out, results, meta) {
  const gates = computeGates(results);
  const score = scorecard(results);
  if (score.rows.length) console.log(scorecardText(score));
  const personas = meta.personas ?? [];
  const status = results
    .map(
      (s) =>
        `<tr><td><a href="#${esc(s.id)}">${esc(s.id)}</a></td><td class="${s.status === 'ok' ? 'ok' : s.status === 'blocked' ? 'warn' : 'bad'}">${esc(s.status)}</td><td class="small">${esc(s.finalUrl ?? s.resolvedUrl ?? s.url)}</td><td class="small">${esc((s.consent ?? []).join(' · '))}${s.blocked ? ` · ${esc(s.blocked)}` : ''}${s.error ? ` · ${esc(String(s.error).split('\n')[0])}` : ''}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WebAble v2 real-site evaluation</title><style>${CSS}</style></head><body><main>
<h1>WebAble v2 real-site evaluation</h1>
<p class="muted">${esc(meta.generatedAt ?? new Date().toISOString())} · personas: ${esc(personas.map((p) => p.label).join('; '))} · versions ${esc(JSON.stringify(meta.versions ?? {}))} · OpenAI spend to date $${num(meta.ledger?.spent, 3)} (${meta.ledger?.calls ?? 0} calls)</p>
<nav class="toc">${results.map((s) => `<a href="#${esc(s.id)}">${esc(s.id)}</a>`).join('')}</nav>
<h2>Restructure scorecard (docs/11 §4)</h2>${scorecardTable(score)}
<h2>Gates (docs/10 §10)</h2>${gatesTable(gates)}
<h2>Corpus</h2><table><tr><th>page</th><th>status</th><th>URL</th><th>consent / notes</th></tr>${status}</table>
${results.map((s) => siteBlock(s, personas)).join('\n')}
</main></body></html>`;
  await writeFile(join(out, 'report.html'), html);
  const summary = {
    meta: {
      ...meta,
      generatedAt: meta.generatedAt ?? new Date().toISOString(),
    },
    gates,
    restructure: score,
    sites: results.map((s) => ({
      id: s.id,
      status: s.status,
      url: s.finalUrl ?? s.resolvedUrl ?? s.url,
      blocked: s.blocked ?? null,
      error: s.error ? String(s.error).split('\n')[0] : null,
      planner: s.planner
        ? {
            ok: s.planner.ok,
            stage: s.planner.stage,
            ms: s.planner.call?.totalMs ?? null,
            cost: s.planner.call?.cost ?? null,
          }
        : null,
      personas: Object.fromEntries(
        Object.entries(s.personas ?? {}).map(([pid, p]) => [
          pid,
          p?.error
            ? { error: p.error }
            : {
                verdict: p?.read?.verdict?.verdict,
                k: p?.read?.verdict?.k,
                zoom: p?.zoom,
                ops: (p?.tailor?.changesLater ?? p?.tailor?.changes ?? []).map(
                  (c) => `${c.op}:${c.status}${c.vcode ? `(${c.vcode})` : ''}`,
                ),
                inversions:
                  p?.metrics?.vsOriginal?.hierarchy.inversions ?? null,
                newTruncation: p?.metrics?.vsOriginal?.truncation.new ?? null,
                newOverlap: p?.metrics?.vsOriginal?.overlap.new ?? null,
                heuristic: p?.fitHeuristic?.metrics
                  ? {
                      ms: p.fitHeuristic.open.ms.total,
                      health: p.fitHeuristic.metrics.health?.failures ?? null,
                      conservation:
                        p.fitHeuristic.metrics.conservation?.missing ?? null,
                      primaryTop: p.fitHeuristic.metrics.primaryTop,
                    }
                  : (p?.fitHeuristic?.open ?? null),
                planner: p?.fitPlanner?.metrics
                  ? {
                      ms: p.fitPlanner.open.ms.total,
                      coverage: p.fitPlanner.open.coverage,
                      health: p.fitPlanner.metrics.health?.failures ?? null,
                      conservation:
                        p.fitPlanner.metrics.conservation?.missing ?? null,
                      primaryTop: p.fitPlanner.metrics.primaryTop,
                    }
                  : (p?.fitPlanner?.skipped ?? null),
              },
        ]),
      ),
    })),
  };
  await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  return summary;
}

// Standalone: re-render a run's report from its saved results.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const out = resolve(process.argv[2] ?? '.');
  const { SITES } = await import('./sites.mjs');
  const { PERSONAS } = await import('./personas.mjs');
  const dirs = new Set(await readdir(join(out, 'sites')));
  const results = [];
  for (const s of SITES) {
    if (!dirs.has(s.id)) continue;
    try {
      results.push(
        JSON.parse(
          await readFile(join(out, 'sites', s.id, 'result.json'), 'utf8'),
        ),
      );
    } catch {
      // not run
    }
  }
  let prev = {};
  try {
    prev =
      JSON.parse(await readFile(join(out, 'summary.json'), 'utf8')).meta ?? {};
  } catch {
    // first render
  }
  await writeReport(out, results, {
    ...prev,
    personas:
      prev.personas ?? PERSONAS.map((p) => ({ id: p.id, label: p.label })),
    generatedAt: new Date().toISOString(),
  });
  console.log(`report ${join(out, 'report.html')}`);
}
