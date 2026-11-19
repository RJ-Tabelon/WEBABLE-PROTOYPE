/**
 * WP6 harness: Fit view's live layer (proxies, sync, peek, status, firewall,
 * key bridge) on fixture pages, without the service worker or the real
 * renderer. Load it FIRST in a fixture's <head> (before the page's own
 * scripts), as engine.js is at document_start: it installs the input
 * firewall and the MAIN-world key bridge at once.
 *
 *   window.__live.open()   renders a minimal stand-in ViewSurface (a closed
 *                          shadow root with a modal <dialog>) from the
 *                          fixture's markup and starts createLive on it.
 *
 * Fixture conventions (read by the fake SkeletonRegistry):
 *   [data-id="eN"]          a node; [data-proxy=link|button|toggle|input|
 *                           select|none] renders a proxied control for it
 *   [data-scope]            a section container (ProxyTarget.scopeId)
 *   [data-list="eN"]        a collection; its records are :scope > [data-key]
 *                           (data-open names the open slot, data-thumb the
 *                           thumbnail slot)
 *   [data-slot="name"]      a slot inside a record (data-proxy as above)
 *   window.__records[list]  a full record model for virtual lists
 *                           ({key, slots:[{slot, role, label, href?}]})
 *
 * Every view control carries data-v (a node id, `${key}:${slot}`,
 * `sheet:i`, `status:i:j` or `back`) for the tests to find it.
 */
import type {
  FitLayout,
  Locator,
  PageSpec,
  Skeleton,
  SkeletonNode,
  SpecEnvelope,
} from '@webable/core';
import { SKELETON_VERSION } from '@webable/core/versions';

import { installKeyBridge } from '../../../entrypoints/keybridge.content';
import {
  createViewRouter,
  installFirewall,
  type ViewRouter,
} from '../../../lib/engine/fitview/firewall';
import {
  createLiveLayer,
  type LiveLayerImpl,
} from '../../../lib/engine/fitview/live';
import {
  FIREWALL_KEY,
  type EngineApi,
  type FitViewOpenInput,
  type FirewallTarget,
  type MediaInfo,
  type ProxyRole,
  type ProxyTarget,
  type SkeletonRegistry,
  type StatusLine,
  type ViewSurface,
} from '../../../lib/engine/fitview/types';
import type { ContentToWorker, FitViewOpenReply } from '../../../lib/protocol';

installFirewall(window);
installKeyBridge(window);

// ---------------------------------------------------------------------------
// Fake registry over the fixture's data attributes
// ---------------------------------------------------------------------------

interface ModelSlot {
  slot: string;
  role: ProxyRole | 'text';
  label: string;
  href?: string;
}
interface ModelRecord {
  key: string;
  slots: ModelSlot[];
}
type W = Window & {
  __records?: Record<string, ModelRecord[]>;
  __live?: unknown;
};

const clean = (s: string | null | undefined): string =>
  (s ?? '').replace(/\s+/g, ' ').trim();

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const fingerprintOf = (labels: string[]): string =>
  hash(labels.join('|'));

let extraction = 0;

function makeRegistry(): SkeletonRegistry {
  const id = `x-${++extraction}`;
  const list = (listId: string): Element | null =>
    document.querySelector(`[data-list="${listId}"]`);
  const text = (el: Element): string => clean((el as HTMLElement).innerText);
  const reg: SkeletonRegistry = {
    extractionId: id,
    element: (nodeId) =>
      document.querySelector(`[data-id="${nodeId}"]`) ?? list(nodeId),
    members: (listId) => {
      const c = list(listId);
      return c ? Array.from(c.querySelectorAll(':scope > [data-key]')) : [];
    },
    slot: (_listId, member, slotId) =>
      member.matches(`[data-slot="${slotId}"]`)
        ? member
        : member.querySelector(`[data-slot="${slotId}"]`),
    text,
    name: (el) =>
      clean(el.getAttribute('aria-label')) ||
      text(el) ||
      clean((el as HTMLInputElement).placeholder) ||
      clean(el.getAttribute('title')),
    media: (el): MediaInfo => {
      const img = el instanceof HTMLImageElement ? el : el.querySelector('img');
      return {
        src: img?.getAttribute('src') || null,
        srcset: null,
        width: img?.width ?? 0,
        height: img?.height ?? 0,
        alt: img?.alt ?? '',
      };
    },
    href: (el) => {
      if (!(el instanceof HTMLAnchorElement) || !el.hasAttribute('href'))
        return null;
      return /^(https?|mailto|tel):/.test(el.href) ? el.href : null;
    },
    recordKey: (_listId, member) => (member as HTMLElement).dataset.key ?? '',
    fingerprint: (_listId, member) =>
      fingerprintOf(
        Array.from(member.querySelectorAll('[data-slot]')).map((s) => text(s)),
      ),
    locator: (nodeId): Locator => ({
      path: [nodeId],
      kind: 'control',
      name: nodeId,
    }),
    resolve: (loc, within) => {
      const all = (within ?? document).querySelectorAll(
        `[data-id="${loc.name ?? ''}"]`,
      );
      return all.length === 1 ? (all[0] as Element) : null;
    },
  };
  return reg;
}

