// Owner: P (round 7). The meaning-first Calm planner, pure and deterministic.
//
// Jev page model v2 says what a page is for (its purpose), which region holds what the page exists to show (the main
// region) and a fine role and importance for each element. This module turns that, plus the structured content read on
// the device (`OutlineNode.data`), into a PageMeaning:
//  - which purpose template Calm view draws (record and stats, recipe, article, form, status lookup, news, results);
//  - what leads: the main region when Jev is sure of it (p >= 0.8), else the highest-importance content;
//  - which data the template draws first, in what order (scoreboard, then the record, then the history table);
//  - which parts go to the end drawer (teasers for other content, ads, upsells, newsletter boxes) and which logos stay.
// It also rearranges a FitSpec so the lead comes first, builds the structure-only MeaningCheckRequest Jev is asked
// about (roles only: no page text, no numbers), and answers that question locally when Jev cannot be reached.
import type {
  ElementJudgment, ExtractedData, FineRole, FitSection, FitSpec, MeaningCheckRequest, OutlineNode, PagePurpose, PageOutline,
  PageUnderstanding, SectionLabel,
} from '../types';
import { indexOutline, outlineProtection, type OutlineIndex } from './outline';

export type PurposeTemplate =
  | 'record_stats' | 'recipe' | 'article' | 'form_task' | 'status_lookup' | 'news_index' | 'search_results' | 'page';

/** Jev's main-region pick is acted on only at this probability (both option orders agree, server side). */
export const MAIN_REGION_MIN_P = 0.8;
/** A page purpose picks a template only at this probability. */
export const PURPOSE_MIN_P = 0.6;
/** A fine role counts only at this probability. */
export const FINE_MIN_P = 0.5;
/** Importance (0 distraction .. 4 essential) that makes content worth leading with when no main region is sure. */
export const LEAD_IMPORTANCE = 3;
/** Content within this much of the most important leads with it (importance is an expected level, 0..4). */
export const IMPORTANCE_BAND = 0.35;

/** Distractions: always to the end drawer, never the lead. */
export const DRAWER_FINE: ReadonlySet<FineRole> = new Set<FineRole>([
  'advertising', 'sponsored', 'upsell_promo', 'newsletter_signup', 'teaser_other_content', 'social_share', 'video_autoplay',
  // round 8: finer roles that used to be answered as the ones above
  'ad_disclosure', 'app_install_banner', 'paywall_prompt', 'betting_odds', 'related_links', 'testimonial',
]);
/** Never what Calm view leads with (chrome, notices, distractions). */
export const NEVER_LEAD_FINE: ReadonlySet<FineRole> = new Set<FineRole>([
  ...DRAWER_FINE, 'carousel', 'comments', 'popup', 'consent_notice', 'legal_footer', 'site_nav', 'section_nav', 'breadcrumb',
  'account_utility', 'decorative', 'pagination', 'site_logo', 'tabs', 'jump_link', 'back_link', 'help_link', 'other',
  // round 8: finer roles that used to be answered as the ones above
  'skip_link', 'table_of_contents', 'tag_list', 'login_prompt', 'chat_widget', 'ticker', 'countdown_timer',
  'stock_warning', 'captcha',
]);
/** Logos that identify something on the page: kept and shown. */
export const KEEP_LOGO_FINE: ReadonlySet<FineRole> = new Set<FineRole>(['team_or_org_logo', 'site_logo']);

const TEMPLATE_OF: Partial<Record<PagePurpose, PurposeTemplate>> = {
  record_stats: 'record_stats', scoreboard: 'record_stats', standings: 'record_stats', schedule: 'record_stats', comparison: 'record_stats',
  recipe: 'recipe', article: 'article', news_index: 'news_index', search_results: 'search_results',
  form_task: 'form_task', checkout: 'form_task', sign_in: 'form_task', appointment: 'form_task', status_lookup: 'status_lookup',
  // round 8: new kinds keep the layout their old answer got (a game page was a record, a store listing a result list)
  game_detail: 'record_stats', product_listing: 'search_results', live_blog: 'article',
};

/** Purposes that are a task: their own layout (a form, a cart, results) wins over content read from the page. */
const TASK_PURPOSES: ReadonlySet<PagePurpose> = new Set<PagePurpose>([
  'form_task', 'checkout', 'sign_in', 'appointment', 'account_dashboard', 'bill_statement', 'product', 'search_results',
  'product_listing',
]);

