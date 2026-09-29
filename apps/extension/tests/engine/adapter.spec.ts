import { expect, test } from '@playwright/test';

import { domState, open, plan, PRIVATE_STRINGS } from './helpers';

const hello = {
  enabled: true,
  paused: false,
  prePaint: [],
  tabSession: 'tab-1',
};

test.describe('content script flow (fake service worker)', () => {
  test('hello -> signals -> apply -> applied, and nothing private is sent', async ({
    page,
  }) => {
    await open(page, 'article');
    const p = plan([{ op: 'text_floor', level: 2 }, { op: 'contrast' }]);
    const sent = await page.evaluate(
      ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
      [p, hello] as const,
    );
    expect(sent.map((m) => m.type)).toEqual([
      'cs:hello',
      'cs:signals',
      'cs:applied',
    ]);
    const serialized = JSON.stringify(sent).toLowerCase();
    for (const s of PRIVATE_STRINGS)
      expect(serialized, `leaked "${s}"`).not.toContain(s);
    const applied = sent[2] as {
      planId: string;
      changes: Array<{ op: string; status: string }>;
    };
    expect(applied.planId).toBe(p.id);
    expect(applied.changes.map((c) => [c.op, c.status])).toEqual([
      ['text_floor', 'applied'],
      ['contrast', 'applied'],
    ]);
    // First automatic changes on this site: the adapter's engine shows the toast.
    expect(
      await page.evaluate(() => document.querySelector('webable-ui') !== null),
    ).toBe(true);
  });

  test('every worker message is answered in its reply shape', async ({
    page,
  }) => {
    await open(page, 'article');
    const dom0 = await domState(page);
    await page.evaluate(
      ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
      [plan([{ op: 'text_floor', level: 2 }]), hello] as const,
    );
    const msg = (m: unknown) =>
      page.evaluate((x) => window.__webableEngine.workerMessage(x), m);
    const changes = (await msg({ type: 'sw:get-changes' })) as {
      changes: unknown[];
      status: string;
    };
    expect(changes.status).toBe('ready');
    expect(changes.changes).toHaveLength(1);
    expect(
      await msg({ type: 'sw:set-level', op: 'text_floor', level: 3 }),
    ).toMatchObject({
      changes: [{ op: 'text_floor', level: 3, status: 'applied' }],
    });
    expect(await msg({ type: 'sw:show-on-page', op: null, on: true })).toEqual({
      ok: true,
    });
    expect(await msg({ type: 'sw:show-on-page', op: null, on: false })).toEqual(
      { ok: true },
    );
    expect(await msg({ type: 'sw:reading-guide', on: true })).toEqual({
      ok: true,
    });
    expect(await msg({ type: 'sw:focus-layer' })).toEqual({ ok: true });
    expect(await msg({ type: 'sw:pause' })).toEqual({ ok: true });
    const paused = await domState(page);
    expect(paused.filter((l) => !l.includes(':html['))).toEqual(
      dom0.filter((l) => !l.includes(':html[')),
    );
    const resumed = (await msg({ type: 'sw:resume' })) as {
      changes: Array<{ op: string }>;
    };
    expect(resumed.changes.map((c) => c.op).sort()).toEqual([
      'reading_guide',
      'text_floor',
    ]);
    expect(await msg({ type: 'sw:undo', op: 'all' })).toEqual({ changes: [] });
    expect(
      await msg({
        type: 'sw:plan',
        plan: plan([{ op: 'contrast' }]),
        reason: 'refine',
      }),
    ).toMatchObject({
      changes: [{ op: 'contrast', status: 'applied' }],
    });
    expect(
      await msg({
        type: 'sw:offer',
        offer: plan([{ op: 'line_spacing', mode: 'offer' }]).ops[0],
      }),
    ).toEqual({ ok: true });
    expect(await msg({ type: 'not-a-message' })).toBeUndefined();
    await page.evaluate(() => window.__webableEngine.stopAdapter());
    expect(await domState(page)).toEqual(dom0);
  });

  test('turned off or paused: the page is left exactly as the site made it', async ({
    page,
  }) => {
    await open(page, 'article');
    const dom0 = await domState(page);
    const sent = await page.evaluate(
      ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
      [
        plan([{ op: 'text_floor', level: 2 }]),
        { ...hello, paused: true },
      ] as const,
    );
    expect(sent.map((m) => m.type)).toEqual(['cs:hello']);
    const now = await domState(page);
    expect(now.filter((l) => !l.includes(':html['))).toEqual(
      dom0.filter((l) => !l.includes(':html[')),
    );
  });
});
