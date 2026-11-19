// OpenAI Responses API client for the layout planner (docs/10 §6).
//
// One non-streaming POST per model, under one deadline that covers the whole
// exchange. The body comes from core's plannerRequestBody: the constant
// instructions, the outline the server wrote, the strict PageSpec schema,
// `store: false` and a constant prompt_cache_key. Nothing that identifies the
// person (`user`, `metadata`, `safety_identifier`) is ever added here.
//
// When the pinned model is unavailable to this key (model_not_found, or it
// rejects one of the planner's fixed settings), the next model is tried once.
// Every other failure is final: no retries.
//
// What comes back is the output text only. Usage, cached-token counts, service
// tier and timing stay in this module; the handler never sees them, so they can
// never reach a client.

import { plannerRequestBody } from '../_shared/core.bundle.js';
import type { PlannerSettings } from './config.ts';

/** Largest response body read from OpenAI. A full plan is a few KB. */
export const MAX_RESPONSE_BYTES = 512 * 1024;
/** Largest error body read for classification. */
const MAX_ERROR_BYTES = 16 * 1024;

export type PlannerFailure =
  /** The exchange deadline passed. */
  | { kind: 'timeout' }
  /** The caller cancelled (a quota denial). */
  | { kind: 'aborted' }
  /** Connection failed or the body could not be read. */
  | { kind: 'network' }
  /** Every model tried was unavailable to this key. */
  | { kind: 'model_unavailable'; status: number }
  /** Any other HTTP error (auth, rate limit, server). `code` is OpenAI's error code, sanitized. */
  | { kind: 'http'; status: number; code: string | null }
  /** The model refused (a `refusal` content part, or a content-filter stop). */
  | { kind: 'refused' }
  /** The answer stopped early (output token cap); its JSON is cut off. */
  | { kind: 'incomplete' }
  /** The response was not a completed Responses object with output text. */
  | { kind: 'shape' };

export type PlannerResult =
  | { ok: true; text: string; model: string; fallback: boolean }
  | { ok: false; error: PlannerFailure; model: string; fallback: boolean };

export interface CallPlannerOptions {
  settings: PlannerSettings;
  /** Models in order of preference: the pinned model, then its fallback. */
  models: readonly [string, ...string[]];
  /** Caller cancellation (reported as `aborted`). */
  signal?: AbortSignal;
}

/** OpenAI error codes are short snake_case words; anything else is reported as 'other'. */
function sanitizeCode(code: unknown): string | null {
  if (typeof code !== 'string' || code === '') return null;
  return /^[a-z][a-z0-9_]{0,47}$/.test(code) ? code : 'other';
}

/** Settings a model may reject that its fallback accepts (reasoning effort, temperature, tier). */
const MODEL_SETTING_PARAM =
  /^(model|reasoning(\.effort)?|temperature|service_tier)$/;
const MODEL_CODES = new Set(['model_not_found', 'unsupported_model']);
const SETTING_CODES = new Set(['unsupported_value', 'unsupported_parameter']);

/**
 * Whether an OpenAI error means "this model cannot serve the planner here",
 * as opposed to a bad key, a rate limit or a server error.
 */
export function isModelUnavailable(
  status: number,
  error: { code?: unknown; param?: unknown } | null,
): boolean {
  const code = typeof error?.code === 'string' ? error.code : '';
  const param = typeof error?.param === 'string' ? error.param : '';
  if (MODEL_CODES.has(code))
    return status === 400 || status === 403 || status === 404;
  if (status === 400 && param === 'model') return true;
  return (
    status === 400 && SETTING_CODES.has(code) && MODEL_SETTING_PARAM.test(param)
  );
}

/**
 * Read at most `max` bytes of a body as UTF-8; null when it is larger. Throws
 * an AbortError when `signal` fires mid-read, even if the body stream itself
 * ignores the signal.
 */
