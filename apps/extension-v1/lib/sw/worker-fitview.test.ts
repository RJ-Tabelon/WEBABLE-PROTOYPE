// @vitest-environment node
import {
  govuk,
  inbox,
  youtube,
} from '@webable/core/compose/__fixtures__/index';
import { heuristicSpec } from '@webable/core/compose/heuristic';
import { validateSpec } from '@webable/core/compose/validate';
import {
  editorSignals,
  govukSignals,
  largeTextProfile,
} from '@webable/core/policy/fixtures';
import type { PageSignals } from '@webable/core/page/types';
import { toStoredSpec } from '@webable/core/skeleton/locate';
import { pathShape } from '@webable/core/skeleton/template';
import type { Skeleton } from '@webable/core/skeleton/types';
import {
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
} from '@webable/core/versions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FitViewOpenReply } from '../protocol';
import { memoryArea } from '../storage/area';
import { KEYS } from '../storage/keys';
import type { AuthService } from './auth';
import { composeKey, nameHasher, siteKey } from './cachekeys';
import { E2E_SUPABASE_ORIGIN } from './config';
import {
  ACCOUNT,
  createHarness,
  DOMAIN,
  loadPage,
  seedProfile,
  TAB,
  until,
  URL_A,
  type Harness,
  type HarnessOptions,
} from './worker-harness';

/**
 * Fit view in the worker (docs/10 §4-8): the open request (spec, layout,
 * scripts, zoom), the planner (gating, receipt, dedupe, delivery), the
 * cache, tab mode and "Always here", the command, offers and learning.
 */

const COMPOSE_URL = `${E2E_SUPABASE_ORIGIN}/functions/v1/compose`;

function fakeAuth(): AuthService {
  return {
    client: {} as AuthService['client'],
    async accessToken() {
      return 'jwt';
    },
    async session() {
      return { access_token: 'jwt' } as Awaited<
        ReturnType<AuthService['session']>
      >;
    },
    async connect() {
      return { ok: false, code: 'auth_failed' };
    },
    async signOut() {},
    async refresh() {
      return 'ok';
    },
    async refreshNow() {
      return false;
    },
    onLost() {},
  };
}

/** The planner's answer for a skeleton: its own heuristic spec, as the model would shape it. */
function plannerBody(skeleton: Skeleton) {
  return {
    ok: true,
    v: 1,
    schema: COMPOSE_SCHEMA_VERSION,
    model: COMPOSE_PINNED_MODEL,
    spec: heuristicSpec(skeleton),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A compose stub; `gate` holds the answer until the test releases it. */
function composeStub(skeleton: Skeleton, gate?: Promise<void>) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
    if (gate) await gate;
    return new Response(JSON.stringify(plannerBody(skeleton)), {
      status: 200,
    });
  });
  return fetch;
}

async function composePage(h: Harness, signals: PageSignals = govukSignals()) {
  await seedProfile(h.stores, largeTextProfile(36));
  return loadPage(h, signals);
}

async function request(
  h: Harness,
  skeleton: Skeleton = govuk,
  reason: Parameters<Harness['worker']['fitViewRequest']>[3] = 'popup',
  url = URL_A,
): Promise<FitViewOpenReply> {
  return h.worker.fitViewRequest(TAB, 0, skeleton, reason, url);
}

const ok = (r: FitViewOpenReply) => {
  if (!r.ok) throw new Error(`refused: ${r.why}`);
  return r;
};

function signedIn(opts: HarnessOptions = {}): Harness {
  return createHarness({ auth: fakeAuth(), ...opts });
}

async function withAccount(h: Harness, aiLayout = true): Promise<void> {
  await h.stores.account.write({ ...ACCOUNT, aiLayout });
}

let h: Harness;
beforeEach(() => {
  h = createHarness();
});

