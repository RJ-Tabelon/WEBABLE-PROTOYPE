// Round 9: the person's AI answer, read and saved. Everything goes through the background (readerImport, setReader);
// loading reads 'reader' from chrome.storage.local directly, like the fit. Outside the extension (development
// preview) the saved reader lives in localStorage, and importing fails in plain words.

import { AI_ANSWER_MAX_CHARS, AI_ANSWER_MIN_CHARS, type ReaderProfile } from '@webable/core';
import { ask, BusError } from '../../../src/engine/bus';

export type AiSource = 'ChatGPT' | 'Claude';

/** Why an import failed, as the screen says it. */
export type ImportProblem = 'short' | 'unavailable';

export const PROBLEM_WORDS: Record<ImportProblem, string> = {
  short: 'That answer is very short. Paste the whole reply.',
  unavailable: 'Couldn’t read that right now. Try again in a moment.',
};

/** Reading the answer takes READER_MODEL and Jev 5–20 s; leave room before calling it unavailable. */
const IMPORT_TIMEOUT_MS = 60_000;
const READER_KEY = 'reader';
const DEV_READER_KEY = 'webable.dev.reader';

function storage(): typeof chrome.storage.local | null {
  const c = (globalThis as { chrome?: typeof chrome }).chrome;
  return c?.storage?.local ?? null;
}

export function isReader(x: unknown): x is ReaderProfile {
  return !!x && typeof x === 'object' && (x as ReaderProfile).v === 'reader.1' && Array.isArray((x as ReaderProfile).points);
}

export async function loadReader(): Promise<ReaderProfile | null> {
  try {
    const s = storage();
    if (s) {
      const got = (await s.get(READER_KEY)) as Record<string, unknown>;
      return isReader(got[READER_KEY]) ? (got[READER_KEY] as ReaderProfile) : null;
    }
    const raw = localStorage.getItem(DEV_READER_KEY);
    const r: unknown = raw ? JSON.parse(raw) : null;
    return isReader(r) ? r : null;
  } catch {
    return null;
  }
}

/** Through the background first (it tells open tabs); straight to storage if the worker is not answering. */
export async function saveReader(reader: ReaderProfile | null): Promise<ReaderProfile | null> {
  try {
    const back = await ask<ReaderProfile | null>({ type: 'setReader', reader }, 4000);
    return isReader(back) ? back : reader;
  } catch {
    /* fall through */
  }
  try {
    const s = storage();
    if (s) {
      if (reader) await s.set({ [READER_KEY]: reader });
      else await s.remove(READER_KEY);
    } else if (reader) localStorage.setItem(DEV_READER_KEY, JSON.stringify(reader));
    else localStorage.removeItem(DEV_READER_KEY);
  } catch {
    /* nothing more to try */
  }
  return reader;
}

/** What gets sent: trimmed, and no longer than the server takes. */
export function answerText(text: string): string {
  return text.trim().slice(0, AI_ANSWER_MAX_CHARS);
}

export function longEnough(text: string): boolean {
  return text.trim().length >= AI_ANSWER_MIN_CHARS;
}

export function problemOf(err: unknown): ImportProblem {
  if (err instanceof BusError) {
    if (err.code === 'refused' || err.status === 422 || /short|too few|not enough/i.test(err.message)) return 'short';
  }
  return 'unavailable';
}

export class ImportError extends Error {
  readonly problem: ImportProblem;
  constructor(problem: ImportProblem) {
    super(PROBLEM_WORDS[problem]);
    this.name = 'ImportError';
    this.problem = problem;
  }
}

/**
 * Sends the answer to be read. The background saves what comes back as 'reader', so the caller restores the previous
 * one if the person backs out before saving. Throws an ImportError.
 */
export async function importReader(text: string, source: string | null): Promise<ReaderProfile> {
  const body = answerText(text);
  if (body.length < AI_ANSWER_MIN_CHARS) throw new ImportError('short');
  let reader: ReaderProfile;
  try {
    reader = await ask<ReaderProfile>({ type: 'readerImport', req: source ? { text: body, source } : { text: body } }, IMPORT_TIMEOUT_MS);
  } catch (err) {
    throw new ImportError(problemOf(err));
  }
  if (!isReader(reader)) throw new ImportError('unavailable');
  // Jev found nothing the answer supports: almost always a cut-off paste.
  if (reader.points.length === 0) throw new ImportError('short');
  return reader;
}

/** "From ChatGPT", "From your AI". */
export function fromWords(source: string): string {
  return `From ${source.trim() || 'your AI'}`;
}

/**
 * Test hook for automation (scripts/eval), as `window.__reader`: `await __reader.load(text, 'ChatGPT')` reads the
 * answer, saves it and returns what was saved; `get()` is the saved one or null; `clear()` removes it.
 */
export interface ReaderHook {
  load(text: string, source?: string): Promise<ReaderProfile>;
  get(): Promise<ReaderProfile | null>;
  clear(): Promise<void>;
}

export function readerHook(onChange: (reader: ReaderProfile | null) => void): ReaderHook {
  return {
    load: async (text, source) => {
      const saved = await saveReader(await importReader(text, source ?? null));
      if (!saved) throw new ImportError('unavailable');
      onChange(saved);
      return saved;
    },
    get: () => loadReader(),
    clear: async () => {
      await saveReader(null);
      onChange(null);
    },
  };
}
