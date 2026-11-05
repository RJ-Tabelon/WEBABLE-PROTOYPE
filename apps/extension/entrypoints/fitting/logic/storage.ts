// Extension storage and tab helpers for the fitting page. Falls back to localStorage when the page is
// opened outside the extension (development preview), so the flow never crashes.

import { SERVER_ORIGIN, type FitProfile, type Settings } from '@webable/core';
import type { RunEvidence } from './evidence';

type ChromeLike = typeof chrome;

function ext(): ChromeLike | null {
  const c = (globalThis as { chrome?: ChromeLike }).chrome;
  return c && c.storage && c.storage.local ? c : null;
}

const DEV_KEY = 'webable.dev.fit';

export async function loadFit(): Promise<FitProfile | null> {
  const c = ext();
  try {
    if (c) {
      const got = await c.storage.local.get('fit');
      const fit = (got as { fit?: FitProfile }).fit;
      return fit && fit.v === 'fit.1' ? fit : null;
    }
    const s = localStorage.getItem(DEV_KEY);
    return s ? (JSON.parse(s) as FitProfile) : null;
  } catch {
    return null;
  }
}

export async function saveFit(fit: FitProfile): Promise<boolean> {
  const c = ext();
  try {
    if (c) await c.storage.local.set({ fit });
    else localStorage.setItem(DEV_KEY, JSON.stringify(fit));
    return true;
  } catch {
    return false;
  }
}

/** What the person struggled with in their last run (round 8c), saved next to the settings. */
export const EVIDENCE_KEY = 'webable.evidence';
const DEV_EVIDENCE_KEY = 'webable.dev.evidence';

function isEvidence(x: unknown): x is RunEvidence {
  return !!x && typeof x === 'object' && Array.isArray((x as RunEvidence).sites) && Array.isArray((x as RunEvidence).gotInWay);
}

export async function loadEvidence(): Promise<RunEvidence | null> {
  const c = ext();
  try {
    if (c) {
      const got = (await c.storage.local.get(EVIDENCE_KEY)) as Record<string, unknown>;
      const e = got[EVIDENCE_KEY];
      return isEvidence(e) ? e : null;
    }
    const s = localStorage.getItem(DEV_EVIDENCE_KEY);
    const e: unknown = s ? JSON.parse(s) : null;
    return isEvidence(e) ? e : null;
  } catch {
    return null;
  }
}

export async function saveEvidence(evidence: RunEvidence): Promise<boolean> {
  const c = ext();
  try {
    if (c) await c.storage.local.set({ [EVIDENCE_KEY]: evidence });
    else localStorage.setItem(DEV_EVIDENCE_KEY, JSON.stringify(evidence));
    return true;
  } catch {
    return false;
  }
}

export async function loadServerOrigin(): Promise<string> {
  const c = ext();
  try {
    if (c) {
      const got = await c.storage.local.get('settings');
      const s = (got as { settings?: Partial<Settings> }).settings;
      if (s?.serverOrigin) return s.serverOrigin;
    }
  } catch {
    /* fall through */
  }
  return SERVER_ORIGIN;
}

/** The person's own zoom on this tab (1 when unknown). */
export async function readZoom(): Promise<number> {
  const c = ext();
  try {
    if (c?.tabs?.getCurrent && c.tabs.getZoom) {
      const tab = await c.tabs.getCurrent();
      if (tab?.id !== undefined) {
        const z = await c.tabs.getZoom(tab.id);
        if (Number.isFinite(z) && z > 0) return z;
      }
    }
  } catch {
    /* fall through */
  }
  return 1;
}

export async function closeThisTab(): Promise<void> {
  const c = ext();
  try {
    if (c?.tabs?.getCurrent) {
      const tab = await c.tabs.getCurrent();
      if (tab?.id !== undefined) {
        await c.tabs.remove(tab.id);
        return;
      }
    }
  } catch {
    /* fall through */
  }
  window.close();
}

export async function openPage(url: string): Promise<void> {
  const c = ext();
  try {
    if (c?.tabs?.create) {
      await c.tabs.create({ url });
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, '_blank', 'noopener');
}
