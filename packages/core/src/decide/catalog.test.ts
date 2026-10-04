import { describe, expect, it } from 'vitest';

import type { JevChoiceQuestion, JevNoulQuestion } from '../jev/api';
import {
  PAGE_CATEGORIES,
  REGION_ROLES,
  type RegionEvidence,
} from '../page/types';
import {
  evidence,
  workedExampleEvidence,
  workedExamplePage,
} from '../policy/fixtures';
import { CATALOG_VERSION, JEV_PINNED_MODEL } from '../versions';
import {
  buildQuestions,
  canonicalEvidence,
  estimateTokens,
  MAIN_PICK_NONE,
  MAX_REQUEST_TOKENS,
  PAGE_TYPE_CRITERIA,
  regionPriority,
  ROLE_CRITERIA,
  TASK_CRITERIA,
  toDecideResponse,
} from './catalog';
import { mockJevAnswer } from './mock';
import {
  decideRequestSchema,
  decideResponseSchema,
  type DecideRequest,
} from './wire';

const EVIDENCE_KEYS = [
  'zone',
  'width',
  'height',
  'pinned',
  'landmark',
  'tag',
  'dom_position',
  'links',
  'link_density',
  'text_amount',
  'buttons',
  'inputs',
  'required_fields',
  'repeated_cards',
  'images',
  'video',
  'iframe_kind',
  'motion',
  'class_words',
  'heading_words',
  'control_words',
];

function workedRequest(patch: Partial<DecideRequest> = {}): DecideRequest {
  return {
    v: 1,
    catalog: CATALOG_VERSION,
    lang: 'en',
    page: workedExamplePage(),
    regions: [{ rid: 'r4', ev: workedExampleEvidence() }],
    ask: { pageType: false },
    ...patch,
  };
}

/** A full request: 10 regions, page type and a 4-way main pick. */
function fullRequest(
  ev: (i: number) => RegionEvidence = () => workedExampleEvidence(),
): DecideRequest {
  return workedRequest({
    regions: Array.from({ length: 10 }, (_, i) => ({
      rid: `r${i}`,
      ev: ev(i),
    })),
    mainCandidates: [
      {
        cid: 'c1',
        ev: evidence({
          zone: 'center_column',
          landmark: 'main',
          text_amount: '>2k chars',
        }),
      },
      {
        cid: 'c2',
        ev: evidence({
          zone: 'full_width_mid',
          landmark: 'none',
          text_amount: '500-2k chars',
        }),
      },
      { cid: 'c3', ev: evidence({ zone: 'left_rail' }) },
      { cid: 'c4', ev: evidence({ zone: 'right_rail' }) },
    ],
    ask: { pageType: true },
  });
}

