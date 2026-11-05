// Owner: L. Pure parts of the Jev Lens: display classes, placement, scrim, plain rule.
import { describe, expect, it } from 'vitest';
import { decideElements } from '@webable/core';
import type { ElementEvidence, ElementJudgment, PageDigest, PageUnderstanding, Role } from '@webable/core';
import { fineChipFace, lensItems, mergedChip } from './display';
import { chipBudget, overlaps, placeChips, scrimPath, type PlaceItem } from './place';
import { compareRule, plainRule } from './rule';
import {
  FINE_FAMILY, FINE_WORDS, fineRoleBars, hasPageRead, importanceScore, importanceWeight, mainRegionPick,
  purposeBars, purposeLine, settledFine,
} from './words';
import type { FineRole, PagePurpose } from '@webable/core';

function ev(id: string, over: Partial<ElementEvidence> = {}): ElementEvidence {
  return {
    id, tag: 'button', role_hint: 'button', label: id, zone: 'center_column', landmark: 'main', size: '100 x 40 px',
    position: 'middle', fixed: false, class_words: [], visual_weight: 'medium', ...over,
  };
}
function jd(id: string, role: Role, roleP: number, probs: Partial<Record<Role, number>>, task = 0.5, main = 0.1, help = 0.01): ElementJudgment {
  return { id, role, roleP, roleProbs: { [role]: roleP, ...probs }, task, main, help };
}

const digest: PageDigest = {
  v: 'digest.1',
  page: { title: 'Refill', url_path: '/refill', headings: [], landmarks: ['main'], viewport: 'desktop, 1280 x 720', element_count: 6 },
  elements: [
    ev('n1', { label: 'Confirm refill', size: '104 x 28 px', class_words: ['btn', 'confirm'] }),
    ev('n2', { label: 'Continue shopping', size: '210 x 48 px', class_words: ['btn', 'continue'], visual_weight: 'high' }),
    ev('n3', { tag: 'div', role_hint: 'region', label: 'Sponsored GlucoBoost', class_words: ['ad', 'slot'], size: '300 x 250 px' }),
    ev('n4', { tag: 'a', role_hint: 'link', label: 'Call your pharmacist', size: '160 x 20 px' }),
    ev('n5', { tag: 'div', role_hint: 'dialog', label: 'We value your privacy', class_words: ['cookie', 'banner'], zone: 'overlay_bottom', fixed: true, size: '1280 x 200 px' }),
    ev('n6', { tag: 'div', role_hint: 'region', label: 'Flu shot offer', class_words: ['hero'], size: '900 x 300 px' }),
  ],
  mainCandidates: ['n1', 'n2'],
  hasSensitiveFields: false,
  lang: 'en',
};

const u: PageUnderstanding = {
  elements: [
    jd('n1', 'action_button', 0.97, {}, 0.95, 0.99, 0.01),
    jd('n2', 'action_button', 0.6, { navigation: 0.3 }, 0.1, 0.05, 0.01),
    jd('n3', 'advertising', 0.98, {}, 0.02, 0, 0.01),
    jd('n4', 'help_contact', 0.99, {}, 0.2, 0, 0.99),
    jd('n5', 'consent_notice', 0.97, {}, 0.05, 0, 0.02),
    jd('n6', 'advertising', 0.7, { recommendations: 0.04 }, 0.1, 0, 0.02),
  ],
  mainPick: { id: 'n1', p: 0.95, probs: { n1: 0.95, n2: 0.03, none: 0.02 } },
  metrics: { model: 'jev-1.14.0', calls: 1, questions: 25, inputTokens: 9000, wallMs: 300, serverMs: 200, costUsd: 0.0004 },
  cached: false,
};

const decisions = decideElements(u, digest, { focusedIds: [], requiredIds: [], filledIds: [], consentIds: ['n5'], offsiteIds: [] });

