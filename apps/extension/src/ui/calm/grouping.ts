// Owner: D (round 10). Which parts of a plan the WebAble page lays out as components, and their groups: the running
// text of reading parts (the article body, plain parts of a page); never forms, card grids, link grids, galleries,
// buy boxes, results lists, help, menus or the drawer. Purpose templates take their content out of the parts first
// (plan.ts), so what a template draws is never sent.
import type { ComposeGroupIn } from '@webable/core';
import { type Seg, groupsOf, segmentBlocks } from './compose/composeGroups';
import { type Block, type ControlBlock, TOOL_RE } from './model';
import { type CalmPlan, type PlanSection, allBlocks } from './plan';

/** A reading part's tools (Print, Share), its "On this page" links, and its body, as the Reading layout draws them. */
export function readingParts(p: PlanSection): { tools: ControlBlock[]; toc: ControlBlock[] | null; body: Block[] } {
  const tools: ControlBlock[] = [];
  let toc: ControlBlock[] | null = null;
  const body: Block[] = [];
  allBlocks(p).forEach((b, i) => {
    if (b.b === 'control' && TOOL_RE.test(b.text.trim())) {
      tools.push(b);
      return;
    }
    if (!toc && b.b === 'list' && i < 8) {
      const links = b.items.map((it) => (it.length === 1 && it[0]!.b === 'control' ? (it[0] as ControlBlock) : null));
      if (links.length >= 3 && links.every((l) => !!l && !!l.href && l.href.split('#')[0] === location.href.split('#')[0])) {
        toc = links as ControlBlock[];
        return;
      }
    }
    body.push(b);
  });
  return { tools, toc, body };
}

const NOT_TEXT_ROLES = new Set(['help', 'navigation', 'related', 'ads', 'promo', 'legal', 'consent', 'alert']);

/** Parts whose running text may be laid out: open reading or plain parts of an article or an ordinary page. */
export function composable(p: PlanSection, plan: CalmPlan): boolean {
  if (plan.kind !== 'article' && plan.kind !== 'page') return false;
  if (p.state !== 'open' || p.hoist || p.cards || p.parts || p.records) return false;
  if (plan.form?.sectionKey === p.key || NOT_TEXT_ROLES.has(p.sec.role)) return false;
  return p.layout === 'reading' || p.layout === 'as_is';
}

export interface PlanGroups {
  /** Each laid-out part's body as drawn (by PlanSection.key); parts not listed draw exactly as before. */
  segments: Map<string, Seg[]>;
  /** What to ask for, in page order (first screen first). */
  groups: ComposeGroupIn[];
}

/** The groups of a plan, in page order; the same content twice on a page is laid out once. */
export function planGroups(plan: CalmPlan | null): PlanGroups {
  const segments = new Map<string, Seg[]>();
  const groups: ComposeGroupIn[] = [];
  if (!plan) return { segments, groups };
  const seen = new Set<string>();
  for (const p of plan.main) {
    if (!composable(p, plan)) continue;
    const body = p.layout === 'reading' ? readingParts(p).body : p.blocks;
    const heading = p.title ?? (plan.lead?.from === p.key ? plan.lead.title : null);
    const segs = segmentBlocks(body, { heading, seen });
    const gs = groupsOf(segs);
    if (!gs.length) continue;
    segments.set(p.key, segs);
    groups.push(...gs);
  }
  return { segments, groups };
}