/** Data kinds each data template draws, in the order it draws them. */
const DATA_ORDER: Partial<Record<PurposeTemplate, ReadonlyArray<ExtractedData['kind']>>> = {
  record_stats: ['scoreboard', 'stats', 'schedule', 'table'],
  recipe: ['recipe'],
};

/** Fine roles a piece of structured content stands for (the meaning check sees roles, never the content). */
export function rolesOfData(d: ExtractedData): FineRole[] {
  switch (d.kind) {
    case 'stats': return ['stat_value', 'stat_label'];
    case 'scoreboard': return d.sides.some((s) => !!s.logoSrc) ? ['scoreboard', 'team_or_org_logo'] : ['scoreboard'];
    case 'table': return ['data_table'];
    case 'schedule': return ['schedule_item'];
    case 'recipe': return ['ingredient_list', 'instruction_steps', 'recipe_meta'];
    case 'logo': return ['team_or_org_logo'];
  }
}

/** True when a piece of extracted data has enough in it to draw. */
export function usableData(d: ExtractedData | undefined | null): d is ExtractedData {
  if (!d || typeof d !== 'object') return false;
  switch (d.kind) {
    case 'stats': return Array.isArray(d.items) && d.items.filter((x) => x && x.label && x.value).length >= 2;
    case 'scoreboard': return Array.isArray(d.sides) && d.sides.length === 2 && d.sides.every((s) => s && s.name);
    case 'table': return Array.isArray(d.columns) && Array.isArray(d.rows) && d.rows.length >= 2 && d.columns.length >= 2;
    case 'schedule': return Array.isArray(d.items) && d.items.length >= 2;
    case 'recipe': return !!d.title && Array.isArray(d.ingredients) && Array.isArray(d.steps) && d.ingredients.length >= 2 && d.steps.length >= 1;
    case 'logo': return !!d.src;
    default: return false;
  }
}

export interface MeaningSource {
  outline: PageOutline;
  understanding?: Pick<PageUnderstanding, 'purpose' | 'mainRegion' | 'elements'> | null;
  /**
   * Outline ids inside Jev's main region, worked out from the page (the region is a digest region and may not be an
   * outline node itself). When the region is an outline node its subtree is used.
   */
  mainMembers?: readonly string[] | null;
}

export interface PageMeaning {
  purpose: PagePurpose | null;
  purposeP: number;
  template: PurposeTemplate;
  /** Jev's main region, only when it is sure (p >= MAIN_REGION_MIN_P). */
  mainRegion: { id: string; p: number } | null;
  /** Outline ids inside the main region (empty when no region was accepted). */
  main: string[];
  /** What Calm view leads with, and why. */
  lead: { ids: string[]; why: 'main_region' | 'importance' | 'none' };
  /** Structured content the template draws before everything else, in its order. */
  data: Array<{ id: string; data: ExtractedData }>;
  /** Outline ids whose fine role is a distraction (teasers, ads, upsells, newsletter boxes). */
  drawer: string[];
  /** Outline ids in the content column that Jev calls the site's menu or legal footer (to "Site links" on reading pages). */
  chrome: string[];
  /** Outline ids of logos that identify something in the content (kept and shown; never the site's own logo). */
  logos: string[];
  fine: Record<string, FineRole>;
  importance: Record<string, number>;
  /** Jev's P(this is the page's main action), per element it judged. */
  mainP: Record<string, number>;
}

function judgmentsOf(src: MeaningSource): Map<string, ElementJudgment> {
  return new Map((src.understanding?.elements ?? []).map((e) => [e.id, e] as const));
}

/** The fine role of each outline node: the node's own (set by the engine) or Jev's judgment, when probable enough. */
export function fineRoles(outline: PageOutline, elements: readonly ElementJudgment[] = []): Record<string, FineRole> {
  const out: Record<string, FineRole> = {};
  for (const e of elements) if (e.fine && (e.fineP ?? 1) >= FINE_MIN_P) out[e.id] = e.fine;
  for (const n of outline.nodes) if (n.fine) out[n.id] = n.fine;
  return out;
}

