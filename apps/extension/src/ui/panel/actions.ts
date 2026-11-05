// Owner: P. The sheet's two actions that go through the extension rather than the page engine: "Your settings" and
// "Pause on this site".
import type { Settings } from '@webable/core';
import type { EngineApi } from '../../contracts';
import { askExt, type ExtRequest } from '../../engine/bus';

/**
 * Opens the settings page (fitting.html#settings) in a new tab. A content script cannot open extension pages
 * itself, so it asks the background with the existing `openFitting` message plus `hash: 'settings'`; a background
 * that does not read `hash` yet opens fitting.html, and if the message fails the engine's own openFitting is used.
 */
export function openSettings(api: EngineApi): void {
  const req = { type: 'openFitting', hash: 'settings' } as unknown as ExtRequest;
  askExt<unknown>(req, 4000).catch(() => {
    try {
      api.openFitting();
    } catch {
      /* nothing else can open it from the page */
    }
  });
}

/** The paused-sites list with this origin added or removed. Pure. */
export function pausedList(list: readonly string[] | undefined, origin: string, paused: boolean): string[] {
  const rest = (list ?? []).filter((o) => o !== origin);
  return paused && origin ? [...rest, origin] : rest;
}

/** Pause or resume WebAble on this site. The engine sees the settings change and refits the page. */
export async function setPaused(settings: Settings, origin: string, paused: boolean): Promise<void> {
  const pausedOrigins = pausedList(settings.pausedOrigins, origin, paused);
  try {
    await askExt<unknown>({ type: 'setSettings', patch: { pausedOrigins } }, 3000);
    return;
  } catch {
    /* the worker did not answer: write the setting directly */
  }
  try {
    await chrome.storage.local.set({ settings: { ...settings, pausedOrigins } });
  } catch {
    /* storage unavailable */
  }
}
