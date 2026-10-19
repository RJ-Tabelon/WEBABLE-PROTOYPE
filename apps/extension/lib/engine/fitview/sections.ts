import type {
  ItemKind,
  SectionKind,
  SectionLayout,
  SkeletonNode,
  SpecSection,
} from '@webable/core';
import {
  SECTION_LAYOUTS,
  TRUSTED_SLOT_KINDS,
} from '@webable/core/compose/constants';

import {
  articleChecker,
  quietPlayers,
  readingSheet,
  renderBlocks,
  renderTable,
  renderTextBlock,
  splitParagraph,
} from './article';
import {
  chevron,
  clean,
  disclosure,
  DRAWER_TITLES,
  FV_COPY,
  h,
  isIrreversible,
  mediaBox,
  onPageCard,
  PAGE_LINE,
  PARAGRAPH_LABEL,
  quietLine,
  renderField,
  SECTION_TITLES,
  siteControl,
  subtreeIds,
  VISIBLE_TITLES,
  withScope,
  type RenderCtx,
} from './components';
import { cardDisclosure } from './parts';
import { ratingText, renderCollection, type ListView } from './records';
import { LONG_TITLE_CHARS, LONG_TITLE_CLASS } from './styles';

/**
 * Sections (docs/10 §4.3, docs/11 §3, docs/12 §5–6). render.ts decides where
 * a section goes (the main thing first, then `sectionsOpen` open sections,
 * then drawers); this module draws one section as one Showroom band, by the
 * section's layout:
 *
 *   hero          the page's statement (render.ts); a promo block here is
 *                 drawn as a large spotlight panel
 *   buy_box       a product: media well beside title, price, options and
 *                 full-width buying pills, delivery facts in a tonal box
 *   card_grid,    collections as cards or as one grouped list (records.ts);
 *   row_list      links as rows of a grouped list with chevrons
 *   chip_bar      tabs, filters, sort, pages as a wrapping row of chips (M7)
 *   reading       running text in the reading column (article.ts)
 *   spotlight     feature blocks as raised panels, text beside its picture
 *   link_grid     footers and site maps as columns of quiet links
 *   form_panel    labelled fields proxied to the originals, in a panel
 *   menu          a long set behind one labelled control
 *   as_is         players, maps, frames: "Use this on the page"
 *
 * Below the main thing, ways around the site wait in "More on this page"
 * drawers: raised cards with a title, a count and a chevron.
 */

const LAYOUT_SET: ReadonlySet<string> = new Set(SECTION_LAYOUTS);

/** The layout each kind is drawn with when the spec names none (docs/12 §6.1). */
const LAYOUT_OF: Partial<Record<SectionKind, SectionLayout>> = {
  page_heading: 'hero',
  promo_hero: 'hero',
  product_detail: 'buy_box',
  main_list: 'card_grid',
  related: 'card_grid',
  comments: 'row_list',
  secondary_nav: 'row_list',
  help_and_contact: 'row_list',
  header: 'chip_bar',
  account_and_cart: 'chip_bar',
  primary_nav: 'chip_bar',
  tabs: 'chip_bar',
  filters: 'chip_bar',
  sort_and_view: 'chip_bar',
  breadcrumbs: 'chip_bar',
  pagination: 'chip_bar',
  article: 'reading',
  secondary: 'reading',
  search: 'reading',
  feature_blocks: 'spotlight',
  footer: 'link_grid',
  legal: 'link_grid',
  form: 'form_panel',
  media: 'as_is',
  ads: 'as_is',
  clutter: 'as_is',
  overlay_modal: 'as_is',
  toolbar: 'as_is',
  consent: 'as_is',
  other: 'as_is',
};

/** Layout names of specs written before docs/12 (cached specs, old fixtures). */
const LEGACY_LAYOUT: Readonly<Record<string, SectionLayout>> = {
  grid: 'card_grid',
  list: 'row_list',
  compact_row: 'chip_bar',
  collapsed_menu: 'menu',
};

/** A section's layout: its own when known, an older name mapped, else its kind's. */
export function layoutOf(
  s: Pick<SpecSection, 'kind' | 'layout'>,
): SectionLayout {
  const l = s.layout as string;
  if (LAYOUT_SET.has(l)) return l as SectionLayout;
  const legacy = LEGACY_LAYOUT[l];
  const own = LAYOUT_OF[s.kind] ?? 'reading';
  // A folded footer was one menu; in the Showroom it is a grid of links.
  if (legacy === 'menu' && own === 'link_grid') return own;
  if (legacy) return legacy;
  // "single_column" drew the section in the view: never as_is.
  if (l === 'single_column' || l === 'two_column')
    return own === 'as_is' ? 'reading' : own;
  return own;
}

/** Kinds drawn as pill rows. */
export const PILL_KINDS: ReadonlySet<SectionKind> = new Set([
  'primary_nav',
  'secondary_nav',
  'breadcrumbs',
  'tabs',
  'filters',
  'sort_and_view',
  'pagination',
  'toolbar',
]);

/** Navigation kinds whose overflow is "Site links (n)". */
export const NAV_KINDS: ReadonlySet<SectionKind> = new Set([
  'primary_nav',
  'secondary_nav',
  'header',
  'footer',
]);

/** Pill kinds shown in full (short, and part of the task). */
const ALL_INLINE: ReadonlySet<SectionKind> = new Set([
  'breadcrumbs',
  'pagination',
]);

/** Never collapsed, even when tertiary. */
const NEVER_COLLAPSED: ReadonlySet<SectionKind> = new Set([
  'search',
  'account_and_cart',
  'page_heading',
  'main_list',
  'article',
  'product_detail',
  'form',
  'pagination',
  'consent',
]);

/**
 * Sections that are ways around the site, not the page's content: below the
 * main thing they always wait in "More on this page" drawers (docs/11 R3).
 */
export const WAYFINDING_KINDS: ReadonlySet<SectionKind> = new Set([
  'header',
  'primary_nav',
  'secondary_nav',
  'breadcrumbs',
  'footer',
  'legal',
  'help_and_contact',
  'account_and_cart',
  'toolbar',
  'ads',
  'clutter',
  'overlay_modal',
]);

/** The list's own controls: drawn as one row of chips right above the list (M7). */
export const LIST_TOOL_KINDS: ReadonlySet<SectionKind> = new Set([
  'tabs',
  'filters',
  'sort_and_view',
]);

const NAV_ITEM_KINDS: ReadonlySet<ItemKind> = new Set([
  'nav_link',
  'tab',
  'chip',
  'filter_option',
]);

/** Everything a section renderer needs beyond the context. */
export interface SectionEnv {
  scroller: HTMLElement | null;
  /** Record lists rendered so far, by list id (patching, conservation). */
  lists: Map<string, ListView>;
  /** Fold navigation into "Site links (n)" when the primary section starts too low. */
  compressors: Compressor[];
}

/**
 * At large text the primary section must start in the first viewport. What
 * sits above it folds, a level at a time, until it does:
 *   1  navigation rows fold into "Site links (n)"
 *   2  other pill rows (tabs, chips, filters) fold into "More options (n)"
 *   3  secondary sections collapse behind "Show (n)"
 * Nothing is removed: every fold is one labelled click away.
 */
export interface Compressor {
  /** What it folds (only things above the primary section are folded). */
  el: HTMLElement;
  level: 1 | 2 | 3;
  run(): void;
}

export interface Ordered {
  /** header, search, account_and_cart: the top strip. */
  strip: Array<{ section: SpecSection; index: number }>;
  /** In reading order of their anchors (consent first). */
  body: Array<{ section: SpecSection; index: number }>;
  /** importance 'fold', in reading order. */
  folded: Array<{ section: SpecSection; index: number }>;
}

