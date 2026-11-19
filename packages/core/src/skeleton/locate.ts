import type {
  PageSpec,
  SpecCollection,
  SpecSection,
  StoredSpec,
  ValidatedSpec,
} from '../compose/spec';
import type { Locator, Skeleton, SkeletonNode } from './types';

/**
 * Specs across page views (docs/10 §6 "Cache"). Node ids mean something only
 * within one extraction, so a cached spec stores locators instead:
 *
 *   path  steps from the root, each `tag` or `tag[role]`, with `:i` (the
 *         index among siblings of the same signature) only where siblings
 *         would otherwise be ambiguous
 *   kind  the node's skeleton kind
 *   name  an HMAC of the node's label (digits folded, lowercased), outside
 *         records only; the label itself is never stored
 *   slot  for collection fields: the path from the exemplar's root, so any
 *         member of the next page's list can play the exemplar
 *
 * Resolving prefers agreement of path and name, then the name alone, then
 * the path alone, and never accepts an ambiguous match. Coverage is the share
 * of stored locators that resolved; the caller reuses a stored spec only
 * above its threshold (80%) and the validator runs on the result either way.
 */

type NameHash = (label: string) => string;

interface Index {
  byId: Map<string, SkeletonNode>;
  kids: Map<string, SkeletonNode[]>;
  /** Exact step of each node (index only where ambiguous). */
  step: Map<string, string>;
  /** Steps from the root. */
  path: Map<string, string[]>;
  /** Nodes inside a collection (records): no names. */
  record: Set<string>;
}

const signature = (n: SkeletonNode): string =>
  n.role ? `${n.tag}[${n.role}]` : n.tag;

/** A step without its sibling index. */
const loose = (step: string): string => step.replace(/:\d+$/, '');

const key = (steps: readonly string[]): string => steps.join('/');

