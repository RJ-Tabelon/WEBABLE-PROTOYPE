// Owner: A2.
// FitSpec v1: the zod schema, the OpenAI strict JSON schema (identical to redesign-bench/fitspec.schema.json)
// and the deterministic validator/repairer that runs on every spec (model, heuristic or cached).
import { z } from 'zod';
import type { FitSection, FitSpec, FitSummaryForModel, OutlineKind, PageOutline, Role, SectionLabel } from '../types';
import {
  ACTION_KINDS, CONTAINER_KINDS, CONTROL_KINDS, FIELD_KINDS, RE, coveredIds, indexOutline, isUtility, labelFromWords,
  layoutLimits, outlineProtection, pickPrimaryAction, snapShowFirst,
  type LayoutLimits, type OutlineIndex, type Protection,
} from './outline';

export {
  indexOutline, layoutLimits, outlineProtection, pickPrimaryAction, placementMap, sectionRenderIds, specCoverage,
  type LayoutLimits, type OutlineIndex, type Protection,
} from './outline';
// Calm view v3's picture, story and type rules (D, round 4), re-exported here so index.ts needs no new line.
export * from './pictures';
// Round 7: the meaning-first Calm planner (purpose templates, lead, drawer, the meaning check), re-exported the same way.
export * from './purpose';

/* ------------------------------------------------------------------ */
/* Enums (single source for zod and the JSON schema)                   */
/* ------------------------------------------------------------------ */

export const FIT_PAGE_TYPES = [
  'product_detail', 'search_results', 'listing', 'article', 'form', 'home_portal', 'account_dashboard', 'video', 'docs',
  'inbox', 'feed', 'other',
] as const satisfies readonly FitSpec['page_type'][];
export const FIT_TASKS = [
  'buy', 'compare', 'read', 'search', 'fill_form', 'sign_in', 'watch', 'book', 'pay', 'navigate', 'contact', 'other',
] as const satisfies readonly FitSpec['task'][];
export const FIT_SECTION_LABELS = [
  'Overview', 'Buy', 'Choose options', 'Delivery and returns', 'Details', 'Specifications', 'Safety information',
  'Reviews', 'Questions', 'Related items', 'Sponsored', 'Offers', 'Navigation', 'Site links', 'Account', 'Help',
  'Legal', 'Search', 'Cookies', 'Notice', 'Your details', 'Address', 'Date', 'What you need', 'Billing',
  'Review and submit', 'Contact', 'Results', 'Filters', 'Article', 'Comments', 'Media', 'More on this page', 'Other',
] as const satisfies readonly SectionLabel[];
export const FIT_SECTION_ROLES = [
  'primary', 'orient', 'supporting', 'reference', 'social_proof', 'related', 'navigation', 'promo', 'ads', 'help',
  'legal', 'consent', 'alert', 'other',
] as const satisfies readonly FitSection['role'][];
export const FIT_SECTION_LAYOUTS = [
  'hero', 'buy_box', 'card_grid', 'row_list', 'reading', 'facts', 'form_steps', 'chip_bar', 'link_grid', 'gallery', 'as_is',
] as const satisfies readonly FitSection['layout'][];
export const FIT_EMPHASES = ['lead', 'normal', 'quiet'] as const satisfies readonly FitSection['emphasis'][];
export const FIT_SECTION_STATES = ['open', 'collapsed', 'end_drawer'] as const satisfies readonly FitSection['state'][];
export const FIT_WHYS = [
  'main_task', 'needed_before_acting', 'reassurance', 'not_needed_for_task', 'long_list', 'promotion', 'advertising',
  'reference_info', 'navigation', 'protected',
] as const satisfies readonly FitSection['why'][];
export const FIT_SHOW_FIRST = [0, 3, 4, 6, 8, 12] as const satisfies readonly FitSection['show_first'][];
export const FIT_DENSITIES = ['airy', 'comfortable'] as const satisfies readonly FitSpec['density'][];

// Compile-time exhaustiveness: every enum value in types.ts is listed above.
type Exhaustive<T extends never> = T;
type _Enums = [
  Exhaustive<Exclude<FitSpec['page_type'], (typeof FIT_PAGE_TYPES)[number]>>,
  Exhaustive<Exclude<FitSpec['task'], (typeof FIT_TASKS)[number]>>,
  Exhaustive<Exclude<SectionLabel, (typeof FIT_SECTION_LABELS)[number]>>,
  Exhaustive<Exclude<FitSection['role'], (typeof FIT_SECTION_ROLES)[number]>>,
  Exhaustive<Exclude<FitSection['layout'], (typeof FIT_SECTION_LAYOUTS)[number]>>,
  Exhaustive<Exclude<FitSection['emphasis'], (typeof FIT_EMPHASES)[number]>>,
  Exhaustive<Exclude<FitSection['state'], (typeof FIT_SECTION_STATES)[number]>>,
  Exhaustive<Exclude<FitSection['why'], (typeof FIT_WHYS)[number]>>,
  Exhaustive<Exclude<FitSection['show_first'], (typeof FIT_SHOW_FIRST)[number]>>,
  Exhaustive<Exclude<FitSpec['density'], (typeof FIT_DENSITIES)[number]>>,
];

export const FIT_NODE_ID_PATTERN = '^n[0-9]{1,4}$';
const FIT_NODE_ID_RE = /^n[0-9]{1,4}$/;

/* ------------------------------------------------------------------ */
/* zod                                                                 */
/* ------------------------------------------------------------------ */