describe('opening Fit view', () => {
  it('replies with the heuristic spec, the solved layout and the font, scripts first', async () => {
    await composePage(h);
    const reply = ok(await request(h));
    expect(reply.envelope).toMatchObject({
      source: 'heuristic',
      extractionId: govuk.extractionId,
    });
    expect(reply.envelope.validated.spec.sections.length).toBeGreaterThan(0);
    // The layout carries the fit's numbers (36 px text), never the fit itself.
    expect(reply.layout.type.body.px).toBe(36);
    expect(JSON.stringify(reply)).not.toMatch(/textMinPx|minTargetPx/);
    expect(reply.site).toEqual({ label: DOMAIN, secure: true });
    expect(reply.plannerPending).toBe(false);
    expect(reply.font).toBe('d09GMgAB');
    // fitview.js and the key bridge were in the page before the reply.
    expect(h.sequence).toEqual([`inject:${TAB}`]);

    // Once per document: no second injection, no second font.
    const again = ok(await request(h, govuk, 'route'));
    expect(again.font).toBeUndefined();
    expect(h.sequence).toEqual([`inject:${TAB}`]);
    // A new document gets both again.
    await loadPage(h, govukSignals());
    expect(ok(await request(h)).font).toBe('d09GMgAB');
    expect(h.sequence).toHaveLength(2);
  });

  it('returns the tab to the person’s zoom while open and brings Tailor’s scale back on close', async () => {
    h.zoom.person(TAB, 1.1);
    await composePage(h);
    // 36 px over 19 px text at 110%: a page scale is on the tab.
    const scaled = (await h.worker.tabRecord(TAB))?.zoom;
    expect(scaled?.z).toBeGreaterThan(1);
    const reply = ok(await request(h));
    expect(reply.zoom).toBe(1.1);
    expect(h.zoom.factor(TAB)).toBe(1.1);
    // The scale is off the tab while the view is open.
    expect(h.engine.of('sw:zoom').at(-1)).toEqual({
      type: 'sw:zoom',
      zoom: 1.1,
      owner: 'webable',
      scale: 1,
    });
    await h.worker.fitViewEvent(TAB, 0, {
      kind: 'opened',
      source: 'heuristic',
      reason: 'popup',
      ms: 40,
    });
    await h.worker.fitViewEvent(TAB, 0, {
      kind: 'closed',
      reason: 'original',
      afterMs: 60_000,
      actions: 0,
    });
    expect(h.zoom.factor(TAB)).toBe(scaled!.factor);
  });

  it('refuses where Fit view cannot work, saying why', async () => {
    await composePage(h);
    // A consent wall or modal covering the page.
    const overlay: Skeleton = {
      ...govuk,
      extractionId: 'fx-overlay',
      nodes: [
        ...govuk.nodes,
        {
          id: 'e9000',
          parent: govuk.nodes[0]!.id,
          depth: 1,
          tag: 'div',
          role: 'dialog',
          kind: 'landmark',
          box: [100, 50, 1000, 700],
          flags: ['fixed'],
        },
      ],
    };
    expect(await request(h, overlay)).toEqual({
      ok: false,
      why: 'blocked_overlay',
    });
    // An engine of another version: read again.
    expect(
      await request(h, { ...govuk, version: 'skel-0.9.0' as never }),
    ).toEqual({ ok: false, why: 'stale' });
    expect((await h.worker.view(TAB)).fitView?.why).toBe('stale');

    // Editors and apps stay as they are.
    const e = createHarness();
    await composePage(e, editorSignals());
    expect(await request(e)).toEqual({ ok: false, why: 'not_representable' });

    // Pages with password fields are never re-presented.
    const p = createHarness();
    await composePage(
      p,
      govukSignals(undefined, { forms: { hasPassword: true } }),
    );
    expect(await request(p)).toEqual({ ok: false, why: 'not_representable' });

    // Banking, health and government sites.
    const x = createHarness();
    await seedProfile(x.stores, largeTextProfile(36));
    await loadPage(x, govukSignals(), 'https://secure.chase.com/web/auth');
    expect(
      await x.worker.fitViewRequest(
        TAB,
        0,
        govuk,
        'popup',
        'https://secure.chase.com/web/auth',
      ),
    ).toEqual({ ok: false, why: 'excluded' });

    // No page view (the tab navigated away).
    const none = createHarness();
    expect(await request(none)).toEqual({ ok: false, why: 'stale' });

    // The renderer could not be injected.
    const blocked = createHarness({ injectFails: true });
    await composePage(blocked);
    expect(await request(blocked)).toEqual({ ok: false, why: 'error' });
  });

  it('uses a cached planner spec when its locators resolve, else the heuristic', async () => {
    await composePage(h);
    const install = await h.stores.install.get();
    const site = await siteKey(install.secret, DOMAIN);
    const key = await composeKey(install.secret, site, pathShape(URL_A));
    const store = async (from: Skeleton, createdAt: number) => {
      const validated = validateSpec(heuristicSpec(from), from)!;
      const hash = await nameHasher(install.secret, from);
      await h.stores.compose.put(
        key,
        site,
        toStoredSpec(validated, from, hash, {
          schema: COMPOSE_SCHEMA_VERSION,
          model: COMPOSE_PINNED_MODEL,
          createdAt,
        }),
      );
    };
    // A variant from another page structure resolves poorly here.
    await store(youtube, h.clock.now() - 1000);
    expect(ok(await request(h)).envelope.source).toBe('heuristic');

    await store(govuk, h.clock.now());
    const reply = ok(await request(h));
    expect(reply.envelope).toMatchObject({
      source: 'planner',
      model: COMPOSE_PINNED_MODEL,
      templateKey: key,
    });
    expect(reply.plannerPending).toBe(false);
    expect((await h.worker.view(TAB)).fitView?.planner).toBe('ready');
  });
});

