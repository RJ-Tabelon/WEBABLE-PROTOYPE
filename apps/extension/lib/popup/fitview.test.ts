import type { SentReceipt } from '@webable/core/bridge/protocol';
import type { AppliedChange, PlannedOp } from '@webable/core/policy/types';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  FitViewTabState,
  FitViewUnavailable,
  PopupStatus,
} from '../protocol';
import { memoryArea, type KvArea } from '../storage/area';
import { KEYS } from '../storage/keys';
import type { Prefs, TabDetail } from '../sw/ui';
import type { ReplyOf } from './client';
import { COPY, FIT_VIEW_WHY, stateCopy, undoneHere, zoomLowered } from './copy';
import { fitValue } from './format';
import {
  autoSimplifySwitch,
  devPlannerSwitch,
  fitTextLine,
  fitTextStep,
  fitViewModel,
  popupModel,
  RESET_FIT_TEXT,
  reasonChips,
  undoneRow,
} from './model';
import { dismissedNotices, dismissNotice, wantsFitViewNotice } from './notices';
import { outlineSummary, receiptForPage, sentCopy } from './sent';

/** The popup's v2 surfaces: Fit view, triage, page zoom, layout receipts, notices. */

const trace = (op: AppliedChange['op']) => ({
  op,
  mode: 'auto' as const,
  source: 'profile' as PlannedOp['trace']['source'],
  level: 2,
  p: 0.9,
  pOk: 0.9,
  why: 't',
  evidence: [],
});

const change = (
  op: AppliedChange['op'],
  status: AppliedChange['status'] = 'applied',
  extra: Partial<AppliedChange> = {},
): AppliedChange => ({
  op,
  level: 2,
  mode: 'auto',
  status,
  count: 1,
  trace: trace(op),
  ...extra,
});

const signedIn = {
  signedIn: true,
  email: 'a@b.c',
  needsReauth: false,
  cloudAnalysis: false,
  aiLayout: false,
  calibrated: true,
};

function fit(patch: Partial<FitViewTabState> = {}): FitViewTabState {
  return {
    available: true,
    open: false,
    tabMode: false,
    mode: 'offer',
    source: null,
    planner: 'idle',
    verdict: 'compose',
    why: null,
    ...patch,
  };
}

function view(status: PopupStatus, patch: Partial<TabDetail> = {}): TabDetail {
  return {
    tabId: 1,
    domain: 'news.example.com',
    status,
    changes: [],
    offer: null,
    account: {
      signedIn: false,
      email: null,
      needsReauth: false,
      cloudAnalysis: false,
      calibrated: true,
    },
    allSites: true,
    enabled: true,
    analyzed: false,
    lastSentAt: null,
    undoneByYou: [],
    reasonOpen: [],
    site: { paused: false, pins: [], blocks: [], levels: {} },
    levels: { text_floor: 2, line_spacing: 0, target_size: 2 },
    quick: { text: false, targets: false, calm: false },
    quickUndone: [],
    showing: false,
    globalOverrides: {},
    lastSyncAt: null,
    allSitesAskHidden: false,
    needsReload: false,
    onDeviceOnly: true,
    prefs: { theme: 'system', reduceMotion: false, profile: null },
    links: {
      fit: 'w/app',
      tune: 'w/tune',
      help: 'w/help',
      connect: 'w/connect',
      privacy: 'w/app/privacy',
    },
    ...patch,
  };
}

const withFit = (
  patch: Partial<FitViewTabState>,
  extra: Partial<TabDetail> = {},
): TabDetail => view('adapted', { fitView: fit(patch), ...extra });

