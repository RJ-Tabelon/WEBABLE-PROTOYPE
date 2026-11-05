// Owner: round 2 server package (S).
// Three deterministic layout candidates made without a generative model, for Jev to judge exactly as it judges
// the model's candidates (alone when no model is available, or alongside them). Each one starts from the instant
// heuristic layout's grouping of the page and re-arranges it with a different design stance:
//   focus    - only the main task (and what it needs) open; everything else folded with counts; short lists;
//              the form packed into as few steps as the fit allows; folded navigation moves to the end.
//   guided   - the task in reading order: the title block on its own, one group of fields per step, the page's
//              own small print and one reassurance section open beside the task, the rest folded in page order.
//   overview - more of the page open, in the page's own order, on one page (stepped only when the fit says one thing
//              at a time works best); navigation open; longer lists.
// Every candidate goes through repairSpec, so the same guarantees hold as for any other spec (every node placed;
// help, consent, alerts, required fields and safety text open; one primary section holding the primary action).
import type { FitSection, FitSpec, FitSummaryForModel, LayoutCandidate, OutlineKind, PageOutline, Role, SectionLabel } from '../types';
import { heuristicSpec } from './heuristic';
import {
  FIELD_KINDS, RE, indexOutline, labelFromWords, layoutLimits, lower, outlineProtection, snapShowFirst,
  type LayoutLimits, type OutlineIndex,
} from './outline';
import { repairSpec } from './spec';

export type LocalVariantName = 'focus' | 'guided' | 'overview';
export const LOCAL_VARIANTS: readonly LocalVariantName[] = ['focus', 'guided', 'overview'];

/** Where a layout candidate came from. Encoded as the first `repairs` line ("source: local (…)"). */
export type CandidateSource = 'heuristic' | 'local' | 'ai';

export const SOURCE_PREFIX = 'source: ';

/** One-line description of each local stance (shown after the source tag). */
export const LOCAL_VARIANT_NOTES: Readonly<Record<LocalVariantName, string>> = Object.freeze({
  focus: 'only the main task open, the rest folded with counts, short lists',
  guided: 'the task in order, one group of fields per step, reassurance beside it',
  overview: 'more of the page open in its own order, longer lists',
});

/** The `repairs` line that names a candidate's source, e.g. "source: ai (gpt-6-sol)". */
export function sourceTag(source: CandidateSource, detail?: string): string {
  return `${SOURCE_PREFIX}${source}${detail ? ` (${detail})` : ''}`;
}

