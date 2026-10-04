import type { RegionAnswer } from '@webable/core/decide/wire';
import type { PageSignals } from '@webable/core/page/types';

import type { PageEvidence } from '../protocol';
import type { KvArea } from '../storage/area';
import { isRecord } from '../storage/store';
import type { KeyedAnswers } from './analysis';

/**
 * The current page view's measurements per tab (signals, evidence, answers),
 * so the worker can re-plan when the person changes a setting in the popup,
 * even after it was stopped and restarted. storage.session only: in memory,
 * cleared when the browser closes. It holds structure, never text or URLs.
 */
export interface PageMemo {
  /** Identifies one extraction, including after the MV3 worker restarts. */
  id: string;
  tabSession: string;
  signals: PageSignals;
  evidence: PageEvidence;
  answers: KeyedAnswers | null;
  /** Answer-cache keys for this page (component key -> HMAC key). */
  cacheKeys: {
    /** HMAC site key (tags cached answers for "Forget this site"). */
    site: string;
    region: Record<string, string>;
    main?: string;
    page?: string;
  };
}

interface StoredMemo extends Omit<PageMemo, 'answers'> {
  answers: {
    regions: Array<[string, RegionAnswer]>;
    main?: Record<string, number>;
    pageType?: Record<string, number>;
  } | null;
}

const keyOf = (tabId: number): string => `wa.page:${tabId}`;

function toStored(m: PageMemo): StoredMemo {
  return {
    ...m,
    answers: m.answers
      ? {
          regions: [...m.answers.regions],
          ...(m.answers.main ? { main: m.answers.main } : {}),
          ...(m.answers.pageType ? { pageType: m.answers.pageType } : {}),
        }
      : null,
  };
}

function fromStored(raw: unknown): PageMemo | null {
  if (
    !isRecord(raw) ||
    typeof raw.tabSession !== 'string' ||
    typeof raw.id !== 'string'
  )
    return null;
  if (
    !isRecord(raw.signals) ||
    !isRecord(raw.evidence) ||
    !isRecord(raw.cacheKeys)
  )
    return null;
  const s = raw as unknown as StoredMemo;
  return {
    tabSession: s.tabSession,
    id: s.id,
    signals: s.signals,
    evidence: s.evidence,
    cacheKeys: s.cacheKeys,
    answers: s.answers
      ? {
          regions: new Map(s.answers.regions),
          ...(s.answers.main ? { main: s.answers.main } : {}),
          ...(s.answers.pageType ? { pageType: s.answers.pageType } : {}),
        }
      : null,
  };
}

export class PageMemos {
  private readonly mem = new Map<number, PageMemo>();

  constructor(private readonly session: KvArea) {}

  async get(
    tabId: number,
    tabSession: string | null,
  ): Promise<PageMemo | null> {
    if (!tabSession) return null;
    let memo = this.mem.get(tabId) ?? null;
    if (!memo) {
      try {
        const got = await this.session.getMany([keyOf(tabId)]);
        memo = fromStored(got[keyOf(tabId)]);
        if (memo) this.mem.set(tabId, memo);
      } catch {
        memo = null;
      }
    }
    return memo && memo.tabSession === tabSession ? memo : null;
  }

  async set(tabId: number, memo: PageMemo): Promise<void> {
    this.mem.set(tabId, memo);
    await this.session
      .set({ [keyOf(tabId)]: toStored(memo) })
      .catch(() => undefined);
  }

  async delete(tabId: number): Promise<void> {
    this.mem.delete(tabId);
    await this.session.remove([keyOf(tabId)]).catch(() => undefined);
  }
}
