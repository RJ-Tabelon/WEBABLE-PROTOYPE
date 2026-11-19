// @vitest-environment node
import { govuk } from '@webable/core/compose/__fixtures__/index';
import { describe, expect, it } from 'vitest';

import { isSkeleton, parseContent, parseFitViewEvent, parseUi } from './router';

/** v2 messages (docs/10): Fit view requests and events, the zoom guard, the popup's Fit view switches. */

describe('Fit view messages from the page', () => {
  it('accepts a request with a well-formed skeleton and a known reason', () => {
    expect(
      parseContent({
        type: 'cs:fitview-request',
        skeleton: govuk,
        reason: 'popup',
      }),
    ).toEqual({ type: 'cs:fitview-request', skeleton: govuk, reason: 'popup' });
    expect(
      parseContent({
        type: 'cs:fitview-request',
        skeleton: govuk,
        reason: 'because',
      }),
    ).toBeNull();
    expect(
      parseContent({
        type: 'cs:fitview-request',
        skeleton: {},
        reason: 'popup',
      }),
    ).toBeNull();
  });

  it('checks the skeleton’s shape before anything reads it', () => {
    expect(isSkeleton(govuk)).toBe(true);
    const node = govuk.nodes[1]!;
    const bad = (patch: Record<string, unknown>) =>
      isSkeleton({ ...govuk, ...patch });
    const badNode = (patch: Record<string, unknown>) =>
      isSkeleton({ ...govuk, nodes: [...govuk.nodes, { ...node, ...patch }] });
    expect(bad({ v: 2 })).toBe(false);
    expect(bad({ extractionId: '' })).toBe(false);
    expect(bad({ nodes: [] })).toBe(false);
    expect(bad({ viewport: { width: 'wide', height: 1, zoom: 1 } })).toBe(
      false,
    );
    expect(bad({ typed: [42] })).toBe(false);
    expect(bad({ nodes: Array.from({ length: 1201 }, () => node) })).toBe(
      false,
    );
    expect(badNode({ id: 'x1' })).toBe(false);
    expect(badNode({ kind: 'widget' })).toBe(false);
    expect(badNode({ box: [0, 0, 10] })).toBe(false);
    expect(badNode({ label: 'x'.repeat(201) })).toBe(false);
    expect(badNode({ flags: 'fixed' })).toBe(false);
    expect(badNode({ collection: { count: 3, exemplar: 'not-an-id' } })).toBe(
      false,
    );
  });

  it('rebuilds events field by field', () => {
    expect(
      parseFitViewEvent({
        kind: 'opened',
        source: 'planner',
        reason: 'tab_mode',
        ms: 12,
        extra: 'dropped',
      }),
    ).toEqual({
      kind: 'opened',
      source: 'planner',
      reason: 'tab_mode',
      ms: 12,
    });
    expect(
      parseFitViewEvent({
        kind: 'closed',
        reason: 'original',
        afterMs: 3000,
        actions: 0,
      }),
    ).toEqual({
      kind: 'closed',
      reason: 'original',
      afterMs: 3000,
      actions: 0,
    });
    expect(
      parseFitViewEvent({
        kind: 'closed',
        reason: 'original',
        afterMs: 3000,
        actions: 1.5,
      }),
    ).toBeNull();
    expect(parseFitViewEvent({ kind: 'peek', on: true })).toEqual({
      kind: 'peek',
      on: true,
    });
    expect(
      parseFitViewEvent({ kind: 'proxy_failed', role: 'link', why: 'blocked' }),
    ).toEqual({ kind: 'proxy_failed', role: 'link', why: 'blocked' });
    expect(
      parseFitViewEvent({ kind: 'proxy_failed', role: 'map', why: 'blocked' }),
    ).toBeNull();
    expect(
      parseFitViewEvent({ kind: 'conservation_failed', missing: 3 }),
    ).toEqual({ kind: 'conservation_failed', missing: 3 });
    expect(
      parseFitViewEvent({ kind: 'offer', surface: 'chip', answer: 'dismiss' }),
    ).toEqual({ kind: 'offer', surface: 'chip', answer: 'dismiss' });
    expect(
      parseFitViewEvent({ kind: 'offer', surface: 'chip', answer: 'never' }),
    ).toBeNull();
    expect(parseFitViewEvent({ kind: 'text_nudge', step: 2 })).toBeNull();
    expect(parseFitViewEvent({ kind: 'text_nudge', step: -1 })).toEqual({
      kind: 'text_nudge',
      step: -1,
    });
    // "Always here" from Fit view's strip.
    expect(parseFitViewEvent({ kind: 'always', on: true })).toEqual({
      kind: 'always',
      on: true,
    });
    expect(parseFitViewEvent({ kind: 'always', on: 'yes' })).toBeNull();
    expect(parseFitViewEvent({ kind: 'oops' })).toBeNull();
    expect(
      parseContent({
        type: 'cs:fitview-event',
        event: { kind: 'peek', on: false },
      }),
    ).toEqual({ type: 'cs:fitview-event', event: { kind: 'peek', on: false } });
  });

  it('keeps a valid zoom-guard report on cs:applied and drops a bad one', () => {
    const applied = {
      type: 'cs:applied',
      planId: 'p',
      changes: [],
    };
    const viewport = {
      zoom: 1.5,
      overflowPx: 0,
      navLinks: 5,
      searchVisible: true,
    };
    expect(parseContent({ ...applied, viewport })).toEqual({
      ...applied,
      viewport,
    });
    expect(
      parseContent({ ...applied, viewport: { ...viewport, navLinks: -1 } }),
    ).toEqual(applied);
    expect(parseContent({ ...applied, viewport: 'wide' })).toEqual(applied);
    // The title count travels with the guard report, as a pair.
    const titles = { ...viewport, newlyEllipsised: 4, titlesShown: 12 };
    expect(parseContent({ ...applied, viewport: titles })).toEqual({
      ...applied,
      viewport: titles,
    });
    expect(
      parseContent({
        ...applied,
        viewport: { ...viewport, newlyEllipsised: 4 },
      }),
    ).toEqual({ ...applied, viewport });
  });
});

