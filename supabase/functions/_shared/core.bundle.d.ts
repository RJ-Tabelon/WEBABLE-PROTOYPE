// Types for core.bundle.js, the bundle of core-entry.ts (see scripts/build-functions.mjs).
//
// Hand-maintained: the declarations mirror @webable/core so Deno can type-check
// the functions without the workspace. `pnpm build:functions` verifies with tsc
// that every export and type here matches core-entry.ts exactly (mutually
// assignable, never `any`), so drift fails the build instead of shipping.
//
// Zod schemas are declared as `SafeParser<T>`: the functions only ever call
// `safeParse`, and this keeps zod's own types out of the Deno graph.

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export declare const CATALOG_VERSION: 'wa-cat-1.0.0';
export declare const JEV_PINNED_MODEL: 'jev-1.13.0';
export declare const OP_LIBRARY_VERSION: 'ops-1.0.0';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface SafeParseIssue {
  readonly code: string;
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: ReadonlyArray<SafeParseIssue> } };

export interface SafeParser<T> {
  safeParse(input: unknown): SafeParseResult<T>;
}

// ---------------------------------------------------------------------------
// Page vocabulary (page/types.ts)
// ---------------------------------------------------------------------------

export type PageCategory =
  | 'article'
  | 'feed_social'
  | 'search_results'
  | 'form_checkout'
  | 'web_app'
  | 'docs_reference'
  | 'media_video'
  | 'other';

export type RegionRole =
  | 'main_content'
  | 'navigation'
  | 'promo_ad'
  | 'recommendations'
  | 'chat_widget'
  | 'consent_banner'
  | 'help_contact'
  | 'form'
  | 'footer'
  | 'other';

export declare const PAGE_CATEGORIES: readonly [
  'article',
  'feed_social',
  'search_results',
  'form_checkout',
  'web_app',
  'docs_reference',
  'media_video',
  'other',
];

export declare const REGION_ROLES: readonly [
  'main_content',
  'navigation',
  'promo_ad',
  'recommendations',
  'chat_widget',
  'consent_banner',
  'help_contact',
  'form',
  'footer',
  'other',
];

type Zone =
  | 'header_band'
  | 'left_rail'
  | 'right_rail'
  | 'center_column'
  | 'full_width_mid'
  | 'footer_band'
  | 'overlay_top'
  | 'overlay_bottom'
  | 'overlay_center'
  | 'overlay_corner';
type WidthBucket = '<15%' | '15-30%' | '30-60%' | '60-90%' | '>90%';
type CountBucket = '0' | '1' | '2-3' | '4-10' | '11-30' | '31-100' | '>100';
type PageSignal =
  | 'jsonld_article'
  | 'jsonld_product'
  | 'jsonld_video'
  | 'og_type_article'
  | 'og_type_video'
  | 'readerable'
  | 'role_feed'
  | 'infinite_scroll'
  | 'has_site_search'
  | 'search_results_pattern'
  | 'has_password_field'
  | 'has_payment_fields'
  | 'multi_step_form'
  | 'has_comments_section'
  | 'large_video_in_main'
  | 'map_container'
  | 'rich_text_editor'
  | 'data_grid'
  | 'code_blocks'
  | 'many_tables';

/** Structural evidence about one region. Only enums, buckets and vocabulary words. */
export interface RegionEvidence {
  zone: Zone;
  width: WidthBucket;
  height:
    | '<0.1 screens'
    | '0.1-0.3 screens'
    | '0.3-1 screens'
    | '1-3 screens'
    | '>3 screens';
  pinned: 'fixed' | 'sticky' | 'no';
  landmark:
    | 'banner'
    | 'navigation'
    | 'main'
    | 'complementary'
    | 'contentinfo'
    | 'search'
    | 'form'
    | 'region'
    | 'dialog'
    | 'none';
  tag:
    | 'div'
    | 'section'
    | 'aside'
    | 'nav'
    | 'header'
    | 'footer'
    | 'form'
    | 'iframe'
    | 'ul'
    | 'article'
    | 'dialog'
    | 'other';
  dom_position: 'before_main' | 'inside_main' | 'after_main' | 'unknown';
  links: CountBucket;
  link_density: 'none' | 'low' | 'mid' | 'high';
  text_amount:
    '0' | '<100 chars' | '100-500 chars' | '500-2k chars' | '>2k chars';
  buttons: CountBucket;
  inputs: CountBucket;
  required_fields: boolean;
  repeated_cards: '0' | '2-3' | '4-8' | '>8';
  images: CountBucket;
  video: boolean;
  iframe_kind:
    | 'none'
    | 'ad_network'
    | 'chat_vendor'
    | 'video_host'
    | 'social_embed'
    | 'map'
    | 'other';
  motion: 'none' | 'transition' | 'loop' | 'autoplay_video' | 'carousel';
  class_words: string[];
  heading_words: string;
  control_words: string[];
}

