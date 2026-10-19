import { countNodes, forEachNode, type RawNode } from './raw';
import { textPatterns } from './text';

/**
 * Level of detail (docs/10 §6: at most 600 nodes, depth 24, exemplars of at
 * most 24 nodes). A collapsed node keeps its own place, kind and box and
 * summarises what it held as a text shape (characters, links); the elements
 * stay reachable through the node's own element in the registry. Collapse
 * order follows the outline's: deep, large, below the fold first; main's
 * column, search, focus and large lists last; records never.
 */

/**
 * Drop children from the end of `n` until at least `need` nodes are gone;
 * what they held is added to `n`'s text shape. Returns the nodes removed.
 */
function trim(
  n: RawNode,
  need: number,
  info: Map<RawNode, { size: number }>,
  gone: Set<RawNode>,
): number {
  let removed = 0;
  const tail: RawNode[] = [];
  while (removed < need && n.kids.length > 1) {
    const k = n.kids.pop() as RawNode;
    removed += info.get(k)?.size ?? countNodes(k);
    tail.push(k);
  }
  if (!tail.length) return 0;
  const holder: RawNode = {
    ...n,
    kids: tail,
    text: undefined,
    list: undefined,
  };
  collapse(holder);
  for (const k of tail)
    forEachNode(k, (d) => {
      gone.add(d);
    });
  const chars = (n.text?.chars ?? 0) + (holder.text?.chars ?? 0);
  const links = (n.text?.links ?? 0) + (holder.text?.links ?? 0);
  if (chars || links) n.text = links ? { chars, links } : { chars };
  return removed;
}

/** Summarise a subtree into its node: aggregate text shape, no children. */
export function collapse(n: RawNode): void {
  if (n.list) return;
  let chars = n.text?.chars ?? 0;
  let links = n.text?.links ?? 0;
  const add = (k: RawNode): void => {
    const control = k.kind === 'control';
    if (control && (k.role === 'link' || k.tag === 'a')) links++;
    chars += k.text?.chars ?? 0;
    if (!control) links += k.text?.links ?? 0;
    if (k.list) add(k.list.exemplar);
    // A control's text shape already covers its parts.
    if (control && k.text) return;
    for (const c of k.kids) add(c);
  };
  for (const k of n.kids) add(k);
  n.kids = [];
  n.collapsed = true;
  if (chars > 0 || links > 0) n.text = links > 0 ? { chars, links } : { chars };
}

/** Text shapes a record must keep: what people compare records by. */
const KEY_PATTERNS: ReadonlySet<string> = new Set([
  'price',
  'rating',
  'duration',
  'count',
  'date',
]);

/**
 * The parts of a record that must survive level of detail: headings, the
 * link with the most text (the title), the largest image or thumbnail link,
 * price, rating, duration, count and date texts, star icons named as a
 * rating, the first labelled button (its action) and selection checkboxes.
 */
export function keyParts(ex: RawNode): Set<RawNode> {
  const keep = new Set<RawNode>();
  let title: RawNode | null = null;
  let titleChars = 0;
  let media: RawNode | null = null;
  let mediaArea = 0;
  let action: RawNode | null = null;
  forEachNode(ex, (n) => {
    if (n.kind === 'heading') keep.add(n);
    if (n.text?.pat?.some((p) => KEY_PATTERNS.has(p))) keep.add(n);
    if (n.kind === 'input' && n.inputType === 'checkbox') keep.add(n);
    // Stars drawn as an icon, named by their label ("4.4 out of 5 stars").
    if (n.kind === 'control' && !n.text && n.label)
      if (textPatterns(n.label).includes('rating')) keep.add(n);
    const link = n.kind === 'control' && (n.role === 'link' || n.tag === 'a');
    if (link && !n.flags.has('icon') && !n.flags.has('imgctrl')) {
      const chars = n.text?.chars ?? 0;
      if (chars > titleChars) {
        title = n;
        titleChars = chars;
      }
    }
    if (n.kind === 'media' || n.flags.has('imgctrl')) {
      const a = n.box[2] * n.box[3];
      if (a > mediaArea) {
        media = n;
        mediaArea = a;
      }
    }
    if (
      !action &&
      n.kind === 'control' &&
      n.role === 'button' &&
      !n.flags.has('icon') &&
      (n.text?.chars ?? 0) > 0
    )
      action = n;
  });
  for (const n of [title, media, action]) if (n) keep.add(n);
  return keep;
}

/**
 * Keep an exemplar within `max` nodes without losing what identifies a
 * record (eval B3: a card whose title, price and rating were folded into
 * one summary rendered empty). In order: fold parts that hold no key part
 * (decorative wrappers, badge and icon rows, delivery notes), largest
 * first; unwrap plain groups around key parts; drop other leaves from the
 * end; cut the tail last.
 */
