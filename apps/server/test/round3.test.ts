// Round 3 package S: AI back on. The daily spend cap and model layouts repaired
// with Jev's roles. No network: no Jev or OpenAI call is made here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexOutline, placementMap } from '@webable/core';
import type { FitSpec } from '@webable/core';
import { aiSentence, aiState, resetAiState } from '../src/ai';
import { createApp } from '../src/app';
import { OPENAI_BUDGET_USD } from '../src/config';
import { LAYOUT_INSTRUCTIONS } from '../src/prompts';
import { structureKey, toCandidate } from '../src/routes/redesign';
import { dayKey, openAiSpentTodayUsd, recordOpenAiCall, resetDailySpend } from '../src/stats';
import { ALDERRA_LIVE, ALDERRA_LIVE_ROLES } from '../../../packages/core/test/c/live-fixtures';

const saved = process.env.OPENAI_API_KEY;
beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  resetAiState();
  resetDailySpend();
});
afterEach(() => {
  if (saved === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = saved;
  resetAiState();
  resetDailySpend();
});

describe('daily budget', () => {
  it('turns AI off for the rest of the day once today’s spend reaches the cap, and says when it returns', async () => {
    expect(aiState().status).toBe('on');
    recordOpenAiCall({ model: 'gpt-6-sol', inputTokens: 1, cachedTokens: 0, outputTokens: 1, costUsd: OPENAI_BUDGET_USD + 0.01, ms: 10 });
    expect(openAiSpentTodayUsd()).toBeGreaterThanOrEqual(OPENAI_BUDGET_USD);
    const s = aiState();
    expect([s.status, s.reason]).toEqual(['no_credits', 'budget']);
    const retry = new Date(s.retryAt!);
    expect(retry.getHours()).toBe(0);
    expect(dayKey(retry.getTime())).not.toBe(dayKey());
    expect(aiSentence(s)).toMatch(/today's spending cap/);
    const h = (await (await createApp().request('/health')).json()) as { ai: string; layouts: { budgetLeftUsd: number; budgetPerDayUsd: number } };
    expect(h.ai).toBe('no_credits');
    expect(h.layouts.budgetLeftUsd).toBe(0);
    expect(h.layouts.budgetPerDayUsd).toBe(OPENAI_BUDGET_USD);
  });
  it('yesterday’s spend does not count today', () => {
    const tomorrow = Date.now() + 26 * 3600_000;
    recordOpenAiCall({ model: 'gpt-6-sol', inputTokens: 1, cachedTokens: 0, outputTokens: 1, costUsd: OPENAI_BUDGET_USD, ms: 10 });
    expect(openAiSpentTodayUsd(tomorrow)).toBe(0);
    expect(aiState(tomorrow).status).toBe('on');
  });
});

describe('model layouts are repaired with Jev roles', () => {
  // What gpt-6-sol returned for Alderra: the whole main region (upsells inside) as the primary section.
  const modelSpec: FitSpec = {
    page_type: 'form', task: 'other', strip: ['n8', 'n9', 'n13', 'n14'], primary_action: 'n94', density: 'airy',
    form_steps: [{ label: 'What you need', fields: ['n56', 'n60', 'n64'] }],
    sections: [
      { heading_ref: null, label: 'What you need', role: 'primary', nodes: ['n48'], layout: 'form_steps', emphasis: 'lead', state: 'open', why: 'main_task', show_first: 0 },
      { heading_ref: null, label: 'Cookies', role: 'consent', nodes: ['n306'], layout: 'as_is', emphasis: 'normal', state: 'open', why: 'protected', show_first: 0 },
    ],
  };
  it('moves the in-form upsells to the end and keeps the task open', () => {
    const c = toCandidate('focus', modelSpec, ALDERRA_LIVE, 'gpt-6-sol', ALDERRA_LIVE_ROLES);
    expect(c).not.toBeNull();
    expect(c!.repairs[0]).toMatch(/^source: ai/);
    expect(c!.repairs.some((r) => r.startsWith('ads_lifted:'))).toBe(true);
    const ix = indexOutline(ALDERRA_LIVE);
    const m = placementMap(c!.spec);
    const sectionOf = (id: string) => {
      for (const x of [id, ...ix.ancestors(id)]) {
        const w = m.get(x);
        if (typeof w === 'number') return c!.spec.sections[w]!;
      }
      return null;
    };
    expect(sectionOf('n68')?.state).toBe('end_drawer');
    expect(sectionOf('n84')?.state).toBe('end_drawer');
    expect(sectionOf('n94')?.role).toBe('primary');
    expect(sectionOf('n94')?.state).toBe('open');
  });
  it('a spec that breaks the schema is no candidate', () => {
    expect(toCandidate('focus', { ...modelSpec, density: 'roomy' }, ALDERRA_LIVE, 'gpt-6-sol')).toBeNull();
  });
  it('the layout prompt allows no primary action on a page that is only read', () => {
    expect(LAYOUT_INSTRUCTIONS).toMatch(/Use null when no single control completes the task/);
  });
});

describe('model layouts are reused for the same page structure', () => {
  const fit = { text_need: 'large', target_need: 'large', clutter_tolerance: 'low', structure_level: 2, motion: 'reduce', polarity: 'none' } as const;
  it('ignores words (a carousel slide, a cart count) but not structure or roles', () => {
    const a = structureKey(ALDERRA_LIVE, fit, ALDERRA_LIVE_ROLES);
    const relabelled = { ...ALDERRA_LIVE, nodes: ALDERRA_LIVE.nodes.map((n) => (n.id === 'n14' ? { ...n, label: 'Cart [number] items' } : n)) };
    expect(structureKey(relabelled, fit, ALDERRA_LIVE_ROLES)).toBe(a);
    const moved = { ...ALDERRA_LIVE, nodes: ALDERRA_LIVE.nodes.map((n) => (n.id === 'n94' ? { ...n, parent: 'n5' } : n)) };
    expect(structureKey(moved, fit, ALDERRA_LIVE_ROLES)).not.toBe(a);
    expect(structureKey(ALDERRA_LIVE, fit, { ...ALDERRA_LIVE_ROLES, n93: 'advertising' })).not.toBe(a);
    expect(structureKey(ALDERRA_LIVE, { ...fit, structure_level: 1 }, ALDERRA_LIVE_ROLES)).not.toBe(a);
  });
});
