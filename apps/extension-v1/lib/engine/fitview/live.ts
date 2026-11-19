import type { FitViewEvent } from '../../protocol';
import { Signals } from './effect';
import { createViewRouter, type ViewRouter } from './firewall';
import { Ephemeral, Positions } from './locate';
import { PeekController } from './peek';
import { ProxyLayer } from './proxy';
import { StatusMirror } from './status';
import { LiveSync } from './sync';
import {
  type CreateLive,
  FIREWALL_KEY,
  type FirewallTarget,
  type FitViewOpenInput,
  type LiveLayer,
  type ViewSurface,
} from './types';

/**
 * Fit view's live layer (docs/10 §4.4, §4.5): everything that keeps a
 * re-presented page working, wired against the rendered view.
 *
 *   proxy.ts    every view control drives its original
 *   locate.ts   re-finding originals (fingerprints, two-phase)
 *   effect.ts   did the action do anything
 *   peek.ts     site dialogs (peek), menus (sheet.ts), covering
 *   status.ts   site messages and their Undo
 *   sync.ts     records, lazy loading, media, routes, scroll memory
 *   firewall.ts the view's router behind the document_start firewall
 *
 * createLive registers the firewall target (globalThis[FIREWALL_KEY]) for
 * the view's host, so from now on the page never sees the person's input in
 * Fit view and the view's own listeners still get it.
 */

/** One line in the view's top strip, shared by several owners; the latest wins. */
class Notices {
  private readonly active = new Map<string, string>();
  private shown: string | null = null;

  constructor(private readonly surface: ViewSurface) {}

  set(owner: string, text: string | null): void {
    this.active.delete(owner);
    if (text) this.active.set(owner, text);
    const latest = [...this.active.values()].pop() ?? null;
    if (latest === this.shown) return;
    this.shown = latest;
    this.surface.notice(latest);
  }
}

type FirewallGlobal = { [FIREWALL_KEY]?: FirewallTarget };

export interface LiveLayerImpl extends LiveLayer {
  proxies: ProxyLayer;
  /** Step aside and show an original on the page ("Do this on the page"). */
  showOnPage(el: Element | null, caption?: string): void;
}

class Live implements LiveLayerImpl {
  readonly proxies: ProxyLayer;
  private input: FitViewOpenInput;
  private zoom: number;
  private disposed = false;
  private readonly eph = new Ephemeral();
  private readonly positions = new Positions();
  private readonly signals = new Signals();
  private readonly notices: Notices;
  private readonly peek: PeekController;
  private readonly status: StatusMirror;
  private readonly sync: LiveSync;
  private readonly router: ViewRouter | null;
  private readonly firewall: FirewallTarget | null;
  private previous: FirewallTarget | undefined;

  constructor(
    private readonly surface: ViewSurface,
    input: FitViewOpenInput,
  ) {
    this.input = input;
    this.zoom = input.reply.zoom;
    this.notices = new Notices(surface);
    const win = surface.root.host.ownerDocument.defaultView ?? window;
    const registry = () => this.input.registry;

    this.proxies = new ProxyLayer({
      win,
      surface,
      registry,
      spec: () => this.input.reply.envelope.validated.spec,
      eph: this.eph,
      positions: this.positions,
      signals: this.signals,
      frozen: () => this.peek.frozen(),
      blocking: () => this.peek.blocking(),
      showOnPage: (el, caption) => this.peek.show(el, caption),
      notice: (owner, text) => this.notices.set(owner, text),
      acted: () => {
        this.status.noteAction();
        this.peek.noteAction();
      },
      navigating: () => this.sync.navigating(),
      expectPopup: (original, control) =>
        this.peek.expectPopup(original, control),
      typing: (original, control) => {
        this.status.noteTyping();
        this.peek.typing(original, control);
      },
      failed: (role, why) => this.report({ kind: 'proxy_failed', role, why }),
    });
    this.peek = new PeekController({
      win,
      surface,
      root: surface.root,
      registry,
      eph: this.eph,
      proxies: this.proxies,
      signals: this.signals,
      notice: (owner, text) => this.notices.set(owner, text),
      onPeek: (on) => {
        if (!on) this.sync.pauseAll();
      },
    });
    this.status = new StatusMirror({
      win,
      surface,
      registry,
      eph: this.eph,
      signals: this.signals,
      shown: () => this.sync.shownContainers(),
    });
    this.sync = new LiveSync({
      win,
      surface,
      input: () => this.input,
      proxies: this.proxies,
      positions: this.positions,
      peeking: () => this.peek.peeking,
      rebind: (next) => this.rebind(next),
      notice: (owner, text) => this.notices.set(owner, text),
    });

    // The host normally registers its own router when it mounts (before
    // showModal, so even the first focus is isolated). Register one only for
    // a host that did not.
    const g = globalThis as FirewallGlobal;
    const current = g[FIREWALL_KEY];
    if (current?.host === surface.root.host) {
      this.router = null;
      this.firewall = null;
    } else {
      const router = createViewRouter(surface.root);
      this.router = router;
      this.firewall = {
        host: surface.root.host,
        dispatch: (e) => router.dispatch(e),
      };
      this.previous = current;
      g[FIREWALL_KEY] = this.firewall;
    }
  }

  rebind(next: FitViewOpenInput): void {
    if (this.disposed) return;
    const same =
      next.skeleton.extractionId === this.input.skeleton.extractionId;
    this.input = next;
    this.zoom = next.reply.zoom;
    if (same) return;
    this.positions.clear();
    this.sync.rebind();
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
  }

  showOnPage(el: Element | null, caption = ''): void {
    if (!this.disposed) this.peek.show(el, caption);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.sync.scrollOriginalToAnchor();
    } catch {
      // The page may already be navigating away.
    }
    this.sync.dispose();
    this.status.dispose();
    this.peek.dispose();
    this.proxies.dispose();
    this.router?.dispose();
    const g = globalThis as FirewallGlobal;
    if (this.firewall && g[FIREWALL_KEY] === this.firewall) {
      const prev = this.previous;
      if (prev?.host.isConnected) g[FIREWALL_KEY] = prev;
      else delete g[FIREWALL_KEY];
    }
  }

  /** The current page scale (the renderer owns sizing; kept for the ring and logs). */
  get pageZoom(): number {
    return this.zoom;
  }

  private report(event: FitViewEvent): void {
    if (this.disposed) return;
    try {
      void this.input.engine
        .send({ type: 'cs:fitview-event', event })
        .catch(() => undefined);
    } catch {
      // The extension context may be gone.
    }
  }
}

export const createLive: CreateLive = (surface, input) =>
  new Live(surface, input);

/** createLive, typed with the live layer's extra hooks (showOnPage). */
export function createLiveLayer(
  surface: ViewSurface,
  input: FitViewOpenInput,
): LiveLayerImpl {
  return new Live(surface, input);
}
