import { defaultFitProfile } from '@webable/core/profile/defaults';
import type { FitProfile as AccountFit } from '@webable/core/profile/schema';
import { defaultFit, fitSources } from '@webable/engine';
import { describe, expect, it } from 'vitest';

import { fromAccountFit, parseAccountFit } from './fit';
import { domainOf, siteList } from './sites';

const NOW = new Date('2026-11-18T12:00:00.000Z');

function tuned(): AccountFit {
  const f = defaultFitProfile(undefined, NOW);
  return {
    ...f,
    calibrationVersion: 'cal-3',
    modules: { reading: 'measured', pointing: 'measured', focus: 'skipped' },
    vision: {
      ...f.vision,
      textMinPx: {
        value: 22,
        source: 'measured',
        confidence: 0.8,
        measured: 22,
      },
      contrastFloor: {
        value: 7,
        source: 'measured',
        confidence: 0.7,
        measured: 7,
      },
      lineHeight: { value: 1.6, source: 'measured', confidence: 0.6 },
      maxLineCh: { value: 66, source: 'measured', confidence: 0.6 },
    },
    motor: {
      ...f.motor,
      minTargetPx: { value: 44, source: 'measured', confidence: 0.7 },
      steadyClicks: {
        value: { on: true, windowMs: 300, radiusPx: 12 },
        source: 'measured',
        confidence: 0.7,
      },
    },
  };
}

describe('account fit', () => {
  it('parses a saved profile and refuses anything else', () => {
    expect(parseAccountFit(tuned())).not.toBeNull();
    expect(parseAccountFit({ v: 2 })).toBeNull();
    expect(parseAccountFit(null)).toBeNull();
  });

  it('carries what Tune measured into the engine fit', () => {
    const fit = fromAccountFit(tuned());
    expect(fit.v).toBe('fit.1');
    expect(fit.createdAt).toBe(NOW.toISOString());
    expect(fit.text).toMatchObject({
      bodyPx: 22,
      source: 'measured',
      override: null,
    });
    expect(fit.contrast).toEqual({ band: 'M', floor: 7 });
    expect(fit.spacing.lineHeight).toBe(1.6);
    expect(fit.measure).toMatchObject({ targetCpl: 66, maxCpl: 66 });
    expect(fit.targets.minPx).toBe(44);
    expect(fit.clicks.steady).toEqual({
      on: true,
      windowMs: 300,
      radiusPx: 12,
    });
    expect(fit.calibration.skipped).toEqual(['focus']);
    const src = fitSources(fit);
    expect(src.text_size).toBe('warmup');
    expect(src.targets).toBe('warmup');
    expect(src.motion).toBe('default');
  });

  it('leaves what Tune did not measure at the engine defaults', () => {
    const fit = fromAccountFit(defaultFitProfile(undefined, NOW));
    const base = defaultFit();
    expect(fit.text.bodyPx).toBe(16);
    expect(fit.text.source).toBe('default');
    expect(fit.contrast).toEqual(base.contrast);
    expect(fit.targets.minPx).toBeNull();
    expect(fit.attention).toEqual(base.attention);
    expect(Object.values(fitSources(fit)).every((s) => s === 'default')).toBe(
      true,
    );
  });

  it('keeps a size the person chose as theirs', () => {
    const f = tuned();
    f.vision.textMinPx = {
      value: 26,
      source: 'override',
      confidence: 1,
      measured: 22,
      override: 26,
    };
    const fit = fromAccountFit(f);
    expect(fit.text.override).toBe(26);
    expect(fitSources(fit).text_size).toBe('person');
  });
});

describe('sites', () => {
  it('treats an origin and a domain as the same site', () => {
    expect(domainOf('https://www.npr.org')).toBe('npr.org');
    expect(domainOf('www.NPR.org')).toBe('npr.org');
    expect(domainOf('npr.org')).toBe('npr.org');
  });

  it('lists paused sites and sites with saved choices once each', () => {
    const list = siteList(['https://www.npr.org', 'cbsnews.com'], {
      'npr.org': { textStep: 1 },
      'consumerfinance.gov': { column: 'off' },
    });
    expect(list.map((s) => [s.domain, s.paused])).toEqual([
      ['cbsnews.com', true],
      ['consumerfinance.gov', false],
      ['npr.org', true],
    ]);
  });
});
