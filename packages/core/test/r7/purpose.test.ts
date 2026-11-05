// Package P (round 7): the meaning-first Calm planner. The fixture is the shape of floridagators.com's Kentucky opponent
// history page (Caden's 9.webp / 10.webp): a record (Wins 54, Losses 22, Home 30-6, Away 22-13), the last matchup's
// scoreboard with both logos and a line score, the 80-row history table, and a "Related News" rail whose first card is
// the "SEC Nation set for Florida-Georgia Game" teaser that Calm view used to lead with.
import { describe, expect, test } from 'vitest';
import { DEMO_FITS, summarizeFitForModel } from '../../src/fit/derive';
import { heuristicSpec } from '../../src/layout/heuristic';
import { indexOutline, outlineProtection } from '../../src/layout/outline';
import {
  DRAWER_FINE, applyMeaning, leadWords, localMeaningVerdict, meaningPasses, meaningRequest, readMeaning, templateFor, usableData,
  type PageMeaning,
} from '../../src/layout/purpose';
import { specCoverage } from '../../src/layout/spec';
import type {
  ElementJudgment, ExtractedData, FineRole, FitSpec, OutlineNode, PageOutline, PageUnderstanding,
} from '../../src/types';

const ROSA = summarizeFitForModel(DEMO_FITS.rosa);

type N = Omit<OutlineNode, 'id' | 'parent'> & { id: number; parent?: number };
const outline = (nodes: N[]): PageOutline => ({
  v: 'outline.1',
  nodes: nodes.map(({ id, parent, ...n }) => ({ ...n, id: `n${id}`, ...(parent ? { parent: `n${parent}` } : {}) })),
});

const STATS: ExtractedData = {
  kind: 'stats', title: 'Football History vs University of Kentucky',
  items: [{ label: 'Wins', value: '54' }, { label: 'Losses', value: '22' }, { label: 'Home Record', value: '30-6' }, { label: 'Away Record', value: '22-13' }],
};
const BOARD: ExtractedData = {
  kind: 'scoreboard', label: 'Last Matchup', date: '11/8/2025', joiner: 'at',
  sides: [
    { name: 'Florida', score: '7', logoSrc: 'https://floridagators.com/images/logos/florida.png', side: 'away' },
    { name: 'Kentucky', score: '38', logoSrc: 'https://floridagators.com/images/logos/kentucky.png', side: 'home' },
  ],
  periods: { labels: ['1', '2', '3', '4', 'F'], rows: [{ name: 'Florida', values: ['7', '0', '0', '0', '7'] }, { name: 'Kentucky', values: ['10', '14', '7', '7', '38'] }] },
};
const LINE: ExtractedData = { kind: 'table', columns: ['', '1', '2', '3', '4', 'F'], rows: [['Florida', '7', '0', '0', '0', '7'], ['Kentucky', '10', '14', '7', '7', '38']] };
const HISTORY: ExtractedData = {
  kind: 'table', columns: ['Date', 'Location', 'Result', 'Score'],
  rows: [['11/8/2025', 'Lexington, Ky.', 'L', '7-38'], ['11/9/2024', 'Gainesville, Fla.', 'W', '48-20'], ['9/30/2023', 'Lexington, Ky.', 'L', '14-33']],
};
const HEADER_STRIP: ExtractedData = {
  kind: 'schedule', items: [{ date: 'Oct 10', title: 'vs South Carolina', result: '19-38' }, { date: 'Oct 17', title: 'at Texas', result: '27-24' }],
};

