// Round 2 package S: no-credits handling, local layouts judged like model layouts, honest cache metrics,
// and the overlay route's guards. No network: no Jev or OpenAI call is made here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JEV_MODEL, buildJudgeCall, judgeCode, sourceTag } from '@webable/core';
import type { JevResponse, LayoutCandidate } from '@webable/core';
import { aiSentence, aiState, aiStatus, classifyOpenAiFailure, markAiBlocked, markAiWorking, resetAiState } from '../src/ai';
import { createApp } from '../src/app';
import { AI_BLOCK_MS } from '../src/config';
import { FIXTURE_FIT, FIXTURE_OUTLINE, FIXTURE_OVERLAY, FIXTURE_OVERLAY_BUTTONS, FIXTURE_ROLES } from '../src/fixtures';
import type { JevResult } from '../src/jev';
import { overlayClose } from '../src/routes/overlay';
import { chosenFirst, redesign, scoreAndChoose } from '../src/routes/redesign';
import { viewMetrics } from '../src/routes/understand';
import { localVariants } from '@webable/core';

const saved = { openai: process.env.OPENAI_API_KEY, jev: process.env.TYPESAFE_API_KEY };

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  resetAiState();
});

afterEach(() => {
  if (saved.openai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = saved.openai;
  if (saved.jev === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved.jev;
  resetAiState();
});

describe('AI availability', () => {
  it('classifies quota, billing and key failures, and leaves rate limits alone', () => {
    expect(classifyOpenAiFailure({ status: 429, code: 'credit_balance_exhausted', type: 'insufficient_quota' })).toBe('no_credits');
    expect(classifyOpenAiFailure({ status: 429, code: 'insufficient_quota' })).toBe('no_credits');
    expect(classifyOpenAiFailure({ status: 429, type: 'insufficient_quota', message: 'You exceeded your current quota' })).toBe('no_credits');
    expect(classifyOpenAiFailure({ status: 429, message: 'You have no credits remaining.' })).toBe('no_credits');
    expect(classifyOpenAiFailure({ status: 401, code: 'invalid_api_key' })).toBe('key_rejected');
    expect(classifyOpenAiFailure({ status: 429, code: 'rate_limit_exceeded', message: 'Rate limit reached for requests' })).toBeNull();
    expect(classifyOpenAiFailure({ status: 500 })).toBeNull();
    expect(classifyOpenAiFailure({ status: 400, message: 'Invalid schema' })).toBeNull();
  });

  it('no key is off; no credits is off for 10 minutes, then tried again', () => {
    expect(aiStatus()).toBe('off');
    expect(aiState().reason).toBe('no_key');
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    expect(aiStatus()).toBe('on');
    const t = 1_000_000;
    expect(markAiBlocked('no_credits', t)).toBe(true);
    expect(markAiBlocked('no_credits', t + 5)).toBe(false); // already off: one log line only
    expect(aiStatus(t + 1)).toBe('no_credits');
    expect(aiState(t + 1).retryAt).toBe(new Date(t + 5 + AI_BLOCK_MS).toISOString());
    expect(aiSentence(aiState(t + 1))).toMatch(/^AI layouts off: no credits\./);
    expect(aiStatus(t + 5 + AI_BLOCK_MS + 1)).toBe('on');
    markAiBlocked('key_rejected', t);
    expect(markAiWorking(t + 2)).toBe(true);
    expect(aiStatus(t + 3)).toBe('on');
  });

  it('/health reports HealthStatus with the reason', async () => {
    const app = createApp();
    const off = (await (await app.request('/health')).json()) as Record<string, unknown> & { aiDetail: { reason: string; sentence: string } };
    expect(off.ai).toBe('off');
    expect(off.openai).toBe(false);
    expect(off.aiDetail.reason).toBe('no_key');
    expect(typeof (off.jev as { warm: unknown }).warm).toBe('boolean');
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    markAiBlocked('no_credits');
    const nc = (await (await app.request('/health')).json()) as { ai: string; openai: boolean; aiDetail: { retryAt: string | null; sentence: string } };
    expect(nc.ai).toBe('no_credits');
    expect(nc.openai).toBe(false);
    expect(nc.aiDetail.retryAt).not.toBeNull();
    expect(nc.aiDetail.sentence).toContain('no credits');
  });
});

describe('understand metrics', () => {
  const body: JevResponse = { model: JEV_MODEL, answers: {}, usage: { input_tokens: 40_000, output_tokens: 0 } };
  const res = (cached: boolean, wallMs: number): JevResult => ({ body, wallMs, serverMs: wallMs - 100, questions: 80, cached, retries: 0 });

  it('a live read reports its own cost and no firstRead', () => {
    const v = viewMetrics([res(false, 619), res(false, 540)], 640);
    expect(v.cached).toBe(false);
    expect(v.firstRead).toBeUndefined();
    expect(v.metrics.calls).toBe(2);
    expect(v.metrics.wallMs).toBe(619);
    expect(v.metrics.costUsd).toBeGreaterThan(0);
  });
  it('a cached view costs $0 and keeps the first read beside it', () => {
    const v = viewMetrics([res(true, 619), res(true, 540)], 1.4);
    expect(v.cached).toBe(true);
    expect(v.metrics).toMatchObject({ calls: 0, inputTokens: 0, costUsd: 0, serverMs: null, questions: 160 });
    expect(v.metrics.wallMs).toBeLessThan(5);
    expect(v.firstRead).toMatchObject({ calls: 2, wallMs: 619, questions: 160 });
    expect(v.firstRead!.costUsd).toBeCloseTo(80_000 * 0.042e-6, 8);
  });
  it('a partly cached read charges only the live calls, but counts every decision', () => {
    const v = viewMetrics([res(true, 619), res(false, 300)], 310);
    expect(v.cached).toBe(false);
    expect(v.metrics).toMatchObject({ calls: 1, questions: 160, wallMs: 300 });
  });
  it('noCache is accepted by the route (it then needs Jev)', async () => {
    const app = createApp();
    const { FIXTURE_DIGEST } = await import('../src/fixtures');
    const r = await app.request('/v1/understand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ digest: FIXTURE_DIGEST, noCache: true }) });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('jev_unavailable');
  });
});

describe('redesign: local layouts judged like model layouts', () => {
  const local = localVariants(FIXTURE_OUTLINE, FIXTURE_ROLES, FIXTURE_FIT);
  const heuristic: LayoutCandidate = { name: 'heuristic', spec: local[0]!.spec, repairs: [sourceTag('heuristic')] };
  const aiFocus: LayoutCandidate = { name: 'focus', spec: local[0]!.spec, repairs: [sourceTag('ai', 'gpt-6-sol')] };

  /** Answers for every judge question: candidate i gets `better[i]`, risk 0.1, fit 3. */
  function answers(cands: LayoutCandidate[], better: number[]): JevResponse {
    const call = buildJudgeCall(cands, FIXTURE_FIT, FIXTURE_OUTLINE);
    const a: JevResponse['answers'] = {};
    for (const id of Object.keys(call.questions)) {
      if (id.startsWith('fit_')) a[id] = { type: 'score', score: 3, legend: {}, probabilities: {}, confidence: 0.9 };
      else if (id.startsWith('risk_')) a[id] = { type: 'noul', noul: 0.1 };
      else if (id.startsWith('need_')) a[id] = { type: 'noul', noul: 0.05 };
    }
    cands.forEach((_, i) => {
      a[`better_${judgeCode(i)}`] = { type: 'noul', noul: better[i] ?? 0 };
    });
    return { model: JEV_MODEL, answers: a, usage: { input_tokens: 1, output_tokens: 0 } };
  }

  it('picks the exact candidate when a local and a model layout share a name', () => {
    const cands = [heuristic, local[0]!, aiFocus];
    expect(cands[1]!.name).toBe('focus');
    const out = scoreAndChoose(cands, answers(cands, [0.5, 0.6, 0.95]));
    expect(out.index).toBe(2);
    expect(out.autoApply).toBe(true);
    expect(out.cands.map((c) => c.name)).toEqual(['heuristic', 'focus', 'focus']);
    const ordered = chosenFirst(out.cands, out.index);
    // A lookup by name now finds the model's focus layout, the one Jev chose.
    expect(ordered.find((c) => c.name === 'focus')!.repairs[0]).toBe(sourceTag('ai', 'gpt-6-sol'));
    expect(ordered).toHaveLength(3);
  });

  it('falls back to the heuristic, not applied, when nothing is clearly better', () => {
    const cands = [heuristic, ...local];
    const a = answers(cands, cands.map(() => 0.5));
    for (const k of Object.keys(a.answers)) if (k.startsWith('risk_')) a.answers[k] = { type: 'noul', noul: 0.95 };
    const out = scoreAndChoose(cands, a);
    expect(out.cands[out.index]!.name).toBe('heuristic');
    expect(out.autoApply).toBe(false);
  });

  it('without Jev the server returns the instant layout only, tagged, with ai off', async () => {
    const { result } = await redesign({ outline: FIXTURE_OUTLINE, fit: FIXTURE_FIT, roles: FIXTURE_ROLES });
    expect(result.ai).toBe('off');
    expect(result.chosen).toBe('heuristic');
    expect(result.autoApply).toBe(false);
    expect(result.sources).toEqual({ heuristic: 1, local: 0, ai: 0 });
    expect(result.candidates[0]!.source).toBe('heuristic');
    expect(result.candidates[0]!.repairs[0]).toMatch(/^source: heuristic/);
  });
});

describe('overlay-close guards', () => {
  it('never asks about a consent notice', async () => {
    const r = await overlayClose({ overlay: { ...FIXTURE_OVERLAY, kind_hint: 'consent' }, candidates: FIXTURE_OVERLAY_BUTTONS });
    expect(r).toMatchObject({ pick: 'none', accept: false, skipped: 'consent' });
    expect(r.metrics.calls).toBe(0);
  });
  it('asks nothing when there is no button', async () => {
    const r = await overlayClose({ overlay: FIXTURE_OVERLAY, candidates: [] });
    expect(r).toMatchObject({ pick: 'none', accept: false, skipped: 'no_candidates' });
  });
  it('validates the body', async () => {
    const app = createApp();
    const r = await app.request('/v1/overlay-close', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overlay: { ...FIXTURE_OVERLAY, kind_hint: 'cookie wall' }, candidates: [] }),
    });
    expect(r.status).toBe(400);
  });
});
