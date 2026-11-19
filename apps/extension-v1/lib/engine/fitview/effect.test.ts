import { afterEach, describe, expect, it } from 'vitest';

import { baseline, meaningful, Signals, stateOf, watchEffect } from './effect';

afterEach(() => {
  document.body.innerHTML = '';
});

function setup(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector('[data-o]') as HTMLElement;
}

describe('stateOf', () => {
  it('reads ARIA state, checked and select values', () => {
    const b = setup('<button data-o aria-pressed="false">Like</button>');
    const before = stateOf(b);
    b.setAttribute('aria-pressed', 'true');
    expect(stateOf(b)).not.toBe(before);
    const c = setup('<input data-o type="checkbox">') as HTMLInputElement;
    const off = stateOf(c);
    c.checked = true;
    expect(stateOf(c)).not.toBe(off);
    expect(stateOf(null)).toBe('');
  });
});

describe('meaningful', () => {
  it('counts text and media, not empty decoration (ripples)', async () => {
    const root = setup('<div data-o></div>');
    const seen: boolean[] = [];
    const mo = new MutationObserver((rs) => seen.push(rs.some(meaningful)));
    mo.observe(root, { childList: true, subtree: true });
    root.append(document.createElement('span'));
    await Promise.resolve();
    const p = document.createElement('p');
    p.textContent = 'Added to cart';
    root.append(p);
    await Promise.resolve();
    mo.disconnect();
    expect(seen).toEqual([false, true]);
  });
});

describe('watchEffect', () => {
  it('sees content change in the record', async () => {
    const o = setup(
      '<li><button data-o>Archive</button><span>Lunch</span></li>',
    );
    const li = o.parentElement as HTMLElement;
    const w = watchEffect({
      win: window,
      original: o,
      record: li,
      before: baseline(window, o, li),
      timeoutMs: 1000,
    });
    (li.querySelector('span') as HTMLElement).textContent = 'Archived';
    expect(await w.result).toBe('content');
  });

  it('sees a state read-back (a toggle that flips later)', async () => {
    const o = setup(
      '<div><button data-o aria-pressed="false">Like</button></div>',
    );
    const w = watchEffect({
      win: window,
      original: o,
      before: baseline(window, o),
      timeoutMs: 1000,
    });
    setTimeout(() => o.setAttribute('aria-pressed', 'true'), 150);
    expect(await w.result).toBe('state');
  });

  it('sees the original leave the page', async () => {
    const o = setup('<div><div><button data-o>Delete</button></div></div>');
    const before = baseline(window, o);
    const w = watchEffect({
      win: window,
      original: o,
      scope: document.body,
      before,
      timeoutMs: 1000,
    });
    o.remove();
    expect(await w.result).not.toBeNull();
  });

  it('sees a popup or status signal', async () => {
    const o = setup('<div><button data-o>More</button></div>');
    const signals = new Signals();
    const w = watchEffect({
      win: window,
      original: o,
      before: baseline(window, o),
      signals,
      timeoutMs: 1000,
    });
    signals.emit('popup');
    expect(await w.result).toBe('popup');
  });

  it('counts a key the site handled', async () => {
    const o = setup('<form><input data-o></form>');
    const w = watchEffect({
      win: window,
      original: o,
      before: baseline(window, o),
      timeoutMs: 1000,
    });
    w.note('handled');
    expect(w.seen()).toBe('handled');
    expect(await w.result).toBe('handled');
  });

  it('reports nothing when nothing happens', async () => {
    const o = setup('<div><button data-o>Nothing</button></div>');
    const w = watchEffect({
      win: window,
      original: o,
      before: baseline(window, o),
      timeoutMs: 150,
    });
    expect(await w.result).toBeNull();
  });
});
