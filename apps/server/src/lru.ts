/** A small LRU with a per-entry time to live, plus in-flight de-duplication of identical work. */
export class TtlLru<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();
  private readonly inflight = new Map<string, Promise<V>>();
  hits = 0;
  misses = 0;

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  get enabled(): boolean {
    return this.ttlMs > 0 && this.max > 0;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    if (!this.enabled) return undefined;
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    if (!this.enabled) return;
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  /**
   * Return the cached value, join identical work already in flight, or run `make` once.
   * `fromCache` tells the caller whether `make` ran for this call.
   */
  async getOrMake(
    key: string,
    make: () => Promise<V>,
    opts: { fresh?: boolean; keep?: (v: V) => boolean } = {},
  ): Promise<{ value: V; fromCache: boolean }> {
    if (!opts.fresh) {
      const hit = this.get(key);
      if (hit !== undefined) {
        this.hits++;
        return { value: hit, fromCache: true };
      }
      const pending = this.inflight.get(key);
      if (pending) {
        this.hits++;
        return { value: await pending, fromCache: true };
      }
    }
    this.misses++;
    const p = make();
    this.inflight.set(key, p);
    try {
      const value = await p;
      if (!opts.keep || opts.keep(value)) this.set(key, value);
      return { value, fromCache: false };
    } finally {
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    }
  }
}
