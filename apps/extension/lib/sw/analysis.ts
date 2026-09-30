import {
  combineVerdicts,
  localVerdicts,
  mainFromAnswers,
  pageTypeFromAnswers,
  verdictsFromAnswers,
  withMainPick,
  type MainPickVerdict,
  type PageTypeVerdict,
} from '@webable/core/decide/verdict';
import {
  decideRequestSchema,
  decideResponseSchema,
  type DecideRequest,
  type DecideResponse,
  type DegradedReason,
  type RegionAnswer,
} from '@webable/core/decide/wire';
import type { PageSignals, RegionEvidence } from '@webable/core/page/types';
import { vocabularyViolations } from '@webable/core/page/vocab-check';
import type { RegionVerdict } from '@webable/core/policy/types';
import { CATALOG_VERSION, JEV_PINNED_MODEL } from '@webable/core/versions';

import type { PageEvidence } from '../protocol';
import type { CachedAnswer } from '../storage/answers';

/**
 * Page analysis in the worker: build the request (evidence only), call the
 * `decide` Edge Function, and turn answers (fresh or cached) into region
 * verdicts for the policy. Nothing here knows who the person is.
 */

export type DecideOk = Extract<DecideResponse, { ok: true }>;

/** At most 10 region questions per call (ai-architecture.md 3.2.4). */
export const MAX_REGIONS = 10;
/** Ask for the page type only when the local classifier is unsure. */
export const PAGE_TYPE_ASK_BELOW = 0.75;

export interface BuiltRequest {
  request: DecideRequest;
  /** The exact bytes that will leave the device. */
  body: string;
  ridToKey: Record<string, string>;
  cidToKey: Partial<Record<'c1' | 'c2' | 'c3' | 'c4', string>>;
}

export interface RequestPlan {
  /** Region component keys to ask about, strongest first. */
  regionKeys: readonly string[];
  /** Main-content candidates to ask about (2-4), or none. */
  mainCandidates?: readonly string[];
  askPageType: boolean;
}

const CIDS = ['c1', 'c2', 'c3', 'c4'] as const;

/**
 * DecideRequest from the content script's vocabulary-filtered evidence. The
 * result is validated with the shared strict schema and re-checked against the
 * vocabulary and the phrase word caps (the same check `decide` runs): if
 * anything outside the contract slipped in, nothing is sent.
 */
export function buildDecideRequest(
  evidence: PageEvidence,
  plan: RequestPlan,
): BuiltRequest | null {
  const ridToKey: Record<string, string> = {};
  const cidToKey: BuiltRequest['cidToKey'] = {};
  const regions: DecideRequest['regions'] = [];
  const mainSet = new Set(plan.mainCandidates ?? []);
  for (const key of plan.regionKeys) {
    if (regions.length >= MAX_REGIONS) break;
    if (mainSet.has(key)) continue;
    const ev = evidence.regions[key];
    if (!ev) continue;
    const rid = `r${regions.length}`;
    ridToKey[rid] = key;
    regions.push({ rid, ev });
  }
  let mainCandidates: DecideRequest['mainCandidates'];
  if (plan.mainCandidates && plan.mainCandidates.length >= 2) {
    const list: NonNullable<DecideRequest['mainCandidates']> = [];
    for (const key of plan.mainCandidates.slice(0, 4)) {
      const ev = evidence.regions[key];
      if (!ev) continue;
      const cid = CIDS[list.length]!;
      cidToKey[cid] = key;
      list.push({ cid, ev });
    }
    if (list.length >= 2) mainCandidates = list;
  }
  if (regions.length === 0 && !mainCandidates && !plan.askPageType) return null;
  const candidate: DecideRequest = {
    v: 1,
    catalog: CATALOG_VERSION,
    lang: 'en',
    page: evidence.page,
    regions,
    ...(mainCandidates ? { mainCandidates } : {}),
    ask: { pageType: plan.askPageType },
  };
  const parsed = decideRequestSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const evidences = [
    ...parsed.data.regions.map((r) => r.ev),
    ...(parsed.data.mainCandidates ?? []).map((c) => c.ev),
  ];
  if (evidences.some((ev) => vocabularyViolations(ev) > 0)) return null;
  return {
    request: parsed.data,
    body: JSON.stringify(parsed.data),
    ridToKey,
    cidToKey: mainCandidates ? cidToKey : {},
  };
}

