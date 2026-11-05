// Owner: L. The Lens side sheet (360 px): every element Jev was asked about, grouped by what the policy did, with
// the deciding number on a threshold track; the plain-rule comparison; and the Raw tab (what Jev saw, what it
// answered, the main-action pick, the JSON).
import type { Ref } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PageDigest, PageUnderstanding } from '@webable/core';
import type { ComposeGroupState, EngineState, RewordItem } from '../../contracts';
import { GROUPS, type LensItem } from './display';
import { ClassIcon, IArrowDown, IArrowUp, ICheck, IChevronDown, IChevronRight, IClose, ICopy } from './icons';
import { paraCounts, paraFace, paraSummary } from './paragraphs';
import { RawJson } from './RawJson';
import { RULE_FOOTER, type RuleDiff } from './rule';
import { fmtP, hasPageRead, mainRegionPick, purposeBars, purposeLine, regionLabel } from './words';

export type SheetTab = 'page' | 'elements' | 'raw';

export type RowStatus = 'shown' | 'up' | 'down' | 'hidden';

const ZONE_SHORT: Record<string, string> = {
  header_band: 'header', left_rail: 'left', center_column: 'center', right_rail: 'right', full_width_mid: 'full width',
  footer_band: 'footer', overlay_top: 'overlay', overlay_bottom: 'overlay', overlay_center: 'overlay', overlay_corner: 'overlay',
};

const f2 = (p: number): string => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)).toFixed(2) : '0.00');
const pct = (p: number): string => `${Math.round(Math.min(1, Math.max(0, p)) * 1000) / 10}%`;

export interface SheetProps {
  items: LensItem[];
  status: Map<string, RowStatus>;
  covered: Map<string, string>;
  listed: Set<string>;
  tab: SheetTab;
  onTab: (t: SheetTab) => void;
  hotId: string | null;
  pinnedId: string | null;
  /** Element hovered on the page: bring its row into view. */
  revealId: string | null;
  onRowHover: (id: string | null) => void;
  onRowFocus: (id: string | null) => void;
  onRowClick: (id: string) => void;
  onClose: () => void;
  ruleOn: boolean;
  diff: RuleDiff | null;
  digest: PageDigest | null;
  understanding: PageUnderstanding | null;
  raw: unknown;
  pendingText: string | null;
  sheetRef: Ref<HTMLDivElement>;
  /** Round 9: the paragraphs WebAble read for this person (absent or 'off': no Paragraphs section). */
  reword?: EngineState['reword'];
  onParaClick?: (id: string) => void;
  /** Round 10: the parts of the WebAble page laid out for this person (absent or 'idle': no section). */
  compose?: EngineState['compose'];
}

/** Round 9: one paragraph Jev read for this person: its first words, Jev's probability on a track, what WebAble did. */
function ParaRow({ it, onClick }: { it: RewordItem; onClick?: (id: string) => void }) {
  const face = paraFace(it);
  return (
    <li>
      <button class="wa-lrow wa-lrow-para" data-id={it.id} data-c={`para-${face.tone}`} title={face.say} onClick={() => onClick?.(it.id)}>
        <span class="wa-lrow-ic" data-c={`para-${face.tone}`} aria-hidden="true">
          <ClassIcon cls={face.tone === 'new' ? 'guarded' : 'kept'} size={11} />
        </span>
        <span class="wa-lrow-mid">
          <span class="wa-lrow-label">{it.snippet || 'Paragraph'}</span>
          <span class="wa-lrow-track" aria-hidden="true">
            <i class="wa-lrow-fill" style={{ width: pct(it.need) }} />
          </span>
          <span class="wa-lrow-sub">{face.why ? `${face.sub} (${face.why})` : face.sub}</span>
        </span>
        <span class="wa-lrow-end">
          <b class="wa-lrow-p">{face.num}</b>
        </span>
      </button>
    </li>
  );
}

