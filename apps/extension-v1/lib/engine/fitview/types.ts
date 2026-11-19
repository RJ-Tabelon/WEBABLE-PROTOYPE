import type { FitLayout, Locator, Skeleton, SpecEnvelope } from '@webable/core';

import type {
  ContentReplies,
  ContentToWorker,
  FitViewOpenReply,
  FitViewOpenReason,
} from '../../protocol';

/**
 * Seams between the three in-page parts of Fit view (docs/10 §4):
 *
 *   engine/skeleton   reads the page: Skeleton + SkeletonRegistry          (WP3)
 *   engine/fitview    renders the view: host, sections, components, styles (WP5)
 *   engine/fitview    keeps it working: proxies, sync, peek, status,
 *                     input firewall                                       (WP6)
 *
 * The engine content script (engine.js, every page) owns reading and
 * messaging. The Fit view script (fitview.js) is injected by the worker the
 * first time Fit view opens in a document, runs in the same isolated world,
 * and finds the engine through a global symbol. Neither side imports the
 * other's modules at runtime; they meet only through these interfaces.
 */

/** globalThis[ENGINE_API_KEY] -> EngineApi, set by the engine content script. */
export const ENGINE_API_KEY = Symbol.for('webable.engine.api');
/** globalThis[FITVIEW_RUNTIME_KEY] -> FitViewRuntime, set by fitview.js. */
export const FITVIEW_RUNTIME_KEY = Symbol.for('webable.fitview.runtime');
/** globalThis[FIREWALL_KEY] -> FirewallTarget, set by the Fit view host while it is mounted. */
export const FIREWALL_KEY = Symbol.for('webable.fitview.firewall');

// ---------------------------------------------------------------------------
// Reading (WP3 provides, WP5/WP6 consume)
// ---------------------------------------------------------------------------

export interface MediaInfo {
  /** http(s), data: or blob: URL; null while not loaded yet (lazy). */
  src: string | null;
  srcset: string | null;
  width: number;
  height: number;
  /** Visible alt text (may be ''). */
  alt: string;
}

/**
 * Live access to the elements behind one skeleton extraction. Every read is
 * live (re-queried), never a snapshot, so re-renders and virtualized lists
 * are handled by asking again.
 */
export interface SkeletonRegistry {
  readonly extractionId: string;
  /** The element behind a node id, or null if it left the document. */
  element(id: string): Element | null;
  /** A collection's current item roots, in document order. */
  members(listId: string): Element[];
  /** The element in `member` that plays the exemplar slot `slotId`, or null. */
  slot(listId: string, member: Element, slotId: string): Element | null;
  /**
   * Visible text: rendered, not clipped away, not screen-reader-only, with
   * whitespace normalised. Never text a paywall or consent wall withholds.
   */
  text(el: Element): string;
  /** Accessible name of a control (aria-labelledby, aria-label, content, title, alt). */
  name(el: Element): string;
  /** Image or video poster behind a media-like element (img, picture, video, background-image box). */
  media(el: Element): MediaInfo;
  /** Absolute http(s)/mailto/tel href of a link, or null (javascript: and others are never exposed). */
  href(el: Element): string | null;
  /**
   * A stable key for a record: an id attribute, an item id in its href, or a
   * hash of its slot texts. Never its index.
   */
  recordKey(listId: string, member: Element): string;
  /** Hash of the record's visible slot texts; proxies compare it before acting. */
  fingerprint(listId: string, member: Element): string;
  /**
   * The record is an ad (sponsored or promoted marking, ad attributes), by
   * the same rules as the skeleton's `adhint` flag. Fit view folds ads into
   * one quiet line instead of letting them lead the list.
   */
  isAd?(listId: string, member: Element): boolean;
  /** Structural locator for a node (stored by proxies to re-find it after re-renders). */
  locator(id: string): Locator;
  /** Re-find a locator, searching only inside `within` when given. Exactly one match or null. */
  resolve(locator: Locator, within?: Element | null): Element | null;
}

/** What the engine content script offers fitview.js. */
export interface EngineApi {
  /**
   * Read a fresh skeleton: measure mode (WebAble's op CSS removed), at the
   * current zoom, viewport-first, budgeted. Resolves null on pages that must
   * not be read (password or payment fields present).
   */
  skeleton(): Promise<{
    skeleton: Skeleton;
    registry: SkeletonRegistry;
  } | null>;
  /** Freeze Tailor while Fit view is open: no replans, incremental marks or verification. */
  freeze(on: boolean): void;
  /** Send a message to the service worker. */
  send<T extends ContentToWorker>(msg: T): Promise<ContentReplies[T['type']]>;
  /** Route changes (SPA, Gmail-style hash routes), already debounced. Returns an unsubscribe. */
  onRoute(cb: () => void): () => void;
  /** Run `fn` with the engine's measure mode on (op CSS removed), restoring it after. */
  measured<T>(fn: () => T): T;
}

// ---------------------------------------------------------------------------
// Rendering and proxies (WP5 renders, WP6 makes it work)
// ---------------------------------------------------------------------------

export type ProxyRole =
  'link' | 'button' | 'input' | 'toggle' | 'select' | 'none';

/**
 * What a rendered control drives. The renderer creates one per control and
 * hands it to Proxies.bind; it never dispatches events itself.
 */
