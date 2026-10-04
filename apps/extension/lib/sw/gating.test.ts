import { initialLearningState } from '@webable/core/learning/learners';
import {
  articleSignals,
  FIXTURE_NOW,
  focusProfile,
  strongReaderProfile,
  tier0Profile,
} from '@webable/core/policy/fixtures';
import { needLevels } from '@webable/core/profile/needs';
import { describe, expect, it } from 'vitest';

import {
  analysisConsumers,
  ANALYSIS_OPS,
  gate,
  TAB_MAX_CALLS,
  TAB_MIN_INTERVAL_MS,
  type GateInput,
} from './gating';

const OPEN: GateInput = {
  configured: true,
  signedIn: true,
  needsReauth: false,
  cloudAnalysis: true,
  consumesAnalysis: true,
  excludedSite: false,
  signals: {
    lang: 'en-GB',
    forms: {
      count: 0,
      requiredFields: 0,
      hasPassword: false,
      hasPayment: false,
    },
    category: 'article',
    categoryConfidence: 0.9,
  },
  ambiguousRegions: 2,
  uncachedRegions: 2,
  mainUncached: false,
  breakerOpen: false,
  tab: { calls: 0, lastCallAt: null },
  now: FIXTURE_NOW,
};

const why = (patch: Partial<GateInput>) => {
  const r = gate({ ...OPEN, ...patch });
  return r.call ? 'call' : r.reason;
};

describe('page-analysis gating (ai-architecture 3.1)', () => {
  it('calls only when every condition holds', () => {
    expect(gate(OPEN)).toEqual({ call: true });
  });

  it('G1: needs a configured client, a session and consent', () => {
    expect(why({ configured: false })).toBe('unconfigured');
    expect(why({ signedIn: false })).toBe('not_signed_in');
    expect(why({ needsReauth: true })).toBe('needs_reauth');
    expect(why({ cloudAnalysis: false })).toBe('no_consent');
  });

  it('G2: some enabled op must consume region roles', () => {
    expect(why({ consumesAnalysis: false })).toBe('no_consuming_op');
  });

  it('G3: never on password, payment or checkout pages, or excluded sites', () => {
    expect(why({ excludedSite: true })).toBe('excluded_site');
    expect(
      why({
        signals: {
          ...OPEN.signals,
          forms: { ...OPEN.signals.forms, hasPassword: true },
        },
      }),
    ).toBe('sensitive_page');
    expect(
      why({
        signals: {
          ...OPEN.signals,
          forms: { ...OPEN.signals.forms, hasPayment: true },
        },
      }),
    ).toBe('sensitive_page');
    expect(
      why({
        signals: {
          ...OPEN.signals,
          category: 'form_checkout',
          categoryConfidence: 0.8,
        },
      }),
    ).toBe('checkout');
    // An unsure checkout guess does not block.
    expect(
      why({
        signals: {
          ...OPEN.signals,
          category: 'form_checkout',
          categoryConfidence: 0.5,
        },
      }),
    ).toBe('call');
  });

  it('G6: English pages only', () => {
    expect(why({ signals: { ...OPEN.signals, lang: 'de' } })).toBe(
      'not_english',
    );
    expect(why({ signals: { ...OPEN.signals, lang: '' } })).toBe('not_english');
    expect(why({ signals: { ...OPEN.signals, lang: 'EN' } })).toBe('call');
    expect(why({ signals: { ...OPEN.signals, lang: 'eng' } })).toBe(
      'not_english',
    );
  });

  it('G4/G5: something ambiguous and not already answered', () => {
    expect(why({ ambiguousRegions: 0, uncachedRegions: 0 })).toBe(
      'nothing_ambiguous',
    );
    expect(why({ uncachedRegions: 0 })).toBe('cached');
    expect(
      why({ ambiguousRegions: 0, uncachedRegions: 0, mainUncached: true }),
    ).toBe('call');
  });

  it('G7: breaker closed, at most one call per 10 s and three per page view', () => {
    expect(why({ breakerOpen: true })).toBe('breaker_open');
    expect(why({ tab: { calls: TAB_MAX_CALLS, lastCallAt: null } })).toBe(
      'tab_rate',
    );
    expect(
      why({
        tab: { calls: 1, lastCallAt: FIXTURE_NOW - TAB_MIN_INTERVAL_MS + 1 },
      }),
    ).toBe('tab_rate');
    expect(
      why({ tab: { calls: 1, lastCallAt: FIXTURE_NOW - TAB_MIN_INTERVAL_MS } }),
    ).toBe('call');
  });
});

describe('ops that consume page analysis (G2)', () => {
  const input = (profile = strongReaderProfile()) => {
    const needs = needLevels(profile);
    return {
      learning: initialLearningState(
        profile,
        needs,
        Math.floor(FIXTURE_NOW / 86_400_000),
      ),
      domain: undefined,
      site: undefined,
      profile,
      needs,
      category: articleSignals().category,
      profileConfidence: profile.confidence,
      now: FIXTURE_NOW,
    };
  };

  it('only ever lists ops that use page analysis', () => {
    for (const op of analysisConsumers(input(focusProfile())))
      expect(ANALYSIS_OPS).toContain(op);
  });

  it('finds consumers for a distraction-sensitive fit', () => {
    expect(analysisConsumers(input(focusProfile())).length).toBeGreaterThan(0);
  });

  it('lists nothing on a paused site, and never a blocked op', () => {
    const base = input(focusProfile());
    expect(
      analysisConsumers({
        ...base,
        site: { paused: true, pins: [], blocks: [], levels: {}, updatedAt: 0 },
      }),
    ).toEqual([]);
    const all = analysisConsumers(base);
    const blocked = analysisConsumers({
      ...base,
      site: {
        paused: false,
        pins: [],
        blocks: [...ANALYSIS_OPS],
        levels: {},
        updatedAt: 0,
      },
    });
    expect(all.length).toBeGreaterThan(0);
    expect(blocked).toEqual([]);
  });

  it('counts a pinned op even when nothing else would use analysis', () => {
    const base = input(tier0Profile());
    const pinned = analysisConsumers({
      ...base,
      profileConfidence: null,
      site: {
        paused: false,
        pins: ['dim_distractions'],
        blocks: [],
        levels: {},
        updatedAt: 0,
      },
    });
    expect(pinned).toContain('dim_distractions');
  });
});