describe('the layout planner', () => {
  it('runs after the person opens Fit view, writing the receipt before anything is sent', async () => {
    let receiptsAtSend = -1;
    const at: { harness?: Harness } = {};
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
      receiptsAtSend = (await at.harness!.stores.receipts.list()).length;
      return new Response(JSON.stringify(plannerBody(govuk)), {
        status: 200,
      });
    });
    const p = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    at.harness = p;
    await withAccount(p);
    await composePage(p);
    const reply = ok(await request(p));
    expect(reply.plannerPending).toBe(true);
    expect((await p.worker.view(TAB)).fitView?.planner).toBe('pending');
    await until(async () => (await p.stores.compose.size()) > 0);
    expect(receiptsAtSend).toBe(1);
    const [receipt] = await p.stores.receipts.list();
    expect(receipt).toMatchObject({
      destination: 'layout_planning',
      domain: DOMAIN,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(COMPOSE_URL);
    expect(JSON.stringify(receipt!.body)).toBe(init.body);
    expect(init.headers).toMatchObject({
      authorization: 'Bearer jwt',
      apikey: 'e2e-publishable-key',
    });
    // Structure only: no page words outside the public list, no URL, no fit.
    expect(String(init.body)).not.toMatch(
      /example\.com|https?:|textMinPx|Apply online|Universal Credit/,
    );
    const view = await p.worker.view(TAB);
    expect(view.lastSentAt).toBe(receipt!.at);
    expect(view.fitView?.planner).toBe('ready');

    // The next open of this template uses the cached plan; nothing is sent.
    const next = ok(await request(p, govuk, 'tab_mode'));
    expect(next.envelope.source).toBe('planner');
    expect(next.plannerPending).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('delivers a planner spec only to the view still open on the same extraction', async () => {
    const gate = deferred<void>();
    const fetch = composeStub(govuk, gate.promise);
    const p = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    await withAccount(p);
    await composePage(p);
    ok(await request(p));
    await p.worker.fitViewEvent(TAB, 0, {
      kind: 'opened',
      source: 'heuristic',
      reason: 'popup',
      ms: 30,
    });
    await until(() => fetch.mock.calls.length === 1);
    gate.resolve();
    await until(() => p.engine.of('sw:fitview-spec').length === 1);
    expect(p.engine.of('sw:fitview-spec')[0]?.envelope).toMatchObject({
      source: 'planner',
      extractionId: govuk.extractionId,
    });

    // Closed before the answer landed: cached for next time, nothing sent to the page.
    const gate2 = deferred<void>();
    const fetch2 = composeStub(govuk, gate2.promise);
    const q = signedIn({ fetch: fetch2 as unknown as typeof globalThis.fetch });
    await withAccount(q);
    await composePage(q);
    ok(await request(q));
    await q.worker.fitViewEvent(TAB, 0, {
      kind: 'opened',
      source: 'heuristic',
      reason: 'popup',
      ms: 30,
    });
    await until(() => fetch2.mock.calls.length === 1);
    await q.worker.fitViewEvent(TAB, 0, {
      kind: 'closed',
      reason: 'original',
      afterMs: 45_000,
      actions: 0,
    });
    gate2.resolve();
    await until(async () => (await q.stores.compose.size()) === 1);
    await until(
      async () => (await q.worker.view(TAB)).fitView?.planner === 'ready',
    );
    expect(q.engine.of('sw:fitview-spec')).toEqual([]);
  });

  it('runs one call per template, even across a worker restart', async () => {
    const gate = deferred<void>();
    const fetch = composeStub(govuk, gate.promise);
    const local = memoryArea();
    const session = memoryArea();
    const first = signedIn({
      local,
      session,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await withAccount(first);
    await composePage(first);
    ok(await request(first));
    await until(() => fetch.mock.calls.length === 1);

    // The worker restarts while the call is out; the page asks again.
    const fetch2 = composeStub(govuk);
    const second = signedIn({
      local,
      session,
      fetch: fetch2 as unknown as typeof globalThis.fetch,
    });
    const reply = ok(await request(second, govuk, 'route'));
    expect(reply.plannerPending).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetch2).not.toHaveBeenCalled();
    expect(await second.stores.receipts.list()).toHaveLength(1);
    gate.resolve();
  });

  it('never plans without consent, on mail or chat, on checkout, or with the breaker open', async () => {
    // No consent: the heuristic view, nothing sent, the planner shown unavailable.
    const fetch = composeStub(govuk);
    const a = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    await withAccount(a, false);
    await composePage(a);
    expect(ok(await request(a)).plannerPending).toBe(false);
    expect((await a.worker.view(TAB)).fitView?.planner).toBe('unavailable');
    expect((await a.worker.view(TAB)).account.aiLayout).toBe(false);

    // Webmail: the view works, the planner never runs.
    const b = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    await withAccount(b);
    await seedProfile(b.stores, largeTextProfile(36));
    const mail = 'https://mail.google.com/mail/u/0/#inbox';
    await loadPage(b, govukSignals(), mail);
    const inMail = ok(
      await b.worker.fitViewRequest(TAB, 0, inbox, 'popup', mail),
    );
    expect(inMail.plannerPending).toBe(false);
    expect((await b.worker.view(TAB)).fitView?.planner).toBe('unavailable');

    // A checkout page.
    const c = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    await withAccount(c);
    await composePage(
      c,
      govukSignals(undefined, {
        category: 'form_checkout',
        categoryConfidence: 0.9,
      }),
    );
    expect(ok(await request(c)).plannerPending).toBe(false);

    // The planner's own breaker is open (an outage, a quota).
    const d = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    await withAccount(d);
    await composePage(d);
    await d.local.set({
      [KEYS.composeBreaker]: {
        failures: 0,
        openUntil: d.clock.now() + 60_000,
        backoffMs: 300_000,
      },
    });
    expect(ok(await request(d)).plannerPending).toBe(false);

    // Opened by itself (Your fit's busy pages), not by the person or "Always here".
    const e = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    await withAccount(e);
    await composePage(e);
    expect(ok(await request(e, govuk, 'auto')).plannerPending).toBe(false);

    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops when the server says consent is off, and backs off on errors', async () => {
    const denied = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'consent_required' } }), {
          status: 403,
        }),
    );
    const a = signedIn({ fetch: denied as unknown as typeof globalThis.fetch });
    await withAccount(a);
    await composePage(a);
    ok(await request(a));
    await until(
      async () => (await a.stores.account.read())?.aiLayout === false,
    );
    await until(
      async () => (await a.worker.view(TAB)).fitView?.planner === 'unavailable',
    );

    const failing = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, degraded: 'quota' }), {
          status: 200,
          headers: { 'retry-after': '120' },
        }),
    );
    const b = signedIn({
      fetch: failing as unknown as typeof globalThis.fetch,
    });
    await withAccount(b);
    await composePage(b);
    ok(await request(b));
    await until(async () => {
      const raw = (await b.local.getMany([KEYS.composeBreaker]))[
        KEYS.composeBreaker
      ] as { openUntil?: number } | undefined;
      return (raw?.openUntil ?? 0) >= b.clock.now() + 120_000;
    });
    // Page analysis has its own breaker, untouched.
    expect(
      (await b.local.getMany([KEYS.breaker]))[KEYS.breaker],
    ).toBeUndefined();
  });

  it('the dev planner runs without an account in development builds only', async () => {
    const fetch = composeStub(govuk);
    const dev = createHarness({
      fetch: fetch as unknown as typeof globalThis.fetch,
      env: {
        MODE: 'development',
        WXT_COMPOSE_URL: 'http://127.0.0.1:8788/compose',
      },
    });
    expect((await dev.worker.prefs()).devPlanner).toBe(false);
    await composePage(dev);
    // Off until the person turns it on.
    expect(ok(await request(dev)).plannerPending).toBe(false);
    await dev.worker.setPrefs({ devPlanner: true });
    expect((await dev.worker.prefs()).devPlanner).toBe(true);
    expect(ok(await request(dev, govuk, 'route')).plannerPending).toBe(true);
    await until(() => fetch.mock.calls.length === 1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8788/compose');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    await until(async () => (await dev.stores.receipts.list()).length === 1);

    // A production build ignores the loopback override and has no switch.
    const prod = createHarness({
      fetch: fetch as unknown as typeof globalThis.fetch,
      env: {
        MODE: 'production',
        WXT_COMPOSE_URL: 'http://127.0.0.1:8788/compose',
      },
    });
    await prod.worker.setPrefs({ devPlanner: true });
    expect((await prod.worker.prefs()).devPlanner).toBeNull();
    await composePage(prod);
    expect(ok(await request(prod)).plannerPending).toBe(false);
  });
});

