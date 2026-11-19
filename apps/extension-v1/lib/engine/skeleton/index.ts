import {
  SKEL_FLAGS,
  SKEL_MAX_DEPTH,
  SKEL_MAX_NODES,
} from '@webable/core/skeleton/constants';
import type { Skeleton, SkeletonNode } from '@webable/core/skeleton/types';
import { SKELETON_VERSION } from '@webable/core/versions';

import type { SkeletonRegistry } from '../fitview/types';
import type { PageFacts } from '../types';
import { yieldToMain } from '../util/schedule';
import { markBold, markFocus, markOverlay, SkeletonBuilder } from './build';
import { deepActiveElement, type OpenClosed } from './dom';
import { capDepth, fitBudget } from './lod';
import { hasSensitiveField, typedTokens } from './privacy';
import type { RawNode } from './raw';
import { Registry, type RegistryEntry } from './registry';
import { structureHash } from './structure';

/**
 * Read the page skeleton (docs/10 §4, §6): the structure Fit view is planned
 * from, plus a live registry of the elements behind it.
 *
 * Runs in the content script, on this device, in budgeted slices: each slice
 * runs inside `measured` (Tailor's op CSS removed, so the native page is
 * read) and the main thread is given back between slices. Resolves null on
 * pages that must not be read at all: a rendered password, one-time-code or
 * payment field, or a payment provider's card-field frame.
 *
 * Labels in the skeleton are page words and never leave the device as they
 * are; the wire conversion (core/skeleton/to-wire.ts, service worker) keeps
 * at most six public-vocabulary words per label, none inside records, and
 * strips every token in `typed`.
 */

export interface ReadSkeletonOptions {
  /** Opens closed shadow roots (chrome.dom.openOrClosedShadowRoot). */
  openClosed?: OpenClosed;
  /** Runs `fn` with WebAble's op CSS removed (Engine.measured). */
  measured?: <T>(fn: () => T) => T;
  /** v1 region component keys by root element (joins Jev and rule verdicts as `ck`). */
  regionKeys?: Map<Element, string>;
  /**
   * Main-thread busy budget, ms; past it what is outside main and the banner
   * is summarised. Inside them the read goes on until `hardMs`.
   */
  budgetMs?: number;
  /** Busy limit for main and the banner, ms (default 4 × budgetMs, at least 200). */
  hardMs?: number;
  /** Node budget (at most SKEL_MAX_NODES). */
  maxNodes?: number;
  /** Gives the main thread back between slices. */
  yieldMain?: () => Promise<void>;
  /** Busy time per slice, ms. */
  sliceMs?: number;
  now?: () => number;
}

export interface SkeletonRead {
  skeleton: Skeleton;
  registry: SkeletonRegistry;
}

/** Busy-time budget of one read, ms (docs/10 §10: read + triage <= 50 ms on typical pages). */
export const SKELETON_BUDGET_MS = 60;
/** Main content is never cut at the budget, only at this multiple of it (and never before HARD_MIN_MS). */
const HARD_FACTOR = 4;
const HARD_MIN_MS = 200;
const SLICE_MS = 6;

function extractionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Two-letter primary language subtag, '' when unknown. */
export function langOf(doc: Document): string {
  const m = /^([a-z]{2})(?:-|$)/.exec(
    (doc.documentElement.lang || '').trim().toLowerCase(),
  );
  return m?.[1] ?? '';
}

/** Region component keys from an extraction, by element (ReadSkeletonOptions.regionKeys). */
export function regionKeysOf(facts: PageFacts): Map<Element, string> {
  const out = new Map<Element, string>();
  for (const [key, list] of facts.regions)
    for (const f of list) if (!out.has(f.el)) out.set(f.el, key);
  return out;
}

