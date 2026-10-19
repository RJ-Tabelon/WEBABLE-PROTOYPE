// @vitest-environment node
import {
  govukSignals,
  largeTextProfile,
  strongReaderProfile,
  triageFor,
  wikipediaSignals,
} from '@webable/core/policy/fixtures';
import { triage } from '@webable/core/triage/triage';
import { describe, expect, it } from 'vitest';

import {
  firstScale,
  fromPrior,
  guardVerdict,
  isZoomReset,
  ladderIndex,
  OWN_ZOOM_WINDOW_MS,
  OwnZoom,
  sameFactor,
  stepDown,
  tabFactor,
  toPrior,
  widthBucket,
  withScale,
  zoomLevel,
} from './zoom';

describe('page scale rules', () => {
  it('scales over the person’s own zoom', () => {
    expect(tabFactor(1, 1.5)).toBe(1.5);
    expect(tabFactor(1.25, 1.1)).toBe(1.375);
    expect(tabFactor(0, 1.25)).toBe(1.25);
    expect(sameFactor(1.5, 1.509)).toBe(true);
    expect(sameFactor(1.5, 1.52)).toBe(false);
  });

  it('walks Chrome’s presets', () => {
    expect(ladderIndex(1)).toBe(0);
    expect(ladderIndex(1.1)).toBe(1);
    expect(ladderIndex(1.5)).toBe(3);
    expect(ladderIndex(2)).toBe(5);
    expect(stepDown(2)).toBe(1.75);
    expect(stepDown(1.25)).toBe(1.1);
    expect(stepDown(1.1)).toBe(1);
    expect(zoomLevel(1.1)).toBe(0);
    expect(zoomLevel(1.5)).toBe(2);
    expect(zoomLevel(2)).toBe(4);
  });

  it('buckets window widths and ignores unknown ones', () => {
    expect(widthBucket(1280)).toBe(8);
    expect(widthBucket(1300)).toBe(8);
    expect(widthBucket(1440)).toBe(9);
    expect(widthBucket(null)).toBeNull();
    expect(widthBucket(0)).toBeNull();
    expect(widthBucket(Number.NaN)).toBeNull();
  });

  it('keeps a scale applied at hello when triage is within one preset of it', () => {
    expect(firstScale(1.5, null)).toBe(1.5);
    expect(firstScale(1.5, 1.25)).toBe(1.25);
    expect(firstScale(1.75, 1.5)).toBe(1.5);
    expect(firstScale(2, 1.25)).toBe(2);
    // Triage now says no scale: none.
    expect(firstScale(1, 1.5)).toBe(1);
  });

  it('a frozen scale changes the verdict’s zoom and residual only', () => {
    const t = triageFor(strongReaderProfile(), wikipediaSignals());
    expect(t.zoom).toBe(1.5);
    const held = withScale(t, 1.25);
    expect(held).toMatchObject({ zoom: 1.25, residual: 1.2 });
    expect(held.needs).toEqual(t.needs);
    expect(held.verdict).toBe(t.verdict);
    expect(withScale(t, 1.5)).toBe(t);
  });

  it('a stored prior gives triage the same hysteresis as the verdict', () => {
    const profile = largeTextProfile(36);
    const first = triageFor(profile, govukSignals());
    expect(first.verdict).toBe('compose');
    const prior = fromPrior(toPrior(first));
    expect(prior.needs).toEqual(first.needs);
    expect(prior.zoom).toBe(first.zoom);
    // Body text a little larger: k just under the compose edge, held by the prior.
    const signals = govukSignals({ bodyPx: 22.8 });
    const fresh = triage({ profile, signals, zoom: 1 });
    const held = triage({ profile, signals, zoom: 1, prior });
    expect(fresh.needs.text).toBe('tailor');
    expect(held.needs.text).toBe('compose');
  });

  it('the guard steps down on overflow, or on navigation lost against 100%', () => {
    const report = {
      zoom: 1.5,
      overflowPx: 0,
      navLinks: 5,
      searchVisible: true,
    };
    const base = { links: 5, search: true };
    expect(guardVerdict(report, base)).toBe('ok');
    expect(guardVerdict({ ...report, overflowPx: 9 }, base)).toBe('overflow');
    expect(guardVerdict({ ...report, overflowPx: 8 }, base)).toBe('ok');
    expect(guardVerdict({ ...report, navLinks: 4 }, base)).toBe('nav_hidden');
    expect(guardVerdict({ ...report, searchVisible: false }, base)).toBe(
      'nav_hidden',
    );
    // A page first read already scaled has no 100% baseline: overflow only.
    expect(guardVerdict({ ...report, navLinks: 0 }, null)).toBe('ok');
    // A page with no search field never fails for it.
    expect(
      guardVerdict(
        { ...report, searchVisible: false },
        { links: 5, search: false },
      ),
    ).toBe('ok');
  });

  it('the guard steps down when the scale cuts off a share of the titles on screen (eval m1)', () => {
    const report = {
      zoom: 1.5,
      overflowPx: 0,
      navLinks: 5,
      searchVisible: true,
    };
    const base = { links: 5, search: true };
    // GitHub at 150%: commit messages of the file list lose their text.
    expect(
      guardVerdict({ ...report, newlyEllipsised: 12, titlesShown: 40 }, base),
    ).toBe('truncation');
    // One or two long titles losing a word are no breakpoint.
    expect(
      guardVerdict({ ...report, newlyEllipsised: 2, titlesShown: 4 }, base),
    ).toBe('ok');
    expect(
      guardVerdict({ ...report, newlyEllipsised: 5, titlesShown: 60 }, base),
    ).toBe('ok');
    // Its own baseline: it counts on a repeat visit too, after overflow and nav.
    expect(
      guardVerdict({ ...report, newlyEllipsised: 9, titlesShown: 20 }, null),
    ).toBe('truncation');
    expect(
      guardVerdict(
        { ...report, navLinks: 4, newlyEllipsised: 9, titlesShown: 20 },
        base,
      ),
    ).toBe('nav_hidden');
    // An older content script sends no count: unchanged verdicts.
    expect(guardVerdict(report, base)).toBe('ok');
  });

  it('a reset to the default or the person’s zoom counts as Undo', () => {
    expect(isZoomReset(1, 1, undefined)).toBe(true);
    expect(isZoomReset(1.25, 1.25, 1)).toBe(true);
    expect(isZoomReset(0.9, 1.25, 0.9)).toBe(true);
    expect(isZoomReset(1.75, 1, 1)).toBe(false);
  });
});

describe('WebAble’s own zoom calls', () => {
  it('recognises a factor it set, once, for a few seconds', () => {
    const own = new OwnZoom();
    own.expect(1, 1.5, 0);
    expect(own.consume(2, 1.5, 10)).toBe(false);
    expect(own.consume(1, 1.75, 10)).toBe(false);
    expect(own.consume(1, 1.505, 10)).toBe(true);
    expect(own.consume(1, 1.5, 10)).toBe(false);
    own.expect(1, 1.25, 0);
    expect(own.consume(1, 1.25, OWN_ZOOM_WINDOW_MS + 1)).toBe(false);
    own.expect(1, 1.25, 0);
    own.forget(1);
    expect(own.consume(1, 1.25, 1)).toBe(false);
  });
});
