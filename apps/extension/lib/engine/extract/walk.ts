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

type Visible = (el: Element) => boolean;

const checkVisible: Visible = (el) => {
  const e = el as Element & {
    checkVisibility?: (o?: Record<string, boolean>) => boolean;
  };
  return typeof e.checkVisibility === 'function'
    ? e.checkVisibility({ contentVisibilityAuto: true })
    : true;
};

/**
 * One budgeted walk over rendered elements (engine.md 2.2). Hidden subtrees
 * are rejected wholesale; display:contents is skipped but its children kept.
 * Each visited element costs one computed-style read. Shadow roots are
 * collected and walked after the scope that hosts them.
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
      const el = n as Element;
      if (SKIP_TAGS.has(el.localName)) return NodeFilter.FILTER_REJECT;
      if (!checkVisible(el)) {
        return view.getComputedStyle(el).display === 'contents'
          ? NodeFilter.FILTER_SKIP
          : NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const queue: ShadowRoot[] = [];
  if (
    start instanceof Element &&
    start.localName !== HOST_TAG &&
    !SKIP_TAGS.has(start.localName)
  ) {
    visit(start, view.getComputedStyle(start));
    stats.nodes++;
  }
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const el = n as Element;
    visit(el, view.getComputedStyle(el));
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
  }
  for (const sr of queue) {
    stats.shadowRoots.push(sr);
    if (stats.truncated) continue;
    await walk(sr, visit, budget, opts, stats);
  }
  return stats;
}
