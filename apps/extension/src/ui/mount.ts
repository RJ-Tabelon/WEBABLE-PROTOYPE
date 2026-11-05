// Owner: P, U. Mounts the in-page chrome: a <webable-ui> host on documentElement, a closed shadow root,
// and one popover="manual" layer in the top layer (above any page z-index). The layer ignores the pointer;
// only our controls take clicks, so the page underneath keeps working.
import { h, render } from 'preact';
import type { EngineApi } from '../contracts';
import { App } from './App';
import { baseCss } from './base.css';
import { lensCss } from './lens/lens.css';
import { offersCss } from './offers/offers.css';
import { rootCss } from './panel/panel.css';
import { themeModeFor, tokensFor, tokensToCss, type ThemeMode } from './tokens';

const HOST_TAG = 'webable-ui';

let currentHost: HTMLElement | null = null;
let currentShadow: ShadowRoot | null = null;
let currentCalmShadow: ShadowRoot | null = null;
let currentUnmount: (() => void) | null = null;

/** True for any event target that belongs to WebAble's own UI (the host, or anything inside our shadow roots). */
export function isOurUi(target: EventTarget | null): boolean {
  if (!target || !currentHost) return false;
  if (target === currentHost) return true;
  if (!(target instanceof Node)) return false;
  if (currentHost.contains(target)) return true;
  let root: Node = target.getRootNode();
  for (let i = 0; i < 8 && root instanceof ShadowRoot; i++) {
    if (root === currentShadow || root === currentCalmShadow) return true;
    root = root.host.getRootNode();
  }
  return false;
}

function shadowMode(): ShadowRootMode {
  // Open in the e2e build so Playwright can pierce it; closed everywhere else.
  try {
    return import.meta.env.MODE === 'e2e' ? 'open' : 'closed';
  } catch {
    return 'closed';
  }
}

function sheet(css: string): CSSStyleSheet | null {
  try {
    const s = new CSSStyleSheet();
    s.replaceSync(css);
    return s;
  } catch {
    return null;
  }
}

function adopt(root: ShadowRoot, sheets: Array<CSSStyleSheet | null>, fallbackCss: string): void {
  const ok = sheets.filter((s): s is CSSStyleSheet => s !== null);
  if (ok.length === sheets.length) {
    try {
      root.adoptedStyleSheets = ok;
      return;
    } catch {
      /* very old engine: fall back to a <style> element below */
    }
  }
  const style = document.createElement('style');
  style.textContent = fallbackCss;
  root.append(style);
}

const CALM_HOST_CSS = /* css */ `
.wa-calm-host {
  position: fixed; inset: 0; z-index: 10; display: none; overflow: auto; overscroll-behavior: contain;
  pointer-events: none; outline: none;
}
.wa-calm-host.is-open { display: block; }
.wa-calm-host.is-open.has-content { pointer-events: auto; background: var(--wa-canvas, #F5F5F7); }
.wa-calm-host.is-open.has-content[data-mode="dark"] { background: var(--wa-canvas, #000000); }
.wa-calm-host.is-open.has-content[data-mode="max"] { background: var(--wa-canvas, #FFFFFF); }
/* Round 8: the simplified page arrives in one calm fade (none when motion is reduced). */
@keyframes wa-calm-host-in { from { opacity: 0; } to { opacity: 1; } }
.wa-calm-host.is-open.has-content { animation: wa-calm-host-in .32s ease-out both; }
.wa-calm-host.is-open.has-content[data-motion="reduce"] { animation: none; }
@media (prefers-reduced-motion: reduce) { .wa-calm-host.is-open.has-content { animation: none; } }
`;

