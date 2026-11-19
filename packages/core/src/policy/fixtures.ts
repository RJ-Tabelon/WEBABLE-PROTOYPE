import type { RegionEvidence, PageContext, PageSignals } from '../page/types';
import { defaultFitProfile } from '../profile/defaults';
import { needLevels } from '../profile/needs';
import type { FitProfile } from '../profile/schema';
import { initialLearningState, toDay } from '../learning/learners';
import type { DomainState, UserLearningState } from '../learning/types';
import { triage, type TriageInput } from '../triage/triage';
import type { LayoutFeatures, TriageVerdict } from '../triage/types';
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

/**
 * Corpus persona "large text" (docs/10 §10): a measured reading floor of
 * `px` (24-36 in the release gates) and typical (24 px) targets.
 */
export function largeTextProfile(px = 28): FitProfile {
  const p = strongReaderProfile();
  p.vision.textMinPx = {
    value: px,
    source: 'measured',
    confidence: 0.85,
    measured: px,
  };
  p.motor.minTargetPx = {
    value: 24,
    source: 'measured',
    confidence: 0.8,
    measured: 24,
  };
  return p;
}

/** Corpus persona "large targets": measured T (56 or more) with a typical 16 px reading floor. */
export function largeTargetProfile(
  targetPx: FitProfile['motor']['minTargetPx']['value'] = 56,
): FitProfile {
  const p = strongReaderProfile();
  p.vision.textMinPx = {
    value: 16,
    source: 'measured',
    confidence: 0.85,
    measured: 16,
  };
  p.motor.minTargetPx = {
    value: targetPx,
    source: 'measured',
    confidence: 0.8,
    measured: targetPx,
  };
  return p;
}

/**
 * Corpus persona "high distraction": P(distraction benefit > 0) far above
 * 0.8, with a typical 16 px reading floor and 24 px targets.
 */
