import { HOST_TAG } from '../util/dom';
import { FV_COPY, h } from './components';
import { createViewRouter } from './firewall';
import { FIREWALL_KEY, type FirewallTarget } from './types';

/**
 * Fit view's host (docs/10 §4.3 "Mechanics"): a separate <webable-ui>
 * instance on documentElement (the engine's walkers and verifier skip the tag),
 * a closed shadow root, and a <dialog> opened with showModal():
 *
 *   - the view sits in the top layer, above any z-index the site uses;
 *   - focus is contained natively and Esc is a close request;
 *   - the rest of the document becomes inert without a single site attribute
 *     being written.
 *
 * The sheet is constructed (adoptedStyleSheets), so a strict page CSP never
 * blocks it; DOM is built with createElement only.
 *
 * Input firewall (WP6, fitview/firewall.ts): a window-capture listener stops
 * every event whose target is this host before any page listener sees it and
 * hands it to `dispatch`, registered under FIREWALL_KEY while the view is
 * mounted. The router re-dispatches a non-composed copy inside the shadow
 * root, so the view's components keep ordinary listeners and the page never
 * sees the person's input.
 */

export interface HostOptions {
  /** 'closed' in production; tests may open it to run axe-core. */
  mode?: 'open' | 'closed';
  /** Esc (or the dialog closed on its own): the view should close. */
  onCancel(): void;
  /** Esc pressed inside the view: return true when a sheet consumed it. */
  onEscape(): boolean;
}

export interface Host {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly dialog: HTMLDialogElement;
  readonly scroller: HTMLElement;
  /** The top strip container (filled by render.ts). */
  readonly strip: HTMLElement;
  /** The content column holding <main>. */
  readonly page: HTMLElement;
  readonly main: HTMLElement;
  readonly sheet: HTMLElement;
  readonly loading: HTMLElement;
  /** "Back to Fit view" pill shown while peeking (a popover, top layer). */
  readonly peek: HTMLElement;
  /** Polite announcements of the view's own changes. */
  readonly announcer: HTMLElement;
  readonly shown: boolean;
  setCss(css: string): void;
  show(): void;
  /** Close the dialog but keep everything (peek). */
  hide(): void;
  dispose(): void;
  /** The firewall's entry point (also registered under FIREWALL_KEY). */
  dispatch(e: Event): void;
}

type Slot = { [FIREWALL_KEY]?: FirewallTarget };

