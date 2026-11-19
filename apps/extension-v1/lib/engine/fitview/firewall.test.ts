import { afterEach, describe, expect, it } from 'vitest';

import {
  copyEvent,
  createViewRouter,
  FIREWALL_EVENTS,
  installFirewall,
  isPersonEvent,
  isProxyEvent,
  isViewEvent,
  markProxyEvent,
} from './firewall';
import { FIREWALL_KEY, type FirewallTarget } from './types';

type Slot = { [FIREWALL_KEY]?: FirewallTarget };

afterEach(() => {
  delete (globalThis as Slot)[FIREWALL_KEY];
  document.body.innerHTML = '';
  document.querySelectorAll('webable-ui').forEach((h) => h.remove());
});

describe('installFirewall', () => {
  it('is installed once per window', () => {
    const a = installFirewall(window);
    const b = installFirewall(window);
    expect(b).toBe(a);
    a();
    const c = installFirewall(window);
    expect(c).not.toBe(a);
    c();
  });

  it('covers pointer, mouse, wheel, touch, key, input, composition, focus and clipboard events', () => {
    for (const t of [
      'pointerdown',
      'mousedown',
      'click',
      'auxclick',
      'dblclick',
      'contextmenu',
      'wheel',
      'touchstart',
      'keydown',
      'keypress',
      'keyup',
      'beforeinput',
      'input',
      'compositionstart',
      'focusin',
      'focusout',
      'copy',
      'paste',
    ])
      expect(FIREWALL_EVENTS).toContain(t);
  });

  it('ignores untrusted events: a page cannot drive the view through the host', () => {
    const uninstall = installFirewall(window);
    const host = document.createElement('webable-ui');
    document.documentElement.append(host);
    const routed: string[] = [];
    (globalThis as Slot)[FIREWALL_KEY] = {
      host,
      dispatch: (e) => routed.push(e.type),
    };
    const page: string[] = [];
    const listener = (e: Event): void => {
      page.push(e.type);
    };
    window.addEventListener('keydown', listener);
    host.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'j', bubbles: true }),
    );
    window.removeEventListener('keydown', listener);
    uninstall();
    expect(routed).toEqual([]);
    expect(page).toEqual(['keydown']);
  });
});

describe('proxy event marks', () => {
  it('are shared through the global, so other bundles see them', () => {
    const e = markProxyEvent(new MouseEvent('click'));
    expect(isProxyEvent(e)).toBe(true);
    expect(isProxyEvent(new MouseEvent('click'))).toBe(false);
    const shared = (globalThis as unknown as Record<symbol, WeakSet<Event>>)[
      Symbol.for('webable.fitview.proxy-events')
    ];
    expect(shared?.has(e)).toBe(true);
  });
});

describe('copyEvent', () => {
  it('keeps the constructor and fields, and never leaves the shadow root', () => {
    const k = copyEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        shiftKey: true,
        cancelable: true,
        bubbles: true,
        composed: true,
      }),
    ) as KeyboardEvent;
    expect(k).toBeInstanceOf(KeyboardEvent);
    expect([
      k.key,
      k.code,
      k.shiftKey,
      k.cancelable,
      k.bubbles,
      k.composed,
    ]).toEqual(['Enter', 'Enter', true, true, true, false]);
    const m = copyEvent(
      new MouseEvent('mousedown', {
        clientX: 10,
        clientY: 20,
        button: 0,
        buttons: 1,
        bubbles: true,
        composed: true,
      }),
    ) as MouseEvent;
    expect([m.clientX, m.clientY, m.buttons, m.composed]).toEqual([
      10,
      20,
      1,
      false,
    ]);
  });
});

describe('createViewRouter', () => {
  function view(): {
    host: HTMLElement;
    root: ShadowRoot;
    input: HTMLInputElement;
  } {
    const host = document.createElement('webable-ui');
    const root = host.attachShadow({ mode: 'closed' });
    const input = document.createElement('input');
    root.append(input);
    document.documentElement.append(host);
    return { host, root, input };
  }

  it('delivers key events to the focused control as view events, and their cancel back', () => {
    const { root, input } = view();
    input.focus();
    const router = createViewRouter(root);
    const got: Array<{ key: string; view: boolean; person: boolean }> = [];
    input.addEventListener('keydown', (e) => {
      got.push({ key: e.key, view: isViewEvent(e), person: isPersonEvent(e) });
      e.preventDefault();
    });
    const outside: string[] = [];
    const listener = (e: Event): void => {
      outside.push(e.type);
    };
    window.addEventListener('keydown', listener, true);
    const original = new KeyboardEvent('keydown', {
      key: 'k',
      cancelable: true,
    });
    router.dispatch(original);
    window.removeEventListener('keydown', listener, true);
    router.dispose();
    expect(got).toEqual([{ key: 'k', view: true, person: true }]);
    expect(original.defaultPrevented).toBe(true);
    // The copy is not composed: nothing outside the root saw it.
    expect(outside).toEqual([]);
  });

  it('delivers input events to the focused field', () => {
    const { root, input } = view();
    input.focus();
    const router = createViewRouter(root);
    const types: string[] = [];
    input.addEventListener('input', (e) =>
      types.push(`${e.type}:${(e as InputEvent).data}`),
    );
    router.dispatch(
      new InputEvent('input', { data: 'j', inputType: 'insertText' }),
    );
    router.dispose();
    expect(types).toEqual(['input:j']);
  });

  it('routes focusout to the element that had focus', () => {
    const { root, input } = view();
    const router = createViewRouter(root);
    input.focus();
    const seen: boolean[] = [];
    input.addEventListener('focusout', (e) => seen.push(isViewEvent(e)));
    router.dispatch(new FocusEvent('focusout'));
    router.dispose();
    expect(seen).toEqual([true]);
  });
});