/** The Gators page, as the reader outlines it (labels are allowlisted words, '·' elsewhere). */
const GATORS = outline([
  { id: 1, kind: 'region', label: '· Slider', zone: 'header_band', landmark: 'banner' },
  { id: 2, parent: 1, kind: 'list', label: '', shape: 'cards x 8', zone: 'header_band', landmark: 'banner', data: HEADER_STRIP },
  { id: 3, parent: 1, kind: 'image', label: '· Logo', zone: 'header_band', landmark: 'banner' },
  { id: 10, kind: 'region', label: '· History · History · of · from', zone: 'full_width_mid', landmark: 'main' },
  { id: 11, parent: 10, kind: 'heading', level: 1, label: '· History · History · of · from', zone: 'full_width_mid', landmark: 'main' },
  { id: 12, parent: 10, kind: 'link', label: 'Back To History', zone: 'full_width_mid', landmark: 'main' },
  { id: 13, parent: 10, kind: 'region', label: '', zone: 'center_column', landmark: 'main', data: STATS },
  { id: 14, parent: 13, kind: 'text', label: '', shape: 'count', zone: 'left_rail', landmark: 'main' },
  { id: 15, parent: 13, kind: 'text', label: '', shape: 'count', zone: 'center_column', landmark: 'main' },
  { id: 20, parent: 10, kind: 'region', label: '', zone: 'center_column', landmark: 'main', data: BOARD },
  { id: 21, parent: 20, kind: 'image', label: 'Team Logo', zone: 'right_rail', landmark: 'main' },
  { id: 22, parent: 20, kind: 'image', label: '· Logo', zone: 'right_rail', landmark: 'main' },
  { id: 23, parent: 20, kind: 'table', label: '', shape: 'table 3 x 6', zone: 'center_column', landmark: 'main', data: LINE },
  { id: 24, parent: 20, kind: 'link', label: 'Full · for game on [date]', zone: 'right_rail', landmark: 'main' },
  { id: 30, parent: 10, kind: 'table', label: '', shape: 'table 80 x 5', zone: 'full_width_mid', landmark: 'main', data: HISTORY },
  { id: 40, parent: 10, kind: 'region', label: 'Related News', zone: 'full_width_mid', landmark: 'main' },
  { id: 41, parent: 40, kind: 'heading', level: 2, label: 'Related News', zone: 'full_width_mid', landmark: 'main' },
  { id: 42, parent: 40, kind: 'list', label: '', shape: 'cards x 4', zone: 'full_width_mid', landmark: 'main' },
  { id: 43, parent: 42, kind: 'link', label: '· set for · Game · set for', zone: 'left_rail', landmark: 'main' },
  { id: 44, parent: 42, kind: 'image', label: '', zone: 'left_rail', landmark: 'main' },
  { id: 50, kind: 'region', label: '· footer', zone: 'footer_band', landmark: 'contentinfo' },
  { id: 51, parent: 50, kind: 'link', label: 'Privacy Policy opens in new tab', zone: 'footer_band', landmark: 'contentinfo' },
]);

function jd(id: string, fine: FineRole, importance: number, fineP = 0.9): ElementJudgment {
  return { id, role: 'main_content', roleP: 0.8, roleProbs: { main_content: 0.8 }, task: 0.5, main: 0.1, help: 0.01, fine, fineP, importance };
}

const GATORS_U: Pick<PageUnderstanding, 'purpose' | 'mainRegion' | 'elements'> = {
  purpose: { kind: 'record_stats', p: 0.96, probs: { record_stats: 0.96, news_index: 0.02 } },
  // The record and the last matchup: a digest region (not an outline node), its members worked out on the page.
  mainRegion: { id: 'n90', p: 0.93, probs: { n90: 0.93, none: 0.03 } },
  elements: [
    jd('n11', 'page_title', 3), jd('n14', 'stat_value', 4), jd('n15', 'stat_value', 4), jd('n21', 'team_or_org_logo', 3),
    jd('n22', 'team_or_org_logo', 3), jd('n23', 'scoreboard', 4), jd('n24', 'secondary_action', 2), jd('n30', 'data_table', 3),
    jd('n42', 'teaser_other_content', 0), jd('n43', 'teaser_other_content', 0), jd('n3', 'site_logo', 1), jd('n51', 'legal_footer', 0),
  ],
};
const MEMBERS = ['n13', 'n14', 'n15', 'n20', 'n21', 'n22', 'n23', 'n24'];