export interface ProxyTarget {
  role: ProxyRole;
  /** The node id the control came from (this extraction). */
  id: string;
  /** Locator for re-finding the original after re-renders. */
  locator: Locator;
  /** The section's container element id, to scope re-resolution. */
  scopeId: string | null;
  /** For record controls: the collection and the record's key and fingerprint at render time. */
  record?: { listId: string; key: string; fingerprint: string; slotId: string };
  /** The href shown to the person (pinned: a changed original href is not followed). */
  href?: string | null;
  /** Opens a menu, listbox or dialog (aria-haspopup / aria-expanded / combobox). */
  popup?: boolean;
  /** An irreversible action (buy now, send, delete, pay): needs a second press. */
  irreversible?: boolean;
}

export interface Proxies {
  /** Wire a rendered control to its original. Safe to call again on re-render. */
  bind(control: HTMLElement, target: ProxyTarget): void;
  /** Number of proxied actions taken since open (learning: a navigation is a keep). */
  actions(): number;
  dispose(): void;
}

/** Status strip lines mirrored from the page (role=status/alert, toasts after an action). */
export interface StatusLine {
  key: string;
  text: string;
  /** Buttons in the original toast, proxied (e.g. "Undo"). */
  actions: Array<{ label: string; target: ProxyTarget }>;
}

/** Callbacks WP6 needs from the rendered view. */
export interface ViewSurface {
  /** The closed shadow root and its <dialog>. */
  readonly root: ShadowRoot;
  readonly dialog: HTMLDialogElement;
  /** The scroll container. */
  readonly scroller: HTMLElement;
  /** Re-render one record (content changed under it) or append new ones. */
  patchRecords(listId: string): void;
  /** Re-render everything from a new skeleton + spec (route change). */
  replace(next: FitViewOpenInput): void;
  /** Show a loading state immediately (a proxied navigation is under way). */
  loading(on: boolean): void;
  /** Show or hide a mirrored menu/listbox sheet beside a control. */
  sheet(
    anchor: HTMLElement | null,
    options: Array<{ label: string; selected: boolean; target: ProxyTarget }>,
  ): void;
  status(lines: StatusLine[]): void;
  /** Step aside for a site dialog; `back` returns. */
  peek(on: boolean, back?: () => void): void;
  /** One-line notice in the top strip ("Videos play best on the original page"). */
  notice(text: string | null): void;
  close(
    reason: 'original' | 'not_representable' | 'route' | 'error' | 'paused',
  ): void;
}

/** Input to open or replace the view. */
export interface FitViewOpenInput {
  reply: Extract<FitViewOpenReply, { ok: true }>;
  skeleton: Skeleton;
  registry: SkeletonRegistry;
  engine: EngineApi;
  reason: FitViewOpenReason;
}

/** What fitview.js registers for the engine adapter to call. */
export interface FitViewRuntime {
  open(input: FitViewOpenInput): Promise<void>;
  /** A planner spec arrived for the open template: offer "A better layout is ready". */
  offerSpec(envelope: SpecEnvelope, layout?: FitLayout): void;
  close(
    reason: 'original' | 'not_representable' | 'route' | 'error' | 'paused',
  ): void;
  setZoom(zoom: number): void;
  isOpen(): boolean;
}

/**
 * Registered by the Fit view host while mounted. The input firewall
 * (engine.content.ts, window capture, document_start) stops every event whose
 * target is `host` from reaching page listeners and hands it to `dispatch`.
 */
export interface FirewallTarget {
  host: Element;
  dispatch(e: Event): void;
}

/**
 * The live layer (WP6: proxies, sync, peek, status, firewall registration),
 * created by fitview.js once the view is rendered. Implemented in
 * `fitview/live.ts` as `createLive`.
 */
export interface LiveLayer {
  proxies: Proxies;
  /** The view was replaced (route change): rebind observers to the new skeleton. */
  rebind(input: FitViewOpenInput): void;
  setZoom(zoom: number): void;
  /** Close the view and point at an original on the page ("Use this on the page"). */
  showOnPage?(el: Element | null, caption?: string): void;
  dispose(): void;
}
export type CreateLive = (
  surface: ViewSurface,
  input: FitViewOpenInput,
) => LiveLayer;

/**
 * Engine methods the adapter maps onto EngineApi and the zoom guard
 * (implemented in engine.ts, WP2; called by adapter.ts, WP3b):
 *
 *   Engine.freeze(on: boolean): void
 *     Fit view is open: stop replans, incremental marks and verification
 *     (Tailor stays applied but untouched). freeze(false) resumes and
 *     re-verifies once.
 *   Engine.measured<T>(fn: () => T): T
 *     Run fn with measure mode on (every op CSS block removed), synchronously.
 *   Engine.regionKeys(): Map<Element, string>
 *     Component key per region root from the last extraction, so skeleton
 *     nodes can carry `ck` and join Jev and rule verdicts.
 *   Engine.viewportGuard(): ViewportGuard
 *     After a page-scale change settles: horizontal overflow, the visible
 *     primary-nav link count and search field, and titles newly cut off
 *     (docs/10 §5.1).
 */
export interface ViewportGuard {
  overflowPx: number;
  navLinks: number;
  searchVisible: boolean;
  /**
   * Titles (links, headings) in the first two screens whose text was whole
   * at the person's own zoom and is now cut off by an ellipsis or a line
   * clamp (eval m1). 0 when no reading at a lower zoom exists.
   */
  newlyEllipsised: number;
  /** Titles that count compares (those read at both zooms). */
  titlesShown: number;
}