// ---------------------------------------------------------------------------
// Fake engine and worker replies
// ---------------------------------------------------------------------------

interface Config {
  /** patchRecords re-renders the list (false: only logs, a lagging view). */
  patch: boolean;
  /** Reply to cs:fitview-request after a route (default: ok). */
  routeReply: FitViewOpenReply | null;
}

const config: Config = { patch: true, routeReply: null };
const sent: Array<{ type: string; detail?: unknown }> = [];
const routeCbs = new Set<() => void>();
let skeletonCalls = 0;

function fakeSkeleton(extractionId: string): Skeleton {
  const nodes: SkeletonNode[] = [
    {
      id: 'e0',
      parent: null,
      depth: 0,
      tag: 'body',
      role: null,
      kind: 'landmark',
      box: [0, 0, innerWidth, document.documentElement.scrollHeight],
      flags: [],
    },
  ];
  let n = 1;
  for (const v of Array.from(document.querySelectorAll('video'))) {
    const r = v.getBoundingClientRect();
    nodes.push({
      id: `e${900 + n++}`,
      parent: 'e0',
      depth: 1,
      tag: 'video',
      role: null,
      kind: 'media',
      box: [r.left, r.top + scrollY, r.width, r.height],
      flags: v.paused ? [] : ['playing'],
    });
  }
  return {
    v: 1,
    version: SKELETON_VERSION,
    extractionId,
    viewport: { width: innerWidth, height: innerHeight, zoom: 1 },
    doc: {
      width: innerWidth,
      height: document.documentElement.scrollHeight,
    },
    lang: 'en',
    nodes,
    truncated: false,
    structure: 'fixture',
    typed: [],
    perf: { ms: 1, nodes: nodes.length },
  };
}

function fakeSpec(): PageSpec {
  return {
    v: 1,
    page_type: 'inbox_or_messages',
    primary_task: 'triage_messages',
    sections: [],
    collections: Array.from(
      document.querySelectorAll<HTMLElement>('[data-list]'),
    ).map((c) => ({
      list_id: c.dataset.list ?? '',
      item_kind: 'message' as const,
      open_slot: c.dataset.open ?? null,
      card: 'message' as const,
      media: c.dataset.thumb ? ('square' as const) : ('none' as const),
      lead: 'none' as const,
      fields: c.dataset.thumb
        ? [
            {
              slot_id: c.dataset.thumb,
              role: 'thumbnail' as const,
              show: 'always' as const,
            },
          ]
        : [],
    })),
  };
}

function okReply(
  extractionId: string,
): Extract<FitViewOpenReply, { ok: true }> {
  const envelope: SpecEnvelope = {
    source: 'heuristic',
    extractionId,
    validated: { spec: fakeSpec(), primary: 0, rest: [], repairs: [] },
    createdAt: Date.now(),
  };
  return {
    ok: true,
    envelope,
    layout: {} as FitLayout,
    zoom: 1,
    site: { label: '127.0.0.1', secure: false },
    plannerPending: false,
  };
}

const engine: EngineApi = {
  async skeleton() {
    skeletonCalls++;
    const registry = makeRegistry();
    return { skeleton: fakeSkeleton(registry.extractionId), registry };
  },
  freeze() {},
  send<T extends ContentToWorker>(msg: T) {
    if (msg.type === 'cs:fitview-event')
      sent.push({ type: msg.type, detail: msg.event });
    else
      sent.push({
        type: msg.type,
        detail: (msg as { reason?: unknown }).reason,
      });
    let reply: unknown = { ok: true };
    if (msg.type === 'cs:fitview-request')
      reply = config.routeReply ?? okReply(msg.skeleton.extractionId);
    return Promise.resolve(reply) as never;
  },
  onRoute(cb) {
    routeCbs.add(cb);
    return () => routeCbs.delete(cb);
  },
  measured: (fn) => fn(),
};

// ---------------------------------------------------------------------------
// Stand-in view
// ---------------------------------------------------------------------------