/** Page-level context, sent to Jev as `state`. */
export interface PageContext {
  signals: PageSignal[];
  main: {
    found_by: 'landmark' | 'single_article' | 'readability' | 'ambiguous';
    zone: Zone | 'unknown';
    width: WidthBucket | 'unknown';
  };
  counts: {
    regions: CountBucket;
    links: CountBucket;
    buttons: CountBucket;
    text_inputs: CountBucket;
    forms: CountBucket;
    required_fields: CountBucket;
    headings: CountBucket;
    images: CountBucket;
    videos: CountBucket;
    text_amount: '<1k chars' | '1k-10k chars' | '10k-50k chars' | '>50k chars';
  };
  layout: {
    viewport: 'phone' | 'tablet' | 'desktop';
    page_height: '<1 screen' | '1-3 screens' | '3-10 screens' | '>10 screens';
    pinned_bars: '0' | '1' | '2' | '3+';
  };
}

/** VOCAB_V1: the only words that may leave the device. */
export declare const VOCAB_V1: ReadonlySet<string>;
/** Marker for a run of dropped (non-vocabulary) words. */
export declare const DROPPED_MARK: '·';
export declare function isVocabWord(word: string): boolean;
/** True when every space-separated token is a vocabulary word or the dropped mark. */
export declare function isVocabPhrase(phrase: string): boolean;
/** Every string in a region's evidence that is not vocabulary (empty when clean). */
export declare function unknownEvidenceWords(
  ev: Pick<RegionEvidence, 'class_words' | 'heading_words' | 'control_words'>,
): string[];
/** Vocabulary words per phrase; dropped-word marks do not count. */
export declare const MAX_HEADING_WORDS: 6;
export declare const MAX_CONTROL_WORDS: 4;
/** Vocabulary violations in one evidence object: unknown words plus over-long phrases. */
export declare function vocabularyViolations(
  ev: Pick<RegionEvidence, 'class_words' | 'heading_words' | 'control_words'>,
): number;

// ---------------------------------------------------------------------------
// Jev (TypeSafe System One) API, jev/api.ts and jev/client.ts
// ---------------------------------------------------------------------------

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JevEntry =
  string | { [key: string]: JsonValue } | JsonValue[] | null;
type JevLevel = string | { [key: string]: JsonValue } | JsonValue[];
export type JevState = string | { [key: string]: JsonValue } | JsonValue[];

interface JevNoulQuestion {
  type: 'noul';
  instructions?: JevEntry;
  criteria?: { true?: JevEntry; false?: JevEntry } | null;
}
interface JevChoiceQuestion<O extends string = string> {
  type: 'choice';
  instructions?: JevEntry;
  criteria: Record<O, JevEntry>;
}
interface JevScoreQuestion {
  type: 'score';
  instructions?: JevEntry;
  criteria: [JevLevel, JevLevel, ...JevLevel[]];
}
export type JevQuestion =
  JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export type JevModelId = 'jev-1.13.0' | 'jev-latest' | 'jev-preview';

export interface JevRequest<
  Q extends Record<string, JevQuestion> = Record<string, JevQuestion>,
> {
  state: JevState;
  model: JevModelId;
  questions: Q;
}

interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}
interface JevChoiceAnswer<O extends string = string> {
  type: 'choice';
  choice: O;
  confidence: number;
  probabilities: Record<O, number>;
}
interface JevScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  legend: Record<string, JevLevel>;
  probabilities: Record<string, number>;
}
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export type JevFailure =
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'rate_limited'; retryAfterMs?: number }
  | { kind: 'overloaded' }
  | { kind: 'auth'; status: 401 | 403 }
  | { kind: 'invalid'; status: 400 | 422; body: unknown }
  | { kind: 'server'; status: number }
  | { kind: 'aborted' }
  | { kind: 'shape'; issue: string }
  | { kind: 'model_drift'; got: string };

export type JevResult =
  | { ok: true; data: JevResponse; requestId: string | null; ms: number }
  | { ok: false; error: JevFailure; requestId: string | null; ms: number };

export interface CallJevOptions {
  apiKey: string;
  /** Hard timeout covering connect, server time and body read. */
  timeoutMs: number;
  /** Any other resolved model is reported as `model_drift`. */
  pinnedModel: string;
  /** Caller cancellation; reported as `network`. */
  signal?: AbortSignal;
  /** Default: JEV_ENDPOINT. */
  endpoint?: string;
  fetch?: typeof fetch;
}

export declare const JEV_ENDPOINT: 'https://api.typesafe.ai/v1/systemone';
export declare const JEV_REQUEST_ID_HEADER: 'x-typesafe-request-id';

/** Raw-fetch Jev client. No retries; shape and pinned-model checked. Never throws. */
export declare function callJev(
  req: {
    state: JevState;
    model: JevModelId;
    questions: Record<string, JevQuestion>;
  },
  opts: CallJevOptions,
): Promise<JevResult>;

// ---------------------------------------------------------------------------
// Page analysis wire contract (decide/wire.ts) and catalog (decide/catalog.ts)
// ---------------------------------------------------------------------------

/** Extension service worker -> `decide`. Evidence only. */
export interface DecideRequest {
  v: 1;
  catalog: 'wa-cat-1.0.0';
  lang: 'en';
  page: PageContext;
  regions: { rid: string; ev: RegionEvidence }[];
  mainCandidates?: { cid: 'c1' | 'c2' | 'c3' | 'c4'; ev: RegionEvidence }[];
  ask: { pageType: boolean };
}

export type DegradedReason =
  | 'timeout'
  | 'rate_limited'
  | 'overloaded'
  | 'upstream'
  | 'model_drift'
  | 'catalog_mismatch'
  | 'quota'
  | 'bad_input'
  | 'unconfigured';

export interface RegionAnswer {
  role: Record<RegionRole, number>;
  /** P(visitor doing the page's main task needs this region). */
  task: number;
}

/** `decide` -> extension: probabilities only. */
export interface DecideOk {
  v: 1;
  ok: true;
  catalog: 'wa-cat-1.0.0';
  model: string;
  pageType?: Record<PageCategory, number>;
  mainPick?: Partial<Record<'c1' | 'c2' | 'c3' | 'c4' | 'none', number>>;
  regions: Record<string, RegionAnswer>;
  inputTokens: number;
  ms: { jev: number; edge: number };
}

export interface DecideDegraded {
  v: 1;
  ok: false;
  degraded: DegradedReason;
  retryAfterMs?: number;
}

export type DecideResponse = DecideOk | DecideDegraded;

export declare const decideRequestSchema: SafeParser<DecideRequest>;
export declare const decideResponseSchema: SafeParser<DecideResponse>;

/** Regions per call; the request schema already caps the array. */
export declare const MAX_REGIONS_PER_CALL: 10;
/** Whole-request token cap; buildQuestions trims lowest-priority regions above it. */
export declare const MAX_REQUEST_TOKENS: 12000;

export interface BuiltQuestions {
  state: JevState;
  questions: Record<string, JevQuestion>;
  estimatedTokens: number;
  /** Region ids dropped to stay under MAX_REQUEST_TOKENS. */
  trimmed: string[];
}

