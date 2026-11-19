import { describe, expect, it } from 'vitest';

import { buildQuestions, toDecideResponse } from '../decide/catalog';
import { createMockJevFetch } from '../decide/mock';
import {
  combineVerdicts,
  localVerdicts,
  verdictsFromAnswers,
} from '../decide/verdict';
import {
  decideRequestSchema,
  decideResponseSchema,
  type DecideRequest,
} from '../decide/wire';
import { explainChange, offerQuestion } from '../explain/templates';
import { callJev } from '../jev/client';
import {
  unknownEvidenceWords,
  vocabClassWords,
  vocabPhrase,
} from '../page/vocab';
import { CATALOG_VERSION, JEV_PINNED_MODEL } from '../versions';
import { buildPlan } from './decide';
import {
  articleSignals,
  evidence,
  focusProfile,
  makeInput,
  makeRegion,
  workedExamplePage,
} from './fixtures';

/**
 * The whole page-analysis path with the Jev mock standing in for the network:
 * vocab-filtered evidence -> DecideRequest -> catalog questions -> callJev ->
 * compact wire answer -> verdicts (veto first) -> plan -> "Why this changed".
 */
describe('page analysis, end to end', () => {
  it('turns raw labels into a plan and an explanation without leaking page text', async () => {
    // What the content script sees locally (never sent) ...
    const rawClass = 'nyt-RelatedLinks css-1x9k2 sidebarWidget';
    const rawHeading = 'Most popular with readers like Caden';
    // ... and what it sends: vocabulary words only.
    const railEvidence = evidence({
      class_words: vocabClassWords(rawClass),
      heading_words: vocabPhrase(rawHeading),
    });
    expect(railEvidence.class_words).toEqual([
      'related',
      'links',
      'sidebar',
      'widget',
    ]);
    expect(railEvidence.heading_words).toBe('most popular with readers like ·');
    expect(unknownEvidenceWords(railEvidence)).toEqual([]);

    const req: DecideRequest = {
      v: 1,
      catalog: CATALOG_VERSION,
      lang: 'en',
      page: workedExamplePage(),
      regions: [
        { rid: 'r0', ev: railEvidence },
        {
          rid: 'r1',
          ev: evidence({
            zone: 'right_rail',
            class_words: ['help'],
            heading_words: 'help and support',
            repeated_cards: '0',
          }),
        },
      ],
      ask: { pageType: false },
    };
    expect(decideRequestSchema.safeParse(req).success).toBe(true);
    const body = JSON.stringify(req);
    expect(body).not.toMatch(/caden|nyt|css/i);

    // Edge Function side.
    const built = buildQuestions(req);
    const jev = await callJev(
      {
        model: JEV_PINNED_MODEL,
        state: built.state,
        questions: built.questions,
      },
      {
        apiKey: 'test',
        timeoutMs: 1000,
        pinnedModel: JEV_PINNED_MODEL,
        fetch: createMockJevFetch(),
      },
    );
    expect(jev.ok).toBe(true);
    if (!jev.ok) return;
    const wire = decideResponseSchema.parse(
      toDecideResponse(built, jev.data, { jev: jev.ms, edge: jev.ms + 5 }),
    );
    expect(wire.ok).toBe(true);
    if (!wire.ok) return;

    // Service worker side.
    const signals = articleSignals({}, [
      makeRegion('k-rail', { zone: 'right_rail', areaPct: 18 }),
      makeRegion('k-help', { zone: 'right_rail', areaPct: 6 }),
      makeRegion('k-ad', {
        zone: 'right_rail',
        ruleRole: 'promo_ad',
        rulePrecision: 0.98,
        ruleId: 'ad-iframe',
      }),
      makeRegion('k-cookie', {
        zone: 'overlay_bottom',
        pinned: 'fixed',
        ruleRole: 'consent_banner',
        rulePrecision: 0.99,
      }),
    ]);
    const analysis = verdictsFromAnswers(
      wire,
      { r0: 'k-rail', r1: 'k-help' },
      signals,
      'article',
      undefined,
      {
        'k-rail': railEvidence,
        'k-help': req.regions[1]!.ev,
      },
    );
    expect(analysis['k-rail']).toMatchObject({
      label: 'clear',
      protected: false,
    });
    expect(analysis['k-help']).toMatchObject({ protected: true });
    const verdicts = combineVerdicts(localVerdicts(signals), analysis);

    const input = makeInput({
      profile: focusProfile(),
      signals,
      patch: {
        verdicts,
        site: {
          paused: false,
          pins: ['dim_distractions'],
          blocks: [],
          levels: {},
          updatedAt: 0,
        },
      },
    });
    const plan = buildPlan(input);
    const dim = plan.ops.find((o) => o.op === 'dim_distractions');
    expect(dim?.mode).toBe('auto');
    expect(dim?.scope).toEqual({ regions: ['k-ad', 'k-rail'] });
    expect(plan.basis).toBe('page_analysis');

    const why = explainChange({
      op: 'dim_distractions',
      level: dim!.level,
      mode: 'auto',
      status: 'applied',
      count: 2,
      trace: dim!.trace,
    });
    expect(why.detail).toBe(
      'WebAble softened 2 areas that look like ads or links to other pages (page analysis: clear). Hover or tab into them to bring them back. You chose this for this site.',
    );
    for (const o of plan.ops.filter((x) => x.mode === 'offer'))
      expect(offerQuestion(o.trace).question.endsWith('?')).toBe(true);
  });

  it('degrades to rules only when the model drifts', async () => {
    const req: DecideRequest = {
      v: 1,
      catalog: CATALOG_VERSION,
      lang: 'en',
      page: workedExamplePage(),
      regions: [{ rid: 'r0', ev: evidence() }],
      ask: { pageType: false },
    };
    const built = buildQuestions(req);
    const jev = await callJev(
      {
        model: JEV_PINNED_MODEL,
        state: built.state,
        questions: built.questions,
      },
      {
        apiKey: 'test',
        timeoutMs: 1000,
        pinnedModel: JEV_PINNED_MODEL,
        fetch: createMockJevFetch({ model: 'jev-1.14.0' }),
      },
    );
    expect(jev).toMatchObject({ ok: false, error: { kind: 'model_drift' } });
    // Without answers, only rule-decided regions can be softened.
    const signals = articleSignals();
    const plan = buildPlan(
      makeInput({
        profile: focusProfile(),
        signals,
        patch: {
          verdicts: localVerdicts(signals),
          site: {
            paused: false,
            pins: ['dim_distractions'],
            blocks: [],
            levels: {},
            updatedAt: 0,
          },
        },
      }),
    );
    expect(plan.basis).toBe('local');
    expect(plan.ops.find((o) => o.op === 'dim_distractions')?.scope).toEqual({
      regions: ['k-ad', 'k-chat'],
    });
  });
});