describe('display classes', () => {
  const items = lensItems(digest, decisions, u);
  const by = new Map(items.map((i) => [i.id, i]));
  it('shows the number the policy acted on', () => {
    expect(by.get('n1')!.cls).toBe('main');
    expect(by.get('n1')!.num).toBe('0.95');
    expect(by.get('n3')!.cls).toBe('folded');
    expect(by.get('n3')!.chip).toBe('Folded · ad');
    expect(by.get('n3')!.num).toBe('0.98');
    expect(by.get('n4')!.cls).toBe('guarded');
    expect(by.get('n4')!.chip).toBe('Help');
    expect(by.get('n5')!.cls).toBe('guarded');
    expect(by.get('n5')!.num).toBe('rule');
    expect(by.get('n6')!.cls).toBe('unsure');
    expect(by.get('n6')!.num).toBe('0.74');
    expect(by.get('n2')!.cls).toBe('kept');
  });
  it('explains with the policy thresholds', () => {
    expect(by.get('n3')!.because).toEqual(['ads 0.98 ≥ 0.90', 'task 0.02 ≤ 0.20', 'help 0.01 ≤ 0.10']);
    expect(by.get('n6')!.because.join(' · ')).toContain('not sure: left alone');
  });
  it('merges chips with ranges', () => {
    const a = by.get('n3')!;
    const b = { ...a, id: 'x', p: 0.96 };
    expect(mergedChip([a, b])).toEqual({ words: '2 folded ·', num: '0.96–0.98' });
  });
  it('treats unanswered elements as pending, then kept when answers lack them', () => {
    expect(lensItems(digest, [], null).every((i) => i.cls === 'pending')).toBe(true);
  });
  it('keeps the v2 chip when round-7 fields are missing', () => {
    for (const it of items) {
      expect(it.fine).toBeNull();
      expect(it.fineP).toBeNull();
      expect(it.fineName).toBeNull();
      expect(it.family).toBeNull();
      expect(it.importance).toBeNull();
      expect(it.weight).toBeNull();
    }
    expect(hasPageRead(u)).toBe(false);
    expect(purposeLine(u.purpose)).toBeNull();
    expect(mainRegionPick(u.mainRegion)).toBeNull();
    expect(purposeBars(undefined)).toEqual([]);
  });
});

