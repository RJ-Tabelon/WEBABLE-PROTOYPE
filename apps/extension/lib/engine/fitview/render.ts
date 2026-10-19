import type {
  FitLayout,
  Skeleton,
  SpecSection,
  ValidatedSpec,
} from '@webable/core';

import {
  chevron,
  clean,
  FV_COPY,
  h,
  indexSkeleton,
  mirrorState,
  PAGE_LINE,
  renderField,
  siteControl,
  STATE_ATTRS,
  subtreeIds,
  waButton,
  waSwitch,
  withScope,
  type RenderCtx,
  type SkelIndex,
  type ViewActions,
} from './components';
import { checkConservation, type ConservationReport } from './conserve';
import type { Host } from './host';
import type { ListView } from './records';
import {
  headingEl,
  LIST_TOOL_KINDS,
  listTools,
  orderSections,
  pillItems,
  pillRow,
  renderDrawer,
  renderNodes,
  renderRest,
  renderSection,
  splitPageHeading,
  WAYFINDING_KINDS,
  type Compressor,
  type SectionEnv,
} from './sections';
import { LONG_TITLE_CHARS, LONG_TITLE_CLASS } from './styles';
import type { ProxyTarget, SkeletonRegistry } from './types';

/**
 * The whole view for one skeleton + validated spec + layout: the page's
 * content, restructured for the person (docs/11 §3), in this order:
 *
 *   top strip   one sticky, frosted row (docs/12 §5): the site, its search
 *               as a pill field and its button, WebAble's group (Text − / +
 *               as one segmented pill, Original page, and one "More" holding
 *               everything else the strip would carry: icon buttons, header
 *               and account links, "Always here"); WebAble's notes below it
 *               as floating cards (the one-time intro, offers, notices, the
 *               status lines) (R2)
 *   hero        the page's own title and one templated page line (R1), with
 *               the page heading's short lines and actions
 *   primary     the main thing, its list controls (chips) right above it
 *               and its pages right after it
 *   open        the next `structure.sectionsOpen` content sections
 *   drawers     "More on this page": every other section in a drawer titled
 *               by kind with its count (R3), then "Everything else on this
 *               page (n)" with whatever the spec and conservation left out
 *
 * Nothing is removed: every drawer is one labelled click away and counted
 * by conservation (docs/10 §4.7).
 */

export interface ViewCallbacks extends ViewActions {
  original(): void;
  nudge(step: 1 | -1): void;
  switchLayout(): void;
  bind(control: HTMLElement, target: ProxyTarget): void;
  /** "Always here" was switched in the strip's More. */
  always?(on: boolean): void;
  /** The one-time intro line was dismissed. */
  dismissIntro?(): void;
}

export interface RenderInput {
  doc: Document;
  host: Host;
  skeleton: Skeleton;
  registry: SkeletonRegistry;
  validated: ValidatedSpec;
  layout: FitLayout;
  zoom: number;
  site: { label: string; secure: boolean };
  callbacks: ViewCallbacks;
  uid: (prefix: string) => string;
  /** "Always here" state; undefined when the site cannot have it (no switch). */
  alwaysHere?: boolean;
  /** Show the one-time line about the restructure (reply.intro). */
  intro?: boolean;
}

export interface RenderedView {
  ctx: RenderCtx;
  index: SkelIndex;
  lists: Map<string, ListView>;
  emitted: Set<string>;
  reached: Set<string>;
  primary: HTMLElement | null;
  compressors: Compressor[];
  offer: HTMLElement;
  notice: HTMLElement;
  status: HTMLElement;
  conservation: ConservationReport;
  /** Close the strip's "More" panel; false when it was not open. */
  closeMore(): boolean;
  dispose(): void;
}

/** Content kinds that may stay open below the main thing, best first. */
const OPEN_FIRST: readonly SpecSection['kind'][] = [
  'related',
  'comments',
  'main_list',
  'article',
  'product_detail',
  'feature_blocks',
  'form',
];

const TEXTUAL = (n: { inputType?: string; role: string | null }): boolean =>
  n.inputType === 'search' ||
  n.inputType === 'text' ||
  n.role === 'searchbox' ||
  n.role === 'combobox';

/**
 * The strip's search: the field and its button on one row. Everything else
 * in the search section (a voice button, "Clear", a scope menu) goes to More.
 */
