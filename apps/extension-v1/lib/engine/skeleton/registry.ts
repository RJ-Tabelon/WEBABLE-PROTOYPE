import type { Locator } from '@webable/core/skeleton/types';
import type { SkelKind, SkelPattern } from '@webable/core/skeleton/constants';

import type { MediaInfo, SkeletonRegistry } from '../fitview/types';
import { cyrb53 } from '../util/hash';
import { matchesTemplate, type MemberSig } from './collections';
import {
  classTokens,
  composedIncludes,
  composedKids,
  type OpenClosed,
} from './dom';
import {
  domPath,
  matchPath,
  nameHash,
  parseStep,
  stepSig,
  suffixMatch,
} from './locator';
import { isAdRecord } from './ads';
import { linkHref, mediaInfo } from './media';
import { accessibleName } from './name';
import { VOLATILE_PATTERNS } from './text';
import { isVisible, visibleText } from './visible';

/**
 * Live access to the elements behind one skeleton extraction (docs/10 §4.4,
 * fitview/types.ts). Element references are weak: the registry never keeps
 * a removed node alive. Every read re-queries the page, so re-renders,
 * re-ordered rows and virtualized lists are handled by asking again; nothing
 * is ever resolved by its position in a list.
 */

interface NodeRec {
  el: WeakRef<Element>;
  kind: SkelKind;
  /** The node has a label (a name worth checking on resolve). */
  named: boolean;
  /** The collection whose exemplar holds this node. */
  listId?: string;
}

interface SlotRec {
  /** The exemplar's element for this slot. */
  el: WeakRef<Element>;
  /** Steps from the exemplar member to the slot ([] = the member itself). */
  steps: string[];
  /** Class tokens of the slot element (signature fallback). */
  cls: readonly string[];
  kind: SkelKind;
  pat?: SkelPattern[];
  hoveronly: boolean;
  role: string | null;
}

interface ListRec {
  container: WeakRef<Element>;
  /** Path to the container from <body>, to re-find it after a re-render. */
  containerPath: string[] | null;
  sig: MemberSig;
  exemplarEl: WeakRef<Element>;
  /** Slot ids in document order. */
  slotIds: string[];
  slots: Map<string, SlotRec>;
}

/** What the read hands the registry for each emitted node. */
export interface RegistryEntry {
  id: string;
  el: Element;
  kind: SkelKind;
  named: boolean;
  /** For exemplar nodes: their collection and slot facts. */
  slot?: {
    listId: string;
    pat?: SkelPattern[];
    hoveronly: boolean;
    role: string | null;
  };
  /** For collection nodes. */
  list?: { container: Element; sig: MemberSig; exemplarEl: Element };
}

/** Attribute names that carry an item's own id (not a test hook). */
const ID_ATTR =
  /^data-(?:[a-z-]*-)?(?:id|key|uuid|guid|asin|sku|pid|item|itemid|thread|thread-id|message|message-id|msg|post|video|product|entry|row|record|doc|uid)(?:-id)?$/i;
const NOT_ID_ATTR =
  /^data-(?:test|testid|test-id|qa|cy|track|tracking|analytics|ga|gtm)\b/i;
const ID_DESCENDANT =
  '[data-thread-id], [data-legacy-thread-id], [data-message-id], [data-item-id], [data-id], [data-asin], [data-video-id], [data-post-id], [data-product-id], [data-uuid], [data-key]';
/** Element ids frameworks generate per render (Gmail ":2b", React ":r1:", Ember "ember12"). */
const VOLATILE_ID =
  /^(?::|r:|ember\d|react-|mui-|radix-|headlessui-|downshift-|tippy-|yui_|ext-gen|\d)/;
const ID_PARAM =
  /^(?:v|id|item|itemid|p|pid|product|productid|story|post|postid|video|list|th|thread|msg|doc|docid|sku|asin|q)$/i;

const SEP = '␟';

export class Registry implements SkeletonRegistry {
  private readonly nodes = new Map<string, NodeRec>();
  private readonly lists = new Map<string, ListRec>();
  private readonly doc: Document;

  constructor(
    readonly extractionId: string,
    doc: Document,
    entries: readonly RegistryEntry[],
    private readonly openClosed?: OpenClosed,
  ) {
    this.doc = doc;
    const body = doc.body;
    for (const e of entries) {
      this.nodes.set(e.id, {
        el: new WeakRef(e.el),
        kind: e.kind,
        named: e.named,
        listId: e.slot?.listId,
      });
      if (e.list) {
        this.lists.set(e.id, {
          container: new WeakRef(e.list.container),
          containerPath: body
            ? domPath(e.list.container, body, openClosed)
            : null,
          sig: e.list.sig,
          exemplarEl: new WeakRef(e.list.exemplarEl),
          slotIds: [],
          slots: new Map(),
        });
      }
    }
    // Slot paths, relative to the exemplar member.
    for (const e of entries) {
      if (!e.slot) continue;
      const list = this.lists.get(e.slot.listId);
      const member = list?.exemplarEl.deref();
      if (!list || !member) continue;
      const steps = e.el === member ? [] : domPath(e.el, member, openClosed);
      if (!steps) continue;
      list.slotIds.push(e.id);
      list.slots.set(e.id, {
        el: new WeakRef(e.el),
        steps,
        cls: classTokens(e.el),
        kind: e.kind,
        pat: e.slot.pat,
        hoveronly: e.slot.hoveronly,
        role: e.slot.role,
      });
    }
  }

