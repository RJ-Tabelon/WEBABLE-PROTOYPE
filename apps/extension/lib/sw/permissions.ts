import { browser } from 'wxt/browser';
import type { OpId } from '@webable/core/ops/catalog';

/**
 * Site access (platform.md 2.1, D1-D3). The manifest asks for no host access.
 * Broad access is optional (`<all_urls>`), requested with a click on the
 * welcome page or the popup; once granted, the engine and the profile's
 * pre-paint stylesheets are registered at document_start for every page
 * (persistAcrossSessions), and injected into tabs that are already open.
 * Without it, opening WebAble on a page injects into that tab via activeTab.
 */

export const ENGINE_SCRIPT_ID = 'webable-engine';
export const ENGINE_JS = 'content-scripts/engine.js';
/** Fit view's renderer and live layer, injected the first time it opens in a document. */
export const FITVIEW_JS = 'content-scripts/fitview.js';
/** Fit view's key bridge, in the page's MAIN world (a file, so page CSP allows it). */
export const KEYBRIDGE_JS = 'content-scripts/keybridge.js';
export const ALL_SITES = ['<all_urls>'] as const;

/** Reviewed pre-paint stylesheets (public/prepaint), one per op. */
export const PREPAINT_CSS: Partial<Record<OpId, string>> = {
  focus_outline: 'prepaint/focus-outline.css',
  calm_motion: 'prepaint/calm-motion.css',
};

export async function hasAllSites(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [...ALL_SITES] });
  } catch {
    return false;
  }
}

/**
 * Origins WebAble may run on without a click: `<all_urls>` once granted, or
 * the host permissions a build declares (the e2e build's fixture origin).
 */
export async function grantedOrigins(): Promise<string[]> {
  if (await hasAllSites()) return [...ALL_SITES];
  try {
    const all = await browser.permissions.getAll();
    return (all.origins ?? []).filter((o) => /^(https?|file):\/\//.test(o));
  } catch {
    return [];
  }
}

/** Match patterns that exclude a paused site and its subdomains. */
export function excludeFor(domains: readonly string[]): string[] {
  const out: string[] = [];
  for (const d of domains.slice(0, 200)) {
    if (!/^[a-z0-9.-]+$/.test(d) || !d.includes('.')) continue;
    out.push(`*://${d}/*`, `*://*.${d}/*`);
  }
  return out;
}

/**
 * Register (or update, or remove) the engine and the pre-paint CSS. `prePaint`
 * is the set of ops whose stylesheet the profile wants before first paint.
 */
export async function reconcileRegistration(opts: {
  prePaint: readonly OpId[];
  pausedDomains: readonly string[];
}): Promise<'registered' | 'updated' | 'removed' | 'none'> {
  const origins = await grantedOrigins();
  const existing = await browser.scripting
    .getRegisteredContentScripts({ ids: [ENGINE_SCRIPT_ID] })
    .catch(() => []);
  if (origins.length === 0) {
    if (existing.length === 0) return 'none';
    await browser.scripting
      .unregisterContentScripts({ ids: [ENGINE_SCRIPT_ID] })
      .catch(() => undefined);
    return 'removed';
  }
  const css = opts.prePaint
    .map((op) => PREPAINT_CSS[op])
    .filter((f): f is string => typeof f === 'string');
  const excludeMatches = excludeFor(opts.pausedDomains);
  const script = {
    id: ENGINE_SCRIPT_ID,
    matches: origins,
    js: [ENGINE_JS],
    ...(css.length ? { css } : {}),
    ...(excludeMatches.length ? { excludeMatches } : {}),
    runAt: 'document_start' as const,
    allFrames: false,
    persistAcrossSessions: true,
  };
  if (existing.length > 0) {
    // updateContentScripts cannot clear css/excludeMatches, so re-register.
    await browser.scripting.unregisterContentScripts({
      ids: [ENGINE_SCRIPT_ID],
    });
    await browser.scripting.registerContentScripts([script]);
    return 'updated';
  }
  await browser.scripting.registerContentScripts([script]);
  return 'registered';
}

/** Inject the engine (and the pre-paint CSS) into one tab that is already open. */
export async function injectTab(
  tabId: number,
  prePaint: readonly OpId[],
): Promise<boolean> {
  try {
    const files = prePaint
      .map((op) => PREPAINT_CSS[op])
      .filter((f): f is string => typeof f === 'string');
    if (files.length)
      await browser.scripting.insertCSS({ target: { tabId }, files });
    await browser.scripting.executeScript({
      target: { tabId },
      files: [`/${ENGINE_JS}` as const],
      injectImmediately: true,
    });
    return true;
  } catch {
    // Restricted page, discarded tab, or no access: nothing to do.
    return false;
  }
}

/**
 * Fit view's scripts in the top frame of one tab (docs/10 §4.3): the
 * renderer in the engine's isolated world, then the key bridge in the page's
 * MAIN world. Both guard against running twice in a document. False when
 * either could not be injected (no access, a restricted or discarded tab).
 */
export async function injectFitView(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: [`/${FITVIEW_JS}` as const],
      injectImmediately: true,
    });
    await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: [`/${KEYBRIDGE_JS}` as const],
      world: 'MAIN',
      injectImmediately: true,
    });
    return true;
  } catch {
    return false;
  }
}