function searchRow(
  ctx: RenderCtx,
  s: SpecSection,
): { row: HTMLElement | null; rest: string[] } {
  type Leaf = { id: string; scope: string };
  const leaves: Leaf[] = [];
  const visit = (id: string, scope: string): void => {
    const node = ctx.index.nodes.get(id);
    if (!node || !ctx.registry.element(id)) return;
    const kids = ctx.index.children.get(id) ?? [];
    if ((node.kind === 'landmark' || node.kind === 'group') && kids.length) {
      ctx.emit(id);
      for (const k of kids) visit(k, scope);
      return;
    }
    leaves.push({ id, scope });
  };
  for (const id of s.node_ids) visit(id, id);
  const field = leaves.find((l) => {
    const n = ctx.index.nodes.get(l.id);
    return n?.kind === 'input' && TEXTUAL(n);
  });
  if (!field) return { row: null, rest: leaves.map((l) => l.id) };
  // The field's button: a submit, else a button named for searching
  // ("Search", "Go"), never "Clear search" or "Search with your voice".
  const rank = (l: Leaf): number => {
    const n = ctx.index.nodes.get(l.id);
    const el = ctx.registry.element(l.id);
    if (l === field || n?.kind !== 'control' || !el) return 0;
    if (n.role === 'link' || n.tag === 'a') return 0;
    const name = clean(ctx.registry.name(el));
    if (!name || /\b(clear|voice|camera|image|lens|reset)\b/i.test(name))
      return 0;
    if (/^(search|go|find|submit|ok)$/i.test(name)) return 3;
    if ((el as HTMLButtonElement).type === 'submit') return 2;
    return /\b(search|go|find|submit)\b/i.test(name) ? 1 : 0;
  };
  const submit =
    [...leaves].sort((a, b) => rank(b) - rank(a)).find((l) => rank(l) > 0) ??
    null;
  const row = h(ctx.doc, 'div', 'fv-search');
  row.setAttribute('role', 'search');
  withScope(ctx, field.scope, () => {
    const el = ctx.registry.element(field.id) as Element;
    const f = renderField(ctx, field.id, el, { search: true });
    if (f) while (f.firstChild) row.append(f.firstChild);
  });
  if (submit)
    withScope(ctx, submit.scope, () => {
      const el = ctx.registry.element(submit.id) as Element;
      const c = siteControl(ctx, submit.id, el, { variant: 'btn' });
      if (c) row.append(c);
      for (const sub of subtreeIds(ctx.index, submit.id)) ctx.emit(sub);
    });
  return {
    row: row.childNodes.length ? row : null,
    rest: leaves.filter((l) => l !== field && l !== submit).map((l) => l.id),
  };
}

