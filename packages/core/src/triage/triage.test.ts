import { describe, expect, it } from 'vitest';

import {
  articleSignals,
  editorSignals,
  govukSignals,
  highDistractionProfile,
  largeTargetProfile,
  largeTextProfile,
  strongReaderProfile,
  tier0Profile,
  triageFor,
  wikipediaSignals,
  youtubeSignals,
} from '../policy/fixtures';
import type { FitProfile } from '../profile/schema';
import { TRIAGE_VERSION } from '../versions';
import {
  benefitPositive,
  blockersOf,
  breakpointSafeZoom,
  comfortPercentile,
  densityPercentile,
  DENSITY_REFERENCE,
  snapZoom,
  TEXT_FITS_MAX_K,
  triage,
  ZOOM_PRESETS,
} from './triage';
import { TRIAGE_BLOCKERS, type TriageKind, type TriageVerdict } from './types';

const RANK: Record<TriageKind, number> = { fits: 0, tailor: 1, compose: 2 };

/** A large-text persona whose only need is text (targets typical, attention flat). */
const reader = (px: number): FitProfile => largeTextProfile(px);

describe('the needed scale k', () => {
  it('is the reading floor over running text at the person’s own zoom', () => {
    expect(triageFor(reader(28), wikipediaSignals()).k).toBe(2);
    expect(triageFor(reader(24), govukSignals()).k).toBe(1.263);
    // Someone who already zoomed to 125% is not enlarged twice.
    const own = triageFor(reader(24), govukSignals(), { zoom: 1.25 });
    expect(own.k).toBe(1.011);
    expect(own).toMatchObject({ verdict: 'fits', zoom: 1 });
  });

  it('falls back to the main font size, and treats a page with no text as fitting', () => {
    const signals = govukSignals({ bodyPx: null });
    expect(signals.text.mainFontPx).toBe(19);
    expect(triageFor(reader(24), signals).k).toBe(1.263);
    const blank = govukSignals(
      { bodyPx: null },
      { text: { mainFontPx: null } },
    );
    expect(triageFor(reader(36), blank)).toMatchObject({
      k: null,
      zoom: 1,
      residual: 1,
      needs: { text: 'fits' },
    });
  });
});