const VIEW_CSS = `
dialog { width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; }
dialog::backdrop { background: #fff; }
.strip { position: sticky; top: 0; background: #eee; min-height: 24px; }
.scroller { height: calc(100vh - 40px); overflow: auto; }
.rec { display: flex; gap: 8px; min-height: 48px; align-items: center; border-bottom: 1px solid #ccc; }
button, a, input, select { min-height: 40px; font: 16px system-ui; }
.pill { position: fixed; right: 8px; bottom: 8px; z-index: 1; }
.tall { height: 3000px; }
`;

interface Call {
  fn: string;
  arg?: unknown;
}

class StandIn implements ViewSurface {
  readonly root: ShadowRoot;
  readonly dialog: HTMLDialogElement;
  readonly scroller: HTMLElement;
  readonly host: HTMLElement;
  readonly strip: HTMLElement;
  readonly body: HTMLElement;
  readonly pill: HTMLButtonElement;
  readonly calls: Call[] = [];
  live!: LiveLayerImpl;
  input!: FitViewOpenInput;
  backCb: (() => void) | null = null;
  readonly firewall: FirewallTarget;
  readonly router: ViewRouter;
  private sheetEl: HTMLElement | null = null;
  private statusEl: HTMLElement;

  constructor() {
    this.host = document.createElement('webable-ui');
    this.root = this.host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(VIEW_CSS);
    this.root.adoptedStyleSheets = [sheet];
    this.dialog = document.createElement('dialog');
    this.strip = document.createElement('div');
    this.strip.className = 'strip';
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.scroller = document.createElement('div');
    this.scroller.className = 'scroller';
    this.body = document.createElement('div');
    this.scroller.append(this.body);
    this.dialog.append(this.strip, this.statusEl, this.scroller);
    this.pill = document.createElement('button');
    this.pill.className = 'pill';
    this.pill.dataset.v = 'back';
    this.pill.textContent = 'Back to Fit view';
    this.pill.hidden = true;
    this.pill.addEventListener('click', () => this.backCb?.());
    this.root.append(this.dialog, this.pill);
    document.documentElement.append(this.host);
    // As the real host does: isolate the host from the moment it exists,
    // with the view's router (createLive keeps this registration).
    const router = createViewRouter(this.root);
    this.firewall = { host: this.host, dispatch: (e) => router.dispatch(e) };
    this.router = router;
    (globalThis as { [FIREWALL_KEY]?: FirewallTarget })[FIREWALL_KEY] =
      this.firewall;
    this.dialog.showModal();
  }

  private log(fn: string, arg?: unknown): void {
    this.calls.push({ fn, arg });
  }

  private bind(control: HTMLElement, target: ProxyTarget, v: string): void {
    control.dataset.v = v;
    this.live.proxies.bind(control, target);
  }

  private controlFor(
    role: ProxyRole | 'text',
    label: string,
    href: string | null,
    original: Element | null,
  ): HTMLElement {
    if (role === 'link' && href) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      return a;
    }
    if (role === 'input') {
      const i = document.createElement('input');
      i.value = (original as HTMLInputElement | null)?.value ?? '';
      i.setAttribute('aria-label', label);
      return i;
    }
    if (role === 'select' && original instanceof HTMLSelectElement) {
      const s = document.createElement('select');
      for (const o of Array.from(original.options)) {
        const c = document.createElement('option');
        c.value = o.value;
        c.textContent = o.text;
        s.append(c);
      }
      s.value = original.value;
      return s;
    }
    if (role === 'toggle' && original instanceof HTMLInputElement) {
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = original.checked;
      return i;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (role === 'toggle')
      b.setAttribute(
        'aria-pressed',
        String(original?.getAttribute('aria-pressed') === 'true'),
      );
    return b;
  }

