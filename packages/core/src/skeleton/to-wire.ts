import { DROPPED_MARK, tokenize, VOCAB_V1 } from '../page/vocab';
import {
  countBucket,
  lengthBucket,
  SKEL_BOX_ROUND,
  SKEL_FLAGS,
  SKEL_HREF_KINDS,
  SKEL_ID_PATTERN,
  SKEL_INPUT_TYPES,
  SKEL_KINDS,
  SKEL_MAX_COORD,
  SKEL_MAX_DEPTH,
  SKEL_MAX_LABEL_WORDS,
  SKEL_MAX_NODES,
  SKEL_PATTERNS,
  SKEL_ROLES,
  SKEL_TAGS,
  type SkelKind,
  type SkelTag,
} from './constants';
import type { Skeleton, SkeletonNode } from './types';
import type { WireNode, WirePage, WireSkeleton } from './wire';

/**
 * Skeleton -> wire (docs/10 §6). Runs in the service worker, on this device,
 * just before a compose request. Everything page-supplied is reduced to an
 * enum, a bucket, a rounded number or a public-vocabulary word here, and the
 * Edge Function re-checks it all against the same schema and VOCAB_V1:
 *
 *   labels    at most six entries of VOCAB_V1 words and '·' (a run of other
 *             words); never digits; never on text blocks (`text`, `stext`)
 *             and never on any node inside a collection (records, exemplars,
 *             slots), so no subject, name, title or price can leave
 *   typed     any token typed into an input or present in the URL query is
 *             dropped from every label, even when it is a vocabulary word
 *   boxes     rounded to 8 CSS px and clamped to [0, SKEL_MAX_COORD]
 *   counts    bucketed (collection sizes, options, inline links)
 *   text      shape only: length bucket and pattern tags
 *
 * The extraction id, structure hash, perf numbers and `typed` itself never
 * reach the wire. The output always parses with `wireSkeletonSchema`: unknown
 * enum values are mapped or dropped here rather than trusted.
 */

/** Largest request body the wire may produce (docs/10 §6): UTF-8 bytes of its JSON. */
export const WIRE_MAX_BYTES = 48 * 1024;

/** UTF-8 length of wire JSON: ASCII throughout, except the two-byte '·'. */
export const wireBytes = (json: string): number =>
  json.length + (json.match(/·/g)?.length ?? 0);

const TAGS: ReadonlySet<string> = new Set(SKEL_TAGS);
const ROLES: ReadonlySet<string> = new Set(SKEL_ROLES);
const KINDS: ReadonlySet<string> = new Set(SKEL_KINDS);
const INPUT_TYPES: ReadonlySet<string> = new Set(SKEL_INPUT_TYPES);
const HREF_KINDS: ReadonlySet<string> = new Set(SKEL_HREF_KINDS);
const WIRE_WORD = /^[a-z]{2,20}$/;

/** Kinds whose label is page text that stays on the device (only its shape is sent). */
const TEXT_KINDS: ReadonlySet<SkelKind> = new Set(['text', 'stext']);

export interface ToWireOptions {
  /**
   * Replaces the VOCAB_V1 membership test. Called with one lowercase token at
   * a time; the token is kept only when the result is the token itself (so
   * both a per-word mapper and a phrase filter such as `vocabPhrase` work).
   * Anything else counts as dropped.
   */
  vocabFilter?: (s: string) => string;
}

const round8 = (v: number | undefined): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const r = Math.round(v / SKEL_BOX_ROUND) * SKEL_BOX_ROUND;
  return Math.min(SKEL_MAX_COORD, Math.max(0, r));
};

const tagOf = (t: unknown): SkelTag =>
  typeof t === 'string' && TAGS.has(t) ? (t as SkelTag) : 'other';

/** Tokens the person typed or that sit in the URL query: never sent, even as vocabulary. */
function typedTokens(typed: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of typed ?? []) {
    if (typeof raw !== 'string') continue;
    for (const token of tokenize(raw)) out.add(token);
    const whole = raw.trim().toLowerCase();
    if (whole) out.add(whole);
  }
  return out;
}

/**
 * A label as wire words: vocabulary tokens in order, each run of other
 * tokens collapsed to one '·', at most SKEL_MAX_LABEL_WORDS entries in all.
 */
export function wireLabel(
  label: string,
  typed: ReadonlySet<string>,
  keep: (token: string) => boolean,
): string[] | undefined {
  const out: string[] = [];
  let lastDropped = false;
  for (const token of tokenize(label)) {
    if (out.length >= SKEL_MAX_LABEL_WORDS) break;
    if (!typed.has(token) && WIRE_WORD.test(token) && keep(token)) {
      out.push(token);
      lastDropped = false;
    } else if (!lastDropped) {
      out.push(DROPPED_MARK);
      lastDropped = true;
    }
  }
  return out.length > 0 ? out : undefined;
}

function keeper(opts: ToWireOptions | undefined): (token: string) => boolean {
  const filter = opts?.vocabFilter;
  if (!filter) return (token) => VOCAB_V1.has(token);
  return (token) => {
    try {
      return filter(token) === token;
    } catch {
      return false;
    }
  };
}

function unique<T extends string>(
  values: readonly unknown[] | undefined,
  order: readonly T[],
): T[] {
  if (!values?.length) return [];
  const have = new Set(values);
  return order.filter((v) => have.has(v));
}

