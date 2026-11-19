import {
  RECEIPT_DESTINATIONS,
  type SentReceipt,
} from '@webable/core/bridge/protocol';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { isRecord, JsonStore } from './store';

/**
 * "What was sent" (ai-architecture.md 9): the exact request bodies that left
 * the device, labelled locally with the site, last 50 or 7 days.
 */
export const RECEIPT_MAX = 50;
export const RECEIPT_MAX_AGE_MS = 7 * 86_400_000;

function isReceipt(v: unknown): v is SentReceipt {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.at === 'number' &&
    typeof v.domain === 'string' &&
    (RECEIPT_DESTINATIONS as readonly unknown[]).includes(v.destination) &&
    typeof v.bytes === 'number' &&
    'body' in v
  );
}

export function trimReceipts(
  list: readonly SentReceipt[],
  now: number,
): SentReceipt[] {
  return list
    .filter((r) => now - r.at <= RECEIPT_MAX_AGE_MS)
    .sort((a, b) => a.at - b.at)
    .slice(-RECEIPT_MAX);
}

export class ReceiptLog {
  private readonly store: JsonStore<SentReceipt[]>;

  constructor(
    area: KvArea,
    private readonly now: () => number = Date.now,
  ) {
    this.store = new JsonStore(area, KEYS.receipts, (raw) =>
      Array.isArray(raw) ? raw.filter(isReceipt) : [],
    );
  }

  async add(receipt: SentReceipt): Promise<void> {
    await this.store.update((list) =>
      trimReceipts([...list, receipt], this.now()),
    );
  }

  /** Newest first. */
  async list(): Promise<SentReceipt[]> {
    return trimReceipts(await this.store.read(), this.now()).reverse();
  }

  async forgetDomain(domain: string): Promise<void> {
    await this.store.update((list) => list.filter((r) => r.domain !== domain));
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
