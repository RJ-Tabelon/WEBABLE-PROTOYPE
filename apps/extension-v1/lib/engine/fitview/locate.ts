import type { Locator } from '@webable/core';

import { composedContains, isRendered } from '../util/dom';
import { nextFrame } from '../util/schedule';
import type { ProxyRole, ProxyTarget, SkeletonRegistry } from './types';

/**
 * Re-finding the original behind a rendered control, at the moment of the
 * person's action (docs/10 §4.4, Identity). Never by index:
 *
 *   - Record controls resolve to the member whose fingerprint (hash of its
 *     visible slot texts) equals what the card showed. Two lookalikes are
 *     told apart by record key; still ambiguous means refuse.
 *   - The same key with a different fingerprint means the record changed
 *     under the view: refuse and show it on the page.
 *   - Other controls resolve by node id while the element is still in its
 *     section, else by locator inside the section (exactly one match).
 *   - Popup rows and toast buttons the live layer mirrors (not in the
 *     skeleton) are ephemeral targets: the element itself, checked by label.
 *
 * Read-only.
 */

export type Resolved =
  | { kind: 'ok'; el: Element; member: Element | null }
  /** A record that is not in the DOM right now (virtualized away). */
  | { kind: 'absent' }
  /** The record is there with different content: it changed under the view. */
  | { kind: 'changed'; member: Element }
  /** Several records look the same and the key cannot tell them apart. */
  | { kind: 'ambiguous'; member: Element }
  | { kind: 'missing'; near: Element | null };

// ---------------------------------------------------------------------------
// Ephemeral targets (sheet rows, toast buttons)
// ---------------------------------------------------------------------------

const EPHEMERAL_PREFIX = 'x';
const EPHEMERAL_MAX = 400;

interface EphemeralEntry {
  ref: WeakRef<Element>;
  label: string;
}

/**
 * Ids for elements the live layer mirrors that are not skeleton nodes. They
 * never match the skeleton's `e<n>` ids. One id per element, so a refreshed
 * sheet keeps its rows' identities.
 */
export class Ephemeral {
  private n = 0;
  private readonly ids = new WeakMap<Element, string>();
  private readonly entries = new Map<string, EphemeralEntry>();

  static is(id: string): boolean {
    return id.startsWith(EPHEMERAL_PREFIX);
  }

  target(
    el: Element,
    role: ProxyRole,
    label: string,
    href?: string | null,
  ): ProxyTarget {
    let id = this.ids.get(el);
    if (!id) {
      id = `${EPHEMERAL_PREFIX}${++this.n}`;
      this.ids.set(el, id);
    }
    this.entries.set(id, { ref: new WeakRef(el), label });
    if (this.entries.size > EPHEMERAL_MAX) this.prune();
    const target: ProxyTarget = {
      role,
      id,
      locator: { path: [], kind: 'control' } satisfies Locator,
      scopeId: null,
    };
    if (role === 'link') target.href = href ?? null;
    return target;
  }

  get(id: string): { el: Element | null; label: string } | null {
    const e = this.entries.get(id);
    if (!e) return null;
    return { el: e.ref.deref() ?? null, label: e.label };
  }

  private prune(): void {
    for (const [id, e] of this.entries) {
      const el = e.ref.deref();
      if (!el || !el.isConnected) this.entries.delete(id);
    }
    while (this.entries.size > EPHEMERAL_MAX) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.entries.delete(first);
    }
  }
}

/** The label a mirrored element shows: its accessible name, else its visible text. */
export function labelOf(reg: SkeletonRegistry, el: Element): string {
  return clean(reg.name(el)) || clean(reg.text(el));
}

export function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function resolveOriginal(
  reg: SkeletonRegistry,
  target: ProxyTarget,
  eph?: Ephemeral,
): Resolved {
  if (Ephemeral.is(target.id)) {
    const e = eph?.get(target.id);
    const el = e?.el ?? null;
    if (!e || !el || !el.isConnected || !isRendered(el))
      return { kind: 'missing', near: null };
    if (labelOf(reg, el) !== e.label) return { kind: 'changed', member: el };
    return { kind: 'ok', el, member: null };
  }
  if (target.record) return resolveRecord(reg, target);
  const scope = target.scopeId ? reg.element(target.scopeId) : null;
  const byId = reg.element(target.id);
  if (byId?.isConnected && (!scope || composedContains(scope, byId)))
    return { kind: 'ok', el: byId, member: null };
  const found = reg.resolve(target.locator, scope);
  if (found) return { kind: 'ok', el: found, member: null };
  return { kind: 'missing', near: scope };
}

// ---------------------------------------------------------------------------
// Text fields a site swaps (eval M8: Wikipedia's search on focus)
// ---------------------------------------------------------------------------

/**
 * What identifies a text field apart from its node: taken while it is
 * still on the page, so a field the site replaces (a new element in its
 * place, often on focus) can be found again.
 */
