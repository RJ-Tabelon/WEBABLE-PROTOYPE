// Contact sheet for one eval run: before | after | after at the task | lens | calm per site, plus the numbers that
// matter, including the reading facts (zoom, text hierarchy, column, overflow, overlapping text, UI collisions).
import { escapeHtml as h, median } from './common.mjs';
import { RAMP, columnVerdict, headingVerdicts } from './pagefacts.mjs';

const SHOTS = [
  ['before', 'Before (paused)'],
  ['after', 'After (fitted, top)'],
  ['task', 'After · at the main task'],
  ['lens', 'Jev Lens'],
  ['calm', 'Calm view'],
];

const pct = (z) => (typeof z === 'number' && Number.isFinite(z) ? `${Math.round(z * 100)}%` : '—');
const num = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');

/** Reading facts for one site, compact: what the console line, the chips, the tiles and summary.json use. */
export function readingSummary(r) {
  const fs = r.firstScreen ?? {};
  const b = fs.before?.reading && !fs.before.reading.error ? fs.before.reading : null;
  const a = fs.after?.reading && !fs.after.reading.error ? fs.after.reading : null;
  const t = fs.task?.reading && !fs.task.reading.error ? fs.task.reading : null;
  if (!a) return null;
  const col = columnVerdict(a, r.engine?.column ?? null);
  const flowAfter = Math.max(a.overlap?.flow ?? 0, t?.overlap?.flow ?? 0);
  const flowBefore = b?.overlap?.flow ?? null;
  const ui = fs.after?.ui ?? null;
  const uiTask = fs.task?.ui ?? null;
  return {
    zoom: typeof a.textZoom === 'number' && Math.abs((a.bodyZoom ?? 1) - 1) > 0.005 ? a.textZoom : typeof r.tabZoom === 'number' ? r.tabZoom : a.zoom,
    tabZoom: typeof r.tabZoom === 'number' ? r.tabZoom : a.zoom,
    zoomFromDpr: a.zoom,
    body: { before: b?.body?.css ?? null, after: a.body?.css ?? null, screen: a.body?.screen ?? null, basis: a.body?.basis ?? null },
    spacing: {
      wordBefore: b?.body?.wordEm ?? null,
      wordAfter: a.body?.wordEm ?? null,
      letterBefore: b?.body?.letterPx ?? null,
      letterAfter: a.body?.letterPx ?? null,
      lineBefore: b?.body?.lineHeight ?? null,
      lineAfter: a.body?.lineHeight ?? null,
    },
    headings: headingVerdicts(b, a),
    column: {
      held: !!col.held,
      width: col.width ?? null,
      marginL: a.column?.marginL ?? null,
      marginR: a.column?.marginR ?? null,
      centred: col.centred ?? null,
      pageSides: col.pageSides ?? null,
      escapes: a.column?.escapeCount ?? 0,
      tone: col.tone,
      source: col.source ?? null,
      engine: r.engine?.column ?? null,
    },
    overflow: { px: a.overflow?.px ?? null, scroll: !!a.overflow?.scroll, culprits: a.overflow?.culprits ?? [] },
    overlaps: {
      before: flowBefore,
      after: flowAfter,
      added: flowBefore == null ? flowAfter : Math.max(0, flowAfter - flowBefore),
      positionedAfter: Math.max(a.overlap?.positioned ?? 0, t?.overlap?.positioned ?? 0),
      truncated: !!a.overlap?.truncated,
    },
    spills: {
      before: b?.overlap?.spill ?? null,
      after: Math.max(a.overlap?.spill ?? 0, t?.overlap?.spill ?? 0),
      added: Math.max(0, Math.max(a.overlap?.spill ?? 0, t?.overlap?.spill ?? 0) - (b?.overlap?.spill ?? 0)),
    },
    ui: {
      overlaps: [...new Set([...(ui?.floatOverlaps ?? []), ...(uiTask?.floatOverlaps ?? [])])],
      overSite: [...(ui?.overSite ?? []), ...(uiTask?.overSite ?? [])],
      pillScreenH: ui?.pillScreenH ?? null,
    },
  };
}

