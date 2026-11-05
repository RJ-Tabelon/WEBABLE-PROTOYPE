// Shared pieces of the real-website tasks: storage keys, the whoami reply, and small pure helpers.
// No chrome.* calls at import time, so the onboarding page, the worker, content scripts and tests can all import it.
import type { SiteTaskMessage, SiteTaskResult, SiteTaskSpec } from './types';

/** chrome.storage.session: the run in progress (the worker's own state; the onboarding reads it for progress). */
export const RUN_KEY = 'siteTaskRun';
/** chrome.storage.session: the last finished run, the onboarding's fallback if it misses the 'finished' message. */
export const FINISHED_KEY = 'siteTaskFinished';
/** A site that hasn't shown its card this long after it started loading is skipped. */
export const LOAD_TIMEOUT_MS = 20_000;
/** How long "Found it" stays before the next site loads. */
export const FOUND_HOLD_MS = 700;

/**
 * The worker's answer to {siteTask:'whoami'}:
 * - a task: this tab is the task tab and this page is the current site, so run task mode;
 * - `{ task: null }`: this is the task tab but not the current site (a redirect, a form): stay quiet, no engine;
 * - `null`: an ordinary tab.
 */
export type WhoamiReply = { task: SiteTaskSpec; index: number; total: number } | { task: null };

export interface RunState {
  taskTabId: number;
  fittingTabId: number | null;
  fittingWindowId: number | null;
  tasks: SiteTaskSpec[];
  /** The site being done now. */
  index: number;
  results: SiteTaskResult[];
  /** When the current site started loading (epoch ms). */
  loadStartedAt: number;
  /** The current site's card asked for its task (the page loaded far enough). */
  arrived: boolean;
}

export interface FinishedRecord {
  results: SiteTaskResult[];
  at: number;
}

export function skippedResult(task: SiteTaskSpec): SiteTaskResult {
  return {
    id: task.id,
    name: task.name,
    busy: task.busy,
    found: false,
    skipped: true,
    ms: null,
    wrongClicks: 0,
    nearMisses: 0,
    slips: 0,
    presses: 0,
    scrollScreens: 0,
    motionSeen: false,
    adsSeen: 0,
  };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** A result as reported by a page, checked field by field; the task's own id, name and busy always win. */
export function cleanResult(task: SiteTaskSpec, raw: unknown): SiteTaskResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof SiteTaskResult, unknown>>;
  const found = r.found === true;
  const skipped = !found && r.skipped === true;
  const ms = found && typeof r.ms === 'number' && Number.isFinite(r.ms) && r.ms >= 0 ? Math.round(r.ms) : null;
  const screens = typeof r.scrollScreens === 'number' && Number.isFinite(r.scrollScreens) && r.scrollScreens > 0 ? r.scrollScreens : 0;
  return {
    id: task.id,
    name: task.name,
    busy: task.busy,
    found,
    skipped,
    ms,
    wrongClicks: count(r.wrongClicks),
    nearMisses: count(r.nearMisses),
    slips: count(r.slips),
    presses: count(r.presses),
    scrollScreens: Math.round(screens * 10) / 10,
    motionSeen: r.motionSeen === true,
    adsSeen: count(r.adsSeen),
  };
}

/** One result per task, in task order; anything missing comes back skipped. */
export function resultsForTasks(tasks: SiteTaskSpec[], results: readonly unknown[] | null | undefined): SiteTaskResult[] {
  const byId = new Map<string, unknown>();
  for (const r of results ?? []) {
    const id = r && typeof r === 'object' ? (r as { id?: unknown }).id : undefined;
    if (typeof id === 'string') byId.set(id, r);
  }
  return tasks.map((t) => (byId.has(t.id) ? cleanResult(t, byId.get(t.id)) : skippedResult(t)));
}

export function isSiteTaskMessage(msg: unknown): msg is SiteTaskMessage {
  if (!msg || typeof msg !== 'object') return false;
  const k = (msg as { siteTask?: unknown }).siteTask;
  return k === 'start' || k === 'whoami' || k === 'done' || k === 'finished';
}

export function isTaskSpec(t: unknown): t is SiteTaskSpec {
  if (!t || typeof t !== 'object') return false;
  const s = t as Partial<SiteTaskSpec>;
  if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.prompt !== 'string') return false;
  if (typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) return false;
  return typeof s.busy === 'boolean' && !!s.target && typeof s.target === 'object';
}

export function isRunState(v: unknown): v is RunState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<RunState>;
  return typeof s.taskTabId === 'number' && Array.isArray(s.tasks) && typeof s.index === 'number' && Array.isArray(s.results);
}

const TWO_PART_SLD = /^(co|com|org|net|ac|gov|edu)$/;

function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const last = labels[labels.length - 1] ?? '';
  const second = labels[labels.length - 2] ?? '';
  const keep = last.length === 2 && TWO_PART_SLD.test(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** Same website, give or take a subdomain: www.cnn.com and edition.cnn.com, en.wikipedia.org and en.m.wikipedia.org. */
export function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname;
    const hb = new URL(b).hostname;
    if (!ha || !hb) return false;
    return siteOf(ha) === siteOf(hb);
  } catch {
    return false;
  }
}