const zId = z.string().regex(FIT_NODE_ID_RE);
const zSection = z.object({
  heading_ref: zId.nullable(),
  label: z.enum(FIT_SECTION_LABELS),
  role: z.enum(FIT_SECTION_ROLES),
  nodes: z.array(zId).min(1).max(40),
  layout: z.enum(FIT_SECTION_LAYOUTS),
  emphasis: z.enum(FIT_EMPHASES),
  state: z.enum(FIT_SECTION_STATES),
  why: z.enum(FIT_WHYS),
  show_first: z.union([z.literal(0), z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]),
});

/** FitSpec v1 as zod (same constraints as `fitSpecJsonSchema`). */
export const FitSpecSchema: z.ZodType<FitSpec> = z.object({
  page_type: z.enum(FIT_PAGE_TYPES),
  task: z.enum(FIT_TASKS),
  strip: z.array(zId).max(6),
  sections: z.array(zSection).min(1).max(12),
  primary_action: zId.nullable(),
  form_steps: z.array(z.object({ label: z.enum(FIT_SECTION_LABELS), fields: z.array(zId).min(1).max(8) })).max(8),
  density: z.enum(FIT_DENSITIES),
});

/* ------------------------------------------------------------------ */
/* OpenAI strict JSON schema (redesign-bench/fitspec.schema.json)      */
/* ------------------------------------------------------------------ */

const jId = { type: 'string', pattern: FIT_NODE_ID_PATTERN };
const jIdOrNull = { type: ['string', 'null'], pattern: FIT_NODE_ID_PATTERN };
const jEnum = (values: readonly string[]): Record<string, unknown> => ({ type: 'string', enum: [...values] });

/**
 * The strict Structured Outputs schema: every property is required and every object has
 * additionalProperties: false. Use as `text.format = { type: 'json_schema', name: 'fitspec', strict: true, schema }`.
 */
export const fitSpecJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['page_type', 'task', 'strip', 'sections', 'primary_action', 'form_steps', 'density'],
  properties: {
    page_type: jEnum(FIT_PAGE_TYPES),
    task: jEnum(FIT_TASKS),
    strip: {
      type: 'array',
      maxItems: 6,
      items: { ...jId },
      description: 'search, account, cart and help controls for the top bar',
    },
    sections: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      description: 'in display order, top to bottom',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading_ref', 'label', 'role', 'nodes', 'layout', 'emphasis', 'state', 'why', 'show_first'],
        properties: {
          heading_ref: { ...jIdOrNull },
          label: jEnum(FIT_SECTION_LABELS),
          role: jEnum(FIT_SECTION_ROLES),
          nodes: { type: 'array', minItems: 1, maxItems: 40, items: { ...jId } },
          layout: jEnum(FIT_SECTION_LAYOUTS),
          emphasis: jEnum(FIT_EMPHASES),
          state: jEnum(FIT_SECTION_STATES),
          why: jEnum(FIT_WHYS),
          show_first: { type: 'integer', enum: [...FIT_SHOW_FIRST] },
        },
      },
    },
    primary_action: { ...jIdOrNull },
    form_steps: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'fields'],
        properties: {
          label: jEnum(FIT_SECTION_LABELS),
          fields: { type: 'array', minItems: 1, maxItems: 8, items: { ...jId } },
        },
      },
    },
    density: jEnum(FIT_DENSITIES),
  },
};

/** Ready-made Responses API `text.format` for the layout model. */
export const fitSpecResponseFormat = { type: 'json_schema', name: 'fitspec', strict: true, schema: fitSpecJsonSchema } as const;

/* ------------------------------------------------------------------ */
/* Repair                                                              */
/* ------------------------------------------------------------------ */

export interface RepairOptions {
  /** The person's coarse fit: enables the open-section, list and form-step limits. */
  fit?: FitSummaryForModel | null;
  /** Jev roles by id (help and consent detection, primary-action fallback). */
  roles?: Record<string, Role>;
}

const MAX_NODES = 40;
const MAX_SECTIONS = 12;
const MAX_STRIP = 6;
const MAX_STEPS = 8;
const MAX_STEP_FIELDS = 8;
const CONTENT_EXEMPT: ReadonlySet<FitSection['role']> = new Set(['orient', 'alert', 'consent', 'help']);
const DRAWER_LABEL: SectionLabel = 'More on this page';

const pick = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

function newSection(p: Partial<FitSection> & Pick<FitSection, 'label' | 'role'>): FitSection {
  return {
    heading_ref: null,
    nodes: [],
    layout: 'as_is',
    emphasis: 'normal',
    state: 'open',
    why: 'protected',
    show_first: 0,
    ...p,
  };
}

class Repairer {
  readonly ix: OutlineIndex;
  readonly roles: Record<string, Role>;
  readonly limits: LayoutLimits | null;
  readonly repairs: string[] = [];
  strip: string[] = [];
  sections: FitSection[] = [];
  pa: string | null = null;
  steps: Array<{ label: SectionLabel; fields: string[] }> = [];
  pageType: FitSpec['page_type'] = 'other';
  task: FitSpec['task'] = 'other';
  density: FitSpec['density'] = 'comfortable';

  constructor(outline: PageOutline, opts: RepairOptions) {
    this.ix = indexOutline(outline);
    this.roles = opts.roles ?? {};
    this.limits = opts.fit ? layoutLimits(opts.fit) : null;
  }

  log(kind: string, detail: string): void { this.repairs.push(`${kind}: ${detail}`); }
  ord(id: string): number { return this.ix.order.get(id) ?? Number.MAX_SAFE_INTEGER; }
  known(id: unknown): id is string { return typeof id === 'string' && this.ix.nodes.has(id); }
  kind(id: string): OutlineKind | undefined { return this.ix.kind(id); }
  protection(id: string): Protection | null { return outlineProtection(this.ix, id, this.roles); }
  name(id: string): string {
    const n = this.ix.nodes.get(id);
    const l = (n?.label ?? '').replace(/[·\s]+/g, ' ').trim();
    return l ? `${id} "${l}"` : id;
  }

