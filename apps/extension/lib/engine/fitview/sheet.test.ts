import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Ephemeral } from './locate';
import { readOptions } from './sheet';
import type { SkeletonRegistry } from './types';

const reg = {
  name: (el: Element) => el.getAttribute('aria-label') ?? '',
  text: (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
  href: (el: Element) => (el as HTMLAnchorElement).href || null,
} as unknown as SkeletonRegistry;

type CheckVis = { checkVisibility?: () => boolean };
let original: CheckVis['checkVisibility'];

beforeEach(() => {
  // jsdom has no layout: treat everything not [hidden] as rendered.
  original = (Element.prototype as CheckVis).checkVisibility;
  (Element.prototype as CheckVis).checkVisibility = function (this: Element) {
    return !this.closest('[hidden]');
  };
});
afterEach(() => {
  (Element.prototype as CheckVis).checkVisibility = original;
  document.body.innerHTML = '';
});

describe('readOptions', () => {
  it('reads visible, enabled, labelled items with their state', () => {
    document.body.innerHTML = `<ul role="listbox">
      <li role="option">apple</li>
      <li role="option" aria-selected="true">apricot</li>
      <li role="option" aria-disabled="true">avocado</li>
      <li role="option" hidden>banana</li>
      <li role="option"><span aria-hidden="true"></span></li>
    </ul>`;
    const popup = document.querySelector('[role="listbox"]') as Element;
    const opts = readOptions(popup, reg, new Ephemeral());
    expect(opts.map((o) => [o.label, o.selected])).toEqual([
      ['apple', false],
      ['apricot', true],
    ]);
    expect(
      opts.every(
        (o) => o.target.role === 'button' && o.target.id.startsWith('x'),
      ),
    ).toBe(true);
  });

  it('uses links and buttons when the popup has no item roles, keeping hrefs safe', () => {
    document.body.innerHTML = `<div role="menu">
      <a href="https://example.com/settings">Settings</a>
      <a href="javascript:void(0)">Sign out</a>
      <button aria-haspopup="menu">More</button>
    </div>`;
    const opts = readOptions(
      document.querySelector('[role="menu"]') as Element,
      reg,
      new Ephemeral(),
    );
    expect(
      opts.map((o) => [
        o.label,
        o.target.role,
        o.target.href ?? null,
        o.target.popup ?? false,
      ]),
    ).toEqual([
      ['Settings', 'link', 'https://example.com/settings', false],
      ['Sign out', 'button', null, false],
      ['More', 'button', null, true],
    ]);
  });

  it('keeps one id per item across re-reads', () => {
    document.body.innerHTML =
      '<div role="menu"><div role="menuitem">Mute</div></div>';
    const popup = document.querySelector('[role="menu"]') as Element;
    const eph = new Ephemeral();
    const a = readOptions(popup, reg, eph);
    const b = readOptions(popup, reg, eph);
    expect(a[0]?.target.id).toBe(b[0]?.target.id);
  });
});
