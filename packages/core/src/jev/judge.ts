// Jev judges the candidate layouts (research-redesign §8). Owner: A1.
//
// Code computes each layout's features; every candidate's features sit inside its own questions (no shared rows).
// Per layout: better (Noul, "easier than the original"), risk (Noul, "folds something needed"), fit (5-level Score).
// Per folded section: need (Noul). Never a pick-one Choice: it was fooled by surface features (0.44-0.58 for a
// sabotaged layout). Decide: composite = better x (1 - risk); reject risk >= 0.80; auto-apply when
// better >= 0.70 and risk < 0.50; open any folded section with need >= 0.60.
import type { FitSection, FitSpec, FitSummaryForModel, LayoutCandidate, OutlineKind, OutlineNode, PageOutline } from '../types';
import { noulOf, scoreOf } from './api';
import type { JevQuestion, JevResponse } from './api';

export const JUDGE = Object.freeze({
  rejectHides: 0.8,
  autoEasier: 0.7,
  autoHidesBelow: 0.5,
  unfoldNeed: 0.6,
  tie: 0.03,
});

const CODES = ['layout_q', 'layout_m', 'layout_z', 'layout_k', 'layout_r', 'layout_w', 'layout_t', 'layout_p', 'layout_v', 'layout_x'];
/** Neutral code for candidate i (never the stance name). */
export function judgeCode(i: number): string {
  return CODES[i] ?? `layout_${i}`;
}

export const JUDGE_NOTE = 'Each layout re-presents the same page; nothing is deleted. Folded parts open in one tap. Features were computed by code.';
export const Q_FIT = "How well does this layout suit the person described in `person` for the page's main task?";
export const Q_BETTER =
  'Would this person complete the main task more easily with this layout than with the original page (which has every section open, ads and carousels included)?';
export const Q_RISK =
  'Does this layout fold, move to the end, or leave out something the person needs before completing the main task (such as options, quantity, delivery choice, safety warnings or help)?';
export const Q_NEED = 'Would the person need to see or use this folded part before they can complete the main task?';
export const JUDGE_FIT_LEVELS: ReadonlyArray<{ level: string; what: string }> = Object.freeze([
  { level: 'poor', what: 'the main task is buried or broken, or the page is as busy as the original' },
  { level: 'weak', what: 'the main task is reachable but competes with many open sections or choices, or something needed is folded away' },
  { level: 'adequate', what: 'the main task comes early, but clutter or long content still costs this person time' },
  { level: 'good', what: 'main task first with what it needs, few open sections, clutter folded' },
  { level: 'excellent', what: 'main task first with everything it needs open, very few choices open, ads and promotions folded, help in reach, calm' },
]);

const PAGE_WORDS: Record<FitSpec['page_type'], string> = {
  product_detail: 'product page', search_results: 'search results page', listing: 'listing page', article: 'article',
  form: 'form page', home_portal: 'home page', account_dashboard: 'account page', video: 'video page',
  docs: 'documentation page', inbox: 'inbox', feed: 'feed', other: 'web page',
};
const TASK_WORDS: Record<FitSpec['task'], string> = {
  buy: 'choose options and buy the item', compare: 'compare the items and pick one', read: 'read the main text',
  search: 'search and pick a result', fill_form: 'fill in the form and submit it', sign_in: 'sign in',
  watch: 'watch the main video', book: 'choose a time and book it', pay: 'review the amount and pay',
  navigate: 'find the right section and go to it', contact: 'find a way to reach a person',
  other: "complete the page's main task",
};