export function capExemplar(ex: RawNode, max: number): void {
  let total = countNodes(ex);
  if (total <= max) return;
  const keep = keyParts(ex);
  const holds = (n: RawNode): boolean => {
    let found = false;
    forEachNode(n, (d) => {
      if (keep.has(d)) found = true;
    });
    return found;
  };
  while (total > max) {
    let best: RawNode | null = null;
    let bestSize = 0;
    forEachNode(ex, (n) => {
      if (n === ex || n.kids.length === 0 || n.list || holds(n)) return;
      const s = countNodes(n);
      if (s > bestSize) {
        best = n;
        bestSize = s;
      }
    });
    if (!best || bestSize <= 1) break;
    collapse(best);
    total -= bestSize - 1;
  }
  // Plain wrappers around key parts: their children take their place.
  const unwrap = (n: RawNode): void => {
    for (let i = 0; i < n.kids.length && total > max; i++) {
      const k = n.kids[i] as RawNode;
      unwrap(k);
      if (total <= max) return;
      const plain =
        k.kind === 'group' &&
        !k.text &&
        !k.label &&
        !k.list &&
        !keep.has(k) &&
        k.kids.length > 0;
      if (!plain) continue;
      n.kids.splice(i, 1, ...k.kids);
      i += k.kids.length - 1;
      total--;
    }
  };
  if (total > max) unwrap(ex);
  // Leaves that are not key parts, from the end.
  const prune = (n: RawNode): void => {
    for (let i = n.kids.length - 1; i >= 0 && total > max; i--) {
      const k = n.kids[i] as RawNode;
      if (k.kids.length || k.list) prune(k);
      else if (!keep.has(k)) {
        n.kids.splice(i, 1);
        total--;
      }
    }
  };
  if (total > max) prune(ex);
  if (total > max) cutTail(ex, max);
}

/** Keep the first `max` nodes in document order; drop the rest. */
export function cutTail(root: RawNode, max: number): void {
  let left = max;
  const keep = (n: RawNode): boolean => {
    if (left <= 0) return false;
    if (n.list) {
      const need = 1 + countNodes(n.list.exemplar);
      if (need > left) return false;
      left -= need;
      return true;
    }
    left--;
    const kids: RawNode[] = [];
    for (const k of n.kids) {
      if (!keep(k)) break;
      kids.push(k);
    }
    if (kids.length < n.kids.length) n.kids = kids;
    return true;
  };
  keep(root);
}

/**
 * Collections too deep for their exemplar become collapsed groups, and
 * nodes at the depth limit lose their children. Returns whether anything changed.
 */
export function capDepth(root: RawNode, maxDepth: number): boolean {
  let changed = false;
  forEachNode(root, (n, _p, d) => {
    if (n.list && d >= maxDepth - 1) {
      n.list = undefined;
      n.kind = 'group';
      n.kids = [];
      n.collapsed = true;
      changed = true;
      return;
    }
    if (d >= maxDepth && n.kids.length) {
      collapse(n);
      changed = true;
    }
  });
  return changed;
}

interface Info {
  parent: RawNode | null;
  depth: number;
  size: number;
  record: boolean;
  main: boolean;
  search: boolean;
  focus: boolean;
  largeList: boolean;
}

const PASSES = [
  { minDepth: 2, minSize: 6 },
  { minDepth: 1, minSize: 3 },
  { minDepth: 1, minSize: 2 },
] as const;

/**
 * Collapse greedily until the tree has at most `max` nodes; cut the tail if
 * collapsing cannot get there. Returns whether anything was summarised.
 */
export function fitBudget(root: RawNode, max: number, vh: number): boolean {
  let total = countNodes(root);
  if (total <= max) return false;
  const info = new Map<RawNode, Info>();
  const order: RawNode[] = [];
  forEachNode(root, (n, p, d) => {
    const pi = p ? info.get(p) : undefined;
    info.set(n, {
      parent: p,
      depth: d,
      size: 1,
      record: !!pi?.record || !!n.slot || (!!p?.list && p.list.exemplar === n),
      main: n.role === 'main' || n.tag === 'main',
      search:
        n.role === 'search' ||
        n.role === 'searchbox' ||
        n.inputType === 'search',
      focus: n.flags.has('focus'),
      largeList: !!n.list && n.list.members.length > 10,
    });
    order.push(n);
  });
  // Sizes and "holds" flags, children before parents.
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i] as RawNode;
    const ni = info.get(n) as Info;
    if (!ni.parent) continue;
    const pi = info.get(ni.parent) as Info;
    pi.size += ni.size;
    pi.main ||= ni.main;
    pi.search ||= ni.search;
    pi.focus ||= ni.focus;
    pi.largeList ||= ni.largeList;
  }
  const gone = new Set<RawNode>();
  const vhs = Math.max(1, vh);
  // First fold what holds neither main, a search field nor a large list;
  // only then those, by value.
  const phases = [
    ...PASSES.map((p) => ({ ...p, precious: false })),
    ...PASSES.map((p) => ({ ...p, precious: true })),
  ];
  for (const pass of phases) {
    while (total > max) {
      let best: RawNode | null = null;
      let bestScore = -1;
      for (const n of order) {
        if (n.kids.length === 0 || n.list || n.collapsed || gone.has(n))
          continue;
        const ni = info.get(n) as Info;
        if (ni.record || ni.focus) continue;
        if (!pass.precious && (ni.main || ni.search || ni.largeList)) continue;
        if (ni.depth < pass.minDepth || ni.size < pass.minSize) continue;
        const below = Math.max(0, n.box[1] - vhs) / vhs;
        let value = 1;
        if (ni.main) value *= 5;
        if (ni.search) value *= 3;
        if (ni.largeList) value *= 3;
        const score = ((ni.size - 1) * (1 + 0.6 * below)) / value;
        if (score > bestScore) {
          best = n;
          bestScore = score;
        }
      }
      if (!best) break;
      const bi = info.get(best) as Info;
      const need = total - max;
      let saved: number;
      if (bi.size - 1 > 3 * need && best.kids.length > 8) {
        // A long flat group (an article's paragraphs): keep its head, fold its tail.
        saved = trim(best, need, info, gone);
      } else {
        saved = bi.size - 1;
        forEachNode(best, (d) => {
          if (d !== best) gone.add(d);
        });
        collapse(best);
      }
      for (let p: RawNode | null = best; p; p = info.get(p)?.parent ?? null)
        (info.get(p) as Info).size -= saved;
      total -= saved;
    }
  }
  if (total > max) cutTail(root, max);
  return true;
}