  /* ---- placement ---- */

  listedAt(id: string): 'strip' | FitSection | null {
    if (this.strip.includes(id)) return 'strip';
    return this.sections.find((s) => s.nodes.includes(id)) ?? null;
  }

  /** Where a node renders: itself if listed, else its nearest listed ancestor. */
  where(id: string): { at: 'strip' | FitSection; via: string } | null {
    for (const x of [id, ...this.ix.ancestors(id)]) {
      const at = this.listedAt(x);
      if (at) return { at, via: x };
    }
    return null;
  }

  isOpen(id: string): boolean {
    const w = this.where(id);
    return !!w && (w.at === 'strip' || w.at.state === 'open');
  }

  /** Ids a section renders: its listed nodes and their subtrees, minus descendants listed elsewhere. */
  renderIds(sec: FitSection): string[] {
    const out: string[] = [];
    const walk = (id: string): void => {
      out.push(id);
      for (const c of this.ix.children.get(id) ?? []) {
        const at = this.listedAt(c);
        if (at != null && at !== sec) continue;
        if (at === sec) continue; // listed in this section itself: walked from the list
        walk(c);
      }
    };
    sec.nodes.forEach(walk);
    return out;
  }

  holdsProtected(sec: FitSection): boolean {
    return this.renderIds(sec).some((id) => this.protection(id) != null);
  }

  unlist(id: string): void {
    this.strip = this.strip.filter((x) => x !== id);
    for (const s of this.sections) s.nodes = s.nodes.filter((x) => x !== id);
  }

  insertSorted(sec: FitSection, id: string): void {
    if (sec.nodes.includes(id)) return;
    const o = this.ord(id);
    const at = sec.nodes.findIndex((x) => this.ord(x) > o);
    if (at < 0) sec.nodes.push(id); else sec.nodes.splice(at, 0, id);
  }

  /**
   * Move a node to `target`. If it rendered through a listed ancestor, try to dissolve that ancestor into its
   * other children (containers only, within the 40-node cap) so nothing renders twice.
   */
  lift(id: string, target: 'strip' | FitSection): void {
    const before = this.where(id);
    this.unlist(id);
    if (target === 'strip') { if (!this.strip.includes(id)) this.strip.push(id); } else this.insertSorted(target, id);
    if (before && before.via !== id && before.at !== 'strip') this.dissolve(before.at, before.via, id);
  }

  dissolve(sec: FitSection, ancestor: string, keepOut: string): boolean {
    const chain = this.ix.ancestors(keepOut);
    const upto = chain.indexOf(ancestor);
    if (upto < 0) return false;
    const path = new Set(chain.slice(0, upto + 1));
    for (const p of path) if (!CONTAINER_KINDS.has(this.kind(p) as OutlineKind)) return false;
    const listedElsewhere = (c: string): boolean => this.listedAt(c) != null;
    const out: string[] = [];
    const walk = (n: string): void => {
      for (const c of this.ix.children.get(n) ?? []) {
        if (c === keepOut || listedElsewhere(c)) continue;
        if (path.has(c)) walk(c); else out.push(c);
      }
    };
    walk(ancestor);
    if (sec.nodes.length - 1 + out.length > MAX_NODES) return false;
    const at = sec.nodes.indexOf(ancestor);
    if (at < 0) return false;
    sec.nodes.splice(at, 1, ...out);
    return true;
  }

  primary(): FitSection | undefined { return this.sections.find((s) => s.role === 'primary'); }

  insertAfterPrimary(sec: FitSection): void {
    const p = this.primary();
    const at = p ? this.sections.indexOf(p) + 1 : this.sections.findIndex((s) => s.state !== 'open');
    if (at < 0 || at > this.sections.length) this.sections.push(sec); else this.sections.splice(at, 0, sec);
  }

  ensure(kind: 'help' | 'consent' | 'alert' | 'safety' | 'drawer' | 'links'): FitSection {
    const find = (f: (s: FitSection) => boolean): FitSection | undefined => this.sections.find(f);
    switch (kind) {
      case 'help': {
        const s = find((x) => x.role === 'help' && x.state === 'open');
        if (s) return s;
        const n = newSection({ label: 'Help', role: 'help', layout: 'row_list' });
        this.insertAfterPrimary(n);
        return n;
      }
      case 'consent': {
        const s = find((x) => x.role === 'consent' && x.state === 'open');
        if (s) return s;
        const n = newSection({ label: 'Cookies', role: 'consent', layout: 'as_is' });
        this.insertAfterPrimary(n);
        return n;
      }
      case 'alert': {
        const s = find((x) => x.role === 'alert' && x.state === 'open');
        if (s) return s;
        const n = newSection({ label: 'Notice', role: 'alert', layout: 'as_is' });
        this.sections.unshift(n);
        return n;
      }
      case 'safety': {
        const s = find((x) => x.label === 'Safety information' && x.state === 'open');
        if (s) return s;
        const n = newSection({ label: 'Safety information', role: 'supporting', layout: 'reading', why: 'needed_before_acting' });
        this.insertAfterPrimary(n);
        return n;
      }
      case 'links': {
        const s = find((x) => x.role === 'navigation' && x.state === 'open' && x.layout === 'chip_bar');
        if (s) return s;
        const n = newSection({ label: 'Navigation', role: 'navigation', layout: 'chip_bar', why: 'navigation' });
        this.insertAfterPrimary(n);
        return n;
      }
      case 'drawer':
      default: {
        const s = find((x) => x.label === DRAWER_LABEL && x.state === 'end_drawer');
        if (s) return s;
        const n = newSection({
          label: DRAWER_LABEL, role: 'other', layout: 'row_list', emphasis: 'quiet', state: 'end_drawer', why: 'not_needed_for_task',
        });
        this.sections.push(n);
        return n;
      }
    }
  }

