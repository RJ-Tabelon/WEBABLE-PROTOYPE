import { describe, expect, it } from 'vitest';
import type { ElementJudgment, PageDigest, PageUnderstanding, Role } from '../../src/types';
import { decideElements, summarizeDecisions } from '../../src/policy';
import type { LocalFacts } from '../../src/policy';
import { emptyJevMetrics } from '../../src/jev/api';
import { ALDERRA } from './fixtures';

const NO_LOCAL: LocalFacts = { focusedIds: [], requiredIds: [], filledIds: [], consentIds: [], offsiteIds: [] };

function j(id: string, roleProbs: Partial<Record<Role, number>>, task: number, main: number, help: number): ElementJudgment {
  const [role, roleP] = Object.entries(roleProbs).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0] as [Role, number];
  return { id, role, roleP, roleProbs, task, main, help };
}

function understanding(elements: ElementJudgment[], probs: Record<string, number> = { none: 1 }): PageUnderstanding {
  const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]!;
  return { elements, mainPick: { id: top[0], p: top[1], probs }, metrics: emptyJevMetrics(), cached: false };
}

const digest: PageDigest = ALDERRA;
const verdictOf = (u: PageUnderstanding, id: string, local: LocalFacts = NO_LOCAL) =>
  decideElements(u, digest, local).find((d) => d.id === id)!;