/** The template for a purpose (when Jev is sure enough of it) and the data the page has. */
export function templateFor(purpose: PagePurpose | null, purposeP: number, kinds: ReadonlySet<ExtractedData['kind']>): PurposeTemplate {
  const sure = purpose && purposeP >= PURPOSE_MIN_P ? purpose : null;
  // A recipe card the page publishes (schema.org Recipe) is the page's meaning unless the page is a task: Jev may call
  // a long recipe page an article or "other", and the card is still what a cook came for.
  if (kinds.has('recipe') && !(sure && TASK_PURPOSES.has(sure))) return 'recipe';
  // Likewise a scoreboard or record on a page Jev could not place.
  if (sure === 'other' && (kinds.has('scoreboard') || kinds.has('stats'))) return 'record_stats';
  const t = sure ? TEMPLATE_OF[sure] ?? 'page' : null;
  if (t === 'record_stats') return kinds.has('scoreboard') || kinds.has('stats') || kinds.has('table') || kinds.has('schedule') ? t : 'page';
  if (t === 'recipe') return kinds.has('recipe') ? t : 'page';
  if (t) return t;
  if (sure) return 'page';
  // No sure purpose: the content read on the device decides (a recipe card, a record with a scoreboard).
  if (kinds.has('recipe')) return 'recipe';
  if (kinds.has('scoreboard') || kinds.has('stats')) return 'record_stats';
  return 'page';
}

function within(ix: OutlineIndex, anc: string, id: string): boolean {
  return anc === id || ix.isAncestor(anc, id);
}

/** Read what the page is for and what leads, from Jev's page model v2 and the content read on the device. */
export function readMeaning(src: MeaningSource): PageMeaning {
  const ix = indexOutline(src.outline);
  const u = src.understanding ?? null;
  const judg = judgmentsOf(src);
  const fine = fineRoles(src.outline, u?.elements ?? []);
  const importance: Record<string, number> = {};
  const mainP: Record<string, number> = {};
  for (const [id, j] of judg) {
    if (typeof j.importance === 'number' && Number.isFinite(j.importance)) importance[id] = j.importance;
    if (typeof j.main === 'number' && Number.isFinite(j.main)) mainP[id] = j.main;
  }

  const purpose = u?.purpose?.kind ?? null;
  const purposeP = u?.purpose?.p ?? 0;

  // Main region: Jev's pick when it is sure; its members from the page (or the node's subtree).
  let mainRegion: PageMeaning['mainRegion'] = null;
  let main: string[] = [];
  const mr = u?.mainRegion;
  if (mr && mr.id !== 'none' && mr.p >= MAIN_REGION_MIN_P) {
    mainRegion = { id: mr.id, p: mr.p };
    if (ix.nodes.has(mr.id)) main = [mr.id, ...ix.descendants(mr.id)];
    else if (src.mainMembers?.length) {
      const set = new Set(src.mainMembers.filter((id) => ix.nodes.has(id)));
      main = [...set];
    }
  }
  const mainSet = new Set(main);

  // Distractions and logos.
  const drawer: string[] = [];
  const logos: string[] = [];
  for (const n of src.outline.nodes) {
    const f = fine[n.id];
    if (!f) continue;
    // A distraction inside the main region that holds data the page exists to show is not folded (Jev's lower-level
    // call loses to the main region it confirmed at 0.8).
    if (DRAWER_FINE.has(f) && !(mainSet.has(n.id) && hasDataBelow(ix, n.id))) drawer.push(n.id);
  }
  // Logos that identify something in the content (a team's mark): Jev's fine role, or a logo read from the content.
  // The site's own logo stays in the top bar as the site's name.
  for (const n of src.outline.nodes) {
    const f = fine[n.id];
    if (f === 'site_logo' || drawer.some((d) => within(ix, d, n.id))) continue;
    if (f === 'team_or_org_logo' || (n.data?.kind === 'logo' && !isChrome(n))) logos.push(n.id);
  }
  const inDrawer = (id: string): boolean => drawer.some((d) => within(ix, d, id));

  // Structured content, deduplicated: content inside a scoreboard (its line score) is the scoreboard's; content inside
  // a distraction stays with it.
  const all: Array<{ id: string; data: ExtractedData; ord: number }> = [];
  for (const n of src.outline.nodes) {
    if (!usableData(n.data) || inDrawer(n.id)) continue;
    all.push({ id: n.id, data: n.data, ord: ix.order.get(n.id) ?? 0 });
  }
  const kinds = new Set(all.map((x) => x.data.kind));
  const template = templateFor(purpose, purposeP, kinds);
  const want = DATA_ORDER[template] ?? [];
  const scoreboards = all.filter((x) => x.data.kind === 'scoreboard').map((x) => x.id);
  const picked = all.filter((x) => {
    if (!want.includes(x.data.kind)) return false;
    if (x.data.kind !== 'scoreboard' && scoreboards.some((s) => s !== x.id && within(ix, s, x.id))) return false;
    // Page chrome (a header strip of recent games) is never what the page is about.
    const node = ix.nodes.get(x.id);
    if (node && isChrome(node)) return false;
    // With a sure main region, a scoreboard or record outside it is not what the page exists to show (a sidebar
    // widget); tables, schedules and recipes elsewhere in the content still come after it.
    const inMain = mainSet.has(x.id) || main.some((id) => within(ix, x.id, id));
    if (mainSet.size && !inMain && (x.data.kind === 'scoreboard' || x.data.kind === 'stats')) return false;
    return true;
  });
  // Equal content read twice (a node and its wrapper): keep the outer one.
  const dedup = picked.filter((x) => !picked.some((o) => o !== x && o.data.kind === x.data.kind && within(ix, o.id, x.id)));
  const data = dedup
    .sort((a, b) => want.indexOf(a.data.kind) - want.indexOf(b.data.kind) || a.ord - b.ord)
    .slice(0, 6)
    .map(({ id, data: d }) => ({ id, data: d }));

  // The lead: the main region, else the most important content (never a distraction or page chrome).
  let lead: PageMeaning['lead'] = { ids: [], why: 'none' };
  if (mainRegion && main.length) {
    const tops = main.filter((id) => !mainSet.has(ix.parent(id) ?? ''));
    lead = { ids: tops.length ? tops : main.slice(0, 1), why: 'main_region' };
  } else {
    const cands = src.outline.nodes
      .filter((n) => (importance[n.id] ?? -1) >= LEAD_IMPORTANCE && !NEVER_LEAD_FINE.has(fine[n.id] as FineRole) && !inDrawer(n.id))
      .filter((n) => !isChrome(n));
    if (cands.length) {
      // Importance is Jev's expected level (fractional): everything within a third of a level of the top leads together
      // (a status page's heading, its first sentence and its main button), most important first.
      const top = Math.max(...cands.map((n) => importance[n.id] as number));
      const floor = Math.max(LEAD_IMPORTANCE, top - IMPORTANCE_BAND);
      const ids = cands
        .filter((n) => (importance[n.id] as number) >= floor)
        .sort((a, b) => (importance[b.id] as number) - (importance[a.id] as number) || (ix.order.get(a.id) ?? 0) - (ix.order.get(b.id) ?? 0))
        .map((n) => n.id)
        .slice(0, 6);
      lead = { ids, why: 'importance' };
    }
  }
  // The site's menu or legal footer inside the content column (a footer the page draws in its main box) goes with the
  // site links on pages for reading and looking things up; on a form it stays where the task is.
  const chrome: string[] = [];
  if (template === 'record_stats' || template === 'recipe' || template === 'article' || template === 'news_index' || template === 'status_lookup') {
    for (const n of src.outline.nodes) {
      const f = fine[n.id];
      if ((f === 'legal_footer' || f === 'site_nav') && !isChrome(n) && !mainSet.has(n.id) && !inDrawer(n.id)) chrome.push(n.id);
    }
  }
  return { purpose, purposeP, template, mainRegion, main, lead, data, drawer, chrome, logos, fine, importance, mainP };
}