const gatorsMeaning = (): PageMeaning => readMeaning({ outline: GATORS, understanding: GATORS_U, mainMembers: MEMBERS });

describe('reading what the page is for', () => {
  test('the Gators page is a record: scoreboard, then the record, then the history table', () => {
    const m = gatorsMeaning();
    expect(m.template).toBe('record_stats');
    expect(m.purpose).toBe('record_stats');
    expect(m.mainRegion).toEqual({ id: 'n90', p: 0.93 });
    expect(m.data.map((d) => [d.id, d.data.kind])).toEqual([['n20', 'scoreboard'], ['n13', 'stats'], ['n30', 'table']]);
    expect(m.lead.why).toBe('main_region');
    expect(m.lead.ids).toEqual(['n13', 'n20']);
  });

  test('the line score inside the scoreboard and the header strip of recent games are not drawn on their own', () => {
    const ids = gatorsMeaning().data.map((d) => d.id);
    expect(ids).not.toContain('n23');
    expect(ids).not.toContain('n2');
  });

  test('the "SEC Nation" teaser goes to the drawer and both team logos are kept', () => {
    const m = gatorsMeaning();
    expect(m.drawer).toEqual(expect.arrayContaining(['n42', 'n43']));
    expect(m.logos).toEqual(expect.arrayContaining(['n21', 'n22']));
    expect(m.logos).not.toContain('n3');
  });

  test('a main region Jev is unsure of is not acted on: the most important content leads instead', () => {
    const m = readMeaning({ outline: GATORS, understanding: { ...GATORS_U, mainRegion: { id: 'n90', p: 0.62, probs: {} } }, mainMembers: MEMBERS });
    expect(m.mainRegion).toBeNull();
    expect(m.lead.why).toBe('importance');
    expect(m.lead.ids).toEqual(expect.arrayContaining(['n14', 'n15', 'n23']));
    expect(m.lead.ids.some((id) => DRAWER_FINE.has(m.fine[id] as FineRole))).toBe(false);
  });

  test('without Jev the content read on the device still picks the template', () => {
    const m = readMeaning({ outline: GATORS, understanding: null });
    expect(m.template).toBe('record_stats');
    expect(m.lead.why).toBe('none');
    expect(m.data[0]!.data.kind).toBe('scoreboard');
  });

  test('templates need their content and a sure purpose', () => {
    expect(templateFor('recipe', 0.9, new Set())).toBe('page');
    expect(templateFor('other', 0.86, new Set(['recipe']))).toBe('recipe'); // Jev unsure what a recipe page is: the card decides
    expect(templateFor('article', 0.75, new Set(['recipe', 'table']))).toBe('recipe');
    expect(templateFor('checkout', 0.9, new Set(['recipe']))).toBe('form_task');
    expect(templateFor('recipe', 0.9, new Set(['recipe']))).toBe('recipe');
    expect(templateFor('record_stats', 0.4, new Set(['stats']))).toBe('record_stats'); // unsure purpose: data decides
    expect(templateFor('article', 0.4, new Set())).toBe('page');
    expect(templateFor('status_lookup', 0.8, new Set())).toBe('status_lookup');
    expect(templateFor('checkout', 0.8, new Set())).toBe('form_task');
    expect(templateFor('info_guide', 0.9, new Set(['stats']))).toBe('page');
  });

  test('extracted content too thin to draw is ignored', () => {
    expect(usableData({ kind: 'stats', items: [{ label: 'Wins', value: '54' }] })).toBe(false);
    expect(usableData({ kind: 'scoreboard', sides: [{ name: 'Florida', score: '7' }] })).toBe(false);
    expect(usableData(STATS)).toBe(true);
    expect(usableData(BOARD)).toBe(true);
  });

  test('plain words for the ledger', () => {
    expect(leadWords(gatorsMeaning())).toBe('the scoreboard and the record');
  });
});