/** Section order: the original reading order of each section's first node. */
export function orderSections(
  sections: readonly SpecSection[],
  order: ReadonlyMap<string, number>,
  primary: number,
): Ordered {
  const anchor = (s: SpecSection): number =>
    Math.min(
      ...s.node_ids.map((id) => order.get(id) ?? Number.MAX_SAFE_INTEGER),
      Number.MAX_SAFE_INTEGER,
    );
  const all = sections.map((section, index) => ({ section, index }));
  all.sort(
    (a, b) => anchor(a.section) - anchor(b.section) || a.index - b.index,
  );
  const out: Ordered = { strip: [], body: [], folded: [] };
  for (const s of all) {
    if (
      TRUSTED_SLOT_KINDS.includes(s.section.kind) &&
      s.index !== primary &&
      s.section.importance !== 'fold'
    )
      out.strip.push(s);
    else if (s.section.importance === 'fold' && s.index !== primary)
      out.folded.push(s);
    else out.body.push(s);
  }
  // Consent is answered first, never bypassed.
  out.body.sort(
    (a, b) =>
      Number(b.section.kind === 'consent') -
      Number(a.section.kind === 'consent'),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Pill rows
// ---------------------------------------------------------------------------

export type PillItem =
  /** `pin`: always inline (account and cart in the top strip). */
  | { kind: 'control'; el: HTMLElement; pin?: boolean }
  | { kind: 'label'; el: HTMLElement };

function overflowLabel(kind: SectionKind): (n: number) => string {
  if (NAV_KINDS.has(kind)) return FV_COPY.siteLinks;
  if (kind === 'filters') return FV_COPY.moreFilters;
  return FV_COPY.moreOptions;
}

/**
 * A wrapping row of pills: the first `inlineMax` controls inline, the rest
 * behind one labelled control ("Site links (n)"), never a hamburger.
 */
export function pillRow(
  ctx: RenderCtx,
  items: PillItem[],
  inlineMax: number,
  more: (n: number) => string,
  env: SectionEnv | null,
  name?: string,
  level: 1 | 2 = 1,
): HTMLElement {
  const wrap = h(ctx.doc, 'div', 'fv-stack');
  const row = h(ctx.doc, 'ul', 'fv-row-pills fv-plain');
  if (name) row.setAttribute('aria-label', name);
  const controls = items.filter((i) => i.kind === 'control');
  const pinned = controls.filter((i) => i.pin);
  const inline = new Set([
    ...pinned.map((i) => i.el),
    ...controls
      .filter((i) => !i.pin)
      .slice(0, Math.max(0, inlineMax))
      .map((i) => i.el),
  ]);
  for (const i of items) {
    if (i.kind === 'control' && inline.has(i.el)) {
      const li = h(ctx.doc, 'li');
      li.append(i.el);
      row.append(li);
    }
  }
  if (row.childNodes.length) wrap.append(row);
  const rest = items.filter((i) => !(i.kind === 'control' && inline.has(i.el)));
  const restControls = rest.filter((i) => i.kind === 'control').length;
  // Never a disclosure with nothing to press in it ("More options (0)").
  if (rest.length && restControls > 0) {
    const body = (): Node => restBody(ctx, rest);
    wrap.append(
      disclosure(ctx, {
        label: more(restControls),
        render: body,
      }),
    );
  } else if (rest.length) {
    // Only labels left over: show them as they are.
    wrap.append(restBody(ctx, rest));
  }
  // At large text the primary section must start in the first viewport:
  // navigation can fold entirely into its "Site links (n)" control.
  if (env && inline.size - pinned.length >= 2) {
    env.compressors.push({
      el: wrap,
      level,
      run: () => {
        if (!wrap.isConnected || !row.isConnected) return;
        const next = pillRow(ctx, items, 0, more, null, name);
        // Pinned items stay inline; only the rest fold.
        wrap.replaceWith(next);
      },
    });
  }
  return wrap;
}

function restBody(ctx: RenderCtx, rest: PillItem[]): HTMLElement {
  const box = h(ctx.doc, 'div', 'fv-stack');
  let row: HTMLUListElement | null = null;
  for (const i of rest) {
    if (i.kind === 'label') {
      row = null;
      box.append(i.el);
      continue;
    }
    if (!row) {
      row = h(ctx.doc, 'ul', 'fv-row-pills fv-plain');
      box.append(row);
    }
    const li = h(ctx.doc, 'li');
    li.append(i.el);
    row.append(li);
  }
  return box;
}

/** Controls (and short labels) of a navigation-like subtree, in order. */
export function pillItems(ctx: RenderCtx, ids: readonly string[]): PillItem[] {
  const items: PillItem[] = [];
  const visit = (id: string): void => {
    const node = ctx.index.nodes.get(id);
    if (!node) return;
    // Already drawn by another component (a section's heading line).
    if (ctx.isEmitted(id) && node.kind !== 'landmark' && node.kind !== 'group')
      return;
    const el = ctx.registry.element(id);
    switch (node.kind) {
      case 'collection':
        withScope(ctx, ctx.scope ?? id, () => {
          for (const it of collectionPills(ctx, id)) items.push(it);
        });
        ctx.emit(id);
        return;
      case 'control': {
        if (!el) return;
        const c = siteControl(ctx, id, el, { variant: 'pill' });
        if (c) items.push({ kind: 'control', el: c });
        else items.push({ kind: 'control', el: unlabelled(ctx, id, el) });
        // A control's own subtree (an icon, a count) is part of it.
        for (const sub of subtreeIds(ctx.index, id)) ctx.emit(sub);
        return;
      }
      case 'input': {
        if (!el) return;
        const f = renderField(ctx, id, el);
        if (f) items.push({ kind: 'label', el: f });
        return;
      }
      case 'heading':
      case 'stext':
      case 'text': {
        if (!el) return;
        const kids = ctx.index.children.get(id) ?? [];
        if (kids.length) {
          kids.forEach(visit);
          return;
        }
        // A <label> is drawn by its field (its legend or label).
        if (
          el instanceof HTMLLabelElement &&
          el.control &&
          ctx.index.byElement.has(el.control)
        ) {
          ctx.emit(id);
          return;
        }
        const t =
          node.kind === 'heading'
            ? headingEl(ctx, id, el, 3)
            : renderTextBlock(ctx, el, 'p', 't-meta');
        if (t) items.push({ kind: 'label', el: t });
        return;
      }
      case 'media':
        // Decorative in navigation (logos are links with names).
        ctx.emit(id);
        return;
      case 'table': {
        if (!el) return;
        const t = renderTable(ctx, el as HTMLTableElement);
        if (t) items.push({ kind: 'label', el: t });
        return;
      }
      default:
        for (const c of ctx.index.children.get(id) ?? []) visit(c);
    }
  };
  for (const id of ids) visit(id);
  return items;
}

/** One pill per collection member (its own control), proxied by record key. */
function collectionPills(ctx: RenderCtx, listId: string): PillItem[] {
  const out: PillItem[] = [];
  const slots = ctx.index.slots.get(listId) ?? [];
  const root = slots[0];
  if (!root) return out;
  const controlSlots = slots.filter(
    (s) => s.kind === 'control' || s.kind === 'input',
  );
  const textSlots = slots.filter(
    (s) => s.kind === 'stext' || s.kind === 'text' || s.kind === 'heading',
  );
  const members = ctx.registry.members(listId);
  const seen = new Map<string, number>();
  for (const m of members) {
    let key = ctx.registry.recordKey(listId, m) || 'r';
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key = `${key}#${n}`;
    const fingerprint = ctx.registry.fingerprint(listId, m);
    let any = false;
    for (const s of controlSlots) {
      // A control nested in another control slot is part of it.
      if (controlSlots.some((o) => o !== s && within(slots, s.id, o.id)))
        continue;
      const el = s.id === root.id ? m : ctx.registry.slot(listId, m, s.id);
      if (!el) continue;
      const record = { listId, key, fingerprint, slotId: s.id };
      const c =
        s.kind === 'input'
          ? renderField(ctx, s.id, el, { record })
          : siteControl(ctx, s.id, el, { variant: 'pill', record });
      if (c) {
        out.push({ kind: s.kind === 'input' ? 'label' : 'control', el: c });
        any = true;
      }
    }
    if (!any) {
      // A member with no control of its own (the current breadcrumb): its text.
      const src = textSlots.length
        ? (ctx.registry.slot(listId, m, textSlots[0]?.id ?? '') ?? m)
        : m;
      const t = clean(ctx.registry.text(src));
      if (t) out.push({ kind: 'label', el: h(ctx.doc, 'span', 't-body', t) });
    }
  }
  return out;
}

function within(
  slots: readonly SkeletonNode[],
  id: string,
  anc: string,
): boolean {
  const byId = new Map(slots.map((s) => [s.id, s]));
  for (let p = byId.get(id)?.parent ?? null; p; p = byId.get(p)?.parent ?? null)
    if (p === anc) return true;
  return false;
}

/** A control with no accessible name: offered on the page, never a blank button. */
function unlabelled(ctx: RenderCtx, id: string, el: Element): HTMLElement {
  return onPageCard(ctx, id, el, FV_COPY.unlabelled, FV_COPY.showOnPage);
}

// ---------------------------------------------------------------------------
// Link rows and link grids (docs/12 §6.1 row_list, link_grid)
// ---------------------------------------------------------------------------

/** A pill or a line of link text drawn instead as `cls` (a chip is not a row). */
function restyle(el: HTMLElement, cls: string): boolean {
  if (!el.matches('a.fv-pill, button.fv-pill, a.fv-row-link, button.fv-btn'))
    return false;
  if (el.classList.contains('fv-btn--small')) return false;
  el.className = cls;
  return true;
}

/**
 * Links as the rows of one raised, grouped list (Apple's inset lists): each
 * row at least T tall, the whole row its link, a chevron trailing. A heading
 * or a line of text between links starts a new group under it.
 */
export function linkRows(ctx: RenderCtx, items: PillItem[]): HTMLElement {
  const box = h(ctx.doc, 'div', 'fv-stack fv-linkrows');
  let list: HTMLUListElement | null = null;
  for (const i of items) {
    if (i.kind === 'label') {
      list = null;
      box.append(i.el);
      continue;
    }
    if (!list) {
      list = h(ctx.doc, 'ul', 'fv-rows fv-plain');
      box.append(list);
    }
    const li = h(ctx.doc, 'li', 'fv-row fv-row--link');
    if (restyle(i.el, 'fv-listlink')) i.el.append(chevron(ctx.doc));
    li.append(i.el);
    list.append(li);
  }
  return box;
}

/**
 * A long set of links (a footer, a site map) in columns at least 14F wide,
 * on the canvas with no card: quiet grey links, underlined on hover and
 * focus. A heading starts a column; other text follows the grid.
 */
export function linkGrid(ctx: RenderCtx, items: PillItem[]): HTMLElement {
  const box = h(ctx.doc, 'div', 'fv-stack');
  const heads = items.some(
    (i) => i.kind === 'label' && /^h[1-6]$/.test(i.el.localName),
  );
  const grid = h(
    ctx.doc,
    heads ? 'div' : 'ul',
    heads ? 'fv-linkgrid' : 'fv-linkgrid fv-plain',
  );
  const notes: HTMLElement[] = [];
  let col: HTMLElement | null = null;
  for (const i of items) {
    if (i.kind === 'label') {
      if (heads && /^h[1-6]$/.test(i.el.localName)) {
        // A column's heading reads at body size over its links.
        i.el.className = 'fv-linkgrid__head t-body';
        col = h(ctx.doc, 'ul', 'fv-linkgrid__col fv-plain');
        const wrap = h(ctx.doc, 'div', 'fv-linkgrid__group');
        wrap.append(i.el, col);
        grid.append(wrap);
      } else notes.push(i.el);
      continue;
    }
    restyle(i.el, 'fv-gridlink');
    const li = h(ctx.doc, 'li');
    li.append(i.el);
    if (!heads) grid.append(li);
    else {
      if (!col) {
        col = h(ctx.doc, 'ul', 'fv-linkgrid__col fv-plain');
        const wrap = h(ctx.doc, 'div', 'fv-linkgrid__group');
        wrap.append(col);
        grid.append(wrap);
      }
      col.append(li);
    }
  }
  if (grid.childNodes.length) box.append(grid);
  for (const n of notes) box.append(n);
  return box;
}

/**
 * Links drawn as rows or a grid: above the main thing, at large text, they
 * fold into "Site links (n)" like a row of chips would (level 1).
 */
function foldableLinks(
  ctx: RenderCtx,
  items: PillItem[],
  layout: 'row_list' | 'link_grid',
  more: (n: number) => string,
  env: SectionEnv | null,
): HTMLElement {
  const out =
    layout === 'link_grid' ? linkGrid(ctx, items) : linkRows(ctx, items);
  const controls = items.filter((i) => i.kind === 'control').length;
  if (env && controls >= 2)
    env.compressors.push({
      el: out,
      level: 1,
      run: () => {
        if (!out.isConnected) return;
        out.replaceWith(pillRow(ctx, items, 0, more, null));
      },
    });
  return out;
}

// ---------------------------------------------------------------------------
// Generic subtree rendering
// ---------------------------------------------------------------------------

export function headingEl(
  ctx: RenderCtx,
  id: string,
  el: Element,
  level: 1 | 2 | 3,
): HTMLElement | null {
  // The page's title leads the view once (docs/11 R1).
  if (ctx.titleEl === el) {
    for (const sub of subtreeIds(ctx.index, id)) ctx.emit(sub);
    return null;
  }
  let tag: 'h1' | 'h2' | 'h3' = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
  if (tag === 'h1') {
    if (ctx.hasH1) tag = 'h2';
    else ctx.hasH1 = true;
  }
  const cls = tag === 'h1' ? 't-page' : tag === 'h2' ? 't-section' : 't-title';
  const out = h(ctx.doc, tag, `${cls} cue fv-heading`);
  // A heading that is (or holds) a link keeps the link.
  const kids = ctx.index.children.get(id) ?? [];
  const link = kids.find((k) => ctx.index.nodes.get(k)?.kind === 'control');
  const linkEl = link ? ctx.registry.element(link) : null;
  const text = clean(ctx.registry.text(el));
  if (link && linkEl) {
    const c = siteControl(ctx, link, linkEl, {
      variant: 'inline',
      label: clean(ctx.registry.text(linkEl)) || undefined,
    });
    if (c) {
      if (c.localName === 'a') c.className = 'fv-inline';
      out.append(c);
      const rest = text.replace(clean(c.textContent), '').trim();
      if (rest) out.append(ctx.doc.createTextNode(` ${rest}`));
    } else out.textContent = text;
  } else {
    if (!text) return null;
    out.textContent = text;
  }
  // A long page title (a product's name) is drawn at the section size; it
  // stays the page's h1 (docs/12 §4.2).
  if (tag === 'h1' && clean(out.textContent).length > LONG_TITLE_CHARS)
    out.classList.add(LONG_TITLE_CLASS);
  for (const sub of subtreeIds(ctx.index, id)) ctx.emit(sub);
  return out;
}

/** Labels of short, link-like groups render as a column of link rows. */
function isLinkGroup(ctx: RenderCtx, kids: readonly string[]): boolean {
  // A heading already drawn as the section's head is not part of the group.
  const live = kids.filter((k) => !ctx.isEmitted(k));
  if (live.length < 2) return false;
  return live.every((k) => ctx.index.nodes.get(k)?.kind === 'control');
}

/**
 * Render a list of node ids in reading order. Landmarks and groups recurse;
 * text blocks render through the article walker (inline links kept);
 * collections render as records unless the section is navigation.
 */
export function renderNodes(
  ctx: RenderCtx,
  ids: readonly string[],
  env: SectionEnv,
  opts: { kindHint: ItemKind | null; layout: string; pills: boolean },
): HTMLElement {
  const box = h(ctx.doc, 'div', 'fv-stack');
  const ck = articleChecker(ctx);
  const visit = (id: string, into: HTMLElement): void => {
    const node = ctx.index.nodes.get(id);
    if (!node) return;
    const el = ctx.registry.element(id);
    if (!el) return;
    const kids = ctx.index.children.get(id) ?? [];
    // Already drawn by another component (a field's label, a heading's link).
    if (ctx.isEmitted(id) && node.kind !== 'landmark' && node.kind !== 'group')
      return;
    // A <label> names its field, which renders it.
    if (el instanceof HTMLLabelElement && el.control) {
      const cid = ctx.index.byElement.get(el.control);
      if (cid) {
        ctx.emit(id);
        return;
      }
    }
    switch (node.kind) {
      case 'collection': {
        const spec = ctx.collections.get(id);
        const kind = spec?.item_kind ?? opts.kindHint;
        if (opts.pills || (kind && NAV_ITEM_KINDS.has(kind))) {
          const items = collectionPills(ctx, id);
          ctx.emit(id);
          into.append(
            pillRow(
              ctx,
              items,
              ctx.layout.nav.inlineMax,
              FV_COPY.moreOptions,
              env,
              undefined,
              2,
            ),
          );
          return;
        }
        const lv = renderCollection(ctx, id, {
          kindHint: kind ?? null,
          sectionLayout: opts.layout,
          scroller: env.scroller,
        });
        env.lists.set(id, lv);
        ctx.emit(id);
        into.append(lv.root);
        return;
      }
      case 'landmark':
      case 'group': {
        if (!kids.length) {
          const t = renderTextBlock(ctx, el, 'p', 't-body', ck);
          if (t) into.append(t);
          ctx.emit(id);
          return;
        }
        if (isLinkGroup(ctx, kids)) {
          const items = pillItems(ctx, kids);
          const long =
            items.reduce((n, i) => n + clean(i.el.textContent).length, 0) /
              Math.max(1, items.length) >
            28;
          // Long names (and any links of a row list) read as the rows of
          // one grouped list; short ones stay chips.
          if (long || opts.layout === 'row_list') {
            into.append(linkRows(ctx, items));
          } else {
            into.append(
              pillRow(
                ctx,
                items,
                Number.MAX_SAFE_INTEGER,
                FV_COPY.moreOptions,
                null,
              ),
            );
          }
          ctx.emit(id);
          return;
        }
        const group = h(ctx.doc, 'div', 'fv-group');
        for (const k of kids) visit(k, group);
        ctx.emit(id);
        if (group.childNodes.length) into.append(group);
        return;
      }
      case 'heading': {
        const hd = headingEl(ctx, id, el, 3);
        if (hd) into.append(hd);
        return;
      }
      case 'control': {
        const long = clean(ctx.registry.name(el)).length > 24;
        const c = siteControl(ctx, id, el, {
          variant: long ? 'row' : 'btn',
        });
        into.append(c ?? unlabelled(ctx, id, el));
        for (const sub of subtreeIds(ctx.index, id)) ctx.emit(sub);
        return;
      }
      case 'input': {
        const f = renderField(ctx, id, el);
        if (f) into.append(f);
        return;
      }
      case 'media': {
        const tag = el.localName;
        if (tag === 'img' || tag === 'picture' || tag === 'svg') {
          const r = el.getBoundingClientRect();
          if (r.width >= 40 && r.height >= 40) {
            const fig = h(ctx.doc, 'figure');
            const box = mediaBox(ctx, el);
            box.style.setProperty(
              'max-width',
              `${Math.round(r.width / ctx.zoom)}px`,
            );
            fig.append(box);
            into.append(fig);
          }
          ctx.emit(id);
          return;
        }
        const card = onPageCard(
          ctx,
          id,
          el,
          clean(ctx.registry.name(el)) || clean(el.getAttribute('title')),
        );
        if (FV_COPY.players[tag]) card.dataset.player = tag;
        into.append(card);
        return;
      }
      case 'table': {
        const t = renderTable(ctx, el as HTMLTableElement, ck);
        if (t) into.append(t);
        ctx.emit(id);
        return;
      }
      case 'text':
      case 'stext': {
        if (kids.length) {
          // A text block holding other nodes: the walker renders all of it.
          const holder = h(ctx.doc, 'div', 'fv-text fv-stack');
          renderBlocks(ctx, el, holder, ck);
          ctx.emit(id);
          if (holder.childNodes.length) into.append(holder);
          return;
        }
        const t = renderTextBlock(
          ctx,
          el,
          'p',
          node.kind === 'stext' ? 't-body' : 't-body fv-text',
          ck,
        );
        if (t) into.append(node.kind === 'text' ? splitParagraph(ctx, t) : t);
        ctx.emit(id);
        return;
      }
      default:
        for (const k of kids) visit(k, into);
    }
  };
  for (const id of ids) withScope(ctx, id, () => visit(id, box));
  quietPlayers(ctx, box);
  return box;
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

/** "1,299.00", "1.299,00", "1299.00", "89.99": grouped thousands first. */
const PRICE_NUM =
  /(\d{1,3}(?:[,.\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/;

function priceValue(text: string): number | null {
  const m = PRICE_NUM.exec(text.replace(/\u00a0/g, ' '));
  if (!m?.[1]) return null;
  let s = m[1].replace(/\s/g, '');
  // "1.299,00" (comma decimals) vs "1,299.00".
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s))
    s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** The price in the page's own Product JSON-LD (read on this device). */
export function jsonLdPrice(doc: Document): number | null {
  for (const s of Array.from(
    doc.querySelectorAll('script[type="application/ld+json"]'),
  ).slice(0, 12)) {
    let data: unknown;
    try {
      data = JSON.parse(s.textContent ?? '');
    } catch {
      continue;
    }
    const found = findOfferPrice(data, 0);
    if (found !== null) return found;
  }
  return null;
}

function findOfferPrice(v: unknown, depth: number): number | null {
  if (depth > 6 || v === null || typeof v !== 'object') return null;
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 20)) {
      const p = findOfferPrice(x, depth + 1);
      if (p !== null) return p;
    }
    return null;
  }
  const o = v as Record<string, unknown>;
  const type = o['@type'];
  const isProduct =
    type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  if (isProduct || o['@graph']) {
    const offers = o.offers ?? o['@graph'];
    const list = Array.isArray(offers) ? offers : [offers];
    for (const off of list.slice(0, 10)) {
      if (!off || typeof off !== 'object') continue;
      const rec = off as Record<string, unknown>;
      const raw = rec.price ?? rec.lowPrice;
      const n = typeof raw === 'number' ? raw : priceValue(String(raw ?? ''));
      if (n !== null && Number.isFinite(n)) return n;
      const nested = findOfferPrice(off, depth + 1);
      if (nested !== null) return nested;
    }
  }
  return null;
}

const OPTION_ROLES = new Set(['radio', 'option', 'tab', 'switch', 'checkbox']);

/**
 * Option groups this short, with names this short, stay a row of chips (one
 * fewer for a person who needs calm: each chip is a choice on screen).
 */
const CHIPS_MAX = 4;
const CHIPS_MAX_CALM = 3;
const CHIP_LABEL_MAX = 24;
/** Buying words: these actions lead the product's actions. */
const BUY_ACTION =
  /\b(add to (cart|bag|basket|trolley)|buy(\s+it)?\s+now|buy|pre-?order|reserve|in den warenkorb|ajouter au panier|a[ñn]adir al carrito)\b/i;
/** Keeping words: second, after buying. */
const KEEP_ACTION =
  /\b(add to (list|wish ?list|registry)|save for later|join|subscribe)\b/i;
/** Actions shown beside the price; the others follow in reading order. */
const PRODUCT_ACTIONS_MAX = 3;
/** Price words that are not the price people pay now. */
const NOT_THE_PRICE =
  /\b(save|saving|coupon|off|typical|list|was|rrp|msrp|regular|before|retail|delivery|shipping)\b/i;
const UNIT_PRICE = /\/\s?[a-z]|\bper\s+[a-z]|^\(/i;
/** A price inside a control's name ("Regular Price CAD16.99 ..."). */
const PRICE_IN_NAME = /[$€£¥₹]\s?\d|\b(?:USD|CAD|AUD|EUR|GBP|JPY|INR|CHF)\s?\d/;
/** Lines about getting the product: drawn in the buy box's tonal box. */
const DELIVERY =
  /\b(deliver(?:y|ed|s)?|arrives?|shipping|ships|dispatch(?:es|ed)?|pick ?up|returns?|refunds?|in stock|out of stock|warranty)\b/i;
const DELIVERY_CHARS = 200;
const DELIVERY_MAX = 4;

/**
 * A collection of choices (sizes, colours, strengths) rather than records:
 * a radio group or listbox, or items that are radios and options.
 */
export function isOptionList(ctx: RenderCtx, listId: string): boolean {
  const node = ctx.index.nodes.get(listId);
  if (!node || node.kind !== 'collection') return false;
  if (isGallery(ctx, listId)) return false;
  const parent = node.parent ? ctx.index.nodes.get(node.parent) : undefined;
  if (
    [node.role, parent?.role].some((r) => r === 'radiogroup' || r === 'listbox')
  )
    return true;
  return (ctx.index.slots.get(listId) ?? []).some(
    (s) =>
      (s.kind === 'input' &&
        (s.inputType === 'radio' || s.inputType === 'checkbox')) ||
      (s.kind === 'control' &&
        s.role !== null &&
        s.role !== 'tab' &&
        OPTION_ROLES.has(s.role)),
  );
}

/** A run of pictures with no words of their own (a product's image thumbnails). */
function isGallery(ctx: RenderCtx, listId: string): boolean {
  const slots = ctx.index.slots.get(listId) ?? [];
  if (!slots.some((s) => s.kind === 'media' || s.flags.includes('imgctrl')))
    return false;
  return !slots.some(
    (s) =>
      s.kind === 'text' ||
      ((s.kind === 'stext' ||
        s.kind === 'heading' ||
        s.kind === 'input' ||
        (s.kind === 'control' && !s.flags.includes('imgctrl'))) &&
        clean(s.label) !== ''),
  );
}

/** Each option of a choice list: its own control (or the item itself), proxied by record key. */
function optionItems(ctx: RenderCtx, listId: string): PillItem[] {
  const out: PillItem[] = [];
  const slots = ctx.index.slots.get(listId) ?? [];
  const root = slots[0];
  if (!root) return out;
  const choice: SkeletonNode =
    slots.find(
      (s) =>
        (s.kind === 'input' || s.kind === 'control') &&
        !slots.some(
          (o) =>
            o !== s &&
            (o.kind === 'input' || o.kind === 'control') &&
            within(slots, s.id, o.id),
        ),
    ) ?? root;
  const members = ctx.registry.members(listId);
  const seen = new Map<string, number>();
  for (const m of members) {
    let key = ctx.registry.recordKey(listId, m) || 'r';
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key = `${key}#${n}`;
    // The exemplar's root may be the control itself (wrappers flattened
    // away): it is found inside the item, never the item for it.
    const el = ctx.registry.slot(listId, m, choice.id) ?? m;
    const name =
      clean(ctx.registry.name(el)) ||
      clean(ctx.registry.text(el)) ||
      clean(ctx.registry.text(m));
    const record = {
      listId,
      key,
      fingerprint: ctx.registry.fingerprint(listId, m),
      slotId: choice.id,
    };
    // An option is pressed or not, as its original is checked or selected
    // (followed live); an item that is not a control states it on itself.
    const c = siteControl(ctx, choice.id, el, {
      variant: 'pill',
      record,
      label: name,
      state: el === m ? undefined : optionOn(m) || undefined,
    });
    if (c) out.push({ kind: 'control', el: c });
  }
  return out;
}

function optionOn(el: Element): boolean {
  if (el instanceof HTMLInputElement && el.checked) return true;
  return (
    el.getAttribute('aria-checked') === 'true' ||
    el.getAttribute('aria-selected') === 'true' ||
    el.getAttribute('aria-pressed') === 'true'
  );
}

/** The option that is chosen now, by its name. */
function chosenName(ctx: RenderCtx, listId: string): string {
  const slots = ctx.index.slots.get(listId) ?? [];
  const choice = slots.find((s) => s.kind === 'input' || s.kind === 'control');
  for (const m of ctx.registry.members(listId)) {
    const el = choice ? (ctx.registry.slot(listId, m, choice.id) ?? m) : m;
    if ((el && optionOn(el)) || optionOn(m))
      return clean(ctx.registry.name(el ?? m)) || clean(ctx.registry.text(m));
  }
  return '';
}

/**
 * The words that name an option group: a short line just before it ("Set
 * name: 1.5 X", drawn as a heading, a label or a collapse button), else the
 * group's own accessible name.
 */
function optionHeader(
  ctx: RenderCtx,
  listId: string,
  taken: ReadonlySet<string>,
): { id: string | null; text: string } {
  let cur: string | null = listId;
  for (let up = 0; cur && up < 3; up++) {
    const parent: string | null = ctx.index.nodes.get(cur)?.parent ?? null;
    if (!parent) break;
    const sibs = ctx.index.children.get(parent) ?? [];
    for (let i = sibs.indexOf(cur) - 1; i >= 0; i--) {
      const id = sibs[i] as string;
      const n = ctx.index.nodes.get(id);
      if (!n || taken.has(id)) continue;
      if (n.kind !== 'stext' && n.kind !== 'heading' && n.kind !== 'control')
        break;
      // A link, an icon or a picture before the group does not name it.
      if (
        n.kind === 'control' &&
        (n.role === 'link' ||
          n.flags.includes('icon') ||
          n.flags.includes('imgctrl'))
      )
        break;
      const el = ctx.registry.element(id);
      // Words already drawn (a field's own label) name something else.
      if (
        !el ||
        ctx.isEmitted(id) ||
        (el instanceof HTMLLabelElement && el.control)
      )
        break;
      const t = clean(ctx.registry.text(el)) || clean(n.label);
      if (t && t.length <= 48) return { id, text: t };
      break;
    }
    cur = parent;
  }
  const el = ctx.registry.element(listId);
  const own = el ? clean(ctx.registry.name(el)) : '';
  return { id: null, text: own };
}

/**
 * One compact picker for an option group: up to four short options as a
 * row of chips; more (or longer) ones behind one control that says what is
 * chosen and how many there are ("Set name: 1.5 X · 16 options"), never a
 * list of values down the page.
 */
export function optionPicker(
  ctx: RenderCtx,
  listId: string,
  header: { id: string | null; text: string },
): HTMLElement {
  const wrap = h(ctx.doc, 'div', 'fv-picker');
  wrap.dataset.options = listId;
  const n = ctx.registry.members(listId).length;
  const chosen = chosenName(ctx, listId);
  let name = header.text;
  if (name && chosen && !name.includes(':') && !name.includes(chosen))
    name = `${name}: ${chosen}`;
  else if (!name) name = chosen;
  if (header.id) ctx.emit(header.id);
  const names = ctx.registry
    .members(listId)
    .map((m) => clean(ctx.registry.name(m)) || clean(ctx.registry.text(m)));
  const calm = (ctx.layout.structure?.level ?? 0) === 2;
  const short =
    n <= (calm ? CHIPS_MAX_CALM : CHIPS_MAX) &&
    names.every((t) => t.length <= CHIP_LABEL_MAX);
  if (short) {
    if (header.text)
      wrap.append(h(ctx.doc, 'p', 'fv-picker__label t-meta', header.text));
    wrap.append(
      pillRow(
        ctx,
        optionItems(ctx, listId),
        Number.MAX_SAFE_INTEGER,
        FV_COPY.moreOptions,
        null,
        header.text || undefined,
      ),
    );
    ctx.emit(listId);
    return wrap;
  }
  const scope = ctx.scope;
  wrap.append(
    disclosure(ctx, {
      label: [name, FV_COPY.options(n)].filter(Boolean).join(' · '),
      cls: 'fv-picker__sheet',
      reach: subtreeIds(ctx.index, listId),
      render: () =>
        withScope(ctx, scope ?? listId, () =>
          pillRow(
            ctx,
            optionItems(ctx, listId),
            Number.MAX_SAFE_INTEGER,
            FV_COPY.moreOptions,
            null,
            name || undefined,
          ),
        ),
    }),
  );
  ctx.emit(listId);
  return wrap;
}

/** How much a price text looks like what the item costs now (lower is better). */
function priceRank(text: string): number {
  return (NOT_THE_PRICE.test(text) ? 2 : 0) + (UNIT_PRICE.test(text) ? 2 : 0);
}

/**
 * Product detail (docs/11 §4: the first screen of a product): the price,
 * rating, option pickers and buying actions in one column, the product's
 * picture beside it (capped), then everything else in reading order
 * (delivery, seller, returns, details). The price shown first is the one
 * the page's JSON-LD names, else the current price (not a saving, a list
 * price or a price per unit). Irreversible actions are never emphasised.
 */
export function renderProduct(
  ctx: RenderCtx,
  section: SpecSection,
  env: SectionEnv,
): HTMLElement {
  const box = h(ctx.doc, 'div', 'fv-product');
  type Leaf = { id: string; node: SkeletonNode; el: Element; scope: string };
  const leaves: Leaf[] = [];
  const lists: Array<{ id: string; scope: string }> = [];
  const visit = (id: string, scope: string): void => {
    const node = ctx.index.nodes.get(id);
    const el = node ? ctx.registry.element(id) : null;
    if (!node || !el) return;
    if (node.kind === 'collection') {
      lists.push({ id, scope });
      leaves.push({ id, node, el, scope });
      return;
    }
    const kids = ctx.index.children.get(id) ?? [];
    if ((node.kind === 'landmark' || node.kind === 'group') && kids.length) {
      ctx.emit(id);
      for (const k of kids) visit(k, scope);
      return;
    }
    leaves.push({ id, node, el, scope });
  };
  for (const id of section.node_ids) visit(id, id);

  const titleLeaf =
    leaves.find((l) => l.node.kind === 'heading' && (l.node.level ?? 2) <= 1) ??
    leaves.find((l) => l.node.kind === 'heading');
  const isPrice = (l: Leaf): boolean =>
    (l.node.kind === 'stext' || l.node.kind === 'text') &&
    (l.node.text?.pat?.includes('price') ?? false);
  const isRating = (l: Leaf): boolean =>
    (l.node.text?.pat?.includes('rating') ?? false) ||
    (l.node.kind === 'control' &&
      /\bout of 5\b|\bstars?\b/i.test(ctx.registry.name(l.el)));
  const isOption = (l: Leaf): boolean => {
    if (l.node.kind === 'input') return true;
    if (l.node.kind !== 'control') return false;
    if (l.node.role && OPTION_ROLES.has(l.node.role)) return true;
    // A current link ("1", a carousel's page) is not a product option.
    if (l.node.role === 'link' || l.node.tag === 'a') return false;
    return (
      l.node.flags.includes('selected') ||
      l.node.role === 'combobox' ||
      l.node.flags.includes('popup')
    );
  };
  const used = new Set<string>();
  const take = (l: Leaf | undefined): Leaf | undefined => {
    if (l) used.add(l.id);
    return l;
  };

  const buy = h(ctx.doc, 'div', 'fv-product__buy');
  const media = h(ctx.doc, 'div', 'fv-product__media');
  // The product's name leads the buying column (when the view's hero has
  // not drawn it already as the page's title).
  if (take(titleLeaf) && titleLeaf) {
    const hd = headingEl(ctx, titleLeaf.id, titleLeaf.el, 1);
    if (hd) buy.append(hd);
  }

  // The product's picture: its largest still image (or the image button
  // that opens the site's viewer), capped; thumbnails are one quiet line.
  const area = (l: Leaf): number => l.node.box[2] * l.node.box[3];
  const hero = leaves
    .filter(
      (l) =>
        ((l.node.kind === 'media' &&
          (l.el.localName === 'img' || l.el.localName === 'picture')) ||
          (l.node.kind === 'control' && l.node.flags.includes('imgctrl'))) &&
        l.node.box[2] >= 120 &&
        l.node.box[3] >= 120,
    )
    .sort((a, b) => area(b) - area(a))[0];
  const calm = (ctx.layout.structure?.level ?? 0) === 2;
  if (hero) {
    const img =
      hero.node.kind === 'media'
        ? hero.el
        : (hero.el.querySelector('img, picture') ?? hero.el);
    const pic = mediaBox(
      ctx,
      img,
      'fv-thumb fv-thumb--contain fv-product__img',
    );
    // The picture opens the site's viewer; for a person who needs calm it
    // is a picture, and the viewer's control waits with the rest.
    if (!(calm && hero.node.kind === 'control')) take(hero);
    withScope(ctx, hero.scope, () => {
      const opener =
        hero.node.kind === 'control' && !calm
          ? siteControl(ctx, hero.id, hero.el, { variant: 'title' })
          : null;
      if (opener) {
        opener.className = 'fv-thumb-open';
        opener.textContent = '';
        opener.append(pic);
        media.append(opener);
      } else {
        media.append(pic);
        if (hero.node.kind === 'media') ctx.emit(hero.id);
      }
    });
  }
  for (const l of lists) {
    const leaf = leaves.find((x) => x.id === l.id);
    // For a person who needs calm the thumbnails wait with the rest.
    if (calm || !leaf || used.has(l.id) || !isGallery(ctx, l.id)) continue;
    take(leaf);
    const n = ctx.registry.members(l.id).length;
    const [one, many, go] = FV_COPY.players.images as readonly [
      string,
      string,
      string,
    ];
    media.append(
      quietLine(ctx, `${n} ${n === 1 ? one : many}`, go, l.id, leaf.el),
    );
  }

  // Prices: the one the JSON-LD names, else the current one, leads.
  const prices = leaves.filter(isPrice);
  if (prices.length) {
    const ld = jsonLdPrice(ctx.doc);
    const row = h(ctx.doc, 'div', 'fv-prices');
    const texts = prices.map((p) => ({
      p,
      text: clean(ctx.registry.text(p.el)),
    }));
    let lead =
      ld === null ? -1 : texts.findIndex((t) => priceValue(t.text) === ld);
    if (lead < 0) {
      const best = [...texts.keys()].sort(
        (a, b) =>
          priceRank(texts[a]?.text ?? '') - priceRank(texts[b]?.text ?? '') ||
          a - b,
      )[0];
      if (best !== undefined && priceRank(texts[best]?.text ?? '') === 0)
        lead = best;
    }
    const ordered =
      lead >= 0 ? [texts[lead], ...texts.filter((_, i) => i !== lead)] : texts;
    const shownPrices = new Set<string>();
    ordered.forEach((t, i) => {
      if (!t || !t.text) return;
      take(t.p);
      // The same price drawn twice (a buy box and the page's own) shows once.
      if (shownPrices.has(t.text)) {
        ctx.emit(t.p.id);
        return;
      }
      shownPrices.add(t.text);
      // Prices after the first show with their own label (list, deal, unit).
      const label =
        lead < 0 || i > 0
          ? priceLabel(
              ctx,
              t.p.el,
              t.text,
              prices.map((x) => x.el),
            )
          : t.text;
      // The price people pay now at title size; list, deal and unit prices
      // quietly after it.
      const s = h(
        ctx.doc,
        'span',
        i === 0 && lead >= 0
          ? 'is-primary t-title'
          : lead >= 0
            ? 't-meta'
            : 't-body fv-price',
        label,
      );
      row.append(s);
      ctx.emit(t.p.id);
    });
    if (row.childNodes.length) buy.append(row);
  }
  // Rating: "4.4 ★" (the stars' own control), then the count beside it.
  const ratingRow = h(ctx.doc, 'p', 'fv-rating t-meta');
  for (const r of leaves.filter((l) => !used.has(l.id) && isRating(l))) {
    take(r);
    withScope(ctx, r.scope, () => {
      // For a person who needs calm the stars are a fact to read; their
      // pop-up waits with the rest.
      if (calm && r.node.kind === 'control') {
        const name = clean(ctx.registry.name(r.el));
        const shown = h(ctx.doc, 'span', null, ratingText(name));
        shown.setAttribute('aria-hidden', 'true');
        ratingRow.append(shown, h(ctx.doc, 'span', 'fv-sr', name));
        used.delete(r.id);
      } else if (r.node.kind === 'control') {
        const c = siteControl(ctx, r.id, r.el, { variant: 'inline' });
        if (c) {
          const name = clean(ctx.registry.name(r.el));
          const short = ratingText(name);
          if (short !== name) {
            c.textContent = short;
            c.setAttribute('aria-label', name);
          }
          ratingRow.append(c);
        }
      } else {
        const t = clean(ctx.registry.text(r.el));
        if (t) ratingRow.append(h(ctx.doc, 'span', null, ratingText(t)));
        ctx.emit(r.id);
      }
    });
    // The count that follows the stars ("2,466 Reviews") stays with them.
    const parent = r.node.parent;
    const count = leaves.find(
      (l) =>
        !used.has(l.id) &&
        l.node.parent === parent &&
        l.node.kind === 'control' &&
        (l.node.text?.pat?.includes('count') ?? false),
    );
    if (count && take(count)) {
      withScope(ctx, count.scope, () => {
        const c = siteControl(ctx, count.id, count.el, { variant: 'inline' });
        if (c) {
          const sep = h(ctx.doc, 'span', 'fv-sep', ' · ');
          sep.setAttribute('aria-hidden', 'true');
          ratingRow.append(sep, c);
        }
      });
    }
  }
  if (ratingRow.childNodes.length) buy.append(ratingRow);

  // Options (size, colour, strength) before the actions that depend on
  // them: each group one compact picker.
  const options = leaves.filter((l) => !used.has(l.id) && isOption(l));
  const optionLists = lists.filter(
    (l) => !used.has(l.id) && isOptionList(ctx, l.id),
  );
  if (options.length || optionLists.length) {
    const opt = h(ctx.doc, 'div', 'fv-stack fv-options-block');
    for (const l of leaves) {
      if (used.has(l.id)) continue;
      if (optionLists.some((x) => x.id === l.id)) {
        take(l);
        withScope(ctx, l.scope, () => {
          const header = optionHeader(ctx, l.id, used);
          if (header.id) used.add(header.id);
          opt.append(optionPicker(ctx, l.id, header));
        });
        continue;
      }
      if (!options.includes(l)) continue;
      take(l);
      withScope(ctx, l.scope, () => {
        const c =
          l.node.kind === 'input'
            ? renderField(ctx, l.id, l.el)
            : siteControl(ctx, l.id, l.el, { variant: 'pill' });
        if (c) opt.append(c);
      });
    }
    if (opt.childNodes.length) buy.append(opt);
  }
  // Actions: buying first (Add to Cart, Buy Now), then keeping (Add to
  // List, Join); the first reversible one is the emphasised action. Icons,
  // pictures and paragraphs-as-buttons follow with the rest.
  const actionRank = (l: Leaf): number => {
    const name = clean(ctx.registry.name(l.el)) || clean(l.node.label);
    if (BUY_ACTION.test(name)) return 0;
    if (KEEP_ACTION.test(name)) return 1;
    return name.length > PARAGRAPH_LABEL ? 3 : 2;
  };
  // For a person who needs calm: the buying actions only (Add to Cart, Buy
  // Now); keeping ones (Add to List) wait with the rest.
  const maxRank = calm ? 0 : 2;
  const candidates = leaves
    .filter((l) => {
      if (used.has(l.id) || l.node.kind !== 'control') return false;
      if (l === hero) return false;
      if (l.node.flags.includes('icon') || l.node.flags.includes('imgctrl'))
        return false;
      // A heading that opens or closes a panel ("Prime Member Price ...")
      // is part of what it opens, not an action.
      if (
        l.node.flags.includes('expanded') ||
        l.el.hasAttribute('aria-expanded')
      )
        return false;
      const link = l.node.role === 'link' || l.node.tag === 'a';
      return !link || actionRank(l) <= 1;
    })
    .sort((a, b) => actionRank(a) - actionRank(b))
    .slice(0, calm ? PRODUCT_ACTIONS_MAX - 1 : PRODUCT_ACTIONS_MAX)
    .filter((l) => actionRank(l) <= maxRank);
  // No buying action on the page as it stands (Add to Cart waits inside a
  // price panel that is closed): the price panels themselves are how to buy,
  // so they come first, never emphasised.
  const panels = candidates.some((l) => actionRank(l) === 0)
    ? []
    : leaves
        .filter((l) => {
          if (used.has(l.id) || l.node.kind !== 'control' || l === hero)
            return false;
          if (l.node.role === 'link' || l.node.tag === 'a') return false;
          const name = clean(ctx.registry.name(l.el));
          return PRICE_IN_NAME.test(name) && name.split(' ').length >= 3;
        })
        .slice(0, 2);
  if (panels.length) {
    const opts = h(ctx.doc, 'div', 'fv-stack fv-buyopts');
    for (const l of panels) {
      take(l);
      withScope(ctx, l.scope, () => {
        const c = siteControl(ctx, l.id, l.el, { variant: 'btn' });
        if (c) opts.append(c);
      });
    }
    if (opts.childNodes.length) buy.append(opts);
  }
  const actions = h(ctx.doc, 'div', 'fv-actions');
  let filled = false;
  for (const l of candidates) {
    take(l);
    withScope(ctx, l.scope, () => {
      const c = siteControl(ctx, l.id, l.el, { variant: 'btn', fill: !filled });
      if (c) {
        if (c.classList.contains('fv-btn--fill')) filled = true;
        actions.append(c);
      } else actions.append(unlabelled(ctx, l.id, l.el));
    });
  }
  if (actions.childNodes.length) buy.append(actions);

  // Delivery and returns: the short lines about getting the product sit in
  // one tonal box under the actions (the words are the page's).
  const delivery = leaves
    .filter(
      (l) =>
        !used.has(l.id) &&
        (l.node.kind === 'stext' || l.node.kind === 'text') &&
        !ctx.index.children.get(l.id)?.length &&
        (l.node.text?.chars ?? 0) <= DELIVERY_CHARS &&
        DELIVERY.test(clean(ctx.registry.text(l.el))),
    )
    .slice(0, DELIVERY_MAX);
  if (delivery.length) {
    const facts = h(ctx.doc, 'div', 'fv-product__facts');
    for (const l of delivery) {
      take(l);
      withScope(ctx, l.scope, () => {
        const t = renderTextBlock(ctx, l.el, 'p', 't-body');
        if (t) facts.append(t);
      });
      ctx.emit(l.id);
    }
    if (facts.childNodes.length) buy.append(facts);
  }

  if (media.childNodes.length) {
    // The buying column reads first; the picture sits beside it in a well
    // (on the left from 900 px, after it below that).
    const top = h(ctx.doc, 'div', 'fv-product__top');
    top.append(buy, media);
    box.append(top);
  } else box.append(buy);

  // Everything else, in reading order (description, delivery, seller,
  // returns): open below, or for a person who needs calm one click away
  // with a count (docs/11 R3), so the first screen is the decision.
  const rest = leaves.filter((l) => !used.has(l.id)).map((l) => l.id);
  if (rest.length && calm) {
    const scope = ctx.scope;
    box.append(
      disclosure(ctx, {
        label: FV_COPY.productMore(rest.length),
        cls: 'fv-product__more',
        reach: rest.flatMap((id) => subtreeIds(ctx.index, id)),
        render: () =>
          withScope(ctx, scope ?? section.node_ids[0] ?? '', () =>
            renderNodes(ctx, rest, env, {
              kindHint: null,
              layout: layoutOf(section),
              pills: false,
            }),
          ),
      }),
    );
  } else if (rest.length)
    box.append(
      renderNodes(ctx, rest, env, {
        kindHint: null,
        layout: layoutOf(section),
        pills: false,
      }),
    );
  return box;
}

function priceLabel(
  ctx: RenderCtx,
  el: Element,
  price: string,
  others: readonly Element[],
): string {
  // A price whose own text carries no words takes its label from its parent
  // ("List:" + "$29.99"), unless the parent holds other prices too.
  if (/[a-z]{2,}/i.test(price)) return price;
  const parent = el.parentElement;
  if (!parent || others.some((o) => o !== el && parent.contains(o)))
    return price;
  const t = clean(ctx.registry.text(parent));
  return t && t.length <= 48 && t.includes(price) ? t : price;
}

// ---------------------------------------------------------------------------
// One section
// ---------------------------------------------------------------------------

/** A section's own heading: its heading_ref, else WebAble's template title. */
function sectionHeading(
  ctx: RenderCtx,
  s: SpecSection,
  primary: boolean,
): { el: HTMLElement | null; name: string } {
  if (s.heading_ref) {
    const el = ctx.registry.element(s.heading_ref);
    if (el) {
      const level = s.kind === 'page_heading' ? 1 : 2;
      const hd = headingEl(ctx, s.heading_ref, el, level);
      if (hd) return { el: hd, name: clean(hd.textContent) };
    }
  }
  if (s.kind === 'page_heading') return { el: null, name: '' };
  const title = SECTION_TITLES[s.kind];
  if (!title) return { el: null, name: '' };
  // Primary content, navigation and small sections need no visible template title.
  if (primary || PILL_KINDS.has(s.kind) || !VISIBLE_TITLES.has(s.kind))
    return { el: null, name: title };
  return {
    el: h(ctx.doc, 'h2', 't-section fv-heading', title),
    name: title,
  };
}

/**
 * The grey count beside a section's heading, Apple's "The latest. Take a
 * look." pattern: how many records the section's lists hold ("12 videos"),
 * from the spec's item kind, never generated prose. Null below two.
 */
function headCount(
  ctx: RenderCtx,
  env: SectionEnv,
  body: HTMLElement,
): HTMLElement | null {
  const lists = [...env.lists.values()].filter((l) => body.contains(l.root));
  const first = lists[0];
  if (!first) return null;
  const n = lists.reduce(
    (a, l) => a + l.order.length - l.ads.length + l.overflow,
    0,
  );
  if (n < 2) return null;
  return h(
    ctx.doc,
    'p',
    'fv-section__count t-section',
    PAGE_LINE.count(n, first.spec.item_kind),
  );
}

export interface SectionOpts {
  /** Drawn inside a "More on this page" drawer: the drawer is its title and its fold. */
  inDrawer?: boolean;
  /** The list's own controls, drawn first inside the section (chips, docs/11 M7). */
  tools?: HTMLElement | null;
  /** Drawn after the section's content (the list's pages). */
  after?: HTMLElement | null;
}

/**
 * One section as one band: its head (the heading at section size and a grey
 * count), then its body by layout. A spotlight with one panel takes the
 * heading into the panel.
 */
export function renderSection(
  ctx: RenderCtx,
  s: SpecSection,
  primary: boolean,
  env: SectionEnv,
  opts: SectionOpts = {},
): HTMLElement | null {
  const nav = PILL_KINDS.has(s.kind) || s.kind === 'header';
  const layout = layoutOf(s);
  // Bands of different layouts are told apart by their class too: a run of
  // sections is a page's bands, not a list of records (docs/11 §4).
  const sec = h(
    ctx.doc,
    nav ? 'nav' : 'section',
    `fv-section fv-section--${layout}`,
  );
  sec.dataset.kind = s.kind;
  sec.dataset.layout = layout;
  if (primary) sec.dataset.primary = 'true';
  const head = opts.inDrawer
    ? { el: null, name: drawerTitle(ctx, s) }
    : sectionHeading(ctx, s, primary);
  if (opts.inDrawer && s.heading_ref) {
    // The drawer's label carries the heading's words.
    for (const sub of subtreeIds(ctx.index, s.heading_ref)) ctx.emit(sub);
  }
  const ids = s.node_ids.filter((id) => id !== s.heading_ref);
  const bar = h(ctx.doc, 'div', 'fv-section__head');
  if (head.el) {
    head.el.id = ctx.uid('h');
    bar.append(head.el);
    sec.append(bar);
    sec.setAttribute('aria-labelledby', head.el.id);
  } else if (head.name) {
    sec.setAttribute('aria-label', head.name);
  }
  const collapsed =
    !primary &&
    !opts.inDrawer &&
    !NEVER_COLLAPSED.has(s.kind) &&
    ((s.importance === 'tertiary' && ctx.layout.tertiary === 'collapsed') ||
      layout === 'menu');
  // The heading, until a single spotlight panel takes it (never from
  // behind a fold: the toggle needs its title above it).
  const lead = { head: collapsed ? null : head.el };
  const body = (): HTMLElement =>
    sectionBody(ctx, s, ids, primary, env, opts.inDrawer ?? false, lead);
  if (collapsed) {
    sec.append(collapsedBody(ctx, s, ids, body));
    if (s.heading_ref) ctx.emit(s.heading_ref);
    return sec;
  }
  const b = body();
  if (head.el && !lead.head) bar.remove();
  else if (head.el && !primary) {
    const count = headCount(ctx, env, b);
    if (count) bar.append(count);
  }
  if (opts.tools) sec.append(opts.tools);
  if (!b.childNodes.length && !head.el && !opts.tools && !opts.after)
    return null;
  sec.append(b);
  if (opts.after) sec.append(opts.after);
  if (
    !primary &&
    !opts.inDrawer &&
    !NEVER_COLLAPSED.has(s.kind) &&
    !PILL_KINDS.has(s.kind)
  ) {
    env.compressors.push({
      el: sec,
      level: 3,
      run: () => {
        if (!b.isConnected) return;
        b.replaceWith(collapsedBody(ctx, s, ids, () => b));
      },
    });
  }
  return sec;
}

/** A section behind one labelled toggle, with a count of what it holds. */
function collapsedBody(
  ctx: RenderCtx,
  s: SpecSection,
  ids: readonly string[],
  body: () => HTMLElement,
): HTMLElement {
  const reach = ids.flatMap((id) => subtreeIds(ctx.index, id));
  const links = PILL_KINDS.has(s.kind) || NAV_KINDS.has(s.kind);
  const n = reach.filter((id) => {
    const k = ctx.index.nodes.get(id)?.kind;
    return links
      ? k === 'control'
      : k === 'control' || k === 'text' || k === 'heading' || k === 'stext';
  }).length;
  return disclosure(ctx, {
    label: links ? overflowLabel(s.kind)(n) : `${drawerTitle(ctx, s)} (${n})`,
    render: body,
    reach,
  });
}

/** What a section draws, by its layout (docs/12 §6.1). */
function sectionBody(
  ctx: RenderCtx,
  s: SpecSection,
  ids: string[],
  primary: boolean,
  env: SectionEnv,
  inDrawer: boolean,
  lead: { head: HTMLElement | null },
): HTMLElement {
  const layout = layoutOf(s);
  if (PILL_KINDS.has(s.kind) || s.kind === 'header' || s.kind === 'footer') {
    const items: PillItem[] = [];
    for (const id of ids)
      withScope(ctx, id, () => items.push(...pillItems(ctx, [id])));
    // Footers and site maps as columns of links; link lists as rows.
    if (layout === 'link_grid' || layout === 'row_list')
      return foldableLinks(
        ctx,
        items,
        layout,
        overflowLabel(s.kind),
        primary ? null : env,
      );
    const max =
      ALL_INLINE.has(s.kind) || inDrawer
        ? Number.MAX_SAFE_INTEGER
        : layout === 'menu'
          ? 0
          : Math.max(0, ctx.layout.nav.inlineMax);
    return pillRow(
      ctx,
      items,
      max,
      overflowLabel(s.kind),
      primary ? null : env,
      undefined,
      NAV_KINDS.has(s.kind) ? 1 : 2,
    );
  }
  switch (s.kind) {
    case 'article':
      // The reading sheet, "On this page" above long text (docs/11 R6) for
      // the main text.
      return readingSheet(ctx, ids, {
        outline: primary && Boolean(ctx.layout.structure?.outline),
      });
    case 'product_detail': {
      return renderProduct(ctx, s, env);
    }
    case 'media':
    case 'overlay_modal':
      if (s.kind === 'media' || layout === 'as_is') return asIs(ctx, s, ids);
      break;
    default:
      if (layout === 'as_is') return asIs(ctx, s, ids);
  }
  switch (layout) {
    case 'spotlight':
    case 'hero':
      return renderSpotlight(ctx, ids, env, layout === 'hero', lead);
    case 'link_grid': {
      // Legal lines and help links: quiet columns, like a footer.
      const items: PillItem[] = [];
      for (const id of ids)
        withScope(ctx, id, () => items.push(...pillItems(ctx, [id])));
      return linkGrid(ctx, items);
    }
    case 'form_panel': {
      const panel = h(ctx.doc, 'div', 'fv-formpanel');
      panel.append(
        renderNodes(ctx, ids, env, {
          kindHint: null,
          layout,
          pills: false,
        }),
      );
      return panel;
    }
    default:
  }
  const kindHint = s.kind === 'comments' ? 'comment' : null;
  return renderNodes(ctx, ids, env, { kindHint, layout, pills: false });
}

/**
 * media / as_is: still images are shown as they are; players, frames,
 * canvases and anything interactive get one card that opens the original at
 * that spot ("Use this on the page"), in a radius-16 frame.
 */
function asIs(ctx: RenderCtx, s: SpecSection, ids: string[]): HTMLElement {
  const box = h(ctx.doc, 'div', 'fv-stack fv-asis');
  for (const id of ids) {
    const el = ctx.registry.element(id);
    if (!el) continue;
    const node = ctx.index.nodes.get(id);
    const still =
      s.kind === 'media' &&
      node?.kind === 'media' &&
      (el.localName === 'img' || el.localName === 'picture');
    if (still) {
      const r = el.getBoundingClientRect();
      const fig = h(ctx.doc, 'figure');
      const media = mediaBox(ctx, el);
      media.style.setProperty(
        'max-width',
        `${Math.round(r.width / ctx.zoom)}px`,
      );
      fig.append(media);
      box.append(fig);
      ctx.emit(id);
      continue;
    }
    const label =
      clean(ctx.registry.name(el)) ||
      clean(
        s.heading_ref
          ? ctx.registry.text(ctx.registry.element(s.heading_ref) ?? el)
          : '',
      );
    withScope(ctx, id, () => box.append(onPageCard(ctx, id, el, label)));
    for (const sub of subtreeIds(ctx.index, id)) ctx.reach(sub);
  }
  return box;
}

// ---------------------------------------------------------------------------
// Spotlight panels (docs/12 §6.1 spotlight, and a promo hero below the top)
// ---------------------------------------------------------------------------

/** A picture this large (CSS px at 100%, both sides) can carry a panel. */
const PANEL_MEDIA_MIN = 120;

/** The block's largest still picture, or the image button that opens it. */
function largestPicture(
  ctx: RenderCtx,
  ids: readonly string[],
): { id: string; node: SkeletonNode; el: Element } | null {
  let best: { id: string; node: SkeletonNode; el: Element } | null = null;
  let area = 0;
  for (const root of ids)
    for (const id of subtreeIds(ctx.index, root)) {
      const n = ctx.index.nodes.get(id);
      if (!n || n.slot || ctx.index.slotList.has(id) || ctx.isEmitted(id))
        continue;
      const still =
        (n.kind === 'media' && (n.tag === 'img' || n.tag === 'picture')) ||
        (n.kind === 'control' && n.flags.includes('imgctrl'));
      if (!still || n.box[2] < PANEL_MEDIA_MIN || n.box[3] < PANEL_MEDIA_MIN)
        continue;
      const el = ctx.registry.element(id);
      const a = n.box[2] * n.box[3];
      if (el && a > area) {
        area = a;
        best = { id, node: n, el };
      }
    }
  return best;
}

/** The section holds a list of records (feature tiles), not blocks of text. */
function holdsRecords(ctx: RenderCtx, ids: readonly string[]): boolean {
  for (const id of ids)
    for (const sub of subtreeIds(ctx.index, id)) {
      const n = ctx.index.nodes.get(sub);
      if (n?.kind !== 'collection' || n.slot || ctx.index.slotList.has(sub))
        continue;
      const kind = ctx.collections.get(sub)?.item_kind;
      if (!kind || !NAV_ITEM_KINDS.has(kind)) return true;
    }
  return false;
}

/**
 * The section's blocks: through single wrappers, each child group that has
 * a heading of its own is a block (Apple's stacked tiles); otherwise the
 * whole section is one.
 */
function spotlightBlocks(ctx: RenderCtx, ids: readonly string[]): string[][] {
  let top = [...ids];
  for (let depth = 0; depth < 4 && top.length === 1; depth++) {
    const id = top[0] as string;
    const n = ctx.index.nodes.get(id);
    const kids = ctx.index.children.get(id) ?? [];
    if (!n || (n.kind !== 'landmark' && n.kind !== 'group') || !kids.length)
      break;
    ctx.emit(id);
    top = kids;
  }
  const headed = (id: string): boolean => {
    const n = ctx.index.nodes.get(id);
    if (n?.kind !== 'landmark' && n?.kind !== 'group') return false;
    return subtreeIds(ctx.index, id).some(
      (x) => ctx.index.nodes.get(x)?.kind === 'heading',
    );
  };
  if (top.filter(headed).length < 2) return [top];
  const blocks: string[][] = [];
  for (const id of top) {
    const last = blocks[blocks.length - 1];
    if (headed(id) || !last) blocks.push([id]);
    else last.push(id);
  }
  return blocks;
}

/** Adjacent pills read as one row of actions, Apple's "Learn more  Buy". */
function actionRows(ctx: RenderCtx, col: HTMLElement): void {
  const parents = [
    col,
    ...Array.from(col.querySelectorAll<HTMLElement>('.fv-stack, .fv-group')),
  ];
  for (const parent of parents) {
    let run: HTMLElement[] = [];
    const flush = (): void => {
      const first = run[0];
      if (run.length >= 2 && first) {
        const row = h(ctx.doc, 'div', 'fv-actions');
        first.before(row);
        row.append(...run);
      }
      run = [];
    };
    for (const c of Array.from(parent.children) as HTMLElement[]) {
      if (c.matches('.fv-btn:not(.fv-btn--small):not(.fv-btn--icon)'))
        run.push(c);
      else flush();
    }
    flush();
  }
}

/** One raised panel: the words and actions, its picture in a well beside them. */
function spotlightPanel(
  ctx: RenderCtx,
  ids: readonly string[],
  env: SectionEnv,
  hero: boolean,
  head: HTMLElement | null,
): HTMLElement {
  const panel = h(
    ctx.doc,
    'div',
    hero ? 'fv-spotlight fv-spotlight--hero' : 'fv-spotlight',
  );
  const text = h(ctx.doc, 'div', 'fv-spotlight__text');
  if (head) text.append(head);
  const pic = largestPicture(ctx, ids);
  let media: HTMLElement | null = null;
  if (pic) {
    const well = h(ctx.doc, 'div', 'fv-spotlight__media');
    const img =
      pic.node.kind === 'media'
        ? pic.el
        : (pic.el.querySelector('img, picture') ?? pic.el);
    const box = mediaBox(ctx, img, 'fv-thumb fv-thumb--contain');
    withScope(ctx, ids[0] ?? pic.id, () => {
      // An image button opens the site's viewer; it keeps its name.
      const opener =
        pic.node.kind === 'control'
          ? siteControl(ctx, pic.id, pic.el, { variant: 'title' })
          : null;
      if (opener) {
        opener.setAttribute('aria-label', clean(opener.textContent));
        opener.className = 'fv-thumb-open';
        opener.textContent = '';
        opener.append(box);
        well.append(opener);
      } else {
        well.append(box);
        ctx.emit(pic.id);
      }
    });
    media = well;
  }
  const words = renderNodes(ctx, [...ids], env, {
    kindHint: null,
    layout: 'spotlight',
    pills: false,
  });
  // The block's own heading leads it at the section size.
  if (!head) {
    const hd = words.querySelector<HTMLElement>('.fv-heading.t-title');
    if (hd) hd.className = 't-section fv-heading';
  }
  actionRows(ctx, words);
  // Its first action is the blue pill (never an irreversible one).
  const first = words.querySelector<HTMLElement>(
    '.fv-btn:not(.fv-btn--small):not(.fv-btn--icon):not(.fv-btn--link)',
  );
  if (
    first &&
    !first.closest('.fv-records') &&
    !words.querySelector('.fv-btn--fill') &&
    !isIrreversible(clean(first.textContent))
  )
    first.classList.add('fv-btn--fill');
  text.append(words);
  panel.append(text);
  if (media) {
    panel.append(media);
    panel.classList.add('has-media');
  }
  return panel;
}

/**
 * Feature blocks as Showroom panels, one per block, text beside its picture
 * (stacked below 900 px); a promo hero below the top as one large centred
 * panel. A list of features is drawn as tiles instead.
 */
function renderSpotlight(
  ctx: RenderCtx,
  ids: readonly string[],
  env: SectionEnv,
  hero: boolean,
  lead: { head: HTMLElement | null },
): HTMLElement {
  if (holdsRecords(ctx, ids))
    return renderNodes(ctx, ids, env, {
      kindHint: null,
      layout: 'card_grid',
      pills: false,
    });
  const blocks = spotlightBlocks(ctx, ids);
  const wrap = h(ctx.doc, 'div', 'fv-spotlights');
  const one = blocks.length === 1;
  for (const b of blocks)
    wrap.append(spotlightPanel(ctx, b, env, hero, one ? lead.head : null));
  // One panel carries the section's heading inside it.
  if (one && lead.head) lead.head = null;
  return wrap;
}

// ---------------------------------------------------------------------------
// More on this page (docs/11 R3)
// ---------------------------------------------------------------------------

/** A drawer's title: the section's own heading when short, else its kind. */
export function drawerTitle(ctx: RenderCtx, s: SpecSection): string {
  if (s.heading_ref) {
    const el = ctx.registry.element(s.heading_ref);
    const t = el ? clean(ctx.registry.text(el)) : '';
    if (t && t.length <= 48) return t;
  }
  return DRAWER_TITLES[s.kind] ?? FV_COPY.moreOnThisPage;
}

/** Nodes of a section a person can tell apart (exemplar slots excluded). */
function own(ctx: RenderCtx, ids: readonly string[]): string[] {
  return ids
    .flatMap((id) => subtreeIds(ctx.index, id))
    .filter(
      (id) => !ctx.index.nodes.get(id)?.slot && !ctx.index.slotList.has(id),
    );
}

/**
 * What a drawer holds, for its count: links for ways around the site,
 * records for lists, otherwise text blocks and controls (images when that is
 * all there is). 0 means there is nothing to show.
 */
export function sectionCount(ctx: RenderCtx, s: SpecSection): number {
  const ids = own(ctx, s.node_ids).filter((id) => id !== s.heading_ref);
  let controls = 0;
  let texts = 0;
  let media = 0;
  let records = 0;
  let links = 0;
  for (const id of ids) {
    const n = ctx.index.nodes.get(id);
    if (!n) continue;
    switch (n.kind) {
      case 'collection': {
        const members = ctx.registry.members(id).length;
        const kind = ctx.collections.get(id)?.item_kind;
        if (kind && NAV_ITEM_KINDS.has(kind)) links += members;
        else records += members;
        break;
      }
      case 'control':
      case 'input':
        controls++;
        break;
      case 'heading':
      case 'text':
      case 'stext':
      case 'table':
        texts++;
        break;
      case 'media':
        media++;
        break;
      default:
    }
  }
  if (
    PILL_KINDS.has(s.kind) ||
    NAV_KINDS.has(s.kind) ||
    WAYFINDING_KINDS.has(s.kind)
  )
    return controls + links || texts || records;
  if (records) return records;
  return texts + controls + links || media;
}

/**
 * One section behind a drawer, a raised card: "Site links" with its count
 * (12) and a chevron, the section rendered inside the card when opened.
 */
export function renderDrawer(
  ctx: RenderCtx,
  s: SpecSection,
  env: SectionEnv,
  label?: string,
): HTMLElement | null {
  const n = sectionCount(ctx, s);
  if (n === 0) {
    // Nothing anyone can read or use (empty wrappers, decoration).
    for (const id of own(ctx, s.node_ids)) ctx.hide(id);
    return null;
  }
  const reach = s.node_ids.flatMap((id) => subtreeIds(ctx.index, id));
  const wrap = h(ctx.doc, 'div', 'fv-drawer');
  wrap.dataset.kind = s.kind;
  wrap.append(
    cardDisclosure(ctx, {
      title: label ?? drawerTitle(ctx, s),
      count: n,
      reach,
      render: () =>
        renderSection(
          ctx,
          { ...s, importance: 'secondary' } as SpecSection,
          false,
          { ...env, compressors: [] },
          { inDrawer: true },
        ) ?? h(ctx.doc, 'div'),
    }),
  );
  return wrap;
}

/**
 * The list's own controls (tabs, filters, sort) as chip rows right above the
 * list, the selected chip always in view (M7). At large text the rest of a
 * long row folds into "More filters (n)" before anything else moves.
 */
export function listTools(
  ctx: RenderCtx,
  sections: readonly SpecSection[],
  env: SectionEnv,
): HTMLElement | null {
  if (!sections.length) return null;
  const box = h(ctx.doc, 'div', 'fv-listtools');
  const calm = (ctx.layout.structure?.level ?? 0) === 2;
  for (const s of sections) {
    // The section's own heading ("1-48 of 3,000 results") as a quiet line.
    if (s.heading_ref) {
      const hel = ctx.registry.element(s.heading_ref);
      const t = hel ? clean(ctx.registry.text(hel)) : '';
      if (t) box.append(h(ctx.doc, 'p', 'fv-tools__label t-meta', t));
      for (const sub of subtreeIds(ctx.index, s.heading_ref)) ctx.emit(sub);
    }
    const items: PillItem[] = [];
    for (const id of s.node_ids.filter((x) => x !== s.heading_ref))
      withScope(ctx, id, () => items.push(...pillItems(ctx, [id])));
    // For a person who needs calm only the first row of chips stays out;
    // a second (sort after tabs) waits behind one labelled control.
    const second = calm && box.querySelector('[data-kind]') !== null;
    const pinned = items.map((i) =>
      i.kind === 'control' &&
      !second &&
      (i.el.getAttribute('aria-pressed') === 'true' ||
        i.el.hasAttribute('aria-current'))
        ? { ...i, pin: true }
        : i,
    );
    if (!pinned.length) continue;
    // Tabs and sort chips stay in view (M7); a long filter panel folds whole
    // behind "More filters (n)", its chosen filters still showing.
    const controls = pinned.filter((i) => i.kind === 'control').length;
    const inline =
      second || (s.kind === 'filters' && controls > 8)
        ? 0
        : Math.max(1, Math.min(calm ? 2 : 8, ctx.layout.nav.inlineMax));
    const kindTitle = DRAWER_TITLES[s.kind] ?? FV_COPY.moreOnThisPage;
    const row = pillRow(
      ctx,
      pinned,
      inline,
      second
        ? (n) => `${kindTitle} (${n})`
        : s.kind === 'tabs'
          ? FV_COPY.moreTabs
          : s.kind === 'filters'
            ? FV_COPY.moreFilters
            : FV_COPY.moreOptions,
      env,
      SECTION_TITLES[s.kind],
      2,
    );
    row.dataset.kind = s.kind;
    box.append(row);
  }
  return box.childNodes.length ? box : null;
}

/** A language picker's words: "22 languages", "Language", "Change language". */
const LANGUAGES =
  /^(?:\d+\s+)?(?:languages?|sprachen|langues|idiomas|lingue|talen|språk)\b|\b(?:change|select|choose) (?:your )?language\b/i;

/**
 * A page heading split for the top of the view: its short lines and up to two
 * of its actions stay with the title (a price and "Shop all", a channel's
 * "Subscribe"); its pictures, players and long description wait in "About
 * this page" (M5).
 */
export function splitPageHeading(
  ctx: RenderCtx,
  s: SpecSection,
): { hero: string[]; rest: string[]; tools: string[] } {
  const hero: string[] = [];
  const rest: string[] = [];
  const tools: string[] = [];
  let texts = 0;
  let controls = 0;
  // For a person who needs calm the title keeps one action and three lines.
  const calm = (ctx.layout.structure?.level ?? 0) === 2;
  const maxControls = calm ? 1 : 2;
  const maxTexts = calm ? 3 : 6;
  const titleId = ctx.titleEl ? ctx.index.byElement.get(ctx.titleEl) : null;
  const visit = (id: string): void => {
    if (id === s.heading_ref || id === titleId) return;
    const n = ctx.index.nodes.get(id);
    if (!n) return;
    // A language picker ("22 languages") is a way off the page, not part
    // of what the page is: it waits with the rest, never under the title.
    if (
      (n.kind === 'stext' || n.kind === 'control') &&
      LANGUAGES.test(clean(n.label))
    ) {
      rest.push(id);
      return;
    }
    const kids = ctx.index.children.get(id) ?? [];
    if ((n.kind === 'landmark' || n.kind === 'group') && kids.length) {
      // A group holding the title: its other parts are looked at one by one.
      const el = ctx.registry.element(id);
      if (el && ctx.titleEl && el.contains(ctx.titleEl)) {
        ctx.emit(id);
        kids.forEach(visit);
        return;
      }
      if (kids.length <= 4) {
        ctx.emit(id);
        kids.forEach(visit);
        return;
      }
      rest.push(id);
      return;
    }
    if (n.kind === 'collection') {
      const kind = ctx.collections.get(id)?.item_kind;
      if (kind === 'tab' || kind === 'chip') tools.push(id);
      else rest.push(id);
      return;
    }
    if (n.kind === 'control') {
      const name = clean(n.label ?? '');
      // An action of the page's own ("Subscribe", "Shop all") stays with the
      // title; menus, players, links off the site and long labels do not.
      if (
        controls < maxControls &&
        name.length <= 40 &&
        !/\b(play|pause|mute|unmute|volume|full ?screen)\b/i.test(name) &&
        !n.flags.includes('imgctrl') &&
        !n.flags.includes('popup') &&
        n.href !== 'other'
      ) {
        controls++;
        hero.push(id);
      } else rest.push(id);
      return;
    }
    if (
      (n.kind === 'stext' || n.kind === 'text' || n.kind === 'heading') &&
      (n.text?.chars ?? 0) <= 80 &&
      texts < maxTexts
    ) {
      texts++;
      hero.push(id);
      return;
    }
    rest.push(id);
  };
  s.node_ids.forEach(visit);
  return { hero, rest, tools };
}

/** "Everything else on this page (n)": what the spec left out, one click away. */
export function renderRest(
  ctx: RenderCtx,
  rest: readonly string[],
  env: SectionEnv,
): HTMLElement | null {
  if (!rest.length) return null;
  const reach = rest.flatMap((id) => subtreeIds(ctx.index, id));
  const sec = h(ctx.doc, 'section', 'fv-drawer fv-rest');
  sec.setAttribute('aria-label', FV_COPY.everythingElse(rest.length));
  // "Everything else on this page" with its count, the drawer's title words.
  const title = FV_COPY.everythingElse(rest.length).replace(/\s*\(\d+\)$/, '');
  sec.append(
    cardDisclosure(ctx, {
      title,
      count: rest.length,
      reach,
      render: () =>
        renderNodes(ctx, rest, env, {
          kindHint: null,
          layout: 'reading',
          pills: false,
        }),
    }),
  );
  return sec;
}
