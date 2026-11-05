// GET /health -> HealthStatus (+ details) and GET /v1/stats.
import type { Hono } from 'hono';
import { fitSpecJsonSchema } from '@webable/core';
import type { HealthStatus } from '@webable/core';
import { aiSentence, aiState } from '../ai';
import type { AiState } from '../ai';
import { OPENAI_BUDGET_USD } from '../config';
import { jevCacheInfo, jevHealth } from '../jev';
import { deepEnabled } from '../openai';
import { openAiSpentTodayUsd, statsSnapshot } from '../stats';
import { round } from '../util';

/** HealthStatus plus details the popup, panel and eval harness can show. `openai` is kept for older readers. */
export interface HealthResponse extends HealthStatus {
  jev: HealthStatus['jev'] & { served: string | null; key: boolean; lastError: string | null };
  /** Why AI is off and when it is tried again; `sentence` is ready to show ("AI layouts off: no credits. …"). */
  aiDetail: Omit<AiState, 'status'> & { sentence: string };
  /** true only when AI is 'on'. */
  openai: boolean;
  /** budgetLeftUsd: what is left of today's generative budget (OPENAI_BUDGET_USD a day). */
  layouts: { local: true; schema: boolean; deep: boolean; budgetLeftUsd: number; budgetPerDayUsd: number };
  version: string;
}

export function health(): HealthResponse {
  const jev = jevHealth();
  const ai = aiState();
  const { status, ...detail } = ai;
  return {
    ok: jev.key,
    jev: { warm: jev.warm, model: jev.model, served: jev.served, key: jev.key, lastError: jev.lastError },
    ai: status,
    aiDetail: { ...detail, sentence: aiSentence(ai) },
    openai: status === 'on',
    layouts: {
      local: true,
      schema: !!fitSpecJsonSchema && Object.keys(fitSpecJsonSchema).length > 0,
      deep: deepEnabled(),
      budgetLeftUsd: round(Math.max(0, OPENAI_BUDGET_USD - openAiSpentTodayUsd()), 4),
      budgetPerDayUsd: OPENAI_BUDGET_USD,
    },
    version: 'webable-server.3',
  };
}

export function registerHealth(app: Hono): void {
  app.get('/health', (c) => c.json(health()));
  app.get('/v1/stats', (c) => c.json({ ...statsSnapshot(), jevCache: jevCacheInfo(), ai: aiState().status }));
}
