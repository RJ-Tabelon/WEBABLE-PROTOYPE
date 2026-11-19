// @vitest-environment node
import { govuk } from '@webable/core/compose/__fixtures__/index';
import {
  editorSignals,
  govukSignals,
  largeTextProfile,
  triageFor,
} from '@webable/core/policy/fixtures';
import type { Skeleton } from '@webable/core/skeleton/types';
import { describe, expect, it } from 'vitest';

import { memoryArea } from '../storage/area';
import { KEYS } from '../storage/keys';
import {
  autoArrival,
  blockingOverlay,
  closeOutcome,
  ComposeInflight,
  fitViewArrival,
  fitViewOfferAllowed,
  fitViewTabState,
  FitViewStates,
  focusNode,
  forPageView,
  freshFitViewState,
  hasPasswordField,
  INFLIGHT_MS,
  keepRate,
  normalizeFitViewState,
  personOpened,
  regionRoles,
  unavailableWhy,
  type ArrivalInput,
  type OfferInput,
} from './fitview';

const compose = triageFor(largeTextProfile(36), govukSignals());
const editor = triageFor(largeTextProfile(36), editorSignals());

const withNode = (node: Partial<Skeleton['nodes'][number]>): Skeleton => ({
  ...govuk,
  nodes: [
    ...govuk.nodes,
    {
      id: 'e9000',
      parent: govuk.nodes[0]!.id,
      depth: 1,
      tag: 'div',
      role: null,
      kind: 'group',
      box: [0, 0, 100, 100],
      flags: [],
      ...node,
    },
  ],
});

describe('Fit view state per tab', () => {
  it('keeps each tab under its own session key, across worker restarts', async () => {
    const session = memoryArea();
    const a = new FitViewStates(session);
    await a.update(1, (s) => ({ ...s, tabMode: true, session: 'v1' }));
    await a.update(2, (s) => ({ ...s, offerDeclined: true }));
    const keys = Object.keys(await session.getAll()).sort();
    expect(keys).toEqual([`${KEYS.fitViewPrefix}1`, `${KEYS.fitViewPrefix}2`]);
    const b = new FitViewStates(session);
    expect((await b.get(1)).tabMode).toBe(true);
    expect((await b.get(2)).offerDeclined).toBe(true);
    expect(await b.tabIds()).toEqual(expect.arrayContaining([1, 2]));
    await b.delete(1);
    expect(await new FitViewStates(session).get(1)).toEqual(
      freshFitViewState(),
    );
    await b.clear();
    expect(await session.getAll()).toEqual({});
  });

  it('serialises updates per tab', async () => {
    const states = new FitViewStates(memoryArea());
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        states.update(3, (s) => ({ ...s, openedAt: (s.openedAt ?? 0) + i })),
      ),
    );
    expect((await states.get(3)).openedAt).toBe(45);
  });

  it('a new page view keeps tab mode, "Not now" and "Original page", and resets the rest', () => {
    const s = {
      ...freshFitViewState(),
      tabMode: true,
      offerDeclined: true,
      declinedSite: 'example.com',
      autoSession: 'old',
      session: 'old',
      open: true,
      planner: 'ready' as const,
      extractionId: 'x1',
    };
    expect(forPageView(s, 'old')).toBe(s);
    expect(forPageView(s, 'new')).toMatchObject({
      tabMode: true,
      offerDeclined: true,
      declinedSite: 'example.com',
      autoSession: 'old',
      session: 'new',
      open: false,
      planner: 'idle',
      extractionId: null,
    });
  });

  it('normalises whatever is stored', () => {
    expect(normalizeFitViewState(null)).toEqual(freshFitViewState());
    expect(
      normalizeFitViewState({
        tabMode: 'yes',
        planner: 'thinking',
        reason: 'magic',
        why: 'nope',
        source: 'model',
        extractionId: 'x'.repeat(200),
      }),
    ).toEqual(freshFitViewState());
  });
});