describe('decideElements thresholds (research-jev §4.4)', () => {
  it('folds a sure distraction', () => {
    const u = understanding([j('n22', { advertising: 0.97, recommendations: 0.02, other: 0.01 }, 0.02, 0.01, 0.01)]);
    const d = verdictOf(u, 'n22');
    expect(d.verdict).toBe('fold');
    expect(d.reasons[0]).toBe('advertising 0.97');
  });

  it('does not fold when task > 0.20 or help > 0.10', () => {
    expect(verdictOf(understanding([j('n13', { advertising: 0.97, other: 0.03 }, 0.21, 0.07, 0.02)]), 'n13').verdict).toBe('keep');
    expect(verdictOf(understanding([j('n13', { advertising: 0.97, other: 0.03 }, 0.05, 0.07, 0.11)]), 'n13').verdict).toBe('keep');
  });

  it('protects when the protective roles reach 0.05 (quantized sums compare exactly)', () => {
    const u = understanding([j('n7', { advertising: 0.95, main_content: 0.02, navigation: 0.03 }, 0.02, 0.01, 0.01)]);
    expect(verdictOf(u, 'n7').verdict).toBe('protect');
    const u2 = understanding([j('n7', { advertising: 0.96, main_content: 0.02, navigation: 0.02 }, 0.02, 0.01, 0.01)]);
    expect(verdictOf(u2, 'n7').verdict).toBe('fold');
  });

  it('protects on task >= 0.30 or help >= 0.30', () => {
    expect(verdictOf(understanding([j('n2', { search: 0.99, other: 0.01 }, 0.33, 0.05, 0.03)]), 'n2').verdict).toBe('protect');
    const d = verdictOf(understanding([j('n20', { legal_footer: 0.6, other: 0.4 }, 0.04, 0.01, 0.86)]), 'n20');
    expect(d.verdict).toBe('protect');
    expect(d.reasons[0]).toBe('help 0.86');
  });

  it('keeps a popup that affects the task and folds one that does not', () => {
    const u = understanding([
      j('n24', { popup_overlay: 0.95, help_contact: 0.0, other: 0.05 }, 0.81, 0.02, 0.03),
      j('n23', { popup_overlay: 0.99, other: 0.01 }, 0.02, 0.01, 0.02),
    ]);
    expect(verdictOf(u, 'n24').verdict).toBe('keep_popup');
    expect(verdictOf(u, 'n23').verdict).toBe('fold');
  });

  it('never folds a consent notice, whatever Jev says', () => {
    const u = understanding([j('n23', { advertising: 0.99, other: 0.01 }, 0.01, 0.01, 0.01)]);
    const d = verdictOf(u, 'n23', { ...NO_LOCAL, consentIds: ['n23'] });
    expect(d.verdict).toBe('protect');
    expect(d.reasons).toContain('consent notice (rule)');
  });

  it('protects focused, required and filled fields by local rule', () => {
    const u = understanding([j('n11', { advertising: 0.99, other: 0.01 }, 0.01, 0.01, 0.01)]);
    expect(verdictOf(u, 'n11', { ...NO_LOCAL, focusedIds: ['n11'] }).verdict).toBe('protect');
    expect(verdictOf(u, 'n11', { ...NO_LOCAL, requiredIds: ['n11'] }).verdict).toBe('protect');
    expect(verdictOf(u, 'n11', { ...NO_LOCAL, filledIds: ['n11'] }).verdict).toBe('protect');
  });

  it('promotes the main action only when pick >= 0.90 and its main Noul >= 0.70', () => {
    const el = [j('n19', { action_button: 1.0 }, 0.96, 0.85, 0.02), j('n18', { action_button: 0.75, advertising: 0.25 }, 0.65, 0.33, 0.02)];
    expect(verdictOf(understanding(el, { n19: 0.93, n26: 0.05, none: 0.02 }), 'n19').verdict).toBe('promote');
    expect(verdictOf(understanding(el, { n19: 0.84, n26: 0.13, none: 0.03 }), 'n19').verdict).toBe('protect');
    const weak = [j('n19', { action_button: 1.0 }, 0.96, 0.66, 0.02)];
    expect(verdictOf(understanding(weak, { n19: 0.95, none: 0.05 }), 'n19').verdict).toBe('protect');
  });

  it('never promotes an off-site link, and none >= 0.60 promotes nothing', () => {
    const el = [j('n26', { action_button: 0.95, advertising: 0.05 }, 0.9, 0.9, 0.01)];
    expect(verdictOf(understanding(el, { n26: 0.95, none: 0.05 }), 'n26').verdict).not.toBe('promote');
    const el2 = [j('n19', { action_button: 1.0 }, 0.96, 0.9, 0.02)];
    const u = understanding(el2, { none: 0.6, n19: 0.4 });
    expect(summarizeDecisions(decideElements(u, digest, NO_LOCAL)).mainId).toBeNull();
  });

  it('sums duplicate-label links before the threshold and promotes the best member', () => {
    const dup: PageDigest = {
      ...digest,
      elements: [
        { ...digest.elements[19]!, id: 'd1', label: 'Report an Outage', link_target: 'this website' },
        { ...digest.elements[19]!, id: 'd2', label: 'Report an outage', link_target: 'this website' },
        { ...digest.elements[19]!, id: 'd3', label: 'Report an Outage!', link_target: 'this website' },
      ],
    };
    const el = [
      j('d1', { action_button: 0.9, navigation: 0.1 }, 0.9, 0.72, 0.05),
      j('d2', { action_button: 0.9, navigation: 0.1 }, 0.9, 0.81, 0.05),
      j('d3', { action_button: 0.9, navigation: 0.1 }, 0.9, 0.6, 0.05),
    ];
    const u = understanding(el, { d1: 0.48, d2: 0.24, d3: 0.22, none: 0.06 });
    const d = decideElements(u, dup, NO_LOCAL);
    expect(d.find((x) => x.verdict === 'promote')?.id).toBe('d2');
    expect(d.find((x) => x.id === 'd2')!.reasons[0]).toContain('0.94');
  });

  it('leaves unanswered elements alone (fail closed) and summarizes', () => {
    const u = understanding([j('n22', { advertising: 0.99, other: 0.01 }, 0.01, 0.01, 0.01), j('n20', { help_contact: 1 }, 0.1, 0.02, 0.94)]);
    const d = decideElements(u, digest, { ...NO_LOCAL, consentIds: ['n23'] });
    expect(d).toHaveLength(digest.elements.length);
    expect(d.find((x) => x.id === 'n1')!.verdict).toBe('keep');
    expect(d.find((x) => x.id === 'n23')!.verdict).toBe('protect');
    expect(summarizeDecisions(d)).toEqual({ folded: 1, protected: 2, mainId: null });
  });
});