describe('buildQuestions: catalog wa-cat-1.0.0', () => {
  it('builds the worked example (ai-architecture.md 3.4) exactly', () => {
    const req = workedRequest();
    expect(decideRequestSchema.safeParse(req).success).toBe(true);
    const built = buildQuestions(req);
    expect(Object.keys(built.questions)).toEqual(['role_r4', 'task_r4']);
    expect(built.trimmed).toEqual([]);
    // Snapshot the exact JSON text so key order (part of the contract) is pinned too.
    expect(JSON.stringify(built, null, 2)).toMatchSnapshot();
  });

  it('puts page context in state with canonical key order and enum-ordered signals', () => {
    const page = workedExamplePage();
    page.signals = [
      'has_site_search',
      'og_type_article',
      'readerable',
      'og_type_article',
    ];
    const { state } = buildQuestions(workedRequest({ page }));
    const s = state as { page: Record<string, unknown> };
    expect(Object.keys(s)).toEqual(['page']);
    expect(Object.keys(s.page)).toEqual([
      'signals',
      'main',
      'counts',
      'layout',
    ]);
    expect(s.page.signals).toEqual([
      'og_type_article',
      'readerable',
      'has_site_search',
    ]);
    expect(Object.keys(s.page.counts as object)).toEqual([
      'regions',
      'links',
      'buttons',
      'text_inputs',
      'forms',
      'required_fields',
      'headings',
      'images',
      'videos',
      'text_amount',
    ]);
  });

  it('never lets client key order leak into the payload', () => {
    const ev = workedExampleEvidence();
    const shuffled = Object.fromEntries(
      Object.entries(ev).reverse(),
    ) as RegionEvidence;
    expect(JSON.stringify(canonicalEvidence(shuffled))).toBe(
      JSON.stringify(canonicalEvidence(ev)),
    );
    expect(Object.keys(canonicalEvidence(shuffled))).toEqual(EVIDENCE_KEYS);
  });

  it('asks role and task per region with the evidence inside structured instructions', () => {
    const built = buildQuestions(workedRequest());
    const role = built.questions.role_r4 as JevChoiceQuestion;
    const task = built.questions.task_r4 as JevNoulQuestion;
    expect(role.type).toBe('choice');
    expect(Object.keys(role.criteria)).toEqual([...REGION_ROLES]);
    const instructions = role.instructions as {
      question: string;
      region: Record<string, unknown>;
    };
    expect(instructions.question).toContain('`region`');
    expect(Object.keys(instructions.region)).toEqual(EVIDENCE_KEYS);
    for (const option of REGION_ROLES) {
      const c = role.criteria[option] as {
        what: string;
        not_for: string | null;
      };
      expect(typeof c.what).toBe('string');
      expect(c.not_for === null || typeof c.not_for === 'string').toBe(true);
    }
    expect(role.criteria.other).toEqual({
      what: ROLE_CRITERIA.other.what,
      not_for: null,
    });
    expect(task.type).toBe('noul');
    expect(task.criteria).toEqual({
      true: TASK_CRITERIA.true,
      false: TASK_CRITERIA.false,
    });
    expect((task.instructions as { region: unknown }).region).toEqual(
      instructions.region,
    );
  });

  it('adds page_type only when asked and main_pick only for 2-4 candidates', () => {
    expect(
      Object.keys(buildQuestions(workedRequest()).questions),
    ).not.toContain('page_type');
    const withType = buildQuestions(workedRequest({ ask: { pageType: true } }));
    const pageType = withType.questions.page_type as JevChoiceQuestion;
    expect(Object.keys(pageType.criteria)).toEqual([...PAGE_CATEGORIES]);
    expect(pageType.criteria.other).toEqual({
      what: PAGE_TYPE_CRITERIA.other.what,
      not_for: null,
    });

    const full = buildQuestions(fullRequest());
    const main = full.questions.main_pick as JevChoiceQuestion;
    expect(Object.keys(main.criteria)).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'none',
    ]);
    expect(main.criteria.none).toBe(MAIN_PICK_NONE);
    expect(Object.keys(full.questions)).toEqual([
      'page_type',
      ...Array.from({ length: 10 }, (_, i) => [
        `role_r${i}`,
        `task_r${i}`,
      ]).flat(),
      'main_pick',
    ]);
  });

  it('gives every Choice an escape option', () => {
    const full = buildQuestions(fullRequest());
    for (const q of Object.values(full.questions)) {
      if (q.type !== 'choice') continue;
      const options = Object.keys(q.criteria);
      expect(options.includes('other') || options.includes('none')).toBe(true);
    }
  });

  it('stays inside the per-question token caps (3.2.4)', () => {
    const full = buildQuestions(fullRequest());
    expect(estimateTokens(full.state)).toBeLessThanOrEqual(200);
    expect(estimateTokens(full.questions.page_type)).toBeLessThanOrEqual(450);
    expect(estimateTokens(full.questions.role_r0)).toBeLessThanOrEqual(850);
    expect(estimateTokens(full.questions.task_r0)).toBeLessThanOrEqual(300);
    expect(estimateTokens(full.questions.main_pick)).toBeLessThanOrEqual(
      700 + 250,
    );
    expect(full.estimatedTokens).toBeLessThanOrEqual(MAX_REQUEST_TOKENS);
    expect(full.trimmed).toEqual([]);
  });

  it('estimates tokens as characters / 3.3', () => {
    expect(estimateTokens('x'.repeat(31))).toBe(Math.ceil(33 / 3.3));
    const built = buildQuestions(workedRequest());
    const chars = JSON.stringify({
      model: JEV_PINNED_MODEL,
      state: built.state,
      questions: built.questions,
    }).length;
    expect(built.estimatedTokens).toBe(Math.ceil(chars / 3.3));
  });

  it('trims the lowest-priority regions above 12k tokens', () => {
    const long = Array.from(
      { length: 4 },
      () =>
        'personalization personalization personalization personalization personalization personalization',
    );
    const heavy = (i: number) =>
      evidence({
        control_words: long.map((w) => w.slice(0, 100)),
        heading_words:
          'recommendations recommendations recommendations recommendations recommendations recommendations',
        // r0 is pinned (high priority); r9 is a tiny bottom block (lowest priority).
        pinned: i === 0 ? 'fixed' : 'no',
        width: i === 9 ? '<15%' : i === 8 ? '15-30%' : '30-60%',
        height: i === 9 ? '<0.1 screens' : '0.3-1 screens',
        zone: i === 0 ? 'overlay_top' : 'full_width_mid',
      });
    const req = fullRequest(heavy);
    const built = buildQuestions(req);
    expect(built.trimmed.length).toBeGreaterThan(0);
    expect(built.trimmed[0]).toBe('r9');
    expect(built.trimmed).not.toContain('r0');
    expect(built.estimatedTokens).toBeLessThanOrEqual(MAX_REQUEST_TOKENS);
    for (const rid of built.trimmed) {
      expect(built.questions[`role_${rid}`]).toBeUndefined();
      expect(built.questions[`task_${rid}`]).toBeUndefined();
    }
  });

  it('ranks region priority by estimated viewport area x relevance', () => {
    const rail = regionPriority(
      evidence({
        zone: 'right_rail',
        width: '15-30%',
        height: '1-3 screens',
        pinned: 'no',
      }),
    );
    const mid = regionPriority(
      evidence({
        zone: 'full_width_mid',
        width: '15-30%',
        height: '1-3 screens',
        pinned: 'no',
      }),
    );
    const pinned = regionPriority(
      evidence({
        zone: 'full_width_mid',
        width: '15-30%',
        height: '1-3 screens',
        pinned: 'fixed',
      }),
    );
    expect(rail).toBeCloseTo(mid * 1.5);
    expect(pinned).toBeCloseTo(mid * 2);
  });

  it('drops duplicate region ids', () => {
    const built = buildQuestions(
      workedRequest({
        regions: [
          { rid: 'r1', ev: workedExampleEvidence() },
          { rid: 'r1', ev: evidence({ zone: 'left_rail' }) },
        ],
      }),
    );
    expect(Object.keys(built.questions)).toEqual(['role_r1', 'task_r1']);
  });
});