describe('round-7 page read', () => {
  const purposes: PagePurpose[] = [
    'record_stats', 'scoreboard', 'schedule', 'standings', 'roster', 'article', 'news_index', 'recipe',
    'product', 'search_results', 'form_task', 'checkout', 'sign_in', 'account_dashboard', 'bill_statement',
    'appointment', 'status_lookup', 'info_guide', 'faq', 'directory_listing', 'location_hours', 'calendar_dates',
    'comparison', 'video', 'gallery', 'home_portal', 'other',
  ];
  it('says what kind of page Jev read, in plain words', () => {
    const line = purposeLine({ kind: 'record_stats', p: 0.97, probs: { record_stats: 0.97 } });
    expect(line?.sentence).toBe('Jev read this as a record and stats page (0.97)');
    expect(line?.spoken).toContain("Jev's probability 0.97");
    expect(line?.name).toBe('record and stats page');
    for (const kind of purposes) {
      const row = purposeLine({ kind, p: 0.5, probs: { [kind]: 0.5 } });
      expect(row?.sentence.startsWith('Jev read this as ')).toBe(true);
      expect(row?.sentence.toLowerCase()).not.toContain('confidence');
      expect(row?.sentence.toLowerCase()).not.toContain('chance');
    }
  });
  it('drops the header line when the purpose is missing or empty', () => {
    expect(purposeLine(undefined)).toBeNull();
    expect(purposeLine({ kind: 'record_stats', p: Number.NaN, probs: {} })).toBeNull();
    expect(hasPageRead({ ...u, purpose: undefined, mainRegion: undefined })).toBe(false);
  });
  it('lists the top 5 kinds and the main region with its runner-up', () => {
    const purpose = {
      kind: 'record_stats' as const,
      p: 0.97,
      probs: { record_stats: 0.97, article: 0.01, schedule: 0.008, news_index: 0.005, scoreboard: 0.004, other: 0.002, recipe: 0.001 },
    };
    expect(purposeBars(purpose).map((b) => b.id)).toEqual(['record_stats', 'article', 'schedule', 'news_index', 'scoreboard']);
    expect(purposeBars(purpose)[0]?.name).toBe('Record and stats page');
    const region = mainRegionPick({ id: 'n3', p: 0.92, probs: { n3: 0.92, n11: 0.05, none: 0.03 } });
    expect(region).toEqual({ id: 'n3', p: 0.92, runnerUp: { id: 'n11', p: 0.05 } });
    expect(mainRegionPick({ id: 'none', p: 0, probs: {} })).toBeNull();
    expect(hasPageRead({ ...u, purpose, mainRegion: { id: 'n3', p: 0.92, probs: { n3: 0.92, n11: 0.05 } } })).toBe(true);
  });
  it('names fine roles and colours them by family', () => {
    expect(FINE_WORDS.scoreboard).toBe('Scoreboard');
    expect(FINE_WORDS.team_or_org_logo).toBe('Team logo');
    expect(FINE_WORDS.teaser_other_content).toBe('Teaser for other stories');
    expect(FINE_WORDS.advertising).toBe('Ad');
    expect(FINE_FAMILY.scoreboard).toBe('data');
    expect(FINE_FAMILY.team_or_org_logo).toBe('data');
    expect(FINE_FAMILY.advertising).toBe('distraction');
    expect(FINE_FAMILY.teaser_other_content).toBe('distraction');
    expect(FINE_FAMILY.primary_action).toBe('task');
    expect(FINE_FAMILY.site_nav).toBe('navigation');
    expect(FINE_FAMILY.help_link).toBe('help');
    expect(FINE_FAMILY.page_title).toBe('content');
    const roles = Object.keys(FINE_WORDS) as FineRole[];
    for (const role of roles) expect(FINE_FAMILY[role]).toBeTruthy();
  });
  it('maps importance onto outline weight and ignores scores outside 0 to 4', () => {
    expect(importanceScore(4)).toBe(4);
    expect(importanceScore(0)).toBe(0);
    expect(importanceWeight(4)).toBe('solid');
    expect(importanceWeight(3)).toBe('solid');
    expect(importanceWeight(2)).toBe('hair');
    expect(importanceWeight(1)).toBe('hair');
    expect(importanceWeight(0)).toBe('dashed');
    expect(importanceScore(undefined)).toBeNull();
    expect(importanceScore(5)).toBeNull();
    expect(importanceScore(Number.NaN)).toBeNull();
  });
  it('shows one fine-role bar, or the top 5 when a distribution is present', () => {
    const one = fineRoleBars({ id: 'n8', role: 'main_content', roleP: 0.9, roleProbs: { main_content: 0.9 }, task: 0.8, main: 0.1, help: 0, fine: 'scoreboard', fineP: 0.91 });
    expect(one.map((b) => [b.name, b.p, b.family])).toEqual([['Scoreboard', 0.91, 'data']]);
    const many = fineRoleBars({
      id: 'n8', role: 'main_content', roleP: 0.9, roleProbs: {}, task: 0.8, main: 0.1, help: 0, fine: 'scoreboard', fineP: 0.91,
      fineProbs: { scoreboard: 0.91, data_table: 0.04, stat_value: 0.03, chart: 0.01, key_fact: 0.006, other: 0.004 },
    } as ElementJudgment);
    expect(many.map((b) => b.role)).toEqual(['scoreboard', 'data_table', 'stat_value', 'chart', 'key_fact']);
    expect(fineRoleBars({ id: 'x', role: 'other', roleP: 0, roleProbs: {}, task: 0, main: 0, help: 0 })).toEqual([]);
  });
  it('keeps the policy chip and adds the fine role when both are present', () => {
    const rich = {
      ...u,
      elements: u.elements.map((j) => j.id === 'n3'
        ? { ...j, fine: 'advertising' as const, fineP: 0.91, importance: 0 }
        : j.id === 'n1'
          ? { ...j, fine: 'primary_action' as const, fineP: 0.88, importance: 4 }
          : j),
      purpose: { kind: 'form_task' as const, p: 0.8, probs: { form_task: 0.8, other: 0.2 } },
      mainRegion: { id: 'n6', p: 0.7, probs: { n6: 0.7, n3: 0.2 } },
    };
    const local = { focusedIds: [], requiredIds: [], filledIds: [], consentIds: ['n5'], offsiteIds: [] };
    const old = new Map(lensItems(digest, decideElements(u, digest, local), u).map((i) => [i.id, i]));
    const next = lensItems(digest, decideElements(rich, digest, local), rich);
    const byId = new Map(next.map((i) => [i.id, i]));
    const ad = byId.get('n3')!;
    const oldAd = old.get('n3')!;
    expect(ad.cls).toBe(oldAd.cls);
    expect(ad.chip).toBe(oldAd.chip);
    expect(ad.num).toBe(oldAd.num);
    expect(ad.fineName).toBe('Ad');
    expect(ad.family).toBe('distraction');
    expect(ad.weight).toBe('dashed');
    expect(fineChipFace([ad])).toEqual({ words: 'Ad', num: '0.91' });
    const main = byId.get('n1')!;
    expect(main.cls).toBe('main');
    expect(main.chip).toBe('Main action');
    expect(main.num).toBe('0.95');
    expect(main.weight).toBe('solid');
    expect(settledFine(byId.get('n2')!.j).fine).toBeNull();
    expect(byId.get('n2')!.weight).toBeNull();
  });
});

