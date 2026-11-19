// @vitest-environment node
import { youtube } from '@webable/core/compose/__fixtures__/index';
import {
  govukSignals,
  largeTextProfile,
  strongReaderProfile,
  workedExamplePage,
  youtubeSignals,
} from '@webable/core/policy/fixtures';
import type { FitProfile } from '@webable/core/profile/schema';
import type { Skeleton } from '@webable/core/skeleton/types';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FitViewOpenReply } from '../protocol';
import {
  createHarness,
  DOMAIN,
  loadPage,
  seedProfile,
  TAB,
  URL_A,
  type Harness,
} from './worker-harness';

/**
 * docs/11 §2 in the worker: who gets a page restructured on arrival, the
 * one-time intro, learning from "Original page", "Always here" from the
 * view's strip, the setting, and Tailor's page scale held back so nothing
 * zooms before the view.
 */

/** Tune's four Focus effects measured large: P(benefit > 0) ≈ 1, structure level 2. */
function focusFit(): FitProfile {
  const p = strongReaderProfile();
  const latent = {
    mean: 0.9,
    sd: 0.15,
    confidence: 0.8,
    sources: ['behavior' as const],
  };
  p.attention.distraction = { ...latent };
  p.attention.density = { ...latent };
  p.attention.chunking = { ...latent };
  p.attention.guidance = { ...latent };
  return p;
}

const request = (
  h: Harness,
  reason: Parameters<Harness['worker']['fitViewRequest']>[3] = 'auto',
  skeleton: Skeleton = youtube,
): Promise<FitViewOpenReply> =>
  h.worker.fitViewRequest(TAB, 0, skeleton, reason, URL_A);

const ok = (r: FitViewOpenReply) => {
  if (!r.ok) throw new Error(`refused: ${r.why}`);
  return r;
};

const opened = (h: Harness, reason: 'auto' | 'popup' | 'tab_mode' = 'auto') =>
  h.worker.fitViewEvent(TAB, 0, {
    kind: 'opened',
    source: 'heuristic',
    reason,
    ms: 30,
  });

/** "Original page" after `afterMs` with nothing done in the view. */
const original = (h: Harness, afterMs = 4000) =>
  h.worker.fitViewEvent(TAB, 0, {
    kind: 'closed',
    reason: 'original',
    afterMs,
    actions: 0,
  });

const zoomSets = (h: Harness) =>
  h.zoom.calls.filter((c) => c.kind === 'set').map((c) => c.factor);

let h: Harness;
beforeEach(async () => {
  h = createHarness();
  await seedProfile(h.stores, focusFit());
});