/** Labels normalised so counts and case do not change the name ("3 items" = "12 Items"). */
export function nameKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function index(skeleton: Skeleton): Index {
  const byId = new Map<string, SkeletonNode>();
  const kids = new Map<string, SkeletonNode[]>();
  const roots: SkeletonNode[] = [];
  for (const n of skeleton.nodes) {
    if (byId.has(n.id)) continue;
    byId.set(n.id, n);
    if (n.parent === null || !byId.has(n.parent)) roots.push(n);
    else {
      const list = kids.get(n.parent);
      if (list) list.push(n);
      else kids.set(n.parent, [n]);
    }
  }
  const step = new Map<string, string>();
  const name = (siblings: readonly SkeletonNode[]): void => {
    const count = new Map<string, number>();
    for (const s of siblings)
      count.set(signature(s), (count.get(signature(s)) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const s of siblings) {
      const sig = signature(s);
      const i = seen.get(sig) ?? 0;
      seen.set(sig, i + 1);
      step.set(s.id, (count.get(sig) ?? 0) > 1 ? `${sig}:${i}` : sig);
    }
  };
  name(roots);
  for (const list of kids.values()) name(list);
  const path = new Map<string, string[]>();
  const record = new Set<string>();
  for (const n of byId.values()) {
    const parent =
      n.parent === null ? undefined : (path.get(n.parent) ?? undefined);
    path.set(n.id, [...(parent ?? []), step.get(n.id) ?? signature(n)]);
    const p = n.parent === null ? undefined : byId.get(n.parent);
    if (n.slot === true || (p && (p.kind === 'collection' || record.has(p.id))))
      record.add(n.id);
  }
  return { byId, kids, step, path, record };
}

function nodeName(
  n: SkeletonNode,
  idx: Index,
  nameHash: NameHash,
): string | undefined {
  if (idx.record.has(n.id) || typeof n.label !== 'string') return undefined;
  const k = nameKey(n.label);
  return k ? nameHash(k) : undefined;
}

/** The locator for a node, or null when the id is not in the skeleton. */
function locatorOf(id: string, idx: Index, nameHash: NameHash): Locator | null {
  const n = idx.byId.get(id);
  const path = idx.path.get(id);
  if (!n || !path) return null;
  const name = nodeName(n, idx, nameHash);
  return { path: [...path], kind: n.kind, ...(name ? { name } : {}) };
}

/** The exemplar root of a collection node, when it is in the skeleton. */
function exemplarOf(list: SkeletonNode, idx: Index): SkeletonNode | null {
  const ex = list.collection?.exemplar;
  return ex ? (idx.byId.get(ex) ?? null) : null;
}

/** A field slot's locator: the list's path plus the slot's steps below the exemplar root. */
function slotLocator(
  listId: string,
  slotId: string,
  idx: Index,
): Locator | null {
  const list = idx.byId.get(listId);
  const listPath = idx.path.get(listId);
  const slot = idx.byId.get(slotId);
  if (!list || !listPath || !slot) return null;
  const root = exemplarOf(list, idx);
  if (!root) return null;
  const steps: string[] = [];
  let cur: SkeletonNode | undefined = slot;
  while (cur && cur.id !== root.id) {
    steps.unshift(idx.step.get(cur.id) ?? signature(cur));
    cur = cur.parent === null ? undefined : idx.byId.get(cur.parent);
  }
  if (!cur) return null; // not inside this list's exemplar
  return { path: [...listPath], kind: slot.kind, slot: steps };
}

export function toStoredSpec(
  v: ValidatedSpec,
  skeleton: Skeleton,
  nameHash: NameHash,
  meta: { schema: string; model: string; createdAt: number },
): StoredSpec {
  const idx = index(skeleton);
  const spec = v.spec;
  const sections: StoredSpec['sections'] = [];
  for (const s of spec.sections) {
    const nodes = s.node_ids
      .map((id) => locatorOf(id, idx, nameHash))
      .filter((l): l is Locator => l !== null);
    if (nodes.length === 0) continue;
    sections.push({
      kind: s.kind,
      importance: s.importance,
      layout: s.layout,
      nodes,
      heading:
        s.heading_ref === null ? null : locatorOf(s.heading_ref, idx, nameHash),
    });
  }
  const collections: StoredSpec['collections'] = [];
  for (const c of spec.collections) {
    const list = locatorOf(c.list_id, idx, nameHash);
    if (!list) continue;
    const fields: StoredSpec['collections'][number]['fields'] = [];
    for (const f of c.fields) {
      const slot = slotLocator(c.list_id, f.slot_id, idx);
      if (slot) fields.push({ slot, role: f.role, show: f.show });
    }
    collections.push({
      item_kind: c.item_kind,
      card: c.card,
      media: c.media,
      lead: c.lead,
      list,
      open:
        c.open_slot === null ? null : slotLocator(c.list_id, c.open_slot, idx),
      fields,
    });
  }
  return {
    schema: meta.schema,
    model: meta.model,
    createdAt: meta.createdAt,
    page_type: spec.page_type,
    primary_task: spec.primary_task,
    sections,
    collections,
  };
}

/** Resolves locators against one fresh skeleton. */
class Resolver {
  private readonly byPath = new Map<string, SkeletonNode>();
  private readonly byLoose = new Map<string, SkeletonNode[]>();
  private readonly byName = new Map<string, SkeletonNode[]>();
  private readonly names = new Map<string, string>();

  constructor(
    private readonly idx: Index,
    nameHash: NameHash,
  ) {
    for (const n of idx.byId.values()) {
      const path = idx.path.get(n.id)!;
      this.byPath.set(key(path), n);
      const lk = key(path.map(loose));
      const list = this.byLoose.get(lk);
      if (list) list.push(n);
      else this.byLoose.set(lk, [n]);
      const name = nodeName(n, idx, nameHash);
      if (name) {
        this.names.set(n.id, name);
        const named = this.byName.get(name);
        if (named) named.push(n);
        else this.byName.set(name, [n]);
      }
    }
  }

  private only(
    nodes: readonly SkeletonNode[] | undefined,
    ok: (n: SkeletonNode) => boolean,
  ): SkeletonNode | null {
    let found: SkeletonNode | null = null;
    for (const n of nodes ?? []) {
      if (!ok(n)) continue;
      if (found) return null; // ambiguous
      found = n;
    }
    return found;
  }

  /** A node by path, kind and name (no slot). */
  node(l: Locator): SkeletonNode | null {
    const exact = this.byPath.get(key(l.path));
    const exactOk = exact && exact.kind === l.kind ? exact : null;
    const named = (n: SkeletonNode): boolean =>
      n.kind === l.kind && this.names.get(n.id) === l.name;
    if (l.name) {
      if (exactOk && this.names.get(exactOk.id) === l.name) return exactOk;
      const sameShape = this.only(
        this.byLoose.get(key(l.path.map(loose))),
        named,
      );
      if (sameShape) return sameShape;
      const anywhere = this.only(this.byName.get(l.name), named);
      if (anywhere) return anywhere;
    }
    if (exactOk) return exactOk;
    // Ancestors may have shifted among their siblings, but a leaf that was
    // one of several look-alikes is never guessed.
    const leaf = l.path.at(-1);
    if (!leaf || leaf !== loose(leaf)) return null;
    return this.only(
      this.byLoose.get(key(l.path.map(loose))),
      (n) => n.kind === l.kind,
    );
  }

  /** A field slot: the list by path, then the steps below its exemplar root. */
  slot(l: Locator): SkeletonNode | null {
    const list = this.node({ path: l.path, kind: 'collection' });
    if (!list) return null;
    const root = exemplarOf(list, this.idx);
    if (!root) return null;
    let cur: SkeletonNode = root;
    // Exact steps only: a slot that was one of several look-alikes, or that
    // has look-alikes now, is not guessed.
    for (const step of l.slot ?? []) {
      const kids = this.idx.kids.get(cur.id) ?? [];
      const next = kids.find((k) => this.idx.step.get(k.id) === step);
      if (!next) return null;
      cur = next;
    }
    return cur.kind === l.kind ? cur : null;
  }
}

/**
 * Re-bind a stored spec to a fresh skeleton. Unresolved locators are dropped
 * (a section left without nodes, a collection without its list), so the
 * returned spec may need the validator's repairs; `coverage` says how much of
 * the stored spec survived (0 when it stored nothing).
 */
export function fromStoredSpec(
  stored: StoredSpec,
  skeleton: Skeleton,
  nameHash: NameHash,
): { spec: PageSpec; coverage: number } {
  const r = new Resolver(index(skeleton), nameHash);
  let total = 0;
  let found = 0;
  const count = (n: SkeletonNode | null): SkeletonNode | null => {
    total++;
    if (n) found++;
    return n;
  };

  const sections: SpecSection[] = [];
  for (const s of stored.sections) {
    const ids: string[] = [];
    for (const l of s.nodes) {
      const n = count(r.node(l));
      if (n && !ids.includes(n.id)) ids.push(n.id);
    }
    const heading = s.heading ? count(r.node(s.heading)) : null;
    if (ids.length === 0) continue;
    sections.push({
      kind: s.kind,
      importance: s.importance,
      node_ids: ids,
      heading_ref: heading?.id ?? null,
      layout: s.layout,
    });
  }

  const collections: SpecCollection[] = [];
  for (const c of stored.collections) {
    const list = count(r.node(c.list));
    const open = c.open ? count(r.slot(c.open)) : null;
    const fields: SpecCollection['fields'] = [];
    for (const f of c.fields) {
      const slot = count(r.slot(f.slot));
      if (slot && !fields.some((x) => x.slot_id === slot.id))
        fields.push({ slot_id: slot.id, role: f.role, show: f.show });
    }
    if (!list || list.kind !== 'collection') continue;
    collections.push({
      list_id: list.id,
      item_kind: c.item_kind,
      open_slot: open?.id ?? null,
      card: c.card,
      media: c.media,
      lead: c.lead,
      fields,
    });
  }

  return {
    spec: {
      v: 1,
      page_type: stored.page_type,
      primary_task: stored.primary_task,
      sections,
      collections,
    },
    coverage: total === 0 ? 0 : found / total,
  };
}
