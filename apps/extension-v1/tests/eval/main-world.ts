import { installKeyBridge } from '../../entrypoints/keybridge.content';
import { HOST_TAG } from '../../lib/engine/util/dom';

/**
 * Real-site evaluation (scripts/eval), MAIN world, document_start:
 *
 *   - the key bridge, as keybridge.js runs it (a MAIN-world file registered
 *     next to the engine), so proxied Enter keys carry keyCode and which;
 *   - two page-side watchers the runner reads back after the interaction
 *     smoke test:
 *       __waLeaks    events that reached a document listener from Fit view's
 *                    host (the input firewall should stop every one);
 *       __waProxied  untrusted clicks on the page (what the proxies drove),
 *                    as short element descriptions, to catch wrong targets.
 *
 * Registered on `document` in the capture phase at document_start, so they
 * stand in for any page listener at or below the document.
 */

interface Watch {
  __waLeaks: string[];
  __waProxied: string[];
}

const WATCHED = [
  'keydown',
  'keypress',
  'keyup',
  'beforeinput',
  'input',
  'pointerdown',
  'mousedown',
  'mouseup',
  'click',
  'wheel',
  'focusin',
] as const;

function describe(el: Element | null): string {
  if (!el) return '(none)';
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/)[0] ?? '';
  const label = (el.getAttribute('aria-label') ?? el.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${el.localName}${cls ? `.${cls}` : ''} ${label}`.trim();
}

if (window.top === window) {
  installKeyBridge(window);
  const w = window as unknown as Watch;
  w.__waLeaks = [];
  w.__waProxied = [];
  for (const type of WATCHED) {
    document.addEventListener(
      type,
      (e) => {
        const t = e.target as Element | null;
        if (t && t.localName === HOST_TAG) {
          w.__waLeaks.push(type);
          return;
        }
        if (type === 'click' && !e.isTrusted && w.__waProxied.length < 50)
          w.__waProxied.push(describe(t));
      },
      true,
    );
  }
}