/** One console line of reading facts. */
export function readingLine(r) {
  const x = readingSummary(r);
  if (!x) return '';
  const hs = Object.entries(x.headings)
    .map(([k, v]) => `${k} ${num(v.before)}→${num(v.after)}×`)
    .join(' ');
  const col = x.column.held ? `column ${x.column.width} px (${x.column.marginL}/${x.column.marginR}, ${x.column.source})` : 'full width';
  const uiBad = x.ui.overlaps.length + x.ui.overSite.filter((o) => o.siteFixed).length;
  return [
    `zoom ${pct(x.zoom)}${Math.abs((x.tabZoom ?? x.zoom) - x.zoom) > 0.01 ? ` (tab ${pct(x.tabZoom)})` : ''}`,
    `body ${x.body.before ?? '—'}→${x.body.after ?? '—'} css px`,
    hs || 'no headings',
    col,
    `overflow ${x.overflow.px ?? '—'} px`,
    `text overlaps ${x.overlaps.before ?? '—'}→${x.overlaps.after}${x.overlaps.positionedAfter ? ` (+${x.overlaps.positionedAfter} positioned)` : ''}`,
    `text out of its box ${x.spills.before ?? '—'}→${x.spills.after}`,
    `UI collisions ${uiBad}`,
    x.ui.pillScreenH ? `pill ${x.ui.pillScreenH} px tall` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const fmtMs = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`) : '—');
const fmtUsd = (x) => (typeof x === 'number' && Number.isFinite(x) ? `$${x < 0.01 ? x.toFixed(5) : x.toFixed(4)}` : '—');
const fmtP = (p) => (typeof p === 'number' && Number.isFinite(p) ? p.toFixed(2) : '');

/** Numbers for one site, derived from its final TabReport. */
export function siteMetrics(r) {
  const rep = r.report ?? null;
  const u = rep?.understanding ?? null;
  const ops = Array.isArray(rep?.ops) ? rep.ops : [];
  const checks = Array.isArray(rep?.checks) ? rep.checks : [];
  return {
    phase: rep?.phase ?? null,
    decisions: u?.decisions ?? null,
    folded: u?.folded ?? null,
    protected: u?.protected ?? null,
    mainId: u?.mainId ?? null,
    jevMs: u?.metrics?.wallMs ?? null,
    jevServerMs: u?.metrics?.serverMs ?? null,
    jevUsd: u?.metrics?.costUsd ?? null,
    jevCalls: u?.metrics?.calls ?? null,
    jevQuestions: u?.metrics?.questions ?? null,
    jevTokens: u?.metrics?.inputTokens ?? null,
    opsApplied: ops.filter((o) => o?.status === 'applied').length,
    opsReversed: ops.filter((o) => o?.status === 'reversed').length,
    opsOffered: ops.filter((o) => o?.status === 'offered').length,
    checksRun: checks.length,
    checksFailed: checks.filter((c) => c && c.pass === false),
    redesign: rep?.redesign ?? null,
    struggleLevel: rep?.struggle?.level ?? null,
    errors: [...(r.errors ?? []), ...(Array.isArray(rep?.errors) ? rep.errors.map((e) => `report: ${e}`) : [])],
    reading: readingSummary(r),
  };
}

function chip(label, value, tone = '', title = '') {
  return `<span class="chip ${tone}"${title ? ` title="${h(title)}"` : ''}><span class="chip-k">${h(label)}</span><span class="chip-v">${h(value)}</span></span>`;
}

const tone = (ok) => (ok === true ? 'good' : ok === false ? 'bad' : '');

/** First-screen chips for one site: heading, main action, overlays, pill, Lens chips, Calm first screen. */
function firstScreenChips(r) {
  const fs = r.firstScreen ?? {};
  const out = [];
  const after = fs.after?.page;
  const before = fs.before?.page;
  if (after?.h1) out.push(chip('Heading top', `${after.h1.top} px`, '', after.h1.text));
  if (after) {
    const m = after.main;
    if (m) {
      const where = m.coveredBy ? `under ${m.coveredBy}` : m.inView ? 'in view' : m.below ? `below the fold (${m.top} px)` : 'partly off screen';
      out.push(chip('Main action', `${where}`, m.coveredBy ? 'bad' : m.inView ? 'good' : 'warn', `“${m.label}” ${m.top}–${m.bottom} px`));
    } else out.push(chip('Main action', 'none marked', 'warn'));
  }
  if (before || after) {
    const b = before?.overlayPct;
    const a = after?.overlayPct;
    const t = a == null ? '' : a <= 10 ? 'good' : b != null && a < b ? '' : 'warn';
    const what = (after?.overlayBy ?? before?.overlayBy ?? []).map((x) => `${x.what} ${x.pct}%`).join(', ');
    out.push(chip('Page overlays', `${b ?? '—'}% → ${a ?? '—'}%`, t, what || 'fixed boxes over the page'));
  }
  if (after) out.push(chip('WebAble UI', `${after.webablePct}%`, after.webablePct > 15 ? 'warn' : '', 'share of the first screen under WebAble’s own chrome'));
  if (after) out.push(chip('Pill over a control', after.pillOver?.length ? after.pillOver.join(', ') : 'none', after.pillOver?.length ? 'bad' : 'good'));
  const floats = fs.after?.ui?.floatOverlaps ?? [];
  if (floats.length) out.push(chip('Chips overlap', floats.slice(0, 2).join('; '), 'bad'));
  const lens = fs.lens?.lens;
  if (lens) out.push(chip('Lens chips', `${lens.chips} · ${lens.overlapping.length} overlapping`, lens.on ? tone(lens.overlapping.length === 0) : 'warn', lens.overlapping.join('; ')));
  else if (fs.lens) out.push(chip('Lens', 'did not open', 'bad'));
  const c = fs.calm?.calm;
  if (c?.open) {
    out.push(chip('Calm h1 top', c.h1Top != null ? `${c.h1Top} px` : 'no h1', tone(c.h1Ok), `${c.h1Text ?? ''} (rule: ≤ 140 px)`));
    out.push(chip('Calm task', c.task ? (c.taskOk ? 'on first screen' : `at ${c.task.top} px`) : 'none', tone(c.taskOk), c.task ? `${c.task.kind} “${c.task.text}”` : ''));
    out.push(chip('Filled buttons', `${c.filled?.length ?? 0}`, tone(c.filledOk), (c.filled ?? []).join(', ')));
  }
  return out.join('');
}

/** Reading chips for one site: zoom, body and heading sizes, the column, overflow, overlapping text, UI collisions. */
function readingChips(r, meta = {}) {
  const x = readingSummary(r);
  const a = r.firstScreen?.after?.reading;
  if (!x || !a) return a?.error ? chip('Reading facts', a.error, 'bad') : '';
  const out = [];
  out.push(chip('Page zoom', pct(x.zoom), '', `Chrome tab zoom; devicePixelRatio says ${pct(x.zoomFromDpr)}`));
  const target = meta.fitTextPx ?? null;
  out.push(
    chip(
      'Body text',
      `${x.body.before ?? '—'} → ${x.body.after ?? '—'} px · ${x.body.screen ?? '—'} on screen`,
      target && x.body.screen ? (x.body.screen >= target - 1 ? 'good' : 'warn') : '',
      `CSS px, then screen px at 1× (CSS × zoom)${target ? `; the fit asks for ${target} px` : ''} · char-weighted median of ${x.body.basis ?? '—'}`,
    ),
  );
  const s2 = x.spacing;
  const wordAdded = (s2.wordAfter ?? 0) - (s2.wordBefore ?? 0);
  const letterAdded = (s2.letterAfter ?? 0) - (s2.letterBefore ?? 0);
  out.push(
    chip(
      'Word / letter spacing',
      `${num(s2.wordBefore)} → ${num(s2.wordAfter)} em · ${num(s2.letterBefore, 1)} → ${num(s2.letterAfter, 1)} px`,
      wordAdded > 0.02 || letterAdded > 0.3 ? 'bad' : 'good',
      `running text; line height ${num(s2.lineBefore)} → ${num(s2.lineAfter)} × font size (normal counts as —)`,
    ),
  );
  const hs = Object.entries(x.headings);
  for (const [k, v] of hs) {
    const fact = a.headings?.[k];
    out.push(
      chip(
        `${k.toUpperCase()} ÷ body`,
        `${num(v.before)} → ${num(v.after)}×`,
        v.tone,
        `minimum ramp ${v.ramp}× · ${fact?.n ?? 0} heading(s), ${fact?.css ?? '—'} px, weight ${fact?.weight ?? '—'} · “${fact?.text ?? ''}”`,
      ),
    );
  }
  if (!hs.length) out.push(chip('Headings', 'none found', 'warn', 'no visible h1–h3 in the main content'));
  const c = x.column;
  const ce = c.engine ? ` · engine: ${c.engine.on ? `on, ${c.engine.widthPx ?? '—'} px` : 'off'}` : '';
  if (c.held) {
    const why = [
      c.centred ? 'centred' : 'off-centre',
      c.pageSides ? 'page colour at the sides' : 'something else at the sides',
      c.escapes ? `${c.escapes} box(es) escape the column` : 'nothing escapes',
    ].join(' · ');
    out.push(chip('Column', `${c.width} px · sides ${c.marginL} / ${c.marginR} · ${c.source}`, c.tone, `${why}${ce}`));
  } else {
    out.push(chip('Column', 'full width', c.tone, `content ${a.column?.content?.width ?? '—'} of ${a.column?.viewport ?? '—'} px${ce}`));
  }
  const o = x.overflow;
  out.push(
    chip(
      'Sideways scroll',
      o.scroll ? `${o.px} px` : o.px ? `none (${o.px} px clipped)` : 'none',
      o.scroll ? 'bad' : 'good',
      o.culprits.map((q) => `${q.what} → ${q.right} px`).join('; '),
    ),
  );
  const ov = x.overlaps;
  const pairs = (a.overlap?.pairs ?? []).filter((p) => p.kind === 'flow').slice(0, 4).map((p) => `“${p.a}” × “${p.b}”`).join('; ');
  out.push(
    chip(
      'Text overlaps',
      `${ov.before ?? '—'} → ${ov.after}`,
      ov.added > 0 ? 'bad' : ov.after > 0 ? 'warn' : 'good',
      `${pairs || 'none'}${ov.positionedAfter ? ` · ${ov.positionedAfter} more involve positioned boxes` : ''}${ov.truncated ? ' · page sampled' : ''}`,
    ),
  );
  const sp = x.spills;
  const spList = (a.overlap?.spills ?? []).filter((q) => q.kind === 'flow').slice(0, 4).map((q) => `“${q.text}” ${q.px} px ${q.dir} its ${q.where}`).join('; ');
  out.push(chip('Text out of its box', `${sp.before ?? '—'} → ${sp.after}`, sp.added > 0 ? 'bad' : sp.after > 0 ? 'warn' : 'good', spList || 'none'));
  const fixedUnder = x.ui.overSite.filter((q) => q.siteFixed);
  out.push(chip('UI overlaps', `${x.ui.overlaps.length}`, x.ui.overlaps.length ? 'bad' : 'good', x.ui.overlaps.join('; ')));
  out.push(
    chip(
      'UI over site controls',
      `${fixedUnder.length} fixed · ${x.ui.overSite.length - fixedUnder.length} in page`,
      fixedUnder.length ? 'bad' : x.ui.overSite.length ? 'warn' : 'good',
      x.ui.overSite.map((q) => `${q.ours} over “${q.site}”${q.siteFixed ? ' (fixed)' : ''}`).join('; '),
    ),
  );
  if (x.ui.pillScreenH) out.push(chip('Pill', `${x.ui.pillScreenH} px tall`, '', 'physical size at 1× (CSS px × page zoom); should not change with zoom'));
  return out.join('');
}

/** Red boxes over overlapping text, dashed lines at the content edges; drawn over the screenshot, not into the page. */
function marks(r, key) {
  const rd = r.firstScreen?.[key]?.reading;
  if (!rd || rd.error || !rd.cssW || !rd.cssH) return '';
  const X = (v) => `${((100 * v) / rd.cssW).toFixed(2)}%`;
  const Y = (v) => `${((100 * v) / rd.cssH).toFixed(2)}%`;
  // The stored boxes are glyph cores (cap height to baseline); pad them back out so the outline frames the text.
  const boxes = (rd.overlap?.boxes ?? [])
    .map((b) => {
      const pad = Math.max(2, b.h * 0.35);
      return `<span class="ovl ovl-${h(b.kind)}" style="left:${X(b.x - pad)};top:${Y(b.y - pad)};width:${X(b.w + 2 * pad)};height:${Y(b.h + 2 * pad)}"></span>`;
    })
    .join('');
  let lines = '';
  const c = rd.column;
  if (key !== 'before' && c?.content && (c.narrowed || (c.marginL >= 48 && c.marginR >= 48))) {
    const z = rd.zoom || 1;
    lines = [c.content.left, c.content.right].map((v) => `<span class="colline" style="left:${X(v / z)}"></span>`).join('');
  }
  return boxes || lines ? `<span class="marks" aria-hidden="true">${lines}${boxes}</span>` : '';
}

function shotCell(r, key, label) {
  const file = r.shots?.[key];
  const sub = r.shotNotes?.[key] ? `<span class="shot-note">${h(r.shotNotes[key])}</span>` : '';
  if (!file) {
    return `<figure class="shot missing"><div class="shot-empty">${h(r.shotErrors?.[key] ?? 'Not captured')}</div><figcaption>${h(label)}${sub}</figcaption></figure>`;
  }
  return `<figure class="shot"><a class="shot-frame" href="${h(file)}" target="_blank" rel="noopener"><img src="${h(file)}" alt="${h(`${r.name}: ${label}`)}" loading="lazy">${marks(r, key)}</a><figcaption>${h(label)}${sub}</figcaption></figure>`;
}

function siteCard(r, meta = {}) {
  const m = siteMetrics(r);
  const phaseTone = m.phase === 'error' ? 'bad' : m.phase === 'understood' || m.phase === 'calm' ? 'good' : 'warn';
  const chips = [
    chip('Phase', m.phase ?? 'no report', phaseTone),
    chip('To understood', fmtMs(r.msToUnderstood)),
    chip('Jev decisions', m.decisions ?? '—', m.decisions ? 'good' : ''),
    chip('Jev', m.jevMs != null ? `${fmtMs(m.jevMs)}${m.jevServerMs != null ? ` (server ${fmtMs(m.jevServerMs)})` : ''}` : '—'),
    chip('Jev cost', fmtUsd(m.jevUsd)),
    chip('Folded / protected', m.folded != null ? `${m.folded} / ${m.protected}` : '—'),
    chip('Ops applied', m.opsApplied),
    chip('Reversed', m.opsReversed, m.opsReversed ? 'warn' : ''),
    chip('Checks failed', `${m.checksFailed.length} of ${m.checksRun}`, m.checksFailed.length ? 'warn' : ''),
    chip('Calm layout', m.redesign ? `${m.redesign.chosen}${m.redesign.autoApply ? ' · auto' : ''} · ${fmtMs(m.redesign.ms)}` : '—'),
    chip('Errors', m.errors.length, m.errors.length ? 'bad' : ''),
  ].join('');

  const ledger = Array.isArray(r.report?.ledger) ? r.report.ledger : [];
  const ledgerHtml = ledger.length
    ? `<ol class="ledger">${ledger
        .slice(0, 40)
        .map((e) => `<li><span class="src">${h(e.source)}</span>${e.action ? `<span class="act act-${h(e.action)}">${h(e.action)}</span>` : ''}<span class="t">${h(e.title)}</span>${e.p != null ? `<span class="p">${h(fmtP(e.p))}</span>` : ''}${e.detail ? `<span class="d">${h(e.detail)}</span>` : ''}</li>`)
        .join('')}</ol>`
    : '<p class="muted">No ledger entries.</p>';
  const checksHtml = m.checksFailed.length
    ? `<ul class="plain">${m.checksFailed.map((c) => `<li><b>${h(c.name)}</b> ${h(c.detail)}${c.opId ? ` <span class="muted">(${h(c.opId)})</span>` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">None failed.</p>';
  const errorsHtml = m.errors.length ? `<ul class="plain errs">${m.errors.slice(0, 30).map((e) => `<li>${h(e)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>';

  return `<article class="site" id="${h(r.slug)}">
  <header class="site-head">
    <div>
      <h2>${h(r.name)}</h2>
      <a class="url" href="${h(r.url)}" target="_blank" rel="noopener">${h(r.finalUrl && r.finalUrl !== r.url ? `${r.url} → ${r.finalUrl}` : r.url)}</a>
      ${r.note ? `<p class="note">${h(r.note)}</p>` : ''}
    </div>
    <a class="raw" href="${h(r.slug)}/report.json" target="_blank" rel="noopener">report.json</a>
  </header>
  <div class="chips">${chips}</div>
  <div class="chips chips-first"><span class="chips-label">First screen</span>${firstScreenChips(r)}</div>
  <div class="chips chips-first"><span class="chips-label">Reading</span>${readingChips(r, meta)}</div>
  <div class="shots">${SHOTS.map(([k, label]) => shotCell(r, k, label)).join('')}</div>
  <div class="details">
    <details${ledger.length ? ' open' : ''}><summary>What WebAble did (${ledger.length})</summary>${ledgerHtml}</details>
    <details${m.checksFailed.length ? ' open' : ''}><summary>Checks failed (${m.checksFailed.length})</summary>${checksHtml}</details>
    <details${m.errors.length ? ' open' : ''}><summary>Errors (${m.errors.length})</summary>${errorsHtml}</details>
  </div>
</article>`;
}

function checkList(checks) {
  const cs = (checks ?? []).filter((c) => c);
  if (!cs.length) return '';
  return `<ul class="checks">${cs
    .map((c) => `<li class="${c.ok === true ? 'ok' : c.ok === false ? 'no' : 'na'}"><span class="mark">${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'}</span>${h(c.name)}${c.detail ? `<span class="muted"> · ${h(c.detail)}</span>` : ''}</li>`)
    .join('')}</ul>`;
}

function fittingSection(f) {
  if (!f) return '';
  const bad = f.screens.filter((x) => !x.ok).length;
  const fit = f.fit;
  const fitLine = fit
    ? `Saved fit: text ${fit.text?.override ?? fit.text?.bodyPx} px · targets ${fit.targets?.minPx ?? '—'} px · contrast ${fit.contrast?.band} · calm level ${fit.attention?.structureLevel}`
    : 'No fit saved';
  const cards = f.screens
    .map((x) => {
      const m = x.checks ?? {};
      const lines = [
        ...x.problems.map((p) => `<li class="no"><span class="mark">✗</span>${h(p)}</li>`),
        ...(x.notes ?? []).map((p) => `<li class="na"><span class="mark">–</span>${h(p)}</li>`),
      ].join('');
      const meta2 = [m.chromeScale ? `chrome ×${m.chromeScale}` : null, m.actionBar ? `Pause/Skip ${m.actionBar === 'fixed' ? 'floating' : 'in flow'}` : null, m.docHeight && m.vh ? `page ${m.docHeight} / ${m.vh} px` : null]
        .filter(Boolean)
        .join(' · ');
      return `<figure class="frame ${x.ok ? '' : 'has-problem'}"><a href="${h(x.file)}" target="_blank" rel="noopener"><img src="${h(x.file)}" alt="${h(x.title)}" loading="lazy"></a>
  <figcaption><b>${x.ok ? '✓' : '✗'} ${h(x.title)}</b><span class="muted">${h(meta2)}</span>${lines ? `<ul class="checks">${lines}</ul>` : ''}</figcaption></figure>`;
    })
    .join('');
  const errs = f.errors.length ? `<ul class="plain errs">${f.errors.map((e) => `<li>${h(e)}</li>`).join('')}</ul>` : '';
  return `<section class="block" id="fitting">
  <header class="block-head"><h2>Fitting flow</h2><p class="muted">${f.screens.length} screens · ${bad} with problems · ${f.seconds ?? '—'} s to “Your fit” · ${h(fitLine)}</p></header>
  ${errs}
  <div class="frames">${cards}</div>
</section>`;
}

function interactSection(x) {
  if (!x) return '';
  const bad = x.steps.filter((s) => !s.ok).length;
  const cards = x.steps
    .map(
      (s) => `<figure class="frame ${s.ok ? '' : 'has-problem'}"><a href="${h(s.file)}" target="_blank" rel="noopener"><img src="${h(s.file)}" alt="${h(s.title)}" loading="lazy"></a>
  <figcaption><b>${s.ok ? '✓' : '✗'} ${h(s.title)}</b>${(s.notes ?? []).length ? `<span class="muted">${h(s.notes.join(' · '))}</span>` : ''}${checkList(s.checks)}</figcaption></figure>`,
    )
    .join('');
  const t = x.timings ?? {};
  const line = [
    t.toUnderstoodMs != null ? `understood in ${fmtMs(t.toUnderstoodMs)}` : null,
    t.explainMs != null ? `Explain ${fmtMs(t.explainMs)}` : null,
    t.struggleRounds != null ? `${t.struggleRounds} near-misses${t.offerAfterMs != null ? `, offer after ${fmtMs(t.offerAfterMs)}` : ', no offer'}` : null,
    x.mainLabel ? `main action “${x.mainLabel}”` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const errs = x.errors.length ? `<ul class="plain errs">${x.errors.map((e) => `<li>${h(e)}</li>`).join('')}</ul>` : '';
  return `<section class="block" id="interact">
  <header class="block-head"><h2>Interactions · ${h(x.site)}</h2><p class="muted">${x.steps.length} steps · ${bad} with a failed check · ${h(line)}</p></header>
  ${errs}
  <div class="frames">${cards}</div>
</section>`;
}

export function renderSheet(meta, results, extra = {}) {
  const ms = results.map(siteMetrics);
  const sum = (k) => ms.reduce((a, m) => a + (typeof m[k] === 'number' ? m[k] : 0), 0);
  const understood = ms.filter((m) => m.phase === 'understood' || m.phase === 'calm').length;
  const mainSeen = results.filter((r) => r.firstScreen?.after?.page?.main?.inView && !r.firstScreen.after.page.main.coveredBy).length;
  const calmOk = results.filter((r) => r.firstScreen?.calm?.calm?.h1Ok && r.firstScreen.calm.calm.taskOk).length;
  const calmN = results.filter((r) => r.firstScreen?.calm?.calm?.open).length;
  const rs = ms.map((m) => m.reading).filter(Boolean);
  const added = rs.reduce((a2, x) => a2 + (x.overlaps.added ?? 0), 0);
  const spilled = rs.reduce((a2, x) => a2 + (x.spills.added ?? 0), 0);
  const hier = rs.filter((x) => Object.keys(x.headings).length);
  const hierOk = hier.filter((x) => Object.values(x.headings).every((v) => v.tone === 'good')).length;
  const zoomed = rs.filter((x) => (x.zoom ?? 1) > 1.05);
  const colOk = zoomed.filter((x) => x.column.held && x.column.tone === 'good').length;
  const colOurs = zoomed.filter((x) => x.column.source === 'WebAble' || x.column.source === 'narrowed body').length;
  const uiBad = rs.filter((x) => x.ui.overlaps.length || x.ui.overSite.some((q) => q.siteFixed)).length;
  const tiles = !results.length ? '' : [
    ['Sites', `${results.length}`, `${understood} reached “understood”`],
    ['Jev decisions', `${sum('decisions')}`, `${sum('jevCalls')} calls · ${sum('jevQuestions')} questions`],
    ['Median Jev time', fmtMs(median(ms.map((m) => m.jevMs))), 'per page, wall clock'],
    ['Jev cost', fmtUsd(sum('jevUsd')), `${sum('jevTokens').toLocaleString('en-US')} input tokens`],
    ['Changes', `${sum('opsApplied')} applied`, `${sum('opsReversed')} reversed by checks`],
    ['Problems', `${ms.reduce((a, m) => a + m.errors.length, 0)} errors`, `${ms.reduce((a, m) => a + m.checksFailed.length, 0)} checks failed`],
    ['First screen', `${mainSeen} of ${results.length}`, `main action in view · Calm first screen right on ${calmOk} of ${calmN}`],
    ['Text overlaps added', `${added}`, `${rs.filter((x) => x.overlaps.added > 0).length} of ${rs.length} pages · line boxes of different text crossing`],
    ['Text out of its box', `${spilled} added`, `${rs.filter((x) => x.spills.added > 0).length} of ${rs.length} pages · text grown past a fixed box`],
    ['Headings', `${hierOk} of ${hier.length}`, `pages where every heading level kept its ratio to body text, or rose to the ramp (h1 ${RAMP.h1}×, h2 ${RAMP.h2}×, h3 ${RAMP.h3}×)`],
    ['Column', `${colOk} of ${zoomed.length}`, `zoomed pages held to a centred column with page-coloured sides (${colOurs} by WebAble)`],
    ['UI collisions', `${uiBad}`, 'pages where WebAble’s floating UI overlaps itself or a fixed site control'],
  ]
    .map(([k, v, s]) => `<div class="tile"><p class="tile-k">${h(k)}</p><p class="tile-v">${h(v)}</p><p class="tile-s">${h(s)}</p></div>`)
    .join('');
  const metaLine = [
    `Fit: ${meta.fit}`,
    `Viewport: ${meta.viewport.width} × ${meta.viewport.height}${meta.dpr && meta.dpr !== 1 ? ` @${meta.dpr}x` : ''}`,
    meta.browser ? `Browser: ${meta.browser}${meta.loadedVia ? ` (extension via ${meta.loadedVia})` : ''}` : null,
    meta.extensionId ? `Extension: ${meta.extensionId}` : 'Extension: not loaded',
    meta.server ? `Server: ${meta.server}` : null,
    `Took ${fmtMs(meta.durationMs)}`,
  ]
    .filter(Boolean)
    .map((x) => `<span>${h(x)}</span>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WebAble eval · ${h(meta.run)}</title>
<style>
  :root { --bg: #F5F5F7; --card: #fff; --ink: #1D1D1F; --muted: #6E6E73; --line: #E3E3E8; --blue: #0071E3; --good: #2E7D32; --warn: #9A6700; --bad: #B42318; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; }
  main { max-width: 1440px; margin: 0 auto; padding: 40px 24px 80px; }
  h1 { font-size: 34px; font-weight: 600; letter-spacing: -.4px; margin: 0 0 6px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .tile { background: var(--card); border-radius: 14px; padding: 14px 16px; }
  .tile p { margin: 0; }
  .tile-k { font-size: 12px; color: var(--muted); }
  .tile-v { font-size: 22px; font-weight: 600; letter-spacing: -.2px; margin: 2px 0; }
  .tile-s { font-size: 12px; color: var(--muted); }
  .toc { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
  .toc a { font-size: 13px; color: var(--blue); text-decoration: none; background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; }
  .site { background: var(--card); border-radius: 18px; padding: 20px 20px 16px; margin-bottom: 20px; }
  .site-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .site h2 { font-size: 20px; font-weight: 600; margin: 0 0 2px; }
  .url { font-size: 12px; color: var(--muted); word-break: break-all; }
  .note { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
  .raw { font-size: 12px; color: var(--blue); white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 14px; }
  .chip { display: inline-flex; gap: 6px; align-items: baseline; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 12px; }
  .chip-k { color: var(--muted); }
  .chip-v { font-weight: 600; }
  .chip.good { border-color: #BFE3C4; background: #F1FAF2; } .chip.good .chip-v { color: var(--good); }
  .chip.warn { border-color: #F0D97A; background: #FFFBEB; } .chip.warn .chip-v { color: var(--warn); }
  .chip.bad { border-color: #F5C2BD; background: #FEF3F2; } .chip.bad .chip-v { color: var(--bad); }
  .shots { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 1200px) { .shots { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 800px) { .shots { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .shot { margin: 0; }
  .shot-frame { position: relative; display: block; }
  .shot img { width: 100%; height: auto; display: block; border-radius: 8px; border: 1px solid var(--line); background: #fafafa; }
  .marks { position: absolute; inset: 1px; pointer-events: none; overflow: hidden; border-radius: 8px; }
  .ovl { position: absolute; border: 2px solid #E5484D; background: rgba(229, 72, 77, .08); border-radius: 3px; }
  .ovl-positioned { border-color: #F5A524; background: rgba(245, 165, 36, .08); }
  .ovl-spill { border-color: #8E4EC6; background: none; border-style: dashed; }
  .colline { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1.5px dashed rgba(0, 113, 227, .7); }
  body.no-marks .marks { display: none; }
  .marks-toggle { font-size: 13px; color: var(--muted); display: inline-flex; gap: 6px; align-items: center; margin: -12px 0 20px; }
  .shot a:hover img { border-color: var(--blue); }
  .shot figcaption { margin-top: 6px; font-size: 12px; font-weight: 600; display: flex; flex-direction: column; }
  .shot-note { font-weight: 400; color: var(--muted); }
  .shot-empty { aspect-ratio: ${meta.viewport.width} / ${meta.viewport.height}; border-radius: 8px; border: 1px dashed var(--line); display: grid; place-items: center; color: var(--muted); font-size: 12px; text-align: center; padding: 12px; }
  .details { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; margin-top: 14px; }
  @media (max-width: 1000px) { .details { grid-template-columns: 1fr; } }
  details { background: var(--bg); border-radius: 10px; padding: 8px 12px; font-size: 13px; }
  summary { cursor: pointer; font-weight: 600; }
  .ledger { margin: 8px 0 4px; padding-left: 20px; max-height: 320px; overflow: auto; }
  .ledger li { padding: 2px 0; }
  .ledger .src { font-size: 11px; color: var(--muted); margin-right: 6px; text-transform: uppercase; letter-spacing: .4px; }
  .ledger .act { font-size: 11px; border-radius: 4px; padding: 0 5px; margin-right: 6px; background: #E8E8ED; }
  .ledger .act-applied, .ledger .act-protected, .ledger .act-kept { background: #E3F2E5; color: var(--good); }
  .ledger .act-reversed { background: #FEECEB; color: var(--bad); }
  .ledger .act-offered, .ledger .act-waiting { background: #FFF4D6; color: var(--warn); }
  .ledger .p { margin-left: 6px; font-variant-numeric: tabular-nums; color: var(--muted); }
  .ledger .d { display: block; color: var(--muted); font-size: 12px; }
  .plain { margin: 8px 0 4px; padding-left: 18px; }
  .errs li { color: var(--bad); word-break: break-word; }
  .muted { color: var(--muted); margin: 8px 0 4px; }
  .chips-first { margin-top: -6px; }
  .chips-label { font-size: 12px; font-weight: 600; color: var(--muted); align-self: center; margin-right: 4px; }
  .block { background: var(--card); border-radius: 18px; padding: 20px; margin-bottom: 20px; }
  .block-head h2 { font-size: 20px; font-weight: 600; margin: 0; }
  .block-head p { margin: 4px 0 14px; font-size: 13px; }
  .frames { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 1100px) { .frames { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .frame { margin: 0; }
  .frame img { width: 100%; height: auto; display: block; border-radius: 8px; border: 1px solid var(--line); background: #fafafa; }
  .frame.has-problem img { border-color: #F5C2BD; box-shadow: 0 0 0 2px #FEF3F2; }
  .frame figcaption { margin-top: 6px; font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
  .frame figcaption .muted { margin: 0; }
  .checks { list-style: none; margin: 4px 0 0; padding: 0; font-size: 12px; }
  .checks li { padding: 1px 0; }
  .checks .mark { display: inline-block; width: 14px; font-weight: 700; }
  .checks .ok .mark { color: var(--good); }
  .checks .no { color: var(--bad); }
  .checks .na .mark { color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>WebAble eval · ${h(meta.run)}</h1>
  <div class="meta">${metaLine}</div>
  ${tiles ? `<section class="tiles" aria-label="Totals">${tiles}</section>` : ''}
  ${results.length ? '<label class="marks-toggle"><input type="checkbox" checked onchange="document.body.classList.toggle(\'no-marks\', !this.checked)"> Mark overlapping text (red: in flow, amber: positioned boxes), text out of its box (purple) and the column edges (blue) on the screenshots</label>' : ''}
  <nav class="toc" aria-label="Sections">${extra.fitting ? '<a href="#fitting">Fitting flow</a>' : ''}${extra.interact ? '<a href="#interact">Interactions</a>' : ''}${results.map((r) => `<a href="#${h(r.slug)}">${h(r.name)}</a>`).join('')}</nav>
  ${interactSection(extra.interact)}
  ${fittingSection(extra.fitting)}
  ${results.map((r) => siteCard(r, meta)).join('\n')}
</main>
</body>
</html>
`;
}