function hasDataBelow(ix: OutlineIndex, id: string): boolean {
  if (usableData(ix.nodes.get(id)?.data)) return true;
  return ix.descendants(id).some((d) => usableData(ix.nodes.get(d)?.data));
}

function isChrome(n: OutlineNode): boolean {
  const zone = n.zone ?? '';
  const lm = (n.landmark ?? '').toLowerCase();
  return zone === 'header_band' || zone === 'footer_band' || zone.startsWith('overlay') || lm === 'navigation' || lm === 'contentinfo' || lm === 'banner';
}

/* ------------------------------------------------------------------ */
/* The spec, meaning first                                             */
/* ------------------------------------------------------------------ */

const CONTENT_ROLES: ReadonlySet<FitSection['role']> = new Set<FitSection['role']>(['primary', 'orient', 'supporting', 'reference', 'social_proof', 'other']);

function drawerSectionFor(f: FineRole): { label: SectionLabel; role: FitSection['role']; why: FitSection['why'] } {
  if (f === 'advertising' || f === 'sponsored' || f === 'ad_disclosure' || f === 'betting_odds') return { label: 'Sponsored', role: 'ads', why: 'advertising' };
  if (f === 'legal_footer' || f === 'site_nav') return { label: 'Site links', role: 'navigation', why: 'navigation' };
  if (f === 'upsell_promo' || f === 'newsletter_signup' || f === 'app_install_banner' || f === 'paywall_prompt') return { label: 'Offers', role: 'promo', why: 'promotion' };
  return { label: 'Related items', role: 'related', why: 'not_needed_for_task' };
}

