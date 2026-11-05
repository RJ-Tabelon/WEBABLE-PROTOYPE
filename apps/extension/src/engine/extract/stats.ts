// Owner: X (round 7). Number-and-label cards ("Wins 54", "Home Record 30-6", "Prep Time: 20 mins"), grouped into grids.
//
// A card is the smallest box holding exactly one value and one label (plus an optional small line such as a date),
// with no controls. Cards are grouped by their highest common box that holds little else, so the record grid and the
// "more stats" grid on a page stay two grids, and a scoreboard or a table nearby is never swallowed.

import type { ExtractedData } from '@webable/core';
import { contains, descendants, isControl, isDateText, isImage, isLabelText, isValueText, textLeaves, textOf } from './text';
import type { ExtractItem, SNode } from './types';

export interface Card {
  root: SNode;
  label: string;
  value: string;
  sub?: string;
  valueNode: SNode;
}

export interface CardOptions {
  /** Nodes to stay out of (chrome, overlays, tables, scoreboards). */
  excluded: (n: SNode) => boolean;
}

const MAX_CLIMB = 4;

/** Every number-and-label card under `root`. */
export function findCards(root: SNode, opt: CardOptions): Card[] {
  const out: Card[] = [];
  const seenRoots = new Set<SNode>();
  for (const v of descendants(root)) {
    if (opt.excluded(v) || isImage(v) || isControl(v)) continue;
    const vt = textOf(v);
    if (!isValueText(vt)) continue;
    // The highest node that is still only the value ("<div><span>54</span></div>" -> the div).
    if (v.parent && isValueText(textOf(v.parent)) && textOf(v.parent) === vt) continue;
    const card = cardFor(v, vt, opt);
    if (!card || seenRoots.has(card.root)) continue;
    seenRoots.add(card.root);
    out.push(card);
  }
  // A box that turned out to hold two cards' roots is not a card itself.
  return out.filter((c) => !out.some((o) => o !== c && contains(c.root, o.root)));
}

function cardFor(v: SNode, vt: string, opt: CardOptions): Card | null {
  let a = v.parent;
  for (let depth = 0; a && depth < MAX_CLIMB; depth++, a = a.parent) {
    if (opt.excluded(a)) return null;
    if (a.w > 760 || a.h > 420) return null;
    const total = textOf(a);
    if (total.length > 110) return null;
    if (descendants(a).some((x) => x !== a && isControl(x))) return null;
    if (isControl(a)) return null;
    const leaves = textLeaves(a, [], (x) => x === v);
    if (!leaves.length) continue;
    if (leaves.some((l) => isValueText(textOf(l)))) return null;
    const labels = leaves.filter((l) => isLabelText(textOf(l)));
    const others = leaves.filter((l) => !labels.includes(l));
    if (others.some((o) => textOf(o).length > 60)) return null;
    if (!labels.length) continue; // only a date or a note so far: the label may be one box up
    if (labels.length > 2) return null;
    const before = labels.filter((l) => (l.i ?? 0) < (v.i ?? 0));
    const label = (before[before.length - 1] ?? labels[0]) as SNode;
    const rest = leaves.filter((l) => l !== label);
    if (rest.length > 2) return null;
    const sub = rest.map((r) => textOf(r)).filter(Boolean).join(' · ');
    const card: Card = { root: a, label: textOf(label).replace(/\s*[:：]$/, ''), value: vt, valueNode: v };
    if (sub && (rest.every((r) => isDateText(textOf(r)) || textOf(r).length <= 40))) card.sub = sub;
    else if (sub) return null;
    return card;
  }
  return null;
}

export interface StatGroup {
  root: SNode;
  cards: Card[];
  title?: string;
}

/**
 * Group cards by their highest common box that is still mostly cards (>= 80% of its text). `blocked` boxes (ones that
 * hold a scoreboard, a table or a recipe) are never a group's box.
 */
export function groupCards(cards: Card[], opt: { excluded: (n: SNode) => boolean; blocked: (n: SNode) => boolean }): StatGroup[] {
  const groups = new Map<SNode, Card[]>();
  for (const c of cards) {
    let best: SNode | null = null;
    for (let p = c.root.parent; p; p = p.parent) {
      if (opt.excluded(p) || opt.blocked(p)) break;
      const inside = cards.filter((o) => contains(p as SNode, o.root));
      const cardText = inside.reduce((s, o) => s + textOf(o.root).length, 0);
      const all = textOf(p).length || 1;
      if (cardText / all < 0.8) break;
      if (inside.length >= 2) best = p;
    }
    if (!best) continue;
    const list = groups.get(best) ?? [];
    list.push(c);
    groups.set(best, list);
  }
  // Keep the outermost box when one group's box sits inside another's.
  const roots = [...groups.keys()];
  const out: StatGroup[] = [];
  for (const r of roots) {
    if (roots.some((o) => o !== r && contains(o, r))) continue;
    const inside = cards.filter((c) => contains(r, c.root)).sort((a, b) => (a.root.i ?? 0) - (b.root.i ?? 0));
    if (inside.length < 2) continue;
    const g: StatGroup = { root: r, cards: inside };
    const title = groupTitle(r, inside);
    if (title) g.title = title;
    out.push(g);
  }
  return out.sort((a, b) => (a.root.i ?? 0) - (b.root.i ?? 0));
}

/** A short title inside the group's box, before the first card ("Season stats"). */
function groupTitle(root: SNode, cards: Card[]): string | undefined {
  const first = cards[0]?.root;
  const leaves = textLeaves(root, [], (x) => cards.some((c) => c.root === x));
  for (const l of leaves) {
    if (first && (l.i ?? 0) > (first.i ?? 0)) break;
    const t = textOf(l);
    if (t.length <= 80 && t.split(' ').length <= 12 && !isValueText(t)) return t;
  }
  return undefined;
}

/** Stats items for the page: one per group. */
export function statsItems(groups: StatGroup[]): ExtractItem[] {
  return groups.map((g) => {
    const data: ExtractedData = {
      kind: 'stats',
      items: g.cards.map((c) => (c.sub ? { label: c.label, value: c.value, sub: c.sub } : { label: c.label, value: c.value })),
    };
    if (g.title) data.title = g.title;
    return { node: g.root, data, valueNodes: g.cards.map((c) => c.valueNode) };
  });
}