/** Read a candidate's source from its tag; an untagged candidate is the heuristic (by name) or a model's. */
export function candidateSource(c: Pick<LayoutCandidate, 'name' | 'repairs'>): CandidateSource {
  const tag = c.repairs.find((r) => r.startsWith(SOURCE_PREFIX));
  if (tag) {
    const word = tag.slice(SOURCE_PREFIX.length).split(/[\s(]/)[0];
    if (word === 'local' || word === 'ai' || word === 'heuristic') return word;
  }
  return c.name === 'heuristic' ? 'heuristic' : 'ai';
}

/* ------------------------------------------------------------------ */
/* Context and helpers                                                 */
/* ------------------------------------------------------------------ */

interface Ctx {
  roles: Record<string, Role>;
  fit: FitSummaryForModel;
  ix: OutlineIndex;
  base: FitSpec;
  limits: LayoutLimits;
}

type Steps = FitSpec['form_steps'];
type ShowFirst = FitSection['show_first'];

const LIST_LAYOUTS: ReadonlySet<FitSection['layout']> = new Set<FitSection['layout']>(['card_grid', 'row_list', 'gallery', 'link_grid']);
const EXEMPT_ROLES: ReadonlySet<FitSection['role']> = new Set<FitSection['role']>(['orient', 'alert', 'consent', 'help']);
const NO_SPLIT_PAGES: ReadonlySet<FitSpec['page_type']> = new Set<FitSpec['page_type']>(['product_detail', 'article', 'video', 'docs', 'feed']);
const NO_STEP_PAGES: ReadonlySet<FitSpec['page_type']> = new Set<FitSpec['page_type']>([
  'product_detail', 'article', 'video', 'docs', 'feed', 'search_results', 'listing',
]);
const TITLE_KINDS: ReadonlySet<OutlineKind> = new Set<OutlineKind>(['heading', 'text', 'image', 'media']);
const EXTRA_KINDS: ReadonlySet<OutlineKind> = new Set<OutlineKind>(['heading', 'text', 'link', 'button', 'list', 'table', 'image', 'media', 'region']);
const NEWSLETTER = /\b(newsletter|subscribe|e-?mail updates|sign up for)\b/;
const MAX_STEP_FIELDS = 8;
const MAX_STEPS = 8;

const copy = (s: FitSection): FitSection => ({ ...s, nodes: [...s.nodes] });
const subtree = (ix: OutlineIndex, id: string): string[] => [id, ...ix.descendants(id)];
const hasField = (ix: OutlineIndex, id: string): boolean => subtree(ix, id).some((d) => FIELD_KINDS.has(ix.kind(d) as OutlineKind));
const holds = (ix: OutlineIndex, id: string, target: string | null): boolean => target != null && (id === target || ix.isAncestor(id, target));
const protectedDeep = (c: Ctx, id: string): boolean => subtree(c.ix, id).some((d) => outlineProtection(c.ix, d, c.roles) != null);
const isList = (s: FitSection): boolean => LIST_LAYOUTS.has(s.layout);

function section(p: Partial<FitSection> & Pick<FitSection, 'label' | 'role' | 'nodes'>): FitSection {
  return { heading_ref: null, layout: 'as_is', emphasis: 'normal', state: 'open', why: 'main_task', show_first: 0, ...p };
}

/** Open for a reason no stance overrides: protected, needed before acting, or safety text. */
function lockedOpen(s: FitSection): boolean {
  return s.state === 'open' && (s.why === 'protected' || s.why === 'needed_before_acting' || s.label === 'Safety information');
}

/** Where a section starts on the page (its earliest node). */
function pageAt(c: Ctx, s: FitSection): number {
  let at = Number.MAX_SAFE_INTEGER;
  for (const id of s.nodes) at = Math.min(at, c.ix.order.get(id) ?? Number.MAX_SAFE_INTEGER);
  return at;
}

function fold(s: FitSection): FitSection {
  if (lockedOpen(s)) return s;
  return { ...s, state: 'collapsed', emphasis: 'quiet', why: isList(s) ? 'long_list' : s.why === 'main_task' ? 'reference_info' : s.why };
}

function setLists(sections: FitSection[], n: ShowFirst): void {
  for (const s of sections) if (isList(s) && !EXEMPT_ROLES.has(s.role)) s.show_first = n;
}

/* ------------------------------------------------------------------ */
/* The heuristic's sections, sorted into slots                          */
/* ------------------------------------------------------------------ */

interface Parts {
  alerts: FitSection[];
  orient: FitSection[];
  primary: FitSection | null;
  content: FitSection[]; // supporting, reference, social proof: page order
  help: FitSection[];
  consent: FitSection[];
  nav: FitSection[]; // navigation that is not in the end drawer
  misc: FitSection[]; // other / legal that is not in the end drawer
  drawer: FitSection[]; // end drawer, ads, promotions, related
}

function parts(c: Ctx): Parts {
  const p: Parts = { alerts: [], orient: [], primary: null, content: [], help: [], consent: [], nav: [], misc: [], drawer: [] };
  for (const s0 of c.base.sections) {
    const s = copy(s0);
    if (s.role === 'alert') p.alerts.push(s);
    else if (s.role === 'primary' && !p.primary) p.primary = s;
    else if (s.role === 'primary') p.content.push({ ...s, role: 'supporting' });
    else if (s.role === 'orient') p.orient.push(s);
    else if (s.role === 'help') p.help.push(s);
    else if (s.role === 'consent') p.consent.push(s);
    else if (s.state === 'end_drawer' || s.role === 'ads' || s.role === 'promo' || s.role === 'related') p.drawer.push(s);
    else if (s.role === 'navigation') p.nav.push(s);
    else if (s.role === 'supporting' || s.role === 'reference' || s.role === 'social_proof') p.content.push(s);
    else p.misc.push(s);
  }
  p.content.sort((a, b) => pageAt(c, a) - pageAt(c, b));
  return p;
}

/* ------------------------------------------------------------------ */
/* The primary section: title block, task, and the page's small print  */
/* ------------------------------------------------------------------ */

interface Split {
  title: string[];
  task: string[];
  extra: string[];
}

function splitPrimary(c: Ctx, prim: FitSection | null): Split {
  if (!prim) return { title: [], task: [], extra: [] };
  const nodes = prim.nodes;
  const pa = c.base.primary_action;
  const whole: Split = { title: [], task: [...nodes], extra: [] };
  if (NO_SPLIT_PAGES.has(c.base.page_type)) return whole;
  const first = nodes.findIndex((id) => hasField(c.ix, id) || holds(c.ix, id, pa));
  if (first < 0) return whole;

  // Title block: the longest run of headings, text and pictures before the task, with a heading in it.
  const title: string[] = [];
  for (const id of nodes.slice(0, first)) {
    const k = c.ix.kind(id);
    if (!k || !TITLE_KINDS.has(k) || protectedDeep(c, id)) break;
    title.push(id);
  }
  if (!title.some((id) => c.ix.kind(id) === 'heading')) title.length = 0;

  // Small print and side actions once the task starts: no fields, not the primary action, nothing protected.
  const movable = (id: string): boolean => {
    const n = c.ix.nodes.get(id);
    if (!n || !EXTRA_KINDS.has(n.kind)) return false;
    if (n.kind === 'heading' && (n.level ?? 1) <= 1) return false;
    return !hasField(c.ix, id) && !holds(c.ix, id, pa) && !protectedDeep(c, id);
  };
  const extra = new Set<string>();
  for (let i = nodes.length - 1; i > first; i--) {
    const id = nodes[i] as string;
    if (!movable(id)) continue;
    const next = nodes[i + 1];
    const k = c.ix.kind(id);
    // A sentence right before a help link stays with it ("Questions? Call your pharmacist").
    if (k === 'text' && next !== undefined && outlineProtection(c.ix, next, c.roles) === 'help') continue;
    // A heading moves only together with what follows it.
    if (k === 'heading' && (next === undefined || !extra.has(next))) continue;
    extra.add(id);
  }
  const inTitle = new Set(title);
  return {
    title,
    task: nodes.filter((id) => !inTitle.has(id) && !extra.has(id)),
    extra: nodes.filter((id) => extra.has(id)),
  };
}

/* ------------------------------------------------------------------ */
/* Form steps                                                          */
/* ------------------------------------------------------------------ */

/** Fields of the main task in page order, without the site's search and newsletter fields. */
function realFields(c: Ctx, ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    for (const d of subtree(c.ix, id)) {
      const n = c.ix.nodes.get(d);
      if (!n || !FIELD_KINDS.has(n.kind)) continue;
      const label = lower(n.label);
      if ((c.roles[d] ?? n.jevRole) === 'search' || RE.search.test(label) || NEWSLETTER.test(label)) continue;
      out.add(d);
    }
  }
  return [...out].sort((a, b) => (c.ix.order.get(a) ?? 0) - (c.ix.order.get(b) ?? 0));
}