/**
 * Rearrange a Calm spec so it keeps the page's meaning: distractions Jev named (teasers for other content, ads,
 * upsells, newsletter boxes) move to the end drawer, and the section holding the lead (the main region, else the most
 * important content) comes first among the content sections, open. Help, consent, alerts, fields and the primary action
 * are never moved. Returns plain notes for the ledger.
 */
export function applyMeaning(spec: FitSpec, outline: PageOutline, m: PageMeaning): { spec: FitSpec; notes: string[] } {
  const ix = indexOutline(outline);
  const notes: string[] = [];
  const sections = spec.sections.map((s) => ({ ...s, nodes: [...s.nodes] }));
  const pa = spec.primary_action;
  const keep = (id: string): boolean => {
    if (pa && within(ix, id, pa)) return true;
    for (const x of [id, ...ix.descendants(id)]) {
      const p = outlineProtection(ix, x);
      if (p === 'help' || p === 'consent' || p === 'alert' || p === 'field' || p === 'safety') return true;
    }
    return false;
  };

  // 1. Distractions to the end drawer (and, on reading pages, the site's menu or footer drawn in the content column).
  const drawerSet = new Set([...m.drawer, ...m.chrome]);
  let moved = 0;
  for (const s of sections) {
    if (s.state === 'end_drawer' || !CONTENT_ROLES.has(s.role) && s.role !== 'navigation') continue;
    const out = s.nodes.filter((id) => drawerSet.has(id) && !keep(id));
    if (!out.length) continue;
    s.nodes = s.nodes.filter((id) => !out.includes(id));
    for (const id of out) {
      const kind = drawerSectionFor(m.fine[id] as FineRole);
      let target = sections.find((x) => x.state === 'end_drawer' && x.label === kind.label);
      if (!target) {
        target = {
          heading_ref: null, label: kind.label, role: kind.role, nodes: [], layout: kind.role === 'navigation' ? 'link_grid' : 'card_grid', emphasis: 'quiet', state: 'end_drawer',
          why: kind.why, show_first: 0,
        };
        sections.push(target);
      }
      target.nodes.push(id);
      moved++;
    }
  }
  if (moved) notes.push(`${moved} part${moved === 1 ? '' : 's'} Jev called a teaser, ad, offer or site link moved to “More on this page”`);
  let out = sections.filter((s) => s.nodes.length > 0);

  // 2. The lead section first, open.
  if (m.lead.ids.length) {
    const holds = (s: FitSection): boolean =>
      s.nodes.some((id) => m.lead.ids.some((l) => within(ix, id, l) || within(ix, l, id)));
    let idx = out.findIndex((s) => CONTENT_ROLES.has(s.role) && holds(s));
    if (idx >= 0 && out[idx]!.state !== 'open') {
      // Folded or in the drawer: the lead's own parts come out into an open section of their own.
      const from = out[idx] as FitSection;
      const ids = from.nodes.filter((id) => m.lead.ids.some((l) => within(ix, id, l) || within(ix, l, id)));
      from.nodes = from.nodes.filter((id) => !ids.includes(id));
      const own: FitSection = {
        heading_ref: null, label: from.label === 'More on this page' ? 'Details' : from.label, role: 'supporting', nodes: ids,
        layout: 'as_is', emphasis: 'lead', state: 'open', why: 'main_task', show_first: 0,
      };
      out.splice(idx, 0, own);
      if (!from.nodes.length) out = out.filter((x) => x !== from);
      idx = out.indexOf(own);
      notes.push('Opened the part that holds what this page is for');
    }
    if (idx >= 0) {
      const s = out[idx] as FitSection;
      const firstContent = out.findIndex((x) => CONTENT_ROLES.has(x.role) && x.state !== 'end_drawer');
      for (const x of out) if (x !== s && x.emphasis === 'lead') x.emphasis = 'normal';
      s.emphasis = 'lead';
      if (firstContent >= 0 && firstContent < idx) {
        // A title-only band ("orient") stays above it: the page's title still comes first.
        const titleOnly = (x: FitSection): boolean => x.role === 'orient' && x.nodes.every((id) => ix.kind(id) === 'heading');
        let at = firstContent;
        while (at < idx && titleOnly(out[at] as FitSection)) at++;
        if (at < idx) {
          out = [...out.slice(0, at), s, ...out.slice(at, idx), ...out.slice(idx + 1)];
          notes.push(m.lead.why === 'main_region' ? 'Moved the main information to the top' : 'Moved the most important part to the top');
        }
      }
    }
  }
  // 3. Nothing important to what the page is for stays folded: content Jev rates important (>= 3 of 4) that sits in a
  // collapsed part or the end drawer comes out into an open part right after the lead (a recipe's intro, a status
  // page's "when to call" note). Page chrome and distractions never do.
  const isImportant = (id: string): boolean => {
    const f = m.fine[id];
    const n = ix.nodes.get(id);
    if (!n || isChrome(n) || (f && NEVER_LEAD_FINE.has(f)) || drawerSet.has(id)) return false;
    return (m.importance[id] ?? 0) >= LEAD_IMPORTANCE;
  };
  const lifted: string[] = [];
  for (const s of out) {
    if (s.state === 'open' || !CONTENT_ROLES.has(s.role)) continue;
    const take = s.nodes.filter((id) => [id, ...ix.descendants(id)].some(isImportant));
    if (!take.length) continue;
    s.nodes = s.nodes.filter((id) => !take.includes(id));
    lifted.push(...take);
  }
  if (lifted.length) {
    lifted.sort((a, b) => (ix.order.get(a) ?? 0) - (ix.order.get(b) ?? 0));
    const sec: FitSection = {
      heading_ref: null, label: 'Details', role: 'supporting', nodes: lifted, layout: 'as_is', emphasis: 'normal', state: 'open',
      why: 'main_task', show_first: 0,
    };
    const leadAt = out.findIndex((x) => x.emphasis === 'lead');
    out = out.filter((x) => x.nodes.length > 0);
    const at = leadAt >= 0 ? Math.min(out.length, out.findIndex((x) => x.emphasis === 'lead') + 1) : out.findIndex((x) => CONTENT_ROLES.has(x.role) && x.state === 'open') + 1;
    out.splice(Math.max(0, at), 0, sec);
    notes.push(`Opened ${lifted.length} part${lifted.length === 1 ? '' : 's'} Jev rates important to what this page is for`);
  }
  return { spec: { ...spec, sections: out }, notes };
}

