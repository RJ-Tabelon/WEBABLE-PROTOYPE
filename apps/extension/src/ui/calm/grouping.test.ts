// @vitest-environment happy-dom
// Round 10: which parts of the WebAble page are laid out. Only the running text of open reading or plain parts of an
// article or an ordinary page, in page order; never forms, card grids, link grids, help, menus, alerts or the drawer.
import { afterEach, describe, expect, it } from 'vitest';
import { newCtx, readBlocks } from './model';
import type { CalmPlan, PlanSection } from './plan';
import { planGroups } from './grouping';

afterEach(() => {
  document.body.innerHTML = '';
});

const words = (n: number, w: string): string => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

function part(key: string, layout: PlanSection['layout'], role: PlanSection['sec']['role'], w: string, extra: Partial<PlanSection> = {}): PlanSection {
  const main = document.createElement('main');
  main.innerHTML = `<p>${words(40, w)}.</p>`;
  document.body.append(main);
  return {
    key, index: 0, sec: { role, layout } as PlanSection['sec'], layout, label: 'Overview', title: `Title ${key}`, titleSize: 'section',
    state: 'open', hoist: false, notice: null, lead: false, isPrimary: false, blocks: readBlocks(main, newCtx()), records: null,
    before: [], after: [], parts: null, steps: null, count: 0, showFirst: 0, cards: null, ...extra,
  };
}

function plan(main: PlanSection[], extra: Partial<CalmPlan> = {}): CalmPlan {
  return { kind: 'article', main, form: null, lead: null, ...extra } as unknown as CalmPlan;
}

describe('the parts the WebAble page lays out', () => {
  it('takes reading and plain parts in page order, with their titles as headings', () => {
    const p = plan([part('s0', 'reading', 'primary', 'body'), part('s1', 'as_is', 'supporting', 'more')]);
    const { groups, segments } = planGroups(p);
    expect(groups.map((g) => g.heading)).toEqual(['Title s0', 'Title s1']);
    expect([...segments.keys()]).toEqual(['s0', 's1']);
  });

  it('leaves out forms, collections, help, menus, alerts, closed parts and pages that are not for reading', () => {
    const skipped = [
      part('a', 'card_grid', 'related', 'cards'),
      part('b', 'link_grid', 'navigation', 'links'),
      part('c', 'as_is', 'help', 'help'),
      part('d', 'reading', 'alert', 'alert'),
      part('e', 'reading', 'primary', 'closed', { state: 'collapsed' }),
      part('f', 'as_is', 'primary', 'form'),
      part('g', 'as_is', 'supporting', 'records', { records: [] }),
    ];
    expect(planGroups(plan(skipped, { form: { sectionKey: 'f' } as CalmPlan['form'] })).groups).toEqual([]);
    for (const kind of ['index', 'form', 'product', 'portal'] as const) {
      expect(planGroups(plan([part('s', 'reading', 'primary', kind)], { kind })).groups).toEqual([]);
    }
    expect(planGroups(null).groups).toEqual([]);
  });
});
