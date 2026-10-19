import type { SkeletonNode } from '@webable/core';

import { subtreeIds, type SkelIndex } from './components';
import type { ListView } from './records';
import type { SkeletonRegistry } from './types';

/**
 * Conservation (docs/10 §4.7): before the view is shown, every visible
 * original control and text block must be in the view, or one click away in
 * "Everything else on this page". Records are counted by key across the
 * session, so a list that re-renders under the view keeps every record it
 * has shown.
 *
 * Nothing on the page may become unreachable: what fails the check is added
 * to "Everything else" (and reported as a defect), never dropped. A record is
 * covered only when it shows its title, opener or text: a record the
 * template could not fill falls back to its own text (records.ts), and one
 * that still shows nothing is a conservation failure.
 */

/** What a person can read or act on. Images are illustrations, not content. */
const CONSERVED: ReadonlySet<SkeletonNode['kind']> = new Set([
  'heading',
  'control',
  'input',
  'text',
  'stext',
  'table',
  'collection',
]);

export interface ListCount {
  listId: string;
  /** Members on the page now. */
  members: number;
  /**
   * Members the view shows with something to read or open, holds in a
   * spacer or behind "Show n more", or offers on the page.
   */
  covered: number;
  /** Members rendered with nothing in them (no title, no text). */
  empty: number;
}

export interface ConservationReport {
  ok: boolean;
  /** Highest content node ids that are neither in the view nor reachable. */
  missing: string[];
  /** Content nodes checked. */
  checked: number;
  lists: ListCount[];
}

export function checkConservation(input: {
  index: SkelIndex;
  registry: SkeletonRegistry;
  emitted: ReadonlySet<string>;
  reached: ReadonlySet<string>;
  /** Not visible on the page (clipped away, screen-reader-only): never shown. */
  hidden: ReadonlySet<string>;
  rest: readonly string[];
  lists: ReadonlyMap<string, ListView>;
}): ConservationReport {
  const { index, emitted, reached } = input;
  const inRest = new Set<string>();
  for (const id of input.rest)
    for (const s of subtreeIds(index, id)) inRest.add(s);
  const missingAll = new Set<string>();
  let checked = 0;
  for (const [id, node] of index.nodes) {
    if (node.slot || index.slotList.has(id)) continue;
    if (!CONSERVED.has(node.kind)) continue;
    checked++;
    if (
      emitted.has(id) ||
      reached.has(id) ||
      inRest.has(id) ||
      input.hidden.has(id)
    )
      continue;
    missingAll.add(id);
  }
  // Report (and re-home) only the highest missing nodes: a missing group's
  // children travel with it.
  const missing: string[] = [];
  for (const id of missingAll) {
    let covered = false;
    for (
      let p = index.nodes.get(id)?.parent ?? null;
      p;
      p = index.nodes.get(p)?.parent ?? null
    ) {
      if (missingAll.has(p)) {
        covered = true;
        break;
      }
    }
    if (!covered) missing.push(id);
  }
  missing.sort((a, b) => (index.order.get(a) ?? 0) - (index.order.get(b) ?? 0));
  const lists: ListCount[] = [];
  let listsOk = true;
  for (const [listId, lv] of input.lists) {
    const members = input.registry.members(listId);
    let covered = 0;
    const seen = new Map<string, number>();
    for (const m of members.slice(0, lv.order.length + lv.overflow + 50)) {
      const k = input.registry.recordKey(listId, m) || 'r';
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      const key = n > 1 ? `${k}#${n}` : k;
      // A record counts only when it showed something to read or open
      // (its title, opener or text), never for its key alone.
      if (lv.seen.has(key) && !lv.empty.has(key)) covered++;
    }
    covered += lv.overflow;
    lists.push({
      listId,
      members: members.length,
      covered,
      empty: lv.empty.size,
    });
    if (covered < members.length) listsOk = false;
  }
  return {
    ok: missing.length === 0 && listsOk,
    missing,
    checked,
    lists,
  };
}