  render(): void {
    const reg = this.input.registry;
    this.body.replaceChildren();
    const done = new Set<Element>();
    // Lists first come where they are in the document; plain controls too.
    const walk = Array.from(
      document.querySelectorAll<HTMLElement>('[data-list], [data-proxy]'),
    );
    for (const el of walk) {
      if (done.has(el) || el.closest('webable-ui')) continue;
      if (el.closest('[data-list]') && !el.matches('[data-list]')) continue;
      if (el.matches('[data-list]')) {
        done.add(el);
        this.body.append(this.renderList(el.dataset.list ?? ''));
        continue;
      }
      const id = el.dataset.id ?? '';
      const role = (el.dataset.proxy ?? 'button') as ProxyRole;
      const label = reg.name(el) || id;
      const href = reg.href(el);
      const c = this.controlFor(role, label, href, el);
      const t: ProxyTarget = {
        role,
        id,
        locator: reg.locator(id),
        scopeId: el.closest<HTMLElement>('[data-scope]')?.dataset.id ?? null,
      };
      if (role === 'link') t.href = href;
      const hp = el.getAttribute('aria-haspopup');
      if (hp && hp !== 'false') t.popup = true;
      if (el.hasAttribute('data-irreversible')) t.irreversible = true;
      const wrap = document.createElement('div');
      this.body.append(wrap);
      if (role === 'select' && el instanceof HTMLSelectElement) {
        // A short select is a visible list of options (as the renderer does).
        for (const o of Array.from(el.options)) {
          const label = document.createElement('label');
          const r = document.createElement('input');
          r.type = 'radio';
          r.name = `opt-${id}`;
          r.value = o.value;
          r.checked = o.selected;
          label.append(r, ` ${o.text}`);
          wrap.append(label);
          this.bind(r, t, `${id}:${o.value}`);
        }
        continue;
      }
      wrap.append(c);
      this.bind(c, t, id);
    }
    const tall = document.createElement('div');
    tall.className = 'tall';
    this.body.append(tall);
  }

  private records(listId: string): Array<{
    key: string;
    fp: string;
    slots: ModelSlot[];
    member: Element | null;
  }> {
    const model = (window as W).__records?.[listId];
    const reg = this.input.registry;
    if (model)
      return model.map((r) => ({
        key: r.key,
        fp: fingerprintOf(r.slots.map((s) => s.label)),
        slots: r.slots,
        member:
          reg.members(listId).find((m) => reg.recordKey(listId, m) === r.key) ??
          null,
      }));
    return reg.members(listId).map((m) => ({
      key: reg.recordKey(listId, m),
      fp: reg.fingerprint(listId, m),
      member: m,
      slots: Array.from(m.querySelectorAll<HTMLElement>('[data-slot]')).map(
        (s) => ({
          slot: s.dataset.slot ?? '',
          role: (s.dataset.proxy ?? 'text') as ProxyRole | 'text',
          label: reg.name(s),
          href: reg.href(s) ?? undefined,
        }),
      ),
    }));
  }

  private renderList(listId: string): HTMLElement {
    const ul = document.createElement('ul');
    ul.dataset.list = listId;
    for (const r of this.records(listId)) {
      const li = document.createElement('li');
      li.className = 'rec';
      li.dataset.key = r.key;
      for (const s of r.slots) {
        if (s.role === 'text') {
          const span = document.createElement('span');
          span.textContent = s.label;
          li.append(span);
          continue;
        }
        const original =
          r.member?.querySelector(`[data-slot="${s.slot}"]`) ?? null;
        const c = this.controlFor(s.role, s.label, s.href ?? null, original);
        const t: ProxyTarget = {
          role: s.role,
          id: `${listId}:${s.slot}`,
          locator: { path: [listId, s.slot], kind: 'control' },
          scopeId: null,
          record: { listId, key: r.key, fingerprint: r.fp, slotId: s.slot },
        };
        if (s.role === 'link') t.href = s.href ?? null;
        li.append(c);
        this.bind(c, t, `${r.key}:${s.slot}`);
      }
      ul.append(li);
    }
    return ul;
  }

  // -- ViewSurface ------------------------------------------------------------

  patchRecords(listId: string): void {
    this.log('patchRecords', listId);
    if (!config.patch) return;
    const old = this.body.querySelector(`ul[data-list="${listId}"]`);
    if (!old) return;
    const top = this.scroller.scrollTop;
    old.replaceWith(this.renderList(listId));
    this.scroller.scrollTop = top;
  }

  replace(next: FitViewOpenInput): void {
    this.log('replace', next.skeleton.extractionId);
    this.input = next;
    this.live.rebind(next);
    this.render();
  }

  loading(on: boolean): void {
    this.log('loading', on);
    this.strip.dataset.loading = String(on);
  }

