import type { RegionEvidence, PageContext, PageSignals } from '../page/types';
import { defaultFitProfile } from '../profile/defaults';
import { needLevels } from '../profile/needs';
import type { FitProfile } from '../profile/schema';
import { initialLearningState, toDay } from '../learning/learners';
import type { DomainState, UserLearningState } from '../learning/types';
import type { PolicyInput } from './decide';

/**
 * Deterministic fixtures for policy, learning and page-analysis tests (also
 * usable by extension and Edge Function tests). Pure data builders; nothing
 * here runs in production paths.
 */

export const FIXTURE_NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
export const FIXTURE_DAY = toDay(FIXTURE_NOW);

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key] = merge(current, value as DeepPartial<typeof current>);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

/** A calibrated profile with a strong text need (21 px), 44 px targets and default attention. */
export function strongReaderProfile(): FitProfile {
  const p = defaultFitProfile(undefined, new Date(FIXTURE_NOW));
  p.calibrationVersion = 'cal-1.0.0';
  p.modules = { reading: 'measured', pointing: 'measured', focus: 'measured' };
  p.confidence = 0.8;
  p.vision.textMinPx = {
    value: 21,
    source: 'measured',
    confidence: 0.85,
    measured: 21,
  };
  p.vision.lineHeight = {
    value: 1.6,
    source: 'measured',
    confidence: 0.7,
    measured: 1.6,
  };
  p.vision.maxLineCh = {
    value: 70,
    source: 'measured',
    confidence: 0.7,
    measured: 70,
  };
  p.motor.minTargetPx = {
    value: 44,
    source: 'measured',
    confidence: 0.8,
    measured: 44,
  };
  return p;
}

/** A profile with a strong distraction need (dimming and focus view candidates). */
export function focusProfile(): FitProfile {
  const p = strongReaderProfile();
  p.attention.distraction = {
    mean: 0.9,
    sd: 0.1,
    confidence: 0.8,
    sources: ['behavior'],
  };
  p.attention.motion = {
    mean: 0.9,
    sd: 0.1,
    confidence: 0.8,
    sources: ['behavior'],
  };
  return p;
}

/** Uncalibrated (tier 0) profile. */
export function tier0Profile(
  system?: Parameters<typeof defaultFitProfile>[0],
): FitProfile {
  return defaultFitProfile(system, new Date(FIXTURE_NOW));
}

export function makeRegion(
  key: string,
  patch: Partial<PageSignals['regions'][number]> = {},
): PageSignals['regions'][number] {
  return {
    key,
    zone: 'right_rail',
    areaPct: 12,
    pinned: 'no',
    ruleRole: null,
    rulePrecision: 0,
    ruleId: null,
    hasRequiredFields: false,
    containsFocus: false,
    motion: 'none',
    ...patch,
  };
}