/** The old Calm plan for this page: one open section in page order with the teaser rail inside, as Caden saw it. */
const OLD_SPEC: FitSpec = {
  page_type: 'other', task: 'other', strip: [], primary_action: null, form_steps: [], density: 'airy',
  sections: [
    { heading_ref: 'n41', label: 'Related items', role: 'supporting', nodes: ['n40'], layout: 'card_grid', emphasis: 'lead', state: 'open', why: 'reference_info', show_first: 0 },
    { heading_ref: 'n11', label: 'Overview', role: 'primary', nodes: ['n11', 'n12', 'n13', 'n20', 'n30'], layout: 'as_is', emphasis: 'normal', state: 'open', why: 'main_task', show_first: 0 },
    { heading_ref: null, label: 'Navigation', role: 'navigation', nodes: ['n1'], layout: 'chip_bar', emphasis: 'quiet', state: 'collapsed', why: 'navigation', show_first: 0 },
    { heading_ref: null, label: 'Site links', role: 'navigation', nodes: ['n50'], layout: 'link_grid', emphasis: 'quiet', state: 'end_drawer', why: 'navigation', show_first: 0 },
  ],
};

describe('the Calm spec, meaning first', () => {
  const withFine: PageOutline = {
    ...GATORS,
    nodes: GATORS.nodes.map((n) => (n.id === 'n40' ? { ...n, fine: 'teaser_other_content' as FineRole } : n)),
  };

  test('the teaser rail goes to the end drawer and the record and scoreboard lead', () => {
    const m = readMeaning({ outline: withFine, understanding: GATORS_U, mainMembers: MEMBERS });
    const { spec, notes } = applyMeaning(OLD_SPEC, withFine, m);
    const first = spec.sections.find((s) => s.state === 'open' && s.role !== 'navigation')!;
    expect(first.nodes).toEqual(expect.arrayContaining(['n13', 'n20']));
    expect(first.emphasis).toBe('lead');
    const drawer = spec.sections.find((s) => s.nodes.includes('n40'))!;
    expect(drawer.state).toBe('end_drawer');
    expect(drawer.label).toBe('Related items');
    expect(notes.length).toBeGreaterThan(0);
    // Nothing is dropped.
    expect(specCoverage(spec, withFine).coverage).toBe(specCoverage(OLD_SPEC, withFine).coverage);
  });

  test('main information folded away is brought back out, open, first', () => {
    const folded: FitSpec = {
      ...OLD_SPEC,
      sections: [
        { ...OLD_SPEC.sections[1]!, nodes: ['n11', 'n12', 'n30'] },
        { heading_ref: null, label: 'More on this page', role: 'other', nodes: ['n13', 'n20', 'n40'], layout: 'row_list', emphasis: 'quiet', state: 'end_drawer', why: 'not_needed_for_task', show_first: 0 },
      ],
    };
    const m = gatorsMeaning();
    const { spec } = applyMeaning(folded, GATORS, m);
    const lead = spec.sections.find((s) => s.nodes.includes('n13'))!;
    expect(lead.state).toBe('open');
    expect(spec.sections.indexOf(lead)).toBe(0);
    expect(spec.sections.find((s) => s.nodes.includes('n40'))!.state).toBe('end_drawer');
  });

  test('content Jev rates important never stays folded; chrome and teasers do', () => {
    const o = outline([
      { id: 1, kind: 'heading', level: 1, label: 'Best · Cookies', zone: 'center_column', landmark: 'main' },
      { id: 2, kind: 'text', label: '', shape: 'paragraph x3', zone: 'center_column', landmark: 'main' },
      { id: 3, kind: 'list', label: '', shape: 'list x 4', zone: 'center_column', landmark: 'main' },
      { id: 4, kind: 'region', label: '·', zone: 'right_rail', landmark: 'main' },
    ]);
    const u: Pick<PageUnderstanding, 'purpose' | 'mainRegion' | 'elements'> = {
      purpose: { kind: 'recipe', p: 0.97, probs: {} }, mainRegion: { id: 'none', p: 0.9, probs: {} },
      elements: [jd('n1', 'page_title', 3.8), jd('n2', 'body_text', 3.4), jd('n3', 'instruction_steps', 3.9), jd('n4', 'teaser_other_content', 0.3)],
    };
    const spec: FitSpec = {
      page_type: 'article', task: 'read', strip: [], primary_action: null, form_steps: [], density: 'airy',
      sections: [
        { heading_ref: 'n1', label: 'Overview', role: 'orient', nodes: ['n1'], layout: 'hero', emphasis: 'normal', state: 'open', why: 'main_task', show_first: 0 },
        { heading_ref: null, label: 'More on this page', role: 'other', nodes: ['n2', 'n3', 'n4'], layout: 'row_list', emphasis: 'quiet', state: 'end_drawer', why: 'not_needed_for_task', show_first: 0 },
      ],
    };
    const out = applyMeaning(spec, o, readMeaning({ outline: o, understanding: u })).spec;
    const open = out.sections.filter((x) => x.state === 'open').flatMap((x) => x.nodes);
    expect(open).toEqual(expect.arrayContaining(['n1', 'n2', 'n3']));
    expect(open).not.toContain('n4');
    expect(out.sections.find((x) => x.nodes.includes('n4'))?.state).toBe('end_drawer');
  });

  test('help, fields and the primary action never move to the drawer', () => {
    const o = outline([
      { id: 1, kind: 'region', label: 'Offers', zone: 'center_column', landmark: 'main', fine: 'upsell_promo' },
      { id: 2, parent: 1, kind: 'link', label: 'Call your pharmacist', zone: 'center_column', landmark: 'main', jevRole: 'help_contact' },
      { id: 3, kind: 'button', label: 'Confirm refill', zone: 'center_column', landmark: 'main', fine: 'upsell_promo' },
    ]);
    const spec: FitSpec = {
      page_type: 'form', task: 'fill_form', strip: [], primary_action: 'n3', form_steps: [], density: 'airy',
      sections: [{ heading_ref: null, label: 'Overview', role: 'primary', nodes: ['n1', 'n3'], layout: 'as_is', emphasis: 'lead', state: 'open', why: 'main_task', show_first: 0 }],
    };
    expect(outlineProtection(indexOutline(o), 'n2')).toBe('help');
    const out = applyMeaning(spec, o, readMeaning({ outline: o })).spec;
    expect(out.sections[0]!.nodes).toEqual(['n1', 'n3']);
  });
});

