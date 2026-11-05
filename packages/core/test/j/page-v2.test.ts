// Round 7 package J: Jev page model v2 (fine roles, importance, purpose, main region). No network.
import { describe, expect, it } from 'vitest';
import type { ElementEvidence, FineRole, PageDigest, Role } from '../../src/types';
import {
  DISTRACTION_ROLES, FINE_CRITERIA, FINE_FAMILY, FINE_ROLES, fineGuide, MAIN_PICK_ID, PAGE_PURPOSES, PURPOSE_CRITERIA, PURPOSE_ID,
  Q_REGION, REGION_FWD_ID, REGION_NONE_OPTION, REGION_REV_ID, buildPageCalls, coarseFromFine, combineRegionPicks,
  parsePageAnswers, regionsOf, structureSummary,
} from '../../src/jev/page';
import { emptyJevMetrics } from '../../src/jev/api';
import type { JevAnswer, JevQuestion } from '../../src/jev/api';
import { ALDERRA, choice, noul, response, score } from '../a1/fixtures';

const ALL_FINE: FineRole[] = [
  // round 7 (60)
  'page_title', 'headline', 'dek_summary', 'body_text', 'byline', 'dateline', 'lead_image', 'figure', 'caption', 'quote',
  'key_fact', 'stat_value', 'stat_label', 'scoreboard', 'team_or_org_logo', 'data_table', 'table_row', 'chart',
  'schedule_item', 'standings', 'price', 'rating', 'comparison_row', 'ingredient_list', 'instruction_steps',
  'recipe_meta', 'form_field', 'primary_action', 'secondary_action', 'step_indicator', 'search_box', 'filter_sort',
  'result_item', 'status_message', 'site_logo', 'site_nav', 'section_nav', 'breadcrumb', 'tabs', 'pagination',
  'back_link', 'jump_link', 'help_link', 'contact_info', 'warning_notice', 'consent_notice', 'popup', 'advertising',
  'sponsored', 'upsell_promo', 'newsletter_signup', 'teaser_other_content', 'social_share', 'comments', 'video_autoplay',
  'carousel', 'account_utility', 'legal_footer', 'decorative', 'other',
  // round 8 (65)
  'subheading', 'author_bio', 'last_updated', 'read_time', 'gallery', 'video_player', 'map_embed', 'pull_quote',
  'correction_notice', 'breaking_banner', 'live_badge', 'discount_badge', 'player_card', 'play_by_play', 'ticker',
  'product_title', 'product_image', 'product_card', 'product_options', 'shipping_returns', 'review_item', 'cart_item',
  'order_summary', 'countdown_timer', 'stock_warning', 'account_balance', 'transaction_row', 'course_module',
  'lesson_content', 'feature_list', 'faq_item', 'person_profile', 'due_date', 'grade_score', 'food_menu_item',
  'prescription_item', 'opening_hours', 'address', 'phone_number', 'date_picker', 'file_upload', 'choice_group',
  'dropdown_select', 'password_field', 'payment_field', 'terms_consent', 'captcha', 'quiz_question', 'appointment_slot',
  'add_to_cart', 'accordion_item', 'progress_bar', 'error_message', 'success_message', 'skip_link', 'table_of_contents',
  'tag_list', 'chat_widget', 'login_prompt', 'ad_disclosure', 'app_install_banner', 'paywall_prompt', 'betting_odds',
  'related_links', 'testimonial',
];

function region(id: string, label: string, extra: Partial<ElementEvidence> = {}): ElementEvidence {
  return {
    id, tag: 'div', role_hint: 'region', label, zone: 'full_width_mid', landmark: 'main', size: '1278 x 741 px',
    position: 'upper middle', fixed: false, class_words: ['opponent', 'history'], visual_weight: 'high', text_chars: 390, ...extra,
  };
}