  element(id: string): Element | null {
    const el = this.nodes.get(id)?.el.deref();
    return el && el.isConnected ? el : null;
  }

  private container(listId: string): Element | null {
    const list = this.lists.get(listId);
    if (!list) return null;
    const cur = list.container.deref();
    if (cur && cur.isConnected) return cur;
    // Re-rendered: find the container again by its path, and accept it
    // only if it still holds members of the same template.
    const body = this.doc.body;
    if (!body || !list.containerPath) return null;
    const hits = matchPath(body, list.containerPath, this.openClosed, 2);
    const found = hits.length === 1 ? hits[0] : null;
    if (
      !found ||
      !composedKids(found, this.openClosed).some((k) =>
        matchesTemplate(k, list.sig),
      )
    )
      return null;
    list.container = new WeakRef(found);
    return found;
  }

  members(listId: string): Element[] {
    const list = this.lists.get(listId);
    const c = this.container(listId);
    if (!list || !c) return [];
    return composedKids(c, this.openClosed).filter(
      (k) => matchesTemplate(k, list.sig) && isVisible(k),
    );
  }

  slot(listId: string, member: Element, slotId: string): Element | null {
    const list = this.lists.get(listId);
    const s = list?.slots.get(slotId);
    if (!list || !s || !member.isConnected) return null;
    const known = s.el.deref();
    if (
      known &&
      known.isConnected &&
      member === list.exemplarEl.deref() &&
      composedIncludes(member, known, this.openClosed)
    )
      return known;
    if (s.steps.length === 0) return member;
    // A hit must carry one of the slot's classes: in a row with a leading
    // optional part (a label badge before the subject) the indexed sibling
    // is that part, not the slot.
    const classed = (el: Element): boolean =>
      s.cls.length === 0 || classTokens(el).some((c) => s.cls.includes(c));
    const hits = matchPath(member, s.steps, this.openClosed, 2, 4000, classed);
    if (hits.length === 1) return hits[0] as Element;
    if (hits.length > 1) return null;
    // Signature fallback: the one element in this record with the slot's
    // tag, role and classes whose ancestors best agree with the path.
    const last = s.steps[s.steps.length - 1] as string;
    const sig = parseStep(last).sig;
    const ok = (el: Element): boolean => stepSig(el) === sig && classed(el);
    const found = suffixMatch(member, s.steps, ok, 1, this.openClosed);
    if (found || s.cls.length === 0) return found;
    // Classes that differ from record to record (Gmail's read and unread
    // sender spans): the plain path decides, unless what it leads to is
    // another slot's element (the subject, for a row without a badge).
    const plain = matchPath(member, s.steps, this.openClosed, 2);
    if (plain.length !== 1) return null;
    const el = plain[0] as Element;
    const cls = classTokens(el);
    for (const [id, o] of list.slots)
      if (id !== slotId && o.cls.some((c) => cls.includes(c))) return null;
    return el;
  }

  isAd(listId: string, member: Element): boolean {
    if (!this.lists.has(listId) || !member.isConnected) return false;
    return isAdRecord(member);
  }

  text(el: Element): string {
    return visibleText(el, { openClosed: this.openClosed });
  }

  name(el: Element): string {
    return accessibleName(el, this.openClosed);
  }

  media(el: Element): MediaInfo {
    return mediaInfo(el);
  }

  href(el: Element): string | null {
    return linkHref(el);
  }

  recordKey(listId: string, member: Element): string {
    const own = this.idAttrKey(listId, member);
    if (own) return `k${cyrb53(own).toString(36)}`;
    const link = this.linkKey(member);
    if (link) return `k${cyrb53(link).toString(36)}`;
    return `t${this.fingerprint(listId, member).slice(1)}`;
  }

  /** Up to three same-template neighbours on each side (to check an id is unique). */
  private neighbours(listId: string, member: Element): Element[] {
    const list = this.lists.get(listId);
    if (!list) return [];
    const out: Element[] = [];
    const walk = (next: (e: Element) => Element | null): void => {
      let found = 0;
      for (
        let n = next(member), i = 0;
        n && i < 8 && found < 3;
        n = next(n), i++
      ) {
        if (!matchesTemplate(n, list.sig)) continue;
        out.push(n);
        found++;
      }
    };
    walk((e) => e.previousElementSibling);
    walk((e) => e.nextElementSibling);
    return out;
  }

