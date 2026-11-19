import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Fit view's key bridge (docs/10 §4.4), in the page's MAIN world. Output:
 * content-scripts/keybridge.js, injected by the service worker
 * (chrome.scripting.executeScript, a file, so page CSP allows it) the first
 * time Fit view opens in a document.
 *
 * Some sites check keyCode/which in closure code that only trusts values set
 * in their own world (InboxSDK's finding on Gmail). The isolated world asks
 * for a key by dispatching a CustomEvent 'webable-key' ON the original
 * element; this script answers by dispatching keydown, keypress and keyup
 * with key, code, keyCode and which on that element.
 *
 *   detail '{"ping":1}'          -> preventDefault (the bridge is here)
 *   detail '{"key":"Enter"}'     -> keydown/keypress/keyup; preventDefault
 *                                   when the page cancelled the keydown
 *
 * Only a fixed set of keys is bridged, with their own codes. The bridge stops
 * the request at window capture; injected after page scripts, it cannot
 * promise a page's earlier window-capture listener never sees one. That is
 * harmless: the request carries only a key name, and a page forging one can
 * only get key events it could dispatch itself. Tiny and dependency-free on
 * purpose.
 */

export const KEY_EVENT = 'webable-key';

interface KeyDef {
  code: string;
  keyCode: number;
  /** keypress charCode; keys without a character fire no keypress. */
  charCode?: number;
}

const KEYS: Record<string, KeyDef> = {
  Enter: { code: 'Enter', keyCode: 13, charCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  ' ': { code: 'Space', keyCode: 32, charCode: 32 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
};

const INSTALLED = Symbol.for('webable.keybridge');

function fire(
  win: Window,
  target: EventTarget,
  type: 'keydown' | 'keypress' | 'keyup',
  key: string,
  def: KeyDef,
  shiftKey: boolean,
): boolean {
  const keyCode = type === 'keypress' ? (def.charCode ?? 0) : def.keyCode;
  const charCode = type === 'keypress' ? (def.charCode ?? 0) : 0;
  const ev = new KeyboardEvent(type, {
    key,
    code: def.code,
    keyCode,
    charCode,
    which: keyCode,
    shiftKey,
    bubbles: true,
    cancelable: true,
    composed: true,
    view: win,
  } as KeyboardEventInit);
  // Engines that ignore the legacy init members get them as own getters.
  const legacy: Array<[string, number]> = [
    ['keyCode', keyCode],
    ['which', keyCode],
    ['charCode', charCode],
  ];
  for (const [prop, value] of legacy) {
    if ((ev as unknown as Record<string, number>)[prop] !== value)
      Object.defineProperty(ev, prop, { get: () => value });
  }
  return target.dispatchEvent(ev);
}

export function installKeyBridge(win: Window): void {
  const w = win as Window & { [INSTALLED]?: true };
  if (w[INSTALLED]) return;
  Object.defineProperty(w, INSTALLED, { value: true });
  win.addEventListener(
    KEY_EVENT,
    (e: Event) => {
      if (!(e instanceof CustomEvent) || typeof e.detail !== 'string') return;
      e.stopImmediatePropagation();
      let req: { ping?: unknown; key?: unknown; shift?: unknown };
      try {
        req = JSON.parse(e.detail) as typeof req;
      } catch {
        return;
      }
      if (req.ping) {
        e.preventDefault();
        return;
      }
      const key = typeof req.key === 'string' ? req.key : '';
      const def = KEYS[key];
      if (!def) return;
      const target = e.composedPath()[0] ?? e.target;
      if (!target) return;
      const shift = req.shift === true;
      const down = fire(win, target, 'keydown', key, def, shift);
      if (down && def.charCode !== undefined)
        fire(win, target, 'keypress', key, def, shift);
      fire(win, target, 'keyup', key, def, shift);
      if (!down) e.preventDefault();
    },
    true,
  );
}

export default defineContentScript({
  registration: 'runtime',
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installKeyBridge(window);
  },
});
