import type { Skeleton, SpecCollection } from '@webable/core';

import type { FitViewOpenReply, FitViewUnavailable } from '../../protocol';
import { composedParent, isOurs, shadowRootsWithin } from '../util/dom';
import { nextFrame } from '../util/schedule';
import { contentY, type Positions, scrollContainer } from './locate';
import type { ProxyLayer } from './proxy';
import type { FitViewOpenInput, SkeletonRegistry, ViewSurface } from './types';

/**
 * Keeping Fit view live (docs/10 §4.5).
 *
 *   Records    one MutationObserver per collection (and its shadow roots),
 *              batched per frame. Only changed record roots are re-read,
 *              within 4 ms a frame; a record whose fingerprint differs from
 *              what the view shows, new records and newly loaded media make
 *              the view patch that list (surface.patchRecords). Scroll and
 *              focus are the view's and never jump.
 *   Loading    the original stays laid out under the view. When the view
 *              nears records whose media has not loaded, or the end of a
 *              list, the hidden page is scrolled there so the site loads
 *              them (lazy images, infinite lists).
 *   Media      anything that starts playing under the view is paused.
 *   Routes     a proxied navigation shows "Loading" at once and re-reads once
 *              the DOM is quiet (~400 ms); SPA routes from the engine and
 *              Gmail-style hash routes (#inbox/...) re-read too. A page that
 *              cannot be re-presented closes the view with one line.
 *   Scroll     the view's place is kept per history entry by record key, so
 *              Back lands on the same card; closing scrolls the original to
 *              the record that was in view.
 */

const FRAME_BUDGET_MS = 4;
const QUIET_MS = 400;
const QUIET_MAX_MS = 4000;
/** A proxied navigation that changed this little (and not the URL) did not navigate. */
const SMALL_CHANGE = 12;
const DRIVE_EVERY_MS = 300;
/** "One chunk ahead": records past the view's frontier checked for unloaded media. */
const AHEAD = 8;
/** At most this many records are checked for unloaded media per drive. */
const SCAN_MAX = 60;
const SCROLL_SAVE_MS = 150;

const SYNC_ATTRS = [
  'src',
  'srcset',
  'data-src',
  'poster',
  'style',
  'class',
  'hidden',
  'href',
  'title',
  'alt',
  'aria-label',
  'aria-pressed',
  'aria-checked',
  'aria-selected',
  'aria-current',
  'aria-expanded',
  'aria-disabled',
  'disabled',
  'datetime',
];
const MEDIA_ATTRS = new Set(['src', 'srcset', 'data-src', 'poster']);

export const SYNC_COPY = {
  video: 'Videos play best on the original page',
  answer: "Answer the page's message first",
  original: 'This page works best as the original',
} as const;

type OpenReply = Extract<FitViewOpenReply, { ok: true }>;

export interface SyncHost {
  win: Window;
  surface: ViewSurface;
  input(): FitViewOpenInput;
  proxies: ProxyLayer;
  positions: Positions;
  peeking(): boolean;
  /** Point the live layer at a re-read page (before the view re-renders). */
  rebind(next: FitViewOpenInput): void;
  notice(owner: string, text: string | null): void;
}

/** The line shown when a page cannot be re-presented. */
export function unavailableCopy(
  why: FitViewUnavailable,
  skeleton: Skeleton | null,
): string {
  if (why === 'blocked_overlay') return SYNC_COPY.answer;
  const vw = skeleton?.viewport.width ?? 0;
  const video = skeleton?.nodes.some(
    (n) =>
      n.tag === 'video' &&
      (n.flags.includes('playing') || n.box[2] >= 0.4 * vw),
  );
  return video ? SYNC_COPY.video : SYNC_COPY.original;
}

/** A Gmail-style hash route: a fragment that names no element on the page. */
export function isHashRoute(doc: Document, hash: string): boolean {
  const id = hash.replace(/^#/, '');
  if (!id) return true;
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // keep raw
  }
  return (
    !doc.getElementById(decoded) && doc.getElementsByName(decoded).length === 0
  );
}

interface NavigationLike {
  currentEntry?: { key?: string } | null;
}