describe('corpus personas × pages (docs/10 §10 triage gate)', () => {
  const T56 = largeTargetProfile(56);
  const busy = highDistractionProfile();

  it.each([
    // page, persona, verdict, zoom, the needs that are not fits
    ['gov.uk', 'F=18', govukSignals(), reader(18), 'fits', 1, {}],
    [
      'gov.uk',
      'F=24',
      govukSignals(),
      reader(24),
      'tailor',
      1.25,
      { text: 'tailor' },
    ],
    [
      'gov.uk',
      'F=28',
      govukSignals(),
      reader(28),
      'tailor',
      1.25,
      { text: 'tailor' },
    ],
    [
      'gov.uk',
      'F=36',
      govukSignals(),
      reader(36),
      'compose',
      1.5,
      { text: 'compose' },
    ],
    ['gov.uk', 'T=56', govukSignals(), T56, 'tailor', 1, { targets: 'tailor' }],
    ['gov.uk', 'distraction', govukSignals(), busy, 'fits', 1, {}],
    [
      'Wikipedia',
      'F=18',
      wikipediaSignals(),
      reader(18),
      'tailor',
      1.25,
      { text: 'tailor', targets: 'tailor' },
    ],
    [
      'Wikipedia',
      'F=24',
      wikipediaSignals(),
      reader(24),
      'compose',
      1.5,
      { text: 'compose', targets: 'tailor' },
    ],
    [
      'Wikipedia',
      'distraction',
      wikipediaSignals(),
      busy,
      'tailor',
      1,
      { targets: 'tailor', clutter: 'tailor' },
    ],
    [
      'YouTube',
      'F=18',
      youtubeSignals(),
      reader(18),
      'tailor',
      1.25,
      { text: 'tailor', targets: 'tailor' },
    ],
    [
      'YouTube',
      'F=24',
      youtubeSignals(),
      reader(24),
      'compose',
      1.5,
      { text: 'compose', targets: 'tailor', occlusion: 'tailor' },
    ],
    [
      'YouTube',
      'T=56',
      youtubeSignals(),
      T56,
      'compose',
      1,
      { targets: 'compose' },
    ],
    [
      'YouTube',
      'distraction',
      youtubeSignals(),
      busy,
      'compose',
      1,
      { targets: 'tailor', clutter: 'compose', motion: 'tailor' },
    ],
    [
      'editor',
      'F=36',
      editorSignals(),
      reader(36),
      'tailor',
      1.5,
      { text: 'compose', occlusion: 'tailor' },
    ],
    [
      'editor',
      'T=56',
      editorSignals(),
      T56,
      'tailor',
      1.25,
      { text: 'tailor', targets: 'tailor', occlusion: 'tailor' },
    ],
  ] as const)(
    '%s, %s',
    (_page, _persona, signals, profile, verdict, zoom, needs) => {
      const t = triageFor(profile, signals);
      expect(t.verdict).toBe(verdict);
      expect(t.zoom).toBe(zoom);
      const notFits = Object.fromEntries(
        Object.entries(t.needs).filter(([, band]) => band !== 'fits'),
      );
      expect(notFits).toEqual(needs);
      expect(t.version).toBe(TRIAGE_VERSION);
    },
  );

  it('follows from measured k and representability for every reading floor', () => {
    const pages = {
      gov: govukSignals(),
      wikipedia: wikipediaSignals(),
      youtube: youtubeSignals(),
      editor: editorSignals(),
    };
    for (const signals of Object.values(pages)) {
      for (let px = 14; px <= 44; px += 1) {
        const p = reader(px);
        // Only the text need, so the verdict is a function of k alone.
        p.motor.minTargetPx = { value: 24, source: 'default', confidence: 0.3 };
        const t = triageFor(p, signals);
        const k = t.k!;
        const expected: TriageKind =
          k <= TEXT_FITS_MAX_K
            ? 'fits'
            : k > t.zMax && t.representable
              ? 'compose'
              : 'tailor';
        expect(t.verdict, `${px}px k=${k}`).toBe(expected);
        expect(t.needs.text).toBe(
          k <= TEXT_FITS_MAX_K ? 'fits' : k > t.zMax ? 'compose' : 'tailor',
        );
      }
    }
  });

  it('gives an uncalibrated person’s pages nothing: needs without evidence fit', () => {
    for (const signals of [
      govukSignals(),
      wikipediaSignals(),
      youtubeSignals(),
      editorSignals(),
    ]) {
      const t = triageFor(tier0Profile(), signals);
      expect(t).toMatchObject({ verdict: 'fits', zoom: 1, reasons: [] });
    }
    // An OS setting is evidence: reduced motion makes moving things a need.
    const reduced = tier0Profile({
      reducedMotion: true,
      colorScheme: 'light',
      moreContrast: false,
      forcedColors: false,
      deviceClass: 'laptop',
      input: 'mouse',
    });
    expect(triageFor(reduced, youtubeSignals()).needs.motion).toBe('tailor');
  });
});