describe('Fit view messages from the popup', () => {
  it('accepts the Fit view switches for a tab', () => {
    expect(
      parseUi(
        { type: 'ui:fit-view', tabId: 3, on: true, scope: 'page' },
        false,
      ),
    ).not.toBeNull();
    expect(
      parseUi(
        { type: 'ui:fit-view', tabId: 3, on: false, scope: 'site' },
        false,
      ),
    ).not.toBeNull();
    expect(
      parseUi({ type: 'ui:fit-view', tabId: 3, on: true, scope: 'all' }, false),
    ).toBeNull();
    expect(
      parseUi(
        { type: 'ui:fit-view', tabId: -3, on: true, scope: 'page' },
        false,
      ),
    ).toBeNull();
    expect(
      parseUi({ type: 'ui:fit-view-switch', tabId: 3 }, false),
    ).not.toBeNull();
    expect(parseUi({ type: 'ui:fit-view-switch' }, false)).toBeNull();
    expect(
      parseUi({ type: 'ui:set-prefs', devPlanner: true }, false),
    ).not.toBeNull();
    expect(
      parseUi({ type: 'ui:set-prefs', devPlanner: 'yes' }, false),
    ).toBeNull();
    expect(
      parseUi({ type: 'ui:set-prefs', fitTextStep: 0 }, false),
    ).not.toBeNull();
    expect(
      parseUi({ type: 'ui:set-prefs', fitTextStep: -4 }, false),
    ).not.toBeNull();
    expect(
      parseUi({ type: 'ui:set-prefs', fitTextStep: 1.5 }, false),
    ).toBeNull();
    expect(parseUi({ type: 'ui:set-prefs', fitTextStep: 9 }, false)).toBeNull();
    expect(
      parseUi({ type: 'ui:set-prefs', autoSimplify: false }, false),
    ).not.toBeNull();
    expect(
      parseUi({ type: 'ui:set-prefs', autoSimplify: 'off' }, false),
    ).toBeNull();
  });
});