/** Runs of fields that share a parent (a fieldset or group), in page order. */
function runsOf(c: Ctx, fields: string[]): string[][] {
  const runs: string[][] = [];
  let prev: string | null | undefined;
  for (const f of fields) {
    const p = c.ix.parent(f);
    const last = runs[runs.length - 1];
    if (last && p === prev) last.push(f);
    else runs.push([f]);
    prev = p;
  }
  return runs;
}

/** Split a run longer than `max`; a radio group stays whole up to the schema's 8 fields. */
function chunk(c: Ctx, run: string[], max: number): string[][] {
  const radios = run.every((f) => c.ix.kind(f) === 'radio');
  const size = radios ? Math.max(max, Math.min(run.length, MAX_STEP_FIELDS)) : max;
  const out: string[][] = [];
  for (let i = 0; i < run.length; i += size) out.push(run.slice(i, i + size));
  return out;
}

function stepLabel(c: Ctx, fields: string[], last: boolean, many: boolean): SectionLabel {
  const same = c.base.form_steps.find((s) => s.fields.length === fields.length && s.fields.every((f, i) => f === fields[i]));
  if (same) return same.label;
  if (last && many && fields.some((f) => RE.consentField.test(c.ix.label(f)))) return 'Review and submit';
  const words = fields.map((f) => `${c.ix.label(f)} ${c.ix.label(c.ix.parent(f) ?? '')}`).join(' ');
  const l = labelFromWords(words, 'Your details');
  return l === 'Details' ? 'Your details' : l;
}

/**
 * 'pack': as few steps as the fit allows (groups packed up to the fit's field limit).
 * 'group': one group of fields per step (loose single fields share a step, up to 3).
 * Only when the task has at least 3 real fields in at least 2 groups (one fieldset is not a stepper).
 */