describe('tab mode, Always here and the command', () => {
  it('tab mode follows the tab until Original page; Always here reopens on the site', async () => {
    await composePage(h);
    ok(await request(h));
    await h.worker.fitViewEvent(TAB, 0, {
      kind: 'opened',
      source: 'heuristic',
      reason: 'popup',
      ms: 30,
    });
    expect((await h.worker.view(TAB)).fitView).toMatchObject({
      open: true,
      tabMode: true,
      source: 'heuristic',
      mode: 'offer',
    });
    expect((await h.worker.hello(TAB, 0, URL_A)).fitViewTab).toBe(true);
    // The person picks Original page.
    await loadPage(h, govukSignals());
    await h.worker.fitViewEvent(TAB, 0, {
      kind: 'closed',
      reason: 'original',
      afterMs: 90_000,
      actions: 1,
    });
    expect((await h.worker.hello(TAB, 0, URL_A)).fitViewTab).toBe(false);

    // Always here: on for the site, opened now, and every page reopens it.
    await loadPage(h, govukSignals());
    await h.worker.fitView(TAB, true, 'site');
    expect((await h.stores.sites.get(DOMAIN)).rule.view).toBe('fit');
    expect(h.engine.of('sw:fitview').at(-1)).toEqual({
      type: 'sw:fitview',
      action: 'open',
      reason: 'popup',
    });
    expect((await h.worker.view(TAB)).fitView?.mode).toBe('auto');
    await h.worker.fitViewEvent(TAB, 0, {
      kind: 'closed',
      reason: 'original',
      afterMs: 90_000,
      actions: 0,
    });
    expect((await h.worker.hello(TAB, 0, URL_A)).fitViewTab).toBe(true);
    await h.worker.fitView(TAB, false, 'site');
    expect((await h.worker.hello(TAB, 0, URL_A)).fitViewTab).toBe(false);
  });

  it('the popup switch and the toggle-fit-view command open and close it', async () => {
    await composePage(h);
    await h.worker.fitView(TAB, true, 'page');
    expect(h.engine.of('sw:fitview').at(-1)).toMatchObject({
      action: 'open',
      reason: 'popup',
    });
    await h.worker.fitViewEvent(TAB, 0, {
      kind: 'opened',
      source: 'heuristic',
      reason: 'popup',
      ms: 30,
    });
    await h.worker.toggleFitView(TAB);
    expect(h.engine.of('sw:fitview').at(-1)).toEqual({
      type: 'sw:fitview',
      action: 'close',
      reason: 'original',
    });
    expect((await h.worker.view(TAB)).fitView?.tabMode).toBe(false);
    await h.worker.fitViewEvent(TAB, 0, {
      kind: 'closed',
      reason: 'original',
      afterMs: 50_000,
      actions: 0,
    });
    await h.worker.toggleFitView(TAB);
    expect(h.engine.of('sw:fitview').at(-1)).toMatchObject({
      action: 'open',
      reason: 'shortcut',
    });
    await h.worker.fitView(TAB, false, 'page');
    expect(h.engine.of('sw:fitview').at(-1)).toMatchObject({
      action: 'close',
      reason: 'original',
    });
  });

  it('"Switch" opens the planner layout that is ready', async () => {
    const fetch = composeStub(govuk);
    const p = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    await withAccount(p);
    await composePage(p);
    ok(await request(p));
    await p.worker.fitViewEvent(TAB, 0, {
      kind: 'opened',
      source: 'heuristic',
      reason: 'popup',
      ms: 30,
    });
    await until(
      async () => (await p.worker.view(TAB)).fitView?.planner === 'ready',
    );
    await p.worker.fitViewSwitch(TAB);
    expect(p.engine.of('sw:fitview').at(-1)).toEqual({
      type: 'sw:fitview',
      action: 'open',
      reason: 'switch',
    });
    // The switch's request recalls the planner spec.
    expect(ok(await request(p, govuk, 'switch')).envelope.source).toBe(
      'planner',
    );
  });
});