interface Anchor {
  listId: string;
  key: string;
  /** Control top relative to the scroller's top. */
  offset: number;
  scrollTop: number;
}

/** Index of the member with `key`, searching outward from `guess`. */
function findMember(
  reg: SkeletonRegistry,
  listId: string,
  members: Element[],
  key: string,
  guess: number,
): number {
  const g = Math.max(0, Math.min(members.length - 1, guess));
  for (let d = 0; d < members.length; d++) {
    for (const j of d === 0 ? [g] : [g + d, g - d]) {
      const m = members[j];
      if (m && reg.recordKey(listId, m) === key) return j;
    }
    if (g + d >= members.length - 1 && g - d <= 0) break;
  }
  return -1;
}

function openClosed(): ((el: Element) => ShadowRoot | null) | undefined {
  const api = (
    globalThis as {
      chrome?: {
        dom?: {
          openOrClosedShadowRoot?: (el: HTMLElement) => ShadowRoot | null;
        };
      };
    }
  ).chrome?.dom?.openOrClosedShadowRoot;
  if (!api) return undefined;
  return (el) => {
    try {
      return el instanceof HTMLElement ? api(el) : null;
    } catch {
      return null;
    }
  };
}

export class LiveSync {
  // records
  private observers: MutationObserver[] = [];
  private readonly containers = new Map<string, Element>();
  private readonly dirty = new Map<string, Set<Element>>();
  private readonly added = new Map<string, Set<Element>>();
  private readonly media = new Map<string, Set<Element>>();
  private readonly structural = new Set<string>();
  private pending = false;
  // lazy loading
  private io: IntersectionObserver | null = null;
  private watched = new WeakMap<Element, { listId: string; key: string }>();
  private readonly near = new Map<string, Set<string>>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastDrive = 0;
  private driveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScrolled: Element | null = null;
  // routes
  private gen = 0;
  private loading = false;
  private quiet: {
    mo: MutationObserver;
    timer: ReturnType<typeof setTimeout>;
    max: ReturnType<typeof setTimeout>;
  } | null = null;
  private readUrl: string;
  private reading = false;
  private again = false;
  private unsubRoute: (() => void) | null = null;
  // scroll memory
  private readonly memory = new Map<string, Anchor>();
  private lastAnchor: Anchor | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveEntry = '';
  private disposed = false;
  private readonly off: Array<() => void> = [];

  constructor(private readonly host: SyncHost) {
    this.readUrl = host.win.location.href;
    this.observeRecords();
    this.startLazy();
    this.guardMedia();
    this.followRoutes();
    this.trackScroll();
    void nextFrame().then(() => this.save());
  }

  // -- Records ---------------------------------------------------------------

  private get reg(): SkeletonRegistry {
    return this.host.input().registry;
  }

  private collections(): SpecCollection[] {
    return this.host.input().reply.envelope.validated.spec.collections;
  }

  /** Collection containers the view shows as records. */
  shownContainers(): Element[] {
    return [...this.containers.values()].filter((c) => c.isConnected);
  }

  private observeRecords(): void {
    for (const c of this.collections()) this.observeList(c.list_id);
  }

  /** The element holding a list's records (re-found when the site re-renders it). */
  private containerOf(listId: string): Element | null {
    return (
      this.reg.element(listId) ??
      this.reg.members(listId)[0]?.parentElement ??
      null
    );
  }

