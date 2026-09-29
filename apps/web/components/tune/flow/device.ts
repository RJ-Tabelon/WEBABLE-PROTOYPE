import type { DeviceClass, DeviceContext } from '@webable/core';

import type { Setup } from './steps';

/**
 * V0 environment capture (cal-vision §3). Everything stays in coarse buckets:
 * no exact screen size, user agent or fingerprint is kept. The pure functions
 * take a probe so they can be tested without a browser.
 */

export interface EnvironmentProbe {
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  coarsePointer: boolean;
  anyFinePointer: boolean;
  hover: boolean;
  reducedMotion: boolean;
  dark: boolean;
  moreContrast: boolean;
  forcedColors: boolean;
  /** The browser's default font size, CSS px (a `font-size: medium` probe). */
  rootFontPx: number;
  /** Pinch zoom (visualViewport.scale). */
  visualScale: number;
}

const DPR_BUCKETS = [1, 1.5, 2, 3, 4] as const;

export function dprBucket(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  let best: number = DPR_BUCKETS[0];
  for (const b of DPR_BUCKETS) {
    if (Math.abs(b - dpr) < Math.abs(best - dpr)) best = b;
  }
  return best;
}

export function viewportBucket(width: number): DeviceContext['viewport'] {
  if (width < 640) return 'S';
  if (width < 1024) return 'M';
  if (width < 1440) return 'L';
  return 'XL';
}

export function deviceClassOf(probe: EnvironmentProbe): DeviceClass {
  const short = Math.min(probe.screenWidth, probe.screenHeight);
  if (probe.coarsePointer && !probe.anyFinePointer) {
    return short < 600 ? 'phone' : 'tablet';
  }
  return Math.max(probe.screenWidth, probe.screenHeight) >= 1920
    ? 'desktop'
    : 'laptop';
}

/** The pre-selected answer to "How do you usually point?" The person confirms it. */
export function guessInput(probe: EnvironmentProbe): Setup['input'] {
  if (probe.coarsePointer && !probe.anyFinePointer) return 'touch';
  return 'mouse';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function deviceContextFrom(
  probe: EnvironmentProbe,
  input: Setup['input'],
): DeviceContext {
  return {
    class: deviceClassOf(probe),
    input,
    dprBucket: dprBucket(probe.devicePixelRatio),
    viewport: viewportBucket(probe.innerWidth),
    reducedMotion: probe.reducedMotion,
    colorScheme: probe.dark ? 'dark' : 'light',
    moreContrast: probe.moreContrast,
    forcedColors: probe.forcedColors,
    rootFontPx: clamp(Math.round(probe.rootFontPx * 10) / 10, 8, 64),
    zoom: clamp(Math.round(probe.visualScale * 100) / 100, 0.25, 5),
  };
}

/** The browser's default font size: what `font-size: medium` resolves to. */
export function browserDefaultFontPx(doc: Document = document): number {
  try {
    const probe = doc.createElement('div');
    probe.style.cssText =
      'position:absolute;visibility:hidden;font-size:medium;inline-size:0;block-size:0;overflow:hidden';
    doc.body.appendChild(probe);
    const px = Number.parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return Number.isFinite(px) && px > 0 ? px : 16;
  } catch {
    return 16;
  }
}

function matches(win: Window, query: string): boolean {
  try {
    return win.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Reads the environment. Browser only. */
export function probeEnvironment(win: Window = window): EnvironmentProbe {
  return {
    devicePixelRatio: win.devicePixelRatio || 1,
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
    screenWidth: win.screen?.width ?? win.innerWidth,
    screenHeight: win.screen?.height ?? win.innerHeight,
    coarsePointer: matches(win, '(pointer: coarse)'),
    anyFinePointer: matches(win, '(any-pointer: fine)'),
    hover: matches(win, '(hover: hover)'),
    reducedMotion: prefersReducedMotion(win),
    dark: matches(win, '(prefers-color-scheme: dark)'),
    moreContrast: matches(win, '(prefers-contrast: more)'),
    forcedColors: matches(win, '(forced-colors: active)'),
    rootFontPx: browserDefaultFontPx(win.document),
    visualScale: win.visualViewport?.scale ?? 1,
  };
}

/**
 * Less motion, from the OS or from the person's WebAble profile
 * (`data-wa-motion="reduce"` on <html>, written by fit-ui).
 */
export function prefersReducedMotion(win: Window = window): boolean {
  return (
    matches(win, '(prefers-reduced-motion: reduce)') ||
    win.document?.documentElement?.getAttribute('data-wa-motion') === 'reduce'
  );
}