/** The Kentucky opponent-history page, shaped like the reader's round-7 digest (structure only). */
const GATORS: PageDigest = {
  v: 'digest.1',
  page: {
    title: 'Football History vs University of Kentucky', url_path: '/sports/football/opponent-history/university-of-kentucky/32',
    headings: ['Opponent History', 'Related Videos', 'Related News'], landmarks: ['banner', 'navigation', 'main', 'contentinfo'],
    viewport: 'desktop, 1440 x 900', element_count: 201,
  },
  elements: [
    { ...region('n100', 'Opponent History'), tag: 'h1', role_hint: 'heading level 1', size: '233 x 30 px', text_chars: 20 },
    { ...region('n9003', 'Last Matchup 7 at 38 · Full Boxscore / Recap'), id: 'n9003' }, // also a region: judged once
    { ...region('n510', 'SEC Nation set for Florida-Georgia Game'), tag: 'a', role_hint: 'link', link_target: 'this website', size: '276 x 48 px' },
  ],
  mainCandidates: ['n510'],
  hasSensitiveFields: false,
  lang: 'en',
  regions: [
    region('n9002', 'Opponent History · Back To History', { size: '1344 x 93 px', position: 'top center' }),
    region('n9003', 'Last Matchup 7 at 38 · Full Boxscore / Recap'),
    region('n9004', 'DATE SEASON LOCATION SCORE MEDIA · Links / Links', { tag: 'table', role_hint: 'table', size: '1276 x 2894 px' }),
    region('n9006', 'Related News · All News / SEC Nation set for…', { size: '1344 x 487 px', position: 'lower middle, below the first screen' }),
  ],
};

describe('fine roles', () => {
  it('cover every FineRole once, with criteria for each and the escape last', () => {
    expect([...FINE_ROLES].sort()).toEqual([...ALL_FINE].sort());
    expect(new Set(FINE_ROLES).size).toBe(FINE_ROLES.length);
    expect(FINE_ROLES[FINE_ROLES.length - 1]).toBe('other');
    expect(Object.keys(FINE_CRITERIA)).toEqual([...FINE_ROLES]);
    expect(Object.keys(FINE_FAMILY).sort()).toEqual([...ALL_FINE].sort());
    for (const d of DISTRACTION_ROLES) expect(FINE_ROLES).toContain(d);
  });

  it('has about 125 roles, with live_badge among them', () => {
    expect(FINE_ROLES.length).toBe(125);
    expect(FINE_ROLES).toContain('live_badge');
    expect(FINE_FAMILY.live_badge).toBe('main_content'); // protected: never folded or dimmed
  });

  it('keeps the role guide to a size one call carries once (about 3,000 tokens), never once per element', () => {
    expect(JSON.stringify(fineGuide()).length).toBeLessThan(13_000);
    expect(Object.keys(fineGuide()).length).toBe(FINE_ROLES.length);
  });

  it('map content, data and recipe roles to main content, and distractions to the fold families', () => {
    const fam = (r: FineRole): Role => FINE_FAMILY[r];
    for (const r of ['stat_value', 'scoreboard', 'team_or_org_logo', 'data_table', 'ingredient_list', 'headline'] as FineRole[]) expect(fam(r)).toBe('main_content');
    expect(fam('teaser_other_content')).toBe('recommendations');
    expect(fam('carousel')).toBe('recommendations');
    for (const r of ['advertising', 'sponsored', 'upsell_promo', 'newsletter_signup'] as FineRole[]) expect(fam(r)).toBe('advertising');
    expect(fam('site_logo')).toBe('navigation');
    expect(fam('primary_action')).toBe('action_button');
    expect(fam('consent_notice')).toBe('consent_notice');
    expect(fam('popup')).toBe('popup_overlay');
  });

  it('sum fine probabilities into coarse role probabilities (unknown options ignored)', () => {
    expect(coarseFromFine({ teaser_other_content: 0.6, carousel: 0.3, body_text: 0.08, bogus: 0.02 })).toEqual({
      recommendations: 0.9, main_content: 0.08,
    });
  });
});

