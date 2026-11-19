import type { AdaptEvent } from '@webable/core/learning/types';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { isRecord, JsonStore } from './store';

/**
 * The local event log (personalization.md 12): the last 500 events or 30
 * days, whichever is smaller. It never leaves the device; learning reads the
 * domain-free deltas derived from it instead.
 */
export const EVENT_MAX = 500;
export const EVENT_MAX_AGE_MS = 30 * 86_400_000;

function isEvent(v: unknown): v is AdaptEvent {
  return (
    isRecord(v) &&
    v.v === 1 &&
    typeof v.id === 'string' &&
    typeof v.t === 'number' &&
    typeof v.op === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.domain === 'string'
  );
}

/** Append and trim to the ring bounds. Pure. */
export function appendEvents(
  log: readonly AdaptEvent[],
  add: readonly AdaptEvent[],
  now: number,
): AdaptEvent[] {
  const cutoff = now - EVENT_MAX_AGE_MS;
  const merged = [...log, ...add].filter((e) => e.t >= cutoff);
  merged.sort((a, b) => a.t - b.t);
  return merged.slice(-EVENT_MAX);
}

export class EventLog {
  private readonly store: JsonStore<AdaptEvent[]>;

  constructor(
    area: KvArea,
    private readonly now: () => number = Date.now,
  ) {
    this.store = new JsonStore(area, KEYS.events, (raw) =>
      Array.isArray(raw) ? raw.filter(isEvent) : [],
    );
  }

  async append(events: readonly AdaptEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.store.update((log) => appendEvents(log, events, this.now()));
  }

  async list(): Promise<AdaptEvent[]> {
    const log = await this.store.read();
    return appendEvents(log, [], this.now());
  }

  /** Remove every event for one site ("Forget this site"). */
  async forgetDomain(domain: string): Promise<void> {
    await this.store.update((log) => log.filter((e) => e.domain !== domain));
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