  /** The open section a protected node belongs in when its current place is folded. */
  homeFor(id: string, p: Protection): 'strip' | FitSection {
    switch (p) {
      case 'help':
        if (ACTION_KINDS.has(this.kind(id) as OutlineKind) && this.strip.length < MAX_STRIP) return 'strip';
        return this.ensure('help');
      case 'consent': return this.ensure('consent');
      case 'alert': return this.ensure('alert');
      case 'safety': return this.ensure('safety');
      case 'field':
      case 'protected':
      default: return this.primary() ?? this.ensure('alert');
    }
  }

  /* ---- steps ---- */

  load(spec: FitSpec): void {
    const raw = spec as Partial<FitSpec>;
    this.pageType = pick(raw.page_type, FIT_PAGE_TYPES, 'other');
    this.task = pick(raw.task, FIT_TASKS, 'other');
    this.density = pick(raw.density, FIT_DENSITIES, 'comfortable');
    this.pa = typeof raw.primary_action === 'string' ? raw.primary_action : null;
    this.strip = Array.isArray(raw.strip) ? raw.strip.filter((x): x is string => typeof x === 'string') : [];
    this.sections = (Array.isArray(raw.sections) ? raw.sections : []).map((s) => {
      const x = (s ?? {}) as Partial<FitSection>;
      return {
        heading_ref: typeof x.heading_ref === 'string' ? x.heading_ref : null,
        label: pick(x.label, FIT_SECTION_LABELS, 'Other'),
        role: pick(x.role, FIT_SECTION_ROLES, 'other'),
        nodes: Array.isArray(x.nodes) ? x.nodes.filter((n): n is string => typeof n === 'string') : [],
        layout: pick(x.layout, FIT_SECTION_LAYOUTS, 'as_is'),
        emphasis: pick(x.emphasis, FIT_EMPHASES, 'normal'),
        state: pick(x.state, FIT_SECTION_STATES, 'open'),
        why: pick(x.why, FIT_WHYS, 'main_task'),
        show_first: pick(x.show_first, FIT_SHOW_FIRST, 0),
      };
    });
    this.steps = (Array.isArray(raw.form_steps) ? raw.form_steps : []).map((st) => ({
      label: pick(st?.label, FIT_SECTION_LABELS, 'Other'),
      fields: Array.isArray(st?.fields) ? st.fields.filter((f): f is string => typeof f === 'string') : [],
    }));
  }

  cleanIds(): void {
    const seen = new Set<string>();
    const keep = (id: string, where: string): boolean => {
      if (!this.known(id)) { this.log('unknown_id', `dropped ${id} from ${where}`); return false; }
      if (seen.has(id)) { this.log('duplicate_id', `kept the first ${id}, dropped the copy in ${where}`); return false; }
      seen.add(id);
      return true;
    };
    this.strip = this.strip.filter((id) => keep(id, 'the top bar'));
    for (const s of this.sections) s.nodes = s.nodes.filter((id) => keep(id, s.label));
    // The strip holds controls only; anything else moves into a section.
    for (const id of [...this.strip]) {
      if (CONTROL_KINDS.has(this.kind(id) as OutlineKind)) continue;
      this.strip = this.strip.filter((x) => x !== id);
      const p = this.protection(id);
      const target = p === 'help' ? this.ensure('help') : p === 'consent' ? this.ensure('consent') : this.ensure('links');
      this.insertSorted(target, id);
      this.log('strip_not_control', `moved ${this.name(id)} out of the top bar`);
    }
    for (const s of this.sections) {
      if (s.heading_ref != null && (!this.known(s.heading_ref) || this.kind(s.heading_ref) !== 'heading')) {
        this.log('heading_ref', `${s.label}: ${s.heading_ref} is not a heading on this page`);
        s.heading_ref = null;
      }
    }
    if (this.pa != null && !this.known(this.pa)) {
      this.log('unknown_id', `primary action ${this.pa} is not on this page`);
      this.pa = null;
    }
    this.steps = this.steps.map((st) => ({ ...st, fields: st.fields.filter((f) => this.known(f)) }));
  }

  /** Ancestor and descendant both listed: keep the ancestor, unless the descendant was lifted on purpose. */
  resolveOverlaps(): void {
    const listed = [...this.strip, ...this.sections.flatMap((s) => s.nodes)];
    const set = new Set(listed);
    for (const id of listed) {
      const anc = this.ix.ancestors(id).find((a) => set.has(a));
      if (!anc) continue;
      const p = this.protection(id);
      const deliberate = this.strip.includes(id) || id === this.pa || p === 'help' || p === 'consent' || p === 'alert';
      const ancAt = this.listedAt(anc);
      const idAt = this.listedAt(id);
      if (deliberate && ancAt !== idAt) {
        if (ancAt && ancAt !== 'strip') this.dissolve(ancAt, anc, id);
        continue;
      }
      this.unlist(id);
      set.delete(id);
      this.log('overlap', `dropped ${id}: it is already inside ${anc}`);
    }
  }

  fixPrimaryAction(): void {
    if (this.pa != null && !ACTION_KINDS.has(this.kind(this.pa) as OutlineKind)) {
      this.log('primary_action', `${this.name(this.pa)} is not a button or link`);
      this.pa = null;
    }
    if (this.pa == null && !['article', 'feed', 'video', 'docs', 'inbox'].includes(this.pageType)) {
      const fallback = pickPrimaryAction(this.ix, this.roles, { minScore: 4 });
      if (fallback) {
        this.pa = fallback;
        this.log('primary_action', `set to ${this.name(fallback)}`);
      }
    }
  }