/** An article page with small text, contrast failures, small targets, motion and a few side regions. */
export function articleSignals(
  patch?: DeepPartial<PageSignals>,
  regions?: PageSignals['regions'],
): PageSignals {
  const base: PageSignals = {
    v: 1,
    lang: 'en',
    category: 'article',
    categoryConfidence: 0.9,
    viewport: { width: 1280, height: 800, dpr: 2, zoom: 1 },
    text: {
      histogram: [
        [13, 4200],
        [16, 900],
        [24, 300],
      ],
      totalChars: 5400,
      mainFontPx: 13,
      mainLineHeight: 1.3,
      mainLineCh: 96,
      minWeight: 400,
    },
    contrast: { sampled: 120, below45: 14, below7: 40, unknownBackground: 3 },
    targets: {
      count: 80,
      below: { '24': 6, '32': 12, '44': 18, '56': 30, '72': 44 },
      crowded: 9,
    },
    motion: {
      running: 3,
      infinite: 2,
      autoplayMedia: 1,
      carousels: 1,
      animatedImages: 1,
    },
    sticky: { bars: 1, topBandPx: 120 },
    hoverMenus: 2,
    dragOnly: 0,
    forms: {
      count: 1,
      requiredFields: 0,
      hasPassword: false,
      hasPayment: false,
    },
    main: { key: 'k-main', ambiguous: false },
    regions: regions ?? [
      makeRegion('k-ad', {
        zone: 'right_rail',
        ruleRole: 'promo_ad',
        rulePrecision: 0.98,
        ruleId: 'ad-iframe',
      }),
      makeRegion('k-rail', { zone: 'right_rail', areaPct: 18 }),
      makeRegion('k-nav', {
        zone: 'header_band',
        pinned: 'sticky',
        areaPct: 9,
        ruleRole: 'navigation',
        rulePrecision: 0.95,
        ruleId: 'landmark-nav',
      }),
      makeRegion('k-cookie', {
        zone: 'overlay_bottom',
        pinned: 'fixed',
        areaPct: 10,
        ruleRole: 'consent_banner',
        rulePrecision: 0.99,
        ruleId: 'cmp-onetrust',
      }),
      makeRegion('k-chat', {
        zone: 'overlay_corner',
        pinned: 'fixed',
        areaPct: 2,
        ruleRole: 'chat_widget',
        rulePrecision: 0.97,
        ruleId: 'chat-vendor',
      }),
    ],
    env: { reducedMotion: false, forcedColors: false, colorScheme: 'light' },
  };
  return merge(base, patch);
}

export function makeInput(
  opts: {
    profile?: FitProfile;
    signals?: PageSignals;
    learning?: UserLearningState;
    domain?: DomainState;
    patch?: Partial<PolicyInput>;
  } = {},
): PolicyInput {
  const profile = opts.profile ?? strongReaderProfile();
  const needs = needLevels(profile);
  return {
    profile,
    needs,
    signals: opts.signals ?? articleSignals(),
    verdicts: {},
    learning:
      opts.learning ?? initialLearningState(profile, needs, FIXTURE_DAY),
    domain: opts.domain,
    site: undefined,
    friction: {},
    offersToday: 0,
    offersThisPage: 0,
    tabSession: 'tab-1',
    now: FIXTURE_NOW,
    profileConfidence:
      profile.calibrationVersion === null ? null : profile.confidence,
    ...opts.patch,
  };
}

/** The region evidence from the worked example (ai-architecture.md 3.4). */
export function workedExampleEvidence(): RegionEvidence {
  return {
    zone: 'right_rail',
    width: '15-30%',
    height: '1-3 screens',
    pinned: 'no',
    landmark: 'complementary',
    tag: 'aside',
    dom_position: 'after_main',
    links: '11-30',
    link_density: 'high',
    text_amount: '500-2k chars',
    buttons: '0',
    inputs: '0',
    required_fields: false,
    repeated_cards: '4-8',
    images: '4-10',
    video: false,
    iframe_kind: 'none',
    motion: 'none',
    class_words: ['sidebar', 'related', 'widget'],
    heading_words: 'most popular',
    control_words: [],
  };
}

/**
 * The page context from the worked example. The design doc's illustrative
 * count buckets ("10-20", "100-300") predate the shared bucket enum; these use
 * the nearest buckets that exist in page/types.ts.
 */
export function workedExamplePage(): PageContext {
  return {
    signals: ['og_type_article', 'readerable', 'has_site_search'],
    main: { found_by: 'readability', zone: 'center_column', width: '30-60%' },
    counts: {
      regions: '11-30',
      links: '>100',
      buttons: '11-30',
      text_inputs: '2-3',
      forms: '1',
      required_fields: '0',
      headings: '11-30',
      images: '11-30',
      videos: '0',
      text_amount: '10k-50k chars',
    },
    layout: {
      viewport: 'desktop',
      page_height: '3-10 screens',
      pinned_bars: '2',
    },
  };
}

export function evidence(patch: Partial<RegionEvidence> = {}): RegionEvidence {
  return { ...workedExampleEvidence(), ...patch };
}
