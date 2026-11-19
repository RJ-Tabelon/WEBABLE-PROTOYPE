import type { SKELETON_VERSION } from '../versions';
import type {
  SkelFlag,
  SkelHrefKind,
  SkelInputType,
  SkelKind,
  SkelPattern,
  SkelRole,
  SkelTag,
} from './constants';

/**
 * The page skeleton (docs/10 §4): the structure Fit view is planned from.
 *
 * Built by the content script (`lib/engine/skeleton`), read by the service
 * worker on this device. `label` holds page words and therefore never leaves
 * the device as is: the wire form (`skeleton/wire.ts`) keeps at most six
 * public-vocabulary words per label, and none inside records.
 *
 * Ids are assigned in document order per extraction (`e1`, `e2`, ...). They are
 * meaningful only together with the content script's registry for the same
 * extraction (`Skeleton.extractionId`). Anything cached across page views is
 * stored as locators instead (`skeleton/locate.ts`).
 */
export interface SkeletonNode {
  /** `e<n>`, unique within one extraction. */
  id: string;
  /** Nearest kept ancestor, or null for the root. */
  parent: string | null;
  depth: number;
  tag: SkelTag;
  role: SkelRole | null;
  kind: SkelKind;
  /** Document coordinates in CSS px at the zoom the page was read at: [x, y, w, h]. */
  box: [number, number, number, number];
  /** Computed font size in CSS px (text-bearing kinds). */
  fontPx?: number;
  /** Computed font weight (text-bearing kinds). */
  weight?: number;
  /** Heading level 1-6. */
  level?: number;
  flags: SkelFlag[];
  inputType?: SkelInputType;
  /** <select> option count. */
  options?: number;
  /**
   * LOCAL ONLY. Accessible name for controls and inputs, visible text for
   * headings and short texts, alt text for media. At most 80 characters.
   */
  label?: string;
  /** Shape of the node's own text: length, pattern tags, inline link count. */
  text?: { chars: number; pat?: SkelPattern[]; links?: number };
  /** For links: where the link goes relative to the tab's site. */
  href?: SkelHrefKind;
  /**
   * LOCAL ONLY. The link goes to a well-known identity provider's sign-in
   * page (accounts.google.com...). Never on the wire; the validator lets
   * such a link into the account slot.
   */
  idp?: true;
  /** For kind 'collection': the run of similar items. */
  collection?: {
    count: number;
    itemTag: SkelTag;
    /** Id of the exemplar item's root node (its subtree follows this node). */
    exemplar: string;
  };
  /** Inside a collection's exemplar subtree: the node is a slot every item has. */
  slot?: true;
  /** The v1 region component key when the node is a region root (joins Jev and rule verdicts). */
  ck?: string;
}

export interface Skeleton {
  v: 1;
  version: typeof SKELETON_VERSION;
  /** Matches the content script's registry; replies naming another extraction are stale. */
  extractionId: string;
  viewport: { width: number; height: number; zoom: number };
  doc: { width: number; height: number };
  /** BCP 47 primary subtag of the page language ('' when unknown). */
  lang: string;
  /** Document order; exemplar subtrees follow their collection node and are marked `slot`. */
  nodes: SkeletonNode[];
  /** The node budget was hit; the tail of the page was summarised. */
  truncated: boolean;
  /**
   * Structure hash: tags, roles, kinds, depths and collection exemplars, with
   * labels, counts, boxes and volatile nodes (ads, consent) left out, so one
   * site template hashes the same across loads.
   */
  structure: string;
  /** Tokens typed into inputs or present in the URL query, stripped from wire labels. LOCAL ONLY. */
  typed: string[];
  perf: { ms: number; nodes: number };
}

/**
 * A structural address for a node that survives across page views (cache).
 * Stored instead of ids; the content script resolves it against a fresh
 * skeleton (`core/skeleton/locate.ts`).
 */
export interface Locator {
  /** Steps from the root: `tag[role]` plus an index among same-signature siblings when ambiguous. */
  path: string[];
  kind: SkelKind;
  /** HMAC of the label (never the label), when the node has one. */
  name?: string;
  /** Inside a collection exemplar: the slot's path relative to the item root. */
  slot?: string[];
}