describe('page questions', () => {
  it('asks purpose once over every PagePurpose, and the main region in both option orders with none last', () => {
    const calls = buildPageCalls(GATORS);
    const page = calls[calls.length - 1]!;
    expect(page.elementIds).toEqual([]);
    expect(Object.keys(page.questions).sort()).toEqual([MAIN_PICK_ID, REGION_FWD_ID, REGION_REV_ID, PURPOSE_ID].sort());
    const purpose = page.questions[PURPOSE_ID] as Extract<JevQuestion, { type: 'choice' }>;
    expect(Object.keys(purpose.criteria)).toEqual([...PAGE_PURPOSES]);
    expect(Object.keys(PURPOSE_CRITERIA)).toEqual([...PAGE_PURPOSES]);
    expect((purpose.instructions as Record<string, unknown>).structure).toEqual(structureSummary(GATORS));
    const fwd = page.questions[REGION_FWD_ID] as Extract<JevQuestion, { type: 'choice' }>;
    const rev = page.questions[REGION_REV_ID] as Extract<JevQuestion, { type: 'choice' }>;
    expect(Object.keys(fwd.criteria)).toEqual(['n9002', 'n9003', 'n9004', 'n9006', 'none']);
    expect(Object.keys(rev.criteria)).toEqual(['n9006', 'n9004', 'n9003', 'n9002', 'none']);
    expect(fwd.criteria.none).toBe(REGION_NONE_OPTION);
    expect((fwd.criteria.n9003 as Record<string, unknown>).size).toBe('1278 x 741 px'); // full evidence per option
    expect((fwd.instructions as Record<string, unknown>).question).toBe(Q_REGION);
  });

  it('judges each region once (fine, task, help, importance; never main), as an element when it is one', () => {
    const calls = buildPageCalls(GATORS);
    const regionIds = calls.flatMap((c) => c.regionIds ?? []);
    expect(regionIds.sort()).toEqual(['n9002', 'n9004', 'n9006']);
    const all = Object.assign({}, ...calls.map((c) => c.questions)) as Record<string, JevQuestion>; // fine questions sit in the fine calls
    for (const id of regionIds) {
      for (const k of ['fine', 'task', 'help', 'importance']) expect(all[`${id}__${k}`], `${id}__${k}`).toBeDefined();
      expect(all[`${id}__main`]).toBeUndefined();
    }
    expect(all.n9003__fine).toBeDefined();
    expect(calls.flatMap((c) => c.elementIds)).toContain('n9003');
  });

  it('does not ask a read of a few new items (no candidates, no regions) the page questions again', () => {
    const partial = buildPageCalls({ ...GATORS, mainCandidates: [], regions: undefined });
    expect(partial.flatMap((c) => Object.keys(c.questions))).not.toContain(PURPOSE_ID);
  });

  it('leaves out page questions on request and region questions when there are no regions', () => {
    expect(buildPageCalls(GATORS, { pageQuestions: false }).some((c) => PURPOSE_ID in c.questions)).toBe(false);
    const noRegions = buildPageCalls({ ...GATORS, regions: undefined });
    const keys = noRegions.flatMap((c) => Object.keys(c.questions));
    expect(keys).toContain(PURPOSE_ID);
    expect(keys).not.toContain(REGION_FWD_ID);
  });

  it('summarises structure from the digest only (counts, short region labels, class words)', () => {
    const s = structureSummary(GATORS);
    expect(s).toMatchObject({ elements_read: 3, headings: 1, links: 1, has_sensitive_fields: false });
    expect(s.regions).toHaveLength(4);
    expect((s.regions as string[])[1]).toBe('region, full_width_mid, 1278 x 741 px, 390 characters of text: Last Matchup 7 at 38 · Full Boxscore / Recap');
    expect(s.common_class_words).toEqual(['history']); // class words pass the interface-word filter
  });

  it('caps regions and drops duplicates and `none`', () => {
    const many = Array.from({ length: 20 }, (_, i) => region(`n${800 + i}`, `Block ${i}`));
    expect(regionsOf({ ...GATORS, regions: [...many, many[0]!, region('none', 'x')] })).toHaveLength(14);
  });
});

describe('main region from both orders', () => {
  const known = new Set(['n9002', 'n9003', 'n9004']);
  it('accepts a region only when both orders give it 0.80 or more (p is the lower one)', () => {
    const m = combineRegionPicks({ choice: 'n9003', probs: { n9003: 0.91, n9002: 0.06, none: 0.03 } }, { choice: 'n9003', probs: { n9003: 0.86, n9004: 0.1, none: 0.04 } }, known)!;
    expect(m.id).toBe('n9003');
    expect(m.p).toBe(0.86);
    expect(m.probs.n9003).toBeCloseTo(0.885, 4);
  });
  it('reports disagreement as a low p', () => {
    const m = combineRegionPicks({ choice: 'n9004', probs: { n9004: 0.79, n9003: 0.15 } }, { choice: 'n9003', probs: { n9003: 0.6, n9004: 0.35 } }, known)!;
    expect(m.id).toBe('n9004');
    expect(m.p).toBe(0.35);
  });
  it('is not confirmed with one order missing, and unknown ids become none', () => {
    expect(combineRegionPicks({ choice: 'n9003', probs: { n9003: 0.99 } }, null, known)!.p).toBe(0);
    expect(combineRegionPicks({ choice: 'n77', probs: { n77: 0.99 } }, { choice: 'n77', probs: { n77: 0.99 } }, known)!.id).toBe('none');
    expect(combineRegionPicks(null, null, known)).toBeUndefined();
  });
});