  private observeList(listId: string): void {
    const el = this.containerOf(listId);
    if (!el) return;
    this.containers.set(listId, el);
    const mo = new MutationObserver((records) =>
      this.records(listId, el, records),
    );
    const opts: MutationObserverInit = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: SYNC_ATTRS,
    };
    mo.observe(el, opts);
    for (const sr of shadowRootsWithin(el, openClosed(), 30))
      mo.observe(sr, opts);
    // The site may replace the whole list (a re-render): follow it.
    const parent = el.parentNode;
    if (parent) mo.observe(parent, { childList: true });
    this.observers.push(mo);
  }

  /** A list's container left the page: observe its replacement and redraw. */
  private reacquire(listId: string): void {
    const old = this.containers.get(listId);
    const next = this.containerOf(listId);
    if (!next || next === old) return;
    this.observeList(listId);
    this.structural.add(listId);
  }

  private set(map: Map<string, Set<Element>>, listId: string): Set<Element> {
    let s = map.get(listId);
    if (!s) map.set(listId, (s = new Set()));
    return s;
  }

  private records(
    listId: string,
    container: Element,
    records: MutationRecord[],
  ): void {
    if (!container.isConnected) {
      this.reacquire(listId);
      this.schedule();
      return;
    }
    for (const r of records) {
      const t = r.target;
      const el =
        t.nodeType === Node.ELEMENT_NODE ? (t as Element) : t.parentElement;
      if (!el || isOurs(el)) continue;
      if (r.type === 'childList') {
        if (el === container) this.structural.add(listId);
        for (const n of Array.from(r.addedNodes))
          if (n.nodeType === Node.ELEMENT_NODE)
            this.set(this.added, listId).add(n as Element);
        if (r.removedNodes.length && el === container)
          this.structural.add(listId);
      }
      if (
        r.type === 'attributes' &&
        r.attributeName &&
        MEDIA_ATTRS.has(r.attributeName)
      )
        this.set(this.media, listId).add(el);
      this.set(this.dirty, listId).add(el);
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.pending || this.disposed) return;
    this.pending = true;
    void nextFrame().then(() => {
      this.pending = false;
      this.flush();
    });
  }

  /** The member (record root) a node belongs to. */
  private memberOf(
    node: Element,
    members: Set<Element>,
    container: Element,
  ): Element | null {
    for (
      let n: Element | null = node;
      n && n !== container;
      n = composedParent(n)
    )
      if (members.has(n)) return n;
    return null;
  }

  private flush(): void {
    if (this.disposed) return;
    const start = performance.now();
    const changed = new Set<string>(this.structural);
    this.structural.clear();
    let over = false;
    for (const [listId, nodes] of this.dirty) {
      if (nodes.size === 0) continue;
      const container = this.containers.get(listId);
      if (!container) {
        nodes.clear();
        continue;
      }
      const memberList = this.reg.members(listId);
      const members = new Set(memberList);
      const added = this.added.get(listId);
      const media = this.media.get(listId);
      const touched = new Map<Element, { media: boolean; added: boolean }>();
      for (const n of nodes) {
        const m = this.memberOf(n, members, container);
        if (!m) continue;
        const t = touched.get(m) ?? { media: false, added: false };
        if (media?.has(n)) t.media = true;
        touched.set(m, t);
      }
      if (added)
        for (const a of added) {
          if (members.has(a)) touched.set(a, { media: false, added: true });
          else if (memberList.some((m) => a.contains(m))) changed.add(listId);
        }
      nodes.clear();
      added?.clear();
      media?.clear();
      const sc = memberList[0] ? scrollContainer(memberList[0]) : null;
      for (const [m, t] of touched) {
        if (performance.now() - start > FRAME_BUDGET_MS) {
          // Over budget: the rest waits for the next frame.
          nodes.add(m);
          if (t.media) this.set(this.media, listId).add(m);
          if (t.added) this.set(this.added, listId).add(m);
          over = true;
          continue;
        }
        const key = this.reg.recordKey(listId, m);
        if (sc) this.host.positions.note(listId, key, contentY(m, sc));
        const shown = this.host.proxies.shownFingerprint(listId, key);
        if (t.added && shown === undefined) {
          changed.add(listId);
          continue;
        }
        // Records the view has not drawn yet are read live when it does.
        if (shown === undefined) continue;
        if (t.media || shown !== this.reg.fingerprint(listId, m))
          changed.add(listId);
      }
    }
    for (const listId of changed) this.host.surface.patchRecords(listId);
    if (over) this.schedule();
    if (changed.size) this.refreshWatched();
  }

  // -- Lazy media and infinite lists ----------------------------------------

  private startLazy(): void {
    if (typeof IntersectionObserver !== 'function') return;
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const w = this.watched.get(e.target);
          if (!w) continue;
          let set = this.near.get(w.listId);
          if (!set) this.near.set(w.listId, (set = new Set()));
          if (e.isIntersecting) set.add(w.key);
          else set.delete(w.key);
        }
        this.requestDrive();
      },
      { root: this.host.surface.scroller, rootMargin: '0px 0px 150% 0px' },
    );
    this.refreshWatched();
    this.refreshTimer = setInterval(() => this.refreshWatched(), 1000);
  }

  /** Watch one control per rendered record (WP5 renders records lazily). */
  private refreshWatched(): void {
    if (!this.io) return;
    for (const r of this.host.proxies.representatives()) {
      if (this.watched.has(r.control)) continue;
      this.watched.set(r.control, { listId: r.listId, key: r.key });
      this.io.observe(r.control);
    }
  }

  private requestDrive(): void {
    if (this.driveTimer || this.disposed) return;
    const wait = Math.max(
      0,
      DRIVE_EVERY_MS - (performance.now() - this.lastDrive),
    );
    this.driveTimer = setTimeout(() => {
      this.driveTimer = null;
      this.drive();
    }, wait);
  }

  /** Scroll the hidden original so the site loads what the view is about to need. */
  private drive(): void {
    if (this.disposed || this.host.peeking()) return;
    this.lastDrive = performance.now();
    const reg = this.reg;
    for (const c of this.collections()) {
      const near = this.near.get(c.list_id);
      if (!near || near.size === 0) continue;
      const order = this.host.proxies.order(c.list_id);
      let first = Number.POSITIVE_INFINITY;
      let frontier = -1;
      for (const k of near) {
        const i = order.indexOf(k);
        if (i < 0) continue;
        first = Math.min(first, i);
        frontier = Math.max(frontier, i);
      }
      const fkey = order[frontier];
      const skey = order[first];
      if (fkey === undefined || skey === undefined) continue;
      const members = reg.members(c.list_id);
      if (members.length === 0) continue;
      // The view keeps document order, so its indexes are good first guesses.
      const end = findMember(reg, c.list_id, members, fkey, frontier);
      if (end < 0) continue;
      const start = Math.max(
        0,
        findMember(reg, c.list_id, members, skey, first),
      );
      // Records in or near the view whose media has not loaded, earliest first.
      const thumb = c.fields.find((f) => f.role === 'thumbnail')?.slot_id;
      let target: Element | null = null;
      if (thumb) {
        const from = Math.min(start, end);
        for (const m of members.slice(
          from,
          Math.min(end + 1 + AHEAD, from + SCAN_MAX),
        )) {
          const slot = reg.slot(c.list_id, m, thumb);
          if (slot && !reg.media(slot).src) {
            target = m;
            break;
          }
        }
      }
      // Near the end of what the page has: bring its end into view (infinite lists).
      const last = members[members.length - 1] ?? null;
      if (!target && end >= members.length - AHEAD) target = last;
      if (!target || target === this.lastScrolled) continue;
      this.lastScrolled = target;
      target.scrollIntoView({
        block: 'start',
        inline: 'nearest',
        behavior: 'instant',
      });
      // Keep going while the view still needs things loaded.
      this.requestDrive();
      return; // one scroll per drive
    }
  }

  // -- Media -----------------------------------------------------------------

  private guardMedia(): void {
    const doc = this.host.win.document;
    const onPlay = (e: Event): void => {
      if (e.target instanceof HTMLMediaElement) this.pause(e.target);
    };
    doc.addEventListener('play', onPlay, true);
    doc.addEventListener('playing', onPlay, true);
    this.off.push(() => {
      doc.removeEventListener('play', onPlay, true);
      doc.removeEventListener('playing', onPlay, true);
    });
    this.pauseAll();
  }

  /** Pause everything playing under the view (open, and after a peek ends). */
  pauseAll(): void {
    const doc = this.host.win.document;
    for (const m of Array.from(doc.querySelectorAll('video, audio')))
      this.pause(m as HTMLMediaElement);
  }

  private pause(m: HTMLMediaElement): void {
    // During a peek the person is on the page and may play things there.
    if (this.disposed || this.host.peeking() || m.paused || isOurs(m)) return;
    try {
      m.pause();
    } catch {
      // Some players throw while loading; the next play event retries.
    }
  }

  // -- Routes ----------------------------------------------------------------

  private followRoutes(): void {
    const win = this.host.win;
    this.unsubRoute = this.host.input().engine.onRoute(() => this.route());
    const onHash = (): void => {
      if (isHashRoute(win.document, win.location.hash)) this.waitQuiet(false);
    };
    win.addEventListener('hashchange', onHash);
    this.off.push(() => win.removeEventListener('hashchange', onHash));
  }

  /** A proxied link, record or search: show loading now, re-read once quiet. */
  navigating(): void {
    if (this.disposed) return;
    this.setLoading(true);
    this.waitQuiet(true);
  }

  /** The engine saw an SPA route (already debounced): re-read now. */
  private route(): void {
    if (this.disposed) return;
    this.stopQuiet();
    void this.reRead();
  }

  private setLoading(on: boolean): void {
    if (this.loading === on) return;
    this.loading = on;
    this.host.surface.loading(on);
  }

  private waitQuiet(proxied: boolean): void {
    if (this.reading) {
      this.again = true;
      return;
    }
    const doc = this.host.win.document;
    let changes = 0;
    const done = (): void => {
      this.stopQuiet();
      const url = this.host.win.location.href;
      if (proxied && url === this.readUrl && changes < SMALL_CHANGE) {
        this.setLoading(false); // nothing navigated (a new tab, an in-page anchor)
        return;
      }
      void this.reRead();
    };
    if (this.quiet) {
      clearTimeout(this.quiet.timer);
      this.quiet.timer = setTimeout(done, QUIET_MS);
      return;
    }
    const mo = new MutationObserver((records) => {
      let mine = true;
      for (const r of records) {
        const t = r.target;
        const el =
          t.nodeType === Node.ELEMENT_NODE ? (t as Element) : t.parentElement;
        if (el && isOurs(el)) continue;
        mine = false;
        changes +=
          r.addedNodes.length +
          r.removedNodes.length +
          (r.type === 'characterData' ? 1 : 0);
      }
      if (mine || !this.quiet) return;
      clearTimeout(this.quiet.timer);
      this.quiet.timer = setTimeout(done, QUIET_MS);
    });
    mo.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    this.quiet = {
      mo,
      timer: setTimeout(done, QUIET_MS),
      max: setTimeout(done, QUIET_MAX_MS),
    };
  }

  private stopQuiet(): void {
    if (!this.quiet) return;
    this.quiet.mo.disconnect();
    clearTimeout(this.quiet.timer);
    clearTimeout(this.quiet.max);
    this.quiet = null;
  }

  /** Read the page again and re-render the view, or close it with one line. */
  private async reRead(retry = true): Promise<void> {
    if (this.disposed) return;
    const gen = ++this.gen;
    this.reading = true;
    this.again = false;
    this.setLoading(true);
    const engine = this.host.input().engine;
    let skeleton: Skeleton | null = null;
    try {
      const res = await engine.skeleton();
      if (gen !== this.gen || this.disposed) return;
      if (!res) {
        this.unavailable('not_representable', null);
        return;
      }
      skeleton = res.skeleton;
      const reply = await engine.send({
        type: 'cs:fitview-request',
        skeleton: res.skeleton,
        reason: 'route',
      });
      if (gen !== this.gen || this.disposed) return;
      if (!reply.ok) {
        if (reply.why === 'stale' && retry) {
          this.reading = false;
          return this.reRead(false);
        }
        this.unavailable(reply.why, skeleton);
        return;
      }
      const next: FitViewOpenInput = {
        reply: reply as OpenReply,
        skeleton: res.skeleton,
        registry: res.registry,
        engine,
        reason: 'route',
      };
      this.readUrl = this.host.win.location.href;
      this.host.rebind(next);
      this.host.surface.replace(next);
      this.setLoading(false);
      this.refreshWatched();
      this.restoreScroll();
    } catch {
      if (gen !== this.gen || this.disposed) return;
      this.setLoading(false);
      this.host.surface.close('error');
      return;
    } finally {
      if (gen === this.gen) this.reading = false;
    }
    if (this.again && !this.disposed) this.waitQuiet(false);
  }

  private unavailable(
    why: FitViewUnavailable,
    skeleton: Skeleton | null,
  ): void {
    this.setLoading(false);
    this.host.notice('route', unavailableCopy(why, skeleton));
    this.host.surface.close(why === 'error' ? 'error' : 'not_representable');
  }

  /** The live layer was re-bound to a new read: observe the new collections. */
  rebind(): void {
    for (const mo of this.observers) mo.disconnect();
    this.observers = [];
    this.containers.clear();
    this.dirty.clear();
    this.added.clear();
    this.media.clear();
    this.structural.clear();
    this.near.clear();
    this.lastScrolled = null;
    // Controls the view keeps across the re-render are observed afresh.
    this.io?.disconnect();
    this.watched = new WeakMap();
    this.observeRecords();
    this.refreshWatched();
  }

  // -- Scroll memory -----------------------------------------------------------

  private entryKey(): string {
    const nav = (this.host.win as Window & { navigation?: NavigationLike })
      .navigation;
    return nav?.currentEntry?.key ?? this.host.win.location.href;
  }

  private trackScroll(): void {
    const scroller = this.host.surface.scroller;
    const onScroll = (): void => {
      // A re-render under way scrolls the view; that is not the person.
      if (this.reading || this.loading) return;
      // Saved under the entry the person scrolled in, never a later one.
      const entry = this.entryKey();
      if (this.saveTimer) {
        if (entry === this.saveEntry) return;
        clearTimeout(this.saveTimer);
      }
      this.saveEntry = entry;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.save(entry);
      }, SCROLL_SAVE_MS);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    this.off.push(() => scroller.removeEventListener('scroll', onScroll));
  }

  private save(entry = this.entryKey()): void {
    if (this.disposed || this.reading || this.loading) return;
    // The view moved to another entry before the timer fired: what is
    // drawn now belongs to that entry, not to this one.
    if (entry !== this.entryKey()) return;
    const a = this.anchor();
    if (a) this.lastAnchor = a;
    this.memory.set(
      entry,
      a ?? {
        listId: '',
        key: '',
        offset: 0,
        scrollTop: this.host.surface.scroller.scrollTop,
      },
    );
  }

  /** The first record at or below the top of the view. */
  private anchor(): Anchor | null {
    const scroller = this.host.surface.scroller;
    const top = scroller.getBoundingClientRect().top;
    let best: { listId: string; key: string; y: number } | null = null;
    for (const r of this.host.proxies.representatives()) {
      const rect = r.control.getBoundingClientRect();
      if (rect.bottom <= top || rect.height === 0) continue;
      if (!best || rect.top < best.y)
        best = { listId: r.listId, key: r.key, y: rect.top };
    }
    if (!best) return null;
    return {
      listId: best.listId,
      key: best.key,
      offset: best.y - top,
      scrollTop: scroller.scrollTop,
    };
  }

  /** Back/Forward: return to the record the person was at on this entry. */
  private restoreScroll(): void {
    const a = this.memory.get(this.entryKey());
    if (!a) return;
    void nextFrame().then(() => {
      if (this.disposed) return;
      const scroller = this.host.surface.scroller;
      const rep = a.key
        ? this.host.proxies.representatives().find((r) => r.key === a.key)
        : undefined;
      if (rep) {
        const top = scroller.getBoundingClientRect().top;
        scroller.scrollTop +=
          rep.control.getBoundingClientRect().top - top - a.offset;
      } else scroller.scrollTop = a.scrollTop;
    });
  }

  /** Closing: put the original at the record that was in view. */
  scrollOriginalToAnchor(): void {
    const a = this.anchor() ?? this.lastAnchor;
    if (!a) return;
    const reg = this.reg;
    for (const c of this.collections()) {
      for (const m of reg.members(c.list_id)) {
        if (reg.recordKey(c.list_id, m) !== a.key) continue;
        m.scrollIntoView({
          block: 'start',
          inline: 'nearest',
          behavior: 'instant',
        });
        return;
      }
    }
  }

  // -- Lifecycle ---------------------------------------------------------------

  dispose(): void {
    this.disposed = true;
    this.gen++;
    for (const mo of this.observers) mo.disconnect();
    this.observers = [];
    this.io?.disconnect();
    this.io = null;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.driveTimer) clearTimeout(this.driveTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.stopQuiet();
    this.unsubRoute?.();
    for (const f of this.off.splice(0)) f();
  }
}