describe('toDecideResponse', () => {
  it('compacts a Jev answer into a schema-valid wire response with probabilities only', () => {
    const req = fullRequest();
    const built = buildQuestions(req);
    const jev = mockJevAnswer({
      model: JEV_PINNED_MODEL,
      state: built.state,
      questions: built.questions,
    });
    const res = toDecideResponse(built, jev, { jev: 95, edge: 130 });
    expect(decideResponseSchema.safeParse(res).success).toBe(true);
    expect(res.catalog).toBe(CATALOG_VERSION);
    expect(res.model).toBe(JEV_PINNED_MODEL);
    expect(Object.keys(res.regions)).toHaveLength(10);
    expect(Object.keys(res.regions.r0!.role)).toEqual([...REGION_ROLES]);
    expect(res.pageType).toBeDefined();
    expect(Object.keys(res.mainPick!)).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'none',
    ]);
    expect(JSON.stringify(res)).not.toContain('confidence');
    expect(JSON.stringify(res)).not.toContain('"choice"');
    expect(res.inputTokens).toBe(jev.usage.input_tokens);
  });

  it('fills main-pick options that were not asked with 0 so the record is complete', () => {
    const req = workedRequest({
      mainCandidates: [
        {
          cid: 'c1',
          ev: evidence({
            zone: 'center_column',
            landmark: 'main',
            text_amount: '>2k chars',
          }),
        },
        { cid: 'c2', ev: evidence({ zone: 'left_rail' }) },
      ],
    });
    const built = buildQuestions(req);
    const jev = mockJevAnswer({
      model: JEV_PINNED_MODEL,
      state: built.state,
      questions: built.questions,
    });
    const res = toDecideResponse(built, jev, { jev: 1, edge: 2 });
    expect(res.mainPick!.c3).toBe(0);
    expect(res.mainPick!.c4).toBe(0);
    expect(res.pageType).toBeUndefined();
    expect(decideResponseSchema.safeParse(res).success).toBe(true);
  });

  it('leaves out regions whose answers are missing', () => {
    const built = buildQuestions(workedRequest());
    const jev = mockJevAnswer({
      model: JEV_PINNED_MODEL,
      state: built.state,
      questions: built.questions,
    });
    delete jev.answers.task_r4;
    const res = toDecideResponse(built, jev, { jev: 1, edge: 2 });
    expect(res.regions).toEqual({});
  });
});
