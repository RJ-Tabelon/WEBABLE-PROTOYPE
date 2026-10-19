import type {
  SkelFlag,
  SkelHrefKind,
  SkelInputType,
  SkelKind,
  SkelPattern,
  SkelRole,
  SkelTag,
} from '@webable/core/skeleton/constants';

import type { MemberSig } from './collections';

/**
 * The skeleton while it is being built: a tree of kept nodes that still
 * hold their elements. Level of detail, the structure hash and id assignment
 * run on this tree; the flat SkeletonNode list is emitted from it last.
 */

export type Box = [number, number, number, number];

export interface RawList {
  /** Parent of the members (the element the run was found in). */
  container: Element;
  /** Visible members at read time. */
  members: Element[];
  /** Member template, for re-querying members live. */
  sig: MemberSig;
  /** The exemplar member's subtree (every node a slot). */
  exemplar: RawNode;
  /** The member element the exemplar was built from (slot paths start here). */
  exemplarEl: Element;
  itemTag: SkelTag;
}

export interface RawNode {
  el: Element;
  tag: SkelTag;
  role: SkelRole | null;
  kind: SkelKind;
  /** Document coordinates, CSS px: [x, y, w, h]. */
  box: Box;
  fontPx?: number;
  weight?: number;
  level?: number;
  flags: Set<SkelFlag>;
  inputType?: SkelInputType;
  options?: number;
  /** LOCAL ONLY page words, at most 80 characters. */
  label?: string;
  text?: { chars: number; pat?: SkelPattern[]; links?: number };
  href?: SkelHrefKind;
  /** LOCAL ONLY: the link goes to a well-known identity provider's sign-in page. */
  idp?: boolean;
  kids: RawNode[];
  list?: RawList;
  ck?: string;
  /** Drawn but aria-hidden (often a decorative copy of a control's label). */
  ariaHidden?: boolean;
  /** Its subtree was summarised into its text shape (level of detail). */
  collapsed?: boolean;
  /** Inside a collection's exemplar subtree. */
  slot?: boolean;
}

/** Nodes in a subtree, counting each collection's exemplar subtree. */
export function countNodes(n: RawNode): number {
  let c = 1;
  if (n.list) c += countNodes(n.list.exemplar);
  for (const k of n.kids) c += countNodes(k);
  return c;
}

/** Visit every node (exemplars right after their collection), parents first. */
export function forEachNode(
  root: RawNode,
  fn: (n: RawNode, parent: RawNode | null, depth: number) => void,
): void {
  const walk = (n: RawNode, p: RawNode | null, d: number): void => {
    fn(n, p, d);
    if (n.list) walk(n.list.exemplar, n, d + 1);
    for (const k of n.kids) walk(k, n, d + 1);
  };
  walk(root, null, 0);
}