  cover(): void {
    const covered = coveredIds({ strip: this.strip, sections: this.sections }, this.ix);
    const added: string[] = [];
    const place = (id: string): void => {
      if (covered.has(id)) return;
      const kids = this.ix.children.get(id) ?? [];
      const partly = kids.some((c) => covered.has(c) || this.ix.descendants(c).some((d) => covered.has(d)));
      if (CONTAINER_KINDS.has(this.kind(id) as OutlineKind) && kids.length && partly) {
        kids.forEach(place);
        return;
      }
      const p = this.protection(id);
      const target = p && p !== 'field' && p !== 'protected' ? this.homeFor(id, p) : this.ensure('drawer');
      if (target === 'strip') this.strip.push(id); else this.insertSorted(target, id);
      covered.add(id);
      for (const d of this.ix.descendants(id)) covered.add(d);
      added.push(id);
    };
    for (const r of this.ix.roots) place(r);
    if (added.length) this.log('coverage', `placed ${added.length} missing part${added.length === 1 ? '' : 's'} (${added.slice(0, 6).join(', ')}${added.length > 6 ? ', …' : ''})`);
  }

  protect(): void {
    for (const id of this.ix.nodes.keys()) {
      const p = this.protection(id);
      if (!p || this.isOpen(id)) continue;
      const w = this.where(id);
      if (!w) {
        // A protected container placed only through its children: list it in view and pull back the
        // children that were folded (children listed in open places keep rendering there).
        const folded = this.ix.descendants(id).filter((d) => {
          const at = this.listedAt(d);
          return at != null && at !== 'strip' && at.state !== 'open';
        });
        if (!folded.length) continue;
        let home = this.homeFor(id, p);
        if (home === 'strip' && !CONTROL_KINDS.has(this.kind(id) as OutlineKind)) home = this.ensure('help');
        for (const d of folded) this.unlist(d);
        if (home === 'strip') this.strip.push(id); else this.insertSorted(home, id);
        this.log('protected_open', `kept ${this.name(id)} in view (${home === 'strip' ? 'top bar' : home.label})`);
        continue;
      }
      if (w.at === 'strip') continue;
      const sec = w.at;
      const allProtected = sec.nodes.every((n) => {
        const q = this.protection(n);
        return q === p || q === 'field' || q === 'protected';
      });
      if (sec.state === 'collapsed' && (p === 'field' || p === 'safety' || p === 'protected' || allProtected)) {
        sec.state = 'open';
        sec.why = 'protected';
        this.log('protected_open', `opened ${sec.label}: it holds ${this.name(id)}`);
        continue;
      }
      if (allProtected && (p === 'consent' || p === 'alert' || p === 'help')) {
        sec.state = 'open';
        sec.why = 'protected';
        this.log('protected_open', `opened ${sec.label}: it holds ${this.name(id)}`);
        continue;
      }
      const home = this.homeFor(id, p);
      this.lift(id, home);
      this.log(p === 'help' ? 'help_lifted' : 'protected_open', `kept ${this.name(id)} in view (${home === 'strip' ? 'top bar' : home.label})`);
    }
  }

  fixPrimarySection(): void {
    if (this.pa != null && this.strip.includes(this.pa)) {
      this.strip = this.strip.filter((x) => x !== this.pa);
      this.log('primary_action', 'moved the primary action out of the top bar');
    }
    let primaries = this.sections.filter((s) => s.role === 'primary');
    if (this.pa != null) {
      const w = this.where(this.pa);
      const holder = w && w.at !== 'strip' ? w.at : null;
      let prim = holder && holder.role === 'primary' ? holder : primaries[0];
      if (!prim) {
        if (holder && holder.state === 'open' && holder.label !== DRAWER_LABEL && !CONTENT_EXEMPT.has(holder.role)) {
          holder.role = 'primary';
          prim = holder;
          this.log('primary_section', `${holder.label} is the main task section`);
        } else {
          prim = newSection({ label: 'Overview', role: 'primary', layout: 'as_is', emphasis: 'lead', why: 'main_task' });
          const firstContent = this.sections.findIndex((s) => s.state === 'open' && !CONTENT_EXEMPT.has(s.role) && s.role !== 'orient');
          this.sections.splice(firstContent < 0 ? 0 : firstContent, 0, prim);
          this.log('primary_section', 'added a main task section for the primary action');
        }
      }
      if (!holder || holder !== prim) {
        this.lift(this.pa, prim);
        this.log('primary_section', `moved ${this.name(this.pa)} into ${prim.label}`);
      }
      primaries = this.sections.filter((s) => s.role === 'primary');
      for (const s of primaries) if (s !== prim) { s.role = 'supporting'; this.log('primary_section', `demoted a second main section (${s.label})`); }
    } else if (!primaries.length) {
      const cand = this.sections.find((s) => s.state === 'open' && !CONTENT_EXEMPT.has(s.role) && !['navigation', 'ads', 'promo', 'legal', 'related'].includes(s.role))
        ?? this.sections.find((s) => s.state === 'open') ?? this.sections[0];
      if (cand) { cand.role = 'primary'; this.log('primary_section', `${cand.label} is the main task section`); }
    } else {
      for (const s of primaries.slice(1)) { s.role = 'supporting'; this.log('primary_section', `demoted a second main section (${s.label})`); }
    }
    const prim = this.primary();
    if (prim) {
      if (prim.state !== 'open') { prim.state = 'open'; this.log('primary_section', 'opened the main task section'); }
      prim.why = 'main_task';
    }
  }

