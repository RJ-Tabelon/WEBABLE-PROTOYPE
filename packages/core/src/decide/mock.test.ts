import { describe, expect, it } from 'vitest';

import type {
  JevChoiceAnswer,
  JevNoulAnswer,
  JevQuestion,
  JevRequest,
} from '../jev/api';
import { checkJevShape } from '../jev/client';
import type { RegionEvidence, RegionRole } from '../page/types';
import {
  articleSignals,
  evidence,
  workedExampleEvidence,
  workedExamplePage,
} from '../policy/fixtures';
import { CATALOG_VERSION, JEV_PINNED_MODEL } from '../versions';
import { buildQuestions, toDecideResponse } from './catalog';
import {
  createMockJevFetch,
  mockJevAnswer,
  quantizeDistribution,
} from './mock';
import { verdictsFromAnswers } from './verdict';
import type { DecideRequest } from './wire';

function requestFor(
  regions: DecideRequest['regions'],
  extra: Partial<DecideRequest> = {},
): JevRequest {
  const built = buildQuestions({
    v: 1,
    catalog: CATALOG_VERSION,
    lang: 'en',
    page: workedExamplePage(),
    regions,
    ask: { pageType: false },
    ...extra,
  });
  return {
    model: JEV_PINNED_MODEL,
    state: built.state,
    questions: built.questions,
  };
}

function roleOf(rev: Parameters<typeof evidence>[0]): {
  top: RegionRole;
  answer: JevChoiceAnswer;
  task: number;
} {
  const res = mockJevAnswer(requestFor([{ rid: 'r1', ev: evidence(rev) }]));
  const answer = res.answers.role_r1 as JevChoiceAnswer;
  return {
    top: answer.choice as RegionRole,
    answer,
    task: (res.answers.task_r1 as JevNoulAnswer).noul,
  };
}

const blank: Partial<RegionEvidence> = {
  class_words: [],
  heading_words: '',
  control_words: [],
  repeated_cards: '0',
  link_density: 'low',
  landmark: 'none',
  tag: 'div',
  dom_position: 'unknown',
};

