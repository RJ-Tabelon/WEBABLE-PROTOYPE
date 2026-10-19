import type { FitLayout, SpecEnvelope } from '@webable/core';

import type { FitViewEvent } from '../../protocol';
import { FV_COPY, h, waButton } from './components';
import type { ConservationReport } from './conserve';
import { registerFonts } from './fonts';
import { checkHealth, type HealthReport } from './health';
import { mountHost, type Host } from './host';
import { firstInView, patchList, type ListView } from './records';
import { renderView, type RenderedView } from './render';
import { fitViewCss, NUDGE_LIMIT, nudgeLayout } from './styles';
import type {
  CreateLive,
  FitViewOpenInput,
  FitViewRuntime,
  LiveLayer,
  ProxyTarget,
  StatusLine,
  ViewSurface,
} from './types';

/**
 * Fit view runtime (docs/10 §4.3-§4.7), registered by content-scripts/fitview.js
 * under FITVIEW_RUNTIME_KEY for the engine adapter to call.
 *
 * open(): freeze Tailor, register the face, mount the host, render, check
 * conservation, show the modal dialog, close up what sits above the primary
 * section if it would start below the top half of the first screen (docs/11
 * R2), check render health, then hand the
 * rendered surface to the live layer (WP6's createLive), which drives every
 * proxied control. close(): the reverse, with the original scrolled to the
 * record that was in view.
 */

type CloseReason = Parameters<FitViewRuntime['close']>[0];
/** The live layer's own "show it on the page" (fitview/live.ts), when present. */
type OnPage = (el: Element | null, caption?: string) => void;

export interface FitViewRuntimeOptions {
  doc?: Document;
  /** The live layer (fitview/live.ts). Without it controls stay unbound (tests). */
  createLive?: CreateLive;
  /** 'closed' in production; tests may open the root to run axe-core. */
  shadowMode?: 'open' | 'closed';
  now?: () => number;
}

/** Introspection for the harness and the live layer's own tests. */
export interface FitViewInspect {
  surface(): ViewSurface | null;
  health(): HealthReport | null;
  conservation(): ConservationReport | null;
  /** Controls handed to the live layer (or queued for it). */
  bound(): number;
  layout(): FitLayout | null;
}

interface OpenView {
  input: FitViewOpenInput;
  host: Host;
  rendered: RenderedView;
  base: FitLayout;
  layout: FitLayout;
  nudge: number;
  pinch: number;
  zoom: number;
  live: LiveLayer | null;
  queue: Array<[HTMLElement, ProxyTarget]>;
  bound: number;
  openedAt: number;
  surface: ViewSurface;
  sheetAnchor: HTMLElement | null;
  peeking: boolean;
  offered: { envelope: SpecEnvelope; layout?: FitLayout } | null;
  noticeText: string | null;
  statusLines: StatusLine[];
  health: HealthReport | null;
  observers: Array<() => void>;
  uid: number;
  /** "Always here" as last switched in this view (undefined: no switch). */
  alwaysHere: boolean | undefined;
  /** The one-time intro line was dismissed (it stays gone across redraws). */
  introSeen: boolean;
}

/** The main thing starts in the top half of the first screen (docs/11 R2). */
export const PRIMARY_START_SHARE = 0.5;

