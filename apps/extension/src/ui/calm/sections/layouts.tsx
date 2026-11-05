// Owner: C. One renderer per FitSpec layout. Each arranges some parts specially and draws the rest in order, so no
// visible word or control from the placed part is dropped.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Blocks, BlockView, ControlView, FlowView, ImageView, Picture, PillButton, ResultItem, Thumb, ToolIcon, isResultCard, keepImage } from '../Blocks';
import { BYLINE_RE } from '../compose/composeGroups';
import { useCalm } from '../context';
import { Segments } from '../Grouped';
import { readingParts } from '../grouping';
import * as I from '../icons';
import {
  type Block, type CardLinkBlock, type ControlBlock, type FlowBlock, type ImageBlock, PRICE_RE,
} from '../model';
import { type PlanPart, type PlanSection, allBlocks } from '../plan';

/* ---------- helpers ---------- */

/** Leaf blocks in order (lists and groups opened up; a group's legend becomes a heading). */
export function leaves(blocks: Block[]): Block[] {
  const out: Block[] = [];
  const walk = (bs: Block[]): void => {
    for (const b of bs) {
      if (b.b === 'list') b.items.forEach(walk);
      else if (b.b === 'group') {
        if (b.legend) out.push({ b: 'heading', level: 3, text: b.legend, el: b.src as Element, key: `${b.key}l`, src: b.src });
        walk(b.blocks);
      } else out.push(b);
    }
  };
  walk(blocks);
  return out;
}

const BADGE_RE = /^(new|sale|sponsored|ad|advertisement|best ?seller|popular|limited|exclusive|featured|deal|top rated|\d+% off|save \S+)$/i;
function isBadge(t: string): boolean {
  return t.length <= 22 && (BADGE_RE.test(t) || (/[A-Z]/.test(t) && t === t.toUpperCase() && t.split(' ').length <= 3));
}

interface TileParts {
  image: ImageBlock | null;
  eyebrow: string[];
  title: string | null;
  link: ControlBlock | CardLinkBlock | null;
  lines: string[];
  meta: FlowBlock[];
  actions: ControlBlock[];
  other: Block[];
}

function tileParts(blocks: Block[]): TileParts {
  const t: TileParts = { image: null, eyebrow: [], title: null, link: null, lines: [], meta: [], actions: [], other: [] };
  for (const b of leaves(blocks)) {
    if (b.b === 'image' && !t.image) t.image = b;
    else if (b.b === 'cardlink' && !t.title) {
      t.title = b.title;
      t.link = b;
      t.lines = b.lines;
      if (b.image && !t.image) t.image = b.image;
    } else if (b.b === 'heading' && !t.title) t.title = b.text;
    else if (b.b === 'control' && b.role === 'link' && !b.primary && !t.title) {
      t.title = b.text;
      t.link = b;
    } else if (b.b === 'flow') {
      if (!t.title && isBadge(b.text)) t.eyebrow.push(b.text);
      else if (!t.title && b.text.length <= 120 && !PRICE_RE.test(b.text)) t.title = b.text;
      else t.meta.push(b);
    } else if (b.b === 'control') t.actions.push(b);
    else t.other.push(b);
  }
  return t;
}

function TitleLink({ link, text }: { link: ControlBlock | CardLinkBlock; text: string }): JSX.Element {
  const ctx = useCalm();
  const press = (e: MouseEvent): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    ctx.click(link.el);
  };
  if (!link.href) {
    return (
      <button type="button" class="wa-inline-link" style={{ textDecoration: 'none', color: 'inherit' }} onClick={() => ctx.click(link.el)}>
        {text}
      </button>
    );
  }
  return (
    <a href={link.href} onClick={press}>
      {text}
    </a>
  );
}

function Meta({ f }: { f: FlowBlock }): JSX.Element {
  const price = f.text.length <= 40 && PRICE_RE.test(f.text);
  return price ? <FlowView b={f} /> : <FlowView b={f} quiet />;
}

