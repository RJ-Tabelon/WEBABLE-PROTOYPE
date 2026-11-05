// What the browser can tell us before any tap (fitting brief round 4 §1, layer 1). Read directly in this extension
// page: Chrome's font settings, default and per-site zoom, the OS preferences as media queries, and languages.
// Nothing here is a question, and nothing leaves the laptop.

import type { BrowserSettings } from '@webable/core';

export const STIMULUS_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export interface Env {
  dpr: number;
  vw: number;
  vh: number;
  /** The page's own zoom (Chrome's default zoom applies to extension pages too): CSS px × zoom = px at 100%. */
  zoom: number;
  reducedMotion: boolean;
  coarse: boolean;
  /** x-height / font size of the stimulus font, measured. */
  xRatio: number;
  /** Average character advance / font size for the sentence pool, measured. */
  charRatio: number;
}

type ChromeLike = typeof chrome;

function ext(): ChromeLike | null {
  const c = (globalThis as { chrome?: ChromeLike }).chrome;
  return c && c.runtime && c.runtime.id ? c : null;
}

function mq(q: string): boolean {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
}

/** The computed size of `font-size: <value>` in this page (CSS px), or null. */
function probeFont(value: string): number | null {
  try {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;visibility:hidden;font-size:${value};line-height:normal;`;
    el.textContent = 'x';
    document.body.appendChild(el);
    const px = parseFloat(getComputedStyle(el).fontSize);
    el.remove();
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

let canvas: HTMLCanvasElement | null = null;
function ctx2d(): CanvasRenderingContext2D | null {
  canvas ??= document.createElement('canvas');
  return canvas.getContext('2d');
}

export function measureXRatio(): number {
  const c = ctx2d();
  if (!c) return 0.52;
  c.font = `400 100px ${STIMULUS_FONT}`;
  const r = c.measureText('x').actualBoundingBoxAscent / 100;
  return r > 0.3 && r < 0.8 ? r : 0.52;
}

export function measureCharRatio(sample: string): number {
  const c = ctx2d();
  if (!c || !sample) return 0.5;
  c.font = `400 100px ${STIMULUS_FONT}`;
  const r = c.measureText(sample).width / sample.length / 100;
  return r > 0.3 && r < 0.9 ? r : 0.5;
}

async function currentTabId(c: ChromeLike): Promise<number | null> {
  try {
    const tab = await c.tabs.getCurrent();
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

/** This page's zoom (1 when unknown). */
export async function readPageZoom(): Promise<number> {
  const c = ext();
  try {
    if (c?.tabs?.getZoom) {
      const id = await currentTabId(c);
      if (id != null) {
        const z = await c.tabs.getZoom(id);
        if (Number.isFinite(z) && z > 0) return z;
      }
    }
  } catch {
    /* fall through */
  }
  return 1;
}

export function captureEnv(sample: string, zoom: number): Env {
  return {
    dpr: window.devicePixelRatio || 1,
    vw: window.innerWidth,
    vh: window.innerHeight,
    zoom,
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    coarse: mq('(pointer: coarse)'),
    xRatio: measureXRatio(),
    charRatio: measureCharRatio(sample),
  };
}

function hostOf(url: string | undefined): string | null {
  if (!url || !/^https?:/i.test(url)) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Chrome's and the OS's own settings. `chrome.fontSettings` needs the `fontSettings` permission (no install warning);
 * without it, the default and minimum font sizes are read from how this page computes `medium` and a 1 px font,
 * which Chrome resolves with the same settings.
 */
export async function readBrowserSettings(): Promise<BrowserSettings> {
  const c = ext();
  let defaultFontPx: number | null = null;
  let minFontPx: number | null = null;
  let defaultZoom: number | null = null;
  const siteZooms: Array<{ site: string; zoom: number }> = [];

  try {
    const fs = c?.fontSettings;
    if (fs?.getDefaultFontSize) defaultFontPx = (await fs.getDefaultFontSize({})).pixelSize ?? null;
    if (fs?.getMinimumFontSize) minFontPx = (await fs.getMinimumFontSize({})).pixelSize ?? null;
  } catch {
    /* no permission yet: probe below */
  }
  defaultFontPx ??= probeFont('medium');
  if (minFontPx == null) {
    const one = probeFont('1px');
    minFontPx = one != null && one > 1.5 ? one : 0;
  }

  try {
    if (c?.tabs?.getZoomSettings) {
      const id = await currentTabId(c);
      const zs = id != null ? await c.tabs.getZoomSettings(id) : await c.tabs.getZoomSettings();
      if (zs?.defaultZoomFactor && Number.isFinite(zs.defaultZoomFactor)) defaultZoom = zs.defaultZoomFactor;
    }
  } catch {
    /* unknown */
  }

  // Zoom the person holds on sites already open (the same evidence the passive fit uses), hostnames only.
  try {
    if (c?.tabs?.query && c.tabs.getZoom) {
      const tabs = await c.tabs.query({});
      const seen = new Set<string>();
      for (const t of tabs.slice(0, 40)) {
        const site = hostOf(t.url);
        if (!site || seen.has(site) || t.id == null) continue;
        seen.add(site);
        const z = await c.tabs.getZoom(t.id).catch(() => null);
        if (z != null && Math.abs(z - (defaultZoom ?? 1)) >= 0.05) siteZooms.push({ site, zoom: Math.round(z * 100) / 100 });
      }
    }
  } catch {
    /* fine without */
  }

  const pointer: BrowserSettings['pointer'] = mq('(pointer: coarse)') ? 'coarse' : mq('(pointer: fine)') ? 'fine' : 'none';
  return {
    defaultFontPx,
    minFontPx,
    defaultZoom,
    siteZooms,
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    contrastMore: mq('(prefers-contrast: more)'),
    forcedColors: mq('(forced-colors: active)'),
    colorScheme: mq('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    reducedTransparency: mq('(prefers-reduced-transparency: reduce)'),
    languages: [...(navigator.languages ?? [navigator.language])].filter(Boolean).slice(0, 6),
    pointer,
    anyHover: mq('(any-hover: hover)'),
  };
}

/** Plain words for the settings that shaped the warm-up, kept with the fit. */
export function settingsUsed(s: BrowserSettings): string[] {
  const out: string[] = [];
  if (s.defaultFontPx != null && Math.abs(s.defaultFontPx - 16) >= 0.5) out.push(`Default font ${Math.round(s.defaultFontPx)} px`);
  if (s.defaultZoom != null && Math.abs(s.defaultZoom - 1) >= 0.01) out.push(`Page zoom ${Math.round(s.defaultZoom * 100)}%`);
  if (s.minFontPx != null && s.minFontPx > 0) out.push(`Minimum font ${Math.round(s.minFontPx)} px`);
  if (s.siteZooms.length) out.push(`Zoomed in on ${s.siteZooms.length} open site${s.siteZooms.length === 1 ? '' : 's'}`);
  if (s.reducedMotion) out.push('Reduce motion');
  if (s.contrastMore) out.push('More contrast');
  if (s.forcedColors) out.push('System colours');
  if (s.colorScheme === 'dark') out.push('Dark appearance');
  if (s.pointer === 'coarse') out.push('Touch screen');
  return out;
}