/* ------------------------------------------------------------------ */
/* The meaning check (structure only)                                  */
/* ------------------------------------------------------------------ */

const ARTICLE_HEAD: ReadonlyArray<FineRole> = ['headline', 'page_title', 'dek_summary', 'byline', 'dateline', 'lead_image'];

function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

/**
 * What Jev is asked: the original page's main information and the Calm plan's lead, shown and folded parts, as fine
 * roles only. No labels, page text or numbers are included.
 */
export function meaningRequest(spec: FitSpec, outline: PageOutline, m: PageMeaning): MeaningCheckRequest {
  const ix = indexOutline(outline);
  const roleOf = (id: string): FineRole | undefined => m.fine[id];
  const sub = (id: string): string[] => [id, ...ix.descendants(id)];
  const byImportance = (ids: string[]): string[] =>
    [...ids].sort((a, b) => (m.importance[b] ?? 2) - (m.importance[a] ?? 2) || (ix.order.get(a) ?? 0) - (ix.order.get(b) ?? 0));
  const rolesIn = (ids: string[], filter = (_r: FineRole) => true): FineRole[] =>
    uniq(ids.map(roleOf).filter((r): r is FineRole => !!r && filter(r)));
  const meaningful = (r: FineRole): boolean => !NEVER_LEAD_FINE.has(r);
  const dataRoles = (ids: Array<{ data: ExtractedData }>): FineRole[] => uniq(ids.flatMap((x) => rolesOfData(x.data)));

  // The original page: its main region (or its most important content) and what in it must stay.
  const leadIds = m.lead.ids.flatMap(sub);
  const mainIds = m.main.length ? m.main : leadIds;
  const dataInMain = m.data.filter((d) => !mainIds.length || mainIds.some((x) => within(ix, x, d.id) || within(ix, d.id, x)));
  const originalLead = uniq([...dataRoles(dataInMain), ...rolesIn(byImportance(mainIds), meaningful)]).slice(0, 6);
  const must = uniq([
    ...dataRoles(dataInMain),
    ...rolesIn(mainIds.filter((id) => (m.importance[id] ?? 0) >= LEAD_IMPORTANCE), meaningful),
  ]).filter((r) => r !== 'page_title').slice(0, 8);
  const mainDesc = m.main.length ? `main region: ${rolesIn(m.main, meaningful).slice(0, 8).join(', ') || 'content'}`
    : m.lead.why === 'importance' ? `most important content: ${originalLead.join(', ') || 'content'}` : 'none';

  // The Calm plan, in the order Calm view draws it: the page's title band, what the template draws first, then the part
  // that leads. Parts Calm view folds into the drawer (distractions Jev named, inside open parts too) are not "shown".
  // A news page is drawn as the page's own story list, lead story first (round 8: the view keeps its teasers, so the
  // check must not count them as folded).
  const storyList = m.template === 'news_index';
  const hidden = new Set<string>([...m.drawer.filter((id) => !(storyList && m.fine[id] === 'teaser_other_content')), ...m.chrome].flatMap(sub));
  const visible = (ids: string[]): string[] => ids.filter((id) => !hidden.has(id));
  const open = spec.sections.filter((s) => s.state === 'open' && s.role !== 'navigation' && s.role !== 'legal');
  const folded = spec.sections.filter((s) => s.state !== 'open' || s.role === 'navigation');
  // The part drawn first after the title: the one holding the lead, else the first content part that is more than a
  // title (the title band is drawn first whatever the order).
  const titleOnly = (s: FitSection): boolean => s.nodes.flatMap(sub).every((x) => !roleOf(x) || roleOf(x) === 'page_title' || roleOf(x) === 'headline' || !meaningful(roleOf(x) as FineRole));
  const holdsLead = (s: FitSection): boolean => s.nodes.some((id) => m.lead.ids.some((l) => within(ix, id, l) || within(ix, l, id)));
  const firstContent = open.find((s) => CONTENT_ROLES.has(s.role) && holdsLead(s) && !titleOnly(s))
    ?? open.find((s) => CONTENT_ROLES.has(s.role) && !titleOnly(s));
  // The lead part's roles in page order (that is how Calm view draws it), important ones kept when the list is cut.
  const firstIds = firstContent ? visible(firstContent.nodes.flatMap(sub)) : [];
  const keepImportant = new Set(rolesIn(byImportance(firstIds), meaningful).slice(0, 4));
  let firstRoles = rolesIn(firstIds, meaningful).filter((r, i) => i < 6 || keepImportant.has(r));
  // Opening text before a form is drawn as one orientation sentence in the title band (the rest waits behind "About this
  // page"), and the form's main button sits in the dock from the first screen: a form leads with its fields and button.
  if (m.template === 'form_task' || m.template === 'page') {
    if (firstRoles[0] === 'body_text' && firstRoles.some((r) => r === 'form_field')) firstRoles = firstRoles.slice(1);
    if (spec.primary_action && firstRoles.includes('primary_action')) {
      const at = firstRoles.indexOf('form_field');
      if (at >= 0) firstRoles = uniq([...firstRoles.slice(0, at + 1), 'primary_action' as FineRole, ...firstRoles.slice(at + 1)]);
    }
  }
  const shownIds = visible(open.flatMap((s) => s.nodes.flatMap(sub)));
  // A container no section lists itself (a content region around placed parts) is shown when most of what it holds is.
  const placedAll = new Set(spec.sections.flatMap((s) => s.nodes.flatMap(sub)));
  const openSet = new Set(shownIds);
  for (const n of outline.nodes) {
    if (placedAll.has(n.id) || hidden.has(n.id)) continue;
    const ds = ix.descendants(n.id);
    if (ds.length && ds.filter((d) => openSet.has(d)).length >= 0.5 * ds.length) shownIds.push(n.id);
  }
  const shownSet = new Set(shownIds);
  const allRoles = rolesIn(outline.nodes.map((n) => n.id));
  // Calm view always opens with the page's title (its heading, else the document title; a recipe card's own title).
  const title: FineRole[] = [allRoles.includes('headline') && !allRoles.includes('page_title') ? 'headline' : 'page_title'];
  let calmLead: FineRole[];
  if (m.template === 'article') {
    calmLead = uniq([...ARTICLE_HEAD.filter((r) => allRoles.includes(r)), ...firstRoles]);
  } else if (m.template === 'status_lookup') {
    // Title, the page's own orientation sentence, then its main action, then the rest of the lead part.
    const action = rolesIn(shownIds).includes('primary_action') ? ['primary_action' as FineRole] : [];
    const orient = firstRoles.find((r) => r === 'body_text' || r === 'dek_summary' || r === 'key_fact');
    calmLead = uniq([...title, ...(orient ? [orient] : []), ...action, ...firstRoles]);
  } else {
    calmLead = uniq([...title, ...dataRoles(m.data), ...firstRoles]);
  }
  // Shown roles as a set, listed main information first, then the rest in page order, chrome and distractions last.
  const shownAll = uniq([...dataRoles(m.data), ...rolesIn(shownIds)]);
  const rank = (r: FineRole): number => ((must as FineRole[]).includes(r) || originalLead.includes(r) ? 0 : NEVER_LEAD_FINE.has(r) || r === 'carousel' ? 2 : 1);
  const shown = shownAll.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
  const foldedRoles = rolesIn([...folded.flatMap((s) => s.nodes.flatMap(sub)), ...hidden].filter((id) => !shownSet.has(id))).filter((r) => !shown.includes(r));
  return {
    purpose: m.purpose,
    original: { mainRegion: mainDesc, leadRoles: originalLead, mustKeep: must },
    calm: { leadRoles: calmLead.slice(0, 6), shownRoles: shown, foldedRoles },
  };
}

