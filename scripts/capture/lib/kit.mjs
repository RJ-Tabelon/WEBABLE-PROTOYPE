/* global window, document, getComputedStyle, requestAnimationFrame -- page.evaluate callbacks run in the page. */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Shared capture plumbing: viewports, contexts, settling a page before a shot,
 * file naming (<surface>__<state>__<viewport>-<theme>.png) and the record of
 * every image and every miss that INDEX.md is written from.
 */

export const VIEWPORTS = {
  desktop: {
    tag: '1440',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  mobile: {
    tag: '390',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

/** The three web configurations every page is captured in. */
export const WEB_MATRIX = [
  { vp: 'desktop', theme: 'light' },
  { vp: 'desktop', theme: 'dark' },
  { vp: 'mobile', theme: 'light' },
];

export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class Recorder {
  constructor(outDir) {
    this.outDir = outDir;
    this.entries = [];
    this.misses = [];
    this.notes = [];
    this.names = new Set();
  }

  /** A line for INDEX.md's Notes section (a state that exists but was not reachable, etc.). */
  note(text) {
    this.notes.push(text);
  }

  async init() {
    await mkdir(this.outDir, { recursive: true });
  }

  fileName({ surface, state, viewport, theme }) {
    return `${slug(surface)}__${slug(state)}__${viewport}-${theme}.png`;
  }

  /**
   * Screenshot `page` (or `locator`) into the output folder.
   * @param {object} meta surface, state, viewport ('1440' | '390' | '380' ...),
   *   theme, full (full page), note, group (INDEX section)
   */
  async shot(page, meta, { locator, fullPage, clip, keepPointer } = {}) {
    const name = this.fileName(meta);
    // No hover states in the pictures unless the pointer is part of the state.
    if (!keepPointer) await page.mouse.move(0, 0).catch(() => undefined);
    const path = join(this.outDir, name);
    const options = {
      path,
      animations: 'disabled',
      caret: 'hide',
      scale: 'device',
    };
    if (fullPage && !locator) {
      await revealAll(page);
      const parts = await fullPageShot(page, options, (part) =>
        join(this.outDir, this.fileName({ ...meta, state: meta.state + part })),
      );
      for (const part of parts)
        this.record({ ...meta, state: meta.state + part }, true);
      return path;
    }
    if (locator) await locator.screenshot(options);
    else await page.screenshot({ ...options, clip });
    this.record(meta, false);
    return path;
  }

  record(meta, full) {
    const name = this.fileName(meta);
    if (this.names.has(name)) return;
    this.names.add(name);
    this.entries.push({ ...meta, file: name, full });
  }

  miss(meta, reason) {
    this.misses.push({ ...meta, reason: oneLine(reason) });
    console.warn(
      `  ! missed ${meta.surface} / ${meta.state ?? '*'} ${meta.viewport ?? ''}-${meta.theme ?? ''}: ${oneLine(reason)}`,
    );
  }

  /** Run one capture step; a failure is recorded as a miss and the run goes on. */
  async attempt(meta, fn) {
    try {
      await fn();
      return true;
    } catch (error) {
      this.miss(meta, error instanceof Error ? error.message : String(error));
      return false;
    }
  }
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function oneLine(text) {
  return String(text)
    .replace(ANSI, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .slice(0, 300);
}

/** Fonts loaded, two frames painted, finite animations done (bounded). */
export async function settle(page, ms = 150) {
  await page
    .evaluate(async () => {
      await document.fonts?.ready;
      const deadline = performance.now() + 1500;
      while (performance.now() < deadline) {
        const running = document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              Number.isFinite(a.effect?.getComputedTiming?.().endTime ?? 0),
          );
        if (running.length === 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    })
    .catch(() => undefined);
  if (ms) await page.waitForTimeout(ms);
}

/**
 * Scroll through the whole page once so anything revealed on scroll is drawn,
 * then return to the top, before a full-page screenshot.
 */
export async function revealAll(page) {
  await page
    .evaluate(async () => {
      const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
      const max = () => document.documentElement.scrollHeight;
      for (let y = 0; y < max(); y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    })
    .catch(() => undefined);
  await settle(page, 200);
}

/** Tallest page drawn by growing the viewport; taller pages use Playwright's stitching. */
const TALL_VIEWPORT_MAX = 8000;

/**
 * Whether the page pins something to the bottom of the viewport (a sticky
 * action bar, a full-height rail). Playwright's full-page capture keeps the
 * layout viewport, so such an element would be drawn over the middle of the
 * page; those pages are drawn in a viewport as tall as the document instead.
 */
function pinnedToViewport(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height < 40) continue;
      if (r.bottom < vh - 2 || r.top >= vh) continue;
      if (r.top > vh / 2 || r.height >= vh - 2) return true;
    }
    return false;
  });
}

/**
 * Chromium cannot draw one capture taller than 16384 device pixels (the page
 * starts over below that), so taller pages are saved in parts.
 */
const MAX_DEVICE_PX = 16000;

/**
 * A full-page picture. Returns the state suffixes written: [''] for one image,
 * or ['-part-1-of-2', '-part-2-of-2'] for a page too tall for one.
 */
async function fullPageShot(page, options, pathFor) {
  const size = page.viewportSize();
  const { height, dpr } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    dpr: window.devicePixelRatio || 1,
  }));
  const pinned =
    size &&
    height > size.height &&
    height <= TALL_VIEWPORT_MAX &&
    (await pinnedToViewport(page));
  if (!pinned) {
    if (!size || height * dpr <= MAX_DEVICE_PX) {
      await page.screenshot({ ...options, fullPage: true });
      return [''];
    }
    const partHeight = Math.floor(MAX_DEVICE_PX / dpr);
    const count = Math.ceil(height / partHeight);
    const suffixes = [];
    for (let i = 0; i < count; i++) {
      const suffix = `-part-${i + 1}-of-${count}`;
      const y = i * partHeight;
      await page.screenshot({
        ...options,
        path: pathFor(suffix),
        fullPage: true,
        clip: {
          x: 0,
          y,
          width: size.width,
          height: Math.min(partHeight, height - y),
        },
      });
      suffixes.push(suffix);
    }
    return suffixes;
  }
  try {
    let h = height;
    for (let i = 0; i < 3; i++) {
      await page.setViewportSize({ width: size.width, height: h });
      await settle(page, 150);
      const next = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      if (next <= h) break;
      h = Math.min(next, TALL_VIEWPORT_MAX);
    }
    await page.screenshot(options);
    return [''];
  } finally {
    await page.setViewportSize(size);
    await settle(page, 150);
  }
}

/** A browser context for one web configuration. */
export async function webContext(browser, { vp, theme }, extra = {}) {
  const v = VIEWPORTS[vp];
  return browser.newContext({
    viewport: v.viewport,
    deviceScaleFactor: v.deviceScaleFactor,
    isMobile: v.isMobile,
    hasTouch: v.hasTouch,
    colorScheme: theme,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    reducedMotion: 'no-preference',
    ...extra,
  });
}

/** Meta for a web shot in a configuration. */
export function metaFor(surface, state, { vp, theme }, extra = {}) {
  return { surface, state, viewport: VIEWPORTS[vp].tag, theme, ...extra };
}