export interface FieldSig {
  /** Accessible name, whitespace-normalised ('' when it has none). */
  name: string;
  /** 'text' (any single-line text type) or 'textarea'. */
  kind: 'text' | 'textarea';
  /** The name attribute (forms submit by it). */
  nameAttr: string | null;
  /** It sat in a search landmark (role=search, <search>). */
  search: boolean;
  /** Its form, while that form exists. */
  form: WeakRef<Element> | null;
}

const TEXT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'number',
  '',
]);
const SEARCH_LANDMARK = '[role="search"], search';

function fieldKind(el: Element): FieldSig['kind'] | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type)) return 'text';
  return null;
}

/** The signature of a text field, or null for anything else. */
export function fieldSig(reg: SkeletonRegistry, el: Element): FieldSig | null {
  const kind = fieldKind(el);
  if (!kind) return null;
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  return {
    name: clean(reg.name(el)),
    kind,
    nameAttr: el.getAttribute('name'),
    search: el.closest(SEARCH_LANDMARK) !== null,
    form: form ? new WeakRef(form) : null,
  };
}

/** Text fields of a kind under `root`, enabled and rendered. */
function fieldsIn(root: ParentNode, kind: FieldSig['kind']): Element[] {
  return Array.from(root.querySelectorAll('input, textarea')).filter(
    (el) =>
      fieldKind(el) === kind &&
      !(el as HTMLInputElement).disabled &&
      isRendered(el),
  );
}

const one = (list: readonly Element[]): Element | null =>
  list.length === 1 ? (list[0] as Element) : null;

/**
 * Find a text field again after the site replaced it, when its locator no
 * longer matches. One ladder, exactly one match at every step, else null:
 *
 *   1. inside a search landmark (it was in one): the field that has focus
 *      there, else the one with the same accessible name, else the same
 *      name attribute, else the only field;
 *   2. the same role and accessible name inside its section (or the page);
 *   3. its form, if still there: the same name attribute, else the only field.
 */
export function relocateField(
  reg: SkeletonRegistry,
  doc: Document,
  sig: FieldSig,
  scope: Element | null,
): Element | null {
  const named = (el: Element): boolean =>
    sig.name !== '' && clean(reg.name(el)) === sig.name;
  const sameAttr = (el: Element): boolean =>
    sig.nameAttr !== null && el.getAttribute('name') === sig.nameAttr;
  if (sig.search) {
    const inSearch = fieldsIn(doc, sig.kind).filter(
      (el) => el.closest(SEARCH_LANDMARK) !== null,
    );
    const active = doc.activeElement;
    if (active && inSearch.includes(active)) return active;
    const found =
      one(inSearch.filter(named)) ??
      one(inSearch.filter(sameAttr)) ??
      one(inSearch);
    if (found) return found;
  }
  const root = scope?.isConnected ? scope : doc;
  const byName = one(fieldsIn(root, sig.kind).filter(named));
  if (byName) return byName;
  const form = sig.form?.deref();
  if (form?.isConnected) {
    const inForm = fieldsIn(form, sig.kind);
    return one(inForm.filter(sameAttr)) ?? one(inForm);
  }
  return null;
}

function resolveRecord(reg: SkeletonRegistry, target: ProxyTarget): Resolved {
  const rec = target.record;
  if (!rec) return { kind: 'missing', near: null };
  const { listId, key, fingerprint, slotId } = rec;
  const members = reg.members(listId);
  const fps = new Map<Element, string>();
  const fp = (m: Element): string => {
    let v = fps.get(m);
    if (v === undefined) {
      v = reg.fingerprint(listId, m);
      fps.set(m, v);
    }
    return v;
  };
  const slotOf = (m: Element): Resolved => {
    const el = reg.slot(listId, m, slotId);
    return el?.isConnected
      ? { kind: 'ok', el, member: m }
      : { kind: 'missing', near: m };
  };
  // Fast path: the node behind the id sits in the record that was shown.
  const byId = reg.element(target.id);
  if (byId?.isConnected) {
    const m = members.find((x) => x === byId || x.contains(byId));
    if (m && fp(m) === fingerprint && reg.recordKey(listId, m) === key)
      return slotOf(m);
  }
  const same = members.filter((m) => fp(m) === fingerprint);
  if (same.length === 1) return slotOf(same[0] as Element);
  if (same.length > 1) {
    const keyed = same.filter((m) => reg.recordKey(listId, m) === key);
    if (keyed.length === 1) return slotOf(keyed[0] as Element);
    return { kind: 'ambiguous', member: same[0] as Element };
  }
  const changed = members.find((m) => reg.recordKey(listId, m) === key);
  if (changed) return { kind: 'changed', member: changed };
  return { kind: 'absent' };
}

// ---------------------------------------------------------------------------
// Two-phase: bring a virtualized record back, then act
// ---------------------------------------------------------------------------

/** Record positions seen this session, in the list's scroll container's content coordinates. */
export class Positions {
  private readonly ys = new Map<string, number>();