/** Functional needs in plain words, from the coarse fit summary (no conditions, no measurements). */
export function judgePersonWords(fit: FitSummaryForModel): Record<string, string> {
  const need = (n: FitSummaryForModel['text_need']) => (n === 'large' ? 'large' : n === 'some' ? 'larger than typical' : 'typical');
  return {
    text: need(fit.text_need),
    targets: need(fit.target_need),
    pointing: fit.target_need === 'large' ? 'imprecise' : fit.target_need === 'some' ? 'somewhat imprecise' : 'precise',
    clutter: fit.clutter_tolerance === 'low'
      ? 'busy pages cost this person a lot of time'
      : fit.clutter_tolerance === 'medium' ? 'busy pages cost this person some time' : 'no measurable cost from busy pages',
    structure: fit.structure_level === 2
      ? 'one thing at a time works best'
      : fit.structure_level === 1 ? 'the main task first works best' : 'fine with the page as it is',
    motion: fit.motion === 'reduce' ? 'moving content gets in the way' : 'moving content is fine',
  };
}

/* ------------------------------------------------------------------ */
/* Features (code computes; Jev compares)                              */
/* ------------------------------------------------------------------ */

const CONTROL_KINDS = new Set<OutlineKind>(['button', 'link', 'field', 'select', 'checkbox', 'radio']);
const DESCRIBE_KINDS = new Set<OutlineKind>(['heading', 'button', 'field', 'select', 'checkbox', 'radio', 'notice']);
const NON_CONTENT_ROLES = new Set<FitSection['role']>(['orient', 'alert', 'consent', 'help']);

interface Tree { byId: Map<string, OutlineNode>; children: Map<string, string[]> }

function tree(outline: PageOutline): Tree {
  const byId = new Map<string, OutlineNode>();
  const children = new Map<string, string[]>();
  for (const n of outline.nodes ?? []) byId.set(n.id, n);
  for (const n of outline.nodes ?? []) {
    if (!n.parent || !byId.has(n.parent)) continue;
    const list = children.get(n.parent) ?? [];
    list.push(n.id);
    children.set(n.parent, list);
  }
  return { byId, children };
}

function cleanLabel(label: string | undefined): string {
  const t = (label ?? '').replace(/\s+/g, ' ').trim();
  if (!t || /^[·\s]+$/.test(t)) return '';
  return t.split(' ').slice(0, 6).join(' ');
}

function controlsUnder(t: Tree, id: string, seen: Set<string> = new Set()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const n = t.byId.get(id);
  let c = n && CONTROL_KINDS.has(n.kind) ? 1 : 0;
  for (const k of t.children.get(id) ?? []) c += controlsUnder(t, k, seen);
  return c;
}

function describe(t: Tree, ids: string[]): string {
  const out: string[] = [];
  const visit = (id: string, depth: number) => {
    if (out.length >= 14) return;
    const n = t.byId.get(id);
    if (!n) return;
    const label = cleanLabel(n.label);
    if (depth === 0 || label || DESCRIBE_KINDS.has(n.kind)) {
      const kind = n.kind === 'heading' && n.level ? `h${n.level}` : n.kind;
      out.push(`${kind}${label ? ` "${label}"` : ''}${n.shape ? ` ${n.shape}` : ''}`);
    }
    if (depth < 2) for (const k of t.children.get(id) ?? []) visit(k, depth + 1);
  };
  for (const id of ids) visit(id, 0);
  return out.slice(0, 14).join(', ');
}