/** Show the first n, then "Show all N" (n = 0 shows everything). */
function useShowFirst<T>(items: T[], n: number): { shown: T[]; more: JSX.Element | null } {
  const [all, setAll] = useState(false);
  if (!n || items.length <= n) return { shown: items, more: null };
  const more = (
    <div class="wa-more">
      <button type="button" class="wa-btn wa-btn--block" aria-expanded={all} onClick={() => setAll(!all)}>
        {all ? 'Show fewer' : `Show all ${items.length}`}
      </button>
    </div>
  );
  return { shown: all ? items : items.slice(0, n), more };
}

function chunk<T>(xs: T[], n: number): T[][] {
  if (!Number.isFinite(n) || n <= 0) return [xs];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/* ---------- collections ---------- */

function Tile({ blocks }: { blocks: Block[] }): JSX.Element {
  const t = tileParts(blocks);
  return (
    <article class="wa-tile">
      {t.image && keepImage(t.image, true) && <ImageView b={t.image} well />}
      {t.eyebrow.map((e, i) => (
        <span key={i} class="wa-tile__eyebrow">
          {e}
        </span>
      ))}
      {t.title && <h3 class="wa-tile__title">{t.link ? <TitleLink link={t.link} text={t.title} /> : t.title}</h3>}
      {t.lines.map((l, i) => (
        <span key={`l${i}`} class={PRICE_RE.test(l) && l.length < 40 ? 'wa-p--price' : 'wa-meta'}>
          {l}
        </span>
      ))}
      {t.meta.map((f) => (
        <Meta key={f.key} f={f} />
      ))}
      <Blocks blocks={t.other} />
      {t.actions.length > 0 && (
        <div class="wa-tile__actions">
          {t.actions.map((a) => (
            <ControlView key={a.key} b={a} />
          ))}
        </div>
      )}
    </article>
  );
}

export function CardGrid({ p }: { p: PlanSection }): JSX.Element {
  const ctx = useCalm();
  const records = p.records ?? [];
  const { shown, more } = useShowFirst(records, p.showFirst);
  if (!p.records) return <Generic p={p} />;
  if (shown.length && shown.every((r) => resultRecord(r, !!ctx.results))) return <ResultList p={p} shown={shown} more={more} />;
  const controls = onlyControls(allBlocks(p));
  if (controls && controls.length >= 2) return <ChipList controls={controls} />;
  return (
    <div class="wa-stack" style={{ gap: 'var(--wa-card-gap)' }}>
      <Blocks blocks={p.before} />
      <div class="wa-grid">
        {shown.map((r) => (
          <Tile key={r[0]?.key} blocks={r} />
        ))}
      </div>
      {more}
      <Blocks blocks={p.after} />
    </div>
  );
}

/** Thumbnails only when at least half the rows have a picture worth showing. */
function rowsWithThumbs(records: Block[][]): boolean {
  return records.filter((r) => {
    const im = tileParts(r).image;
    return !!im && keepImage(im, true);
  }).length * 2 >= records.length;
}

/** A record that reads as a search result: a title link (with an address line, or any title link on a results page). */
function resultRecord(blocks: Block[], resultsPage: boolean): boolean {
  const t = tileParts(blocks);
  if (!t.link || !t.title || t.actions.length) return false;
  if (t.link.b === 'cardlink') return isResultCard(t.link, resultsPage);
  return resultsPage && !(t.image && keepImage(t.image, true));
}

/** One search result: title link, the address in grey, the snippet (the page's own words). Not a card. */
function ResultRecord({ blocks }: { blocks: Block[] }): JSX.Element {
  const t = tileParts(blocks);
  const link = t.link!;
  return (
    <ResultItem link={link} title={t.title!} lines={t.lines} dek={link.b === 'cardlink' ? link.dek : null}>
      {t.meta.map((f) => (
        <FlowView key={f.key} b={f} />
      ))}
      {t.other.length > 0 ? <Blocks blocks={t.other} /> : null}
    </ResultItem>
  );
}

function ResultList({ p, shown, more }: { p: PlanSection; shown: Block[][]; more: JSX.Element | null }): JSX.Element {
  return (
    <div class="wa-stack" style={{ gap: 'var(--wa-card-gap)' }}>
      <Blocks blocks={p.before} />
      <div class="wa-results">
        {shown.map((r) => (
          <ResultRecord key={r[0]?.key} blocks={r} />
        ))}
      </div>
      {more}
      <Blocks blocks={p.after} />
    </div>
  );
}

function RecordRow({ blocks, thumbs = true }: { blocks: Block[]; thumbs?: boolean }): JSX.Element {
  const ctx = useCalm();
  const t = tileParts(blocks);
  const thumb = thumbs && t.image && keepImage(t.image, true) && <Thumb img={t.image} />;
  const body = (
    <span class="wa-row__main">
      {t.eyebrow.map((e, i) => (
        <span key={i} class="wa-tile__eyebrow">
          {e}
        </span>
      ))}
      {t.title && <span class="wa-row__title">{t.title}</span>}
      {t.lines.map((l, i) => (
        <span key={`l${i}`} class="wa-meta">
          {l}
        </span>
      ))}
      {t.meta.map((f) => (
        <Meta key={f.key} f={f} />
      ))}
      <Blocks blocks={t.other} />
    </span>
  );
  if (t.link && !t.actions.length && !t.other.length) {
    const link = t.link;
    const press = (e: MouseEvent): void => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      ctx.click(link.el);
    };
    const inner = (
      <>
        {thumb}
        {body}
        <I.ChevronRight class="wa-row__chev" />
      </>
    );
    return link.href ? (
      <a class="wa-row" href={link.href} onClick={press}>
        {inner}
      </a>
    ) : (
      <button type="button" class="wa-row" onClick={() => ctx.click(link.el)}>
        {inner}
      </button>
    );
  }
  return (
    <div class="wa-row">
      {thumb}
      {body}
      {(t.actions.length > 0 || t.link) && (
        <span class="wa-row__aside">
          {t.link && t.link.b === 'control' && <ControlView b={t.link} variant="link" />}
          {t.actions.map((a) => (
            <ControlView key={a.key} b={a} />
          ))}
        </span>
      )}
    </div>
  );
}

