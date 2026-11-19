import type { SentReceipt } from '@webable/core/bridge/protocol';

import type { TabDetail } from '../sw/ui';
import { clockTime, plural, structureSummary } from './format';

/**
 * "What was sent" for this page, in plain words (design-final 10.3, docs/10
 * §8): where the last request went, what it held and what it never holds.
 * Each destination has its own words; the exact body is shown either way.
 */
export interface SentCopy {
  lead: string;
  sent: string;
  notSent: string;
}

/** The receipt for this page view: the one sent at lastSentAt, else the latest for the site. */
export function receiptForPage(
  receipts: readonly SentReceipt[] | null,
  view: Pick<TabDetail, 'domain' | 'lastSentAt'>,
): SentReceipt | undefined {
  if (!receipts || !view.domain) return undefined;
  return (
    receipts.find(
      (r) => r.domain === view.domain && r.at === view.lastSentAt,
    ) ??
    (view.lastSentAt !== null
      ? receipts.find((r) => r.domain === view.domain)
      : undefined)
  );
}

/** How many parts a layout-planning outline describes: "312 parts". */
export function outlineSummary(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const nodes = (body as { skeleton?: { nodes?: unknown } }).skeleton?.nodes;
  return Array.isArray(nodes) && nodes.length > 0
    ? plural(nodes.length, 'part', 'parts')
    : null;
}

const NOT_SENT = 'page text, anything you typed, your browsing history.';

export function sentCopy(
  view: Pick<TabDetail, 'onDeviceOnly' | 'account' | 'prefs'>,
  receipt: SentReceipt | undefined,
  clock: (ms: number) => string = clockTime,
): SentCopy {
  if (receipt?.destination === 'layout_planning') {
    const parts = outlineSummary(receipt.body);
    const via =
      view.prefs.devPlanner === true
        ? 'the local dev planner'
        : 'WebAble’s server';
    return {
      lead: `Last sent ${clock(receipt.at)} to OpenAI, through ${via}`,
      sent: `a page outline${parts ? ` of ${parts}` : ''}, to plan a Fit view layout. Its only words are common interface words, like “menu”.`,
      notSent:
        'other page words, anything you typed, the address or title, your fit, or who you are.',
    };
  }
  if (receipt) {
    const summary = structureSummary(receipt.body);
    return {
      lead: `Last sent ${clock(receipt.at)} to WebAble’s server`,
      sent: summary ? `page structure — ${summary}.` : 'page structure.',
      notSent: NOT_SENT,
    };
  }
  const analysis = !view.onDeviceOnly;
  const layouts = view.account.signedIn && view.account.aiLayout === true;
  return {
    lead: 'Nothing was sent from this page.',
    sent:
      analysis && layouts
        ? 'page structure when WebAble is unsure what part of a page is for, and a page outline when you open Fit view.'
        : analysis
          ? 'page structure only, when WebAble is unsure what part of a page is for.'
          : layouts
            ? 'a page outline only, when you open Fit view.'
            : 'nothing. Suggestions run on this device only.',
    notSent: NOT_SENT,
  };
}
