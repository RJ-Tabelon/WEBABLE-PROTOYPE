// Owner: X (round 7). Recipes: schema.org Recipe JSON-LD first (title, times, ingredients, steps), matched to the page to
// find where the recipe sits; the page alone when there is no JSON-LD.

import type { ExtractedData } from '@webable/core';
import { findLd, recipeFromLd, type Ld } from './jsonld';
import { area, collapse, descendants, isHeading, lca, similar, textLeaves, textOf } from './text';
import type { ExtractItem, SNode } from './types';

type Recipe = Extract<ExtractedData, { kind: 'recipe' }>;

function isList(n: SNode): boolean {
  return n.tag === 'ul' || n.tag === 'ol' || n.role === 'list';
}

function itemsOf(list: SNode): SNode[] {
  return list.kids.filter((k) => (k.tag === 'li' || k.role === 'listitem') && textOf(k));
}

/** How well a list's items match a list of strings (share of the first strings found in the list), 0..1. */
function listMatch(list: SNode, want: string[]): number {
  const items = itemsOf(list).map(textOf);
  if (!items.length || !want.length) return 0;
  const probe = want.slice(0, 8);
  let hit = 0;
  for (const w of probe) if (items.some((t) => t.includes(w) || w.includes(t) || similar(w, t) >= 0.6)) hit++;
  return hit / probe.length;
}

/** The block (list, or paragraphs' common box) that holds the steps. */
function stepsBlock(nodes: SNode[], steps: string[]): SNode | null {
  let best: SNode | null = null;
  let bestScore = 0;
  for (const n of nodes) {
    if (!isList(n)) continue;
    const s = listMatch(n, steps);
    if (s > bestScore) {
      best = n;
      bestScore = s;
    }
  }
  if (best && bestScore >= 0.5) return best;
  // Paragraphs: the common box of the first and last matched step.
  const probe = steps.slice(0, 6);
  const hits = nodes.filter((n) => (n.tag === 'p' || n.tag === 'li' || n.tag === 'div') && !n.kids.some((k) => textOf(k).length > 40) && probe.some((s) => similar(s, textOf(n)) >= 0.7));
  if (hits.length >= 2) return lca(hits[0] as SNode, hits[hits.length - 1] as SNode);
  return null;
}

const NOTES_HEAD = /^(tips?|notes?|cook['’]?s notes?|chef['’]?s notes?|editor['’]?s notes?|recipe (tips|notes)|variations?|storage)$/i;

/** Short notes after a "Tips" or "Notes" heading inside the recipe's box. */
function notesIn(root: SNode): string[] {
  const all = descendants(root);
  const head = all.find((n) => (isHeading(n) || n.fw >= 600) && NOTES_HEAD.test(textOf(n).replace(/[:：]$/, '')));
  if (!head || !head.parent) return [];
  const sibs = head.parent.kids;
  const out: string[] = [];
  for (const s of sibs.slice(sibs.indexOf(head) + 1)) {
    if (isHeading(s)) break;
    for (const l of textLeaves(s)) {
      const t = textOf(l);
      if (t.length >= 20) out.push(t.slice(0, 600));
      if (out.length >= 6) return out;
    }
  }
  return out;
}

/** The recipe on the page, and the box it sits in. */
export function findRecipe(root: SNode, ld: Ld[], excluded: (n: SNode) => boolean): ExtractItem | null {
  const nodes = descendants(root).filter((n) => !excluded(n));
  const o = findLd(ld, ['Recipe']);
  const fromLd = o ? recipeFromLd(o) : null;
  if (fromLd) {
    let ingr: SNode | null = null;
    let best = 0;
    for (const n of nodes) {
      if (!isList(n)) continue;
      const s = listMatch(n, fromLd.ingredients);
      if (s > best) {
        best = s;
        ingr = n;
      }
    }
    if (best < 0.5) ingr = null;
    const steps = stepsBlock(nodes, fromLd.steps);
    let box: SNode | null = ingr && steps ? lca(ingr, steps) : ingr ?? steps;
    if (box && area(box) > 0.85 * area(root)) box = ingr?.parent ?? steps?.parent ?? null;
    // Ingredient lists are often wrapped with their heading: take the wrapper when it holds little else.
    if (box && box === ingr && box.parent && textOf(box.parent).length < textOf(box).length + 200) box = box.parent;
    if (!box) return null;
    // The page's own ingredient lines read better ("½ teaspoon salt", not "0.5 teaspoon salt") when they match well.
    const pageLines = ingr ? itemsOf(ingr).map(textOf) : [];
    const usePage = best >= 0.75 && pageLines.length >= 2 && Math.abs(pageLines.length - fromLd.ingredients.length) <= 1;
    const ingredients = usePage ? pageLines.slice(0, 80) : fromLd.ingredients;
    const data: Recipe = { kind: 'recipe', title: fromLd.title, ingredients, steps: fromLd.steps };
    if (fromLd.meta.length) data.meta = fromLd.meta;
    if (fromLd.imageSrc) data.imageSrc = fromLd.imageSrc;
    const notes = notesIn(box);
    if (notes.length) data.notes = notes;
    return { node: box, data };
  }
  return recipeFromPage(nodes);
}

const INGR_HEAD = /\bingredients?\b/i;
const STEPS_HEAD = /\b(directions?|instructions?|method|preparation|steps|how to make( it)?)\b/i;

/** No JSON-LD: an "Ingredients" heading with a list after it, and a "Directions" heading with steps after it. */
function recipeFromPage(nodes: SNode[]): ExtractItem | null {
  const heads = nodes.filter((n) => isHeading(n) && textOf(n).split(' ').length <= 6);
  const ingrHead = heads.find((h) => INGR_HEAD.test(textOf(h)));
  const stepsHead = heads.find((h) => STEPS_HEAD.test(textOf(h)) && h !== ingrHead);
  if (!ingrHead || !stepsHead) return null;
  const after = (h: SNode, pred: (n: SNode) => boolean) => nodes.find((n) => (n.i ?? 0) > (h.i ?? 0) && pred(n));
  const ingrList = after(ingrHead, (n) => isList(n) && itemsOf(n).length >= 2);
  if (!ingrList) return null;
  const stepList = after(stepsHead, (n) => isList(n) && itemsOf(n).length >= 1);
  let steps: string[] = [];
  if (stepList) steps = itemsOf(stepList).map(textOf);
  else {
    const paras = nodes.filter((n) => n.tag === 'p' && (n.i ?? 0) > (stepsHead.i ?? 0) && textOf(n).length >= 25).slice(0, 20);
    steps = paras.map(textOf);
  }
  if (!steps.length) return null;
  const ingredients = itemsOf(ingrList).map(textOf).slice(0, 80);
  const box = lca(ingrHead, stepList ?? stepsHead) ?? ingrList.parent;
  if (!box) return null;
  const h1 = nodes.find((n) => n.tag === 'h1');
  const title = collapse(h1 ? textOf(h1) : textOf(ingrHead).replace(INGR_HEAD, '')) || 'Recipe';
  const data: Recipe = { kind: 'recipe', title, ingredients, steps: steps.slice(0, 60) };
  const notes = notesIn(box);
  if (notes.length) data.notes = notes;
  return { node: box, data };
}