  /** An id carried by the record (data-*-id on it or inside it, or a stable id attribute). */
  private idAttrKey(listId: string, member: Element): string | null {
    const siblings = this.neighbours(listId, member);
    const unique = (name: string, value: string): boolean =>
      !siblings.some(
        (s) =>
          s.getAttribute(name) === value ||
          s.querySelector(`[${CSS.escape(name)}="${CSS.escape(value)}"]`) !==
            null,
      );
    const fromAttrs = (el: Element): string | null => {
      for (const a of el.attributes) {
        if (!ID_ATTR.test(a.name) || NOT_ID_ATTR.test(a.name)) continue;
        const v = a.value.trim();
        if (!v || v.length > 200) continue;
        if (unique(a.name, v)) return `${a.name}=${v}`;
      }
      return null;
    };
    const own = fromAttrs(member);
    if (own) return own;
    const inner = member.querySelector(ID_DESCENDANT);
    if (inner) {
      const v = fromAttrs(inner);
      if (v) return v;
    }
    const id = member.id;
    if (id && id.length <= 120 && !VOLATILE_ID.test(id)) {
      if (!siblings.some((s) => s.id === id)) return `id=${id}`;
    }
    return null;
  }

  /** The item id in the record's main link: an id-like query value, else the path. */
  private linkKey(member: Element): string | null {
    const a =
      (member.matches('a[href]') ? member : null) ??
      member.querySelector('a[href]');
    if (!a) return null;
    let u: URL;
    try {
      u = new URL(a.getAttribute('href') ?? '', this.doc.baseURI);
    } catch {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const params: string[] = [];
    for (const [k, v] of u.searchParams)
      if (ID_PARAM.test(k)) params.push(`${k}=${v}`);
    if (params.length) return `${u.pathname}?${params.sort().join('&')}`;
    if (u.pathname === '/' || u.pathname === '') return null;
    return u.pathname;
  }

  fingerprint(listId: string, member: Element): string {
    const list = this.lists.get(listId);
    const parts: string[] = [];
    if (list) {
      for (const id of list.slotIds) {
        const s = list.slots.get(id) as SlotRec;
        // Leave out what changes by itself: timestamps, counts, durations,
        // toggling button labels and hover-only actions.
        if (s.hoveronly || s.kind === 'collection') continue;
        if (s.pat?.some((p) => VOLATILE_PATTERNS.has(p))) continue;
        if (s.kind === 'control' && s.role !== 'link') continue;
        if (s.kind === 'input' || s.kind === 'group' || s.kind === 'landmark')
          continue;
        const el = this.slot(listId, member, id);
        if (!el) continue;
        const t =
          s.kind === 'media'
            ? mediaInfo(el).alt
            : visibleText(el, { max: 300, openClosed: this.openClosed });
        if (t) parts.push(t);
      }
    }
    if (parts.length === 0)
      parts.push(
        visibleText(member, { max: 400, openClosed: this.openClosed }),
      );
    return `f${cyrb53(parts.join(SEP)).toString(36)}`;
  }

  locator(id: string): Locator {
    const rec = this.nodes.get(id);
    const el = rec?.el.deref();
    const body = this.doc.body;
    const kind = rec?.kind ?? 'group';
    if (!rec || !el || !el.isConnected || !body) return { path: [], kind };
    const path = el === body ? [] : (domPath(el, body, this.openClosed) ?? []);
    const loc: Locator = { path, kind };
    if (rec.listId) {
      const list = this.lists.get(rec.listId);
      const s = list?.slots.get(id);
      if (s) loc.slot = [...s.steps];
      // Names differ from record to record: slots carry none.
      return loc;
    }
    if (rec.named) {
      const h = nameHash(accessibleName(el, this.openClosed));
      if (h) loc.name = h;
    }
    return loc;
  }

  resolve(locator: Locator, within?: Element | null): Element | null {
    const body = this.doc.body;
    if (!body || !Array.isArray(locator.path)) return null;
    const scope = within && within.isConnected ? within : null;
    const oc = this.openClosed;
    const named = (el: Element): boolean =>
      !locator.name || nameHash(accessibleName(el, oc)) === locator.name;
    // A slot inside the record it was asked about.
    if (scope && locator.slot) {
      if (locator.slot.length === 0) return scope;
      const hits = matchPath(scope, locator.slot, oc, 2);
      if (hits.length === 1) return hits[0] as Element;
      if (hits.length > 1) return null;
    }
    if (locator.path.length === 0) return null;
    // The full path, inside the scope when one is given.
    const hits = matchPath(body, locator.path, oc, 4).filter(
      (el) => named(el) && (!scope || composedIncludes(scope, el, oc)),
    );
    if (hits.length === 1) return hits[0] as Element;
    if (hits.length > 1) return null;
    // Ancestors changed: match the path's tail inside the scope (or page),
    // and require a name match or most of the path to agree.
    const minScore = locator.name ? 1 : Math.min(3, locator.path.length);
    return suffixMatch(scope ?? body, locator.path, named, minScore, oc);
  }
}
