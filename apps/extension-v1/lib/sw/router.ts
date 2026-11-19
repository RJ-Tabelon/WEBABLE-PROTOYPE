import { OP_IDS, type OpId } from '@webable/core/ops/catalog';
import { PAGE_CATEGORIES } from '@webable/core/page/types';
import {
  SKEL_ID_PATTERN,
  SKEL_KINDS,
  SKEL_MAX_NODES,
} from '@webable/core/skeleton/constants';
import type { Skeleton } from '@webable/core/skeleton/types';

import type { ContentToWorker, FitViewEvent } from '../protocol';
import { FIT_TEXT_STEPS_MAX } from '../storage/settings';
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

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number =>
  finite(v) && Number.isInteger(v) && v >= 0;

const FIT_REASONS: ReadonlySet<string> = new Set([
  'offer',
  'popup',
  'shortcut',
  'auto',
  'tab_mode',
  'route',
  'switch',
]);
const CLOSE_REASONS: ReadonlySet<string> = new Set([
  'original',
  'not_representable',
  'route',
  'error',
  'paused',
]);
const PROXY_ROLES: ReadonlySet<string> = new Set([
  'link',
  'button',
  'input',
  'toggle',
  'select',
]);
const PROXY_WHYS: ReadonlySet<string> = new Set([
  'not_found',
  'fingerprint',
  'no_effect',
  'blocked',
]);
const SKEL_KIND_SET: ReadonlySet<string> = new Set(SKEL_KINDS);
/** Room for exemplar subtrees beyond the extraction's node cap. */
const MAX_SKELETON_NODES = 2 * SKEL_MAX_NODES;

const isSkelId = (v: unknown): v is string =>
  typeof v === 'string' && SKEL_ID_PATTERN.test(v);
const shortText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max;
const optional = (v: unknown, ok: (x: unknown) => boolean): boolean =>
  v === undefined || ok(v);

function isSkeletonNode(n: unknown): boolean {
  return (
    isRecord(n) &&
    isSkelId(n.id) &&
    (n.parent === null || isSkelId(n.parent)) &&
    finite(n.depth) &&
    shortText(n.tag, 32) &&
    (n.role === null || optional(n.role, (r) => shortText(r, 32))) &&
    typeof n.kind === 'string' &&
    SKEL_KIND_SET.has(n.kind) &&
    Array.isArray(n.box) &&
    n.box.length === 4 &&
    n.box.every(finite) &&
    Array.isArray(n.flags) &&
    n.flags.length <= 32 &&
    n.flags.every((f) => shortText(f, 32)) &&
    optional(n.label, (l) => shortText(l, 200)) &&
    optional(n.fontPx, finite) &&
    optional(n.weight, finite) &&
    optional(n.level, finite) &&
    optional(n.options, finite) &&
    optional(n.inputType, (t) => shortText(t, 32)) &&
    optional(n.href, (h) => shortText(h, 16)) &&
    optional(n.ck, (k) => shortText(k, 64)) &&
    optional(n.text, (t) => isRecord(t) && finite(t.chars)) &&
    optional(
      n.collection,
      (c) => isRecord(c) && finite(c.count) && isSkelId(c.exemplar),
    )
  );
}

/** A page skeleton in the shape the worker's spec, solver and wire code read. */
export function isSkeleton(v: unknown): v is Skeleton {
  return (
    isRecord(v) &&
    v.v === 1 &&
    shortText(v.version, 40) &&
    typeof v.extractionId === 'string' &&
    v.extractionId.length > 0 &&
    v.extractionId.length <= 64 &&
    isRecord(v.viewport) &&
    finite(v.viewport.width) &&
    finite(v.viewport.height) &&
    finite(v.viewport.zoom) &&
    isRecord(v.doc) &&
    finite(v.doc.width) &&
    finite(v.doc.height) &&
    shortText(v.lang, 16) &&
    typeof v.truncated === 'boolean' &&
    shortText(v.structure, 256) &&
    Array.isArray(v.typed) &&
    v.typed.length <= 64 &&
    v.typed.every((t) => shortText(t, 200)) &&
    Array.isArray(v.nodes) &&
    v.nodes.length > 0 &&
    v.nodes.length <= MAX_SKELETON_NODES &&
    v.nodes.every(isSkeletonNode)
  );
}