describe('the Fit view block', () => {
  it('offers the switch, off, on a page Fit view can show', () => {
    expect(fitViewModel(withFit({}))).toEqual({
      toggle: { on: false, description: COPY.fitViewDesc },
      always: null,
      line: null,
      better: false,
      consent: false,
    });
  });

  it('"Simplify this page" is there on every page Fit view can show, whatever triage says', () => {
    expect(COPY.fitView).toBe('Simplify this page');
    for (const verdict of ['fits', 'tailor', 'compose', null] as const)
      expect(fitViewModel(withFit({ verdict }))?.toggle).toEqual({
        on: false,
        description: COPY.fitViewDesc,
      });
    // Restructured on arrival: on, and it says so.
    expect(
      fitViewModel(withFit({ open: true, tabMode: true, verdict: 'tailor' }))
        ?.toggle,
    ).toEqual({ on: true, description: 'Simplified for your fit.' });
  });

  it('is on while open, and "Always here" follows the site', () => {
    const open = fitViewModel(withFit({ open: true, tabMode: true }));
    expect(open?.toggle).toEqual({
      on: true,
      description: 'Simplified for your fit.',
    });
    expect(open?.always).toEqual({ on: false });
    expect(
      fitViewModel(withFit({ open: true, tabMode: true, mode: 'auto' }))
        ?.always,
    ).toEqual({ on: true });
  });

  it('shows nothing while the page is still being read, paused, or off limits', () => {
    expect(fitViewModel(view('adapted'))).toBeNull();
    for (const status of [
      'paused',
      'off',
      'cant_run',
      'unreadable',
      'needs_site_access',
    ] as const)
      expect(fitViewModel(view(status, { fitView: fit() }))).toBeNull();
  });

  it('says nothing about a page it can’t show unless Fit view matters here', () => {
    expect(
      fitViewModel(
        withFit({
          available: false,
          verdict: 'fits',
          why: 'not_representable',
        }),
      ),
    ).toBeNull();
    expect(
      fitViewModel(
        withFit({ available: false, verdict: 'tailor', why: 'excluded' }),
      ),
    ).toBeNull();
  });

  it('gives one plain line, without a switch, when triage suggests Fit view but the page can’t be shown', () => {
    expect(
      fitViewModel(
        withFit({
          available: false,
          verdict: 'compose',
          why: 'blocked_overlay',
        }),
      ),
    ).toEqual({
      toggle: null,
      always: null,
      line: 'Close the site’s pop-up first, then try Fit view.',
      better: false,
      consent: false,
    });
  });

  it('keeps "Always here" reachable on a page of that site it can’t show', () => {
    const m = fitViewModel(
      withFit({
        available: false,
        mode: 'auto',
        verdict: 'tailor',
        why: 'not_representable',
      }),
    );
    expect(m?.toggle).toBeNull();
    expect(m?.always).toEqual({ on: true });
    expect(m?.line).toBe(FIT_VIEW_WHY.not_representable);
  });

  it('in tab mode on a page it can’t show, the switch stays on and says why', () => {
    const m = fitViewModel(
      withFit({ available: false, tabMode: true, why: 'not_representable' }),
    );
    expect(m?.toggle).toEqual({
      on: true,
      description: 'This page can’t be shown in Fit view.',
    });
  });

  it('a failed open keeps the switch and says to try again', () => {
    expect(fitViewModel(withFit({ why: 'error' }))?.toggle).toEqual({
      on: false,
      description: 'Fit view didn’t open on this page. Try again.',
    });
  });

  it('never offers "Always here" on a site Fit view is off for', () => {
    expect(
      fitViewModel(withFit({ open: true, mode: 'off' }))?.always,
    ).toBeNull();
  });
});

describe('planner states', () => {
  it('pending: a quiet planning line under the open switch', () => {
    const m = fitViewModel(
      withFit({ open: true, planner: 'pending', source: 'heuristic' }),
    );
    expect(m?.line).toBe('Planning a better layout…');
    expect(m?.better).toBe(false);
    // Not open: nothing is being planned for the person.
    expect(fitViewModel(withFit({ planner: 'pending' }))?.line).toBeNull();
  });

  it('ready: "A better layout is ready" only while the quick layout shows', () => {
    expect(
      fitViewModel(
        withFit({ open: true, planner: 'ready', source: 'heuristic' }),
      )?.better,
    ).toBe(true);
    expect(
      fitViewModel(withFit({ open: true, planner: 'ready', source: 'planner' }))
        ?.better,
    ).toBe(false);
    expect(
      fitViewModel(withFit({ planner: 'ready', source: 'heuristic' }))?.better,
    ).toBe(false);
  });

  it('unavailable: the consent link only when signed in and not allowed yet', () => {
    const open = {
      open: true,
      planner: 'unavailable' as const,
      needsConsent: true,
    };
    expect(fitViewModel(withFit(open, { account: signedIn }))?.consent).toBe(
      true,
    );
    // Unavailable for another reason (mail, checkout, …): no link.
    expect(
      fitViewModel(
        withFit({ ...open, needsConsent: false }, { account: signedIn }),
      )?.consent,
    ).toBe(false);
    expect(
      fitViewModel(withFit(open, { account: { ...signedIn, aiLayout: true } }))
        ?.consent,
    ).toBe(false);
    expect(fitViewModel(withFit(open))?.consent).toBe(false);
    expect(
      fitViewModel(withFit({ planner: 'unavailable' }, { account: signedIn }))
        ?.consent,
    ).toBe(false);
  });

  it('the main model carries the block', () => {
    expect(popupModel(withFit({ open: true })).fitView?.toggle?.on).toBe(true);
    expect(popupModel(view('adapted')).fitView).toBeNull();
  });
});