export function RowList({ p }: { p: PlanSection }): JSX.Element {
  const ctx = useCalm();
  const records = p.records ?? [];
  const { shown, more } = useShowFirst(records, p.showFirst);
  const thumbs = rowsWithThumbs(records);
  if (!p.records) return <Generic p={p} />;
  if (shown.length && shown.every((r) => resultRecord(r, !!ctx.results))) return <ResultList p={p} shown={shown} more={more} />;
  return (
    <div class="wa-stack" style={{ gap: 'var(--wa-card-gap)' }}>
      <Blocks blocks={p.before} />
      <div class="wa-groupgap">
        {chunk(shown, ctx.groupSize).map((g, gi) => (
          <div key={gi} class="wa-rows">
            {g.map((r) => (
              <RecordRow key={r[0]?.key} blocks={r} thumbs={thumbs} />
            ))}
          </div>
        ))}
      </div>
      {more}
      <Blocks blocks={p.after} />
    </div>
  );
}

function textBlocks(bs: Block[]): { k: string; rest: Block[] } | null {
  const ls = leaves(bs);
  const first = ls.find((b) => b.b === 'flow' || b.b === 'heading');
  if (!first) return null;
  return { k: (first as { text: string }).text, rest: ls.filter((b) => b !== first) };
}

export function Facts({ p }: { p: PlanSection }): JSX.Element {
  let rows: Array<{ key: string; k: string; rest: Block[] }> | null = [];
  if (p.records) {
    for (const r of p.records) {
      const t = textBlocks(r);
      if (t) rows.push({ key: r[0]!.key, ...t });
    }
  } else {
    const ls = leaves(p.blocks);
    if (ls.length >= 2 && ls.every((b) => b.b === 'flow' || b.b === 'heading')) {
      for (let i = 0; i < ls.length; i += 2) {
        const a = ls[i] as { text: string; key: string };
        const b = ls[i + 1];
        rows.push({ key: a.key, k: a.text, rest: b ? [b] : [] });
      }
    } else rows = null;
  }
  const { shown, more } = useShowFirst(rows ?? [], p.showFirst);
  if (!rows || p.parts) return <Generic p={p} />;
  return (
    <div class="wa-stack" style={{ gap: 'var(--wa-card-gap)' }}>
      <Blocks blocks={p.before} />
      <div class="wa-facts">
        {shown.map((r) => (
          <div key={r.key} class="wa-fact">
            <span class="wa-fact__k">{r.k}</span>
            <span class="wa-stack" style={{ gap: '4px' }}>
              <Blocks blocks={r.rest} />
            </span>
          </div>
        ))}
      </div>
      {more}
      <Blocks blocks={p.after} />
    </div>
  );
}

