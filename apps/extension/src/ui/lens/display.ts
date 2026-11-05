// Owner: L. What the Lens shows for each element: the number the policy acted on, not a role guess.
//
//   main     promote                                       summed main_pick p (duplicate links summed, like the policy)
//   popup    keep_popup                                    task
//   folded   fold                                          ads + teasers + popups
//   guarded  protect by a page rule, help >= 0.30, or       help, or "rule"
//            a help / consent role
//   unsure   keep with ads + teasers + popups >= 0.50      that sum, on a dashed chip
//   kept     everything else                               none (hairline, no chip)
//
// Pure: no DOM. The thresholds come from core's POLICY, so the Lens never restates them by hand.
import { POLICY } from '@webable/core';
import type { ElementDecision, ElementEvidence, ElementJudgment, FineRole, PageDigest, PageUnderstanding, Role } from '@webable/core';
import { settledFine, type FineFamily, type OutlineWeight } from './words';

export type LensClass = 'main' | 'popup' | 'folded' | 'guarded' | 'unsure' | 'kept' | 'pending';

/** Chip priority weight per class (priority = weight × 10 + p). */
export const CLASS_WEIGHT: Record<LensClass, number> = { main: 6, popup: 5, folded: 4, guarded: 3, unsure: 2, kept: 0, pending: 0 };

export const FOLD_ROLES: readonly Role[] = ['advertising', 'recommendations', 'popup_overlay'];
export const PROTECT_ROLES: readonly Role[] = [
  'main_content', 'form_field', 'action_button', 'navigation', 'help_contact', 'consent_notice', 'account_utility',
];

export const ROLE_NAME: Record<Role, string> = {
  main_content: 'content',
  form_field: 'form field',
  action_button: 'button',
  navigation: 'navigation',
  search: 'search',
  advertising: 'ad',
  recommendations: 'teaser',
  popup_overlay: 'popup',
  consent_notice: 'consent notice',
  help_contact: 'help',
  account_utility: 'account',
  legal_footer: 'legal',
  other: 'other',
};

export const ROLE_GROUP: Record<Role, 'fold' | 'protect' | 'other'> = {
  main_content: 'protect',
  form_field: 'protect',
  action_button: 'protect',
  navigation: 'protect',
  search: 'other',
  advertising: 'fold',
  recommendations: 'fold',
  popup_overlay: 'fold',
  consent_notice: 'protect',
  help_contact: 'protect',
  account_utility: 'protect',
  legal_footer: 'other',
  other: 'other',
};

export interface LensItem {
  id: string;
  ev: ElementEvidence;
  /** Digest order, used for reading-order ties. */
  index: number;
  decision: ElementDecision | null;
  j: ElementJudgment | null;
  cls: LensClass;
  /** The number the policy acted on, as shown on the chip; null for a page rule or when there is no chip. */
  p: number | null;
  /** A page rule (not Jev) decided this one. */
  byRule: boolean;
  /** Chip words before the number: 'Main action', 'Folded · ad', 'Consent notice', 'Left alone · teaser'. */
  chip: string;
  /** Chip number text: '0.95', 'rule', or ''. */
  num: string;
  /** Short name of what it is, for rows and merged chips: 'ad', 'help', 'consent notice'. */
  kind: string;
  /** The element's own label from the digest (redacted on this device before Jev saw it). */
  label: string;
  /** 'button · main, below the form' */
  where: string;
  foldSum: number;
  protectSum: number;
  /** One plain sentence on what WebAble did and why. */
  sentence: string;
  /** The policy comparisons that decided it: 'ads 0.98 ≥ 0.90', 'task 0.02 ≤ 0.20'. */
  because: string[];
  /** For rows: the deciding number and its threshold (null when nothing to draw). */
  track: { p: number; at: number; dir: 'ge' | 'le'; label: string } | null;
  priority: number;
  /**
   * Round 7. Null when Jev did not send a fine role or an importance score.
   * `chip` and `num` stay the policy text either way, so the decisions list does not change.
   */
  fine: FineRole | null;
  fineP: number | null;
  fineName: string | null;
  family: FineFamily | null;
  /** 0 (distraction) to 4 (essential), or null when the score was not sent. */
  importance: number | null;
  /** Outline weight. Null keeps the class outline from round 2. */
  weight: OutlineWeight | null;
}

const f2 = (p: number): string => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)).toFixed(2) : '0.00');
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// Probabilities are quantised to 0.01; round sums so 0.02 + 0.03 compares as exactly 0.05 (as the policy does).
const sumOf = (j: ElementJudgment, roles: readonly Role[]): number =>
  Math.round(roles.reduce((t, r) => t + n(j.roleProbs[r]), 0) * 1e6) / 1e6;