/** Which nodes go on the wire: a valid tree rooted at the first node, within the node and depth caps. */
function keptNodes(nodes: readonly SkeletonNode[]): SkeletonNode[] {
  const depth = new Map<string, number>();
  const out: SkeletonNode[] = [];
  for (const [i, n] of nodes.entries()) {
    if (out.length >= SKEL_MAX_NODES) break;
    if (typeof n?.id !== 'string' || !SKEL_ID_PATTERN.test(n.id)) continue;
    if (depth.has(n.id)) continue;
    if (n.parent === null) {
      // Only the first node may be the root; a second root is dropped with its subtree.
      if (i !== 0 && out.length > 0) continue;
      depth.set(n.id, 0);
      out.push(n);
      continue;
    }
    if (out.length === 0) continue;
    const pd = depth.get(n.parent);
    if (pd === undefined || pd + 1 > SKEL_MAX_DEPTH) continue;
    depth.set(n.id, pd + 1);
    out.push(n);
  }
  return out;
}

function wireNode(
  n: SkeletonNode,
  hidden: boolean,
  exemplar: string | undefined,
  typed: ReadonlySet<string>,
  keep: (token: string) => boolean,
): WireNode {
  const node: WireNode = {
    id: n.id,
    p: n.parent,
    t: tagOf(n.tag),
    r: typeof n.role === 'string' && ROLES.has(n.role) ? n.role : null,
    k: KINDS.has(n.kind) ? n.kind : 'group',
    b: [
      round8(n.box?.[0]),
      round8(n.box?.[1]),
      round8(n.box?.[2]),
      round8(n.box?.[3]),
    ],
  };
  if (typeof n.fontPx === 'number' && Number.isFinite(n.fontPx) && n.fontPx > 0)
    node.fs = Math.min(200, Math.max(4, Math.round(n.fontPx)));
  if (typeof n.weight === 'number' && Number.isFinite(n.weight))
    node.w = n.weight >= 600 ? 600 : 400;
  if (
    typeof n.level === 'number' &&
    Number.isInteger(n.level) &&
    n.level >= 1 &&
    n.level <= 6
  )
    node.lv = n.level;
  const flags = unique(n.flags, SKEL_FLAGS);
  if (flags.length) node.f = flags;
  if (typeof n.inputType === 'string' && INPUT_TYPES.has(n.inputType))
    node.it = n.inputType;
  if (typeof n.options === 'number' && Number.isFinite(n.options))
    node.o = countBucket(n.options);
  if (!hidden && !TEXT_KINDS.has(node.k) && typeof n.label === 'string') {
    const words = wireLabel(n.label, typed, keep);
    if (words) node.l = words;
  }
  if (n.text && typeof n.text.chars === 'number') {
    const pat = unique(n.text.pat, SKEL_PATTERNS);
    const links =
      typeof n.text.links === 'number' && n.text.links > 0
        ? countBucket(n.text.links)
        : undefined;
    node.sh = {
      len: lengthBucket(Math.max(0, n.text.chars)),
      ...(pat.length ? { pat } : {}),
      ...(links ? { ln: links } : {}),
    };
  }
  if (typeof n.href === 'string' && HREF_KINDS.has(n.href)) node.hr = n.href;
  if (node.k === 'collection' && n.collection) {
    node.n = countBucket(n.collection.count);
    node.itm = tagOf(n.collection.itemTag);
    if (exemplar) node.ex = exemplar;
  }
  if (n.slot === true) node.s = true;
  return node;
}

function wirePage(sk: Skeleton): WirePage {
  const lang = typeof sk.lang === 'string' ? sk.lang.trim().toLowerCase() : '';
  return {
    vw: round8(sk.viewport?.width),
    vh: round8(sk.viewport?.height),
    dw: round8(sk.doc?.width),
    dh: round8(sk.doc?.height),
    lang: /^[a-z]{2}$/.test(lang) ? lang : '',
  };
}

/**
 * The wire form of a skeleton. Throws when the skeleton has no root node
 * (nothing could be planned from it). Nodes past the node, depth or body
 * caps are dropped from the end, in document order, so parents always
 * precede children.
 */
export function toWireSkeleton(
  skeleton: Skeleton,
  opts?: ToWireOptions,
): WireSkeleton {
  const keep = keeper(opts);
  const typed = typedTokens(skeleton.typed);
  const kept = keptNodes(skeleton.nodes ?? []);
  if (kept.length === 0) throw new Error('toWireSkeleton: no root node');

  // Everything under a collection is a record: shapes only, never words.
  const ids = new Set(kept.map((n) => n.id));
  const exemplars = new Set(
    kept.flatMap((n) =>
      n.kind === 'collection' && n.collection ? [n.collection.exemplar] : [],
    ),
  );
  const kinds = new Map(kept.map((n) => [n.id, n.kind] as const));
  const under = new Set<string>();
  for (const n of kept) {
    const p = n.parent;
    if (
      n.slot === true ||
      exemplars.has(n.id) ||
      (p !== null && (under.has(p) || kinds.get(p) === 'collection'))
    )
      under.add(n.id);
  }

  let nodes = kept.map((n) => {
    const ex = n.collection?.exemplar;
    return wireNode(
      n,
      under.has(n.id),
      typeof ex === 'string' && ids.has(ex) ? ex : undefined,
      typed,
      keep,
    );
  });

  const page = wirePage(skeleton);
  // Body cap: drop trailing nodes until the JSON fits.
  let size = wireBytes(JSON.stringify({ page, nodes: [] }));
  let fit = 0;
  for (const [i, n] of nodes.entries()) {
    const add = wireBytes(JSON.stringify(n)) + (i > 0 ? 1 : 0);
    if (size + add > WIRE_MAX_BYTES) break;
    size += add;
    fit = i + 1;
  }
  if (fit < nodes.length) {
    nodes = nodes.slice(0, Math.max(1, fit));
    const left = new Set(nodes.map((n) => n.id));
    for (const n of nodes) if (n.ex && !left.has(n.ex)) delete n.ex;
  }
  return { page, nodes };
}