function makeSteps(c: Ctx, task: string[], mode: 'pack' | 'group'): Steps {
  if (NO_STEP_PAGES.has(c.base.page_type)) return [];
  const fields = realFields(c, task);
  const runs = runsOf(c, fields);
  if (fields.length < 3 || runs.length < 2) return [];
  const max = Math.max(1, Math.min(MAX_STEP_FIELDS, c.limits.formStepMaxFields));
  const steps: string[][] = [];
  if (mode === 'pack') {
    let cur: string[] = [];
    for (const run of runs) {
      for (const part of chunk(c, run, max)) {
        if (cur.length && cur.length + part.length > max) {
          steps.push(cur);
          cur = [];
        }
        cur.push(...part);
      }
    }
    if (cur.length) steps.push(cur);
  } else {
    const looseMax = Math.min(3, max);
    let loose = false; // the last step holds loose single fields and can take another
    for (const run of runs) {
      const last = steps[steps.length - 1];
      if (run.length === 1 && last && loose && last.length < looseMax) {
        last.push(run[0] as string);
        continue;
      }
      for (const part of chunk(c, run, max)) steps.push([...part]);
      loose = run.length === 1;
    }
  }
  if (steps.length < 2 || steps.length > MAX_STEPS) return [];
  return steps.map((fs, i, all) => ({ label: stepLabel(c, fs, i === all.length - 1, all.length > 1), fields: fs }));
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function primaryWith(prim: FitSection, nodes: string[], steps: Steps): FitSection {
  const keepHeading = prim.heading_ref != null && nodes.includes(prim.heading_ref);
  return {
    ...prim,
    nodes,
    heading_ref: keepHeading ? prim.heading_ref : null,
    layout: steps.length ? 'form_steps' : prim.layout === 'form_steps' ? 'as_is' : prim.layout,
    emphasis: 'lead',
    state: 'open',
    why: 'main_task',
  };
}

function details(c: Ctx, extra: string[], open: boolean): FitSection | null {
  if (!extra.length) return null;
  const actions = extra.filter((id) => c.ix.kind(id) === 'link' || c.ix.kind(id) === 'button').length;
  return section({
    label: 'Details',
    role: 'reference',
    nodes: extra,
    layout: actions > extra.length / 2 ? 'row_list' : 'reading',
    state: open ? 'open' : 'collapsed',
    emphasis: 'quiet',
    why: 'reference_info',
  });
}

/** Neighbouring folded sections with the same name become one drawer (fewer sections; nothing moves far). */
function mergeFolded(c: Ctx, list: FitSection[]): FitSection[] {
  const at = (id: string): number => c.ix.order.get(id) ?? Number.MAX_SAFE_INTEGER;
  const out: FitSection[] = [];
  for (const s of list) {
    const last = out[out.length - 1];
    const same = last !== undefined && last.state === 'collapsed' && s.state === 'collapsed' && last.label === s.label && last.role === s.role;
    if (same && last.nodes.length + s.nodes.length <= 40) {
      out[out.length - 1] = { ...last, nodes: [...last.nodes, ...s.nodes].sort((a, b) => at(a) - at(b)) };
    } else {
      out.push(s);
    }
  }
  return out;
}

function assemble(c: Ctx, sections: Array<FitSection | null>, steps: Steps, density: FitSpec['density'], show: ShowFirst): FitSpec {
  const list = mergeFolded(c, sections.filter((s): s is FitSection => s !== null && s.nodes.length > 0));
  setLists(list, show);
  return {
    page_type: c.base.page_type,
    task: c.base.task,
    strip: [...c.base.strip],
    sections: list,
    primary_action: c.base.primary_action,
    form_steps: steps,
    density,
  };
}

function buildFocus(c: Ctx): FitSpec {
  const p = parts(c);
  const split = splitPrimary(c, p.primary);
  const steps = p.primary ? makeSteps(c, split.task, 'pack') : [];
  const primary = p.primary ? primaryWith(p.primary, [...split.title, ...split.task], steps) : null;
  // A portal page leads with its links, so its navigation stays; elsewhere folded navigation moves to the end.
  const portal = c.base.page_type === 'home_portal' || c.base.task === 'navigate';
  const navStays = p.nav.filter((s) => s.state === 'open' || portal);
  const navEnd = p.nav
    .filter((s) => !navStays.includes(s))
    .map((s) => ({ ...s, state: 'end_drawer' as const, emphasis: 'quiet' as const, why: 'navigation' as const }));
  return assemble(c, [
    ...p.alerts, ...p.orient, primary, ...p.content.filter(lockedOpen), ...p.help, ...p.consent,
    details(c, split.extra, false), ...p.content.filter((s) => !lockedOpen(s)).map(fold), ...p.misc.map(fold),
    ...navStays, ...navEnd, ...p.drawer,
  ], steps, 'airy', 3);
}

function buildGuided(c: Ctx): FitSpec {
  const p = parts(c);
  const split = splitPrimary(c, p.primary);
  const steps = p.primary ? makeSteps(c, split.task, 'group') : [];
  // The title block becomes its own hero when the page has none.
  let orient = p.orient;
  let task = [...split.title, ...split.task];
  if (!orient.length && split.title.length && split.task.length) {
    const h = split.title.find((id) => c.ix.nodes.get(id)?.level === 1) ?? split.title.find((id) => c.ix.kind(id) === 'heading') ?? null;
    orient = [section({ heading_ref: h, label: 'Overview', role: 'orient', nodes: split.title, layout: 'hero', why: 'main_task' })];
    task = [...split.task];
  }
  const primary = p.primary ? primaryWith(p.primary, task, steps) : null;
  // Understand (the hero), act (the task with its own small print), then one reassurance section; what is needed
  // before acting stays open right after the task (section labels are word guesses, so nothing jumps ahead of it).
  const rest = p.content.filter((s) => !lockedOpen(s));
  const at = rest.findIndex((s) => s.role === 'social_proof' || s.label === 'Delivery and returns' || s.label === 'Questions');
  const reassure = at >= 0 ? [{ ...(rest[at] as FitSection), state: 'open' as const, emphasis: 'normal' as const, why: 'reassurance' as const }] : [];
  return assemble(c, [
    ...p.alerts, ...orient, primary, details(c, split.extra, true), ...p.content.filter(lockedOpen), ...reassure, ...p.help, ...p.consent,
    ...rest.filter((_, i) => i !== at).map(fold), ...p.nav, ...p.misc, ...p.drawer,
  ], steps, 'airy', 4);
}

function buildOverview(c: Ctx): FitSpec {
  const p = parts(c);
  // One page, unless the fit says one thing at a time works best: Jev's judge sees sections, not steps, so a
  // stance that drops the stepper for that person would win or lose on noise.
  const steps = p.primary && c.fit.structure_level === 2 ? makeSteps(c, splitPrimary(c, p.primary).task, 'pack') : [];
  const primary = p.primary ? primaryWith(p.primary, [...p.primary.nodes], steps) : null;
  const open = (s: FitSection, emphasis: FitSection['emphasis']): FitSection => ({
    ...s, state: 'open', emphasis, why: s.why === 'long_list' ? 'reference_info' : s.why,
  });
  const nav = p.nav.map((s) => ({ ...open(s, 'quiet'), layout: s.layout === 'as_is' ? ('chip_bar' as const) : s.layout }));
  return assemble(c, [
    ...p.alerts, ...p.orient, primary, ...p.content.map((s) => open(s, 'normal')), ...p.misc.map((s) => open(s, 'quiet')),
    ...p.help, ...p.consent, ...nav, ...p.drawer,
  ], steps, 'comfortable', c.fit.structure_level === 0 ? 12 : snapShowFirst(8));
}

const BUILDERS: Readonly<Record<LocalVariantName, (c: Ctx) => FitSpec>> = {
  focus: buildFocus,
  guided: buildGuided,
  overview: buildOverview,
};

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

/**
 * Up to three local layouts, in the order focus, guided, overview: deterministic for the same input, each repaired
 * with repairSpec (without the fit's limits, like a model's candidate, so the stances stay distinct and Jev weighs
 * each against the fit). A variant identical to the heuristic layout or to an earlier variant is left out. The first
 * `repairs` line of each is its source tag, "source: local (<stance>)".
 */
export function localVariants(outline: PageOutline, roles: Record<string, Role>, fit: FitSummaryForModel): LayoutCandidate[] {
  if (!outline.nodes.length) return [];
  const r = roles ?? {};
  const base = heuristicSpec(outline, r, fit);
  const c: Ctx = { roles: r, fit, ix: indexOutline(outline), base, limits: layoutLimits(fit) };
  const seen = new Set<string>([JSON.stringify(repairSpec(base, outline, { roles: r }).spec)]);
  const out: LayoutCandidate[] = [];
  for (const name of LOCAL_VARIANTS) {
    const { spec, repairs } = repairSpec(BUILDERS[name](c), outline, { roles: r });
    const key = JSON.stringify(spec);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, spec, repairs: [sourceTag('local', LOCAL_VARIANT_NOTES[name]), ...repairs] });
  }
  return out;
}
