import { OP_IDS, type OpId } from '@webable/core/ops/catalog';
import { PAGE_CATEGORIES } from '@webable/core/page/types';

import type { ContentToWorker } from '../protocol';
import { isRecord } from '../storage/store';
import type { UiMessage } from './ui';
import { UNDO_REASONS } from './undo';

/**
 * Runtime message validation. Content scripts and extension pages share
 * chrome.runtime.onMessage; the sender decides which vocabulary is accepted:
 * `cs:*` only from content scripts in a tab, `ui:*` (and test-only `e2e:*`)
 * only from WebAble's own pages. Shapes are checked before anything runs.
 */

const OP_SET: ReadonlySet<string> = new Set(OP_IDS);
const CATS: ReadonlySet<string> = new Set(PAGE_CATEGORIES);
const isOp = (v: unknown): v is OpId => typeof v === 'string' && OP_SET.has(v);
const isTabId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;
/** An http(s) origin with no path, as the popup passes to chrome.permissions.request. */
const isOrigin = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > 300) return false;
  try {
    const u = new URL(v);
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === v
    );
  } catch {
    return false;
  }
};

export interface RuntimeSender {
  id?: string;
  url?: string;
  tab?: { id?: number };
  frameId?: number;
  origin?: string;
}

export type SenderKind = 'content' | 'page' | 'unknown';

export function senderKind(
  sender: RuntimeSender,
  extensionId: string,
): SenderKind {
  if (sender.id !== extensionId) return 'unknown';
  const extOrigin = `chrome-extension://${extensionId}`;
  const fromExtensionPage =
    typeof sender.url === 'string' && sender.url.startsWith(`${extOrigin}/`);
  if (fromExtensionPage) return 'page';
  if (sender.tab && typeof sender.tab.id === 'number') return 'content';
  return 'unknown';
}

const FRICTION = new Set([
  'misclick_burst',
  'rage_click',
  'zoom_in',
  'scroll_reversal',
]);
const OFFER_ANSWERS = new Set(['accept', 'dismiss', 'never_here', 'timeout']);

export function parseContent(msg: unknown): ContentToWorker | null {
  if (!isRecord(msg) || typeof msg.type !== 'string') return null;
  switch (msg.type) {
    case 'cs:hello':
      return msg.restored === true
        ? { type: 'cs:hello', restored: true }
        : { type: 'cs:hello' };
    case 'cs:signals':
      return isRecord(msg.signals) &&
        isRecord(msg.evidence) &&
        isRecord((msg.evidence as Record<string, unknown>).page) &&
        isRecord((msg.evidence as Record<string, unknown>).regions) &&
        (msg.signals as Record<string, unknown>).v === 1
        ? (msg as unknown as ContentToWorker)
        : null;
    case 'cs:applied':
      return typeof msg.planId === 'string' &&
        Array.isArray(msg.changes) &&
        msg.changes.every((c) => isRecord(c) && isOp(c.op) && isRecord(c.trace))
        ? (msg as unknown as ContentToWorker)
        : null;
    case 'cs:event': {
      const ev = msg.event;
      return isRecord(ev) &&
        isOp(ev.op) &&
        typeof ev.kind === 'string' &&
        typeof ev.level === 'number' &&
        typeof ev.cat === 'string' &&
        CATS.has(ev.cat)
        ? (msg as unknown as ContentToWorker)
        : null;
    }
    case 'cs:friction':
      return typeof msg.signal === 'string' &&
        FRICTION.has(msg.signal) &&
        Array.isArray(msg.ops) &&
        msg.ops.every(isOp)
        ? (msg as unknown as ContentToWorker)
        : null;
    case 'cs:offer-answer':
      return isOp(msg.op) &&
        typeof msg.answer === 'string' &&
        OFFER_ANSWERS.has(msg.answer)
        ? (msg as unknown as ContentToWorker)
        : null;
    case 'cs:undo-all':
      return msg.source === 'toast'
        ? { type: 'cs:undo-all', source: 'toast' }
        : null;
    default:
      return null;
  }
}