export function mountUi(api: EngineApi): () => void {
  if (currentUnmount) currentUnmount();

  const host = document.createElement(HOST_TAG);
  // CSSOM writes (not a style attribute) so strict style-src CSP pages accept it.
  host.style.cssText =
    'all: initial; display: block; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: shadowMode() });

  // Theme tokens from D1, rebuilt when the fit changes. Lengths are computed at zoom 1: the Calm view host is CSS-zoomed
  // by 1 ÷ page zoom (App does that), so the view renders at the fit's own sizes whatever the page zoom.
  const tokensSheet = sheet('');
  let themeKey = '';
  const updateTokens = () => {
    const st = api.getState();
    const mode: ThemeMode = themeModeFor(st.fit);
    const key = `${st.fit?.createdAt ?? 'none'}|${st.fit?.text?.bodyPx ?? ''}|${st.fit?.text?.override ?? ''}|${st.fit?.targets?.minPx ?? ''}|${mode}`;
    if (key === themeKey || !tokensSheet) return;
    themeKey = key;
    try {
      tokensSheet.replaceSync(tokensToCss(tokensFor(st.fit, mode, { zoom: 1 }), ':host'));
    } catch {
      /* D1 tokens not ready: our chrome uses its own fallbacks */
    }
  };
  updateTokens();

  const chromeCss = [rootCss, CALM_HOST_CSS, lensCss, offersCss].join('\n');
  adopt(shadow, [tokensSheet, sheet(chromeCss)], chromeCss);

  const layer = document.createElement('div');
  layer.className = 'wa-layer';
  layer.setAttribute('popover', 'manual');

  const calmHost = document.createElement('div');
  calmHost.className = 'wa-calm-host';
  calmHost.tabIndex = -1;
  calmHost.setAttribute('role', 'dialog');
  calmHost.setAttribute('aria-modal', 'true');
  calmHost.setAttribute('aria-label', 'Simplified page');
  const calmShadow = calmHost.attachShadow({ mode: shadowMode() });
  adopt(calmShadow, [tokensSheet, sheet(baseCss)], baseCss);
  const calmMount = document.createElement('div');
  calmMount.className = 'wa-calm-mount';
  calmShadow.append(calmMount);

  const appRoot = document.createElement('div');
  appRoot.className = 'wa-app';
  layer.append(calmHost, appRoot);
  shadow.append(layer);

  // Keys typed in our UI must not reach page shortcuts that listen in the bubble phase.
  const stopKeys = (e: Event) => e.stopPropagation();
  const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;
  for (const type of KEY_EVENTS) host.addEventListener(type, stopKeys);

  currentHost = host;
  currentShadow = shadow;
  currentCalmShadow = calmShadow;

  document.documentElement.append(host);

  const supportsPopover = typeof (layer as { showPopover?: unknown }).showPopover === 'function';
  const show = () => {
    if (!supportsPopover) {
      layer.classList.add('wa-nopopover');
      return;
    }
    try {
      if (!layer.matches(':popover-open')) layer.showPopover();
    } catch {
      layer.classList.add('wa-nopopover');
    }
  };
  show();

  render(h(App, { api, isOurUi, calmHost, calmMount }), appRoot);

  // Keep the theme in step with the fit, and the Calm host's pointer state in step with its content.
  // `data-calm="open"` on both hosts (and `data-calm-open` on <webable-ui> and .wa-root) lets any stylesheet, ours
  // or the Calm view's, key on the Calm view being open.
  const markCalm = () => {
    const isOpen = api.getState().calm.open;
    const open = isOpen ? 'open' : 'closed';
    if (host.getAttribute('data-calm') !== open) host.setAttribute('data-calm', open);
    if (calmHost.getAttribute('data-calm') !== open) calmHost.setAttribute('data-calm', open);
    host.toggleAttribute('data-calm-open', isOpen);
  };
  markCalm();
  const offState = api.subscribe(() => {
    updateTokens();
    markCalm();
  });
  const calmObserver = new MutationObserver(() => {
    calmHost.classList.toggle('has-content', calmHost.classList.contains('is-open') && calmMount.childElementCount > 0);
  });
  calmObserver.observe(calmMount, { childList: true });

  // Keep the layer on top: re-attach if the page removes us, and re-raise when the page opens its own
  // (non-modal) popover later. A page's modal dialog is allowed to sit above us.
  const seenPopovers = new WeakSet<Element>();
  const keepOnTop = window.setInterval(() => {
    if (!host.isConnected) {
      document.documentElement.append(host);
      show();
      return;
    }
    if (!supportsPopover) return;
    try {
      if (!layer.matches(':popover-open')) {
        show();
        return;
      }
      if (document.querySelector(':modal')) return;
      if (shadow.activeElement || calmShadow.activeElement) return;
      let fresh = false;
      for (const el of Array.from(document.querySelectorAll(':popover-open'))) {
        if (!seenPopovers.has(el)) {
          seenPopovers.add(el);
          fresh = true;
        }
      }
      if (fresh) {
        layer.hidePopover();
        layer.showPopover();
      }
    } catch {
      /* selector support varies; staying where we are is fine */
    }
  }, 1200);

  const unmount = () => {
    window.clearInterval(keepOnTop);
    calmObserver.disconnect();
    offState();
    render(null, appRoot);
    for (const type of KEY_EVENTS) host.removeEventListener(type, stopKeys);
    try {
      if (supportsPopover && layer.matches(':popover-open')) layer.hidePopover();
    } catch {
      /* ignore */
    }
    host.remove();
    if (currentHost === host) {
      currentHost = null;
      currentShadow = null;
      currentCalmShadow = null;
      currentUnmount = null;
    }
  };
  currentUnmount = unmount;
  return unmount;
}
