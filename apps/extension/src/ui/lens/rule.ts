// Owner: L. "Jev vs a plain rule": the three lines of code a team might write instead, run on the same digest.
//
//   main  = the largest main-area button (area × 2 if its visual weight is high), off-site excluded
//   fold  = any word matching ^(ad|ads|advert…|sponsor…|promo…|banner)$
//   help  = help, contact, faq, support or call
//
// Pure. It compares choices, not accuracy: on real sites the Lens says the two "differ", never that one is wrong.
import type { ElementEvidence, PageDigest } from '@webable/core';
import type { LensItem } from './display';

const FOLD_WORD = /^(ad|ads|advert\w*|sponsor\w*|promo\w*|banner)$/;
const HELP_WORD = /^(help|contact|faq|faqs|support|call)$/;
const MAIN_ZONES = new Set(['center_column', 'full_width_mid']);

export interface PlainRule {
  mainId: string | null;
  /** '210×48' for the rule's pick. */
  mainSize: string | null;
  foldIds: string[];
  helpIds: string[];
}

function words(e: ElementEvidence): string[] {
  const out: string[] = [];
  for (const w of e.class_words ?? []) out.push(...String(w).toLowerCase().split(/[^a-z0-9]+/));
  out.push(...String(e.label ?? '').toLowerCase().split(/[^a-z0-9]+/));
  return out.filter(Boolean);
}

export function sizeOf(e: ElementEvidence): { w: number; h: number } | null {
  const m = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i.exec(e.size ?? '');
  if (!m) return null;
  return { w: Number(m[1]), h: Number(m[2]) };
}

function isButton(e: ElementEvidence): boolean {
  const hint = (e.role_hint ?? '').toLowerCase();
  if (e.tag === 'button') return true;
  if (hint.startsWith('button')) return true;
  if (e.tag === 'input' && /submit|button/.test(hint)) return true;
  // Links styled as buttons count too: that is what a quick rule would key on.
  return (e.class_words ?? []).some((w) => /^(btn|button|cta)/i.test(String(w)));
}

function inMainArea(e: ElementEvidence): boolean {
  if (e.fixed || e.zone.startsWith('overlay')) return false;
  return MAIN_ZONES.has(e.zone) || e.landmark === 'main';
}

export function plainRule(digest: PageDigest | null): PlainRule {
  const out: PlainRule = { mainId: null, mainSize: null, foldIds: [], helpIds: [] };
  if (!digest) return out;
  let best = -1;
  for (const e of digest.elements) {
    const ws = words(e);
    if (ws.some((w) => FOLD_WORD.test(w))) out.foldIds.push(e.id);
    if (ws.some((w) => HELP_WORD.test(w))) out.helpIds.push(e.id);
    if (!isButton(e) || !inMainArea(e) || e.link_target === 'another website') continue;
    const sz = sizeOf(e);
    if (!sz) continue;
    const score = sz.w * sz.h * (e.visual_weight === 'high' ? 2 : 1);
    if (score > best) {
      best = score;
      out.mainId = e.id;
      out.mainSize = `${Math.round(sz.w)}×${Math.round(sz.h)}`;
    }
  }
  return out;
}

export interface RuleDiff {
  agrees: boolean;
  main: { rule: { id: string; label: string; size: string } | null; jev: { id: string; label: string; p: number } | null; same: boolean };
  folded: { rule: number; jev: number; both: number };
  help: { rule: number; jev: number; both: number };
  /** Things the rule would fold that Jev protects or keeps for the task (named by label). */
  ruleFoldsProtected: string[];
  lines: string[];
}

const q = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
};

export function compareRule(rule: PlainRule, items: LensItem[]): RuleDiff {
  const byId = new Map(items.map((i) => [i.id, i]));
  const jevMain = items.find((i) => i.cls === 'main') ?? null;
  const ruleMainItem = rule.mainId ? byId.get(rule.mainId) ?? null : null;
  const main = {
    rule: ruleMainItem && rule.mainSize ? { id: ruleMainItem.id, label: ruleMainItem.label, size: rule.mainSize } : null,
    jev: jevMain ? { id: jevMain.id, label: jevMain.label, p: jevMain.p ?? 0 } : null,
    same: (rule.mainId ?? null) === (jevMain?.id ?? null),
  };
  const jevFold = new Set(items.filter((i) => i.cls === 'folded').map((i) => i.id));
  const ruleFold = new Set(rule.foldIds);
  const foldBoth = [...ruleFold].filter((id) => jevFold.has(id)).length;
  const jevHelp = new Set(items.filter((i) => i.cls === 'guarded' && i.kind === 'help').map((i) => i.id));
  const ruleHelp = new Set(rule.helpIds);
  const helpBoth = [...ruleHelp].filter((id) => jevHelp.has(id)).length;
  const ruleFoldsProtected = [...ruleFold]
    .map((id) => byId.get(id))
    .filter((i): i is LensItem => Boolean(i && i.decision && ['protect', 'promote', 'keep_popup'].includes(i.decision.verdict)))
    .map((i) => (i.cls === 'guarded' ? `${i.chip}: “${q(i.label)}”` : `“${q(i.label)}”`));

  const foldSame = foldBoth === ruleFold.size && foldBoth === jevFold.size;
  const helpSame = helpBoth === ruleHelp.size && helpBoth === jevHelp.size;
  const agrees = main.same && foldSame && helpSame;

  const lines: string[] = [];
  if (agrees) {
    lines.push('The plain rule agrees here.');
  } else {
    if (!main.same) {
      const r = main.rule ? `${q(main.rule.label)} (${main.rule.size})` : 'no button in the main area';
      const j = main.jev ? `${q(main.jev.label)} ${main.jev.p.toFixed(2)}` : 'no single main action (not sure enough)';
      lines.push(`Main: rule → ${r}; Jev → ${j}.`);
    } else if (main.jev) {
      lines.push(`Main: both pick ${q(main.jev.label)}.`);
    }
    lines.push(`Folded: rule ${ruleFold.size}, Jev ${jevFold.size}, both ${foldBoth}.`);
    if (!helpSame) lines.push(`Help kept in view: rule ${ruleHelp.size}, Jev ${jevHelp.size}, both ${helpBoth}.`);
    if (ruleFoldsProtected.length) {
      const k = ruleFoldsProtected.length;
      lines.push(`The rule would fold ${k} thing${k === 1 ? '' : 's'} Jev protects: ${ruleFoldsProtected.slice(0, 2).join(', ')}${k > 2 ? ` and ${k - 2} more` : ''}.`);
    }
  }
  return {
    agrees,
    main,
    folded: { rule: ruleFold.size, jev: jevFold.size, both: foldBoth },
    help: { rule: ruleHelp.size, jev: jevHelp.size, both: helpBoth },
    ruleFoldsProtected,
    lines,
  };
}

export const RULE_FOOTER = 'Three lines of code, same evidence; compares choices, not accuracy.';