  foldAds(): void {
    for (const s of this.sections) {
      if (s.role !== 'ads' || s.state === 'end_drawer') continue;
      s.state = 'end_drawer';
      s.why = 'advertising';
      s.emphasis = 'quiet';
      this.log('ads_folded', `moved ${s.label} to the end`);
    }
  }

  /**
   * Ads and upsells inside an open part of the page go to the end. A model often lists the page's whole main
   * region, so the flu-shot upsell and the membership banner inside the form would stay open with the task. Each
   * such part moves to a folded section of its own kind, and the region it sat in dissolves into its other
   * children. Only whole containers or buttons with Jev's advertising or recommendations role move; never a
   * protected part, the primary action or anything holding it, a field, or a link inside running text.
   */
  liftAds(): void {
    const adRole = (id: string): 'advertising' | 'recommendations' | null => {
      const r = this.roles[id] ?? this.ix.nodes.get(id)?.jevRole;
      return r === 'advertising' || r === 'recommendations' ? r : null;
    };
    const kindOk = (id: string): boolean => {
      const k = this.kind(id) as OutlineKind;
      return CONTAINER_KINDS.has(k) || k === 'button' || k === 'media';
    };
    const movable = (id: string): boolean => {
      if (!adRole(id) || !kindOk(id) || id === this.pa) return false;
      const sub = [id, ...this.ix.descendants(id)];
      if (this.pa != null && sub.includes(this.pa)) return false;
      return !sub.some((d) => this.protection(d) != null);
    };
    const HOME_ROLES: ReadonlySet<FitSection['role']> = new Set(['ads', 'promo', 'related']);
    const homeFor = (r: 'advertising' | 'recommendations'): FitSection => {
      const role: FitSection['role'] = r === 'advertising' ? 'ads' : 'related';
      const have = this.sections.find((x) => x.role === role && x.state !== 'open');
      if (have) return have;
      const n = newSection({
        label: r === 'advertising' ? 'Offers' : 'Related items', role, layout: 'row_list', emphasis: 'quiet',
        state: r === 'advertising' ? 'end_drawer' : 'collapsed', why: r === 'advertising' ? 'advertising' : 'promotion',
      });
      const drawer = this.sections.findIndex((x) => x.label === DRAWER_LABEL);
      if (drawer < 0) this.sections.push(n); else this.sections.splice(drawer, 0, n);
      return n;
    };
    for (const sec of [...this.sections]) {
      if (sec.state !== 'open' || HOME_ROLES.has(sec.role) || CONTENT_EXEMPT.has(sec.role)) continue;
      const moved: string[] = [];
      for (const listed of [...sec.nodes]) {
        if (!sec.nodes.includes(listed)) continue;
        // The outermost ad parts under (or at) this listed node, in page order.
        const picks: string[] = [];
        for (const d of [listed, ...this.ix.descendants(listed)]) {
          if (picks.some((p) => p === d || this.ix.isAncestor(p, d))) continue;
          const at = this.listedAt(d);
          if (d !== listed && at != null && at !== sec) continue; // already placed elsewhere
          if (movable(d)) picks.push(d);
        }
        for (const id of picks) {
          if (id === listed && sec.nodes.length === 1) {
            if (sec.role === 'primary') continue;
            // The whole section is the ad: fold the section itself instead of emptying it.
            const r = adRole(id);
            sec.state = r === 'advertising' ? 'end_drawer' : 'collapsed';
            sec.role = r === 'advertising' ? 'ads' : 'related';
            sec.emphasis = 'quiet';
            sec.why = r === 'advertising' ? 'advertising' : 'promotion';
            moved.push(id);
            continue;
          }
          this.lift(id, homeFor(adRole(id) as 'advertising' | 'recommendations'));
          moved.push(id);
        }
        if (sec.state !== 'open') break;
      }
      if (moved.length) this.log('ads_lifted', `moved ${moved.map((id) => this.name(id)).slice(0, 4).join(', ')}${moved.length > 4 ? ', …' : ''} out of ${sec.label} to the end`);
    }
  }

  clampToFit(): void {
    const lim = this.limits;
    if (!lim) return;
    const content = (): FitSection[] => this.sections.filter((s) => s.state === 'open' && !CONTENT_EXEMPT.has(s.role));
    const ORDER: FitSection['role'][] = ['ads', 'promo', 'related', 'social_proof', 'reference', 'other', 'navigation', 'legal', 'supporting'];
    const keepOpen = (s: FitSection): boolean =>
      s.role === 'primary' || s.why === 'needed_before_acting' || s.why === 'protected' ||
      this.renderIds(s).some((n) => { const p = this.protection(n); return p === 'field' || p === 'safety' || p === 'protected'; });
    let open = content();
    if (open.length > lim.openSectionsMax) {
      const cands = open.filter((s) => !keepOpen(s)).sort((a, b) => {
        const ra = ORDER.indexOf(a.role);
        const rb = ORDER.indexOf(b.role);
        if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
        return this.sections.indexOf(b) - this.sections.indexOf(a); // later first
      });
      for (const s of cands) {
        if (open.length <= lim.openSectionsMax) break;
        s.state = s.role === 'ads' ? 'end_drawer' : 'collapsed';
        s.emphasis = 'quiet';
        this.log('open_limit', `folded ${s.label} (at most ${lim.openSectionsMax} open sections)`);
        open = content();
      }
    }
    if (lim.listFirst > 0) {
      for (const s of this.sections) {
        if (!['card_grid', 'row_list', 'gallery', 'link_grid'].includes(s.layout) || CONTENT_EXEMPT.has(s.role)) continue;
        if (s.show_first === 0 || s.show_first > lim.listFirst) {
          const v = snapShowFirst(lim.listFirst);
          if (s.show_first !== v) { s.show_first = v; this.log('show_first', `${s.label} shows ${v} first`); }
        }
      }
    }
  }