describe('planner calls in flight', () => {
  it('one claim per key; later callers wait and are handed back on release', async () => {
    let now = 0;
    const session = memoryArea();
    const inflight = new ComposeInflight(session, () => now);
    expect(await inflight.claim('k1', { tabId: 1, extractionId: 'a' })).toBe(
      true,
    );
    // A restarted worker shares session storage.
    const restarted = new ComposeInflight(session, () => now);
    expect(await restarted.claim('k1', { tabId: 2, extractionId: 'b' })).toBe(
      false,
    );
    expect(await restarted.claim('k1', { tabId: 2, extractionId: 'b' })).toBe(
      false,
    );
    expect(await inflight.claim('k2', { tabId: 3, extractionId: 'c' })).toBe(
      true,
    );
    expect(await inflight.release('k1')).toEqual([
      { tabId: 1, extractionId: 'a' },
      { tabId: 2, extractionId: 'b' },
    ]);
    expect(await inflight.pending('k1')).toBe(false);
    expect(await inflight.pending('k2')).toBe(true);
    // A call that never came back (the worker died) expires.
    now += INFLIGHT_MS + 1;
    expect(await inflight.pending('k2')).toBe(false);
    expect(await inflight.claim('k2', { tabId: 3, extractionId: 'd' })).toBe(
      true,
    );
    await inflight.clear();
    expect(await inflight.pending('k2')).toBe(false);
  });
});

describe('reading the skeleton', () => {
  it('finds a consent wall or modal over the page, not a banner', () => {
    expect(blockingOverlay(govuk)).toBe(false);
    expect(
      blockingOverlay(
        withNode({ role: 'dialog', flags: ['fixed'], box: [0, 0, 1280, 800] }),
      ),
    ).toBe(true);
    expect(
      blockingOverlay(
        withNode({
          flags: ['fixed', 'consenthint'],
          box: [0, 100, 1280, 500],
        }),
      ),
    ).toBe(true);
    // A cookie bar along the bottom leaves the page usable.
    expect(
      blockingOverlay(
        withNode({ flags: ['fixed', 'consenthint'], box: [0, 700, 1280, 100] }),
      ),
    ).toBe(false);
    // A dialog in the flow of the page is not over it.
    expect(
      blockingOverlay(withNode({ role: 'dialog', box: [0, 0, 1280, 800] })),
    ).toBe(false);
  });

  it('knows the focused node and password fields', () => {
    expect(focusNode(govuk)).toBeNull();
    expect(focusNode(withNode({ flags: ['focus'] }))).toBe('e9000');
    expect(hasPasswordField(govuk)).toBe(false);
    expect(
      hasPasswordField(withNode({ kind: 'input', inputType: 'password' })),
    ).toBe(true);
  });

  it('turns region verdicts into roles for the heuristic spec', () => {
    expect(
      regionRoles({
        a: {
          key: 'a',
          role: 'navigation',
          label: null,
          protected: true,
          source: 'rule',
          pEligible: 0,
        },
        b: {
          key: 'b',
          role: null,
          label: null,
          protected: false,
          source: 'rule',
          pEligible: 0,
        },
      }),
    ).toEqual({ a: 'navigation' });
  });
});