describe('the meaning check asks about structure only', () => {
  const m = gatorsMeaning();
  const good = applyMeaning(OLD_SPEC, GATORS, m).spec;

  test('the request carries fine roles only: no labels, page text or numbers', () => {
    const req = meaningRequest(good, GATORS, m);
    const json = JSON.stringify(req);
    expect(json).not.toMatch(/\d/);
    for (const word of ['Wins', 'Florida', 'Kentucky', 'SEC', 'History', 'Logo', '·']) expect(json).not.toContain(word);
    expect(req.purpose).toBe('record_stats');
    // The history table is outside the main region (the record and the last matchup): drawn after, not required.
    expect(req.original.mustKeep).toEqual(expect.arrayContaining(['scoreboard', 'stat_value', 'team_or_org_logo']));
    // The title band, then the scoreboard with its logos and the record, as Calm view draws them.
    expect(req.calm.leadRoles.slice(0, 4)).toEqual(['page_title', 'scoreboard', 'team_or_org_logo', 'stat_value']);
  });

  test('a teaser inside an open part is folded by Calm view, so it is not "shown"', () => {
    const req = meaningRequest(good, GATORS, m);
    expect(req.calm.shownRoles).not.toContain('teaser_other_content');
    expect(req.calm.foldedRoles).toContain('teaser_other_content');
  });

  test('a plan that leads with the record passes on the device', () => {
    const v = localMeaningVerdict(meaningRequest(good, GATORS, m));
    expect(v.pass).toBe(true);
    expect(meaningPasses(v)).toBe(true);
  });

  test('the old plan (teaser first, record and logos gone) fails', () => {
    const old = localMeaningVerdict({
      purpose: 'record_stats',
      original: { mainRegion: 'main region: stat_value, scoreboard', leadRoles: ['scoreboard', 'stat_value'], mustKeep: ['scoreboard', 'stat_value', 'team_or_org_logo'] },
      calm: { leadRoles: ['page_title', 'teaser_other_content', 'lead_image'], shownRoles: ['page_title', 'teaser_other_content'], foldedRoles: ['stat_value'] },
    });
    expect(old.pass).toBe(false);
    expect(old.leadsWithMain).toBeLessThan(0.8);
    expect(old.missingMain).toBeGreaterThan(0.2);
  });
});

