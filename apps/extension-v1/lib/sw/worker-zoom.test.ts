// @vitest-environment node
import {
  articleSignals,
  strongReaderProfile,
  wikipediaSignals,
  workedExamplePage,
} from '@webable/core/policy/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';

import { REASON_WINDOW_MS } from './undo';
import { toContent } from './worker';
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
 * Page scale (docs/10 §5.1) and triage in the plan path (§3): the worker
 * decides the scale once per page view, zooms the tab per tab over the
 * person's own zoom, freezes it, gives way to the person's zoom, steps down
 * when the zoom guard says so, and brings it back early on repeat visits.
 */

let h: Harness;
beforeEach(async () => {
  h = createHarness();
  await seedProfile(h.stores, strongReaderProfile());
});

const sets = (env: Harness) =>
  env.zoom.calls.filter((c) => c.kind === 'set').map((c) => c.factor);

describe('triage in the plan path', () => {
  it('passes the verdict to the policy and strips the fit before the content script', async () => {
    const { plan } = await loadPage(h, wikipediaSignals());
    // Strong reader (21 px) on 14 px body text: k = 1.5, within the breakpoint-safe zoom.
    const full = (await h.worker.tabRecord(TAB))?.plan?.triage;
    expect(full).toMatchObject({ verdict: 'tailor', k: 1.5, zoom: 1.5 });
    expect(full?.reasons.length).toBeGreaterThan(0);

    expect(plan.triage).toMatchObject({
      verdict: 'tailor',
      representable: true,
      zoom: 1.5,
      blockers: [],
      k: null,
      residual: 1,
      reasons: [],
    });
    expect(Object.values(plan.triage!.needs).every((b) => b === 'fits')).toBe(
      true,
    );
    // Nothing person-relative from triage reaches the page.
    expect(JSON.stringify(plan.triage)).not.toMatch(
      /small_text|small_targets|targetPx|"k":1/,
    );
    expect(plan.zoom).toBe(1.5);
    expect(plan.ops.find((p) => p.op === 'page_zoom')).toMatchObject({
      mode: 'auto',
      level: 2,
    });

    // The popup gets the one-line explanation.
    expect((await h.worker.view(TAB)).triageLine).toMatch(/for your fit\.$/);
  });

  it('toContent leaves a plan without triage alone', () => {
    const plan = {
      id: 'p',
      createdAt: 0,
      category: 'article' as const,
      basis: 'local' as const,
      ops: [],
    };
    expect(toContent(plan)).toBe(plan);
  });

  it('a page that fits gets no page scale and no automatic text change', async () => {
    // Already zoomed to 150% by the person: 14 px x 1.5 = 21 px.
    h.zoom.person(TAB, 1.5);
    const { plan } = await loadPage(h, wikipediaSignals());
    expect(plan.triage?.verdict).not.toBe('compose');
    expect(plan.ops.some((p) => p.op === 'page_zoom')).toBe(false);
    expect(sets(h)).toEqual([]);
    expect(h.zoom.factor(TAB)).toBe(1.5);
  });

  it('never scales a page read by an engine without layout features', async () => {
    const { plan } = await loadPage(h, articleSignals());
    expect(plan.zoom).toBe(1);
    expect(plan.ops.some((p) => p.op === 'page_zoom')).toBe(false);
    expect(h.zoom.calls).toEqual([]);
  });

  it('stores the verdict as the template prior, dropped when the profile changes', async () => {
    await loadPage(h, wikipediaSignals());
    const site = await h.stores.sites.get(DOMAIN);
    const memos = Object.values(site.templates);
    expect(memos).toHaveLength(1);
    expect(memos[0]).toMatchObject({
      id: 'account:1',
      prior: { zoom: 1.5, needs: { text: 'tailor' } },
      zoom: { '8': 1.5 },
    });
    // Nothing in the record names the path.
    expect(JSON.stringify(site.templates)).not.toMatch(/story|news/);

    await h.stores.profile.write({
      profile: strongReaderProfile(),
      source: 'account',
      version: 2,
      fetchedAt: 0,
    });
    await h.worker.profileChanged();
    h.zoom.navigate(TAB);
    await h.worker.hello(TAB, 0, URL_A);
    // The new profile's first visit: no early scale from the old identity.
    expect((await h.worker.tabRecord(TAB))?.zoom).toBeNull();
  });
});