/** "Video title - YouTube" -> "Video title": the site's name is in the strip already. */
export function titleFromDocument(title: string, site: string): string {
  const parts = clean(title)
    .split(/\s+[|\-–—:·•]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const name =
    site
      .replace(/^www\./, '')
      .split('.')[0]
      ?.toLowerCase() ?? '';
  const keep = parts.filter(
    (p) =>
      !name ||
      !p
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .includes(name),
  );
  return (
    (keep.length ? keep : parts).sort((a, b) => b.length - a.length)[0] ?? ''
  );
}

/**
 * The page's own title: its page heading's h1, else any h1, else the document
 * title. A lower heading never titles the page: on results pages it is a shelf
 * ("Results", "Shorts"), while the document title carries the search.
 */
function pageTitle(
  ctx: RenderCtx,
  headings: readonly SpecSection[],
  site: string,
): { id: string | null; el: Element | null; text: string } {
  for (const s of headings) {
    if (!s.heading_ref) continue;
    if (ctx.index.nodes.get(s.heading_ref)?.level !== 1) continue;
    const el = ctx.registry.element(s.heading_ref);
    const text = el ? clean(ctx.registry.text(el)) : '';
    if (el && text) return { id: s.heading_ref, el, text };
  }
  for (const n of ctx.skeleton.nodes) {
    if (n.kind !== 'heading' || n.level !== 1 || n.slot) continue;
    if (ctx.index.slotList.has(n.id)) continue;
    const el = ctx.registry.element(n.id);
    const text = el ? clean(ctx.registry.text(el)) : '';
    if (el && text) return { id: n.id, el, text };
  }
  return {
    id: null,
    el: null,
    text: titleFromDocument(ctx.doc.title, site),
  };
}

/** The section holds a list of records (so chips and pages belong to it). */
function holdsList(ctx: RenderCtx, s: SpecSection): boolean {
  if (s.kind === 'main_list') return true;
  for (const id of s.node_ids)
    for (const sub of subtreeIds(ctx.index, id)) {
      const n = ctx.index.nodes.get(sub);
      if (n?.kind !== 'collection' || n.slot) continue;
      const kind = ctx.collections.get(sub)?.item_kind;
      if (!kind || !['nav_link', 'tab', 'chip', 'filter_option'].includes(kind))
        return true;
    }
  return false;
}

export function renderView(input: RenderInput): RenderedView {
  const { doc, host, skeleton, registry, validated, layout, callbacks } = input;
  const index = indexSkeleton(skeleton, registry);
  const emitted = new Set<string>();
  const reached = new Set<string>();
  const hidden = new Set<string>();
  // Controls that follow their original's state (a chip the site selects
  // after a proxied click, a tab, a star, an ARIA checkbox). Attributes
  // only: the site's nodes are observed, never written. Records re-rendered
  // later (patchRecords) register their controls as they are drawn.
  const mirrored = new WeakMap<
    Element,
    Array<{ control: HTMLElement; toggle: boolean }>
  >();
  const view = doc.defaultView;
  let states: MutationObserver | null = null;
  const ctx: RenderCtx = {
    doc,
    skeleton,
    index,
    registry,
    layout,
    zoom: input.zoom,
    validated,
    collections: new Map(validated.spec.collections.map((c) => [c.list_id, c])),
    actions: { showOnPage: (id, el) => callbacks.showOnPage(id, el) },
    bind: (control, target) => callbacks.bind(control, target),
    emit: (id) => emitted.add(id),
    isEmitted: (id) => emitted.has(id),
    reach: (id) => reached.add(id),
    hide: (id) => hidden.add(id),
    uid: input.uid,
    scope: null,
    hasH1: false,
    titleEl: null,
    mirror: (control, el, toggle) => {
      if (!states) {
        if (!view || typeof view.MutationObserver !== 'function') return;
        states = new view.MutationObserver((records) => {
          for (const r of records) {
            const list = mirrored.get(r.target as Element);
            if (!list) continue;
            // Controls re-rendered away are dropped.
            const live = list.filter((m) => m.control.isConnected);
            if (live.length !== list.length)
              mirrored.set(r.target as Element, live);
            for (const m of live)
              mirrorState(m.control, r.target as Element, m.toggle);
          }
        });
      }
      const list = mirrored.get(el);
      if (list) {
        list.push({ control, toggle });
        return;
      }
      mirrored.set(el, [{ control, toggle }]);
      states.observe(el, {
        attributes: true,
        attributeFilter: [...STATE_ATTRS],
      });
    },
  };
  const lists = new Map<string, ListView>();
  const env: SectionEnv = {
    scroller: host.scroller,
    lists,
    compressors: [],
  };
  const sections = validated.spec.sections;
  const ordered = orderSections(sections, index.order, validated.primary);
  const cleanups: Array<() => void> = [];

  // ---------------- top strip (R2) ----------------
  const strip = host.strip;
  strip.replaceChildren();
  // The frosted bar spans the window; its row is the page's width.
  const bar = h(doc, 'div', 'fv-strip__bar');
  const inner = h(doc, 'div', 'fv-strip__inner');
  const row = h(doc, 'div', 'fv-strip__row');
  const site = h(doc, 'p', 'fv-site t-body');
  site.append(h(doc, 'span', 'fv-site__name', input.site.label));
  if (!input.site.secure)
    site.append(h(doc, 'span', 'fv-insecure t-meta', FV_COPY.notSecure));
  row.append(site);
  // The site's search stays in view; every other strip control goes to More.
  const moreIds: Array<{ id: string; pin: boolean }> = [];
  let searched = false;
  for (const { section } of ordered.strip) {
    if (section.kind === 'search' && !searched) {
      const sr = searchRow(ctx, section);
      if (sr.row) {
        row.append(sr.row);
        searched = true;
      }
      for (const id of sr.rest) moreIds.push({ id, pin: false });
      continue;
    }
    for (const id of section.node_ids)
      moreIds.push({ id, pin: section.kind === 'account_and_cart' });
  }
  const wa = h(doc, 'div', 'fv-wa-controls');
  wa.setAttribute('role', 'group');
  wa.setAttribute('aria-label', FV_COPY.webableControls);
  // Text − / Text +: one segmented pill.
  const seg = h(doc, 'div', 'fv-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', FV_COPY.textSize);
  seg.append(
    waButton(ctx, FV_COPY.textSmaller, () => callbacks.nudge(-1)),
    waButton(ctx, FV_COPY.textLarger, () => callbacks.nudge(1)),
  );
  wa.append(
    seg,
    waButton(ctx, FV_COPY.original, () => callbacks.original(), {
      fill: true,
    }),
  );
  // More: the strip's other controls (rendered when first opened) and
  // WebAble's own switches.
  const panel = h(doc, 'div', 'fv-more');
  panel.id = ctx.uid('m');
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', FV_COPY.moreMenu);
  const hasSite = moreIds.length > 0;
  const hasAlways = input.alwaysHere !== undefined;
  let moreBuilt = false;
  let moreToggle: HTMLButtonElement | null = null;
  for (const { id } of moreIds)
    for (const sub of subtreeIds(index, id)) ctx.reach(sub);
  const buildMore = (): void => {
    if (moreBuilt) return;
    moreBuilt = true;
    if (hasSite) {
      const group = h(doc, 'div', 'fv-more__group');
      const items = moreIds.flatMap(({ id, pin }) =>
        withScope(ctx, id, () =>
          pillItems(ctx, [id]).map((i) =>
            i.kind === 'control' ? { ...i, pin } : i,
          ),
        ),
      );
      group.append(
        pillRow(ctx, items, Number.MAX_SAFE_INTEGER, FV_COPY.siteLinks, null),
      );
      panel.append(group);
    }
    if (hasAlways) {
      const group = h(doc, 'div', 'fv-more__group');
      group.append(
        waSwitch(
          ctx,
          FV_COPY.alwaysHere,
          input.alwaysHere === true,
          (on) => callbacks.always?.(on),
          FV_COPY.alwaysHereHint,
        ),
      );
      panel.append(group);
    }
  };
  const setMore = (open: boolean): void => {
    if (!moreToggle) return;
    if (open) buildMore();
    panel.hidden = !open;
    moreToggle.setAttribute('aria-expanded', String(open));
  };
  if (hasSite || hasAlways) {
    moreToggle = waButton(ctx, FV_COPY.more, () => setMore(panel.hidden), {
      expanded: false,
      ghost: true,
    });
    moreToggle.append(chevron(doc, 'down'));
    moreToggle.setAttribute('aria-controls', panel.id);
    wa.append(moreToggle);
    // A press anywhere else closes it; so does using one of its controls.
    const away = (e: Event): void => {
      if (panel.hidden) return;
      const path = e.composedPath();
      if (path.includes(panel) || (moreToggle && path.includes(moreToggle)))
        return;
      setMore(false);
    };
    host.root.addEventListener('pointerdown', away);
    cleanups.push(() => host.root.removeEventListener('pointerdown', away));
    panel.addEventListener('click', (e) => {
      const t = e.target as Element | null;
      if (t?.closest('a[href], .fv-pill, .fv-btn') && !t.closest('.fv-switch'))
        setTimeout(() => setMore(false), 0);
    });
  }
  row.append(wa);
  // The one line that says what happened, the first time (docs/11 §2).
  const intro = h(doc, 'div', 'fv-intro');
  intro.setAttribute('role', 'status');
  intro.hidden = !input.intro;
  if (input.intro) {
    intro.append(
      h(doc, 'p', 't-body', FV_COPY.intro),
      waButton(ctx, FV_COPY.gotIt, () => {
        intro.hidden = true;
        callbacks.dismissIntro?.();
      }),
    );
  }
  const offer = h(doc, 'div', 'fv-offer');
  offer.hidden = true;
  const notice = h(doc, 'p', 'fv-notice t-body');
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const status = h(doc, 'div', 'fv-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  // WebAble's notes: floating cards under the bar, never full-width bars.
  const notes = h(doc, 'div', 'fv-notes');
  notes.append(intro, offer, notice, status);
  inner.append(row, panel);
  bar.append(inner);
  strip.append(bar, notes);

  // ---------------- main ----------------
  const main = host.main;
  main.replaceChildren();
  const primaryIndex = validated.primary;
  const primarySec = sections[primaryIndex] ?? null;
  const listPrimary = primarySec ? holdsList(ctx, primarySec) : false;
  const body = ordered.body.filter(({ index: i }) => i !== primaryIndex);
  const consent = body.filter(({ section }) => section.kind === 'consent');
  const headings = body.filter(
    ({ section }) => section.kind === 'page_heading',
  );
  const tools = listPrimary
    ? body.filter(({ section }) => LIST_TOOL_KINDS.has(section.kind))
    : [];
  const pages = listPrimary
    ? body.filter(({ section }) => section.kind === 'pagination')
    : [];
  const placed = new Set([...consent, ...headings, ...tools, ...pages]);
  const others = body.filter((b) => !placed.has(b));

  // Consent is answered first, never bypassed.
  for (const { section } of consent) {
    const el = renderSection(ctx, section, false, env);
    if (el) main.append(el);
  }

  // The hero (R1): the page's own title and one templated line, on the
  // reading column when the main thing is running text.
  const orient = h(doc, 'header', 'fv-orient');
  if (primarySec?.kind === 'article') orient.dataset.layout = 'reading';
  const title = pageTitle(
    ctx,
    headings.map((x) => x.section),
    input.site.label,
  );
  const h1 =
    title.id && title.el
      ? headingEl(ctx, title.id, title.el, 1)
      : title.text
        ? h(doc, 'h1', 't-page fv-heading', title.text)
        : null;
  if (h1) {
    h1.classList.remove('cue');
    // A product name of a paragraph's length stays the h1 at the section size.
    if (clean(h1.textContent).length > LONG_TITLE_CHARS)
      h1.classList.add(LONG_TITLE_CLASS);
    ctx.hasH1 = true;
    orient.append(h1);
  }
  ctx.titleEl = title.el;
  const pageLine = h(doc, 'p', 'fv-pageline t-meta');
  orient.append(pageLine);
  main.append(orient);
  // The page heading's short lines and actions stay with the title; its
  // pictures, players and long text wait in "About this page" (M5).
  const about: string[] = [];
  const headingTools: string[] = [];
  const hero = h(doc, 'div', 'fv-hero');
  for (const { section } of headings) {
    const split = splitPageHeading(ctx, section);
    for (const id of split.hero) {
      const box = withScope(ctx, id, () =>
        renderNodes(ctx, [id], env, {
          kindHint: null,
          layout: section.layout,
          pills: false,
        }),
      );
      while (box.firstChild) hero.append(box.firstChild);
    }
    about.push(...split.rest);
    headingTools.push(...split.tools);
  }
  if (hero.childNodes.length) orient.append(hero);

  // The main thing (R2), with its chips above and its pages after it.
  const toolSections = [
    ...tools.map((x) => x.section),
    ...(headingTools.length
      ? [
          {
            kind: 'tabs',
            importance: 'secondary',
            node_ids: headingTools,
            heading_ref: null,
            layout: 'chip_bar',
          } as SpecSection,
        ]
      : []),
  ];
  const toolsEl =
    listPrimary || headingTools.length
      ? listTools(ctx, toolSections, env)
      : null;
  let after: HTMLElement | null = null;
  if (pages.length) {
    after = h(doc, 'div', 'fv-stack');
    for (const { section } of pages) {
      const el = renderSection(ctx, section, false, env);
      if (el) after.append(el);
    }
  }
  let primaryEl: HTMLElement | null = null;
  if (primarySec) {
    primaryEl = renderSection(ctx, primarySec, true, env, {
      tools: toolsEl,
      after,
    });
    if (primaryEl) main.append(primaryEl);
  }

  // Below it: the next `sectionsOpen` content sections stay open (R3).
  const structure = layout.structure;
  const limit = structure?.sectionsOpen ?? null;
  const openable = others.filter(
    ({ section: s }) =>
      !WAYFINDING_KINDS.has(s.kind) &&
      !LIST_TOOL_KINDS.has(s.kind) &&
      s.importance !== 'fold' &&
      s.layout !== 'menu' &&
      !(s.importance === 'tertiary' && layout.tertiary === 'collapsed') &&
      (limit === null || OPEN_FIRST.includes(s.kind)),
  );
  const open = new Set(
    limit === null
      ? openable
      : [...openable]
          .sort(
            (a, b) =>
              OPEN_FIRST.indexOf(a.section.kind) -
                OPEN_FIRST.indexOf(b.section.kind) ||
              (index.order.get(a.section.node_ids[0] ?? '') ?? 0) -
                (index.order.get(b.section.node_ids[0] ?? '') ?? 0),
          )
          .slice(0, Math.max(0, limit)),
  );
  for (const b of others) {
    if (!open.has(b)) continue;
    const el = renderSection(ctx, b.section, false, env);
    if (el) main.append(el);
  }

  // More on this page: every other section in a labelled drawer with a count.
  const drawerEls: HTMLElement[] = [];
  const later = [...others.filter((b) => !open.has(b)), ...ordered.folded].sort(
    (a, b) =>
      (index.order.get(a.section.node_ids[0] ?? '') ?? 0) -
      (index.order.get(b.section.node_ids[0] ?? '') ?? 0),
  );
  if (about.length) {
    const el = renderDrawer(
      ctx,
      {
        kind: 'page_heading',
        importance: 'secondary',
        node_ids: about,
        heading_ref: null,
        layout: 'reading',
      } as SpecSection,
      env,
      FV_COPY.aboutPage,
    );
    if (el) drawerEls.push(el);
  }
  for (const { section } of later) {
    const el = renderDrawer(ctx, section, env);
    if (el) drawerEls.push(el);
  }

  // The page line, now that the view knows what it holds.
  const parts: string[] = [];
  const typeName = PAGE_LINE.types[validated.spec.page_type];
  if (typeName) parts.push(typeName);
  const primaryLists = [...lists.values()].filter(
    (l) => primaryEl?.contains(l.root) ?? false,
  );
  const main1 = primaryLists.sort((a, b) => b.order.length - a.order.length)[0];
  const outline = primaryEl?.querySelector('.fv-outline') ?? null;
  if (main1 && main1.order.length) {
    parts.push(
      PAGE_LINE.count(
        main1.order.length - main1.ads.length + main1.overflow,
        main1.spec.item_kind,
      ),
    );
  } else if (primaryEl) {
    const n = primaryEl.querySelectorAll('.fv-prose h2').length;
    if (n >= 2) parts.push(PAGE_LINE.sections(n));
  }
  const firstTool = toolsEl?.querySelector<HTMLElement>('[data-kind]');
  const where = firstTool
    ? PAGE_LINE.above[firstTool.dataset.kind as SpecSection['kind']]
    : undefined;
  // Where to look next, in plain words: the list's own controls, the
  // contents list, the product's price, or the drawers at the end.
  if (where) parts.push(where);
  else if (outline) parts.push(PAGE_LINE.outline);
  else if (primarySec?.kind === 'product_detail') parts.push(PAGE_LINE.product);
  else if (drawerEls.length) parts.push(PAGE_LINE.drawers);
  pageLine.textContent = parts.join(' · ');
  if (!pageLine.textContent) pageLine.remove();

  // ---------------- conservation ----------------
  const conservation = checkConservation({
    index,
    registry,
    emitted,
    reached,
    hidden,
    rest: validated.rest,
    lists,
  });
  const rest = [...validated.rest, ...conservation.missing].filter(
    (id, k, a) => a.indexOf(id) === k && index.nodes.has(id),
  );
  const restEl = renderRest(ctx, rest, env);
  if (drawerEls.length || restEl) {
    const block = h(doc, 'section', 'fv-drawers');
    const dh = h(doc, 'h2', 't-section', FV_COPY.moreOnThisPage);
    dh.id = ctx.uid('h');
    block.setAttribute('aria-labelledby', dh.id);
    block.append(dh, ...drawerEls);
    if (restEl) block.append(restEl);
    main.append(block);
  }

  return {
    ctx,
    index,
    lists,
    emitted,
    reached,
    primary: primaryEl,
    compressors: env.compressors,
    offer,
    notice,
    status,
    conservation,
    closeMore() {
      if (panel.hidden || !moreToggle) return false;
      setMore(false);
      moreToggle.focus({ preventScroll: true });
      return true;
    },
    dispose() {
      states?.disconnect();
      states = null;
      for (const off of cleanups.splice(0)) off();
      for (const lv of lists.values()) lv.dispose();
      lists.clear();
    },
  };
}