describe('page scale', () => {
  it('snaps down to Chrome’s presets', () => {
    expect(snapZoom(1.09)).toBe(1);
    expect(snapZoom(1.1)).toBe(1.1);
    expect(snapZoom(1.249)).toBe(1.1);
    expect(snapZoom(1.3)).toBe(1.25);
    expect(snapZoom(1.6)).toBe(1.5);
    expect(snapZoom(1.99)).toBe(1.75);
    expect(snapZoom(3)).toBe(2);
  });

  it('stays inside the layout class: zMax = min(2, width / 800), at least 1', () => {
    expect(breakpointSafeZoom(1280)).toBe(1.6);
    expect(breakpointSafeZoom(1440)).toBe(1.8);
    expect(breakpointSafeZoom(1920)).toBe(2);
    expect(breakpointSafeZoom(700)).toBe(1);
    expect(breakpointSafeZoom(0)).toBe(1);
    expect(breakpointSafeZoom(Number.NaN)).toBe(1);
    // A narrower window allows less scale, so more of the gap goes to Fit view.
    const narrow = triageFor(
      reader(24),
      wikipediaSignals(undefined, { viewport: { width: 1000 } }),
    );
    expect(narrow).toMatchObject({
      zMax: 1.25,
      zoom: 1.25,
      verdict: 'compose',
    });
    // Too narrow for any scale: running text carries the whole gap.
    const phone = triageFor(
      reader(24),
      govukSignals(undefined, { viewport: { width: 390 } }),
    );
    expect(phone).toMatchObject({ zMax: 1, zoom: 1, residual: 1.263 });
    expect(phone.needs.text).toBe('compose');
  });

  it('never scales past k or zMax, and the residual carries the rest', () => {
    for (let body = 8; body <= 30; body += 0.5) {
      const t = triageFor(reader(24), wikipediaSignals({ bodyPx: body }));
      const k = 24 / body;
      expect((ZOOM_PRESETS as readonly number[]).concat(1)).toContain(t.zoom);
      expect(t.zoom).toBeLessThanOrEqual(
        Math.max(1, Math.min(k, t.zMax)) + 1e-9,
      );
      if (t.needs.text === 'fits') expect(t.zoom).toBe(1);
      expect(t.residual).toBeCloseTo(Math.max(1, k / t.zoom), 3);
      if (t.needs.text === 'tailor')
        // Inside zMax the next preset is at most 1.2 x the last.
        expect(t.residual).toBeLessThanOrEqual(1.2);
    }
  });

  it('measures the layout at the person’s own zoom when WebAble’s scale is already on', () => {
    const fresh = triageFor(reader(24), wikipediaSignals());
    // A repeat visit applied 150% before the page was read: the layout is 853 px wide.
    const measuredScaled = wikipediaSignals(
      { occlusion: 0.07 * 1.5 },
      { viewport: { width: 1280 / 1.5 } },
    );
    const again = triageFor(reader(24), measuredScaled, { scale: 1.5 });
    expect(again).toEqual(fresh);
    // Without the correction the narrower layout would change the verdict's scale.
    expect(triageFor(reader(24), measuredScaled).zoom).toBe(1);
  });

  it('is monotone in k: smaller text never gets a smaller verdict or scale', () => {
    for (const make of [govukSignals, wikipediaSignals, youtubeSignals]) {
      let last: TriageVerdict | null = null;
      for (let body = 40; body >= 6; body -= 0.25) {
        const t = triageFor(reader(24), make({ bodyPx: body }));
        if (last) {
          expect(t.k!).toBeGreaterThan(last.k!);
          expect(RANK[t.needs.text]).toBeGreaterThanOrEqual(
            RANK[last.needs.text],
          );
          expect(RANK[t.verdict]).toBeGreaterThanOrEqual(RANK[last.verdict]);
          expect(t.zoom).toBeGreaterThanOrEqual(last.zoom);
        }
        last = t;
      }
      expect(last?.verdict).not.toBe('fits');
    }
  });
});