describe('page scale', () => {
  it('zooms the tab once per page view, over the person’s own zoom, and freezes it', async () => {
    const { plan } = await loadPage(h, wikipediaSignals());
    expect(plan.zoom).toBe(1.5);
    expect(sets(h)).toEqual([1.5]);
    expect(h.zoom.scope.get(TAB)).toBe('per-tab');
    const zoomMsg = h.engine.of('sw:zoom');
    // The absolute factor, and the page scale over the person's zoom.
    expect(zoomMsg.at(-1)).toEqual({
      type: 'sw:zoom',
      zoom: 1.5,
      owner: 'webable',
      scale: 1.5,
    });
    const view = await h.worker.view(TAB);
    expect(view.changes.find((c) => c.op === 'page_zoom')).toMatchObject({
      status: 'applied',
      fit: { before: '100%', after: '150%' },
    });
    const applied = (await h.stores.events.list()).filter(
      (e) => e.op === 'page_zoom' && e.kind === 'applied',
    );
    expect(applied).toHaveLength(1);

    // An SPA route re-reads the page with much smaller text: the scale stays.
    const reread = await h.worker.signals(
      TAB,
      0,
      wikipediaSignals({ bodyPx: 11 }, { viewport: { width: 853 } }),
      { page: workedExamplePage(), regions: {} },
      `${URL_A}/next`,
    );
    expect(reread.plan.zoom).toBe(1.5);
    // A settings re-plan keeps it too, and never resets the zoom.
    await h.worker.setLevel(TAB, 'text_floor', 3, 'site');
    const last = h.engine.of('sw:plan').at(-1);
    expect(last?.plan.zoom).toBe(1.5);
    expect(sets(h)).toEqual([1.5]);
    expect(h.zoom.calls.some((c) => c.kind === 'release')).toBe(false);
  });

  it('ignores the zoom events its own calls and navigation cause', async () => {
    await loadPage(h, wikipediaSignals());
    await h.worker.zoomChanged(TAB, 1, 1.5, { scope: 'per-tab' });
    // Chrome puts the site's zoom back when the tab navigates.
    await h.worker.zoomChanged(TAB, 1.5, 1, { scope: 'per-origin' });
    const record = await h.worker.tabRecord(TAB);
    expect(record?.zoom).toMatchObject({ z: 1.5, factor: 1.5 });
    expect((await h.stores.sites.get(DOMAIN)).rule.blocks).not.toContain(
      'page_zoom',
    );
  });

  it('the person’s own zoom wins: their factor is kept per site and page scale stops there', async () => {
    await loadPage(h, wikipediaSignals());
    const before = h.engine.received.length;
    await h.worker.zoomChanged(TAB, 1.5, 1.75, {
      scope: 'per-tab',
      defaultZoomFactor: 1,
    });
    expect(h.zoom.calls.at(-1)).toEqual({
      kind: 'release',
      tabId: TAB,
      factor: 1.75,
    });
    expect(h.zoom.scope.get(TAB)).toBe('per-origin');
    expect(h.zoom.factor(TAB)).toBe(1.75);
    const after = h.engine.received.slice(before);
    expect(after).toContainEqual({
      type: 'sw:zoom',
      zoom: 1.75,
      owner: 'person',
      scale: 1,
    });
    // Text is planned again at the person's zoom.
    expect(after.some((m) => m.type === 'sw:plan')).toBe(true);
    const site = await h.stores.sites.get(DOMAIN);
    expect(site.rule.blocks).toContain('page_zoom');
    // Not an undo: no undo event for the page scale.
    h.clock.advance(REASON_WINDOW_MS + 1);
    await h.worker.flushUndos();
    expect(
      (await h.stores.events.list()).some(
        (e) => e.op === 'page_zoom' && e.kind === 'undo',
      ),
    ).toBe(false);

    // Next page view on the site: the person's zoom stays theirs.
    h.zoom.navigate(TAB);
    const next = await loadPage(h, wikipediaSignals());
    expect(next.plan.ops.some((p) => p.op === 'page_zoom')).toBe(false);
    expect(sets(h)).toEqual([1.5]);
  });

  it('Chrome’s zoom-bubble Reset counts as Undo of the page scale', async () => {
    await loadPage(h, wikipediaSignals());
    await h.worker.zoomChanged(TAB, 1.5, 1, {
      scope: 'per-tab',
      defaultZoomFactor: 1,
    });
    expect(h.zoom.factor(TAB)).toBe(1);
    const view = await h.worker.view(TAB);
    expect(view.undoneByYou).toContain('page_zoom');
    expect(view.changes.some((c) => c.op === 'page_zoom')).toBe(false);
    h.clock.advance(REASON_WINDOW_MS + 1);
    await h.worker.flushUndos();
    expect(
      (await h.stores.events.list()).filter(
        (e) => e.op === 'page_zoom' && e.kind === 'undo',
      ),
    ).toHaveLength(1);
  });

  it('Undo restores the person’s own zoom, not 100%, and sizes text again', async () => {
    h.zoom.person(TAB, 1.25);
    const { plan } = await loadPage(h, wikipediaSignals());
    // k = 21 / (14 x 1.25) = 1.2: one preset over the person's 125%.
    expect(plan.zoom).toBe(1.1);
    expect(h.zoom.factor(TAB)).toBe(1.375);
    const plans = h.engine.of('sw:plan').length;
    await h.worker.undo(TAB, 'page_zoom');
    expect(h.zoom.calls.at(-1)).toEqual({ kind: 'release', tabId: TAB });
    expect(h.zoom.factor(TAB)).toBe(1.25);
    expect(h.engine.of('sw:zoom').at(-1)).toMatchObject({ zoom: 1.25 });
    // The text floor was planned for the scale: it is planned again without it.
    expect(h.engine.of('sw:plan').length).toBeGreaterThan(plans);
    expect(h.engine.of('sw:plan').at(-1)?.plan.zoom).toBe(1);
    expect((await h.stores.sites.get(DOMAIN)).rule.blocks).toContain(
      'page_zoom',
    );
  });

  it('sends the person’s own zoom with every plan, so the page sizes for the tab’s whole zoom', async () => {
    // At 125% of their own and WebAble's 110%, the tab shows 137.5%: the
    // 21 px fit is 21 / 1.375 CSS px, not 21 / 1.1 (text 25% larger than
    // the fit).
    h.zoom.person(TAB, 1.25);
    const { plan } = await loadPage(h, wikipediaSignals());
    expect(plan).toMatchObject({ zoom: 1.1, ownZoom: 1.25 });
    // Every later plan says it too.
    await h.worker.setLevel(TAB, 'text_floor', 3, 'site');
    expect(h.engine.of('sw:plan').at(-1)?.plan).toMatchObject({
      zoom: 1.1,
      ownZoom: 1.25,
    });
    // The person takes zoom over at 175%: plans follow their zoom.
    await h.worker.zoomChanged(TAB, 1.375, 1.75, {
      scope: 'per-tab',
      defaultZoomFactor: 1,
    });
    expect(h.engine.of('sw:plan').at(-1)?.plan).toMatchObject({
      zoom: 1,
      ownZoom: 1.75,
    });
  });

  it('steps down one preset when the scale hides navigation, once per page view', async () => {
    await loadPage(h, wikipediaSignals());
    // At 100% the page showed 5 primary-nav links and its search field.
    await h.worker.applied(TAB, 0, h.engine.changes, {
      zoom: 1.5,
      overflowPx: 0,
      navLinks: 2,
      searchVisible: true,
    });
    expect(sets(h)).toEqual([1.5, 1.25]);
    const view = await h.worker.view(TAB);
    expect(view.changes.find((c) => c.op === 'page_zoom')).toMatchObject({
      status: 'applied',
      vcode: 'nav_hidden',
      fit: { after: '125%' },
    });
    expect(h.engine.of('sw:plan').at(-1)?.plan.zoom).toBe(1.25);
    expect(
      (await h.stores.events.list()).find(
        (e) => e.op === 'page_zoom' && e.kind === 'verifier',
      ),
    ).toMatchObject({ pass: false, vcode: 'nav_hidden' });
    // The template now remembers the smaller scale.
    const memo = Object.values((await h.stores.sites.get(DOMAIN)).templates)[0];
    expect(memo?.zoom).toEqual({ '8': 1.25 });

    // At most one step per page view.
    await h.worker.applied(TAB, 0, h.engine.changes, {
      zoom: 1.25,
      overflowPx: 40,
      navLinks: 1,
      searchVisible: false,
    });
    expect(sets(h)).toEqual([1.5, 1.25]);
  });

  it('a scale that overflows at the smallest preset comes off, marked overflow', async () => {
    // 17 px over 14 px text: k = 1.21, the smallest preset.
    const profile = strongReaderProfile();
    profile.vision.textMinPx.value = 17;
    await seedProfile(h.stores, profile);
    const { plan } = await loadPage(h, wikipediaSignals());
    expect(plan.zoom).toBe(1.1);
    await h.worker.applied(TAB, 0, h.engine.changes, {
      zoom: 1.1,
      overflowPx: 30,
      navLinks: 5,
      searchVisible: true,
    });
    expect(h.zoom.factor(TAB)).toBe(1);
    const change = (await h.worker.view(TAB)).changes.find(
      (c) => c.op === 'page_zoom',
    );
    expect(change).toMatchObject({
      status: 'undone_by_checks',
      vcode: 'overflow',
    });
    expect(h.engine.of('sw:plan').at(-1)?.plan.zoom).toBe(1);
  });

  it('a scale that holds is recorded as passing, once', async () => {
    await loadPage(h, wikipediaSignals());
    const ok = { zoom: 1.5, overflowPx: 0, navLinks: 5, searchVisible: true };
    await h.worker.applied(TAB, 0, h.engine.changes, ok);
    await h.worker.applied(TAB, 0, h.engine.changes, ok);
    const verifier = (await h.stores.events.list()).filter(
      (e) => e.op === 'page_zoom' && e.kind === 'verifier',
    );
    expect(verifier).toHaveLength(1);
    expect(verifier[0]).toMatchObject({ pass: true });
    expect(sets(h)).toEqual([1.5]);
  });

  it('brings the scale back at hello on a repeat visit, before the page is read', async () => {
    await loadPage(h, wikipediaSignals());
    // Navigating resets per-tab zoom in Chrome.
    h.zoom.navigate(TAB);
    expect(h.zoom.factor(TAB)).toBe(1);
    await h.worker.hello(TAB, 0, `${URL_A}`);
    expect(h.zoom.factor(TAB)).toBe(1.5);
    expect((await h.worker.tabRecord(TAB))?.zoom).toMatchObject({
      z: 1.5,
      early: true,
    });
    // Read at 150%: the layout is 853 px wide; triage confirms the same scale.
    const reply = await h.worker.signals(
      TAB,
      0,
      wikipediaSignals(undefined, { viewport: { width: 853 } }),
      {
        page: workedExamplePage(),
        regions: {},
      },
      URL_A,
    );
    expect(reply.plan.zoom).toBe(1.5);
    expect(sets(h)).toEqual([1.5, 1.5]);
    // A different window width bucket has nothing cached.
    const narrow = createHarness({ width: 900, local: h.local });
    await narrow.worker.hello(TAB, 0, URL_A);
    expect(narrow.zoom.calls).toEqual([]);
  });

  it('a second hello in the same document keeps track of the scale, never stacking it', async () => {
    await loadPage(h, wikipediaSignals());
    // No navigation: the engine was injected again (the popup), Chrome kept the zoom.
    await h.worker.hello(TAB, 0, URL_A);
    expect(h.zoom.factor(TAB)).toBe(1.5);
    expect((await h.worker.tabRecord(TAB))?.zoom).toMatchObject({
      z: 1.5,
      factor: 1.5,
      previous: 1,
    });
    const reply = await h.worker.signals(
      TAB,
      0,
      wikipediaSignals(undefined, { viewport: { width: 853 } }),
      { page: workedExamplePage(), regions: {} },
      URL_A,
    );
    expect(reply.plan.zoom).toBe(1.5);
    expect(sets(h)).toEqual([1.5]);
  });

  it('pausing the site or turning WebAble off gives the tab its own zoom back, and the site keeps its own', async () => {
    h.zoom.person(TAB, 1.25);
    await loadPage(h, wikipediaSignals());
    await h.worker.pauseSite(TAB, true);
    expect(h.zoom.factor(TAB)).toBe(1.25);
    expect(h.zoom.scope.get(TAB)).toBe('per-origin');

    // A site with no zoom of its own: the page scale must not become its
    // zoom, or every later page there opens zoomed, paused or not.
    const e2 = createHarness();
    await seedProfile(e2.stores, strongReaderProfile());
    await loadPage(e2, wikipediaSignals());
    expect(e2.zoom.factor(TAB)).toBe(1.5);
    await e2.worker.setEnabled(false);
    expect(e2.zoom.factor(TAB)).toBe(1);
    e2.zoom.navigate(TAB);
    expect(e2.zoom.factor(TAB)).toBe(1);
  });

  it('resuming a paused site, or turning WebAble back on, puts the same page scale back', async () => {
    // Pausing is no Undo: the page view's scale stays decided, and resuming
    // gives the page what it had (the scale plus the residual text), not
    // the whole fit in text at 100% as a different composition.
    const { plan } = await loadPage(h, wikipediaSignals());
    expect(plan.zoom).toBe(1.5);
    // The scale is back before the page's own changes are (sw:resume).
    const atResume: number[] = [];
    const handle = h.engine.handle.bind(h.engine);
    h.engine.handle = (msg) => {
      if (msg.type === 'sw:resume') atResume.push(h.zoom.factor(TAB));
      return handle(msg);
    };
    await h.worker.pauseSite(TAB, true);
    expect(h.zoom.factor(TAB)).toBe(1);
    await h.worker.pauseSite(TAB, false);
    expect(h.zoom.factor(TAB)).toBe(1.5);
    expect(h.engine.of('sw:plan').at(-1)?.plan.zoom).toBe(1.5);
    expect((await h.worker.tabRecord(TAB))?.scale?.z).toBe(1.5);
    expect(
      (await h.worker.view(TAB)).changes.filter((c) => c.op === 'page_zoom'),
    ).toHaveLength(1);

    await h.worker.setEnabled(false);
    expect(h.zoom.factor(TAB)).toBe(1);
    await h.worker.setEnabled(true);
    expect(h.zoom.factor(TAB)).toBe(1.5);
    expect(h.engine.of('sw:plan').at(-1)?.plan.zoom).toBe(1.5);
    expect(sets(h)).toEqual([1.5, 1.5, 1.5]);
    expect(atResume).toEqual([1.5, 1.5]);
  });

  it('a page scale the person undid stays off when the site is paused and resumed', async () => {
    await loadPage(h, wikipediaSignals());
    await h.worker.undo(TAB, 'page_zoom');
    await h.worker.pauseSite(TAB, true);
    await h.worker.pauseSite(TAB, false);
    expect(h.zoom.factor(TAB)).toBe(1);
    expect(h.engine.of('sw:plan').at(-1)?.plan.zoom).toBe(1);
    expect(sets(h)).toEqual([1.5]);
  });

  it('a zoom an older WebAble version left on the tab is put back', async () => {
    const e = createHarness();
    await seedProfile(e.stores, strongReaderProfile());
    await e.worker.hello(TAB, 0, URL_A);
    await e.session.set({
      'wa.tabs': {
        [TAB]: {
          ...(await e.worker.tabRecord(TAB)),
          zoom: { level: 2, factor: 1.5, previous: 1 },
        },
      },
    });
    // A restarted worker reads the old record.
    const restarted = createHarness({ local: e.local, session: e.session });
    await restarted.worker.signals(
      TAB,
      0,
      articleSignals(),
      {
        page: workedExamplePage(),
        regions: {},
      },
      URL_A,
    );
    expect(restarted.zoom.calls[0]).toEqual({ kind: 'release', tabId: TAB });
  });
});