describe('rules', () => {
  it('lets the planner run only for opens the person asked for', () => {
    expect(personOpened('popup', false)).toBe(true);
    expect(personOpened('tab_mode', false)).toBe(true);
    expect(personOpened('auto', false)).toBe(false);
    expect(personOpened('auto', true)).toBe(true);
  });

  it('learns from how a view ended', () => {
    const closed = (
      reason: 'original' | 'route' | 'error' | 'paused' | 'not_representable',
      afterMs: number,
      actions: number,
    ) => closeOutcome({ kind: 'closed', reason, afterMs, actions });
    expect(closed('original', 5000, 0)).toBe('undo');
    expect(closed('original', 31_000, 0)).toBeNull();
    expect(closed('original', 5000, 1)).toBe('keep');
    expect(closed('paused', 90_000, 3)).toBe('keep');
    expect(closed('route', 1000, 0)).toBeNull();
    expect(closed('route', 1000, 4)).toBeNull();
    expect(closed('error', 1000, 2)).toBeNull();
    expect(keepRate({ keep: 0, undo: 0 })).toBe(0.5);
    expect(keepRate({ keep: 0, undo: 4 })).toBeCloseTo(1 / 6);
  });

  it('offers by budget, by site and by what the person did with earlier views', () => {
    const base: OfferInput = {
      verdict: compose,
      excluded: false,
      alwaysHere: false,
      tabMode: false,
      offerDeclined: false,
      offersThisPage: 0,
      offersToday: 0,
      offersPerDay: 4,
      site: { offerDay: 0, offerAccepted: false, keep: 0, undo: 0 },
      pageType: undefined,
      today: 100,
    };
    expect(fitViewOfferAllowed(base)).toBe(true);
    expect(fitViewOfferAllowed({ ...base, verdict: undefined })).toBe(false);
    expect(fitViewOfferAllowed({ ...base, verdict: editor })).toBe(false);
    expect(
      fitViewOfferAllowed({
        ...base,
        verdict: { ...compose, verdict: 'tailor' },
      }),
    ).toBe(false);
    for (const patch of [
      { excluded: true },
      { alwaysHere: true },
      { tabMode: true },
      { offerDeclined: true },
      { offersThisPage: 1 },
      { offersToday: 4 },
    ])
      expect(fitViewOfferAllowed({ ...base, ...patch })).toBe(false);
    const today = { ...base.site, offerDay: 100 };
    expect(fitViewOfferAllowed({ ...base, site: today })).toBe(false);
    expect(
      fitViewOfferAllowed({
        ...base,
        site: { ...today, offerAccepted: true },
      }),
    ).toBe(true);
    // Mostly undone here, with enough evidence: stop offering.
    expect(
      fitViewOfferAllowed({ ...base, site: { ...base.site, undo: 2 } }),
    ).toBe(true);
    expect(
      fitViewOfferAllowed({ ...base, site: { ...base.site, undo: 3 } }),
    ).toBe(false);
    expect(
      fitViewOfferAllowed({ ...base, pageType: { keep: 0, undo: 5 } }),
    ).toBe(false);
    expect(
      fitViewOfferAllowed({ ...base, pageType: { keep: 4, undo: 5 } }),
    ).toBe(true);
  });

  it('decides how Fit view reaches a page: structure level × busy × learning × setting × exclusion (docs/11 §2)', () => {
    const needs = compose.needs;
    // Busy for the person (clutter compose or tailor), and not busy.
    const busy = {
      ...compose,
      verdict: 'tailor' as const,
      needs: { ...needs, text: 'fits' as const, clutter: 'tailor' as const },
    };
    const busyCompose = {
      ...busy,
      verdict: 'compose' as const,
      needs: { ...busy.needs, clutter: 'compose' as const },
    };
    const calm = {
      ...busy,
      needs: {
        ...busy.needs,
        clutter: 'fits' as const,
        targets: 'tailor' as const,
      },
    };
    const calmCompose = {
      ...compose,
      needs: { ...needs, clutter: 'fits' as const },
    };
    const base: ArrivalInput = {
      verdict: busy,
      structure: 2,
      autoSimplify: true,
      declinedHere: false,
      autoDone: false,
      excluded: false,
      alwaysHere: false,
      tabMode: false,
      offerDeclined: false,
      offersThisPage: 0,
      offersToday: 0,
      offersPerDay: 4,
      site: { offerDay: 0, offerAccepted: false, keep: 0, undo: 0 },
      pageType: undefined,
      today: 100,
    };
    const at = (patch: Partial<ArrivalInput>) =>
      fitViewArrival({ ...base, ...patch });

    // The table: level 2 restructures a busy page, level 1 offers it, level 0
    // offers only where triage says compose; a calm page is left alone.
    expect(at({})).toBe('auto');
    expect(at({ verdict: busyCompose })).toBe('auto');
    expect(at({ verdict: calm })).toBeNull();
    expect(at({ verdict: calmCompose })).toBe('offer');
    expect(at({ structure: 1 })).toBe('offer');
    expect(at({ structure: 1, verdict: calm })).toBeNull();
    expect(at({ structure: 0 })).toBeNull();
    expect(at({ structure: 0, verdict: busyCompose })).toBe('offer');
    expect(at({ structure: undefined, verdict: calmCompose })).toBe('offer');

    // Learning: two quick exits on the site make it an offer, unless kept as often.
    expect(at({ site: { ...base.site, undo: 1 } })).toBe('auto');
    expect(at({ site: { ...base.site, undo: 2 } })).toBe('offer');
    expect(at({ site: { ...base.site, undo: 2, keep: 1 } })).toBe('offer');
    expect(at({ site: { ...base.site, undo: 2, keep: 2 } })).toBe('auto');
    // ...and so does a page type mostly undone across sites.
    expect(at({ pageType: { keep: 1, undo: 4 } })).toBe('offer');
    expect(at({ pageType: { keep: 3, undo: 2 } })).toBe('auto');
    // A site taught to offer, past the offer budget: nothing.
    expect(at({ site: { ...base.site, undo: 3 } })).toBeNull();

    // The setting off, "Original page" here in this tab, or one automatic
    // open this page view already: offered instead.
    expect(at({ autoSimplify: false })).toBe('offer');
    expect(at({ declinedHere: true })).toBe('offer');
    expect(at({ autoDone: true })).toBe('offer');
    expect(at({ autoDone: true, offersThisPage: 1 })).toBeNull();

    // Excluded sites, pages it cannot show: never. "Always here" and tab
    // mode reopen by themselves at hello.
    expect(at({ excluded: true })).toBeNull();
    expect(
      at({
        verdict: { ...busy, representable: false, blockers: ['video_player'] },
      }),
    ).toBeNull();
    expect(at({ verdict: undefined })).toBeNull();
    expect(at({ alwaysHere: true })).toBeNull();
    expect(at({ tabMode: true })).toBeNull();
    expect(autoArrival({ ...base, offerDeclined: true })).toBe(true);
  });

  it('says why Fit view is unavailable', () => {
    expect(unavailableWhy(compose, false)).toBeNull();
    expect(unavailableWhy(compose, true)).toBe('excluded');
    expect(unavailableWhy(editor, false)).toBe('not_representable');
    expect(
      unavailableWhy(
        { ...compose, representable: false, blockers: ['blocking_overlay'] },
        false,
      ),
    ).toBe('blocked_overlay');
  });

  it('builds the popup’s block for a tab', () => {
    const state = {
      ...freshFitViewState(),
      session: 'v',
      open: true,
      tabMode: true,
      source: 'heuristic' as const,
    };
    const input = {
      state,
      tabSession: 'v',
      verdict: compose,
      excluded: false,
      alwaysHere: false,
      plannerUnavailable: true,
    };
    expect(fitViewTabState(input)).toEqual({
      available: true,
      open: true,
      tabMode: true,
      mode: 'offer',
      source: 'heuristic',
      planner: 'unavailable',
      needsConsent: false,
      verdict: 'compose',
      why: null,
    });
    expect(fitViewTabState({ ...input, needsConsent: true }).needsConsent).toBe(
      true,
    );
    // Another page view in the tab: only tab mode carries over.
    expect(fitViewTabState({ ...input, tabSession: 'w' })).toMatchObject({
      open: false,
      tabMode: true,
      source: null,
    });
    expect(
      fitViewTabState({
        ...input,
        alwaysHere: true,
        plannerUnavailable: false,
        state: { ...state, planner: 'pending' },
      }),
    ).toMatchObject({ mode: 'auto', planner: 'pending' });
    expect(
      fitViewTabState({ ...input, verdict: editor, excluded: true }),
    ).toMatchObject({ available: false, mode: 'off', why: 'excluded' });
    // A person can always ask: a page with little structure, whatever triage says.
    const plain = {
      ...compose,
      verdict: 'fits' as const,
      representable: false,
      blockers: ['no_structure' as const],
    };
    expect(fitViewTabState({ ...input, verdict: plain })).toMatchObject({
      available: true,
      why: null,
    });
    expect(fitViewTabState({ ...input, verdict: editor })).toMatchObject({
      available: false,
      why: 'not_representable',
    });
    expect(fitViewTabState({ ...input, verdict: undefined }).available).toBe(
      false,
    );
  });
});