describe('mockJevAnswer shape', () => {
  it('matches the real API: argmax choice, derived confidence, 0.01 probabilities summing to 1', () => {
    const req = requestFor([{ rid: 'r4', ev: workedExampleEvidence() }], {
      ask: { pageType: true },
    });
    const res = mockJevAnswer(req);
    expect(res.model).toBe(JEV_PINNED_MODEL);
    expect(res.usage.input_tokens).toBeGreaterThan(0);
    expect(res.usage.output_tokens).toBeGreaterThan(0);
    expect(Object.keys(res.answers)).toEqual(Object.keys(req.questions));
    expect(checkJevShape(req.questions, res)).toBeNull();
    for (const answer of Object.values(res.answers)) {
      if (answer.type !== 'choice') continue;
      const probs = Object.values(answer.probabilities);
      const sum = probs.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      for (const p of probs)
        expect(Math.round(p * 100)).toBeCloseTo(p * 100, 9);
      const max = Math.max(...probs);
      expect(answer.probabilities[answer.choice]).toBe(max);
      const n = probs.length;
      expect(answer.confidence).toBeCloseTo(
        Math.round(((n * max - 1) / (n - 1)) * 100) / 100,
        9,
      );
    }
    const task = res.answers.task_r4 as JevNoulAnswer;
    expect(Object.keys(task)).toEqual(['type', 'noul']);
  });

  it('is deterministic', () => {
    const req = requestFor([{ rid: 'r4', ev: workedExampleEvidence() }], {
      ask: { pageType: true },
    });
    expect(mockJevAnswer(req)).toEqual(mockJevAnswer(structuredClone(req)));
  });

  it('reports the resolved model it is told to (for drift tests)', () => {
    const req = requestFor([{ rid: 'r4', ev: workedExampleEvidence() }]);
    expect(mockJevAnswer(req, { model: 'jev-1.14.0' }).model).toBe(
      'jev-1.14.0',
    );
  });

  it('quantises with largest remainders', () => {
    expect(quantizeDistribution([1 / 3, 1 / 3, 1 / 3])).toEqual([
      0.34, 0.33, 0.33,
    ]);
    expect(
      quantizeDistribution([0.996, 0.002, 0.002]).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(1, 9);
  });

  it('answers Score and unknown questions in the documented shape', () => {
    const questions: Record<string, JevQuestion> = {
      s: {
        type: 'score',
        instructions: 'How busy?',
        criteria: ['calm', 'busy', 'very busy'],
      },
      c: {
        type: 'choice',
        instructions: 'Pick',
        criteria: { a: null, b: null, other: null },
      },
      n: { type: 'noul', instructions: 'Is it?' },
    };
    const res = mockJevAnswer({ model: 'jev-latest', state: 'x', questions });
    expect(checkJevShape(questions, res)).toBeNull();
    const s = res.answers.s!;
    expect(s.type).toBe('score');
    if (s.type === 'score') {
      expect(s.legend).toEqual({ 0: 'calm', 1: 'busy', 2: 'very busy' });
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(2);
    }
  });
});

describe('mockJevAnswer evidence response', () => {
  it('reads the worked example as a clear recommendations rail (3.4)', () => {
    const res = mockJevAnswer(
      requestFor([{ rid: 'r4', ev: workedExampleEvidence() }]),
    );
    const role = res.answers.role_r4 as JevChoiceAnswer;
    expect(role.choice).toBe('recommendations');
    expect((res.answers.task_r4 as JevNoulAnswer).noul).toBeLessThanOrEqual(
      0.1,
    );
    const wire = toDecideResponse(
      buildQuestions({
        v: 1,
        catalog: CATALOG_VERSION,
        lang: 'en',
        page: workedExamplePage(),
        regions: [{ rid: 'r4', ev: workedExampleEvidence() }],
        ask: { pageType: false },
      }),
      res,
      { jev: 1, edge: 1 },
    );
    const signals = articleSignals({}, []);
    const verdicts = verdictsFromAnswers(
      wire,
      { r4: 'k-rail' },
      signals,
      'article',
      undefined,
      { 'k-rail': workedExampleEvidence() },
    );
    expect(verdicts['k-rail']).toMatchObject({
      label: 'clear',
      protected: false,
      role: 'recommendations',
    });
  });

  it.each<[string, Parameters<typeof evidence>[0], RegionRole]>([
    [
      'sponsored class words',
      { ...blank, class_words: ['sponsored', 'ad'], zone: 'right_rail' },
      'promo_ad',
    ],
    [
      'an ad-network iframe',
      { ...blank, tag: 'iframe', iframe_kind: 'ad_network', width: '15-30%' },
      'promo_ad',
    ],
    [
      'a cookie notice',
      {
        ...blank,
        zone: 'overlay_bottom',
        pinned: 'fixed',
        class_words: ['cookie', 'consent'],
        control_words: ['accept all', 'manage preferences'],
      },
      'consent_banner',
    ],
    [
      'a chat launcher',
      {
        ...blank,
        zone: 'overlay_corner',
        pinned: 'fixed',
        class_words: ['chat', 'launcher'],
      },
      'chat_widget',
    ],
    [
      'a chat vendor iframe',
      {
        ...blank,
        zone: 'overlay_corner',
        pinned: 'fixed',
        tag: 'iframe',
        iframe_kind: 'chat_vendor',
      },
      'chat_widget',
    ],
    [
      'a navigation landmark',
      {
        ...blank,
        landmark: 'navigation',
        tag: 'nav',
        zone: 'header_band',
        link_density: 'high',
      },
      'navigation',
    ],
    [
      'the site footer',
      {
        ...blank,
        landmark: 'contentinfo',
        tag: 'footer',
        zone: 'footer_band',
        class_words: ['footer'],
        heading_words: 'copyright',
      },
      'footer',
    ],
    [
      'a help block',
      {
        ...blank,
        zone: 'right_rail',
        heading_words: 'help and support',
        control_words: ['contact us', 'faq'],
      },
      'help_contact',
    ],
    [
      'the article body',
      {
        ...blank,
        landmark: 'main',
        tag: 'article',
        zone: 'center_column',
        text_amount: '>2k chars',
        dom_position: 'inside_main',
      },
      'main_content',
    ],
    [
      'a checkout form',
      {
        ...blank,
        landmark: 'form',
        tag: 'form',
        zone: 'center_column',
        inputs: '4-10',
        required_fields: true,
        control_words: ['submit'],
      },
      'form',
    ],
  ])('classifies %s', (_name, ev, expected) => {
    expect(roleOf(ev).top).toBe(expected);
  });

  it('says task-critical blocks are needed and ads are not', () => {
    expect(
      roleOf({
        ...blank,
        landmark: 'form',
        required_fields: true,
        inputs: '4-10',
      }).task,
    ).toBeGreaterThanOrEqual(0.8);
    expect(
      roleOf({
        ...blank,
        landmark: 'navigation',
        class_words: ['filters', 'sort'],
      }).task,
    ).toBeGreaterThanOrEqual(0.2);
    expect(
      roleOf({
        ...blank,
        iframe_kind: 'ad_network',
        class_words: ['sponsored'],
      }).task,
    ).toBeLessThanOrEqual(0.05);
  });

  it('reads page type from signals and main content from candidates', () => {
    const req = requestFor([], {
      ask: { pageType: true },
      mainCandidates: [
        {
          cid: 'c1',
          ev: evidence({ zone: 'left_rail', text_amount: '100-500 chars' }),
        },
        {
          cid: 'c2',
          ev: evidence({
            ...blank,
            zone: 'center_column',
            landmark: 'main',
            text_amount: '>2k chars',
          }),
        },
      ],
    });
    const res = mockJevAnswer(req);
    expect((res.answers.page_type as JevChoiceAnswer).choice).toBe('article');
    expect((res.answers.main_pick as JevChoiceAnswer).choice).toBe('c2');
    expect(
      (res.answers.main_pick as JevChoiceAnswer).probabilities.c2,
    ).toBeGreaterThanOrEqual(0.8);

    const feedReq = requestFor([], {
      ask: { pageType: true },
      page: {
        ...workedExamplePage(),
        signals: ['role_feed', 'infinite_scroll'],
      },
    });
    expect(
      (mockJevAnswer(feedReq).answers.page_type as JevChoiceAnswer).choice,
    ).toBe('feed_social');
  });
});

describe('createMockJevFetch', () => {
  const req = requestFor([{ rid: 'r4', ev: workedExampleEvidence() }]);
  const post = (headers: Record<string, string>, body: unknown) =>
    createMockJevFetch()('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

  it('answers a valid request with a request id header', async () => {
    const res = await post(
      { authorization: 'Bearer k', 'content-type': 'application/json' },
      req,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-typesafe-request-id')).toMatch(
      /^req_[0-9a-f]{32}$/,
    );
    expect(checkJevShape(req.questions, await res.json())).toBeNull();
  });

  it('rejects a missing key with 403 and an invalid key with 401', async () => {
    expect((await post({}, req)).status).toBe(403);
    expect((await post({ authorization: 'Bearer invalid' }, req)).status).toBe(
      401,
    );
  });

  it('validates like the API: bare-number state, unknown fields, too many choices', async () => {
    const auth = { authorization: 'Bearer k' };
    expect((await post(auth, { ...req, state: 3 })).status).toBe(422);
    expect((await post(auth, { ...req, temperature: 0 })).status).toBe(422);
    expect((await post(auth, { ...req, questions: {} })).status).toBe(422);
    const many = Object.fromEntries(
      Array.from({ length: 256 }, (_, i) => [`o${i}`, null]),
    );
    expect(
      (
        await post(auth, {
          ...req,
          questions: { q: { type: 'choice', criteria: many } },
        })
      ).status,
    ).toBe(400);
  });
});