describe('Fit view copy', () => {
  it('has a plain line for every reason, in the popup’s voice', () => {
    const reasons: FitViewUnavailable[] = [
      'not_representable',
      'blocked_overlay',
      'excluded',
      'stale',
      'error',
    ];
    const lines = [
      ...reasons.map((r) => FIT_VIEW_WHY[r]),
      COPY.fitViewDesc,
      COPY.alwaysHereDesc,
      COPY.betterLayoutsNote,
      COPY.fitViewNotice,
    ];
    for (const line of lines) {
      expect(line, line).toMatch(/^[A-Z]/);
      expect(line, line).toMatch(/\.$/);
      expect(line, line).not.toMatch(/!|\bAI\b|\bLLM\b|\bmodel\b/);
    }
  });
});

describe('triage line as the state sentence', () => {
  const triaged = (
    status: PopupStatus,
    verdict: FitViewTabState['verdict'],
    patch: Partial<TabDetail> = {},
  ) =>
    stateCopy(
      view(status, {
        triageLine:
          verdict === 'fits'
            ? 'This page already fits you.'
            : 'Small text and crowded buttons for your fit.',
        fitView: fit({ verdict }),
        ...patch,
      }),
    );

  it('adapted: says what the page needed', () => {
    const copy = triaged('adapted', 'tailor', {
      changes: [change('page_zoom')],
    });
    expect(copy.title).toBe('Adapted · 1\u00a0change');
    expect(copy.sentence).toBe('Small text and crowded buttons for your fit.');
  });

  it('a simplified page says so, with what the page needed, and holds back Tailor’s offers', () => {
    const open = {
      fitView: fit({ verdict: 'tailor', open: true, tabMode: true }),
    };
    expect(triaged('nothing_to_change', 'tailor', open)).toEqual({
      glyph: 'adapted',
      title: 'Page simplified',
      sentence: 'Small text and crowded buttons for your fit.',
    });
    expect(
      triaged('adapted', 'tailor', { ...open, triageLine: null }).sentence,
    ).toBe('The same content, in a calmer layout.');
    // Paused or still checking keep their own words.
    expect(triaged('paused', 'tailor', open).title).not.toBe('Page simplified');
    const planned: PlannedOp = {
      op: 'dim_distractions',
      level: 1,
      mode: 'offer',
      scope: 'page',
      trace: { ...trace('dim_distractions'), mode: 'offer' },
    };
    const offered = view('nothing_to_change', {
      offer: planned,
      fitView: fit(),
    });
    expect(popupModel(offered).offer).not.toBeNull();
    expect(
      popupModel({ ...offered, fitView: fit({ open: true }) }).offer,
    ).toBeNull();
  });

  it('a page that needs something is never said to already fit', () => {
    expect(triaged('nothing_to_change', 'compose')).toMatchObject({
      title: 'Nothing changed here',
      sentence: 'Small text and crowded buttons for your fit.',
    });
  });

  it('a page that fits keeps its own words, never repeated', () => {
    expect(triaged('nothing_to_change', 'fits')).toMatchObject({
      title: 'This page already fits you',
      sentence: 'WebAble checked it against your fit.',
    });
    expect(triaged('adapted', 'fits').sentence).toBe(
      'Each one passed WebAble’s checks.',
    );
    // Without the Fit view block, the line itself says it fits.
    expect(
      triaged('nothing_to_change', 'fits', { fitView: undefined }).sentence,
    ).toBe('WebAble checked it against your fit.');
  });

  it('the person’s undo, a reauth and the other states keep their words', () => {
    expect(
      triaged('nothing_to_change', 'tailor', { undoneByYou: ['page_zoom'] })
        .title,
    ).toBe('Changes undone on this page');
    expect(
      triaged('adapted', 'tailor', {
        account: { ...signedIn, needsReauth: true },
      }).title,
    ).toBe('Sign in again to sync');
    expect(triaged('first_run', 'tailor').title).toBe('Basic fit is on');
    expect(triaged('all_undone', 'tailor').title).toBe(
      'WebAble undid its changes here',
    );
  });
});

