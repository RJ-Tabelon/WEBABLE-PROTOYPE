import { describe, expect, it } from 'vitest';
import type { ElementEvidence, PageDigest } from '../../src/types';
import {
  FINE_CRITERIA, HELP_CRITERIA, IMPORTANCE_LEVELS, JEV_CAUTION, MAIN_CRITERIA, MAX_ELEMENTS_PER_CALL, MAIN_PICK_ID, NONE_OPTION,
  Q_FINE, Q_IMPORTANCE, Q_MAIN, Q_TASK, TASK_CRITERIA, buildPageCalls, parsePageAnswers,
} from '../../src/jev/page';
import { JEV_MAX_CHOICE_OPTIONS, emptyJevMetrics, metricsFrom } from '../../src/jev/api';
import type { JevAnswer, JevQuestion } from '../../src/jev/api';
import { ALDERRA, choice, noul, response, score } from './fixtures';

function bigDigest(n: number): PageDigest {
  const base = ALDERRA.elements[8]!;
  const elements: ElementEvidence[] = Array.from({ length: n }, (_, i) => ({ ...base, id: `n${i + 1}`, label: `Item ${i + 1}` }));
  return { ...ALDERRA, elements, mainCandidates: elements.slice(0, 35).map((e) => e.id) };
}

const criteriaOf = (q: JevQuestion): string => JSON.stringify('criteria' in q ? q.criteria : null);
const elementCalls = <T extends { elementIds: string[] }>(calls: T[]): T[] => calls.filter((c) => c.elementIds.length > 0);

/** The round 7 shape: every question of an element in one call, the role criteria inside each fine question. */
const INLINE = { guideInState: false } as const;

describe('buildPageCalls (design B, inline shape, catalog wa-jev-3)', () => {
  it('puts each element in its own questions, <= 12 subjects per call, main only for candidates', () => {
    const calls = buildPageCalls(ALDERRA, INLINE);
    const cands = new Set(ALDERRA.mainCandidates);
    for (const c of elementCalls(calls)) {
      expect(c.elementIds.length).toBeLessThanOrEqual(MAX_ELEMENTS_PER_CALL);
      for (const id of c.elementIds) {
        for (const k of ['fine', 'task', 'help', 'importance']) {
          const q = c.questions[`${id}__${k}`]!;
          expect(q, `${id}__${k}`).toBeDefined();
          const ins = q.instructions as Record<string, unknown>;
          expect(Object.keys(ins).slice(0, 2)).toEqual(['question', 'element']);
          expect((ins.element as Record<string, unknown>).id).toBe(id);
        }
        expect(`${id}__main` in c.questions, id).toBe(cands.has(id));
      }
      // the shared state holds page context (and the caution line), never element rows
      expect(Object.keys(c.state as object).sort()).toEqual(['caution', 'page']);
    }
    const ids = elementCalls(calls).flatMap((c) => c.elementIds);
    expect(new Set(ids).size).toBe(ALDERRA.elements.length);
  });

  it('splits 40 elements into balanced calls plus one page call', () => {
    const calls = buildPageCalls(bigDigest(40), INLINE);
    expect(calls.map((c) => c.elementIds.length)).toEqual([10, 10, 10, 10, 0]);
    expect(Object.keys(calls[4]!.questions).sort()).toEqual([MAIN_PICK_ID, 'page_purpose']);
  });

  it('asks main_pick once, in the page call, over full evidence objects plus none, <= 255 options', () => {
    const calls = buildPageCalls(bigDigest(40), INLINE);
    expect(calls.filter((c) => MAIN_PICK_ID in c.questions)).toHaveLength(1);
    const pick = calls[calls.length - 1]!.questions[MAIN_PICK_ID]!;
    expect(pick.type).toBe('choice');
    const crit = (pick as Extract<JevQuestion, { type: 'choice' }>).criteria;
    const keys = Object.keys(crit);
    expect(keys.length).toBeLessThanOrEqual(JEV_MAX_CHOICE_OPTIONS);
    expect(keys.length).toBe(31); // 30 candidates + none
    expect(keys[keys.length - 1]).toBe('none');
    expect(crit.none).toBe(NONE_OPTION);
    const n1 = crit.n1 as Record<string, unknown>;
    expect(Object.keys(n1).slice(0, 11)).toEqual([
      'id', 'tag', 'role_hint', 'label', 'zone', 'landmark', 'size', 'position', 'fixed', 'class_words', 'visual_weight',
    ]);
  });

  it('asks the fine role over every FineRole with the escape last, and keeps criteria byte-stable', () => {
    const a = buildPageCalls(ALDERRA, INLINE);
    const b = buildPageCalls(bigDigest(12), INLINE);
    const fineA = a[0]!.questions.n1__fine!;
    const fineB = b[0]!.questions.n7__fine!;
    expect(fineA.type).toBe('choice');
    const keys = Object.keys((fineA as Extract<JevQuestion, { type: 'choice' }>).criteria);
    expect(keys[keys.length - 1]).toBe('other');
    expect(criteriaOf(fineA)).toBe(criteriaOf(fineB));
    expect(criteriaOf(fineA)).toBe(JSON.stringify(FINE_CRITERIA));
    expect(criteriaOf(a[0]!.questions.n2__task!)).toBe(JSON.stringify(TASK_CRITERIA));
    expect(criteriaOf(a[0]!.questions.n3__main!)).toBe(JSON.stringify(MAIN_CRITERIA));
    expect(criteriaOf(b[0]!.questions.n3__help!)).toBe(JSON.stringify(HELP_CRITERIA));
    const imp = a[0]!.questions.n1__importance!;
    expect(imp.type).toBe('score');
    expect(criteriaOf(imp)).toBe(JSON.stringify(IMPORTANCE_LEVELS));
    expect((fineA.instructions as Record<string, unknown>).question).toBe(Q_FINE);
    expect((imp.instructions as Record<string, unknown>).question).toBe(Q_IMPORTANCE);
    expect((a[0]!.questions.n2__task!.instructions as Record<string, unknown>).question).toBe(Q_TASK);
    expect((a[0]!.questions.n3__main!.instructions as Record<string, unknown>).question).toBe(Q_MAIN);
  });

  it('uses the measured wording for the task Noul', () => {
    expect(Q_TASK).toBe(
      'Is the element described in `element` part of the main job of the page described in `page`: content the visitor reads for that job, or a field, button or step they use to do it?',
    );
  });

  it('puts the caution line in the shared state on pages with ad iframes or off-site links, unless turned off', () => {
    const on = buildPageCalls(ALDERRA, INLINE);
    expect((on[0]!.state as Record<string, unknown>).caution).toBe(JEV_CAUTION);
    expect((on[0]!.questions.n1__fine!.instructions as Record<string, unknown>).caution).toBeUndefined();
    const off = buildPageCalls(ALDERRA, { caution: false, guideInState: false });
    expect((off[0]!.state as Record<string, unknown>).caution).toBeUndefined();
    const plain = buildPageCalls(bigDigest(5), INLINE);
    expect((plain[0]!.state as Record<string, unknown>).caution).toBeUndefined();
  });

  it('redacts labels and the page title again before they go to Jev', () => {
    const calls = buildPageCalls(ALDERRA, INLINE);
    const all = JSON.stringify(calls);
    expect(all).not.toContain('555-0147');
    expect(all).not.toContain('Atorvastatin');
    expect(all).not.toContain('6214');
    expect(all).toContain('[phone number]');
    expect(all).toContain('[medication]');
  });
});