function split(p: PlanSection, pick: (b: Block) => boolean): { picked: Block[]; rest: Block[] } {
  const all = leaves(allBlocks(p));
  return { picked: all.filter(pick), rest: all.filter((b) => !pick(b)) };
}

export function ChipBar({ p }: { p: PlanSection }): JSX.Element {
  const { picked, rest } = split(p, (b) => b.b === 'control' && !b.primary);
  const { shown, more } = useShowFirst(picked, p.showFirst);
  return (
    <div class="wa-stack">
      <div class="wa-chips">
        {shown.map((c) => (
          <PillButton key={c.key} b={c as ControlBlock} cls="wa-chip" />
        ))}
      </div>
      {more}
      <Blocks blocks={rest} />
    </div>
  );
}

export function LinkGrid({ p }: { p: PlanSection }): JSX.Element {
  const { picked, rest } = split(p, (b) => b.b === 'control' && !b.primary);
  return (
    <div class="wa-stack">
      <div class="wa-linkgrid">
        {picked.map((c) => (
          <ControlView key={c.key} b={c as ControlBlock} variant="link" />
        ))}
      </div>
      {rest.length > 0 && (
        <div class="wa-stack">
          <Blocks blocks={rest} variant="quiet" />
        </div>
      )}
    </div>
  );
}

export function Gallery({ p }: { p: PlanSection }): JSX.Element {
  const { picked, rest } = split(p, (b) => b.b === 'image');
  const { shown, more } = useShowFirst(picked, p.showFirst);
  return (
    <div class="wa-stack">
      <div class="wa-gallery">
        {shown.map((b) => (
          <ImageView key={b.key} b={b as ImageBlock} well />
        ))}
      </div>
      {more}
      <Blocks blocks={rest} />
    </div>
  );
}

/* ---------- content ---------- */

/** Sections made of unlike parts: each part keeps its own card; a part that is a list of alike records stays one. */
export function Parts({ p }: { p: PlanSection }): JSX.Element {
  return (
    <div class="wa-stack" style={{ gap: 'var(--wa-card-gap)' }}>
      {(p.parts ?? []).map((pt) => (
        <PartView key={pt.key} pt={pt} rows={p.layout === 'row_list'} />
      ))}
    </div>
  );
}

function ChipList({ controls }: { controls: ControlBlock[] }): JSX.Element {
  return (
    <div class="wa-chips">
      {controls.map((c) =>
        c.primary ? <ControlView key={c.key} b={c} /> : <PillButton key={c.key} b={c} cls="wa-chip" />,
      )}
    </div>
  );
}

function onlyControls(bs: Block[]): ControlBlock[] | null {
  const ls = leaves(bs);
  return ls.length && ls.every((b) => b.b === 'control') ? (ls as ControlBlock[]) : null;
}