describe('hysteresis (per template, 0.1 margin)', () => {
  const at = (k: number, prior?: TriageVerdict | null) =>
    triage({
      profile: reader(24),
      signals: wikipediaSignals({ bodyPx: 24 / k }),
      zoom: 1,
      prior,
    });

  it('needs a 0.1 margin past the fits threshold to change band', () => {
    const fits = at(1.1);
    expect(fits.needs.text).toBe('fits');
    expect(at(1.2).needs.text).toBe('tailor');
    expect(at(1.2, fits).needs.text).toBe('fits');
    expect(at(1.2, fits).zoom).toBe(1);
    expect(at(1.26, fits).needs.text).toBe('tailor');
    const tailor = at(1.2);
    expect(at(1.1, tailor).needs.text).toBe('tailor');
    expect(at(1.04, tailor).needs.text).toBe('fits');
  });

  it('needs the same margin around the breakpoint-safe zoom', () => {
    const tailor = at(1.5);
    expect(at(1.65).needs.text).toBe('compose');
    expect(at(1.65, tailor).needs.text).toBe('tailor');
    expect(at(1.71, tailor).needs.text).toBe('compose');
    const compose = at(1.8);
    expect(at(1.55, compose).needs.text).toBe('compose');
    expect(at(1.49, compose).needs.text).toBe('tailor');
  });

  it('keeps the template’s page scale while k stays within the margin', () => {
    const z150 = at(1.55);
    expect(z150.zoom).toBe(1.5);
    // On its own k = 1.48 would get 125%; within 0.1 of 1.5 it keeps 150%.
    expect(at(1.48).zoom).toBe(1.25);
    expect(at(1.48, z150).zoom).toBe(1.5);
    expect(at(1.35, z150).zoom).toBe(1.25);
    // Never past the breakpoint-safe zoom, whatever the prior said.
    const narrow = triage({
      profile: reader(24),
      signals: wikipediaSignals(
        { bodyPx: 24 / 1.55 },
        { viewport: { width: 1100 } },
      ),
      zoom: 1,
      prior: z150,
    });
    expect(narrow.zoom).toBe(1.25);
  });

  it('does not flip between visits when k wobbles around a threshold', () => {
    let prior: TriageVerdict | null = null;
    const seen = new Set<string>();
    for (let visit = 0; visit < 12; visit += 1) {
      const t = at(visit % 2 === 0 ? 1.12 : 1.19, prior);
      seen.add(`${t.needs.text}:${t.zoom}`);
      prior = t;
    }
    expect([...seen]).toEqual(['fits:1']);
  });

  it('applies to target, clutter and structure thresholds too', () => {
    const T44 = strongReaderProfile();
    T44.vision.textMinPx = { value: 16, source: 'measured', confidence: 0.8 };
    const page = (below44: number) =>
      govukSignals(undefined, {
        targets: { count: 100, below: { '44': below44, '56': 100, '72': 100 } },
      });
    const fits = triageFor(T44, page(8));
    expect(fits.needs.targets).toBe('fits');
    expect(triageFor(T44, page(15)).needs.targets).toBe('tailor');
    expect(triageFor(T44, page(15), { prior: fits }).needs.targets).toBe(
      'fits',
    );
    expect(triageFor(T44, page(21), { prior: fits }).needs.targets).toBe(
      'tailor',
    );

    const busy = highDistractionProfile();
    const dense = (leaf: number) =>
      youtubeSignals({ density: { leafPer100k: leaf } });
    const compose = triageFor(busy, dense(80));
    expect(compose.needs.clutter).toBe('compose');
    // Busy for this person, short of compose (the corpus's 75th percentile is 15).
    const lighter = dense(13);
    expect(triageFor(busy, lighter).needs.clutter).toBe('tailor');
    expect(triageFor(busy, lighter, { prior: compose }).needs.clutter).toBe(
      'compose',
    );

    const article = govukSignals({ readerable: 19 });
    expect(triageFor(reader(36), article).representable).toBe(false);
    const was = triageFor(reader(36), govukSignals());
    expect(triageFor(reader(36), article, { prior: was }).representable).toBe(
      true,
    );
  });

  it('ignores a prior from another triage version', () => {
    const fits = at(1.1);
    const stale = {
      ...fits,
      version: 'triage-0.9.0',
    } as unknown as TriageVerdict;
    expect(at(1.2, stale).needs.text).toBe('tailor');
  });
});