export function createFitViewRuntime(
  opts: FitViewRuntimeOptions = {},
): FitViewRuntime & FitViewInspect {
  const now = opts.now ?? (() => performance.now());
  let view: OpenView | null = null;
  let opening: Promise<void> | null = null;

  const send = (input: FitViewOpenInput, event: FitViewEvent): void => {
    input.engine
      .send({ type: 'cs:fitview-event', event })
      .catch(() => undefined);
  };

  const bind = (
    v: OpenView,
    control: HTMLElement,
    target: ProxyTarget,
  ): void => {
    v.bound++;
    if (v.live) v.live.proxies.bind(control, target);
    else v.queue.push([control, target]);
  };

  const pinchOf = (doc: Document): number => {
    const s = doc.defaultView?.visualViewport?.scale ?? 1;
    return Number.isFinite(s) && s > 0 ? s : 1;
  };

  /** Draw (or redraw) the whole view from the view's current input and layout. */
  const draw = (v: OpenView): void => {
    v.rendered?.dispose();
    v.host.setCss(fitViewCss(v.layout, v.zoom));
    const doc = v.host.host.ownerDocument;
    v.rendered = renderView({
      doc,
      host: v.host,
      skeleton: v.input.skeleton,
      registry: v.input.registry,
      validated: v.input.reply.envelope.validated,
      layout: v.layout,
      zoom: v.zoom,
      site: v.input.reply.site,
      uid: (p) => `fv-${p}${++v.uid}`,
      alwaysHere: v.alwaysHere,
      intro: v.input.reply.intro === true && !v.introSeen,
      callbacks: {
        original: () => runtime.close('original'),
        nudge: (step) => nudge(v, step),
        switchLayout: () => void switchLayout(v),
        bind: (c, t) => bind(v, c, t),
        showOnPage: (id, el) => showOnPage(v, id, el),
        always: (on) => {
          v.alwaysHere = on;
          send(v.input, { kind: 'always', on });
        },
        dismissIntro: () => {
          v.introSeen = true;
        },
      },
    });
    renderOffer(v);
    setNotice(v, v.noticeText);
    renderStatus(v, v.statusLines);
  };

  /** After the dialog is laid out: stickiness, primary in the first viewport, health. */
  const settle = (v: OpenView): void => {
    const { host, rendered } = v;
    const vh =
      host.scroller.clientHeight ||
      (host.host.ownerDocument.defaultView?.innerHeight ?? 800);
    host.strip.classList.toggle(
      'is-sticky',
      host.strip.getBoundingClientRect().height <= vh * 0.25,
    );
    const primary = rendered.primary;
    if (primary) {
      const top = (): number =>
        primary.getBoundingClientRect().top -
        host.scroller.getBoundingClientRect().top +
        host.scroller.scrollTop;
      const above = (el: HTMLElement): boolean =>
        host.strip.contains(el) ||
        Boolean(
          el.compareDocumentPosition(primary) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      for (const level of [1, 2, 'tight', 3] as const) {
        if (top() <= vh * PRIMARY_START_SHARE) break;
        if (level === 'tight') {
          // The strip and what sits above the primary close up.
          host.strip.classList.add('fv-tight');
          for (const sec of Array.from(host.main.children) as HTMLElement[]) {
            sec.classList.add('fv-tight');
            if (sec === primary) break;
          }
          continue;
        }
        for (const c of rendered.compressors)
          if (c.level === level && above(c.el)) c.run();
      }
    }
    v.health = checkHealth(host.dialog, host.scroller, v.layout, v.zoom);
  };

  const primaryList = (v: OpenView): ListView | null => {
    const lists = [...v.rendered.lists.values()];
    const p = v.rendered.primary;
    return lists.find((l) => p?.contains(l.root)) ?? lists[0] ?? null;
  };

  /** Open where the person was: the first record of the primary list in view on the page. */
  const anchorOnOpen = (v: OpenView): void => {
    const doc = v.host.host.ownerDocument;
    const win = doc.defaultView;
    if (!win || win.scrollY < win.innerHeight / 2) return;
    const lv = primaryList(v);
    if (!lv) return;
    for (const [key, el] of lv.members) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= win.innerHeight) continue;
      const li = lv.root.querySelector<HTMLElement>(
        `li[data-key="${CSS.escape(key)}"]`,
      );
      if (!li) return;
      const s = v.host.scroller;
      const stripH = v.host.strip.classList.contains('is-sticky')
        ? v.host.strip.getBoundingClientRect().height
        : 0;
      s.scrollTop +=
        li.getBoundingClientRect().top - s.getBoundingClientRect().top - stripH;
      li.querySelector<HTMLElement>(
        'a[href]:not([tabindex="-1"]), button',
      )?.focus({
        preventScroll: true,
      });
      return;
    }
  };

  /** Close where the person was: scroll the original to the record in view. */
  const anchorOnClose = (v: OpenView): (() => void) | null => {
    const lv = primaryList(v);
    if (!lv) return null;
    const first = firstInView(lv, v.host.scroller);
    if (!first) return null;
    const el = lv.members.get(first.key);
    if (!el?.isConnected) return null;
    return () => el.scrollIntoView({ block: 'start' });
  };

  const nudge = (v: OpenView, step: 1 | -1): void => {
    const next = Math.max(-NUDGE_LIMIT, Math.min(NUDGE_LIMIT, v.nudge + step));
    if (next === v.nudge) return;
    v.nudge = next;
    v.layout = nudgeLayout(v.base, next);
    redraw(v);
    send(v.input, { kind: 'text_nudge', step });
    v.host.announcer.textContent = '';
    v.host.announcer.textContent = `${Math.round(v.layout.type.body.px)} px`;
  };

  /** Redraw in place, keeping the record in view and the focused WebAble control. */
  const redraw = (v: OpenView): void => {
    const lv = primaryList(v);
    const anchor = lv ? firstInView(lv, v.host.scroller) : null;
    const active = v.host.root.activeElement as HTMLElement | null;
    const activeLabel = active?.classList.contains('fv-wa')
      ? active.textContent
      : null;
    const scrollTop = v.host.scroller.scrollTop;
    draw(v);
    v.live?.rebind(v.input);
    flush(v);
    settle(v);
    const next = anchor ? primaryList(v) : null;
    const li = next?.root.querySelector<HTMLElement>(
      `li[data-key="${CSS.escape(anchor?.key ?? '')}"]`,
    );
    if (li && anchor) {
      const s = v.host.scroller;
      s.scrollTop +=
        li.getBoundingClientRect().top -
        s.getBoundingClientRect().top -
        anchor.offset;
    } else v.host.scroller.scrollTop = scrollTop;
    if (activeLabel) {
      const again = Array.from(
        v.host.root.querySelectorAll<HTMLElement>('.fv-wa'),
      ).find((b) => b.textContent === activeLabel);
      again?.focus({ preventScroll: true });
    }
  };

  const flush = (v: OpenView): void => {
    if (!v.live) return;
    for (const [c, t] of v.queue.splice(0)) v.live.proxies.bind(c, t);
  };

  const renderOffer = (v: OpenView): void => {
    const box = v.rendered.offer;
    box.replaceChildren();
    if (!v.offered) {
      box.hidden = true;
      return;
    }
    const doc = v.host.host.ownerDocument;
    box.append(
      h(doc, 'p', 't-body', FV_COPY.offer),
      waButton({ doc }, FV_COPY.switchLayout, () => void switchLayout(v), {
        fill: true,
      }),
    );
    box.hidden = false;
  };

  const setNotice = (v: OpenView, text: string | null): void => {
    v.noticeText = text;
    const n = v.rendered.notice;
    n.textContent = text ?? '';
    n.hidden = !text;
  };

  const renderStatus = (v: OpenView, lines: StatusLine[]): void => {
    v.statusLines = lines;
    const box = v.rendered.status;
    const doc = v.host.host.ownerDocument;
    box.replaceChildren();
    for (const line of lines.slice(-3)) {
      const row = h(doc, 'div', 'fv-status__line');
      row.dataset.key = line.key;
      row.append(h(doc, 'p', 't-body', line.text));
      for (const a of line.actions) {
        if (!a.label) continue;
        const b = h(doc, 'button', 'fv-btn');
        b.type = 'button';
        b.textContent = a.label;
        row.append(b);
        bind(v, b, a.target);
      }
      box.append(row);
    }
    box.hidden = box.childNodes.length === 0;
  };

  const closeSheet = (v: OpenView): boolean => {
    if (v.host.sheet.hidden) return false;
    v.host.sheet.hidden = true;
    v.host.sheet.replaceChildren();
    const a = v.sheetAnchor;
    v.sheetAnchor = null;
    if (a) {
      a.setAttribute('aria-expanded', 'false');
      if (a.isConnected) a.focus({ preventScroll: true });
    }
    return true;
  };

  const showSheet = (
    v: OpenView,
    anchor: HTMLElement | null,
    options: Array<{ label: string; selected: boolean; target: ProxyTarget }>,
  ): void => {
    const sheet = v.host.sheet;
    if (!anchor || !options.length) {
      if (!sheet.hidden) {
        sheet.hidden = true;
        sheet.replaceChildren();
        v.sheetAnchor?.setAttribute('aria-expanded', 'false');
        v.sheetAnchor = null;
      }
      return;
    }
    const doc = v.host.host.ownerDocument;
    sheet.replaceChildren();
    sheet.id ||= `fv-sheet${++v.uid}`;
    sheet.setAttribute('role', 'group');
    const label = (
      anchor.getAttribute('aria-label') ??
      anchor.textContent ??
      ''
    ).trim();
    if (label) sheet.setAttribute('aria-label', label);
    const rows: HTMLButtonElement[] = [];
    for (const o of options) {
      if (!o.label) continue;
      const b = h(doc, 'button', 'fv-sheet__opt');
      b.type = 'button';
      b.textContent = o.label;
      if (o.selected) b.setAttribute('aria-current', 'true');
      bind(v, b, o.target);
      rows.push(b);
      sheet.append(b);
    }
    sheet.onkeydown = (e) => {
      const i = rows.indexOf(v.host.root.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        rows[(i + d + rows.length) % rows.length]?.focus();
      }
    };
    if (v.sheetAnchor && v.sheetAnchor !== anchor)
      v.sheetAnchor.setAttribute('aria-expanded', 'false');
    v.sheetAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', sheet.id);
    anchor.onkeydown = (e) => {
      if (e.key === 'ArrowDown' && !sheet.hidden) {
        e.preventDefault();
        rows[0]?.focus();
      }
    };
    sheet.hidden = false;
    // Beside the control: below it, or above when there is no room.
    const r = anchor.getBoundingClientRect();
    const win = doc.defaultView;
    const vw = win?.innerWidth ?? 1280;
    const vh = win?.innerHeight ?? 800;
    const sr = sheet.getBoundingClientRect();
    const gap = 4 / v.zoom;
    const below = r.bottom + gap + sr.height <= vh || r.top < sr.height + gap;
    const top = below ? r.bottom + gap : r.top - gap - sr.height;
    const left = Math.max(gap, Math.min(r.left, vw - sr.width - gap));
    sheet.style.setProperty('top', `${Math.max(gap, top)}px`);
    sheet.style.setProperty('left', `${left}px`);
  };

  const peek = (v: OpenView, on: boolean, back?: () => void): void => {
    if (on === v.peeking) return;
    v.peeking = on;
    const pill = v.host.peek;
    const doc = v.host.host.ownerDocument;
    if (on) {
      closeSheet(v);
      pill.replaceChildren(
        waButton(
          { doc },
          FV_COPY.back,
          () => (back ? back() : peek(v, false)),
          {
            fill: true,
          },
        ),
      );
      v.host.hide();
      try {
        pill.showPopover();
      } catch {
        // Popover unsupported: the toolbar and the shortcut still close the view.
      }
    } else {
      try {
        if (pill.matches(':popover-open')) pill.hidePopover();
      } catch {
        // already hidden
      }
      pill.replaceChildren();
      v.host.show();
    }
    send(v.input, { kind: 'peek', on });
  };

  const showOnPage = (
    v: OpenView,
    id: string | null,
    el: Element | null,
  ): void => {
    const reg = v.input.registry;
    let target = el?.isConnected ? el : null;
    if (!target && id) {
      target = reg.element(id) ?? reg.resolve(reg.locator(id));
    }
    // The live layer's peek rings the element and brings focus back after.
    const live = v.live as (LiveLayer & { showOnPage?: OnPage }) | null;
    if (typeof live?.showOnPage === 'function') {
      live.showOnPage(target, '');
      return;
    }
    peek(v, true);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    if (target instanceof HTMLElement && target.tabIndex >= 0)
      target.focus({ preventScroll: true });
  };

  const switchLayout = async (v: OpenView): Promise<void> => {
    const offered = v.offered;
    if (!offered || view !== v) return;
    v.offered = null;
    renderOffer(v);
    const { engine } = v.input;
    let snap: Awaited<ReturnType<typeof engine.skeleton>> = null;
    try {
      snap = await engine.skeleton();
    } catch {
      snap = null;
    }
    if (view !== v) return;
    if (snap) {
      try {
        const reply = await engine.send({
          type: 'cs:fitview-request',
          skeleton: snap.skeleton,
          reason: 'switch',
        });
        if (view !== v) return;
        if (
          reply.ok &&
          reply.envelope.extractionId === snap.skeleton.extractionId
        ) {
          const t0 = now();
          v.surface.replace({
            reply,
            skeleton: snap.skeleton,
            registry: snap.registry,
            engine,
            reason: 'switch',
          });
          send(v.input, {
            kind: 'opened',
            source: reply.envelope.source,
            reason: 'switch',
            ms: Math.round(now() - t0),
          });
          return;
        }
      } catch {
        // fall through to the offered envelope
      }
    }
    // The offered spec still matches the extraction on screen: use it as is.
    if (offered.envelope.extractionId === v.input.skeleton.extractionId) {
      const t0 = now();
      v.surface.replace({
        ...v.input,
        reply: {
          ...v.input.reply,
          envelope: offered.envelope,
          layout: offered.layout ?? v.input.reply.layout,
          plannerPending: false,
        },
        reason: 'switch',
      });
      send(v.input, {
        kind: 'opened',
        source: offered.envelope.source,
        reason: 'switch',
        ms: Math.round(now() - t0),
      });
    }
  };

  const makeSurface = (v: OpenView): ViewSurface => ({
    get root() {
      return v.host.root;
    },
    get dialog() {
      return v.host.dialog;
    },
    get scroller() {
      return v.host.scroller;
    },
    patchRecords(listId) {
      if (view !== v) return;
      const lv = v.rendered.lists.get(listId);
      if (lv) patchList(v.rendered.ctx, lv, v.host.scroller);
    },
    replace(next) {
      if (view !== v) return;
      const sameExtraction =
        next.skeleton.extractionId === v.input.skeleton.extractionId;
      v.input = next;
      v.base = next.reply.layout;
      v.layout = nudgeLayout(v.base, v.nudge);
      v.zoom = next.reply.zoom * v.pinch;
      v.alwaysHere = next.reply.alwaysHere ?? v.alwaysHere;
      if (
        v.offered &&
        (v.offered.envelope.createdAt === next.reply.envelope.createdAt ||
          next.reply.envelope.source === 'planner')
      )
        v.offered = null;
      closeSheet(v);
      v.queue.length = 0;
      if (sameExtraction) redraw(v);
      else {
        draw(v);
        v.live?.rebind(next);
        flush(v);
        settle(v);
        v.host.scroller.scrollTop = 0;
      }
    },
    loading(on) {
      if (view !== v) return;
      v.host.loading.hidden = !on;
      if (on) v.host.main.setAttribute('aria-busy', 'true');
      else v.host.main.removeAttribute('aria-busy');
    },
    sheet(anchor, options) {
      if (view !== v) return;
      showSheet(v, anchor, options);
    },
    status(lines) {
      if (view !== v) return;
      renderStatus(v, lines);
    },
    peek(on, back) {
      if (view !== v) return;
      peek(v, on, back);
    },
    notice(text) {
      if (view !== v) return;
      setNotice(v, text);
    },
    close(reason) {
      if (view !== v) return;
      runtime.close(reason);
    },
  });

  const doOpen = async (input: FitViewOpenInput): Promise<void> => {
    const t0 = now();
    const doc = opts.doc ?? document;
    input.engine.freeze(true);
    try {
      await registerFonts(doc, input.reply.font);
    } catch {
      // The metric-matched fallback and system faces follow in the stack.
    }
    if (view) {
      view.surface.replace(input);
      return;
    }
    const pinch = pinchOf(doc);
    const v = {
      input,
      base: input.reply.layout,
      layout: input.reply.layout,
      nudge: 0,
      pinch,
      zoom: input.reply.zoom * pinch,
      live: null,
      queue: [],
      bound: 0,
      openedAt: t0,
      sheetAnchor: null,
      peeking: false,
      offered: null,
      noticeText: null,
      statusLines: [],
      health: null,
      observers: [],
      uid: 0,
      alwaysHere: input.reply.alwaysHere,
      introSeen: false,
    } as unknown as OpenView;
    v.host = mountHost(doc, {
      mode: opts.shadowMode ?? 'closed',
      onCancel: () => runtime.close('original'),
      onEscape: () => closeSheet(v) || (v.rendered?.closeMore() ?? false),
    });
    v.surface = makeSurface(v);
    view = v;
    try {
      draw(v);
    } catch (err) {
      view = null;
      v.host.dispose();
      input.engine.freeze(false);
      send(input, {
        kind: 'closed',
        reason: 'error',
        afterMs: 0,
        actions: 0,
      });
      throw err;
    }
    if (!v.rendered.conservation.ok) {
      send(input, {
        kind: 'conservation_failed',
        missing:
          v.rendered.conservation.missing.length +
          v.rendered.conservation.lists.reduce(
            (n, l) => n + Math.max(0, l.members - l.covered),
            0,
          ),
      });
    }
    v.host.show();
    // Screen readers start at the content; Shift+Tab reaches the strip.
    v.host.main.focus({ preventScroll: true });
    settle(v);
    anchorOnOpen(v);
    // Keep the strip's stickiness right as the window or text size changes.
    const win = doc.defaultView;
    if (win && typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        if (view !== v) return;
        const vh = v.host.scroller.clientHeight;
        v.host.strip.classList.toggle(
          'is-sticky',
          v.host.strip.getBoundingClientRect().height <= vh * 0.25,
        );
      });
      ro.observe(v.host.scroller);
      v.observers.push(() => ro.disconnect());
    }
    if (opts.createLive) {
      try {
        v.live = opts.createLive(v.surface, input);
        flush(v);
      } catch {
        v.live = null;
      }
    }
    send(input, {
      kind: 'opened',
      source: input.reply.envelope.source,
      reason: input.reason,
      ms: Math.round(now() - t0),
    });
  };

  const runtime: FitViewRuntime & FitViewInspect = {
    open(input) {
      const run = (opening ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => doOpen(input));
      opening = run.finally(() => {
        if (opening === run) opening = null;
      });
      return run;
    },
    offerSpec(envelope, layout) {
      const v = view;
      if (!v) return;
      const cur = v.input.reply.envelope;
      const same =
        envelope.source === cur.source &&
        envelope.createdAt === cur.createdAt &&
        envelope.extractionId === cur.extractionId;
      if (same) {
        // The open layout re-solved (a Text − / + override recorded by the worker).
        if (layout) {
          v.input = { ...v.input, reply: { ...v.input.reply, layout } };
          v.base = layout;
          v.nudge = 0;
          v.layout = layout;
          redraw(v);
        }
        return;
      }
      // Never swap a rendered layout under someone reading: offer it.
      v.offered = { envelope, layout };
      renderOffer(v);
    },
    close(reason: CloseReason) {
      const v = view;
      if (!v) return;
      view = null;
      // The live layer scrolls the original to the record in view itself.
      const restore = v.live ? null : anchorOnClose(v);
      let actions = 0;
      try {
        actions = v.live?.proxies.actions() ?? 0;
      } catch {
        actions = 0;
      }
      try {
        v.live?.dispose();
      } catch {
        // the live layer's own teardown must not keep the view open
      }
      for (const off of v.observers.splice(0)) off();
      v.rendered.dispose();
      v.host.dispose();
      v.input.engine.freeze(false);
      restore?.();
      send(v.input, {
        kind: 'closed',
        reason,
        afterMs: Math.round(now() - v.openedAt),
        actions,
      });
    },
    setZoom(zoom) {
      const v = view;
      if (!v || !(zoom > 0)) return;
      v.zoom = zoom * v.pinch;
      v.live?.setZoom(zoom);
      redraw(v);
    },
    isOpen() {
      return view !== null;
    },
    surface: () => view?.surface ?? null,
    health: () => view?.health ?? null,
    conservation: () => view?.rendered.conservation ?? null,
    bound: () => view?.bound ?? 0,
    layout: () => view?.layout ?? null,
  };
  return runtime;
}

export { FITVIEW_RUNTIME_KEY } from './types';
