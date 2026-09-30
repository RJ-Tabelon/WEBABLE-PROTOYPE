import { strongReaderProfile } from '@webable/core/policy/fixtures';
import type { AppliedChange, PlannedOp } from '@webable/core/policy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PopupStatus } from '../protocol';
import type { TabDetail } from '../sw/ui';
import { createClient, type Transport } from './client';
import { COPY } from './copy';
import {
  fitValue,
  levelIndex,
  structureSummary,
  TEXT_STEPS,
  valueAt,
} from './format';
import { popupModel, reasonChips, undoneRow } from './model';
import { applyPrefs, readSystemSignals } from './theme';

const trace = (
  op: AppliedChange['op'],
  source: PlannedOp['trace']['source'] = 'profile',
) => ({
  op,
  mode: 'auto' as const,
  source,
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

describe('every popup state (design-final 10.2)', () => {
  it('first run: basic fit, quick switches, Tune, sign in', () => {
    const m = popupModel(view('first_run'));
    expect(m.copy.title).toBe('Basic fit is on');
    expect(m.copy.glyph).toBe('on');
    expect(m.quick).toBe(true);
    expect(m.showAdjust).toBe(false);
    expect(m.footer).toEqual(['sent', 'sign_in']);
    expect(m.notes).not.toContain(COPY.signedOut);
  });

  it('checking and still checking keep the page quiet', () => {
    expect(popupModel(view('checking')).copy).toMatchObject({
      glyph: 'checking',
      title: 'Checking this page…',
    });
    expect(popupModel(view('still_checking')).copy).toMatchObject({
      glyph: 'still-checking',
      title: 'Still checking',
    });
  });

  it('adapted: the count excludes changes the checks undid', () => {
    const m = popupModel(
      view('adapted', {
        changes: [
          change('text_floor'),
          change('target_size'),
          change('line_spacing', 'undone_by_checks', { vcode: 'overlap' }),
        ],
      }),
    );
    expect(m.copy.title).toBe('Adapted · 2 changes');
    expect(m.copy.glyph).toBe('adapted');
    expect(m.changes.map((c) => c.label)).toEqual([
      'Text size',
      'Click targets',
    ]);
    expect(m.undone).toHaveLength(1);
    expect(m.undone[0]!.title).toBe('Line spacing was undone');
    expect(m.undone[0]!.detail).toMatch(/so WebAble put it back\.$/);
    expect(m.siteSwitch).toEqual({ on: true });
    expect(m.footer).toEqual(['sent', 'undo_all']);
    expect(m.showAdjust).toBe(true);
  });

  it('nothing to change and all undone', () => {
    expect(popupModel(view('nothing_to_change')).copy.title).toBe(
      'This page already fits you',
    );
    expect(
      popupModel(view('nothing_to_change', { undoneByYou: ['text_floor'] }))
        .copy.title,
    ).toBe('Changes undone on this page');
    const all = popupModel(
      view('all_undone', {
        changes: [change('text_floor', 'undone_by_checks')],
      }),
    );
    expect(all.copy.title).toBe('WebAble undid its changes here');
    expect(all.footer).toEqual(['sent', 'sign_in']);
  });

  it('an offer leaves What changed open, and never shows on a paused site', () => {
    const offer = {
      op: 'target_size',
      level: 2,
      mode: 'offer',
      scope: 'page',
      trace: trace('target_size'),
    } as PlannedOp;
    const m = popupModel(
      view('adapted', { changes: [change('text_floor')], offer }),
    );
    expect(m.offer?.question).toMatch(/\?$/);
    expect(m.collapseChanges).toBe(false);
    expect(popupModel(view('paused', { offer })).offer).toBeNull();
  });

  it('paused and off have one primary action each', () => {
    const paused = popupModel(view('paused'));
    expect(paused.copy.sentence).toBe(
      'news.example.com looks the way the site made it.',
    );
    expect(paused.primary).toEqual({
      kind: 'resume',
      label: 'Resume on this site',
    });
    expect(paused.siteSwitch).toEqual({ on: false });
    const off = popupModel(view('off'));
    expect(off.copy.title).toBe('WebAble is off');
    expect(off.primary?.kind).toBe('turn_on');
    expect(off.siteSwitch).toBeNull();
    expect(off.footer).toEqual([null, 'sign_in']);
    expect(off.notes).toEqual([]);
  });

  it("can't run, couldn't read, and needs site access", () => {
    const cant = popupModel(view('cant_run', { domain: null }));
    expect(cant.copy.sentence).toMatch(/Chrome doesn’t let extensions/);
    expect(cant.primary?.kind).toBe('tune');
    expect(cant.footer).toEqual(['sent', null]);
    expect(cant.domainLine).toBeNull();
    const unread = popupModel(view('unreadable'));
    expect(unread.copy.glyph).toBe('attention');
    expect(unread.primary?.kind).toBe('reload');
    const access = popupModel(view('needs_site_access', { allSites: false }));
    expect(access.primary?.kind).toBe('allow');
    expect(access.askAllSites).toBe(false);
  });

  it('asks for all-sites access only where it is missing', () => {
    expect(popupModel(view('adapted', { allSites: false })).askAllSites).toBe(
      true,
    );
    expect(popupModel(view('adapted', { allSites: true })).askAllSites).toBe(
      false,
    );
    expect(popupModel(view('paused', { allSites: false })).askAllSites).toBe(
      false,
    );
  });

  it('sign in again sits above the underlying state; on-device only stays out of the main view', () => {
    const reauth = popupModel(
      view('adapted', {
        changes: [change('text_floor')],
        account: {
          signedIn: false,
          email: 'a@b.c',
          needsReauth: true,
          cloudAnalysis: true,
          calibrated: true,
        },
      }),
    );
    expect(reauth.reauth).toBe(true);
    expect(reauth.copy).toMatchObject({
      glyph: 'attention',
      title: 'Sign in again to sync',
    });
    expect(reauth.changes).toHaveLength(1);
    const onDevice = popupModel(
      view('nothing_to_change', {
        account: {
          signedIn: true,
          email: 'a@b.c',
          needsReauth: false,
          cloudAnalysis: false,
          calibrated: true,
        },
      }),
    );
    expect(onDevice.notes).not.toContain(COPY.onDevice);
  });

  it('offers only the reasons that make sense for an op', () => {
    expect(reasonChips('text_floor').map((c) => c.reason)).toEqual([
      'dont_want',
      'too_much',
      'too_little',
      'broke_page',
    ]);
    expect(reasonChips('dim_distractions').map((c) => c.reason)).toContain(
      'needed_that',
    );
    expect(reasonChips('focus_outline').map((c) => c.reason)).toEqual([
      'dont_want',
      'broke_page',
    ]);
  });

  it('keeps copy calm: no exclamation marks, no forbidden words, no typed arrows', () => {
    const statuses: PopupStatus[] = [
      'first_run',
      'checking',
      'still_checking',
      'adapted',
      'nothing_to_change',
      'all_undone',
      'paused',
      'off',
      'cant_run',
      'unreadable',
      'needs_site_access',
    ];
    const text = [
      ...statuses.flatMap((s) => {
        const m = popupModel(view(s, { changes: [change('text_floor')] }));
        return [m.copy.title, m.copy.sentence, ...m.notes];
      }),
      ...Object.values(COPY),
      undoneRow(change('line_spacing', 'undone_by_checks', { vcode: 'clip' }))
        .detail,
    ].join('\n');
    expect(text).not.toMatch(/!/);
    expect(text).not.toMatch(
      /\b(test|score|assessment|results|normal|disability|impairment|patient|diagnos)/i,
    );
    expect(text).not.toMatch(/[→↗↺✓]/);
  });
});

describe('fit values', () => {
  it('shows measured before and after with a unit', () => {
    expect(
      fitValue(
        change('text_floor', 'applied', {
          fit: { before: '13 px', after: '18px' },
        }),
      ),
    ).toEqual({
      from: '13',
      to: '18',
      unit: 'px',
    });
  });

  it('keeps a percent sign on the number', () => {
    expect(
      fitValue(
        change('page_zoom', 'applied', {
          fit: { before: '100%', after: '125%' },
        }),
      ),
    ).toEqual({
      from: '100%',
      to: '125%',
    });
  });

  it('shows only the after value when before is not comparable, and never invents numbers', () => {
    expect(
      fitValue(
        change('calm_motion', 'applied', {
          fit: { before: '2 moving', after: '2 paused' },
        }),
      ),
    ).toEqual({
      to: '2',
      unit: 'paused',
    });
    expect(fitValue(change('text_floor', 'applied', { level: 2 }))).toEqual({
      to: '18',
      unit: 'px',
    });
    expect(fitValue(change('focus_outline', 'applied', { level: 0 }))).toEqual({
      to: '3',
      unit: 'px',
    });
    expect(fitValue(change('calm_motion', 'applied', { level: 0 }))).toEqual({
      to: 'On',
    });
  });

  it('maps ladder values to levels', () => {
    expect(TEXT_STEPS).toEqual([14, 16, 18, 21, 24, 28, 32]);
    expect(levelIndex(TEXT_STEPS, 21)).toBe(3);
    expect(levelIndex(TEXT_STEPS, 20)).toBe(3);
    expect(valueAt(TEXT_STEPS, 99)).toBe(32);
  });

  it('summarises a receipt in words from its buckets', () => {
    expect(
      structureSummary({
        page: {
          counts: {
            headings: '4-10',
            forms: '1',
            buttons: '11-30',
            links: '0',
          },
        },
      }),
    ).toBe('4–10 headings, 1 form, 11–30 buttons');
    expect(structureSummary({})).toBeNull();
  });
});

describe('the popup client', () => {
  afterEach(() => vi.useRealTimers());

  function transport(reply: (msg: unknown) => Promise<unknown>) {
    let listener: ((msg: unknown) => void) | null = null;
    const t: Transport = {
      send: reply,
      listen(cb) {
        listener = cb;
        return () => {
          listener = null;
        };
      },
    };
    return { t, emit: (m: unknown) => listener?.(m) };
  }

  it('returns the reply, and null for errors, silence or timeouts', async () => {
    vi.useFakeTimers();
    const ok = createClient(transport(async () => ({ ok: true })).t);
    await expect(ok.send({ type: 'ui:prefs' })).resolves.toEqual({ ok: true });
    const err = createClient(
      transport(async () => ({ ok: false, error: 'internal' })).t,
    );
    await expect(err.send({ type: 'ui:prefs' })).resolves.toBeNull();
    const thrown = createClient(
      transport(async () => Promise.reject(new Error('x'))).t,
    );
    await expect(thrown.send({ type: 'ui:prefs' })).resolves.toBeNull();
    const silent = createClient(
      transport(() => new Promise(() => undefined)).t,
      1000,
    );
    const pending = silent.send({ type: 'ui:prefs' });
    vi.advanceTimersByTime(1000);
    await expect(pending).resolves.toBeNull();
  });

  it('hears only "changed" broadcasts', () => {
    const { t, emit } = transport(async () => null);
    const client = createClient(t);
    const seen: Array<number | null> = [];
    const off = client.onChanged((id) => seen.push(id));
    emit({ type: 'ui:changed', tabId: 3 });
    emit({ type: 'cs:hello' });
    emit({ type: 'ui:changed', tabId: null });
    off();
    emit({ type: 'ui:changed', tabId: 4 });
    expect(seen).toEqual([3, null]);
  });
});

describe('WebAble wears its own adaptations', () => {
  it('applies the fit to its own pages: text scale, targets, motion, theme', () => {
    const root = document.createElement('html');
    applyPrefs(root, {
      theme: 'dark',
      reduceMotion: false,
      profile: strongReaderProfile(),
    });
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--wa-text-scale')).toBe('1.313');
    expect(root.style.getPropertyValue('--wa-target-min')).toBe('44px');
    applyPrefs(root, { theme: 'system', reduceMotion: true, profile: null });
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(root.style.getPropertyValue('--wa-text-scale')).toBe('1');
    expect(root.getAttribute('data-wa-motion')).toBe('reduce');
  });

  it('reads OS preferences from media queries', () => {
    const win = {
      matchMedia: (q: string) => ({
        matches:
          q === '(prefers-reduced-motion: reduce)' || q === '(pointer: fine)',
      }),
      screen: { width: 1440 },
      innerWidth: 1200,
    } as unknown as Window;
    expect(readSystemSignals(win)).toEqual({
      reducedMotion: true,
      colorScheme: 'light',
      moreContrast: false,
      forcedColors: false,
      deviceClass: 'laptop',
      input: 'mouse',
    });
  });
});
