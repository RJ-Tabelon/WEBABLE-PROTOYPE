// Is the generative model usable right now? It is the only optional part of WebAble: Jev and the local layouts
// work without it. No key: 'off'. OpenAI says the account has no credits (insufficient_quota,
// credit_balance_exhausted, a billing limit) or rejects the key (401): 'no_credits' for AI_BLOCK_MS (10 min),
// after which the next request (or the background probe in openai.ts) tries again. Our own daily spend cap
// (OPENAI_BUDGET_USD per local day): 'no_credits' until midnight.
// A plain rate limit (429 rate_limit_exceeded) is transient and changes nothing.
import { AI_BLOCK_MS, OPENAI_BUDGET_USD, openAiKey } from './config';
import { openAiSpentTodayUsd } from './stats';

export type AiStatus = 'on' | 'off' | 'no_credits';
export type AiBlockReason = 'no_credits' | 'key_rejected';
export type AiReason = 'no_key' | AiBlockReason | 'budget';

export interface AiState {
  status: AiStatus;
  /** Why AI is not 'on' (null when it is). */
  reason: AiReason | null;
  /** When the current block started (ISO), when AI will be tried again (ISO). */
  since: string | null;
  retryAt: string | null;
  /** The last time OpenAI answered at all (success or a classified failure). */
  lastCheck: string | null;
}

let blockedUntil = 0;
let blockReason: AiBlockReason | null = null;
let blockedSince: number | null = null;
let lastCheckAt: number | null = null;

export interface ProviderFailure {
  status?: number | null;
  code?: string | null;
  type?: string | null;
  message?: string | null;
}

const QUOTA_CODES = new Set(['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached', 'billing_not_active', 'quota_exceeded']);

/** Which failures mean "the account cannot be used for a while" (null: transient or a request problem). */
export function classifyOpenAiFailure(e: ProviderFailure): AiBlockReason | null {
  const status = e.status ?? null;
  const code = (e.code ?? '').toLowerCase();
  const type = (e.type ?? '').toLowerCase();
  const msg = (e.message ?? '').toLowerCase();
  if (status === 401) return 'key_rejected';
  if (QUOTA_CODES.has(code) || QUOTA_CODES.has(type)) return 'no_credits';
  if (status === 402) return 'no_credits';
  if (status === 429 && /\b(quota|credits?|billing)\b/.test(msg)) return 'no_credits';
  return null;
}

/** 'on' | 'off' | 'no_credits', as /health reports it. */
export function aiStatus(now = Date.now()): AiStatus {
  return aiState(now).status;
}

export function aiState(now = Date.now()): AiState {
  const lastCheck = lastCheckAt ? new Date(lastCheckAt).toISOString() : null;
  if (!openAiKey()) return { status: 'off', reason: 'no_key', since: null, retryAt: null, lastCheck };
  if (openAiSpentTodayUsd(now) >= OPENAI_BUDGET_USD) {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return { status: 'no_credits', reason: 'budget', since: null, retryAt: midnight.toISOString(), lastCheck };
  }
  if (blockReason && now < blockedUntil) {
    return {
      status: 'no_credits',
      reason: blockReason,
      since: blockedSince ? new Date(blockedSince).toISOString() : null,
      retryAt: new Date(blockedUntil).toISOString(),
      lastCheck,
    };
  }
  return { status: 'on', reason: null, since: null, retryAt: null, lastCheck };
}

/**
 * Mark the account unusable for AI_BLOCK_MS. Returns true when AI was working before (for one log line); a retry
 * that finds the account still without credits extends the block quietly. Only a success clears it.
 */
export function markAiBlocked(reason: AiBlockReason, now = Date.now()): boolean {
  const was = blockReason !== null;
  if (!was) blockedSince = now;
  blockReason = reason;
  blockedUntil = now + AI_BLOCK_MS;
  lastCheckAt = now;
  return !was;
}

/** A call succeeded: clear any block. Returns true when AI came back. */
export function markAiWorking(now = Date.now()): boolean {
  const was = blockReason !== null && now < blockedUntil;
  blockReason = null;
  blockedUntil = 0;
  blockedSince = null;
  lastCheckAt = now;
  return was;
}

/** Epoch ms when the current block ends (0 when there is none). */
export function aiBlockedUntil(): number {
  return blockReason ? blockedUntil : 0;
}

/** For tests. */
export function resetAiState(): void {
  blockedUntil = 0;
  blockReason = null;
  blockedSince = null;
  lastCheckAt = null;
}

/** The sentence the UI can show next to "AI layouts off". */
export function aiSentence(s: AiState = aiState()): string {
  if (s.status === 'on') return 'AI layouts on.';
  if (s.reason === 'no_key') return 'AI layouts off: no OpenAI key on this server. Jev and the local layouts still work.';
  if (s.reason === 'budget') return "AI layouts off: today's spending cap on this server is reached. Jev and the local layouts still work; AI comes back tomorrow.";
  if (s.reason === 'key_rejected') return 'AI layouts off: OpenAI did not accept the key. Trying again in a few minutes.';
  return 'AI layouts off: no credits. Jev and the local layouts still work; trying again in a few minutes.';
}