async function readCapped(
  res: Response,
  max: number,
  signal: AbortSignal,
): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const aborted = () => new DOMException('The read was aborted.', 'AbortError');
  const onAbort = () => {
    reader.cancel(aborted()).catch(() => {});
  };
  if (signal.aborted) {
    onAbort();
    throw aborted();
  }
  signal.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw aborted();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string | null): unknown {
  if (text === null || text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The output text of a Responses API object, or why there is none. Every
 * `output_text` part of every assistant message is joined in order; a
 * `refusal` part anywhere wins.
 */
export function readOutput(
  body: unknown,
): { ok: true; text: string } | { ok: false; error: PlannerFailure } {
  if (!isObject(body) || !Array.isArray(body.output))
    return { ok: false, error: { kind: 'shape' } };
  let text = '';
  let parts = 0;
  for (const item of body.output) {
    if (!isObject(item) || item.type !== 'message') continue;
    if (!Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isObject(part)) continue;
      if (part.type === 'refusal')
        return { ok: false, error: { kind: 'refused' } };
      if (part.type === 'output_text' && typeof part.text === 'string') {
        text += part.text;
        parts += 1;
      }
    }
  }
  const status = body.status;
  if (status === 'incomplete') {
    const reason = isObject(body.incomplete_details)
      ? body.incomplete_details.reason
      : undefined;
    return {
      ok: false,
      error:
        reason === 'content_filter'
          ? { kind: 'refused' }
          : { kind: 'incomplete' },
    };
  }
  if (status !== 'completed' || parts === 0)
    return { ok: false, error: { kind: 'shape' } };
  return { ok: true, text };
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'AbortError' || error.name === 'TimeoutError');

/** One POST to the Responses API with one model. Never throws. */
async function requestOnce(
  outline: string,
  model: string,
  settings: PlannerSettings,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; error: PlannerFailure }> {
  const doFetch = settings.fetch ?? fetch;
  const body = plannerRequestBody(outline, { model, fast: true });
  let res: Response;
  try {
    res = await doFetch(settings.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    });
  } catch (error) {
    return {
      ok: false,
      error: { kind: signal.aborted || isAbort(error) ? 'aborted' : 'network' },
    };
  }

  let text: string | null;
  try {
    text = await readCapped(
      res,
      res.ok ? MAX_RESPONSE_BYTES : MAX_ERROR_BYTES,
      signal,
    );
  } catch (error) {
    return {
      ok: false,
      error: { kind: signal.aborted || isAbort(error) ? 'aborted' : 'network' },
    };
  }

  if (!res.ok) {
    const parsed = parseJson(text);
    const error =
      isObject(parsed) && isObject(parsed.error) ? parsed.error : null;
    if (isModelUnavailable(res.status, error))
      return {
        ok: false,
        error: { kind: 'model_unavailable', status: res.status },
      };
    return {
      ok: false,
      error: {
        kind: 'http',
        status: res.status,
        code: sanitizeCode(error?.code),
      },
    };
  }
  if (text === null) return { ok: false, error: { kind: 'shape' } };
  return readOutput(parseJson(text));
}

/**
 * Ask the planner for a PageSpec as JSON text. Tries `models` in order, moving
 * on only when a model is unavailable; one deadline covers every attempt.
 * Never throws.
 */
export async function callPlanner(
  outline: string,
  opts: CallPlannerOptions,
): Promise<PlannerResult> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), opts.settings.timeoutMs);
  const signal = opts.signal
    ? AbortSignal.any([deadline.signal, opts.signal])
    : deadline.signal;
  try {
    let fallback = false;
    let last: PlannerResult | null = null;
    for (const [i, model] of opts.models.entries()) {
      fallback = i > 0;
      const reply = await requestOnce(outline, model, opts.settings, signal);
      if (reply.ok) return { ok: true, text: reply.text, model, fallback };
      let error = reply.error;
      if (
        error.kind === 'aborted' &&
        deadline.signal.aborted &&
        !opts.signal?.aborted
      )
        error = { kind: 'timeout' };
      last = { ok: false, error, model, fallback };
      if (error.kind !== 'model_unavailable') return last;
    }
    return last as PlannerResult;
  } finally {
    clearTimeout(timer);
  }
}