/**
 * The meaning check without Jev (when its server is unreachable): Calm view leads with the main information when one
 * of the original's leading roles is among the plan's first roles and no distraction comes first; main information is
 * missing in proportion to the must-keep roles the plan does not show.
 */
export function localMeaningVerdict(req: MeaningCheckRequest): { leadsWithMain: number; missingMain: number; pass: boolean } {
  const lead = req.calm.leadRoles.slice(0, 4);
  const want = req.original.leadRoles.filter((r) => r !== 'page_title').slice(0, 4);
  let leadsWithMain = want.length ? (want.some((r) => lead.includes(r)) ? 0.9 : 0.15) : 0.85;
  if (lead.slice(0, 3).some((r) => DRAWER_FINE.has(r))) leadsWithMain = Math.min(leadsWithMain, 0.1);
  const shown = new Set(req.calm.shownRoles);
  const must = req.original.mustKeep;
  const missing = must.filter((r) => !shown.has(r)).length;
  const missingMain = must.length ? Math.min(0.95, Math.max(0.05, missing / must.length)) : 0.05;
  return { leadsWithMain, missingMain, pass: leadsWithMain >= 0.8 && missingMain <= 0.2 };
}

/** The meaning check's rule (shared with Jev's verdict): leads with the main information, nothing main missing. */
export function meaningPasses(v: { leadsWithMain: number; missingMain: number }): boolean {
  return v.leadsWithMain >= 0.8 && v.missingMain <= 0.2;
}