describe('re-presentability', () => {
  it('names every blocker, in order', () => {
    const all = youtubeSignals(
      {
        kind: {
          editor: true,
          application: true,
          canvas: true,
          videoPlayer: true,
          paywall: true,
          blockingOverlay: true,
          password: true,
          payment: true,
        },
        records: { count: 0, largest: 0, mainShare: 0 },
      },
      {},
    );
    expect(blockersOf(all)).toEqual([...TRIAGE_BLOCKERS]);
    expect(blockersOf(youtubeSignals())).toEqual([]);
  });

  it('needs readable prose, a stable collection over 40% of main, or a detail page', () => {
    const none = {
      readerable: 0,
      records: { count: 0, largest: 0, mainShare: 0 },
    };
    expect(blockersOf(govukSignals(none))).toEqual(['no_structure']);
    expect(blockersOf(govukSignals({ readerable: 21 }))).toEqual([]);
    expect(blockersOf(govukSignals({ readerable: 20 }))).toEqual([
      'no_structure',
    ]);
    expect(
      blockersOf(
        govukSignals({
          ...none,
          records: { count: 1, largest: 6, mainShare: 0.4 },
        }),
      ),
    ).toEqual([]);
    expect(
      blockersOf(
        govukSignals({
          ...none,
          records: { count: 1, largest: 4, mainShare: 0.9 },
        }),
      ),
    ).toEqual(['no_structure']);
    expect(
      blockersOf(
        govukSignals({
          ...none,
          records: { count: 2, largest: 12, mainShare: 0.3 },
        }),
      ),
    ).toEqual(['no_structure']);
    expect(
      blockersOf(govukSignals({ ...none, kind: { product: true } })),
    ).toEqual([]);
  });

  it('never re-presents password or payment pages, editors, players or open consent walls', () => {
    const cases: Array<[string, ReturnType<typeof youtubeSignals>]> = [
      ['password', youtubeSignals(undefined, { forms: { hasPassword: true } })],
      ['payment', youtubeSignals(undefined, { forms: { hasPayment: true } })],
      ['video_player', youtubeSignals({ kind: { videoPlayer: true } })],
      ['blocking_overlay', youtubeSignals({ kind: { blockingOverlay: true } })],
      ['paywall', youtubeSignals({ kind: { paywall: true } })],
      ['editor', editorSignals()],
    ];
    for (const [blocker, signals] of cases) {
      const t = triageFor(reader(36), signals);
      expect(t.blockers).toContain(blocker);
      expect(t.representable).toBe(false);
      // A compose need still gets Tailor; Fit view is not offered.
      expect(t.needs.text).toBe('compose');
      expect(t.verdict).toBe('tailor');
    }
  });
});