/** Round 9: "Paragraphs: Jev read 14 for you, picked 5, 5 rewritten, all checked", then one row per paragraph. */
function ParaSection({ reword, onClick }: { reword: EngineState['reword']; onClick?: (id: string) => void }) {
  const line = paraSummary(reword);
  if (!reword || !line) return null;
  const items = [...(reword.items ?? [])].sort((a, b) => b.need - a.need);
  const c = paraCounts(items);
  return (
    <>
      <section class="wa-lcmp wa-lparas-sum" aria-label="Paragraphs Jev read for you">
        <h4>
          Paragraphs
          {c.read > 0 && <span class="wa-lgrp-n">{c.read}</span>}
        </h4>
        <p class="wa-lcmp-rule">{line}.</p>
        {c.read > 0 && (
          <p class="wa-lcmp-foot">
            Each number is Jev's probability that the paragraph is harder than it needs to be for you
            {reword.source ? `, from what ${reword.source} knows about you` : ''}.
          </p>
        )}
      </section>
      {items.length > 0 && (
        <section class="wa-lgrp" data-g="paras">
          <ul class="wa-lrows">
            {items.map((it) => (
              <ParaRow key={it.id} it={it} onClick={onClick} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Round 10: what WebAble did with one part of the WebAble page, after Jev's probability. */
export function composeLine(g: ComposeGroupState): string {
  if (g.state === 'waiting') return 'Waiting for Jev';
  const did = g.state === 'ready' ? 'laid out' : g.state === 'failed' && g.better !== null ? 'kept the page’s words (a check failed)' : 'kept the page’s words';
  if (g.better === null) return `Couldn’t be checked · ${did}`;
  return `Jev’s probability this layout is easier for you: ${f2(g.better)} · ${did}`;
}

/** Round 10: one line per part of the WebAble page, in the order they were asked for. */
function ComposeSection({ compose }: { compose?: EngineState['compose'] }) {
  const groups = compose && compose.status !== 'idle' ? Object.values(compose.groups ?? {}) : [];
  if (!groups.length) return null;
  return (
    <section class="wa-lcmp" aria-label="Parts of the page laid out for you">
      <h4>
        Parts of the page
        <span class="wa-lgrp-n">{groups.length}</span>
      </h4>
      <ul>
        {groups.map((g, i) => (
          <li key={g.id} data-wa-compose-row={g.id} data-state={g.state}>
            Part {i + 1}: {composeLine(g)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row(props: {
  it: LensItem;
  st: RowStatus;
  covered: string | null;
  listed: boolean;
  hot: boolean;
  pinned: boolean;
  onHover: (id: string | null) => void;
  onFocus: (id: string | null) => void;
  onClick: (id: string) => void;
}) {
  const { it, st, covered, listed, hot, pinned } = props;
  const t = it.track;
  const sub = covered;
  return (
    <li>
      <button
        class="wa-lrow"
        data-id={it.id}
        data-c={it.cls}
        data-hot={String(hot)}
        data-listed={listed ? 'true' : undefined}
        aria-pressed={pinned}
        onMouseEnter={() => props.onHover(it.id)}
        onMouseLeave={() => props.onHover(null)}
        onFocus={() => props.onFocus(it.id)}
        onBlur={() => props.onFocus(null)}
        onClick={() => props.onClick(it.id)}
        title={st === 'hidden' ? 'Not visible on the page right now' : 'Show this element on the page'}
      >
        <span class="wa-lrow-ic" data-c={it.cls} aria-hidden="true">
          <ClassIcon cls={it.cls} size={11} />
        </span>
        <span class="wa-lrow-mid">
          <span class="wa-lrow-label">{it.label}</span>
          {sub ? (
            <span class="wa-lrow-sub">{sub}</span>
          ) : t ? (
            <span class="wa-lrow-track" aria-hidden="true">
              <i class="wa-lrow-fill" style={{ width: pct(t.p) }} />
              <i class="wa-lrow-tick" style={{ left: pct(t.at) }} />
            </span>
          ) : (
            <span class="wa-lrow-sub">{it.byRule ? 'page rule' : it.kind}</span>
          )}
        </span>
        <span class="wa-lrow-end">
          {st === 'up' && <IArrowUp size={12} />}
          {st === 'down' && <IArrowDown size={12} />}
          <b class="wa-lrow-p">{it.num || (t ? f2(t.p) : '')}</b>
        </span>
      </button>
    </li>
  );
}

export function Sheet(p: SheetProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Hovering an element on the page brings its row into view (the sheet scrolls, never the page).
  useEffect(() => {
    const body = bodyRef.current;
    if (!p.revealId || !body || p.tab !== 'elements') return;
    const row = body.querySelector<HTMLElement>(`.wa-lrow[data-id="${CSS.escape(p.revealId)}"]`);
    if (!row) return;
    const rb = row.getBoundingClientRect();
    const bb = body.getBoundingClientRect();
    if (rb.top < bb.top + 8) body.scrollTop -= bb.top + 8 - rb.top;
    else if (rb.bottom > bb.bottom - 8) body.scrollTop += rb.bottom - (bb.bottom - 8);
  }, [p.revealId, p.tab]);

  const hidden = p.items.filter((i) => p.status.get(i.id) === 'hidden');
  const groups = GROUPS.map((g) => ({
    ...g,
    items: p.items
      .filter((i) => g.classes.includes(i.cls) && p.status.get(i.id) !== 'hidden')
      .sort((a, b) => (b.p ?? b.track?.p ?? 0) - (a.p ?? a.track?.p ?? 0) || a.index - b.index),
  })).filter((g) => g.items.length > 0);

  const rowFor = (it: LensItem) => (
    <Row
      key={it.id}
      it={it}
      st={p.status.get(it.id) ?? 'shown'}
      covered={p.covered.get(it.id) ?? null}
      listed={p.listed.has(it.id)}
      hot={p.hotId === it.id}
      pinned={p.pinnedId === it.id}
      onHover={p.onRowHover}
      onFocus={p.onRowFocus}
      onClick={p.onRowClick}
    />
  );

  const copy = async () => {
    const text = JSON.stringify(p.raw, null, 2);
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.append(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const u = p.understanding;
  const digest = p.digest;
  const labelOf = new Map(p.items.map((i) => [i.id, i.label]));
  const showPage = hasPageRead(u);
  const line = purposeLine(u?.purpose);
  const kinds = purposeBars(u?.purpose);
  const region = mainRegionPick(u?.mainRegion);
  const nameOf = (id: string) => regionLabel(id, labelOf, digest);
  const pickRows = u
    ? Object.entries(u.mainPick?.probs ?? {})
        .filter(([, v]) => typeof v === 'number')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
    : [];

  return (
    <div
      class="wa-lsheet"
      ref={p.sheetRef}
      role="region"
      aria-label="Jev's decisions"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          p.onClose();
        }
      }}
    >
      <div class="wa-lsheet-head">
        <h3>
          {p.items.length} elements <span>asked about</span>
        </h3>
        <button class="wa-lx" aria-label="Close the list" onClick={p.onClose}>
          <IClose size={15} />
        </button>
      </div>
      <div class="wa-lseg" role="tablist" aria-label="View">
        {showPage && (
          <button role="tab" aria-selected={p.tab === 'page'} onClick={() => p.onTab('page')}>
            Page
          </button>
        )}
        <button role="tab" aria-selected={p.tab === 'elements'} onClick={() => p.onTab('elements')}>
          Decisions
        </button>
        <button role="tab" aria-selected={p.tab === 'raw'} onClick={() => p.onTab('raw')} disabled={!u}>
          Raw
        </button>
      </div>
      <div class="wa-lsheet-body" ref={bodyRef}>
        {p.tab === 'page' && showPage ? (
          <div class="wa-lraw">
            {kinds.length > 0 && (
              <section aria-label="Kind of page">
                <h4>Kind of page</h4>
                <p>
                  {line ? `${line.sentence}. ` : ''}
                  Jev's probability for each kind, highest first.
                </p>
                <ul class="wa-lpick">
                  {kinds.map((bar) => (
                    <li key={bar.id} data-top={String(bar.id === u?.purpose?.kind)}>
                      <span class="wa-lpick-l">{bar.name}</span>
                      <span class="wa-lpick-bar" aria-hidden="true">
                        <i style={{ width: pct(bar.p) }} />
                      </span>
                      <b class="wa-num">{fmtP(bar.p)}</b>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {region && (
              <section aria-label="What this page is for">
                <h4>What this page is for</h4>
                <p>
                  The region that holds it, then the runner-up. Each number is Jev's probability.
                  {region.runnerUp ? '' : ' No runner-up on this page.'}
                </p>
                <ul class="wa-lpick">
                  <li data-top="true">
                    <span class="wa-lpick-l">{nameOf(region.id)}</span>
                    <span class="wa-lpick-bar" aria-hidden="true">
                      <i style={{ width: pct(region.p) }} />
                    </span>
                    <b class="wa-num">{fmtP(region.p)}</b>
                  </li>
                  {region.runnerUp && (
                    <li data-top="false">
                      <span class="wa-lpick-l">Runner-up · {nameOf(region.runnerUp.id)}</span>
                      <span class="wa-lpick-bar" aria-hidden="true">
                        <i style={{ width: pct(region.runnerUp.p) }} />
                      </span>
                      <b class="wa-num">{fmtP(region.runnerUp.p)}</b>
                    </li>
                  )}
                </ul>
              </section>
            )}
          </div>
        ) : p.tab === 'elements' ? (
          <>
            <ParaSection reword={p.reword} onClick={p.onParaClick} />
            <ComposeSection compose={p.compose} />
            {p.ruleOn && p.diff && (
              <section class="wa-lcmp" aria-label="Jev compared with a plain rule">
                <h4>
                  {p.diff.agrees ? 'Same choices as a plain rule' : 'Where they differ on this page'}
                </h4>
                <ul>
                  {p.diff.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p class="wa-lcmp-rule">
                  <b>The plain rule:</b> main = largest button in the main area (×2 if it looks heavy), never off-site;
                  fold = a word like ad, sponsor, promo or banner; help = help, contact, FAQ, support or call.
                </p>
                <p class="wa-lcmp-foot">{RULE_FOOTER}</p>
              </section>
            )}
            {p.pendingText && groups.length === 0 && <p class="wa-lempty">{p.pendingText}</p>}
            {groups.map((g) => {
              const collapsed = g.key === 'kept' && !taskOpen;
              return (
                <section key={g.key} class="wa-lgrp" data-g={g.key}>
                  {g.key === 'kept' ? (
                    <button class="wa-lgrp-h wa-lgrp-toggle" aria-expanded={!collapsed} onClick={() => setTaskOpen(!taskOpen)}>
                      {collapsed ? <IChevronRight size={12} /> : <IChevronDown size={12} />}
                      <span class="wa-lgrp-t">{g.title}</span>
                      <span class="wa-lgrp-n">{g.items.length}</span>
                    </button>
                  ) : (
                    <div class="wa-lgrp-h">
                      <span class="wa-lgrp-t">{g.title}</span>
                      <span class="wa-lgrp-n">{g.items.length}</span>
                    </div>
                  )}
                  <p class="wa-lgrp-rule">{g.rule}</p>
                  {!collapsed && <ul class="wa-lrows">{g.items.map(rowFor)}</ul>}
                </section>
              );
            })}
            {hidden.length > 0 && (
              <section class="wa-lgrp" data-g="hidden">
                <div class="wa-lgrp-h">
                  <span class="wa-lgrp-t">Not visible now</span>
                  <span class="wa-lgrp-n">{hidden.length}</span>
                </div>
                <p class="wa-lgrp-rule">hidden right now, for example a carousel slide or a closed menu</p>
                <ul class="wa-lrows">{hidden.map(rowFor)}</ul>
              </section>
            )}
          </>
        ) : (
          <div class="wa-lraw">
            <section>
              <h4>What Jev saw</h4>
              <p>
                {digest ? digest.elements.length : 0} elements as structure only: role, size, position, class words and a
                short label, with personal details replaced on this device. No page text, no values typed into fields.
              </p>
              <div class="wa-ltable" role="table" aria-label="Evidence sent to Jev">
                {(digest?.elements ?? []).map((e) => (
                  <div role="row" key={e.id}>
                    <span role="cell" class="wa-ltable-l">{e.label || '·'}</span>
                    <span role="cell">{e.role_hint || e.tag}</span>
                    <span role="cell">{ZONE_SHORT[e.zone] ?? e.zone.replace(/_/g, ' ')}</span>
                    <span role="cell" class="wa-num">{e.size.replace(' px', '').replace(' x ', '×')}</span>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h4>What Jev answered</h4>
              <p>Typed answers per element: its most likely role with Jev's probability, then task, main action and help.</p>
              <div class="wa-ltable" role="table" aria-label="Jev's answers">
                {(u?.elements ?? []).map((j) => (
                  <div role="row" key={j.id}>
                    <span role="cell" class="wa-ltable-l">{labelOf.get(j.id) ?? j.id}</span>
                    <span role="cell">
                      {j.role.replace(/_/g, ' ')} <b class="wa-num">{f2(j.roleP)}</b>
                    </span>
                    <span role="cell" class="wa-num">t {f2(j.task)}</span>
                    <span role="cell" class="wa-num">m {f2(j.main)} · h {f2(j.help)}</span>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h4>Main action pick</h4>
              <p>One question over the main candidates, with “none” as an answer. Sorted by Jev's probability.</p>
              <ul class="wa-lpick">
                {pickRows.map(([id, v]) => (
                  <li key={id} data-top={String(id === u?.mainPick?.id)}>
                    <span class="wa-lpick-l">{id === 'none' ? 'none of these' : labelOf.get(id) ?? id}</span>
                    <span class="wa-lpick-bar" aria-hidden="true">
                      <i style={{ width: pct(v) }} />
                    </span>
                    <b class="wa-num">{f2(v)}</b>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <div class="wa-lraw-json-h">
                <h4>JSON</h4>
                <button class="wa-lbtn wa-lbtn-sm" onClick={() => void copy()}>
                  {copied ? <ICheck size={13} /> : <ICopy size={13} />}
                  {copied ? 'Copied' : 'Copy JSON'}
                </button>
              </div>
              <RawJson value={p.raw} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