describe('the heuristic layout reads fine roles', () => {
  test('a teaser rail Jev named goes to the end drawer, never the lead', () => {
    // An unnamed rail (no "Related" in its label): only Jev's fine role says it is a teaser.
    const o: PageOutline = {
      ...GATORS,
      nodes: GATORS.nodes.map((n) => (n.id === 'n42' ? { ...n, fine: 'teaser_other_content' as FineRole } : n.id === 'n40' || n.id === 'n41' ? { ...n, label: '·' } : n)),
    };
    const spec = heuristicSpec(o, {}, ROSA);
    const ix = indexOutline(o);
    const where = spec.sections.find((s) => s.nodes.some((id) => id === 'n42' || ix.isAncestor(id, 'n42')));
    expect(where?.state).toBe('end_drawer');
    const before = heuristicSpec({ ...o, nodes: o.nodes.map((n) => ({ ...n, fine: undefined })) }, {}, ROSA);
    expect(before.sections.find((s) => s.nodes.some((id) => id === 'n42' || ix.isAncestor(id, 'n42')))?.state).toBe('open');
  });

  test('a recipe called "Best Chocolate Chip Cookies" is not a cookie banner', () => {
    const o = outline([
      { id: 1, kind: 'region', label: 'Best · Cookies', zone: 'full_width_mid', landmark: 'main' },
      { id: 2, parent: 1, kind: 'heading', level: 1, label: 'Best · Cookies', zone: 'center_column', landmark: 'main' },
      { id: 3, parent: 1, kind: 'list', label: '', shape: 'list x 9', zone: 'center_column', landmark: 'main' },
      { id: 4, kind: 'region', label: 'Cookie settings', zone: 'overlay_bottom' },
      { id: 5, parent: 4, kind: 'button', label: 'Accept all', zone: 'overlay_bottom' },
    ]);
    const ix = indexOutline(o);
    expect(outlineProtection(ix, 'n1')).not.toBe('consent');
    expect(outlineProtection(ix, 'n4')).toBe('consent');
    const spec = heuristicSpec(o, {}, ROSA);
    expect(spec.sections.find((s) => s.nodes.includes('n1'))?.role).not.toBe('consent');
  });

  test('a team logo stays with its scoreboard, not in the top bar', () => {
    const o: PageOutline = { ...GATORS, nodes: GATORS.nodes.map((n) => (n.id === 'n21' ? { ...n, fine: 'team_or_org_logo' as FineRole } : n)) };
    const spec = heuristicSpec(o, {}, ROSA);
    const nav = spec.sections.filter((s) => s.role === 'navigation').flatMap((s) => s.nodes);
    expect(nav).not.toContain('n21');
  });
});