  sheet(
    anchor: HTMLElement | null,
    options: Array<{ label: string; selected: boolean; target: ProxyTarget }>,
  ): void {
    this.log('sheet', anchor ? options.map((o) => o.label) : null);
    this.sheetEl?.remove();
    this.sheetEl = null;
    if (!anchor) return;
    const box = document.createElement('div');
    box.className = 'sheet';
    options.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.label;
      box.append(b);
      this.bind(b, o.target, `sheet:${i}`);
    });
    (anchor.parentElement ?? this.body).after(box);
    this.sheetEl = box;
  }

  status(lines: StatusLine[]): void {
    this.log(
      'status',
      lines.map((l) => ({
        text: l.text,
        actions: l.actions.map((a) => a.label),
      })),
    );
    this.statusEl.replaceChildren();
    lines.forEach((l, i) => {
      const p = document.createElement('p');
      p.textContent = l.text;
      l.actions.forEach((a, j) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = a.label;
        p.append(' ', b);
        this.bind(b, a.target, `status:${i}:${j}`);
      });
      this.statusEl.append(p);
    });
  }

  peek(on: boolean, back?: () => void): void {
    this.log('peek', on);
    // The renderer reports peeks (cs:fitview-event); the stand-in does too.
    void this.input.engine.send({
      type: 'cs:fitview-event',
      event: { kind: 'peek', on },
    });
    if (on) {
      this.backCb = back ?? null;
      this.dialog.close();
      this.pill.hidden = false;
    } else {
      this.backCb = null;
      this.pill.hidden = true;
      if (!this.dialog.open) this.dialog.showModal();
    }
  }

  notice(text: string | null): void {
    this.log('notice', text);
    this.strip.textContent = text ?? '';
  }

  close(
    reason: 'original' | 'not_representable' | 'route' | 'error' | 'paused',
  ): void {
    this.log('close', reason);
    this.live.dispose();
    this.dialog.close();
    this.router.dispose();
    const g = globalThis as { [FIREWALL_KEY]?: FirewallTarget };
    if (g[FIREWALL_KEY] === this.firewall) delete g[FIREWALL_KEY];
    this.host.remove();
  }
}

// ---------------------------------------------------------------------------
// Test API
// ---------------------------------------------------------------------------

let view: StandIn | null = null;

function control(v: string): HTMLElement | null {
  return (
    view?.root.querySelector<HTMLElement>(`[data-v="${CSS.escape(v)}"]`) ?? null
  );
}

const api = {
  async open(opts: Partial<Config> = {}): Promise<void> {
    Object.assign(config, opts);
    const res = await engine.skeleton();
    if (!res) throw new Error('no skeleton');
    const input: FitViewOpenInput = {
      reply: okReply(res.registry.extractionId),
      skeleton: res.skeleton,
      registry: res.registry,
      engine,
      reason: 'popup',
    };
    view = new StandIn();
    view.input = input;
    view.live = createLiveLayer(view, input);
    view.render();
  },
  config(opts: Partial<Config>): void {
    Object.assign(config, opts);
  },
  calls(fn?: string): Call[] {
    const all = view?.calls ?? [];
    return fn ? all.filter((c) => c.fn === fn) : all;
  },
  sent(): Array<{ type: string; detail?: unknown }> {
    return sent;
  },
  skeletonCalls: (): number => skeletonCalls,
  rect(v: string): { x: number; y: number } | null {
    const c = control(v);
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },
  focus(v: string): boolean {
    const c = control(v);
    c?.focus();
    return !!c;
  },
  value(v: string): string | null {
    const c = control(v);
    return c instanceof HTMLInputElement || c instanceof HTMLSelectElement
      ? c.value
      : null;
  },
  checked(v: string): boolean | null {
    const c = control(v);
    if (c instanceof HTMLInputElement) return c.checked;
    return c ? c.getAttribute('aria-pressed') === 'true' : null;
  },
  has(v: string): boolean {
    return control(v) !== null;
  },
  active(): string | null {
    const a = view?.root.activeElement as HTMLElement | null | undefined;
    return a?.dataset.v ?? null;
  },
  viewOpen(): boolean {
    return view?.dialog.open ?? false;
  },
  mounted(): boolean {
    return view?.host.isConnected ?? false;
  },
  back(): void {
    view?.backCb?.();
  },
  route(): void {
    for (const cb of [...routeCbs]) cb();
  },
  scrollTop(): number {
    return view?.scroller.scrollTop ?? 0;
  },
  scrollTo(v: string): void {
    const c = control(v);
    if (!c || !view) return;
    const top = view.scroller.getBoundingClientRect().top;
    view.scroller.scrollTop += c.getBoundingClientRect().top - top;
  },
  /** data-key of the first record at the top of the view's scroller. */
  topKey(): string | null {
    if (!view) return null;
    const top = view.scroller.getBoundingClientRect().top;
    for (const li of Array.from(
      view.root.querySelectorAll<HTMLElement>('li[data-key]'),
    )) {
      if (li.getBoundingClientRect().bottom > top + 1)
        return li.dataset.key ?? null;
    }
    return null;
  },
  actions(): number {
    return view?.live.proxies.actions() ?? 0;
  },
  close(): void {
    view?.close('original');
  },
  host(): Element | null {
    return view?.host ?? null;
  },
};

(window as W).__live = api;
export type LiveApi = typeof api;