describe('parsePageAnswers', () => {
  it('builds typed judgments and leaves out elements with a missing answer', () => {
    const calls = buildPageCalls(ALDERRA, INLINE);
    const responses = calls.map((c) => {
      const answers: Record<string, JevAnswer> = {};
      for (const id of c.elementIds) {
        if (id === 'n2') continue; // simulate a missing element
        answers[`${id}__fine`] = choice({ advertising: 0.9, upsell_promo: 0.07, body_text: 0.03 });
        answers[`${id}__task`] = noul(0.02);
        if (`${id}__main` in c.questions) answers[`${id}__main`] = noul(0.01);
        answers[`${id}__help`] = noul(0.01);
        answers[`${id}__importance`] = score(0.4, 5);
      }
      if (MAIN_PICK_ID in c.questions) answers[MAIN_PICK_ID] = choice({ n19: 0.98, n26: 0.01, none: 0.01 });
      return response(answers, 20_000);
    });
    const m = metricsFrom(responses.map((body) => ({ body, wallMs: 300, serverMs: 200, questions: 50 })));
    const u = parsePageAnswers(ALDERRA, calls, responses, m);
    expect(u.elements).toHaveLength(ALDERRA.elements.length - 1);
    expect(u.elements.find((e) => e.id === 'n2')).toBeUndefined();
    const n1 = u.elements.find((e) => e.id === 'n1')!;
    // fine roles sum into their family: ad + upsell are both advertising
    expect(n1).toMatchObject({ role: 'advertising', roleP: 0.97, task: 0.02, main: 0, help: 0.01, fine: 'advertising', fineP: 0.9, importance: 0.4 });
    expect(n1.roleProbs).toEqual({ advertising: 0.97, main_content: 0.03 });
    expect(u.elements.find((e) => e.id === 'n3')!.main).toBe(0.01); // a candidate: its main Noul was asked
    expect(u.mainPick).toEqual({ id: 'n19', p: 0.98, probs: { n19: 0.98, n26: 0.01, none: 0.01 } });
    expect(u.cached).toBe(false);
    expect(u.metrics.inputTokens).toBe(20_000 * calls.length);
  });

  it('fails closed when a call has no response', () => {
    const calls = buildPageCalls(ALDERRA, INLINE);
    const u = parsePageAnswers(ALDERRA, calls, [], emptyJevMetrics());
    expect(u.elements).toEqual([]);
    expect(u.mainPick.id).toBe('none');
    expect(u.purpose).toBeUndefined();
    expect(u.mainRegion).toBeUndefined();
  });
});

describe('metricsFrom', () => {
  it('adds tokens and questions, takes the slowest parallel call, prices input tokens', () => {
    const m = metricsFrom([
      { body: response({}, 30_000), wallMs: 250, serverMs: 180, questions: 61 },
      { body: response({}, 12_500), wallMs: 300.4, serverMs: null, questions: 40 },
    ]);
    expect(m).toMatchObject({ model: 'jev-1.14.0', calls: 2, questions: 101, inputTokens: 42_500, wallMs: 300, serverMs: 180 });
    expect(m.costUsd).toBeCloseTo(0.001785, 6);
  });
});