export function highDistractionProfile(): FitProfile {
  const p = focusProfile();
  p.vision.textMinPx = {
    value: 16,
    source: 'measured',
    confidence: 0.85,
    measured: 16,
  };
  p.motor.minTargetPx = {
    value: 24,
    source: 'measured',
    confidence: 0.8,
    measured: 24,
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

/** Person-independent layout features (docs/10 §3.1) of a plain, calm page. */
export function layoutFeatures(
  patch?: DeepPartial<LayoutFeatures>,
): LayoutFeatures {
  const base: LayoutFeatures = {
    bodyPx: 16,
    slack: {
      rowSlackMin: 1.6,
      clipRiskShare: 0.05,
      fixedHeightTextShare: 0.02,
      overlayTextShare: 0,
    },
    occlusion: 0.08,
    density: { leafPer100k: 20, corners: 60, fontSizes: 5, regions: 2 },
    records: { count: 0, largest: 0, mainShare: 0 },
    readerable: 0,
    kind: {
      product: false,
      editor: false,
      application: false,
      canvas: false,
      videoPlayer: false,
      paywall: false,
      blockingOverlay: false,
      password: false,
      payment: false,
    },
    nav: { primaryLinks: 6, searchVisible: true },
  };
  return merge(base, patch);
}

const STILL: PageSignals['motion'] = {
  running: 0,
  infinite: 0,
  autoplayMedia: 0,
  carousels: 0,
  animatedImages: 0,
};

/**
 * A gov.uk-like guidance page: 19 px body text, calm, readerable, large
 * clickable areas. Fits a typical reader; F = 36 needs more than page scale.
 */
export function govukSignals(
  layout?: DeepPartial<LayoutFeatures>,
  patch?: DeepPartial<PageSignals>,
): PageSignals {
  return merge(
    articleSignals(
      {
        category: 'article',
        text: {
          histogram: [
            [19, 4200],
            [16, 500],
            [27, 200],
            [36, 60],
          ],
          totalChars: 4960,
          mainFontPx: 19,
          mainLineHeight: 1.32,
          mainLineCh: 68,
        },
        contrast: { sampled: 90, below45: 0, below7: 2 },
        targets: {
          count: 40,
          below: { '24': 1, '32': 6, '44': 20, '56': 30, '72': 36 },
          crowded: 2,
        },
        motion: STILL,
        sticky: { bars: 0, topBandPx: 0 },
        hoverMenus: 0,
      },
      [],
    ),
    {
      ...patch,
      layout: merge(
        layoutFeatures({
          bodyPx: 19,
          occlusion: 0,
          // GOV.UK measures 1.2-1.8 leaf boxes per 100k px² (eval corpus).
          density: { leafPer100k: 1.5, corners: 35, fontSizes: 4, regions: 1 },
          readerable: 62,
          nav: { primaryLinks: 4, searchVisible: true },
        }),
        layout,
      ),
    },
  );
}

/** A Wikipedia-like article: 14 px body, readerable, dense links and a sticky header. */
export function wikipediaSignals(
  layout?: DeepPartial<LayoutFeatures>,
  patch?: DeepPartial<PageSignals>,
): PageSignals {
  return merge(
    articleSignals({
      category: 'docs_reference',
      text: {
        histogram: [
          [14, 9000],
          [12, 1500],
          [16, 400],
          [28, 80],
        ],
        totalChars: 10_980,
        mainFontPx: 14,
        mainLineHeight: 1.6,
        mainLineCh: 110,
      },
      contrast: { sampled: 140, below45: 1, below7: 6 },
      targets: {
        count: 75,
        below: { '24': 50, '32': 58, '44': 61, '56': 66, '72': 70 },
        crowded: 58,
      },
      motion: STILL,
      sticky: { bars: 1, topBandPx: 50 },
    }),
    {
      ...patch,
      layout: merge(
        layoutFeatures({
          bodyPx: 14,
          slack: { rowSlackMin: 1.3, clipRiskShare: 0.04 },
          occlusion: 0.07,
          density: { leafPer100k: 42, corners: 130, fontSizes: 8, regions: 4 },
          records: { count: 1, largest: 8, mainShare: 0.08 },
          readerable: 140,
          nav: { primaryLinks: 5, searchVisible: true },
        }),
        layout,
      ),
    },
  );
}

/**
 * A YouTube-like results grid: 14 px titles and metadata in clamped,
 * fixed-height cards (clip risk), many small and crowded controls, dense,
 * with a large records collection covering main.
 */
export function youtubeSignals(
  layout?: DeepPartial<LayoutFeatures>,
  patch?: DeepPartial<PageSignals>,
): PageSignals {
  return merge(
    articleSignals(
      {
        category: 'search_results',
        text: {
          histogram: [
            [14, 900],
            [12, 600],
            [16, 300],
          ],
          totalChars: 1800,
          mainFontPx: 14,
          mainLineHeight: 1.4,
          mainLineCh: 40,
        },
        contrast: { sampled: 80, below45: 12, below7: 30 },
        targets: {
          count: 120,
          below: { '24': 30, '32': 50, '44': 80, '56': 100, '72': 110 },
          crowded: 70,
        },
        motion: {
          running: 2,
          infinite: 1,
          autoplayMedia: 1,
          carousels: 0,
          animatedImages: 0,
        },
        sticky: { bars: 1, topBandPx: 56 },
      },
      [],
    ),
    {
      ...patch,
      layout: merge(
        layoutFeatures({
          bodyPx: 14,
          slack: {
            rowSlackMin: 1.02,
            clipRiskShare: 0.55,
            fixedHeightTextShare: 0.3,
            overlayTextShare: 0.1,
          },
          occlusion: 0.12,
          density: { leafPer100k: 80, corners: 300, fontSizes: 13, regions: 9 },
          records: { count: 3, largest: 24, mainShare: 0.85 },
          readerable: 0,
          nav: { primaryLinks: 8, searchVisible: true },
        }),
        layout,
      ),
    },
  );
}

/** A document editor: small UI text, an editable canvas, role=application. */
export function editorSignals(
  layout?: DeepPartial<LayoutFeatures>,
  patch?: DeepPartial<PageSignals>,
): PageSignals {
  return merge(
    articleSignals(
      {
        category: 'web_app',
        text: {
          histogram: [
            [11, 2000],
            [13, 600],
          ],
          totalChars: 2600,
          mainFontPx: 11,
          mainLineHeight: 1.15,
          mainLineCh: 90,
        },
        motion: STILL,
      },
      [],
    ),
    {
      ...patch,
      layout: merge(
        layoutFeatures({
          bodyPx: 11,
          slack: { rowSlackMin: 1.05, clipRiskShare: 0.3 },
          occlusion: 0.18,
          density: { leafPer100k: 55, corners: 160, fontSizes: 7, regions: 5 },
          readerable: 0,
          kind: { editor: true, application: true, canvas: true },
        }),
        layout,
      ),
    },
  );
}

/** Triage for a fixture page at 100% (the worker's call, with the person's own zoom from the signals). */
export function triageFor(
  profile: FitProfile,
  signals: PageSignals,
  patch: Partial<Omit<TriageInput, 'profile' | 'signals'>> = {},
): TriageVerdict {
  return triage({ profile, signals, zoom: signals.viewport.zoom, ...patch });
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