function PartView({ pt, rows }: { pt: PlanPart; rows: boolean }): JSX.Element {
  const ctx = useCalm();
  const controls = onlyControls([...pt.before, ...pt.blocks, ...(pt.records ?? []).flat(), ...pt.after]);
  if (controls && controls.length >= 2) return <ChipList controls={controls} />;
  if (!pt.records) {
    return (
      <div class="wa-frame">
        <Blocks blocks={pt.blocks} />
      </div>
    );
  }
  return (
    <div class="wa-stack" style={{ gap: 'var(--wa-gap)' }}>
      <Blocks blocks={pt.before} />
      {rows ? (
        <div class="wa-groupgap">
          {chunk(pt.records, ctx.groupSize).map((g, gi) => (
            <div key={gi} class="wa-rows">
              {g.map((r) => (
                <RecordRow key={r[0]?.key} blocks={r} thumbs={rowsWithThumbs(pt.records ?? [])} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div class="wa-grid">
          {pt.records.map((r) => (
            <Tile key={r[0]?.key} blocks={r} />
          ))}
        </div>
      )}
      <Blocks blocks={pt.after} />
    </div>
  );
}

export function Generic({ p, variant }: { p: PlanSection; variant?: 'default' | 'quiet' | 'prose' }): JSX.Element {
  const ctx = useCalm();
  if (p.parts) return <Parts p={p} />;
  // Round 10: a plain part's running text in groups, each laid out for the person once it is ready.
  const segs = p.records ? null : ctx.segments?.get(p.key);
  return (
    <div class="wa-stack">
      <Blocks blocks={p.before} variant={variant} />
      {segs ? (
        <Segments segs={segs} render={(bs) => <Blocks blocks={bs} variant={variant} />} />
      ) : (
        <Blocks blocks={p.records ? p.records.flat() : p.blocks} variant={variant} />
      )}
      <Blocks blocks={p.after} variant={variant} />
    </div>
  );
}

/**
 * Running text in one reading sheet. The byline and date read in the secondary ink; Print / Save / Listen are quiet
 * icon links; a list of links to places on this page becomes "On this page" rows. Articles are never folded.
 */
export function Reading({ p }: { p: PlanSection }): JSX.Element {
  const ctx = useCalm();
  const { tools, toc, body } = readingParts(p);
  // Round 10: the running text in groups, each laid out for the person once it is ready (the page's own words before).
  const segs = ctx.segments?.get(p.key);
  const own = (bs: Block[]): JSX.Element[] =>
    bs.map((b) =>
      b.b === 'flow' && b.text.length <= 140 && BYLINE_RE.test(b.text) ? (
        <p key={b.key} class="wa-p wa-byline">
          {b.text}
        </p>
      ) : (
        <BlockView key={b.key} b={b} variant="prose" />
      ),
    );
  return (
    <div class="wa-sheet">
      <div class="wa-prose">
        {tools.length > 0 && (
          <div class="wa-tools">
            {tools.map((t) => (
              <button key={t.key} type="button" class="wa-btn wa-btn--tool" onClick={() => ctx.click(t.el)}>
                <ToolIcon text={t.text} />
                <span>{t.text}</span>
              </button>
            ))}
          </div>
        )}
        {toc && (
          <div class="wa-stack">
            <h3 class="wa-h-title">On this page</h3>
            <div class="wa-rows">
              {toc.map((l) => (
                <RowLinkInline key={l.key} b={l} />
              ))}
            </div>
          </div>
        )}
        {segs ? <Segments segs={segs} render={own} /> : own(body)}
      </div>
    </div>
  );
}

function RowLinkInline({ b }: { b: ControlBlock }): JSX.Element {
  const ctx = useCalm();
  return (
    <button type="button" class="wa-row" onClick={() => ctx.click(b.el)}>
      <span class="wa-row__main">
        <span class="wa-row__title">{b.text}</span>
      </span>
      <I.ChevronRight class="wa-row__chev" />
    </button>
  );
}

export function AsIs({ p }: { p: PlanSection }): JSX.Element {
  return (
    <div class="wa-frame">
      <Generic p={p} />
    </div>
  );
}

export function Hero({ p }: { p: PlanSection }): JSX.Element {
  const ls = leaves(allBlocks(p));
  let title = p.title;
  let rest = ls;
  if (!title) {
    const h = ls.find((b) => b.b === 'heading');
    if (h && h.b === 'heading') {
      title = h.text;
      rest = ls.filter((b) => b !== h);
    }
  }
  const lead: FlowBlock[] = [];
  while (rest[0]?.b === 'flow' && lead.length < 2) lead.push(rest.shift() as FlowBlock);
  const controls = rest.filter((b): b is ControlBlock => b.b === 'control' && !b.primary);
  const others = rest.filter((b) => !(b.b === 'control' && !b.primary));
  return (
    <div class="wa-stack" style={{ gap: 'var(--wa-head-gap)' }}>
      {title && <h1 class={p.titleSize === 'page' ? 'wa-h-page' : 'wa-h-section'}>{title}</h1>}
      {lead.map((f) => (
        <FlowView key={f.key} b={f} pageline />
      ))}
      <Blocks blocks={others} />
      {controls.length > 0 && (
        <div class="wa-actions">
          {controls.map((c) => (
            <ControlView key={c.key} b={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A product (design.md §2): the main picture in a square `contain` well with up to four more as thumbnails, then the
 * name, the price, option chips and everything else; side by side only at 56em and wider (the picture sticky on the
 * left). The main button is in the dock.
 */
export function BuyBox({ p }: { p: PlanSection }): JSX.Element {
  const ls = leaves(allBlocks(p));
  const pics = ls.filter((b): b is ImageBlock => b.b === 'image' && keepImage(b, true));
  // The largest picture is the product's own; other pictures of the product follow as thumbnails (at most 5 in all).
  const main = pics.reduce<ImageBlock | null>((m, b) => (!m || b.w * b.h > m.w * m.h ? b : m), null);
  const shots = main ? [main, ...pics.filter((b) => b !== main && b.url !== main.url)].slice(0, 5) : [];
  const [sel, setSel] = useState(0);
  const media = shots[Math.min(sel, shots.length - 1)] ?? null;
  const rest = ls.filter((b) => !(b.b === 'image' && (shots.includes(b) || b.logo)));
  const name = rest.find((b) => b.b === 'heading');
  const price = rest.find((b): b is FlowBlock => b.b === 'flow' && b.text.length <= 40 && PRICE_RE.test(b.text));
  const others = rest.filter((b) => b !== name && b !== price);
  return (
    <div class={`wa-buy${media ? '' : ' wa-buy--nomedia'}`}>
      {media && (
        <div class="wa-buy__media">
          <Picture key={media.key} b={{ ...media, important: true }} ratio={1} fit="contain" lead caption={false} />
          {shots.length > 1 && (
            <div class="wa-buy__thumbs">
              {shots.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  class="wa-buy__thumb"
                  aria-pressed={i === sel}
                  aria-label={`Show picture ${i + 1} of ${shots.length}`}
                  onClick={() => setSel(i)}
                >
                  <img src={s.url} alt="" decoding="async" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div class="wa-buy__info">
        {name && name.b === 'heading' && <h2 class="wa-h-section">{name.text}</h2>}
        {price && <p class="wa-buy__price">{price.text}</p>}
        <div class="wa-buy__opts">
          {others.map((b) => (b.b === 'flow' ? <Meta key={b.key} f={b} /> : <BlockView key={b.key} b={b} />))}
        </div>
      </div>
    </div>
  );
}

/** Help is always open: a quiet card with a help icon. */
export function HelpCard({ blocks, title }: { blocks: Block[]; title?: string | null }): JSX.Element {
  return (
    <div class="wa-help">
      <span class="wa-help__icon" aria-hidden="true">
        <I.Help />
      </span>
      <div class="wa-help__body">
        {title && <span class="wa-label">{title}</span>}
        <div class="wa-actions" style={{ gap: '4px 16px' }}>
          <Blocks blocks={blocks} />
        </div>
      </div>
    </div>
  );
}
