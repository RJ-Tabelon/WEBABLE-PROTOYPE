import type { AppliedChange, PlannedOp } from '@webable/core/policy/types';
import { describe, expect, it } from 'vitest';

import type { PopupStatus } from '../protocol';
import type { TabDetail } from '../sw/ui';
import { COPY, undoneHere } from './copy';
import { originOf, popupModel, quickRows } from './model';

/** The popup's main view: quick switches, block order, notes, footer slots. */

const trace = (op: AppliedChange['op']) => ({
  op,
  mode: 'auto' as const,
  source: 'profile' as const,
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
  count: 2,
  trace: trace(op),
  ...extra,
});

const offer = {
  op: 'target_size',
  level: 2,
  mode: 'offer',
  scope: 'page',
  trace: trace('target_size'),
} as PlannedOp;

const signedIn = {
  signedIn: true,
  email: 'a@b.c',
  needsReauth: false,
  cloudAnalysis: true,
  calibrated: true,
};

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
      calibrated: false,
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

describe('quick switches tell the truth', () => {
  it('a pin the checks undid reads Off with the reason; the rest follow the pin', () => {
    const rows = quickRows(
      view('first_run', {
        quick: { text: true, targets: true, calm: false },
        quickUndone: ['text'],
        changes: [
          change('text_floor', 'undone_by_checks', { vcode: 'clip' }),
          change('target_size'),
        ],
      }),
    );
    expect(rows.map((r) => [r.key, r.on, r.undone])).toEqual([
      ['text', false, 'Undone here: it cut off text'],
      ['targets', true, null],
      ['calm', false, null],
    ]);
  });

  it('an unpinned switch is never marked undone, and a missing code still reads plainly', () => {
    const rows = quickRows(
      view('first_run', {
        quick: { text: false, targets: true, calm: false },
        quickUndone: ['text', 'targets'],
      }),
    );
    expect(rows[0]).toMatchObject({ on: false, undone: null });
    expect(rows[1]).toMatchObject({
      on: false,
      undone: 'Undone here: it didn’t work on this page',
    });
  });

  it('the model carries the rows only on first run', () => {
    expect(popupModel(view('first_run')).quickRows).toHaveLength(3);
    expect(popupModel(view('adapted')).quickRows).toEqual([]);
  });

  it('every verifier code has a short phrase', () => {
    expect(undoneHere('overlap')).toBe('Undone here: it made text overlap');
    expect(undoneHere('timeout')).toBe(
      'Undone here: the page took too long to check',
    );
  });
});

describe('What changed never collapses', () => {
  it('stays open with an offer showing, in every state', () => {
    for (const status of [
      'adapted',
      'first_run',
      'nothing_to_change',
    ] as const) {
      const m = popupModel(
        view(status, { changes: [change('text_floor')], offer }),
      );
      expect(m.offer).not.toBeNull();
      expect(m.collapseChanges).toBe(false);
    }
  });
});

describe('notes', () => {
  it('signed out and on-device only never appear in the main view', () => {
    for (const account of [view('adapted').account, signedIn]) {
      const m = popupModel(
        view('adapted', { account, changes: [change('text_floor')] }),
      );
      expect(m.notes).toEqual([]);
    }
  });

  it('the all-sites line shows until the person hides it', () => {
    expect(popupModel(view('first_run', { allSites: false })).askAllSites).toBe(
      true,
    );
    expect(
      popupModel(
        view('first_run', { allSites: false, allSitesAskHidden: true }),
      ).askAllSites,
    ).toBe(false);
  });

  it('first run keeps Sign in in the footer only', () => {
    const m = popupModel(view('first_run'));
    expect(m.reauth).toBe(false);
    expect(m.primary).toBeNull();
    expect(m.footer).toEqual(['sent', 'sign_in']);
  });
});

describe('copy for a page', () => {
  it('checks against the basic fit until the person tunes', () => {
    expect(popupModel(view('nothing_to_change')).copy.sentence).toBe(
      'WebAble checked it against the basic fit.',
    );
    expect(
      popupModel(view('nothing_to_change', { account: signedIn })).copy
        .sentence,
    ).toBe('WebAble checked it against your fit.');
  });

  it('with an offer, the page does not "already fit"', () => {
    expect(popupModel(view('nothing_to_change', { offer })).copy).toEqual({
      glyph: 'on',
      title: 'Nothing changed here',
      sentence: 'WebAble has one suggestion.',
    });
  });

  it('says where page text stays and how big targets get', () => {
    expect(COPY.siteAccess).toMatch(/never leave your browser\.$/);
    expect(COPY.targetsDesc).toBe('Up to 44 px where there’s room');
  });
});

describe('site access', () => {
  it('asks for this site first', () => {
    const m = popupModel(view('needs_site_access', { allSites: false }));
    expect(m.primary).toEqual({ kind: 'allow', label: 'Allow on this site' });
  });

  it('reads an http(s) origin and nothing else', () => {
    expect(originOf('https://news.example.com/a/b?c=1')).toBe(
      'https://news.example.com',
    );
    expect(originOf('http://127.0.0.1:4173/x')).toBe('http://127.0.0.1:4173');
    expect(originOf('chrome://extensions')).toBeNull();
    expect(originOf('not a url')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});

describe('footer slots stay put', () => {
  it('start is What was sent; end is the state action', () => {
    expect(
      popupModel(view('adapted', { changes: [change('text_floor')] })).footer,
    ).toEqual(['sent', 'undo_all']);
    expect(
      popupModel(view('nothing_to_change', { account: signedIn })).footer,
    ).toEqual(['sent', 'fit']);
    expect(popupModel(view('nothing_to_change')).footer).toEqual([
      'sent',
      'sign_in',
    ]);
    expect(popupModel(view('off', { account: signedIn })).footer).toEqual([
      null,
      'fit',
    ]);
  });

  it('Your fit is never in the start slot', () => {
    const statuses: PopupStatus[] = [
      'first_run',
      'checking',
      'adapted',
      'nothing_to_change',
      'all_undone',
      'paused',
      'off',
      'cant_run',
      'unreadable',
      'needs_site_access',
    ];
    for (const s of statuses) {
      expect(popupModel(view(s, { account: signedIn })).footer[0]).not.toBe(
        'fit',
      );
    }
  });

  it('after Undo all on this page, the end slot is Redo all', () => {
    const m = popupModel(
      view('nothing_to_change', {
        account: signedIn,
        undoneByYou: ['text_floor', 'target_size'],
      }),
    );
    expect(m.footer).toEqual(['sent', 'redo_all']);
  });

  it("can't run: Tune, else Sign in with a fit, else Open your fit", () => {
    const cant = (account: TabDetail['account']) =>
      popupModel(view('cant_run', { domain: null, account })).primary;
    expect(cant(view('cant_run').account)).toEqual({
      kind: 'tune',
      label: 'Tune WebAble to you',
    });
    expect(cant({ ...view('cant_run').account, calibrated: true })).toEqual({
      kind: 'sign_in',
      label: 'Sign in',
    });
    expect(cant(signedIn)).toEqual({ kind: 'fit', label: 'Open your fit' });
  });
});
