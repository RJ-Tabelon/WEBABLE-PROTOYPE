// Round 7 package J: the policy on page model v2 answers. No network.
import { describe, expect, it } from 'vitest';
import type { ElementJudgment, FineRole, PageUnderstanding } from '../../src/types';
import {
  FINE_WORDS, POLICY, acceptedFine, acceptedMainRegion, acceptedPurpose, decideElements, importanceOf, isDistraction,
} from '../../src/policy';
import type { LocalFacts } from '../../src/policy';
import { FINE_ROLES, coarseFromFine } from '../../src/jev/page';
import { emptyJevMetrics } from '../../src/jev/api';
import { ALDERRA } from '../a1/fixtures';

const NO_LOCAL: LocalFacts = { focusedIds: [], requiredIds: [], filledIds: [], consentIds: [], offsiteIds: [] };

function jf(id: string, fine: Record<string, number>, task: number, help: number, importance?: number): ElementJudgment {
  const roleProbs = coarseFromFine(fine);
  const [role, roleP] = Object.entries(roleProbs).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0] as [ElementJudgment['role'], number];
  const [top, fineP] = Object.entries(fine).sort((a, b) => b[1] - a[1])[0]!;
  return { id, role, roleP, roleProbs, task, main: 0, help, fine: top as FineRole, fineP, ...(importance !== undefined ? { importance } : {}) };
}

function u(elements: ElementJudgment[], extra: Partial<PageUnderstanding> = {}): PageUnderstanding {
  return { elements, mainPick: { id: 'none', p: 1, probs: { none: 1 } }, metrics: emptyJevMetrics(), cached: false, ...extra };
}

describe('decideElements on fine roles', () => {
  it('folds a sure teaser through its summed family and names the fine role in the reasons', () => {
    const d = decideElements(u([jf('n21', { teaser_other_content: 0.88, carousel: 0.08, upsell_promo: 0.04 }, 0.1, 0.02, 0.9)]), ALDERRA, NO_LOCAL)
      .find((x) => x.id === 'n21')!;
    expect(d.verdict).toBe('fold');
    expect(d.reasons[0]).toBe('recommendations 0.96');
    expect(d.reasons).toContain('teaser for other pages 0.88');
  });

  it('protects what Jev rates part of the page (importance >= 3) even when the role says distraction', () => {
    const d = decideElements(u([jf('n21', { teaser_other_content: 0.95, carousel: 0.05 }, 0.1, 0.02, 3.4)]), ALDERRA, NO_LOCAL)
      .find((x) => x.id === 'n21')!;
    expect(d.verdict).toBe('protect');
    expect(d.reasons).toContain('importance 3.4 of 4');
  });

  it('protects team logos and stats through the main-content family', () => {
    const d = decideElements(u([jf('n7', { team_or_org_logo: 0.94, decorative: 0.06 }, 0.1, 0.01, 2.9)]), ALDERRA, NO_LOCAL)
      .find((x) => x.id === 'n7')!;
    expect(d.verdict).toBe('protect');
  });
});

describe('page-level answers are acted on only when confident', () => {
  it('accepts the purpose at 0.60 and never `other`', () => {
    expect(acceptedPurpose(u([], { purpose: { kind: 'record_stats', p: 0.99, probs: {} } }))).toBe('record_stats');
    expect(acceptedPurpose(u([], { purpose: { kind: 'recipe', p: 0.59, probs: {} } }))).toBeNull();
    expect(acceptedPurpose(u([], { purpose: { kind: 'other', p: 0.9, probs: {} } }))).toBeNull();
    expect(acceptedPurpose(u([]))).toBeNull();
  });

  it('accepts the main region at 0.80 (both orders) and never `none`', () => {
    expect(acceptedMainRegion(u([], { mainRegion: { id: 'n9003', p: 0.86, probs: {} } }))).toBe('n9003');
    expect(acceptedMainRegion(u([], { mainRegion: { id: 'n9003', p: 0.79, probs: {} } }))).toBeNull();
    expect(acceptedMainRegion(u([], { mainRegion: { id: 'none', p: 0.95, probs: {} } }))).toBeNull();
    expect(POLICY.mainRegionAccept).toBe(0.8);
  });

  it('accepts a fine role at 0.50 and defaults importance to 2', () => {
    expect(acceptedFine(jf('a', { scoreboard: 0.52, data_table: 0.48 }, 0.9, 0))).toBe('scoreboard');
    expect(acceptedFine(jf('a', { key_fact: 0.44, stat_value: 0.4, other: 0.16 }, 0.9, 0))).toBeNull();
    expect(importanceOf(jf('a', { other: 1 }, 0, 0))).toBe(2);
    expect(importanceOf(jf('a', { other: 1 }, 0, 0, 3.8))).toBe(3.8);
  });

  it('marks distractions, but never what the task or help needs', () => {
    expect(isDistraction(jf('a', { teaser_other_content: 0.87, upsell_promo: 0.13 }, 0.16, 0.01, 0.95))).toBe(true);
    expect(isDistraction(jf('a', { advertising: 1 }, 0.05, 0.01))).toBe(true);
    expect(isDistraction(jf('a', { other: 0.6, decorative: 0.4 }, 0.05, 0.01, 0.4))).toBe(true);
    expect(isDistraction(jf('a', { carousel: 0.7, schedule_item: 0.3 }, 0.42, 0.02, 0.9))).toBe(false); // task 0.42
    expect(isDistraction(jf('a', { teaser_other_content: 0.9, help_link: 0.1 }, 0.1, 0.4, 1))).toBe(false); // help
    expect(isDistraction(jf('a', { scoreboard: 0.73, stat_value: 0.27 }, 0.92, 0.01, 3.8))).toBe(false);
    expect(isDistraction(null)).toBe(false);
  });

  it('has plain words for every fine role', () => {
    for (const r of FINE_ROLES) expect(FINE_WORDS[r], r).toMatch(/^[a-z ]+$/);
  });
});