/** The server-only question catalog: evidence in, Jev questions out. */
export declare function buildQuestions(req: DecideRequest): BuiltQuestions;

/**
 * Map a shape-checked Jev response to the wire answer (probabilities only),
 * re-parsed with the wire schema so no extra field can leak. Null when invalid.
 */
export declare function compact(
  built: Pick<BuiltQuestions, 'questions'>,
  jev: JevResponse,
  ms: { jev: number; edge: number },
): DecideOk | null;

// ---------------------------------------------------------------------------
// Deterministic Jev stand-in (decide/mock.ts): tests and the local mock server
// ---------------------------------------------------------------------------

export interface MockJevOptions {
  /** Resolved model reported in the response. Default: the pinned model. */
  model?: string;
}

export interface MockJevFetchOptions extends MockJevOptions {
  /** Force an HTTP status instead of answering (e.g. 429, 529, 500). */
  status?: number;
  headers?: Record<string, string>;
  /** Replace the JSON body entirely. */
  body?: unknown;
  /** Send this raw text as the body (e.g. malformed JSON). */
  rawBody?: string;
  /** Simulated server time; honours the request's AbortSignal. */
  delayMs?: number;
  /** Reject like a failed connection. */
  networkError?: boolean;
  requestId?: string;
  /** Called with every parsed request body. */
  onRequest?: (body: unknown, init: RequestInit | undefined) => void;
}

export declare function mockJevAnswer(
  request: JevRequest,
  opts?: MockJevOptions,
): JevResponse;

/** A fetch that behaves like POST https://api.typesafe.ai/v1/systemone. */
export declare function createMockJevFetch(
  opts?: MockJevFetchOptions,
): typeof fetch;

// ---------------------------------------------------------------------------
// Opt-in product learning report (personalization.md 13.3)
// ---------------------------------------------------------------------------

export type OpId =
  | 'text_floor'
  | 'page_zoom'
  | 'line_spacing'
  | 'line_length'
  | 'contrast'
  | 'focus_outline'
  | 'target_size'
  | 'target_spacing'
  | 'steady_clicks'
  | 'menu_grace'
  | 'calm_motion'
  | 'pause_media'
  | 'dim_distractions'
  | 'focus_view'
  | 'unpin_bars'
  | 'reading_guide';

export declare const OP_IDS: readonly [
  'text_floor',
  'page_zoom',
  'line_spacing',
  'line_length',
  'contrast',
  'focus_outline',
  'target_size',
  'target_spacing',
  'steady_clicks',
  'menu_grace',
  'calm_motion',
  'pause_media',
  'dim_distractions',
  'focus_view',
  'unpin_bars',
  'reading_guide',
];

export type VerifyCode =
  | 'clip'
  | 'overlap'
  | 'overflow'
  | 'contrast_drop'
  | 'focus_hidden'
  | 'control_collapsed'
  | 'layout_shift'
  | 'focus_lost'
  | 'timeout'
  | 'apply_error';

export declare const VERIFY_CODES: readonly [
  'clip',
  'overlap',
  'overflow',
  'contrast_drop',
  'focus_hidden',
  'control_collapsed',
  'layout_shift',
  'focus_lost',
  'timeout',
  'apply_error',
];

export interface AggReport {
  v: 1;
  /** `YYYY-Www/4`: ISO week-year and the window's first ISO week. */
  window: string;
  libVer: string;
  priorRelease: string;
  cells: {
    op: OpId;
    need: 0 | 1 | 2;
    cat: PageCategory;
    mode: 'auto' | 'offer';
    trigger: 'profile' | 'friction' | 'pinned';
    /** Randomized-response bit. */
    y: 0 | 1;
  }[];
  engine?: { op: OpId; cat: PageCategory; vcode: VerifyCode; c: 1 | 2 | 3 }[];
  ai?: { op: OpId; label: 'clear' | 'likely' | 'unsure'; y: 0 | 1 }[];
}

export declare const AGG_MAX_CELLS: 4;
export declare const AGG_MAX_AI: 2;
export declare const AGG_MAX_ENGINE: number;
export declare const aggReportSchema: SafeParser<AggReport>;