  fixFormSteps(): void {
    const maxFields = Math.min(MAX_STEP_FIELDS, this.limits?.formStepMaxFields ?? MAX_STEP_FIELDS);
    const prim = this.primary();
    const hosts = this.sections.filter((s) => s.layout === 'form_steps');
    const hostList = hosts.length ? hosts : prim ? [prim] : [];
    const fieldsOf = (sec: FitSection): string[] => this.renderIds(sec).filter((id) => FIELD_KINDS.has(this.kind(id) as OutlineKind));
    const main = [...new Set(hostList.flatMap(fieldsOf))].sort((a, b) => this.ord(a) - this.ord(b));
    const mainSet = new Set(main);

    let steps = this.steps.map((st) => ({ label: st.label, fields: st.fields.filter((f) => FIELD_KINDS.has(this.kind(f) as OutlineKind)) }));
    const before = JSON.stringify(steps);
    if (steps.length) {
      // Only fields of the main form, each once.
      const seen = new Set<string>();
      const firstUse = (f: string): boolean => {
        if (!mainSet.has(f) || seen.has(f)) return false;
        seen.add(f);
        return true;
      };
      steps = steps.map((st) => ({ ...st, fields: st.fields.filter(firstUse) })).filter((st) => st.fields.length);
      // Append missing fields to the step whose range holds them.
      for (const f of main) {
        if (seen.has(f)) continue;
        const o = this.ord(f);
        let best = steps[steps.length - 1];
        let bestDist = Infinity;
        for (const st of steps) {
          const lo = Math.min(...st.fields.map((x) => this.ord(x)));
          const hi = Math.max(...st.fields.map((x) => this.ord(x)));
          const d = o >= lo && o <= hi ? 0 : Math.min(Math.abs(o - lo), Math.abs(o - hi));
          if (d < bestDist) { bestDist = d; best = st; }
        }
        if (best) best.fields.push(f); else steps.push({ label: labelFromWords(this.ix.label(f), 'Your details'), fields: [f] });
        seen.add(f);
      }
    } else if (hosts.length && main.length) {
      steps = [{ label: labelFromWords(main.map((f) => this.ix.label(f)).join(' '), 'Your details'), fields: [...main] }];
    }

    if (steps.length) {
      // Restore field order, consent and terms last, split long steps, at most 8 steps.
      for (const st of steps) st.fields.sort((a, b) => this.ord(a) - this.ord(b));
      steps.sort((a, b) => this.ord(a.fields[0] as string) - this.ord(b.fields[0] as string));
      const consent = steps.flatMap((st) => st.fields.filter((f) => RE.consentField.test(this.ix.label(f))));
      if (consent.length && steps.length > 1) {
        for (const st of steps) st.fields = st.fields.filter((f) => !consent.includes(f));
        steps = steps.filter((st) => st.fields.length);
        const last = steps[steps.length - 1];
        if (last && last.fields.length + consent.length <= maxFields) last.fields.push(...consent);
        else steps.push({ label: 'Review and submit', fields: consent });
      }
      const split: typeof steps = [];
      for (const st of steps) {
        for (let i = 0; i < st.fields.length; i += maxFields) split.push({ label: st.label, fields: st.fields.slice(i, i + maxFields) });
      }
      steps = split;
      if (steps.length > MAX_STEPS) {
        const all = steps.flatMap((st) => st.fields);
        const per = Math.ceil(all.length / MAX_STEPS);
        if (per > MAX_STEP_FIELDS) steps = [];
        else {
          const re: typeof steps = [];
          for (let i = 0; i < all.length; i += per) {
            const fields = all.slice(i, i + per);
            re.push({ label: labelFromWords(fields.map((f) => this.ix.label(f)).join(' '), 'Your details'), fields });
          }
          steps = re;
        }
      }
    }
    if (JSON.stringify(steps) !== before) this.log('form_steps', `${steps.length} step${steps.length === 1 ? '' : 's'}, ${steps.reduce((a, s) => a + s.fields.length, 0)} fields in page order`);
    this.steps = steps;

    if (!steps.length) {
      for (const s of hosts) { s.layout = 'as_is'; this.log('form_steps', `${s.label} is drawn as the site does (no steps)`); }
    } else if (!hosts.length && prim && this.pageType !== 'product_detail' && fieldsOf(prim).length) {
      prim.layout = 'form_steps';
    }
  }

  fixEmphasis(): void {
    let lead = false;
    for (const s of this.sections) {
      if (s.emphasis !== 'lead') continue;
      if (lead) { s.emphasis = 'normal'; this.log('lead', `demoted a second lead (${s.label})`); }
      lead = true;
    }
    const prim = this.primary();
    if (!lead && prim) prim.emphasis = 'lead';
    for (const s of this.sections) {
      if (s.layout === 'buy_box' && this.pageType !== 'product_detail') {
        s.layout = 'as_is';
        this.log('buy_box', `${s.label}: a buy box is for product pages only`);
      }
      if ((s.role === 'consent' || s.role === 'alert') && s.state === 'open' && s.layout !== 'as_is') s.layout = 'as_is';
    }
  }