export async function readSkeleton(
  doc: Document,
  opts: ReadSkeletonOptions = {},
): Promise<SkeletonRead | null> {
  const view = doc.defaultView;
  if (!view || !doc.body) return null;
  const now = opts.now ?? (() => performance.now());
  const measured = opts.measured ?? (<T>(fn: () => T): T => fn());
  const yieldMain = opts.yieldMain ?? yieldToMain;
  const budget = opts.budgetMs ?? SKELETON_BUDGET_MS;
  const hard = opts.hardMs ?? Math.max(budget * HARD_FACTOR, HARD_MIN_MS);
  const maxNodes = Math.max(
    2,
    Math.min(opts.maxNodes ?? SKEL_MAX_NODES, SKEL_MAX_NODES),
  );
  let busy = 0;
  const slice = <T>(fn: () => T): T => {
    const t0 = now();
    try {
      return measured(fn);
    } finally {
      busy += now() - t0;
    }
  };

  if (slice(() => hasSensitiveField(doc))) return null;
  const builder = slice(
    () =>
      new SkeletonBuilder(doc, {
        openClosed: opts.openClosed,
        regionKeys: opts.regionKeys,
        sliceMs: opts.sliceMs ?? SLICE_MS,
        now,
      }),
  );
  const gen = builder.root();
  let root: RawNode | null = null;
  for (;;) {
    const res = slice(() => {
      builder.sliceStart = now();
      return gen.next();
    });
    if (res.done) {
      root = res.value;
      break;
    }
    if (busy >= budget) builder.stopped = true;
    if (busy >= hard) builder.exhausted = true;
    await yieldMain();
    if (!doc.body) return null;
  }
  if (builder.sensitive || !root) return null;
  const done = root;
  return slice(() =>
    finish(doc, view, done, builder, opts, maxNodes, busy, now),
  );
}

function finish(
  doc: Document,
  view: Window,
  root: RawNode,
  builder: SkeletonBuilder,
  opts: ReadSkeletonOptions,
  maxNodes: number,
  busyBefore: number,
  now: () => number,
): SkeletonRead | null {
  const t0 = now();
  for (const sr of builder.shadowRoots) if (hasSensitiveField(sr)) return null;
  const oc = opts.openClosed;
  markOverlay(root);
  markBold(root);
  markFocus(root, deepActiveElement(doc, oc), oc);
  // Before level of detail, so the hash does not depend on how much text a page has.
  const structure = structureHash(root);
  let truncated = builder.truncated;
  if (capDepth(root, SKEL_MAX_DEPTH)) truncated = true;
  if (fitBudget(root, maxNodes, builder.vh)) truncated = true;

  const nodes: SkeletonNode[] = [];
  const entries: RegistryEntry[] = [];
  let seq = 0;
  const emit = (
    n: RawNode,
    parent: string | null,
    depth: number,
    listId: string | null,
  ): string => {
    const id = `e${++seq}`;
    const out: SkeletonNode = {
      id,
      parent,
      depth,
      tag: n.tag,
      role: n.role,
      kind: n.kind,
      box: n.box,
      flags: SKEL_FLAGS.filter((f) => n.flags.has(f)),
    };
    if (n.fontPx !== undefined) out.fontPx = n.fontPx;
    if (n.weight !== undefined) out.weight = n.weight;
    if (n.level !== undefined) out.level = n.level;
    if (n.inputType !== undefined) out.inputType = n.inputType;
    if (n.options !== undefined) out.options = n.options;
    if (n.label) out.label = n.label;
    if (n.text) out.text = { ...n.text };
    if (n.href !== undefined) out.href = n.href;
    if (n.idp) out.idp = true;
    if (n.slot) out.slot = true;
    if (n.ck) out.ck = n.ck;
    nodes.push(out);
    const entry: RegistryEntry = {
      id,
      el: n.el,
      kind: n.kind,
      named: !!n.label && n.kind !== 'text',
    };
    if (listId)
      entry.slot = {
        listId,
        pat: n.text?.pat,
        hoveronly: n.flags.has('hoveronly'),
        role: n.role,
      };
    if (n.list)
      entry.list = {
        container: n.list.container,
        sig: n.list.sig,
        exemplarEl: n.list.exemplarEl,
      };
    entries.push(entry);
    if (n.list) {
      const ex = emit(n.list.exemplar, id, depth + 1, id);
      out.collection = {
        count: n.list.members.length,
        itemTag: n.list.itemTag,
        exemplar: ex,
      };
    }
    for (const k of n.kids) emit(k, id, depth + 1, listId);
    return id;
  };
  emit(root, null, 0, null);

  const id = extractionId();
  const scale = view.visualViewport?.scale ?? 1;
  const skeleton: Skeleton = {
    v: 1,
    version: SKELETON_VERSION,
    extractionId: id,
    viewport: {
      width: view.innerWidth,
      height: view.innerHeight,
      zoom: Math.round(scale * 100) / 100,
    },
    doc: { width: root.box[2], height: root.box[3] },
    lang: langOf(doc),
    nodes,
    truncated,
    structure,
    typed: typedTokens([doc, ...builder.shadowRoots], doc.URL),
    perf: { ms: 0, nodes: nodes.length },
  };
  const registry = new Registry(id, doc, entries, oc);
  skeleton.perf.ms = Math.round((busyBefore + now() - t0) * 10) / 10;
  return { skeleton, registry };
}

export { Registry } from './registry';
export type { RegistryEntry } from './registry';