export type DecideOutcome =
  | { ok: true; data: DecideOk; ms: number }
  | {
      ok: false;
      reason:
        | DegradedReason
        | 'network'
        | 'unauthorized'
        | 'consent_required'
        | 'http'
        | 'shape';
      retryAfterMs?: number;
      status?: number;
      ms: number;
    };

export interface DecideCall {
  url: string;
  publishableKey: string;
  accessToken: string;
  body: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  now?: () => number;
}

/** POST the body to `decide`. Never throws; failures come back as outcomes. */
export async function callDecide(call: DecideCall): Promise<DecideOutcome> {
  const now = call.now ?? (() => performance.now());
  const start = now();
  const doFetch = call.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(call.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${call.accessToken}`,
        apikey: call.publishableKey,
        'content-type': 'application/json',
      },
      body: call.body,
      signal: AbortSignal.timeout(call.timeoutMs),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    const timeout =
      err instanceof DOMException &&
      (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      reason: timeout ? 'timeout' : 'network',
      ms: now() - start,
    };
  }
  const ms = now() - start;
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.status === 401)
    return { ok: false, reason: 'unauthorized', status: 401, ms };
  if (res.status === 403) {
    const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
    return {
      ok: false,
      reason: code === 'consent_required' ? 'consent_required' : 'http',
      status: 403,
      ms,
    };
  }
  const parsed = decideResponseSchema.safeParse(json);
  if (!parsed.success)
    return {
      ok: false,
      reason: res.ok ? 'shape' : 'http',
      status: res.status,
      ms,
    };
  const data = parsed.data;
  if (!data.ok)
    return {
      ok: false,
      reason: data.degraded,
      ...(data.retryAfterMs !== undefined
        ? { retryAfterMs: data.retryAfterMs }
        : {}),
      status: res.status,
      ms,
    };
  if (data.model !== JEV_PINNED_MODEL)
    return { ok: false, reason: 'model_drift', status: res.status, ms };
  return { ok: true, data, ms };
}

// ---------------------------------------------------------------------------
// Answers <-> cache
// ---------------------------------------------------------------------------

export interface KeyedAnswers {
  /** Component key -> region answer. */
  regions: Map<string, RegionAnswer>;
  /** Component key (or 'none') -> P(main). */
  main?: Record<string, number>;
  /** Page category -> probability. */
  pageType?: Record<string, number>;
}

/** Re-key a fresh response by component keys (what the cache stores). */
export function keyAnswers(
  data: DecideOk,
  ridToKey: Record<string, string>,
  cidToKey: BuiltRequest['cidToKey'],
): KeyedAnswers {
  const regions = new Map<string, RegionAnswer>();
  for (const [rid, answer] of Object.entries(data.regions)) {
    const key = ridToKey[rid];
    if (key !== undefined) regions.set(key, answer);
  }
  const out: KeyedAnswers = { regions };
  if (data.mainPick) {
    const main: Record<string, number> = {};
    for (const [cid, p] of Object.entries(data.mainPick)) {
      if (p === undefined) continue;
      if (cid === 'none') main.none = p;
      const key = cidToKey[cid as 'c1'];
      if (key !== undefined) main[key] = p;
    }
    out.main = main;
  }
  if (data.pageType) out.pageType = { ...data.pageType };
  return out;
}

/** Cache records for keyed answers. `keyFor` maps a component key to its HMAC cache key. */
export function cacheEntries(
  answers: KeyedAnswers,
  keys: {
    region: Map<string, string>;
    main?: string;
    page?: string;
  },
): Array<[string, CachedAnswer]> {
  const out: Array<[string, CachedAnswer]> = [];
  for (const [ck, answer] of answers.regions) {
    const k = keys.region.get(ck);
    if (k) out.push([k, { kind: 'region', answer }]);
  }
  if (answers.main && keys.main)
    out.push([keys.main, { kind: 'main', pick: answers.main }]);
  if (answers.pageType && keys.page)
    out.push([keys.page, { kind: 'page', dist: answers.pageType }]);
  return out;
}

/**
 * A synthetic successful response from keyed answers, so fresh and cached
 * answers go through exactly the same verdict mapping.
 */
export function syntheticResponse(answers: KeyedAnswers): {
  data: DecideOk;
  ridToKey: Record<string, string>;
  cidToKey: BuiltRequest['cidToKey'];
} {
  const ridToKey: Record<string, string> = {};
  const regions: DecideOk['regions'] = {};
  let i = 0;
  for (const [key, answer] of answers.regions) {
    const rid = `r${i++}`;
    ridToKey[rid] = key;
    regions[rid] = answer;
  }
  const cidToKey: BuiltRequest['cidToKey'] = {};
  let mainPick: DecideOk['mainPick'];
  if (answers.main) {
    const pick: Record<string, number> = {};
    let c = 0;
    for (const [key, p] of Object.entries(answers.main)) {
      if (key === 'none') {
        pick.none = p;
        continue;
      }
      const cid = CIDS[c++];
      if (!cid) break;
      cidToKey[cid] = key;
      pick[cid] = p;
    }
    mainPick = pick as DecideOk['mainPick'];
  }
  const data: DecideOk = {
    v: 1,
    ok: true,
    catalog: CATALOG_VERSION,
    model: JEV_PINNED_MODEL,
    regions,
    inputTokens: 0,
    ms: { jev: 0, edge: 0 },
    ...(mainPick ? { mainPick } : {}),
    ...(answers.pageType
      ? { pageType: answers.pageType as DecideOk['pageType'] }
      : {}),
  };
  return { data, ridToKey, cidToKey };
}

export interface AnalysisView {
  verdicts: Record<string, RegionVerdict>;
  /** Signals with a confident main pick and a confident page type applied. */
  signals: PageSignals;
  /** Regions the answers protect (never softened). */
  protectedKeys: Set<string>;
  main: MainPickVerdict | null;
  pageType: PageTypeVerdict | null;
  /** Answers contributed at all. */
  used: boolean;
}

/**
 * Combine local rules with page-analysis answers (fresh or cached): veto
 * first, rules win where they decided, protection always wins.
 */
export function analysisView(
  signals: PageSignals,
  evidence: Record<string, RegionEvidence>,
  answers: KeyedAnswers | null,
): AnalysisView {
  const rules = localVerdicts(signals);
  if (
    !answers ||
    (answers.regions.size === 0 && !answers.main && !answers.pageType)
  ) {
    return {
      verdicts: rules,
      signals,
      protectedKeys: new Set(),
      main: null,
      pageType: null,
      used: false,
    };
  }
  const { data, ridToKey, cidToKey } = syntheticResponse(answers);
  const pageType = pageTypeFromAnswers(data);
  const category =
    pageType && pageType.use !== 'none' ? pageType.category : signals.category;
  const analysed = verdictsFromAnswers(
    data,
    ridToKey,
    signals,
    category,
    undefined,
    evidence,
  );
  const verdicts = combineVerdicts(rules, analysed);
  const main = answers.main ? mainFromAnswers(data, cidToKey) : null;
  let next = main ? withMainPick(signals, main) : signals;
  if (category !== signals.category) next = { ...next, category };
  const protectedKeys = new Set(
    Object.values(verdicts)
      .filter((v) => v.protected)
      .map((v) => v.key),
  );
  return {
    verdicts,
    signals: next,
    protectedKeys,
    main,
    pageType,
    used: true,
  };
}
