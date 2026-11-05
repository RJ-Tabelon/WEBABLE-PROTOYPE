// Owner: X (round 7). Reading structured content on the device: one pass over the reader's tree.
//
// Order matters: scoreboards first (their line-score table is theirs), then data tables and schedules, the recipe,
// number-and-label grids (never across a scoreboard, table or recipe), logos, the article, and last the regions (which
// keep every data box whole).

import type { ExtractedData } from '@webable/core';
import { findArticle } from './article';
import { parseLd } from './jsonld';
import { findContentLogos, findSiteLogo } from './logos';
import { findRecipe } from './recipe';
import { chromeOf, describeRegion, findRegions } from './regions';
import { findScoreboards } from './scoreboard';
import { findCards, groupCards, statsItems } from './stats';
import { findScheduleCards, readTable, tableItem } from './table';
import { contains, link } from './text';
import type { ExtractInput, ExtractItem, PageExtract, SNode } from './types';

export type { ArticleMeta, ExtractInput, ExtractItem, PageExtract, SNode } from './types';
export { stripLocalData, stripOutlineData } from './strip';

const KIND_RANK: Record<ExtractedData['kind'], number> = { recipe: 0, scoreboard: 1, stats: 2, schedule: 3, table: 4, logo: 5 };

export function extractPage(input: ExtractInput): PageExtract {
  const nodes = link(input.root);
  const chrome = chromeOf(nodes, input.main, input.root.h);
  const memo = new Map<SNode, boolean>();
  const outside = (n: SNode): boolean => {
    const have = memo.get(n);
    if (have !== undefined) return have;
    const v = chrome.has(n) || n.fixed === true || (n.parent ? outside(n.parent) : false);
    memo.set(n, v);
    return v;
  };
  const ld = parseLd(input.ld);
  const items: ExtractItem[] = [];

  const boards = findScoreboards(input.root, { excluded: outside });
  items.push(...boards);
  const inBoard = (n: SNode) => boards.some((b) => contains(b.node, n));

  for (const t of nodes) {
    if (t.tag !== 'table' && t.role !== 'table' && t.role !== 'grid') continue;
    if (outside(t) || inBoard(t)) continue;
    if (items.some((it) => (it.data.kind === 'table' || it.data.kind === 'schedule') && contains(it.node, t))) continue;
    const read = readTable(t);
    if (!read) continue;
    items.push({ node: t, data: tableItem(read), rowNodes: read.rowNodes });
  }
  for (const s of findScheduleCards(input.root, (n) => outside(n) || inBoard(n))) {
    if (items.some((it) => contains(it.node, s.node) || contains(s.node, it.node))) continue;
    items.push({ node: s.node, data: s.data, rowNodes: s.rows });
  }

  const recipe = findRecipe(input.root, ld, outside);
  if (recipe) items.push(recipe);

  const dataBoxes = () => items.map((it) => it.node);
  const inTable = (n: SNode) => {
    for (let p: SNode | null | undefined = n; p; p = p.parent) if (p.tag === 'table' || p.role === 'table' || p.role === 'grid') return true;
    return false;
  };
  const statsExcluded = (n: SNode) => outside(n) || inTable(n) || dataBoxes().some((b) => contains(b, n));
  const cards = findCards(input.root, { excluded: statsExcluded });
  const groups = groupCards(cards, { excluded: statsExcluded, blocked: (n) => dataBoxes().some((b) => contains(n, b)) });
  items.push(...statsItems(groups));

  // Logos: the site's mark, the scoreboard's team logos (named from the scoreboard), and named logos in the content.
  const site = findSiteLogo(input.root, input.url, input.siteName);
  if (site) items.push({ node: site.holder, data: { kind: 'logo', src: site.mark.attrs?.src ?? '', label: site.label }, mark: site.mark });
  const logoNodes = new Set<SNode>();
  for (const b of boards) {
    if (b.data.kind !== 'scoreboard') continue;
    b.logoNodes?.forEach((l, i) => {
      const side = b.data.kind === 'scoreboard' ? b.data.sides[i] : undefined;
      if (!l || !side) return;
      logoNodes.add(l);
      items.push({ node: l, data: { kind: 'logo', src: l.attrs?.src ?? '', label: side.name || side.logoAlt || '' }, mark: l });
    });
  }
  for (const l of findContentLogos(input.root, outside)) {
    if (logoNodes.has(l.node)) continue;
    items.push({ node: l.node, data: { kind: 'logo', src: l.node.attrs?.src ?? '', label: l.label }, mark: l.node });
  }

  // One item per box; the more specific kind wins.
  items.sort((a, b) => KIND_RANK[a.data.kind] - KIND_RANK[b.data.kind]);
  const byNode = new Map<SNode, ExtractItem>();
  for (const it of items) if (!byNode.has(it.node)) byNode.set(it.node, it);
  const unique = [...byNode.values()].sort((a, b) => (a.node.i ?? 0) - (b.node.i ?? 0));

  const article = findArticle(input.root, ld, outside);

  const units = new Set(unique.filter((it) => it.data.kind !== 'logo').map((it) => it.node));
  if (article?.body) units.add(article.body);
  const dashboard = new Set(unique.filter((it) => it.data.kind === 'stats' || it.data.kind === 'scoreboard').map((it) => it.node));
  const regions = findRegions(input.root, { excluded: outside, units, dashboard });
  const regionNotes = new Map<SNode, string>();
  for (const r of regions) {
    const inside = unique
      .filter((it) => it.data.kind !== 'logo' && contains(r, it.node))
      .map((it) => ({ node: it.node, kind: kindPhrase(it.data), size: sizePhrase(it.data) }));
    const note = describeRegion(r, inside);
    if (note) regionNotes.set(r, note);
  }
  return { items: unique, regions, regionNotes, article, siteLogo: site?.holder ?? null };
}

function kindPhrase(d: ExtractedData): string {
  switch (d.kind) {
    case 'stats':
      return 'number cards';
    case 'scoreboard':
      return `scoreboard with ${d.sides.filter((s) => s.logoSrc).length} team logos${d.periods ? ' and a line score' : ''}`;
    case 'table':
      return 'data table';
    case 'schedule':
      return 'schedule rows';
    case 'recipe':
      return 'recipe';
    case 'logo':
      return 'logo';
  }
}

function sizePhrase(d: ExtractedData): string | undefined {
  switch (d.kind) {
    case 'stats':
      return `x${d.items.length}`;
    case 'table':
      return `${d.rows.length} rows x ${d.columns.length} columns`;
    case 'schedule':
      return `x${d.items.length}`;
    case 'recipe':
      return `(${d.ingredients.length} ingredients, ${d.steps.length} steps)`;
    default:
      return undefined;
  }
}
