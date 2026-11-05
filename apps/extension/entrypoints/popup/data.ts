// Owner: P, F. Popup data: settings in chrome.storage.local and the active tab's site. The popup is an extension
// page, so it reads storage directly and writes through the background (which tells open tabs).
import { DEFAULT_SETTINGS, type Settings } from '@webable/core';
import { askExt } from '../../src/engine/bus';

export interface ActiveTab {
  id: number | null;
  url: string;
  origin: string | null; // only for http(s) pages
}

export function mergeSettings(v: unknown): Settings {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    pausedOrigins: Array.isArray(s.pausedOrigins) ? s.pausedOrigins.filter((x): x is string => typeof x === 'string') : [],
    serverOrigin: typeof s.serverOrigin === 'string' && s.serverOrigin ? s.serverOrigin : DEFAULT_SETTINGS.serverOrigin,
  };
}

export async function readSettings(): Promise<Settings> {
  try {
    const got = await chrome.storage.local.get('settings');
    return mergeSettings(got.settings);
  } catch {
    return mergeSettings(null);
  }
}

/** Through the background first (it may tell open tabs); straight to storage if the worker is not answering. */
export async function writeSettings(next: Settings, patch: Partial<Settings>): Promise<void> {
  try {
    await askExt<unknown>({ type: 'setSettings', patch }, 3000);
    return;
  } catch {
    /* fall through */
  }
  await chrome.storage.local.set({ settings: next });
}

export async function activeTab(): Promise<ActiveTab> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? '';
    let origin: string | null = null;
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') origin = u.origin;
    } catch {
      origin = null;
    }
    return { id: typeof tab?.id === 'number' ? tab.id : null, url, origin };
  } catch {
    return { id: null, url: '', origin: null };
  }
}

/** "nytimes.com" for the site row. */
export function siteLabel(origin: string | null): string {
  if (!origin) return '';
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