function normLabel(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\[\] ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
const pickKey = (e: ElementEvidence): string => `${normLabel(e.label)}|${e.link_target ?? ''}|${e.tag === 'a' ? 'a' : 'control'}`;

/** The main pick's probability summed over controls with the same label and target (the policy's own rule). */
export function summedMainP(id: string, digest: PageDigest, u: PageUnderstanding | null): { p: number; members: number } {
  const probs = u?.mainPick?.probs ?? {};
  const self = digest.elements.find((e) => e.id === id);
  if (!self) return { p: n(probs[id]), members: 1 };
  const key = pickKey(self);
  let p = 0;
  let members = 0;
  for (const e of digest.elements) {
    if (pickKey(e) !== key) continue;
    const v = n(probs[e.id]);
    if (v > 0 || e.id === id) {
      p += v;
      members++;
    }
  }
  if (p === 0 && u?.mainPick?.id === id) p = n(u.mainPick.p);
  return { p: Math.min(1, p), members: Math.max(1, members) };
}

/** The fold role that carries most of the fold sum: 'ad', 'teaser' or 'popup'. */
function foldKind(j: ElementJudgment): { one: string; many: string } {
  let best: Role = 'advertising';
  let bp = -1;
  for (const r of FOLD_ROLES) {
    const v = n(j.roleProbs[r]);
    if (v > bp) {
      bp = v;
      best = r;
    }
  }
  if (best === 'recommendations') return { one: 'teaser', many: 'teasers' };
  if (best === 'popup_overlay') return { one: 'popup', many: 'popups' };
  return { one: 'ad', many: 'ads' };
}

const RULE_TEXT: Array<{ test: RegExp; title: string; sentence: string }> = [
  { test: /consent notice \(rule\)/, title: 'Consent notice', sentence: 'Consent notices are never folded, and WebAble never answers them.' },
  { test: /required field \(rule\)/, title: 'Required field', sentence: 'A page rule keeps required fields in view, whatever Jev says.' },
  { test: /typed value \(rule\)/, title: 'Has a typed value', sentence: 'A page rule keeps fields that already hold a value in view.' },
  { test: /focus is inside \(rule\)/, title: 'Focus is here', sentence: 'A page rule keeps the part of the page with keyboard focus in view.' },
];

function whereText(ev: ElementEvidence): string {
  const what = (ev.role_hint || ev.tag || 'element').replace(/\s*\((required|disabled)\)/g, '').trim();
  const lm = ev.landmark && ev.landmark !== 'none' ? ev.landmark : '';
  const pos = ev.position || '';
  const place = [lm, pos].filter(Boolean).join(', ');
  return place ? `${what} · ${place}` : what;
}

function displayLabel(ev: ElementEvidence): string {
  const raw = (ev.label || '').trim();
  const hint = (ev.role_hint || ev.tag || 'element').replace(/\s*\((required|disabled)\)/g, '').trim();
  if (raw && raw !== '·' && raw.toLowerCase() !== hint.toLowerCase()) return raw;
  // No label of its own: say what it is and what its class words or position say ("Region: ad slot").
  const Hint = hint.charAt(0).toUpperCase() + hint.slice(1);
  const words = (ev.class_words ?? []).filter((w) => w && w.length > 1).slice(0, 3);
  if (words.length) return `${Hint}: ${words.join(' ')}`;
  return ev.position ? `${Hint} · ${ev.position}` : Hint;
}

/** Classify one digest element for the Lens. */
export function lensItem(ev: ElementEvidence, index: number, d: ElementDecision | undefined, digest: PageDigest, u: PageUnderstanding | null): LensItem {
  const base = { id: ev.id, ev, index, label: displayLabel(ev), where: whereText(ev) };
  if (!d) {
    return {
      ...base, decision: null, j: null, cls: 'pending', p: null, byRule: false, chip: 'Reading', num: '', kind: ev.role_hint || ev.tag,
      foldSum: 0, protectSum: 0, sentence: "Waiting for Jev's answer.", because: [], track: null, priority: 0,
      ...settledFine(null),
    };
  }
  const j = d.judgment;
  const reasons = Array.isArray(d.reasons) ? d.reasons : [];
  const answered = Boolean(j && (j.roleP > 0 || Object.keys(j.roleProbs ?? {}).length > 0));
  const foldSum = j ? sumOf(j, FOLD_ROLES) : 0;
  const protectSum = j ? sumOf(j, PROTECT_ROLES) : 0;
  const task = n(j?.task);
  const help = n(j?.help);
  const main = n(j?.main);
  const fk = j ? foldKind(j) : { one: 'ad', many: 'ads' };
  const common = { ...base, decision: d, j, foldSum, protectSum, ...settledFine(j) };

  if (d.verdict === 'promote') {
    const sm = summedMainP(ev.id, digest, u);
    const because = [
      `main pick ${f2(sm.p)} ≥ ${f2(POLICY.promotePick)}${sm.members > 1 ? ` (${sm.members} matching links summed)` : ''}`,
      `main ${f2(main)} ≥ ${f2(POLICY.promoteMainNoul)}`,
    ];
    return {
      ...common, cls: 'main', p: sm.p, byRule: false, chip: 'Main action', num: f2(sm.p), kind: 'main action',
      sentence: "Jev picked this as the page's main action. WebAble outlines it and widens its click area; it stays where the site put it.",
      because, track: { p: sm.p, at: POLICY.promotePick, dir: 'ge', label: 'main pick' },
      priority: CLASS_WEIGHT.main * 10 + sm.p,
    };
  }

  if (d.verdict === 'keep_popup') {
    return {
      ...common, cls: 'popup', p: task, byRule: false, chip: 'Kept in view · task', num: f2(task), kind: 'popup',
      sentence: 'This popup matters to the task on this page (a time-out warning, for example), so it stays in view.',
      because: [`popup ${f2(n(j?.roleProbs.popup_overlay) || n(j?.roleP))}`, `task ${f2(task)} ≥ ${f2(POLICY.keepPopupTask)}`],
      track: { p: task, at: POLICY.keepPopupTask, dir: 'ge', label: 'task' },
      priority: CLASS_WEIGHT.popup * 10 + task,
    };
  }

  if (d.verdict === 'fold') {
    return {
      ...common, cls: 'folded', p: foldSum, byRule: false, chip: `Folded · ${fk.one}`, num: f2(foldSum), kind: fk.one,
      sentence: 'Jev is sure this is not part of the task, so it is dimmed. It is still there and still works.',
      because: [
        `${fk.many} ${f2(foldSum)} ≥ ${f2(POLICY.foldRoleSum)}`,
        `task ${f2(task)} ≤ ${f2(POLICY.foldTaskMax)}`,
        `help ${f2(help)} ≤ ${f2(POLICY.foldHelpMax)}`,
      ],
      track: { p: foldSum, at: POLICY.foldRoleSum, dir: 'ge', label: 'ads, teasers, popups' },
      priority: CLASS_WEIGHT.folded * 10 + foldSum,
    };
  }

  if (d.verdict === 'protect') {
    const rule = RULE_TEXT.find((r) => reasons.some((x) => r.test.test(x)));
    const helpRole = j?.role === 'help_contact';
    const consentRole = j?.role === 'consent_notice';
    if (rule) {
      return {
        ...common, cls: 'guarded', p: null, byRule: true, chip: `${rule.title} ·`, num: 'rule', kind: rule.title.toLowerCase(),
        sentence: rule.sentence,
        because: [reasons.find((x) => rule.test.test(x)) ?? 'page rule', ...(answered ? [`help ${f2(help)}`, `task ${f2(task)}`] : [])],
        track: null,
        priority: CLASS_WEIGHT.guarded * 10 + 1,
      };
    }
    if (help >= POLICY.protectHelp || helpRole) {
      const p = Math.max(help, helpRole ? n(j?.roleP) : 0);
      return {
        ...common, cls: 'guarded', p, byRule: false, chip: 'Help', num: f2(p), kind: 'help',
        sentence: 'Help and contact links are never hidden or dimmed.',
        because: help >= POLICY.protectHelp
          ? [`help ${f2(help)} ≥ ${f2(POLICY.protectHelp)}`]
          : [`help role ${f2(n(j?.roleP))}`, `content, controls, help ${f2(protectSum)} ≥ ${f2(POLICY.protectRoleSum)}`],
        track: { p: help >= POLICY.protectHelp ? help : protectSum, at: help >= POLICY.protectHelp ? POLICY.protectHelp : POLICY.protectRoleSum, dir: 'ge', label: help >= POLICY.protectHelp ? 'help' : 'content, controls, help' },
        priority: CLASS_WEIGHT.guarded * 10 + p,
      };
    }
    if (consentRole) {
      const p = n(j?.roleProbs.consent_notice) || n(j?.roleP);
      return {
        ...common, cls: 'guarded', p, byRule: false, chip: 'Consent notice', num: f2(p), kind: 'consent notice',
        sentence: 'Consent notices are never folded, and WebAble never answers them.',
        because: [`consent notice ${f2(p)}`, `content, controls, help ${f2(protectSum)} ≥ ${f2(POLICY.protectRoleSum)}`],
        track: { p: protectSum, at: POLICY.protectRoleSum, dir: 'ge', label: 'content, controls, help' },
        priority: CLASS_WEIGHT.guarded * 10 + p,
      };
    }
    // Protected because it is part of the task: a hairline, no chip.
    const why: string[] = [];
    if (task >= POLICY.protectTask) why.push(`task ${f2(task)} ≥ ${f2(POLICY.protectTask)}`);
    if (protectSum >= POLICY.protectRoleSum) why.push(`content, controls, help ${f2(protectSum)} ≥ ${f2(POLICY.protectRoleSum)}`);
    // It looked like an ad, but Jev kept some probability that it is content or a control: not sure, left alone.
    if (answered && foldSum >= 0.5 && task < POLICY.protectTask) {
      return {
        ...common, cls: 'unsure', p: foldSum, byRule: false, chip: `Left alone · ${fk.one}`, num: f2(foldSum), kind: fk.one,
        sentence: `It looks like ${fk.one === 'ad' ? 'an ad' : `a ${fk.one}`}, but Jev's probability that it is content or a control is ${f2(protectSum)}, so the policy protects it and WebAble leaves it as the site made it.`,
        because: [`${fk.many} ${f2(foldSum)}`, ...why, 'not sure: left alone'],
        track: { p: foldSum, at: POLICY.foldRoleSum, dir: 'ge', label: 'ads, teasers, popups' },
        priority: CLASS_WEIGHT.unsure * 10 + foldSum,
      };
    }
    return {
      ...common, cls: 'kept', p: null, byRule: false, chip: 'Part of the task', num: '', kind: j ? ROLE_NAME[j.role] : 'element',
      sentence: task >= POLICY.protectTask
        ? 'Part of the task on this page, so it is kept as the site made it and never folded.'
        : 'Content or a control on this page, so it is kept as the site made it and never folded.',
      because: why.length ? why : reasons.slice(0, 2),
      track: task >= POLICY.protectTask
        ? { p: task, at: POLICY.protectTask, dir: 'ge', label: 'task' }
        : { p: protectSum, at: POLICY.protectRoleSum, dir: 'ge', label: 'content, controls, help' },
      priority: 0,
    };
  }

  // keep
  if (answered && foldSum >= 0.5) {
    const because: string[] = [];
    if (foldSum < POLICY.foldRoleSum) because.push(`${fk.many} ${f2(foldSum)} < ${f2(POLICY.foldRoleSum)}`);
    else because.push(`${fk.many} ${f2(foldSum)} ≥ ${f2(POLICY.foldRoleSum)}`);
    if (task > POLICY.foldTaskMax) because.push(`task ${f2(task)} > ${f2(POLICY.foldTaskMax)}`);
    if (help > POLICY.foldHelpMax) because.push(`help ${f2(help)} > ${f2(POLICY.foldHelpMax)}`);
    because.push('not sure: left alone');
    return {
      ...common, cls: 'unsure', p: foldSum, byRule: false, chip: `Left alone · ${fk.one}`, num: f2(foldSum), kind: fk.one,
      sentence: 'Jev was not sure enough to act, so WebAble left it as the site made it.',
      because,
      track: { p: foldSum, at: POLICY.foldRoleSum, dir: 'ge', label: 'ads, teasers, popups' },
      priority: CLASS_WEIGHT.unsure * 10 + foldSum,
    };
  }
  return {
    ...common, cls: 'kept', p: null, byRule: false, chip: 'Kept', num: '', kind: j && answered ? ROLE_NAME[j.role] : 'element',
    sentence: answered
      ? 'Nothing here crossed a threshold, so it is kept as the site made it.'
      : 'Jev did not answer for this one, so it is kept as the site made it (WebAble fails closed).',
    because: answered
      ? [`ads, teasers, popups ${f2(foldSum)} < 0.50`, `task ${f2(task)}`]
      : ['no answer from Jev: left as is'],
    track: answered ? { p: foldSum, at: POLICY.foldRoleSum, dir: 'ge', label: 'ads, teasers, popups' } : null,
    priority: 0,
  };
}

/** Every digest element as a Lens item, in digest order. */
export function lensItems(digest: PageDigest | null, decisions: ElementDecision[], u: PageUnderstanding | null): LensItem[] {
  if (!digest) return [];
  const byId = new Map<string, ElementDecision>();
  for (const d of decisions) byId.set(d.id, d);
  return digest.elements.map((ev, i) => lensItem(ev, i, byId.get(ev.id), digest, u));
}

export interface ClassCounts { main: number; popup: number; folded: number; guarded: number; unsure: number; kept: number; pending: number }

export function classCounts(items: LensItem[]): ClassCounts {
  const c: ClassCounts = { main: 0, popup: 0, folded: 0, guarded: 0, unsure: 0, kept: 0, pending: 0 };
  for (const it of items) c[it.cls]++;
  return c;
}

/**
 * Chip face for elements that share one fine role: "Scoreboard" / "Team logo ×2".
 * Null when any member has no fine role, so the caller keeps the policy chip.
 */
export function fineChipFace(items: LensItem[]): { words: string; num: string } | null {
  const first = items[0];
  if (!first?.fine || !first.fineName) return null;
  if (!items.every((i) => i.fine === first.fine && i.fineName)) return null;
  const ps = items.map((i) => i.fineP).filter((p): p is number => p != null);
  const range = ps.length === 0 ? '' : f2(Math.min(...ps)) === f2(Math.max(...ps)) ? f2(ps[0]!) : `${f2(Math.min(...ps))}–${f2(Math.max(...ps))}`;
  if (items.length === 1) return { words: first.fineName, num: range };
  return { words: `${first.fineName} ×${items.length}`, num: range };
}

/** Fine-role chips share the round-2 budget. Higher Jev's probability is placed first. The page label is separate. */
export function fineChipPriority(it: LensItem): number {
  return 45 + (it.fineP ?? 0);
}

/** Text for a chip that stands for several elements of one class: '4 folded · 0.96–1.00'. */
export function mergedChip(items: LensItem[]): { words: string; num: string } {
  const first = items[0];
  if (!first) return { words: '', num: '' };
  const k = items.length;
  const ps = items.map((i) => i.p).filter((p): p is number => p != null);
  const lo = ps.length ? Math.min(...ps) : null;
  const hi = ps.length ? Math.max(...ps) : null;
  const range = lo == null || hi == null ? 'rule' : f2(lo) === f2(hi) ? f2(lo) : `${f2(lo)}–${f2(hi)}`;
  const allRule = items.every((i) => i.byRule);
  switch (first.cls) {
    case 'folded':
      return { words: `${k} folded ·`, num: range };
    case 'guarded': {
      const kinds = new Set(items.map((i) => i.chip));
      const title = first.chip.replace(/ ·$/, '');
      return { words: kinds.size === 1 ? `${title} ×${k} ·` : `${k} protected ·`, num: allRule ? 'rule' : range };
    }
    case 'unsure':
      return { words: `${k} left alone ·`, num: range };
    case 'popup':
      return { words: `${k} kept in view ·`, num: range };
    default:
      return { words: `${k} × ${first.chip}`, num: range };
  }
}

/** Sheet groups, in order, with the rule each one follows. */
export const GROUPS: Array<{ key: string; title: string; rule: string; classes: LensClass[] }> = [
  { key: 'main', title: 'Main action', rule: `main pick ≥ ${f2(POLICY.promotePick)} and main ≥ ${f2(POLICY.promoteMainNoul)}, never off-site`, classes: ['main'] },
  { key: 'popup', title: 'Kept in view', rule: `a popup with task ≥ ${f2(POLICY.keepPopupTask)}`, classes: ['popup'] },
  { key: 'guarded', title: 'Protected: help and notices', rule: `help ≥ ${f2(POLICY.protectHelp)}, a help or consent role, or a page rule`, classes: ['guarded'] },
  { key: 'folded', title: 'Folded', rule: `ads, teasers, popups ≥ ${f2(POLICY.foldRoleSum)}, task ≤ ${f2(POLICY.foldTaskMax)}, help ≤ ${f2(POLICY.foldHelpMax)}`, classes: ['folded'] },
  { key: 'unsure', title: 'Left alone: not sure', rule: 'looked like an ad or popup, but not surely enough to act', classes: ['unsure'] },
  { key: 'kept', title: 'Part of the task', rule: 'everything else stays as the site made it', classes: ['kept'] },
  { key: 'pending', title: 'Waiting for Jev', rule: 'asked, not answered yet', classes: ['pending'] },
];