describe('placement', () => {
  const size = () => ({ w: 120, h: 22 });
  it('never overlaps chips and respects reserved areas', () => {
    const items: PlaceItem[] = [];
    for (let i = 0; i < 30; i++) {
      items.push({ id: `e${i}`, cls: i % 3 === 0 ? 'folded' : 'guarded', box: { x: 40 + (i % 6) * 200, y: 80 + Math.floor(i / 6) * 120, w: 150, h: 40 }, priority: 30 + i / 100 });
    }
    items.push({ id: 'main', cls: 'main', box: { x: 600, y: 400, w: 104, h: 28 }, priority: 61 });
    const reserved = [{ x: 0, y: 0, w: 1280, h: 60 }];
    const res = placeChips(items, { vw: 1280, vh: 720, reserved, budget: 12, prev: new Map(), size, mergePx: 0 });
    expect(res.chips.length).toBeLessThanOrEqual(12);
    expect(res.chips.some((c) => c.cls === 'main')).toBe(true);
    for (let i = 0; i < res.chips.length; i++) {
      const a = res.chips[i]!;
      for (const r of reserved) expect(overlaps(a, r)).toBe(false);
      for (let k = i + 1; k < res.chips.length; k++) expect(overlaps(a, res.chips[k]!)).toBe(false);
    }
    expect(res.listed.length + res.chips.reduce((n, c) => n + c.ids.length, 0)).toBe(items.length);
  });
  it('merges same-class neighbours within 48 px', () => {
    const items: PlaceItem[] = [
      { id: 'a', cls: 'folded', box: { x: 100, y: 100, w: 100, h: 50 }, priority: 40.9 },
      { id: 'b', cls: 'folded', box: { x: 230, y: 100, w: 100, h: 50 }, priority: 40.95 },
      { id: 'c', cls: 'guarded', box: { x: 360, y: 100, w: 100, h: 50 }, priority: 30.9 },
    ];
    const res = placeChips(items, { vw: 1280, vh: 720, reserved: [], budget: 12, prev: new Map(), size });
    const folded = res.chips.find((c) => c.cls === 'folded')!;
    expect(folded.ids.sort()).toEqual(['a', 'b']);
  });
  it('keeps the page label when the budget is full and does not let it overlap', () => {
    const items: PlaceItem[] = [];
    for (let i = 0; i < 20; i++) {
      items.push({ id: `e${i}`, cls: 'fine:stat_value', box: { x: 16 + (i % 5) * 70, y: 16 + Math.floor(i / 5) * 48, w: 60, h: 36 }, priority: 46 });
    }
    items.push({ id: 'page:r', cls: 'page', box: { x: 40, y: 80, w: 280, h: 140 }, priority: 80, forced: true });
    const res = placeChips(items, { vw: 420, vh: 320, reserved: [], budget: 4, prev: new Map(), size: () => ({ w: 180, h: 28 }) });
    const page = res.chips.find((c) => c.cls === 'page');
    expect(page).toBeTruthy();
    expect(res.chips.filter((c) => c.cls === 'page')).toHaveLength(1);
    for (const c of res.chips) {
      if (c === page) continue;
      expect(overlaps(page!, c)).toBe(false);
    }
  });
  it('budget is 12 at 1280 x 720 and clamps to 6..14', () => {
    expect(chipBudget(1280, 720)).toBe(12);
    expect(chipBudget(640, 400)).toBe(6);
    expect(chipBudget(2560, 1440)).toBe(14);
  });
});

describe('scrim', () => {
  it('cuts disjoint holes: a folded child stays dim inside a lit parent', () => {
    const d = scrimPath(100, 100, [
      { r: { x: 10, y: 10, w: 80, h: 80 }, lit: true },
      { r: { x: 40, y: 40, w: 20, h: 20 }, lit: false },
    ]);
    const holes = d.split('M').length - 2;
    expect(holes).toBeGreaterThanOrEqual(3);
    expect(d.startsWith('M0 0H100V100H0Z')).toBe(true);
  });
  it('is just the outer rect when nothing is lit', () => {
    expect(scrimPath(50, 50, [{ r: { x: 0, y: 0, w: 10, h: 10 }, lit: false }])).toBe('M0 0H50V50H0Z');
  });
});

describe('plain rule', () => {
  it('picks the largest heavy main-area button and folds by keyword', () => {
    const r = plainRule(digest);
    expect(r.mainId).toBe('n2');
    expect(r.foldIds.sort()).toEqual(['n3', 'n5']);
    expect(r.helpIds).toEqual(['n4']);
  });
  it('says where it differs, never "wrong"', () => {
    const items = lensItems(digest, decisions, u);
    const d = compareRule(plainRule(digest), items);
    expect(d.agrees).toBe(false);
    expect(d.lines[0]).toBe('Main: rule → Continue shopping (210×48); Jev → Confirm refill 0.95.');
    expect(d.lines.join(' ')).toContain('Folded: rule 2, Jev 1, both 1.');
    expect(d.lines.join(' ').toLowerCase()).not.toContain('wrong');
  });
});
