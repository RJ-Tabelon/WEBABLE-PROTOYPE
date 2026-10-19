import type { OpId } from '@webable/core/ops/catalog';
import type { PlannedOp } from '@webable/core/policy/types';

import type { PageFacts } from '../types';
import type { Box } from '../util/geometry';
import type { LayerManager, OpCss } from './layer';
import type { MarkBook } from './marks';

/** Services the in-page layer offers to ops (overlays never touch page nodes). */
export interface OverlayPort {
  setReadingGuide(on: boolean, lineHeightPx?: number): void;
  /** Freeze frames drawn over animated images; returns a disposer. */
  freezeImages(images: readonly HTMLImageElement[]): () => void;
  /** Let one frozen image play again (the person pressed on it). */
  unfreezeImage(image: HTMLImageElement): void;
}

export interface OpEnv {
  doc: Document;
  view: Window;
  facts: PageFacts;
  marks: MarkBook;
  layers: LayerManager;
  overlay: OverlayPort;
  /** Ops whose pre-paint stylesheet is active on this page. */
  prePaint: ReadonlySet<OpId>;
  /** Elements for a plan scope ('page' resolves to []). */
  resolve(scope: PlannedOp['scope']): Element[];
  /**
   * The tab's whole zoom the plan sizes for: the person's own zoom times
   * WebAble's page scale (AdaptationPlan.ownZoom x zoom, 1 = neither).
   * Levels are effective px, so text_floor aims for level / zoom CSS px and
   * target_size for its level / zoom.
   */
  zoom: number;
  /** WebAble's page scale alone (AdaptationPlan.zoom, 1 = none): what page_zoom reports. */
  scale: number;
  /**
   * Run `read` with every op's CSS removed (the site's own styles),
   * synchronously, and restore before returning. Nests.
   */
  measured<T>(read: () => T): T;
  /** Template classes `op` dropped on this page view: never marked again. */
  held(op: OpId): ReadonlySet<string>;
}

export interface Prepared {
  status: 'ready' | 'not_needed';
  css?: OpCss;
  marks?: Array<[Element, string]>;
  /** Imperative effect, run in the write phase. Returns its exact undo. */
  run?: () => RunHandle | (() => void);
  /** Elements affected (fit-mark count). */
  count: number;
  fit?: { before: string; after: string };
  /** Elements "Show on page" outlines, most important first. */
  show?: Element[];
  /** Adapted bounds for an element when they differ from its box (hit areas). */
  fitBox?: (el: Element, box: Box) => Box;
  /** Why the op did nothing, for logs and tests. */
  reason?: string;
  /**
   * Elements this prepare measured, marked or not. At write time their stale
   * tokens are dropped; tokens elsewhere (content that arrived after the
   * extraction) are kept. Default: the extraction's text.
   */
  covers?: (el: Element) => boolean;
  /**
   * Template class of a marked element. Ops that decide per class roll back
   * per class too: every instance together, never one element at a time.
   */
  classOf?: (el: Element) => string | null;
  /** Whether a failing class may be dropped on its own, keeping the rest of the op. */
  droppable?: (cls: string) => boolean;
}

/** What an imperative op leaves behind: its undo, and how to treat new content. */
export interface RunHandle {
  undo(): void;
  /** Motion this handle paused, which remains a reason to keep the op active. */
  heldMotion?(): { running?: number; autoplayMedia?: number };
  /** Called with subtrees the page inserted after apply (MutationObserver path). */
  onAdded?(roots: readonly Element[]): void;
}

export interface AppliedOp {
  op: OpId;
  level: number;
  value: number;
  planned: PlannedOp;
  prepared: Prepared;
  handle: RunHandle | null;
  /** Document-coordinate rects before the write, for ghost outlines. */
  before: Map<Element, Box>;
  appliedAt: number;
  /** The tab's zoom it was prepared under (OpEnv.zoom). */
  zoom: number;
}

export interface OpImpl {
  readonly id: OpId;
  /** Read phase: measure and decide; must not write to the page. */
  prepare(env: OpEnv, value: number, scope: PlannedOp['scope']): Prepared;
  /**
   * After the batch has settled and passed verification: measure real values,
   * drop marks that had no effect. May mutate `applied.prepared.fit/count`.
   */
  afterApply?(env: OpEnv, applied: AppliedOp): void;
  /** Marks for subtrees inserted after apply (MutationObserver path). */
  incremental?(
    env: OpEnv,
    applied: AppliedOp,
    roots: readonly Element[],
  ): Array<[Element, string]>;
  /**
   * Like `incremental`, but the complete set of this op's tokens for every
   * element examined (empty: none), so restyled content never keeps a stale
   * value. May replace `applied.prepared.css` when new content needs a rule
   * the block lacks; the engine re-installs the block.
   */
  retoken?(
    env: OpEnv,
    applied: AppliedOp,
    roots: readonly Element[],
  ): Array<[Element, string[]]>;
}

export const notNeeded = (reason: string): Prepared => ({
  status: 'not_needed',
  count: 0,
  reason,
});
