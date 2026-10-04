import type { AppliedChange } from '@webable/core/policy/types';
import { describe, expect, it } from 'vitest';

import type { PopupStatus } from '../protocol';
import { memoryArea } from '../storage/area';
import { BADGE_ACCENT, BADGE_WARN, badgeFor, iconPaths } from './badge';
import {
  BREAKER,
  breakerFailure,
  breakerOpen,
  breakerSuccess,
  closedBreaker,
  normalizeBreaker,
} from './breaker';
import { classifyUrl, displayDomain, registrableDomain } from './domain';
import { parseContent, parseUi, senderKind } from './router';
import {
  freshTab,
  popupStatus,
  STILL_CHECKING_MS,
  TabRegistry,
  type TabRecord,
} from './tabs';

const change = (
  status: AppliedChange['status'],
  op: AppliedChange['op'] = 'text_floor',
): AppliedChange => ({
  op,
  level: 2,
  mode: 'auto',
  status,
  count: 1,
  trace: {
    op,
    mode: 'auto',
    source: 'profile',
    level: 2,
    p: 0.9,
    pOk: 0.9,
    why: 't',
    evidence: [],
  },
});

describe('toolbar badge, icon and title (design-final 10.2, 10.4)', () => {
  const b = (status: PopupStatus, count = 0, needsReauth = false) =>
    badgeFor({ status, count, needsReauth });

  it('always sets a title, so the state exists as text', () => {
    const all: PopupStatus[] = [
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
    for (const s of all) expect(b(s).title).toMatch(/^WebAble/);
  });

  it('shows the change count on fern with white text', () => {
    expect(b('adapted', 3)).toMatchObject({
      icon: 'ink',
      text: '3',
      color: BADGE_ACCENT,
      title: 'WebAble: 3 changes on this page',
    });
    expect(b('adapted', 1).title).toBe('WebAble: 1 change on this page');
    expect(b('adapted', 250).text).toBe('99+');
  });

  it('badges nothing else: offers, checking and first run without changes stay quiet', () => {
    expect(b('checking').text).toBe('');
    expect(b('still_checking').text).toBe('');
    expect(b('nothing_to_change').text).toBe('');
    expect(b('all_undone').text).toBe('');
    expect(b('first_run').text).toBe('');
    expect(b('adapted', 0).text).toBe('');
  });

  it('uses "!" on amber only to ask for a new sign-in', () => {
    expect(b('adapted', 2, true)).toMatchObject({
      text: '!',
      color: BADGE_WARN,
      title: 'WebAble: sign in again to sync',
    });
  });

  it('greys the tile when paused, off, or unable to run', () => {
    expect(b('paused')).toMatchObject({
      icon: 'paused',
      text: '',
      title: 'WebAble: paused on this site',
    });
    expect(b('off')).toMatchObject({
      icon: 'paused',
      text: '',
      title: 'WebAble: off',
    });
    expect(b('cant_run')).toMatchObject({
      icon: 'cant',
      text: '',
      title: "WebAble can't change this page",
    });
    // Paused wins over a stale reauth badge: nothing runs here.
    expect(b('paused', 0, true).text).toBe('');
  });

  it('points at the toolbar sizes of each tile', () => {
    expect(iconPaths('ink')).toEqual({
      '16': '/icons/16.png',
      '24': '/icons/24.png',
      '32': '/icons/32.png',
    });
    expect(iconPaths('paused')['16']).toBe('/icons/paused-16.png');
  });
});

describe('popup status per tab', () => {
  const ctx = {
    enabled: true,
    paused: false,
    allSites: true,
    firstRun: false,
    now: 10_000,
  };
  const tab = (patch: Partial<TabRecord>): TabRecord => ({
    ...freshTab(1),
    access: 'web',
    domain: 'a.com',
    engine: true,
    phase: 'ready',
    ...patch,
  });

  it('orders the checks: off, can’t run, paused, access, reading, checking', () => {
    expect(popupStatus(tab({}), { ...ctx, enabled: false })).toBe('off');
    expect(popupStatus(tab({ access: 'restricted' }), ctx)).toBe('cant_run');
    expect(popupStatus(tab({}), { ...ctx, paused: true })).toBe('paused');
    expect(
      popupStatus(tab({ engine: false }), { ...ctx, allSites: false }),
    ).toBe('needs_site_access');
    expect(popupStatus(tab({ engine: false }), ctx)).toBe('unreadable');
    expect(popupStatus(tab({ phase: 'unreadable' }), ctx)).toBe('unreadable');
  });

  it('turns "checking" into "still checking" after 5 s', () => {
    expect(
      popupStatus(tab({ phase: 'checking', checkingSince: 9_000 }), ctx),
    ).toBe('checking');
    expect(
      popupStatus(
        tab({ phase: 'checking', checkingSince: 10_000 - STILL_CHECKING_MS }),
        ctx,
      ),
    ).toBe('still_checking');
  });

  it('tells adapted, nothing to change and all undone apart', () => {
    expect(popupStatus(tab({ changes: [change('applied')] }), ctx)).toBe(
      'adapted',
    );
    expect(popupStatus(tab({ changes: [] }), ctx)).toBe('nothing_to_change');
    expect(
      popupStatus(tab({ changes: [change('undone_by_checks')] }), ctx),
    ).toBe('all_undone');
    // The person undid the rest: the page is as the site made it, not "undone by checks".
    expect(
      popupStatus(
        tab({
          changes: [change('undone_by_checks')],
          undoneByYou: ['page_zoom'],
        }),
        ctx,
      ),
    ).toBe('nothing_to_change');
    expect(popupStatus(tab({}), { ...ctx, firstRun: true })).toBe('first_run');
  });

  it('mirrors tab records to session storage and reads them back after a restart', async () => {
    const area = memoryArea();
    const reg = new TabRegistry(area);
    await reg.update(7, (t) => {
      t.domain = 'a.com';
      t.changes = [change('applied')];
    });
    await new Promise((r) => setTimeout(r, 0));
    const again = new TabRegistry(area);
    expect((await again.get(7)).domain).toBe('a.com');
    expect((await again.get(7)).changes).toHaveLength(1);
  });
});

describe('page access and site keys', () => {
  it('keeps the registrable domain only', () => {
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(registrableDomain('me.github.io')).toBe('me.github.io');
    expect(registrableDomain('a.b.me.github.io')).toBe('me.github.io');
    expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1');
    expect(registrableDomain('localhost')).toBe('localhost');
  });

  it('knows where Chrome forbids extensions', () => {
    expect(classifyUrl('chrome://settings')).toEqual({ kind: 'restricted' });
    expect(classifyUrl('https://chromewebstore.google.com/detail/x')).toEqual({
      kind: 'restricted',
    });
    expect(classifyUrl('https://chrome.google.com/webstore/detail/x')).toEqual({
      kind: 'restricted',
    });
    expect(classifyUrl('https://example.com/file.pdf')).toEqual({
      kind: 'restricted',
    });
    expect(classifyUrl('chrome-extension://abc/popup.html')).toEqual({
      kind: 'restricted',
    });
    expect(classifyUrl(undefined)).toEqual({ kind: 'unknown' });
    expect(classifyUrl('https://news.example.com/a?b=c')).toEqual({
      kind: 'web',
      domain: 'example.com',
    });
    expect(classifyUrl('file:///Users/me/page.html')).toEqual({
      kind: 'web',
      domain: 'file',
    });
    expect(displayDomain('file')).toBe('File on this computer');
  });
});

describe('page-analysis circuit breaker', () => {
  it('opens after three failures for 5 minutes, doubling up to an hour', () => {
    let s = closedBreaker();
    s = breakerFailure(s, 0);
    s = breakerFailure(s, 0);
    expect(breakerOpen(s, 0)).toBe(false);
    s = breakerFailure(s, 0);
    expect(breakerOpen(s, BREAKER.BASE_MS - 1)).toBe(true);
    expect(breakerOpen(s, BREAKER.BASE_MS)).toBe(false);
    for (let i = 0; i < 30; i++) s = breakerFailure(s, 0);
    expect(s.backoffMs).toBeLessThanOrEqual(BREAKER.MAX_MS);
  });

  it('honours the server’s retry-after at once, and a success closes it', () => {
    const s = breakerFailure(closedBreaker(), 1000, 90_000);
    expect(breakerOpen(s, 1000 + 89_999)).toBe(true);
    expect(breakerSuccess()).toEqual(closedBreaker());
    expect(normalizeBreaker('junk')).toEqual(closedBreaker());
  });
});

describe('runtime message validation', () => {
  const EXT = 'abcdefghijklmnopabcdefghijklmnop';

  it('tells content scripts from extension pages from strangers', () => {
    expect(
      senderKind({ id: EXT, tab: { id: 3 }, url: 'https://a.com/' }, EXT),
    ).toBe('content');
    expect(
      senderKind({ id: EXT, url: `chrome-extension://${EXT}/popup.html` }, EXT),
    ).toBe('page');
    expect(senderKind({ id: 'other', tab: { id: 3 } }, EXT)).toBe('unknown');
    expect(senderKind({ id: EXT }, EXT)).toBe('unknown');
  });

  it('accepts well-formed content messages only', () => {
    expect(parseContent({ type: 'cs:hello' })).toEqual({ type: 'cs:hello' });
    expect(
      parseContent({
        type: 'cs:friction',
        signal: 'rage_click',
        ops: ['target_size'],
      }),
    ).not.toBeNull();
    expect(
      parseContent({ type: 'cs:friction', signal: 'hover', ops: [] }),
    ).toBeNull();
    expect(
      parseContent({ type: 'cs:offer-answer', op: 'nope', answer: 'accept' }),
    ).toBeNull();
    expect(
      parseContent({
        type: 'cs:signals',
        signals: { v: 2 },
        evidence: { page: {}, regions: {} },
      }),
    ).toBeNull();
    expect(parseContent({ type: 'ui:enabled', enabled: false })).toBeNull();
  });

  it('accepts well-formed page messages only, and test hooks only in e2e builds', () => {
    expect(parseUi({ type: 'ui:view', tabId: 4 }, false)).not.toBeNull();
    expect(parseUi({ type: 'ui:view', tabId: -1 }, false)).toBeNull();
    expect(
      parseUi(
        {
          type: 'ui:set-level',
          tabId: 4,
          op: 'text_floor',
          level: 3,
          scope: 'site',
        },
        false,
      ),
    ).not.toBeNull();
    expect(
      parseUi(
        {
          type: 'ui:set-level',
          tabId: 4,
          op: 'text_floor',
          level: 3,
          scope: 'all',
        },
        false,
      ),
    ).toBeNull();
    expect(
      parseUi(
        {
          type: 'ui:undo-reason',
          tabId: 4,
          op: 'text_floor',
          reason: 'too_much',
        },
        false,
      ),
    ).not.toBeNull();
    expect(
      parseUi(
        { type: 'ui:undo-reason', tabId: 4, op: 'text_floor', reason: 'meh' },
        false,
      ),
    ).toBeNull();
    expect(parseUi({ type: 'ui:set-prefs', theme: 'neon' }, false)).toBeNull();
    expect(parseUi({ type: 'e2e:seed', reset: true }, false)).toBeNull();
    expect(parseUi({ type: 'e2e:seed', reset: true }, true)).not.toBeNull();
    expect(parseUi({ type: 'cs:hello' }, false)).toBeNull();
  });
});