/** Deterministic features for one layout (research-redesign §8.1 step 3). */
export function judgeLayoutFeatures(spec: FitSpec, outline: PageOutline): Record<string, unknown> {
  const t = tree(outline);
  const sections = spec.sections ?? [];
  const sectionOf = new Map<string, FitSection>();
  for (const s of sections) for (const id of s.nodes) if (!sectionOf.has(id)) sectionOf.set(id, s);
  const strip = new Set(spec.strip ?? []);
  const placeOf = (id: string): FitSection | 'strip' | null => {
    let p: string | undefined = id;
    const seen = new Set<string>();
    while (p && !seen.has(p)) {
      seen.add(p);
      const s = sectionOf.get(p);
      if (s) return s;
      if (strip.has(p)) return 'strip';
      p = t.byId.get(p)?.parent;
    }
    return null;
  };
  const isOpen = (id: string): boolean => {
    const pl = placeOf(id);
    return pl === 'strip' || (pl !== null && pl.state === 'open');
  };
  const content = sections.filter((s) => !NON_CONTENT_ROLES.has(s.role));
  const open = content.filter((s) => s.state === 'open');
  const primary = sections.find((s) => s.role === 'primary');
  const choicesOpen = open.reduce((total, s) => {
    const seen = new Set<string>();
    const n = s.nodes.reduce((u, id) => u + controlsUnder(t, id, seen), 0);
    return total + (s.show_first > 0 ? Math.min(n, s.show_first * 2) : n);
  }, 0);
  const adNodes = (outline.nodes ?? []).filter((n) => n.jevRole === 'advertising').map((n) => n.id);
  const promoNodes = (outline.nodes ?? []).filter((n) => n.jevRole === 'recommendations').map((n) => n.id);
  const helpNodes = (outline.nodes ?? []).filter((n) => n.jevRole === 'help_contact');
  const helpOpen = helpNodes.length === 0 ? null : helpNodes.every((n) => isOpen(n.id));
  const f: Record<string, unknown> = {
    sections_in_order: sections.map((s) => `${s.label} [${s.state}${s.emphasis === 'lead' ? ', lead' : ''}]`),
    open_content_sections: open.length,
    choices_open: choicesOpen,
    main_task_section_position: primary ? content.indexOf(primary) + 1 : 0,
    folded_parts: sections.filter((s) => s.state !== 'open').map((s) => `${s.label} (${s.state}): ${describe(t, s.nodes)}`),
    open_parts: sections.filter((s) => s.state === 'open').map((s) => `${s.label}: ${describe(t, s.nodes)}`),
    ads_or_sponsored_open: sections.some((s) => s.state === 'open' && s.role === 'ads') || adNodes.some(isOpen),
    promotions_open: sections.filter((s) => s.state === 'open' && (s.role === 'promo' || s.role === 'related')).length +
      (promoNodes.some(isOpen) ? 1 : 0),
    folded_sections: sections.filter((s) => s.state !== 'open').length,
  };
  if (helpOpen !== null) f.help_in_view = helpOpen;
  if (spec.primary_action) f.main_action_in_view = isOpen(spec.primary_action);
  return f;
}

/* ------------------------------------------------------------------ */
/* Call                                                                */
/* ------------------------------------------------------------------ */

export function needQuestionId(i: number, sectionIndex: number): string {
  return `need_${judgeCode(i)}_${sectionIndex}`;
}

export function buildJudgeCall(
  cands: LayoutCandidate[], fit: FitSummaryForModel, outline: PageOutline,
): { state: unknown; questions: Record<string, JevQuestion> } {
  const ref = cands.find((c) => c.name === 'heuristic') ?? cands[0];
  const pageType = ref?.spec.page_type ?? 'other';
  const task = ref?.spec.task ?? 'other';
  const state = {
    person: judgePersonWords(fit),
    page: { type: PAGE_WORDS[pageType] ?? 'web page', main_task: TASK_WORDS[task] ?? TASK_WORDS.other },
    note: JUDGE_NOTE,
  };
  const t = tree(outline);
  const questions: Record<string, JevQuestion> = {};
  cands.forEach((c, i) => {
    const code = judgeCode(i);
    const layout = judgeLayoutFeatures(c.spec, outline);
    questions[`fit_${code}`] = { type: 'score', instructions: { question: Q_FIT, layout }, criteria: JUDGE_FIT_LEVELS.map((l) => ({ ...l })) };
    questions[`better_${code}`] = { type: 'noul', instructions: { question: Q_BETTER, layout } };
    questions[`risk_${code}`] = { type: 'noul', instructions: { question: Q_RISK, layout } };
  });
  cands.forEach((c, i) => {
    c.spec.sections.forEach((s, si) => {
      if (s.state === 'open') return;
      questions[needQuestionId(i, si)] = {
        type: 'noul',
        instructions: { question: Q_NEED, folded_part: { label: s.label, contains: describe(t, s.nodes) } },
      };
    });
  });
  return { state, questions };
}

