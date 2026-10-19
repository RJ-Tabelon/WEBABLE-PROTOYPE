// @vitest-environment node
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chromePort } from './chrome';

/**
 * Chrome's zoom for one tab on one site, as its ZoomController keeps it: the
 * site's own (per-origin) level, if it has one, and a per-tab level. Leaving
 * per-tab scope, a site with a level of its own gives the tab that level; a
 * site without one is given the tab's current level, so the zoom does not
 * jump (ZoomController::SetZoomMode, ZOOM_MODE_DEFAULT).
 */
class ChromeZoom {
  site: number | undefined;
  tab: number | undefined;
  scope: 'per-origin' | 'per-tab' = 'per-origin';
  readonly defaultFactor = 1;

  factor(): number {
    return this.scope === 'per-tab' && this.tab !== undefined
      ? this.tab
      : (this.site ?? this.defaultFactor);
  }

  set(factor: number): void {
    const f = factor === 0 ? this.defaultFactor : factor;
    if (this.scope === 'per-tab') this.tab = f;
    else this.site = f === this.defaultFactor ? undefined : f;
  }

  setScope(scope: 'per-origin' | 'per-tab'): void {
    if (scope === this.scope) return;
    const current = this.factor();
    if (scope === 'per-tab') this.tab = current;
    else {
      if (this.site === undefined && current !== this.defaultFactor)
        this.site = current;
      this.tab = undefined;
    }
    this.scope = scope;
  }
}

const TAB = 7;
let chrome: ChromeZoom;

beforeEach(() => {
  chrome = new ChromeZoom();
  vi.spyOn(fakeBrowser.tabs, 'getZoom').mockImplementation(async () =>
    chrome.factor(),
  );
  vi.spyOn(fakeBrowser.tabs, 'setZoom').mockImplementation(
    async (_tab: unknown, factor: unknown) => {
      chrome.set(factor as number);
    },
  );
  vi.spyOn(fakeBrowser.tabs, 'getZoomSettings').mockImplementation(
    async () => ({
      mode: 'automatic',
      scope: chrome.scope,
      defaultZoomFactor: chrome.defaultFactor,
    }),
  );
  vi.spyOn(fakeBrowser.tabs, 'setZoomSettings').mockImplementation(
    async (_tab: unknown, settings: unknown) => {
      const scope = (settings as { scope?: 'per-origin' | 'per-tab' }).scope;
      if (scope) chrome.setScope(scope);
    },
  );
});

describe('chromePort zoom', () => {
  it('taking the page scale off leaves a site without a zoom of its own without one', async () => {
    const port = chromePort();
    const own = await port.getZoom(TAB);
    await port.setZoom(TAB, 1.5);
    expect(await port.getZoom(TAB)).toBe(1.5);
    await port.releaseZoom(TAB, undefined, own);
    expect(await port.getZoom(TAB)).toBe(1);
    expect(chrome.scope).toBe('per-origin');
    // Every other page on the site opens at its own zoom, not 150%.
    expect(chrome.site).toBeUndefined();
  });

  it('a site with a zoom of its own gets it back, unchanged', async () => {
    chrome.site = 1.25;
    const port = chromePort();
    const own = await port.getZoom(TAB);
    await port.setZoom(TAB, 1.875);
    await port.releaseZoom(TAB, undefined, own);
    expect(await port.getZoom(TAB)).toBe(1.25);
    expect(chrome.site).toBe(1.25);
  });

  it('without the person’s own factor, the tab goes back to Chrome’s default first', async () => {
    const port = chromePort();
    await port.setZoom(TAB, 1.5);
    await port.releaseZoom(TAB);
    expect(await port.getZoom(TAB)).toBe(1);
    expect(chrome.site).toBeUndefined();
  });

  it('the person’s own factor is written for the site, as their Ctrl+/- would be', async () => {
    const port = chromePort();
    await port.setZoom(TAB, 1.5);
    chrome.set(1.75);
    await port.releaseZoom(TAB, 1.75);
    expect(await port.getZoom(TAB)).toBe(1.75);
    expect(chrome.site).toBe(1.75);
  });
});
