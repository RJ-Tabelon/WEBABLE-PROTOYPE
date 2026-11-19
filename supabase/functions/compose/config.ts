// Planner configuration for `compose` (docs/10 §6).
//
//   OPENAI_API_KEY    OpenAI key, read once per isolate. Absent -> every call answers
//                     200 { ok: false, degraded: 'unconfigured' } (Fit view keeps the
//                     heuristic spec).
//   COMPOSE_DISABLED  Kill switch, read on every request: '1' or 'true' -> every call
//                     answers 200 { ok: false, degraded: 'disabled' } before the body
//                     is read. Set it with `supabase secrets set COMPOSE_DISABLED=1`.

/** Structural view of the environment (matches EnvReader in _shared/supabase.ts). */
interface EnvReader {
  get(name: string): string | undefined;
}

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/**
 * Hard deadline for the whole OpenAI exchange, the fallback model included.
 * No retries: the person is looking at the heuristic layout meanwhile, and a
 * retry would only double the cost of a failure.
 */
export const PLANNER_TIMEOUT_MS = 12_000;

export interface PlannerSettings {
  apiKey: string;
  endpoint: string;
  timeoutMs: number;
  /** Injected in tests and by the local dev server (mock planner). Default: global fetch. */
  fetch?: typeof fetch;
}

export type PlannerConfig =
  | { status: 'ready'; settings: PlannerSettings }
  | { status: 'unconfigured'; reason: 'no_key' };

export function plannerConfigFromEnv(env: EnvReader): PlannerConfig {
  const apiKey = env.get('OPENAI_API_KEY')?.trim();
  if (!apiKey) return { status: 'unconfigured', reason: 'no_key' };
  return {
    status: 'ready',
    settings: {
      apiKey,
      endpoint: OPENAI_RESPONSES_URL,
      timeoutMs: PLANNER_TIMEOUT_MS,
    },
  };
}

/** True when the kill switch is on. Unknown values leave the planner on. */
export function composeDisabled(env: EnvReader): boolean {
  const raw = env.get('COMPOSE_DISABLED')?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
