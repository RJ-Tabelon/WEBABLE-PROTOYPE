import { getOne, type KvArea } from './area';

/**
 * Serialises async work per key. chrome.storage has no transactions, and the
 * service worker handles messages from many tabs concurrently, so every
 * read-modify-write of one key runs strictly after the previous one.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

/** One mutex for the whole worker: every store shares it, keyed by storage key. */
export const storageMutex = new KeyedMutex();

/**
 * A typed record under one storage key. `normalize` turns whatever is stored
 * (missing, an older shape, or corrupt) into a valid value, so a bad write can
 * never wedge the extension.
 */
export class JsonStore<T> {
  constructor(
    private readonly area: KvArea,
    readonly key: string,
    private readonly normalize: (raw: unknown) => T,
    private readonly mutex: KeyedMutex = storageMutex,
  ) {}

  async read(): Promise<T> {
    return this.normalize(await getOne(this.area, this.key));
  }

  /** Atomic (per worker) read-modify-write. Returns the stored value. */
  update(fn: (current: T) => T | Promise<T>): Promise<T> {
    return this.mutex.run(this.key, async () => {
      const current = this.normalize(await getOne(this.area, this.key));
      const next = await fn(current);
      await this.area.set({ [this.key]: next });
      return next;
    });
  }

  write(value: T): Promise<T> {
    return this.update(() => value);
  }

  clear(): Promise<void> {
    return this.mutex.run(this.key, () => this.area.remove([this.key]));
  }
}

// ---------------------------------------------------------------------------
// Small validation helpers for normalizers (no zod in the worker hot path).
// ---------------------------------------------------------------------------

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

export const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' ? v : fallback;

export const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' ? v : null;

/** `{ ownerUserId }` when a stored record carries one (records written before owners existed do not). */
export const ownerField = (
  raw: Record<string, unknown>,
): { ownerUserId?: string } =>
  typeof raw.ownerUserId === 'string' && raw.ownerUserId !== ''
    ? { ownerUserId: raw.ownerUserId }
    : {};
