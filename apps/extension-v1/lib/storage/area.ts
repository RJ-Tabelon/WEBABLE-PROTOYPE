import { browser } from 'wxt/browser';

/**
 * A minimal key-value area. The service worker is the only writer of WebAble's
 * extension storage; everything goes through this interface so the stores can
 * be unit-tested against `memoryArea()` and run against chrome.storage in the
 * extension.
 */
export interface KvArea {
  getMany(keys: readonly string[]): Promise<Record<string, unknown>>;
  /** Every key and value in the area (used for prefix scans and clearing). */
  getAll(): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

export async function getOne<T = unknown>(
  area: KvArea,
  key: string,
): Promise<T | undefined> {
  const got = await area.getMany([key]);
  return got[key] as T | undefined;
}

type ChromeAreaName = 'local' | 'session';

/** chrome.storage.local or chrome.storage.session. */
export function chromeArea(name: ChromeAreaName): KvArea {
  const area = () => browser.storage[name];
  return {
    async getMany(keys) {
      if (keys.length === 0) return {};
      return (await area().get([...keys])) as Record<string, unknown>;
    },
    async getAll() {
      return (await area().get(null)) as Record<string, unknown>;
    },
    async set(items) {
      if (Object.keys(items).length === 0) return;
      await area().set(items);
    },
    async remove(keys) {
      if (keys.length === 0) return;
      await area().remove([...keys]);
    },
  };
}

/**
 * In-memory area with chrome.storage semantics (values are structured-cloned
 * on the way in and out, so callers can never mutate stored state by reference).
 */
export function memoryArea(
  init: Record<string, unknown> = {},
): KvArea & { dump(): Record<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(structuredClone(init)));
  return {
    async getMany(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keys)
        if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async getAll() {
      return structuredClone(Object.fromEntries(data));
    },
    async set(items) {
      for (const [k, v] of Object.entries(items))
        data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of keys) data.delete(k);
    },
    dump() {
      return structuredClone(Object.fromEntries(data));
    },
  };
}

/**
 * Hide extension storage from content scripts (platform.md 2.4, D5). The
 * session tokens, the install secret and per-site history live in `local`;
 * `session` is trusted-only by default but is set explicitly as well.
 */
export async function restrictToTrustedContexts(): Promise<void> {
  const set = async (name: ChromeAreaName): Promise<void> => {
    const area = browser.storage[name] as {
      setAccessLevel?: (o: { accessLevel: string }) => Promise<void>;
    };
    if (typeof area.setAccessLevel !== 'function') return;
    await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  };
  await Promise.all([set('local'), set('session')]);
}