  private static k(listId: string, key: string): string {
    return `${listId}\u0000${key}`;
  }

  note(listId: string, key: string, y: number): void {
    this.ys.set(Positions.k(listId, key), y);
    if (this.ys.size > 5000) {
      const first = this.ys.keys().next().value;
      if (first !== undefined) this.ys.delete(first);
    }
  }

  get(listId: string, key: string): number | undefined {
    return this.ys.get(Positions.k(listId, key));
  }

  clear(): void {
    this.ys.clear();
  }
}

/** The element that scrolls `el`: the nearest scrollable ancestor, else the document. */
export function scrollContainer(el: Element, self = false): Element {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const start = self ? el : el.parentElement;
  for (let n = start; n && n !== doc.body; n = n.parentElement) {
    if (n.scrollHeight <= n.clientHeight + 1) continue;
    const oy = view?.getComputedStyle(n).overflowY ?? '';
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return n;
  }
  return doc.scrollingElement ?? doc.documentElement;
}

/** `el`'s top in its scroll container's content coordinates. */
export function contentY(el: Element, container: Element): number {
  const doc = el.ownerDocument;
  const top = el.getBoundingClientRect().top;
  if (container === doc.scrollingElement || container === doc.documentElement)
    return top + (doc.defaultView?.scrollY ?? 0);
  return top - container.getBoundingClientRect().top + container.scrollTop;
}

function scrollToY(container: Element, y: number): void {
  const doc = container.ownerDocument;
  const viewH =
    container === doc.scrollingElement || container === doc.documentElement
      ? (doc.defaultView?.innerHeight ?? 0)
      : container.clientHeight;
  const top = Math.max(0, Math.round(y - viewH / 2));
  if (container === doc.scrollingElement || container === doc.documentElement)
    doc.defaultView?.scrollTo({ top, behavior: 'instant' });
  else container.scrollTo({ top, behavior: 'instant' });
}

export interface SeekOptions {
  reg: SkeletonRegistry;
  target: ProxyTarget;
  /** Record keys in the view's order (the person's reference frame). */
  order: readonly string[];
  positions: Positions;
  /** Give up after this long (transient activation lasts about 5 s). */
  timeoutMs?: number;
  now?: () => number;
}

/** How long two-phase dispatch waits for a record to come back. */
export const SEEK_TIMEOUT_MS = 800;

/**
 * Scroll the hidden original so a virtualized record renders again, then
 * resolve it by fingerprint. The scroll target comes from the record's last
 * seen position, or is estimated from the records that are present and their
 * places in the view's order (rows of a virtual list have a steady pitch).
 */
export async function seekRecord(o: SeekOptions): Promise<Resolved> {
  const rec = o.target.record;
  if (!rec) return { kind: 'missing', near: null };
  const now = o.now ?? (() => performance.now());
  const deadline = now() + (o.timeoutMs ?? SEEK_TIMEOUT_MS);
  const want = o.order.indexOf(rec.key);
  let last = Number.NEGATIVE_INFINITY;
  for (;;) {
    const r = resolveOriginal(o.reg, o.target);
    if (r.kind !== 'absent') return r;
    if (now() >= deadline) return r;
    const y = estimateY(o, rec.listId, rec.key, want);
    if (y === null) return r;
    const member = o.reg.members(rec.listId)[0];
    const list = o.reg.element(rec.listId);
    const sc = member
      ? scrollContainer(member)
      : list
        ? scrollContainer(list, true)
        : null;
    if (!sc) return r;
    if (Math.abs(y - last) > 2) {
      scrollToY(sc, y);
      last = y;
    }
    await nextFrame(50);
    await nextFrame(50);
  }
}

function estimateY(
  o: SeekOptions,
  listId: string,
  key: string,
  want: number,
): number | null {
  const members = o.reg.members(listId);
  const first = members[0];
  if (want >= 0 && first) {
    const sc = scrollContainer(first);
    const present: Array<{ idx: number; y: number }> = [];
    for (const m of members) {
      const k = o.reg.recordKey(listId, m);
      const idx = o.order.indexOf(k);
      const y = contentY(m, sc);
      o.positions.note(listId, k, y);
      if (idx >= 0) present.push({ idx, y });
    }
    if (present.length > 0) {
      present.sort((a, b) => a.idx - b.idx);
      const lo = present[0] as { idx: number; y: number };
      const hi = present[present.length - 1] as { idx: number; y: number };
      const pitch =
        hi.idx > lo.idx
          ? (hi.y - lo.y) / (hi.idx - lo.idx)
          : Math.max(1, first.getBoundingClientRect().height);
      if (want < lo.idx) return lo.y - (lo.idx - want) * pitch;
      if (want > hi.idx) return hi.y + (want - hi.idx) * pitch;
      // Between present records: it should render once the list settles.
      return lo.y + (want - lo.idx) * pitch;
    }
  }
  return o.positions.get(listId, key) ?? null;
}