describe('page zoom rows', () => {
  it('shows the scale as 100% -> 150%', () => {
    expect(
      fitValue(
        change('page_zoom', 'applied', {
          fit: { before: '100%', after: '150%' },
        }),
      ),
    ).toEqual({ from: '100%', to: '150%' });
  });

  it('a zoom the checks lowered says why; one they undid reads like any undone change', () => {
    expect(zoomLowered('nav_hidden')).toBe(
      'Lowered so the site’s menu stays in view',
    );
    expect(zoomLowered('overflow')).toBe('Lowered so the page fits the window');
    expect(zoomLowered('clip')).toBe('Lowered to suit this page');
    expect(
      undoneRow(
        change('page_zoom', 'undone_by_checks', { vcode: 'nav_hidden' }),
      ),
    ).toEqual({
      op: 'page_zoom',
      title: 'Page zoom was undone',
      detail: 'It hid the site’s menu or search, so WebAble put it back.',
    });
    expect(
      popupModel(
        view('adapted', {
          changes: [
            change('text_floor'),
            change('page_zoom', 'undone_by_checks', { vcode: 'overflow' }),
          ],
        }),
      ).undone.map((u) => u.title),
    ).toEqual(['Page zoom was undone']);
  });

  it('the new verifier codes read well as short reasons', () => {
    expect(undoneHere('nav_hidden')).toBe(
      'Undone here: it hid the site’s menu or search',
    );
    expect(undoneHere('truncation')).toBe(
      'Undone here: it cut off more text than before',
    );
    expect(undoneHere('hierarchy')).toBe(
      'Undone here: it made small text bigger than headings',
    );
  });

  it('a zoom the person undid asks why with zoom’s own chips', () => {
    expect(reasonChips('page_zoom').map((c) => c.reason)).toEqual([
      'dont_want',
      'too_much',
      'too_little',
      'broke_page',
    ]);
  });
});

describe('the one-time notice', () => {
  it('waits until WebAble is done with a page, or Fit view can show it', () => {
    expect(wantsFitViewNotice(view('adapted'))).toBe(true);
    expect(wantsFitViewNotice(view('nothing_to_change'))).toBe(true);
    expect(wantsFitViewNotice(view('checking'))).toBe(false);
    expect(wantsFitViewNotice(view('checking', { fitView: fit() }))).toBe(true);
    expect(wantsFitViewNotice(view('cant_run'))).toBe(false);
    expect(wantsFitViewNotice(view('paused'))).toBe(false);
  });

  it('never on first run or above a sign-in prompt', () => {
    expect(wantsFitViewNotice(view('first_run', { fitView: fit() }))).toBe(
      false,
    );
    expect(
      wantsFitViewNotice(
        view('adapted', { account: { ...signedIn, needsReauth: true } }),
      ),
    ).toBe(false);
  });

  it('remembers a dismissal on this device, next to other notices', async () => {
    const area = memoryArea({ [KEYS.notices]: { other: 1 } });
    expect(await dismissedNotices(area)).toEqual(new Set());
    await dismissNotice('fit_view', area, 42);
    expect(await dismissedNotices(area)).toEqual(new Set(['fit_view']));
    expect(area.dump()[KEYS.notices]).toEqual({ other: 1, fit_view: 42 });
  });

  it('a corrupt or unreadable store shows the notice again and never throws', async () => {
    expect(
      await dismissedNotices(memoryArea({ [KEYS.notices]: 'garbage' })),
    ).toEqual(new Set());
    const broken: KvArea = {
      getMany: () => Promise.reject(new Error('gone')),
      getAll: () => Promise.reject(new Error('gone')),
      set: () => Promise.reject(new Error('gone')),
      remove: () => Promise.reject(new Error('gone')),
    };
    expect(await dismissedNotices(broken)).toEqual(new Set());
    await expect(dismissNotice('fit_view', broken)).resolves.toBeUndefined();
  });
});

describe('Settings: dev planner and Fit view text', () => {
  const prefs: Prefs = { theme: 'system', reduceMotion: false, profile: null };

  it('"Simplify busy pages automatically" is on unless turned off', () => {
    expect(autoSimplifySwitch(prefs)).toBe(true);
    expect(autoSimplifySwitch({ ...prefs, autoSimplify: true })).toBe(true);
    expect(autoSimplifySwitch({ ...prefs, autoSimplify: false })).toBe(false);
    expect(COPY.autoSimplify).toBe('Simplify busy pages automatically');
  });

  it('shows the dev planner switch only when the build has one', () => {
    expect(devPlannerSwitch(prefs)).toBeNull();
    expect(devPlannerSwitch({ ...prefs, devPlanner: null })).toBeNull();
    expect(devPlannerSwitch({ ...prefs, devPlanner: false })).toBe(false);
    expect(devPlannerSwitch({ ...prefs, devPlanner: true })).toBe(true);
  });

  it('reads Fit view’s Text − / + override, and says it in steps', () => {
    expect(fitTextStep(prefs)).toBe(0);
    expect(fitTextStep({ ...prefs, fitTextStep: 2 } as Prefs)).toBe(2);
    expect(
      fitTextStep({ ...prefs, fitTextStep: 'x' } as unknown as Prefs),
    ).toBe(0);
    expect(fitTextLine(0)).toBeNull();
    expect(fitTextLine(1)).toBe(
      'In Fit view, text is 1\u00a0step larger than your fit.',
    );
    expect(fitTextLine(-2)).toBe(
      'In Fit view, text is 2\u00a0steps smaller than your fit.',
    );
    expect(RESET_FIT_TEXT).toEqual({ type: 'ui:set-prefs', fitTextStep: 0 });
  });
});