const UI_WITH_TAB = new Set([
  'ui:view',
  'ui:undo',
  'ui:set-level',
  'ui:toggle-op',
  'ui:pause-site',
  'ui:offer-answer',
  'ui:rate',
  'ui:show-on-page',
  'ui:reading-guide',
  'ui:offer-seen',
  'ui:quick',
  'ui:use-everywhere',
  'ui:undo-reason',
  'ui:redo',
  'ui:grant-site',
]);

const REASONS: ReadonlySet<string> = new Set(UNDO_REASONS);

export function parseUi(msg: unknown, e2e: boolean): UiMessage | null {
  if (!isRecord(msg) || typeof msg.type !== 'string') return null;
  const t = msg.type;
  if (t.startsWith('e2e:'))
    return e2e && (t === 'e2e:seed' || t === 'e2e:state')
      ? (msg as UiMessage)
      : null;
  if (UI_WITH_TAB.has(t) && !isTabId(msg.tabId)) return null;
  switch (t) {
    case 'ui:view':
    case 'ui:offer-seen':
    case 'ui:use-everywhere':
      return msg as UiMessage;
    case 'ui:quick':
      return (msg.key === 'text' ||
        msg.key === 'targets' ||
        msg.key === 'calm') &&
        typeof msg.on === 'boolean'
        ? (msg as UiMessage)
        : null;
    case 'ui:undo':
    case 'ui:redo':
      return msg.op === 'all' || isOp(msg.op) ? (msg as UiMessage) : null;
    case 'ui:grant-site':
      return isOrigin(msg.origin) ? (msg as UiMessage) : null;
    case 'ui:undo-reason':
      return isOp(msg.op) &&
        typeof msg.reason === 'string' &&
        REASONS.has(msg.reason)
        ? (msg as UiMessage)
        : null;
    case 'ui:set-level':
      return isOp(msg.op) &&
        typeof msg.level === 'number' &&
        Number.isFinite(msg.level) &&
        (msg.scope === 'site' || msg.scope === 'everywhere')
        ? (msg as UiMessage)
        : null;
    case 'ui:toggle-op':
      return isOp(msg.op) &&
        typeof msg.on === 'boolean' &&
        (msg.scope === 'site' || msg.scope === 'everywhere')
        ? (msg as UiMessage)
        : null;
    case 'ui:pause-site':
      return typeof msg.paused === 'boolean' ? (msg as UiMessage) : null;
    case 'ui:enabled':
      return typeof msg.enabled === 'boolean' ? (msg as UiMessage) : null;
    case 'ui:offer-answer':
      return isOp(msg.op) &&
        (msg.answer === 'accept' ||
          msg.answer === 'dismiss' ||
          msg.answer === 'never_here')
        ? (msg as UiMessage)
        : null;
    case 'ui:rate':
      return isOp(msg.op) &&
        (msg.rating === 'helped' || msg.rating === 'not_helped')
        ? (msg as UiMessage)
        : null;
    case 'ui:show-on-page':
      return (msg.op === null || isOp(msg.op)) && typeof msg.on === 'boolean'
        ? (msg as UiMessage)
        : null;
    case 'ui:reading-guide':
      return typeof msg.on === 'boolean' ? (msg as UiMessage) : null;
    case 'ui:set-prefs':
      return (msg.theme === undefined ||
        msg.theme === 'system' ||
        msg.theme === 'light' ||
        msg.theme === 'dark') &&
        (msg.reduceMotion === undefined ||
          typeof msg.reduceMotion === 'boolean') &&
        (msg.hideAllSitesAsk === undefined ||
          typeof msg.hideAllSitesAsk === 'boolean')
        ? (msg as UiMessage)
        : null;
    case 'ui:system':
      return isRecord(msg.signals) ? (msg as UiMessage) : null;
    case 'ui:grant-all-sites':
    case 'ui:clear-everywhere':
    case 'ui:receipts':
    case 'ui:sign-out':
    case 'ui:prefs':
    case 'ui:welcome':
      return msg as UiMessage;
    default:
      return null;
  }
}