describe('offers and learning', () => {
  it('offers Fit view where triage says compose, once per site per day, never after Not now', async () => {
    const first = await composePage(h);
    expect(first.plan.triage).toMatchObject({
      verdict: 'compose',
      representable: true,
    });
    expect(first.fitViewOffer).toBe(true);
    await h.worker.fitViewEvent(TAB, 0, {
      kind: 'offer',
      surface: 'chip',
      answer: 'dismiss',
    });
    // Counted against v1's budget, once.
    expect((await h.stores.offers.read()).count).toBe(1);
    // Repeat visits read the page at the 150% WebAble brings back at hello.
    const again = () => govukSignals(undefined, { viewport: { width: 853 } });
    expect((await loadPage(h, again())).fitViewOffer).toBeUndefined();

    // Another tab on the same site, the same day: still no.
    const other = createHarness({ local: h.local });
    await seedProfile(other.stores, largeTextProfile(36));
    expect((await loadPage(other, again())).fitViewOffer).toBeUndefined();
    // The next day it may ask again.
    other.clock.advance(86_400_000);
    expect((await loadPage(other, again())).fitViewOffer).toBe(true);
    // Accepted: more offers that day are fine.
    await other.worker.fitViewEvent(TAB, 0, {
      kind: 'offer',
      surface: 'toast',
      answer: 'accept',
    });
    await other.worker.fitViewEvent(TAB, 0, {
      kind: 'closed',
      reason: 'route',
      afterMs: 1000,
      actions: 0,
    });
    expect((await loadPage(other, again())).fitViewOffer).toBe(true);

    // Not on excluded sites.
    const x = createHarness();
    await seedProfile(x.stores, largeTextProfile(36));
    expect(
      (await loadPage(x, govukSignals(), 'https://www.gov.uk/apply'))
        .fitViewOffer,
    ).toBeUndefined();
  });

  it('learns keep and undo per site and page type; a quick exit evicts the planner spec', async () => {
    const fetch = composeStub(govuk);
    const p = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    await withAccount(p);
    await composePage(p);
    ok(await request(p));
    await until(async () => (await p.stores.compose.size()) === 1);
    // Opened on the cached planner spec, then left within 30 s without acting.
    ok(await request(p, govuk, 'tab_mode'));
    await p.worker.fitViewEvent(TAB, 0, {
      kind: 'opened',
      source: 'planner',
      reason: 'tab_mode',
      ms: 20,
    });
    await p.worker.fitViewEvent(TAB, 0, {
      kind: 'closed',
      reason: 'original',
      afterMs: 4000,
      actions: 0,
    });
    expect((await p.stores.sites.get(DOMAIN)).fitView).toMatchObject({
      keep: 0,
      undo: 1,
    });
    expect((await p.stores.fitLearning.read()).pageTypes.article).toEqual({
      keep: 0,
      undo: 1,
    });
    expect(await p.stores.compose.size()).toBe(0);

    // A proxied action is a keep; a route change is neither.
    await p.worker.fitViewEvent(TAB, 0, {
      kind: 'closed',
      reason: 'original',
      afterMs: 4000,
      actions: 2,
    });
    await p.worker.fitViewEvent(TAB, 0, {
      kind: 'closed',
      reason: 'route',
      afterMs: 1000,
      actions: 0,
    });
    expect((await p.stores.sites.get(DOMAIN)).fitView).toMatchObject({
      keep: 1,
      undo: 1,
    });
    // Leaving the page while Fit view is open counts as a keep.
    await p.worker.fitViewEvent(TAB, 0, {
      kind: 'opened',
      source: 'heuristic',
      reason: 'popup',
      ms: 20,
    });
    await p.worker.hello(TAB, 0, URL_A);
    expect((await p.stores.sites.get(DOMAIN)).fitView.keep).toBe(2);
  });

  it('logs defects and stops reusing a planner spec that failed', async () => {
    const fetch = composeStub(govuk);
    const p = signedIn({ fetch: fetch as unknown as typeof globalThis.fetch });
    await withAccount(p);
    await composePage(p);
    ok(await request(p));
    await until(async () => (await p.stores.compose.size()) === 1);
    ok(await request(p, govuk, 'tab_mode'));
    await p.worker.fitViewEvent(TAB, 0, {
      kind: 'opened',
      source: 'planner',
      reason: 'tab_mode',
      ms: 20,
    });
    await p.worker.fitViewEvent(TAB, 0, {
      kind: 'proxy_failed',
      role: 'button',
      why: 'no_effect',
    });
    const learned = await p.stores.fitLearning.read();
    expect(learned.defects).toEqual([
      {
        at: p.clock.now(),
        kind: 'proxy_failed',
        source: 'planner',
        cat: 'article',
        role: 'button',
        why: 'no_effect',
      },
    ]);
    expect(await p.stores.compose.size()).toBe(0);
    // Defects never name the site.
    expect(JSON.stringify(learned)).not.toContain(DOMAIN);
  });

  it('Text − / + inside Fit view becomes its text override', async () => {
    await composePage(h);
    const before = ok(await request(h)).layout.type.body.px;
    await h.worker.fitViewEvent(TAB, 0, { kind: 'text_nudge', step: 1 });
    await h.worker.fitViewEvent(TAB, 0, { kind: 'text_nudge', step: 1 });
    expect((await h.stores.settings.read()).fitTextStep).toBe(2);
    const after = ok(await request(h, govuk, 'route')).layout.type.body.px;
    expect(after).toBeGreaterThan(before);
  });
});