describe('What was sent for layout planning', () => {
  const at = Date.UTC(2026, 9, 15, 14, 41);
  const clock = () => '2:41 PM';
  const layout: SentReceipt = {
    id: 'r2',
    at,
    domain: 'news.example.com',
    destination: 'layout_planning',
    bytes: 2048,
    body: {
      v: 1,
      schema: 1,
      skeleton: { page: {}, nodes: [{ id: 'e0' }, { id: 'e1' }, { id: 'e2' }] },
    },
  };
  const analysis: SentReceipt = {
    ...layout,
    id: 'r1',
    at: at - 5_000,
    destination: 'page_analysis',
    body: { page: { counts: { headings: '4-10', forms: '0' } } },
  };

  it('finds this page view’s request, whichever destination it went to', () => {
    const v = { domain: 'news.example.com', lastSentAt: at };
    expect(receiptForPage([analysis, layout], v)).toBe(layout);
    expect(receiptForPage([analysis], { ...v, lastSentAt: analysis.at })).toBe(
      analysis,
    );
    expect(receiptForPage([layout], { ...v, lastSentAt: null })).toBe(
      undefined,
    );
    expect(receiptForPage(null, v)).toBe(undefined);
  });

  it('says a page outline went to OpenAI, through WebAble’s server', () => {
    expect(sentCopy(view('adapted'), layout, clock)).toEqual({
      lead: 'Last sent 2:41 PM to OpenAI, through WebAble’s server',
      sent: 'a page outline of 3\u00a0parts, to plan a Fit view layout. Its only words are common interface words, like “menu”.',
      notSent:
        'other page words, anything you typed, the address or title, your fit, or who you are.',
    });
    expect(outlineSummary({ skeleton: { nodes: [] } })).toBeNull();
    expect(outlineSummary('nope')).toBeNull();
  });

  it('names the local dev planner when it planned the layout', () => {
    const dev = view('adapted', {
      prefs: {
        theme: 'system',
        reduceMotion: false,
        profile: null,
        devPlanner: true,
      },
    });
    expect(sentCopy(dev, layout, clock).lead).toBe(
      'Last sent 2:41 PM to OpenAI, through the local dev planner',
    );
  });

  it('keeps page analysis’s own words', () => {
    expect(sentCopy(view('adapted'), analysis, clock)).toEqual({
      lead: 'Last sent 2:41 PM to WebAble’s server',
      sent: 'page structure — 4–10 headings.',
      notSent: 'page text, anything you typed, your browsing history.',
    });
  });

  it('with nothing sent, says what could be, from the consents', () => {
    const none = (patch: Partial<TabDetail>) =>
      sentCopy(view('adapted', patch), undefined).sent;
    expect(none({})).toBe('nothing. Suggestions run on this device only.');
    expect(none({ onDeviceOnly: false })).toBe(
      'page structure only, when WebAble is unsure what part of a page is for.',
    );
    expect(none({ account: { ...signedIn, aiLayout: true } })).toBe(
      'a page outline only, when you open Fit view.',
    );
    expect(
      none({ onDeviceOnly: false, account: { ...signedIn, aiLayout: true } }),
    ).toBe(
      'page structure when WebAble is unsure what part of a page is for, and a page outline when you open Fit view.',
    );
  });
});

describe('the worker answers Fit view actions with a fresh view', () => {
  it('types ui:fit-view and ui:fit-view-switch replies as TabDetail', () => {
    expectTypeOf<ReplyOf<'ui:fit-view'>>().toEqualTypeOf<TabDetail>();
    expectTypeOf<ReplyOf<'ui:fit-view-switch'>>().toEqualTypeOf<TabDetail>();
  });
});