describe('restructured on arrival (docs/11 §2)', () => {
  it('a focus-like fit on a busy page: Fit view opens by itself, nothing zooms first, the intro once', async () => {
    const reply = await loadPage(h, youtubeSignals());
    // Busy for this person (the page never sees the person-relative needs).
    expect(
      (await h.worker.tabRecord(TAB))?.plan?.triage?.needs.clutter,
    ).not.toBe('fits');
    expect(reply).toMatchObject({ fitViewAuto: true });
    expect(reply.fitViewOffer).toBeUndefined();
    // Tailor's page scale waits for the view to close: no zoom, no page_zoom.
    expect(reply.plan.zoom).toBe(1);
    expect(reply.plan.ops.some((p) => p.op === 'page_zoom')).toBe(false);
    expect(zoomSets(h)).toEqual([]);

    const first = ok(await request(h));
    expect(first).toMatchObject({ intro: true, alwaysHere: false, zoom: 1 });
    await opened(h);
    expect((await h.stores.settings.read()).simplifyIntroShown).toBe(true);
    // The line is for the first automatic restructure ever, not every one.
    expect(ok(await request(h)).intro).toBeUndefined();
    // Opens the person asked for never carry it.
    expect(ok(await request(h, 'popup')).intro).toBeUndefined();
  });

  it('"Original page" returns to the site: Tailor’s scale is decided then, and the site is not restructured again in this tab', async () => {
    const reply = await loadPage(h, youtubeSignals());
    expect(reply.fitViewAuto).toBe(true);
    ok(await request(h));
    await opened(h);
    await original(h);
    // Tailor comes back: the next reading of this page view settles the scale.
    const again = await h.worker.signals(
      TAB,
      0,
      youtubeSignals(),
      { page: workedExamplePage(), regions: {} },
      URL_A,
    );
    expect(again.fitViewAuto).toBeUndefined();
    const z = again.plan.triage?.zoom ?? 1;
    expect(again.plan.zoom).toBe(z);
    if (z > 1) expect(zoomSets(h)).toEqual([z]);
    // The next page of the site in this tab is offered, not restructured.
    const next = await loadPage(h, youtubeSignals());
    expect(next.fitViewAuto).toBeUndefined();
    expect(next.fitViewOffer).toBe(true);
    // Another tab still gets it (one quick exit is not enough to learn from).
    const other = createHarness({ local: h.local });
    expect((await loadPage(other, youtubeSignals())).fitViewAuto).toBe(true);
  });

  it('an app that renders after load: the busy reading restructures it, the empty shell before it does not hold it back', async () => {
    // At DOMContentLoaded: a shell with no records and nothing to read.
    const shell = youtubeSignals({
      density: { leafPer100k: 1, corners: 20, fontSizes: 3, regions: 1 },
      records: { count: 0, largest: 0, mainShare: 0 },
      readerable: 0,
    });
    const first = await loadPage(h, shell);
    expect(first.fitViewAuto).toBeUndefined();
    expect(first.plan.triage?.representable).toBe(false);
    // The results arrive and the page is read again, same page view.
    const again = await h.worker.signals(
      TAB,
      0,
      youtubeSignals({ records: { count: 1, largest: 20, mainShare: 0.45 } }),
      { page: workedExamplePage(), regions: {} },
      URL_A,
    );
    expect(again.plan.triage?.representable).toBe(true);
    expect(again.fitViewAuto).toBe(true);
  });

  it('a text-only fit is never restructured on its own', async () => {
    const t = createHarness();
    await seedProfile(t.stores, largeTextProfile(28));
    const reply = await loadPage(t, youtubeSignals());
    expect(reply.fitViewAuto).toBeUndefined();
    // Triage says compose for its text: offered, and Tailor zooms as before.
    expect(reply.plan.triage?.verdict).toBe('compose');
    expect(reply.fitViewOffer).toBe(true);
    expect(zoomSets(t).length).toBe(1);
  });

  it('a calm page is left alone, with the popup switch still there', async () => {
    const reply = await loadPage(h, govukSignals());
    expect((await h.worker.tabRecord(TAB))?.plan?.triage?.needs.clutter).toBe(
      'fits',
    );
    expect(reply.fitViewAuto).toBeUndefined();
    expect(reply.fitViewOffer).toBeUndefined();
    const view = await h.worker.view(TAB);
    expect(view.fitView).toMatchObject({ available: true, open: false });
  });

  it('two quick "Original page" exits on a site make it an offer; "Always here" makes it automatic', async () => {
    for (let i = 0; i < 2; i++) {
      const tab = createHarness({ local: h.local });
      expect((await loadPage(tab, youtubeSignals())).fitViewAuto).toBe(true);
      ok(await request(tab));
      await opened(tab);
      await original(tab, 3000);
    }
    expect((await h.stores.sites.get(DOMAIN)).fitView).toMatchObject({
      undo: 2,
      keep: 0,
    });
    const third = createHarness({ local: h.local });
    const reply = await loadPage(third, youtubeSignals());
    expect(reply.fitViewAuto).toBeUndefined();
    expect(reply.fitViewOffer).toBe(true);

    // "Always here" from Fit view's strip: the site's rule, and Fit view
    // reopens by itself on the next page (tab mode at hello).
    ok(await request(third, 'offer'));
    await opened(third, 'popup');
    const sent = third.engine.of('sw:fitview').length;
    await third.worker.fitViewEvent(TAB, 0, { kind: 'always', on: true });
    expect((await third.stores.sites.get(DOMAIN)).rule.view).toBe('fit');
    // Already open: nothing is reopened.
    expect(third.engine.of('sw:fitview').length).toBe(sent);
    expect(ok(await request(third, 'tab_mode')).alwaysHere).toBe(true);
    const fresh = createHarness({ local: h.local });
    expect((await fresh.worker.hello(TAB, 0, URL_A)).fitViewTab).toBe(true);
    // ...and off again.
    await third.worker.fitViewEvent(TAB, 0, { kind: 'always', on: false });
    expect((await third.stores.sites.get(DOMAIN)).rule.view).toBeUndefined();
  });

  it('"Simplify busy pages automatically" off: offered everywhere instead', async () => {
    await h.worker.setPrefs({ autoSimplify: false });
    expect((await h.worker.prefs()).autoSimplify).toBe(false);
    const reply = await loadPage(h, youtubeSignals());
    expect(reply.fitViewAuto).toBeUndefined();
    expect(reply.fitViewOffer).toBe(true);
    await h.worker.setPrefs({ autoSimplify: true });
    const tab = createHarness({ local: h.local });
    expect((await loadPage(tab, youtubeSignals())).fitViewAuto).toBe(true);
  });

  it('never on excluded sites', async () => {
    const reply = await loadPage(h, youtubeSignals(), 'https://www.gov.uk/x');
    expect(reply.fitViewAuto).toBeUndefined();
  });

  it('a repeat visit that will open in Fit view is not zoomed at hello', async () => {
    // A text-and-focus fit: triage scales this page, and it is busy.
    const p = focusFit();
    p.vision.textMinPx = largeTextProfile(24).vision.textMinPx;
    const a = createHarness();
    await seedProfile(a.stores, p);
    const first = await loadPage(a, youtubeSignals());
    expect(first.fitViewAuto).toBe(true);
    expect(first.plan.triage?.zoom).toBeGreaterThan(1);
    expect(zoomSets(a)).toEqual([]);
    // The template remembers the scale that holds here for next time.
    const memo = Object.values((await a.stores.sites.get(DOMAIN)).templates)[0];
    expect(Object.values(memo?.zoom ?? {})[0]).toBeGreaterThan(1);

    // Next visit, another tab: still restructured, so no early zoom.
    const b = createHarness({ local: a.local });
    await b.worker.hello(TAB, 0, URL_A);
    expect(zoomSets(b)).toEqual([]);
    // With the setting off the same visit zooms at hello, as before.
    await a.worker.setPrefs({ autoSimplify: false });
    const c = createHarness({ local: a.local });
    await c.worker.hello(TAB, 0, URL_A);
    expect(zoomSets(c).length).toBe(1);
  });
});