describe('the popup view', () => {
  it('shows Fit view’s state for the tab and the layout consent', async () => {
    expect((await h.worker.view(TAB)).fitView).toBeUndefined();
    await composePage(h);
    const view = await h.worker.view(TAB);
    expect(view.fitView).toEqual({
      available: true,
      open: false,
      tabMode: false,
      mode: 'offer',
      source: null,
      // No session service in this build: planning is unavailable, and
      // signing in, not consent, is what is missing.
      planner: 'unavailable',
      needsConsent: false,
      verdict: 'compose',
      why: null,
    });
    expect(view.account.aiLayout).toBe(false);
    expect(view.triageLine).toMatch(/for your fit\.$/);
  });

  it('marks pages Fit view cannot re-present', async () => {
    await composePage(h, editorSignals());
    expect((await h.worker.view(TAB)).fitView).toMatchObject({
      available: false,
      why: 'not_representable',
    });
  });
});

describe('local data', () => {
  it('the e2e reset clears the planner cache, breaker and Fit view state', async () => {
    await composePage(h);
    ok(await request(h));
    const install = await h.stores.install.get();
    const site = await siteKey(install.secret, DOMAIN);
    const validated = validateSpec(heuristicSpec(govuk), govuk)!;
    await h.stores.compose.put(
      await composeKey(install.secret, site, pathShape(URL_A)),
      site,
      toStoredSpec(validated, govuk, await nameHasher(install.secret, govuk), {
        schema: COMPOSE_SCHEMA_VERSION,
        model: COMPOSE_PINNED_MODEL,
        createdAt: h.clock.now(),
      }),
    );
    await h.local.set({
      [KEYS.composeBreaker]: { failures: 2, openUntil: 0, backoffMs: 300_000 },
    });
    expect(await h.stores.compose.size()).toBe(1);
    await h.worker.e2eSeed({ reset: true });
    expect(await h.stores.compose.size()).toBe(0);
    expect(
      (await h.local.getMany([KEYS.composeBreaker]))[KEYS.composeBreaker],
    ).toBeUndefined();
    const left = Object.keys(await h.session.getAll()).filter((k) =>
      k.startsWith(KEYS.fitViewPrefix),
    );
    expect(left).toEqual([]);
  });

  it('a page view’s Fit view state never lands in the wa.tabs snapshot', async () => {
    await composePage(h);
    ok(await request(h));
    await new Promise((r) => setTimeout(r, 0));
    const all = await h.session.getAll();
    expect(JSON.stringify(all[KEYS.tabs])).not.toMatch(/extractionId|planner/);
    expect(all[`${KEYS.fitViewPrefix}${TAB}`]).toMatchObject({
      extractionId: govuk.extractionId,
    });
  });
});
