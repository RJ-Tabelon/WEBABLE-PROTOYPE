/**
 * Every chrome.storage key WebAble uses. All of it lives on this device;
 * `local` is restricted to trusted contexts (never content scripts).
 */
export const KEYS = {
  /** Random install id + install secret (HMAC key). Generated once. */
  install: 'wa.install',
  /** Supabase session (tokens). Written only by the auth client. */
  auth: 'wa.auth',
  /** Account settings and consents mirrored from `accounts` (no tokens). */
  account: 'wa.account',
  /** Current fit profile (account or tier-0 default). */
  profile: 'wa.profile',
  /** Personal learning state, pending sync deltas, server revision. */
  learning: 'wa.learning',
  /** Extension settings: on/off, theme, motion, everywhere-levels. */
  settings: 'wa.settings',
  /** eTLD+1 -> site rule + domain learning state + last visit (LRU 500). */
  sites: 'wa.sites',
  /** Local adaptation events (ring: 30 days / 500). */
  events: 'wa.events',
  /** Page-analysis answer cache index: HMAC key -> last used (LRU). */
  answersIndex: 'wa.answers',
  /** Prefix for one cached answer per HMAC key. */
  answerPrefix: 'wa.answer:',
  /** "What was sent" receipts (last 50 / 7 days). */
  receipts: 'wa.receipts',
  /** Weekly per-op counts not yet flushed to `weekly_activity`. */
  activity: 'wa.activity',
  /** Offers shown today (budget). */
  offers: 'wa.offers',
  /** Page-analysis circuit breaker. */
  breaker: 'wa.breaker',
  /** Layout-planner circuit breaker (an OpenAI outage never silences page analysis). */
  composeBreaker: 'wa.breaker.compose',
  /** Planner spec cache index: HMAC key -> last used, bytes, site (LRU, byte budget). */
  composeIndex: 'wa.composeIndex',
  /** Prefix for one cached planner entry (up to 3 spec variants) per HMAC key. */
  composePrefix: 'wa.compose:',
  /** Fit view keep/undo per page type and recent Fit view defects (local only, never synced). */
  fitLearning: 'wa.fitLearning',
  /** Signals the browser gives before any calibration (OS settings). */
  system: 'wa.system',
  /** Per-tab state (storage.session: survives worker restarts, not browser restarts). */
  tabs: 'wa.tabs',
  /** Prefix for one tab's Fit view state (storage.session; kept apart from the wa.tabs snapshot). */
  fitViewPrefix: 'wa.fitview:',
  /** Planner calls in flight, by cache key (storage.session: dedupe survives worker restarts). */
  composeInflight: 'wa.composeInflight',
  /** One-time popup notices the person dismissed: id -> ms since epoch. Written by the popup. */
  notices: 'wa.notices',
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];
