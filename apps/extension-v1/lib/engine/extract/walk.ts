import { HOST_TAG, SKIP_TAGS, type TreeScope } from '../util/dom';
import type { Budget } from '../util/schedule';

export interface WalkStats {
  nodes: number;
  truncated: boolean;
  shadowRoots: ShadowRoot[];
}

export interface WalkOptions {
  maxNodes: number;
  /** Returns a closed shadow root when the platform allows (chrome.dom). */
  openClosed?: (el: Element) => ShadowRoot | null;
}

/**
 * One budgeted walk over rendered elements (engine.md 2.2). Hidden subtrees
 * are rejected wholesale; display:contents is skipped but its children kept.
 * Each visited element costs one computed-style read, which also decides
 * whether its subtree renders: display:none rejects it, content-visibility
 * hidden keeps the element and skips what it hides, and an auto subtree
 * the browser skips (off screen) is skipped too. No checkVisibility per node
 * (eval M9: it cost 2.5 ms on 6,000 nodes). Shadow roots are collected and
 * walked after the scope that hosts them.
 */
export async function walk(
  root: TreeScope,
  visit: (el: Element, cs: CSSStyleDeclaration) => void,
  budget: Budget,
  opts: WalkOptions,
  stats: WalkStats = { nodes: 0, truncated: false, shadowRoots: [] },
): Promise<WalkStats> {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const view = doc.defaultView;
  if (!view) return stats;
  const start: Node =
    root instanceof Document ? (root.body ?? root.documentElement) : root;
  const tw = doc.createTreeWalker(start, NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      return SKIP_TAGS.has((n as Element).localName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  /** The next node after the current one's subtree (null at the end). */
  const pastSubtree = (): Node | null => {
    for (;;) {
      const next = tw.nextSibling();
      if (next) return next;
      if (!tw.parentNode()) return null;
    }
  };
  const queue: ShadowRoot[] = [];
  if (
    start instanceof Element &&
    start.localName !== HOST_TAG &&
    !SKIP_TAGS.has(start.localName)
  ) {
    visit(start, view.getComputedStyle(start));
    stats.nodes++;
  }
  let n = tw.nextNode();
  while (n) {
    const el = n as Element;
    const cs = view.getComputedStyle(el);
    const display = cs.display;
    if (display === 'none') {
      n = pastSubtree();
      continue;
    }
    if (display === 'contents') {
      n = tw.nextNode();
      continue;
    }
    visit(el, cs);
    const sr = (el as HTMLElement).shadowRoot ?? opts.openClosed?.(el) ?? null;
    if (sr) queue.push(sr);
    if (++stats.nodes >= opts.maxNodes) {
      stats.truncated = true;
      break;
    }
    if ((stats.nodes & 31) === 0 && !(await budget.tick())) {
      stats.truncated = true;
      break;
    }
    const cv = cs.contentVisibility;
    if (cv === 'hidden' || (cv === 'auto' && skipsContent(el))) {
      tw.currentNode = el;
      n = pastSubtree();
      continue;
    }
    n = tw.nextNode();
  }
  for (const sr of queue) {
    stats.shadowRoots.push(sr);
    if (stats.truncated) continue;
    await walk(sr, visit, budget, opts, stats);
  }
  return stats;
}

/** A content-visibility:auto box whose contents the browser skips (off screen). */
function skipsContent(el: Element): boolean {
  const first = el.firstElementChild as
    | (Element & {
        checkVisibility?: (o?: Record<string, boolean>) => boolean;
      })
    | null;
  if (!first || typeof first.checkVisibility !== 'function') return false;
  return !first.checkVisibility({ contentVisibilityAuto: true });
}