/* ------------------------------------------------------------------ */
/* Plain words                                                         */
/* ------------------------------------------------------------------ */

const PURPOSE_WORDS: Record<PagePurpose, string> = {
  record_stats: 'a record and stats', scoreboard: 'a scoreboard', schedule: 'a schedule', standings: 'standings', roster: 'a roster',
  article: 'an article', news_index: 'a news page', recipe: 'a recipe', product: 'a product', search_results: 'search results',
  form_task: 'a form to fill in', checkout: 'a checkout', sign_in: 'a sign-in page', account_dashboard: 'an account page',
  bill_statement: 'a bill', appointment: 'an appointment page', status_lookup: 'a status check', info_guide: 'a guide',
  faq: 'questions and answers', directory_listing: 'a directory', location_hours: 'a location and hours', calendar_dates: 'a calendar',
  comparison: 'a comparison', video: 'a video', gallery: 'a gallery', home_portal: 'a home page', course_lesson: 'a lesson',
  course_overview: 'a course page', live_blog: 'a live blog', product_listing: 'a product listing', game_detail: 'a game page',
  other: 'a page',
};

/** "a record and stats", for the ledger. */
export function purposeWords(p: PagePurpose | null): string {
  return p ? PURPOSE_WORDS[p] ?? 'a page' : 'a page';
}

const DATA_WORDS: Record<ExtractedData['kind'], string> = {
  scoreboard: 'the scoreboard', stats: 'the record', table: 'the table', schedule: 'the schedule', recipe: 'the ingredients and steps', logo: 'the logos',
};

/** "the scoreboard and the record", for the ledger: what Calm view leads with. */
export function leadWords(m: PageMeaning): string {
  const kinds = uniq(m.data.map((d) => d.data.kind)).filter((k) => k !== 'logo').slice(0, 2);
  if (kinds.length) return kinds.map((k) => DATA_WORDS[k]).join(' and ');
  if (m.template === 'article') return 'the headline, picture and byline';
  if (m.template === 'status_lookup' || m.template === 'form_task') return 'the main task';
  return m.lead.why === 'main_region' ? 'the main information' : m.lead.why === 'importance' ? 'the most important part' : 'the page’s own order';
}