describe('needs', () => {
  it('compares targets at the CSS size that reaches T at the page scale', () => {
    const p = reader(24);
    p.motor.minTargetPx = { value: 44, source: 'measured', confidence: 0.8 };
    const scaled = triageFor(p, youtubeSignals());
    expect(scaled.zoom).toBe(1.5);
    // 44 / 1.5 = 29.3 CSS px: between the 24 (30) and 32 (50) counts.
    expect(scaled.reasons).toContainEqual({
      kind: 'small_targets',
      share: 0.37,
      targetPx: 44,
    });
    const own = reader(16);
    own.motor.minTargetPx = { value: 44, source: 'measured', confidence: 0.8 };
    expect(triageFor(own, youtubeSignals()).reasons).toContainEqual({
      kind: 'small_targets',
      share: 0.67,
      targetPx: 44,
    });
  });

  it('re-presents for targets only on a records page with no slack', () => {
    const T56 = largeTargetProfile(56);
    expect(triageFor(T56, youtubeSignals()).needs.targets).toBe('compose');
    const roomy = youtubeSignals(
      { slack: { rowSlackMin: 1.5 } },
      { targets: { crowded: 10 } },
    );
    expect(triageFor(T56, roomy).needs.targets).toBe('tailor');
    const notRecords = youtubeSignals({
      records: { count: 1, largest: 6, mainShare: 0.2 },
    });
    expect(triageFor(T56, notRecords).needs.targets).toBe('tailor');
  });

  it('gates clutter on the posterior, never the mean', () => {
    // Mean 0.4 but uncertain: P(benefit > 0) = 0.75, short of 0.8.
    const unsure = highDistractionProfile();
    unsure.attention.distraction = {
      mean: 0.4,
      sd: 0.6,
      confidence: 0.5,
      sources: ['behavior'],
    };
    expect(benefitPositive(unsure.attention.distraction)).toBeCloseTo(0.75, 2);
    expect(triageFor(unsure, youtubeSignals()).needs.clutter).toBe('tailor');
    // Mean 0.3 but certain: P = 0.999.
    const sure = highDistractionProfile();
    sure.attention.distraction = {
      mean: 0.3,
      sd: 0.1,
      confidence: 0.9,
      sources: ['behavior'],
    };
    expect(triageFor(sure, youtubeSignals()).needs.clutter).toBe('compose');
  });

  it('places the comfort percentile by the person’s posterior', () => {
    expect(comfortPercentile(0.5)).toBe(75);
    expect(comfortPercentile(1)).toBe(50);
    expect(comfortPercentile(0)).toBe(100);
    expect(comfortPercentile(0.8)).toBeCloseTo(60, 9);
  });

  it('reads density as a percentile of the reference pages', () => {
    const median = {
      leafPer100k: DENSITY_REFERENCE.leafPer100k[2]!,
      corners: DENSITY_REFERENCE.corners[2]!,
      fontSizes: DENSITY_REFERENCE.fontSizes[2]!,
      regions: DENSITY_REFERENCE.regions[2]!,
    };
    expect(densityPercentile(median)).toBeCloseTo(50, 9);
    expect(densityPercentile(govukSignals().layout!.density)).toBeLessThan(25);
    expect(
      densityPercentile(youtubeSignals().layout!.density),
    ).toBeGreaterThanOrEqual(90);
    expect(
      densityPercentile({
        leafPer100k: 1e6,
        corners: 1e6,
        fontSizes: 1e6,
        regions: 1e6,
      }),
    ).toBe(100);
    expect(
      densityPercentile({
        leafPer100k: 0,
        corners: 0,
        fontSizes: 0,
        regions: 0,
      }),
    ).toBeLessThanOrEqual(10);
  });

  it('reads the corpus’s busy pages as busy for a level-2 fit, and its calm pages as calm (docs/11 §2)', () => {
    // Density as the extractor measured it at 1440 × 900 (eval 2026-10-15).
    const busy = {
      youtubeSearch: {
        leafPer100k: 11.5,
        corners: 144,
        fontSizes: 5,
        regions: 5,
      },
      wikipedia: { leafPer100k: 11.6, corners: 116, fontSizes: 7, regions: 23 },
      amazonSearch: {
        leafPer100k: 17.1,
        corners: 155,
        fontSizes: 6,
        regions: 10,
      },
      github: { leafPer100k: 18.4, corners: 288, fontSizes: 6, regions: 12 },
    };
    const calm = {
      govuk: { leafPer100k: 1.2, corners: 28, fontSizes: 4, regions: 8 },
      webaim: { leafPer100k: 2, corners: 28, fontSizes: 6, regions: 5 },
      meta: { leafPer100k: 1.5, corners: 36, fontSizes: 4, regions: 7 },
    };
    // P(benefit > 0) = 0.8, the automatic restructure's own gate.
    const edge = comfortPercentile(0.8);
    for (const d of Object.values(busy))
      expect(densityPercentile(d)).toBeGreaterThan(edge);
    for (const d of Object.values(calm))
      expect(densityPercentile(d)).toBeLessThan(comfortPercentile(1));
  });

  it('grows occlusion with the page scale', () => {
    const p = reader(24);
    const covered = (occlusion: number) =>
      triageFor(p, wikipediaSignals({ occlusion }));
    // 0.12 x 1.5 = 0.18: offer to unpin. 0.22 x 1.5 = 0.33: re-present.
    expect(covered(0.12).needs.occlusion).toBe('tailor');
    expect(covered(0.22).needs.occlusion).toBe('compose');
    expect(covered(0.09).needs.occlusion).toBe('fits');
  });

  it('compares contrast with the person’s floor, and leaves forced colours alone', () => {
    const p = reader(16);
    p.vision.contrastFloor = { value: 7, source: 'measured', confidence: 0.8 };
    // 30 of 80 sampled are below 7:1.
    expect(triageFor(p, youtubeSignals()).reasons).toContainEqual({
      kind: 'low_contrast',
      share: 0.38,
    });
    expect(
      triageFor(p, youtubeSignals(undefined, { env: { forcedColors: true } }))
        .needs.contrast,
    ).toBe('fits');
    // The default floor is not evidence.
    expect(triageFor(reader(16), youtubeSignals()).needs.contrast).toBe('fits');
  });

  it('treats motion as a need only on the OS setting or a confident posterior', () => {
    const p = reader(16);
    expect(triageFor(p, youtubeSignals()).needs.motion).toBe('fits');
    p.attention.motion = {
      mean: 0.9,
      sd: 0.1,
      confidence: 0.8,
      sources: ['behavior'],
    };
    expect(triageFor(p, youtubeSignals()).reasons).toContainEqual({
      kind: 'motion',
      count: 3,
    });
    expect(triageFor(p, govukSignals()).needs.motion).toBe('fits');
  });

  it('gives structured reasons in need order, and none for needs that fit', () => {
    const t = triageFor(highDistractionProfile(), youtubeSignals());
    expect(t.reasons.map((r) => r.kind)).toEqual([
      'small_targets',
      'crowded_targets',
      'busy',
      'motion',
    ]);
    expect(triageFor(reader(36), govukSignals()).reasons).toEqual([
      { kind: 'small_text', k: 1.895 },
      { kind: 'cant_stretch', k: 1.895, zMax: 1.6 },
    ]);
    expect(triageFor(reader(18), govukSignals()).reasons).toEqual([]);
  });
});

