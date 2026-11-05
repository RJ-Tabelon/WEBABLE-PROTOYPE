import { describe, expect, it } from 'vitest';
import type { FitSummaryForModel, LayoutCandidate } from '../../src/types';
import { applyUnfold, buildJudgeCall, chooseCandidate, judgeLayoutFeatures, scoreCandidates } from '../../src/jev/judge';
import { CANDIDATES, OUTLINE, noul, response, score } from './fixtures';

const FIT_SUMMARY: FitSummaryForModel = {
  text_need: 'large', target_need: 'large', clutter_tolerance: 'low', structure_level: 2, motion: 'reduce', polarity: 'light',
};

const cand = (name: LayoutCandidate['name'], pEasier: number, pHides: number, fitScore = 2): LayoutCandidate => ({
  ...CANDIDATES[0]!, name, pEasier, pHides, fitScore, composite: pEasier * (1 - pHides),
});

describe('buildJudgeCall', () => {
  const call = buildJudgeCall(CANDIDATES, FIT_SUMMARY, OUTLINE);

  it('asks better, risk and a 5-level fit Score per layout, and need per folded section; never a Choice', () => {
    const ids = Object.keys(call.questions);
    expect(ids).toEqual([
      'fit_layout_q', 'better_layout_q', 'risk_layout_q', 'fit_layout_m', 'better_layout_m', 'risk_layout_m',
      'need_layout_q_1', 'need_layout_q_2', 'need_layout_m_1', 'need_layout_m_3',
    ]);
    expect(Object.values(call.questions).some((q) => q.type === 'choice')).toBe(false);
    const fit = call.questions.fit_layout_q!;
    expect(fit.type).toBe('score');
    expect((fit as { criteria: unknown[] }).criteria).toHaveLength(5);
  });

  it('uses neutral codes, functional needs only, and evidence inside each question', () => {
    const all = JSON.stringify(call);
    expect(all).not.toMatch(/heuristic|focus|guided|overview/);
    expect(all).not.toMatch(/disab|impair|tremor|diagnos|vision/i);
    const st = call.state as { person: Record<string, string>; page: Record<string, string> };
    expect(st.person.clutter).toBe('busy pages cost this person a lot of time');
    expect(st.page.main_task).toBe('fill in the form and submit it');
    const ins = call.questions.risk_layout_m!.instructions as Record<string, unknown>;
    expect(Object.keys(ins)).toEqual(['question', 'layout']);
  });

  it('computes layout features in code', () => {
    const f = judgeLayoutFeatures(CANDIDATES[1]!.spec, OUTLINE);
    expect(f.main_task_section_position).toBe(1);
    expect(f.folded_sections).toBe(2);
    expect(f.ads_or_sponsored_open).toBe(false);
    expect(f.help_in_view).toBe(true);
    expect(f.main_action_in_view).toBe(true);
    expect(String((f.folded_parts as string[])[0])).toContain('Choose options (collapsed)');
  });
});

describe('scoreCandidates', () => {
  it('fills composite = P(easier) x (1 - P(hides)) and lists needed folded sections', () => {
    const r = response({
      fit_layout_q: score(3.46, 5), better_layout_q: noul(0.91), risk_layout_q: noul(0.2),
      fit_layout_m: score(2.61, 5), better_layout_m: noul(0.89), risk_layout_m: noul(0.78),
      need_layout_q_1: noul(0.1), need_layout_q_2: noul(0.05), need_layout_m_1: noul(0.81), need_layout_m_3: noul(0.2),
    });
    const s = scoreCandidates(CANDIDATES, r);
    expect(s.cands[0]).toMatchObject({ name: 'heuristic', pEasier: 0.91, pHides: 0.2, fitScore: 3.46, composite: 0.728 });
    expect(s.cands[1]!.composite).toBeCloseTo(0.89 * 0.22, 4);
    expect(s.unfold).toEqual([{ candidate: 'focus', sectionIndex: 1 }]);
  });

  it('leaves a candidate unscored when its answers are missing', () => {
    const s = scoreCandidates(CANDIDATES, response({}));
    expect(s.cands.every((c) => c.composite === undefined)).toBe(true);
    expect(chooseCandidate(s.cands)).toEqual({ chosen: 'heuristic', autoApply: false });
  });
});

describe('chooseCandidate', () => {
  it('picks the highest composite and auto-applies when P(easier) >= 0.70 and P(hides) < 0.50', () => {
    expect(chooseCandidate([cand('heuristic', 0.3, 0.3), cand('overview', 0.73, 0.26), cand('guided', 0.69, 0.34)]))
      .toEqual({ chosen: 'overview', autoApply: true });
    expect(chooseCandidate([cand('heuristic', 0.3, 0.3), cand('guided', 0.69, 0.1)])).toEqual({ chosen: 'guided', autoApply: false });
  });

  it('rejects P(hides) >= 0.80 even with the best composite', () => {
    expect(chooseCandidate([cand('focus', 1, 0.8), cand('heuristic', 0.4, 0.3)]).chosen).toBe('heuristic');
  });

  it('breaks ties within 0.03 by the fit Score', () => {
    const r = chooseCandidate([cand('focus', 0.78, 0.5, 1.87), cand('overview', 0.8, 0.5, 2.4)]);
    expect(r.chosen).toBe('overview');
    const r2 = chooseCandidate([cand('focus', 0.8, 0.5, 3.0), cand('overview', 0.79, 0.5, 2.0)]);
    expect(r2.chosen).toBe('focus');
  });

  it('falls back to heuristic when nothing qualifies', () => {
    expect(chooseCandidate([cand('focus', 0.9, 0.92)])).toEqual({ chosen: 'heuristic', autoApply: false });
    expect(chooseCandidate([])).toEqual({ chosen: 'heuristic', autoApply: false });
  });
});

describe('applyUnfold', () => {
  it('opens needed sections and moves them right after the primary section', () => {
    const c = applyUnfold(CANDIDATES[1]!, [1]);
    expect(c.spec.sections.map((s) => `${s.label}:${s.state}`)).toEqual([
      'Review and submit:open', 'Choose options:open', 'Help:open', 'More on this page:end_drawer',
    ]);
    expect(c.repairs[c.repairs.length - 1]).toContain('Choose options');
  });
});