describe('pages whose text renders after DOMContentLoaded', () => {
  /** An SPA's shell at DOMContentLoaded: an empty app root, no text to size yet. */
  const shell = (width?: number) =>
    wikipediaSignals(
      {
        bodyPx: null,
        readerable: 0,
        records: { count: 0, largest: 0, mainShare: 0 },
        nav: { primaryLinks: 0, searchVisible: false },
      },
      {
        text: { histogram: [], totalChars: 0, mainFontPx: null },
        ...(width ? { viewport: { width } } : {}),
      },
    );
  const read = (signals: ReturnType<typeof shell>, url = URL_A) =>
    h.worker.signals(
      TAB,
      0,
      signals,
      { page: workedExamplePage(), regions: {} },
      url,
    );

  it('decide the page scale at the first reading with body text, and cache only that one', async () => {
    const first = await loadPage(h, shell());
    expect(first.plan.triage?.blockers).toContain('no_structure');
    // Nothing to size yet: no scale on the tab, none frozen, and nothing
    // the template's next visit would read.
    expect(first.plan.zoom).toBe(1);
    expect(first.plan.ops.some((p) => p.op === 'page_zoom')).toBe(false);
    expect(h.zoom.calls).toEqual([]);
    expect((await h.worker.tabRecord(TAB))?.scale).toBeNull();
    expect((await h.stores.sites.get(DOMAIN)).templates).toEqual({});

    // The content renders: the scale is decided now, once.
    const content = await read(wikipediaSignals());
    expect(content.plan.zoom).toBe(1.5);
    expect(sets(h)).toEqual([1.5]);
    const tab = await h.worker.tabRecord(TAB);
    expect(tab?.scale?.z).toBe(1.5);
    // The zoom guard compares with the content's navigation, not the shell's.
    expect(tab?.navBaseline).toEqual({ links: 5, search: true });
    const memos = Object.values((await h.stores.sites.get(DOMAIN)).templates);
    expect(memos).toHaveLength(1);
    expect(memos[0]).toMatchObject({
      prior: { zoom: 1.5, needs: { text: 'tailor' }, blockers: [] },
      zoom: { '8': 1.5 },
    });

    // Frozen from here: an SPA route that reads empty while it loads
    // changes nothing and is not cached either.
    const route = await read(shell(853), `${URL_A}/next`);
    expect(route.plan.zoom).toBe(1.5);
    expect(sets(h)).toEqual([1.5]);
    expect(
      Object.keys((await h.stores.sites.get(DOMAIN)).templates),
    ).toHaveLength(1);
  });

  it('a repeat visit keeps the cached scale through the empty reading, and the content confirms it', async () => {
    await loadPage(h, shell());
    await read(wikipediaSignals());
    h.zoom.navigate(TAB);
    await h.worker.hello(TAB, 0, URL_A);
    expect(h.zoom.factor(TAB)).toBe(1.5);

    // The shell, read at 150%: the scale stays on the tab, undecided. The
    // plan names none, so the page guards the scale once it is decided.
    const empty = await read(shell(853));
    expect(empty.plan.zoom).toBe(1);
    expect(h.zoom.factor(TAB)).toBe(1.5);
    expect(h.zoom.calls.some((c) => c.kind === 'release')).toBe(false);
    expect((await h.worker.tabRecord(TAB))?.scale).toBeNull();

    const content = await read(
      wikipediaSignals(undefined, { viewport: { width: 853 } }),
    );
    expect(content.plan.zoom).toBe(1.5);
    expect(sets(h)).toEqual([1.5, 1.5]);
    expect((await h.worker.tabRecord(TAB))?.scale?.z).toBe(1.5);
    expect(
      (await h.worker.view(TAB)).changes.find((c) => c.op === 'page_zoom'),
    ).toMatchObject({ status: 'applied' });
  });

  it('once the person has used the page, a scale that waited for its text stays as the tab shows it', async () => {
    await loadPage(h, shell());
    const session = (await h.worker.tabRecord(TAB))?.tabSession as string;
    await h.worker.interacted(TAB, 0, session);
    // No jump under their pointer: the tab stays at their zoom, and the
    // text carries the whole fit.
    const content = await read(wikipediaSignals());
    expect(content.plan.zoom).toBe(1);
    expect(h.zoom.calls).toEqual([]);
    expect((await h.worker.tabRecord(TAB))?.scale?.z).toBe(1);
    expect(content.plan.ops.find((p) => p.op === 'text_floor')).toMatchObject({
      mode: 'auto',
    });
  });
});