describe('without layout features (an engine older than v2)', () => {
  it('is conservative: no page scale, nothing unmeasured, never re-presented', () => {
    const t = triageFor(strongReaderProfile(), articleSignals());
    expect(t).toEqual({
      version: TRIAGE_VERSION,
      verdict: 'tailor',
      k: 1.615,
      zoom: 1,
      zMax: 1,
      residual: 1.615,
      needs: {
        text: 'compose',
        targets: 'tailor',
        clutter: 'fits',
        occlusion: 'fits',
        contrast: 'fits',
        motion: 'fits',
      },
      reasons: [
        { kind: 'small_text', k: 1.615 },
        { kind: 'cant_stretch', k: 1.615, zMax: 1 },
        { kind: 'small_targets', share: 0.23, targetPx: 44 },
        { kind: 'crowded_targets', share: 0.11 },
      ],
      representable: false,
      blockers: ['no_structure'],
    });
  });
});

describe('purity', () => {
  it('is deterministic and never mutates its inputs', () => {
    const profile = highDistractionProfile();
    const signals = youtubeSignals();
    const prior = triageFor(reader(24), wikipediaSignals());
    const before = structuredClone({ profile, signals, prior });
    const a = triage({ profile, signals, zoom: 1, prior });
    const b = triage(structuredClone({ profile, signals, zoom: 1, prior }));
    expect(a).toEqual(b);
    expect({ profile, signals, prior }).toEqual(before);
  });
});
