import { useSyncExternalStore } from 'react';

/**
 * A counter that says "the account's data changed". Pages read Supabase in the
 * browser, so after a save (or a sign-in as someone else) they bump this and
 * every open view reads again. It replaces the server's revalidatePath.
 */

let version = 0;
const listeners = new Set<() => void>();

export function dataVersion(): number {
  return version;
}

/** Ask every open view to read its data again. */
export function refreshData(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDataVersion(): number {
  return useSyncExternalStore(subscribeData, dataVersion, () => 0);
}

/**
 * Share one in-flight read between the frame and the page (what React's
 * cache() did on the server). A result is reused for a few seconds at most,
 * so moving between pages still reads fresh data.
 */
export function sharedRead<T>(load: () => Promise<T>, maxAgeMs = 5000) {
  let cached: { version: number; at: number; promise: Promise<T> } | null =
    null;
  return (): Promise<T> => {
    const now = Date.now();
    if (cached && cached.version === version && now - cached.at < maxAgeMs)
      return cached.promise;
    const promise = load();
    const entry = { version, at: now, promise };
    cached = entry;
    promise.catch(() => {
      if (cached === entry) cached = null;
    });
    return promise;
  };
}
