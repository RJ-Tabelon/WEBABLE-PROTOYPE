import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installKeyBridge,
  KEY_EVENT as BRIDGE_EVENT,
} from '../../../entrypoints/keybridge.content';
import { isProxyEvent } from './firewall';
import {
  clickSequence,
  isComboboxLike,
  isOn,
  KEY_EVENT,
  pressKey,
  safeHref,
  setNativeValue,
} from './proxy';

afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * Under vitest, jsdom's `window` is the Node global, which jsdom's UI event
 * constructors reject as `view` ("member view is not of type Window").
 * Chrome accepts the page's window, and tests/v2/proxy.spec.ts and
 * live.spec.ts cover real dispatch there. Here the constructors drop `view`
 * and keep every other member.
 */
const VIEW_EVENTS = [
  'MouseEvent',
  'PointerEvent',
  'KeyboardEvent',
  'FocusEvent',
  'InputEvent',
] as const;
type EventCtor = new (
  type: string,
  init?: EventInit & { view?: unknown },
) => Event;
const realCtors = new Map<string, EventCtor>();

beforeAll(() => {
  const g = globalThis as unknown as Record<string, EventCtor>;
  for (const name of VIEW_EVENTS) {
    const Base = g[name];
    if (typeof Base !== 'function') continue;
    realCtors.set(name, Base);
    g[name] = class extends Base {
      constructor(type: string, init?: EventInit & { view?: unknown }) {
        const { view: _view, ...rest } = init ?? {};
        super(type, rest);
      }
    };
  }
});

afterAll(() => {
  const g = globalThis as unknown as Record<string, EventCtor>;
  for (const [name, ctor] of realCtors) g[name] = ctor;
});

describe('safeHref', () => {
  it('keeps http(s), mailto and tel only', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe(
      'https://example.com/a?b=1',
    );
    expect(safeHref('/x', 'https://example.com/')).toBe(
      'https://example.com/x',
    );
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    expect(safeHref('tel:+15555550100')).toBe('tel:+15555550100');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

describe('setNativeValue', () => {
  it('sets the value past an instance override (a framework value tracker)', () => {
    document.body.innerHTML = '<input>';
    const el = document.querySelector('input') as HTMLInputElement;
    let tracked = '';
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() {
        return Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.get?.call(this);
      },
      set(v: string) {
        tracked = v;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set?.call(this, v);
      },
    });
    setNativeValue(el, 'hello');
    expect(el.value).toBe('hello');
    expect(tracked).toBe('');
  });
});

describe('state and kinds', () => {
  it('reads toggle state from checked or ARIA', () => {
    document.body.innerHTML =
      '<input type="checkbox" checked><button aria-pressed="true"></button><div role="switch" aria-checked="false"></div>';
    const [c, b, s] = Array.from(document.body.children);
    expect(isOn(c as Element)).toBe(true);
    expect(isOn(b as Element)).toBe(true);
    expect(isOn(s as Element)).toBe(false);
  });

  it('recognises fields that show suggestions', () => {
    document.body.innerHTML =
      '<input role="combobox"><input aria-autocomplete="list"><input list="d"><div role="combobox"><input></div><input>';
    const inputs = Array.from(document.querySelectorAll('input'));
    expect(inputs.map(isComboboxLike)).toEqual([true, true, true, true, false]);
  });
});

describe('clickSequence', () => {
  it('sends the pointer and mouse sequence at the centre, marked as proxy events', () => {
    document.body.innerHTML = '<button>Go</button>';
    const b = document.querySelector('button') as HTMLButtonElement;
    b.getBoundingClientRect = () => ({
      left: 10,
      top: 20,
      width: 100,
      height: 40,
      right: 110,
      bottom: 60,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    const seen: Array<[string, number, number, number, boolean]> = [];
    for (const t of [
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click',
    ])
      b.addEventListener(t, (e) => {
        const m = e as MouseEvent;
        seen.push([e.type, m.clientX, m.clientY, m.detail, isProxyEvent(e)]);
      });
    clickSequence(window, b);
    const types = seen.map((s) => s[0]);
    expect(types.filter((t) => t.startsWith('mouse') || t === 'click')).toEqual(
      ['mousedown', 'mouseup', 'click'],
    );
    for (const [type, x, y, detail, marked] of seen) {
      expect([x, y]).toEqual([60, 40]);
      expect(marked).toBe(true);
      if (type !== 'pointerdown' && type !== 'pointerup')
        expect(detail).toBe(1);
    }
  });
});

describe('pressKey and the key bridge', () => {
  beforeAll(() => {
    installKeyBridge(window);
  });

  it('agrees with the bridge on the event name', () => {
    expect(KEY_EVENT).toBe(BRIDGE_EVENT);
  });

  it('presses Enter through the bridge with keyCode and which', () => {
    document.body.innerHTML = '<form><input></form>';
    const input = document.querySelector('input') as HTMLInputElement;
    const seen: string[] = [];
    for (const t of ['keydown', 'keypress', 'keyup'])
      input.addEventListener(t, (e) => {
        const k = e as KeyboardEvent;
        seen.push(`${e.type}:${k.key}:${k.keyCode}:${k.which}`);
      });
    const r = pressKey(input, 'Enter');
    expect(r).toEqual({ bridged: true, prevented: false });
    expect(seen).toEqual([
      'keydown:Enter:13:13',
      'keypress:Enter:13:13',
      'keyup:Enter:13:13',
    ]);
  });

  it('reports a keydown the page handled, and sends no keypress then', () => {
    document.body.innerHTML = '<input>';
    const input = document.querySelector('input') as HTMLInputElement;
    const seen: string[] = [];
    input.addEventListener('keydown', (e) => {
      seen.push(e.type);
      e.preventDefault();
    });
    input.addEventListener('keypress', (e) => seen.push(e.type));
    input.addEventListener('keyup', (e) => seen.push(e.type));
    expect(pressKey(input, 'Enter').prevented).toBe(true);
    expect(seen).toEqual(['keydown', 'keyup']);
  });

  it('keeps bridge requests away from page listeners and bridges only known keys', () => {
    document.body.innerHTML = '<input>';
    const input = document.querySelector('input') as HTMLInputElement;
    const page: string[] = [];
    const listener = (e: Event): void => {
      page.push(e.type);
    };
    document.addEventListener(BRIDGE_EVENT, listener, true);
    input.addEventListener('keydown', listener);
    input.dispatchEvent(
      new CustomEvent(BRIDGE_EVENT, {
        detail: JSON.stringify({ key: 'q' }),
        bubbles: true,
        composed: true,
      }),
    );
    pressKey(input, 'Escape');
    document.removeEventListener(BRIDGE_EVENT, listener, true);
    expect(page).toEqual(['keydown']);
  });
});