/** A Fit view event, rebuilt field by field (nothing else passes). */
export function parseFitViewEvent(ev: unknown): FitViewEvent | null {
  if (!isRecord(ev) || typeof ev.kind !== 'string') return null;
  switch (ev.kind) {
    case 'opened':
      return (ev.source === 'heuristic' || ev.source === 'planner') &&
        typeof ev.reason === 'string' &&
        FIT_REASONS.has(ev.reason) &&
        finite(ev.ms) &&
        ev.ms >= 0
        ? {
            kind: 'opened',
            source: ev.source,
            reason: ev.reason as Extract<
              FitViewEvent,
              { kind: 'opened' }
            >['reason'],
            ms: ev.ms,
          }
        : null;
    case 'closed':
      return typeof ev.reason === 'string' &&
        CLOSE_REASONS.has(ev.reason) &&
        finite(ev.afterMs) &&
        ev.afterMs >= 0 &&
        count(ev.actions)
        ? {
            kind: 'closed',
            reason: ev.reason as Extract<
              FitViewEvent,
              { kind: 'closed' }
            >['reason'],
            afterMs: ev.afterMs,
            actions: ev.actions,
          }
        : null;
    case 'peek':
      return typeof ev.on === 'boolean' ? { kind: 'peek', on: ev.on } : null;
    case 'proxy_failed':
      return typeof ev.role === 'string' &&
        PROXY_ROLES.has(ev.role) &&
        typeof ev.why === 'string' &&
        PROXY_WHYS.has(ev.why)
        ? ({
            kind: 'proxy_failed',
            role: ev.role,
            why: ev.why,
          } as FitViewEvent)
        : null;
    case 'conservation_failed':
      return count(ev.missing)
        ? { kind: 'conservation_failed', missing: ev.missing }
        : null;
    case 'offer':
      return (ev.surface === 'toast' || ev.surface === 'chip') &&
        (ev.answer === 'accept' ||
          ev.answer === 'dismiss' ||
          ev.answer === 'timeout')
        ? { kind: 'offer', surface: ev.surface, answer: ev.answer }
        : null;
    case 'text_nudge':
      return ev.step === 1 || ev.step === -1
        ? { kind: 'text_nudge', step: ev.step }
        : null;
    case 'always':
      return typeof ev.on === 'boolean' ? { kind: 'always', on: ev.on } : null;
    default:
      return null;
  }
}

/** The zoom guard's report on cs:applied (docs/10 §5.1), or undefined. */
function parseViewport(
  v: unknown,
): Extract<ContentToWorker, { type: 'cs:applied' }>['viewport'] {
  if (
    !isRecord(v) ||
    !finite(v.zoom) ||
    v.zoom <= 0 ||
    !finite(v.overflowPx) ||
    !count(v.navLinks) ||
    typeof v.searchVisible !== 'boolean'
  )
    return undefined;
  return {
    zoom: v.zoom,
    overflowPx: Math.max(0, v.overflowPx),
    navLinks: v.navLinks,
    searchVisible: v.searchVisible,
    ...(count(v.newlyEllipsised) && count(v.titlesShown)
      ? { newlyEllipsised: v.newlyEllipsised, titlesShown: v.titlesShown }
      : {}),
  };
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
    case 'cs:applied': {
      if (
        typeof msg.planId !== 'string' ||
        !Array.isArray(msg.changes) ||
        !msg.changes.every(
          (c) => isRecord(c) && isOp(c.op) && isRecord(c.trace),
        )
      )
        return null;
      const viewport = parseViewport(msg.viewport);
      const { viewport: _raw, ...rest } = msg;
      return {
        ...(rest as unknown as Omit<
          Extract<ContentToWorker, { type: 'cs:applied' }>,
          'viewport'
        >),
        ...(viewport ? { viewport } : {}),
      };
    }
    case 'cs:interaction':
      return typeof msg.tabSession === 'string' && msg.tabSession.length <= 64
        ? { type: 'cs:interaction', tabSession: msg.tabSession }
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
    case 'cs:fitview-request':
      return typeof msg.reason === 'string' &&
        FIT_REASONS.has(msg.reason) &&
        isSkeleton(msg.skeleton)
        ? {
            type: 'cs:fitview-request',
            skeleton: msg.skeleton,
            reason: msg.reason as Extract<
              ContentToWorker,
              { type: 'cs:fitview-request' }
            >['reason'],
          }
        : null;
    case 'cs:fitview-event': {
      const event = parseFitViewEvent(msg.event);
      return event ? { type: 'cs:fitview-event', event } : null;
    }
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
  'ui:fit-view',
  'ui:fit-view-switch',
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
    case 'ui:fit-view-switch':
      return msg as UiMessage;
    case 'ui:fit-view':
      return typeof msg.on === 'boolean' &&
        (msg.scope === 'page' || msg.scope === 'site')
        ? (msg as UiMessage)
        : null;
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
          typeof msg.hideAllSitesAsk === 'boolean') &&
        (msg.devPlanner === undefined || typeof msg.devPlanner === 'boolean') &&
        (msg.autoSimplify === undefined ||
          typeof msg.autoSimplify === 'boolean') &&
        (msg.fitTextStep === undefined ||
          (Number.isInteger(msg.fitTextStep) &&
            Math.abs(msg.fitTextStep as number) <= FIT_TEXT_STEPS_MAX))
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