/** Fill pEasier, pHides, fitScore and composite from the answers; list folded sections Jev says are needed. */
export function scoreCandidates(
  cands: LayoutCandidate[], resp: JevResponse,
): { cands: LayoutCandidate[]; unfold: Array<{ candidate: string; sectionIndex: number }> } {
  const unfold: Array<{ candidate: string; sectionIndex: number }> = [];
  const out = cands.map((c, i) => {
    const code = judgeCode(i);
    const better = noulOf(resp, `better_${code}`);
    const risk = noulOf(resp, `risk_${code}`);
    const fit = scoreOf(resp, `fit_${code}`);
    const next: LayoutCandidate = { ...c, repairs: [...c.repairs] };
    delete next.pEasier;
    delete next.pHides;
    delete next.fitScore;
    delete next.composite;
    if (better !== null) next.pEasier = better;
    if (risk !== null) next.pHides = risk;
    if (fit) next.fitScore = Math.round(fit.score * 100) / 100;
    if (better !== null && risk !== null) next.composite = Math.round(better * (1 - risk) * 10000) / 10000;
    c.spec.sections.forEach((s, si) => {
      if (s.state === 'open') return;
      const need = noulOf(resp, needQuestionId(i, si));
      if (need !== null && need >= JUDGE.unfoldNeed) unfold.push({ candidate: c.name, sectionIndex: si });
    });
    return next;
  });
  return { cands: out, unfold };
}

function openSections(c: LayoutCandidate): number {
  return c.spec.sections.filter((s) => s.state === 'open').length;
}

/**
 * Highest composite wins (layouts within 0.03 of the best go to the higher fit Score, then fewer open sections);
 * risk >= 0.80 is rejected; with no judged candidate left the instant heuristic layout stays.
 */
export function chooseCandidate(cands: LayoutCandidate[]): { chosen: LayoutCandidate['name']; autoApply: boolean } {
  const ok = cands.filter((c) =>
    typeof c.composite === 'number' && typeof c.pHides === 'number' && typeof c.pEasier === 'number' && c.pHides < JUDGE.rejectHides);
  if (ok.length === 0) return { chosen: 'heuristic', autoApply: false };
  // Ties are measured against the best composite (a pairwise "within 0.03" comparator is not transitive, so a sort
  // could put a layout 0.05 below the best first). Among those tied with the best: higher fit Score, then fewer
  // open sections, then the higher composite, then the earlier candidate.
  const best = Math.max(...ok.map((c) => c.composite ?? 0));
  const tied = ok.filter((c) => best - (c.composite ?? 0) <= JUDGE.tie + 1e-9);
  const sorted = [...tied].sort((a, b) => {
    const fd = (b.fitScore ?? 0) - (a.fitScore ?? 0);
    if (fd !== 0) return fd;
    const od = openSections(a) - openSections(b);
    if (od !== 0) return od;
    return (b.composite ?? 0) - (a.composite ?? 0);
  });
  const w = sorted[0]!;
  return { chosen: w.name, autoApply: (w.pEasier ?? 0) >= JUDGE.autoEasier && (w.pHides ?? 1) < JUDGE.autoHidesBelow };
}

/** Open the sections Jev said are needed and move each directly after the primary section. */
export function applyUnfold(cand: LayoutCandidate, sectionIndexes: number[]): LayoutCandidate {
  if (sectionIndexes.length === 0) return cand;
  const want = new Set(sectionIndexes);
  const moved: FitSection[] = [];
  const rest: FitSection[] = [];
  cand.spec.sections.forEach((s, i) => {
    if (want.has(i) && s.state !== 'open') moved.push({ ...s, state: 'open', why: 'needed_before_acting' });
    else rest.push(s);
  });
  if (moved.length === 0) return cand;
  const at = rest.findIndex((s) => s.role === 'primary');
  const sections = at >= 0 ? [...rest.slice(0, at + 1), ...moved, ...rest.slice(at + 1)] : [...moved, ...rest];
  return {
    ...cand,
    spec: { ...cand.spec, sections },
    repairs: [...cand.repairs, ...moved.map((s) => `Opened "${s.label}": Jev said it is needed before acting`)],
  };
}