  capStrip(): void {
    if (this.strip.length <= MAX_STRIP) return;
    const keep: string[] = [];
    const rest: string[] = [];
    // Help first, then search / account / cart, then the rest in order.
    const ranked = [...this.strip].sort((a, b) => {
      const ra = this.protection(a) === 'help' ? 0 : isUtility(this.ix, a, this.roles) ? 1 : 2;
      const rb = this.protection(b) === 'help' ? 0 : isUtility(this.ix, b, this.roles) ? 1 : 2;
      return ra - rb;
    });
    for (const id of ranked) (keep.length < MAX_STRIP ? keep : rest).push(id);
    this.strip = this.strip.filter((id) => keep.includes(id));
    for (const id of rest) {
      const target = this.protection(id) === 'help' ? this.ensure('help') : this.ensure('links');
      this.insertSorted(target, id);
    }
    this.log('strip_full', `moved ${rest.length} control${rest.length === 1 ? '' : 's'} from the top bar into the page`);
  }

  fixHeadingRefs(): void {
    const used = new Set<string>();
    for (const s of this.sections) {
      const h = s.heading_ref;
      if (h == null) continue;
      const w = this.where(h);
      if (!w || w.at !== s || used.has(h)) {
        s.heading_ref = null;
        this.log('heading_ref', `${s.label}: its heading is not inside it`);
        continue;
      }
      used.add(h);
    }
  }

  finalizeSections(): void {
    const empty = this.sections.filter((s) => !s.nodes.length);
    if (empty.length) {
      this.sections = this.sections.filter((s) => s.nodes.length);
      this.log('empty_section', `removed ${empty.length} empty section${empty.length === 1 ? '' : 's'}`);
    }
    // Split sections over 40 nodes while there is room.
    for (let i = 0; i < this.sections.length && this.sections.length < MAX_SECTIONS; i++) {
      const s = this.sections[i] as FitSection;
      if (s.nodes.length <= MAX_NODES) continue;
      let rest = s.nodes.slice(MAX_NODES);
      s.nodes = s.nodes.slice(0, MAX_NODES);
      const pa = this.pa;
      if (s.role === 'primary' && pa != null && !s.nodes.includes(pa)) {
        const holder = [pa, ...this.ix.ancestors(pa)].find((x) => rest.includes(x));
        if (holder) {
          const out = s.nodes.pop() as string;
          s.nodes.push(holder);
          rest = [out, ...rest.filter((x) => x !== holder)];
        }
      }
      this.sections.splice(i + 1, 0, { ...s, heading_ref: null, emphasis: s.emphasis === 'lead' ? 'normal' : s.emphasis, role: s.role === 'primary' ? 'supporting' : s.role, nodes: rest });
      this.log('section_split', `${s.label} split to keep 40 parts per section`);
    }
    // Too many sections: fold the least important closed ones into the end drawer.
    if (this.sections.length > MAX_SECTIONS) {
      const drawer = this.ensure('drawer');
      const RANK: Record<FitSection['state'], number> = { end_drawer: 0, collapsed: 1, open: 2 };
      const movable = this.sections
        .filter((s) => s !== drawer && s.role !== 'primary' && !this.holdsProtected(s))
        .sort((a, b) => RANK[a.state] - RANK[b.state] || this.sections.indexOf(b) - this.sections.indexOf(a));
      for (const s of movable) {
        if (this.sections.length <= MAX_SECTIONS) break;
        for (const n of s.nodes) this.insertSorted(drawer, n);
        this.sections = this.sections.filter((x) => x !== s);
        this.log('too_many_sections', `merged ${s.label} into ${DRAWER_LABEL}`);
      }
    }
    for (const s of this.sections) if (!FIT_SHOW_FIRST.includes(s.show_first)) s.show_first = 0;
  }

  result(): FitSpec {
    return {
      page_type: this.pageType,
      task: this.task,
      strip: [...this.strip],
      sections: this.sections.map((s) => ({ ...s, nodes: [...s.nodes] })),
      primary_action: this.pa,
      form_steps: this.steps.map((st) => ({ label: st.label, fields: [...st.fields] })),
      density: this.density,
    };
  }
}

/**
 * Validate and repair a FitSpec against the page outline (deterministic; logs one line per repair kind):
 * 1. unknown and duplicate ids dropped, non-controls moved out of the strip, ancestor/descendant overlap
 *    resolved toward the ancestor (unless the descendant is the primary action or was lifted on purpose);
 * 2. a primary action that is not a button or link is replaced (or set when the page clearly has one);
 * 3. every outline node placed (missing parts go to an end drawer "More on this page");
 * 4. protected nodes (help, consent, alerts, required/filled fields, safety text) forced open, or lifted
 *    into the top bar / an open Help, Cookies, Notice or Safety section;
 * 5. exactly one primary section, open, holding the primary action;
 * 6. ads to the end drawer, including ads and upsells listed inside an open part (their region dissolves into its
 *    other children); with `opts.fit`: open-section, list and form-step limits;
 * 7. form steps in page order, consent last, ≤ 8 fields per step; one lead; buy_box only on product pages;
 *    ≤ 6 strip items, ≤ 12 sections, ≤ 40 nodes per section where the outline allows.
 */
export function repairSpec(spec: FitSpec, outline: PageOutline, opts: RepairOptions = {}): { spec: FitSpec; repairs: string[] } {
  const r = new Repairer(outline, opts);
  r.load(spec);
  r.cleanIds();
  r.resolveOverlaps();
  r.fixPrimaryAction();
  r.cover();
  r.fixPrimarySection();
  r.foldAds();
  r.liftAds();
  r.clampToFit();
  r.protect();
  r.fixFormSteps();
  r.fixEmphasis();
  r.capStrip();
  r.fixHeadingRefs();
  r.finalizeSections();
  // Coverage once more: merges and splits never drop nodes, but lifts may have emptied a section.
  r.cover();
  r.finalizeSections();
  return { spec: r.result(), repairs: r.repairs };
}