describe('parsePageAnswers v2', () => {
  function answerAll(digest: PageDigest, fine: Record<string, Record<string, number>>, page: Record<string, JevAnswer>) {
    const calls = buildPageCalls(digest);
    const responses = calls.map((c) => {
      const a: Record<string, JevAnswer> = {};
      for (const q of Object.keys(c.questions)) {
        const [id, kind] = q.split('__') as [string, string];
        if (kind === 'fine') a[q] = choice(fine[id] ?? { other: 1 });
        else if (kind === 'task') a[q] = noul(0.5);
        else if (kind === 'help') a[q] = noul(0.02);
        else if (kind === 'importance') a[q] = score(fine[id]?.teaser_other_content ? 1 : 3.8, 5);
        else if (kind === 'main') a[q] = noul(0.03);
      }
      for (const [k, v] of Object.entries(page)) if (k in c.questions) a[k] = v;
      return response(a, 1000);
    });
    return parsePageAnswers(digest, calls, responses, emptyJevMetrics());
  }

  it('fills fine, fineP, importance, purpose and mainRegion, and judges regions with main 0', () => {
    const u = answerAll(
      GATORS,
      { n9003: { scoreboard: 0.73, stat_value: 0.2, data_table: 0.07 }, n9006: { teaser_other_content: 0.92, carousel: 0.06, site_nav: 0.02 }, n510: { teaser_other_content: 0.87, upsell_promo: 0.13 } },
      {
        [PURPOSE_ID]: choice({ record_stats: 0.99, schedule: 0.01 }),
        [REGION_FWD_ID]: choice({ n9003: 0.91, n9002: 0.06, none: 0.03 }),
        [REGION_REV_ID]: choice({ n9003: 0.86, n9004: 0.1, none: 0.04 }),
        [MAIN_PICK_ID]: choice({ none: 0.9, n510: 0.1 }),
      },
    );
    expect(u.purpose).toEqual({ kind: 'record_stats', p: 0.99, probs: { record_stats: 0.99, schedule: 0.01 } });
    expect(u.mainRegion).toMatchObject({ id: 'n9003', p: 0.86 });
    const sb = u.elements.find((e) => e.id === 'n9003')!;
    expect(sb).toMatchObject({ fine: 'scoreboard', fineP: 0.73, role: 'main_content', roleP: 1, importance: 3.8 });
    const teaser = u.elements.find((e) => e.id === 'n9006')!;
    expect(teaser).toMatchObject({ fine: 'teaser_other_content', role: 'recommendations', main: 0, importance: 1 });
    expect(teaser.roleP).toBeCloseTo(0.98, 6);
    expect(u.elements.find((e) => e.id === 'n510')!).toMatchObject({ fine: 'teaser_other_content', role: 'recommendations' });
    expect(u.elements.map((e) => e.id).sort()).toEqual(['n100', 'n510', 'n9002', 'n9003', 'n9004', 'n9006']);
  });

  it('maps an unknown purpose to other and leaves importance unset when its Score is missing', () => {
    const calls = buildPageCalls(ALDERRA);
    const responses = calls.map((c) => {
      const a: Record<string, JevAnswer> = {};
      for (const q of Object.keys(c.questions)) {
        const [id, kind] = q.split('__') as [string, string];
        if (kind === 'fine') a[q] = choice({ form_field: 1 });
        else if (kind === 'task') a[q] = noul(0.9);
        else if (kind === 'help') a[q] = noul(0.01);
        else if (kind === 'main') a[q] = noul(0.1);
      }
      if (PURPOSE_ID in c.questions) a[PURPOSE_ID] = { type: 'choice', choice: 'banana', probabilities: { banana: 0.7, form_task: 0.3 }, confidence: 0.7 };
      return response(a, 1000);
    });
    const u = parsePageAnswers(ALDERRA, calls, responses, emptyJevMetrics());
    expect(u.purpose).toMatchObject({ kind: 'other', p: 0 });
    expect(u.elements).toHaveLength(ALDERRA.elements.length);
    expect(u.elements[0]!.importance).toBeUndefined();
  });
});