const HOST_STYLE: ReadonlyArray<[string, string]> = [
  ['all', 'initial'],
  ['display', 'block'],
  ['position', 'fixed'],
  ['top', '0'],
  ['left', '0'],
  ['width', '0'],
  ['height', '0'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['overflow', 'visible'],
  ['pointer-events', 'none'],
  ['z-index', '2147483647'],
  ['contain', 'style'],
];

/** The focused element inside `root` (or null). */
function activeIn(root: ShadowRoot): Element | null {
  return root.activeElement;
}

export function mountHost(doc: Document, opts: HostOptions): Host {
  const host = doc.createElement(HOST_TAG);
  for (const [k, v] of HOST_STYLE) host.style.setProperty(k, v, 'important');
  host.setAttribute('data-webable', 'fit-view');
  const root = host.attachShadow({ mode: opts.mode ?? 'closed' });
  const sheet = new CSSStyleSheet();
  root.adoptedStyleSheets = [sheet];

  const dialog = h(doc, 'dialog', 'fv');
  dialog.setAttribute('aria-label', FV_COPY.dialog);
  const scroller = h(doc, 'div', 'fv-scroller');
  const skip = h(doc, 'a', 'fv-skip fv-wa fv-wa--fill', FV_COPY.skip);
  skip.href = '#fv-main';
  const strip = h(doc, 'header', 'fv-strip');
  const page = h(doc, 'div', 'fv-page');
  const main = h(doc, 'main', 'fv-main');
  main.id = 'fv-main';
  main.tabIndex = -1;
  page.append(main);
  scroller.append(skip, strip, page);
  const announcer = h(doc, 'div', 'fv-sr');
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  const loading = h(doc, 'div', 'fv-loading');
  loading.hidden = true;
  const loadingPill = h(doc, 'div', 'fv-loading__pill', FV_COPY.loading);
  loading.append(loadingPill);
  const sheetEl = h(doc, 'div', 'fv-sheet');
  sheetEl.hidden = true;
  dialog.append(scroller, sheetEl, loading, announcer);
  const peek = h(doc, 'div', 'fv-peek');
  peek.setAttribute('popover', 'manual');
  root.append(dialog, peek);

  // Skip link: fragment navigation does not reach into a shadow root.
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    main.focus();
  });

  let shown = false;
  // The dialog's close event is queued (fired a task later): count the
  // closes WebAble asked for, so only a close by the browser reads as Esc.
  let expectedCloses = 0;
  let disposed = false;

  // Focus rings follow the keyboard (:focus-visible semantics): focus the
  // view moves itself (on open, after "Show n more") draws none until a key
  // is pressed; a pointer press puts them away again.
  root.addEventListener('keydown', () => dialog.classList.add('is-kbd'), {
    capture: true,
  });
  root.addEventListener(
    'pointerdown',
    () => dialog.classList.remove('is-kbd'),
    { capture: true },
  );

  // Esc inside the view: a sheet consumes it first, then the view closes.
  root.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.key !== 'Escape' || k.defaultPrevented) return;
    if (opts.onEscape()) {
      k.preventDefault();
      k.stopPropagation();
      return;
    }
    // A search field with text clears first; the next Esc closes the view.
    const a = activeIn(root);
    if (
      a instanceof HTMLInputElement &&
      a.type === 'search' &&
      a.value !== ''
    ) {
      k.preventDefault();
      a.value = '';
      // The live layer mirrors the field to the original on input.
      a.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (opts.onEscape()) return;
    opts.onCancel();
  });
  dialog.addEventListener('close', () => {
    if (expectedCloses > 0) {
      expectedCloses--;
      return;
    }
    if (disposed || dialog.open) return;
    // Closed by the browser (a repeated Esc is no longer cancellable).
    shown = false;
    opts.onCancel();
  });

  // The firewall's router (fitview/firewall.ts): delivers a non-composed copy
  // of each stopped event to the element the person pointed at or focused.
  const router = createViewRouter(root);
  const dispatch = (e: Event): void => {
    if (disposed || !e.isTrusted) return;
    router.dispatch(e);
  };

  const firewall: FirewallTarget = { host, dispatch };
  const slot = globalThis as unknown as Slot;
  slot[FIREWALL_KEY] = firewall;
  doc.documentElement.append(host);

  return {
    host,
    root,
    dialog,
    scroller,
    strip,
    page,
    main,
    sheet: sheetEl,
    loading,
    peek,
    announcer,
    get shown() {
      return shown;
    },
    setCss(css) {
      sheet.replaceSync(css);
    },
    show() {
      if (disposed || dialog.open) {
        shown = dialog.open;
        return;
      }
      if (!host.isConnected) doc.documentElement.append(host);
      try {
        dialog.showModal();
      } catch {
        // A document that cannot show a modal (not fully active): non-modal.
        dialog.show();
      }
      shown = true;
    },
    hide() {
      if (!dialog.open) return;
      expectedCloses++;
      dialog.close();
      shown = false;
    },
    dispose() {
      if (disposed) return;
      try {
        if (peek.matches(':popover-open')) peek.hidePopover();
      } catch {
        // already hidden
      }
      disposed = true;
      if (dialog.open) dialog.close();
      shown = false;
      router.dispose();
      if (slot[FIREWALL_KEY] === firewall) delete slot[FIREWALL_KEY];
      host.remove();
    },
    dispatch,
  };
}
