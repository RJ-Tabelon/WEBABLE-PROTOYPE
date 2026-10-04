import { expect, test } from '@playwright/test';

import { domState, open, plan, PRIVATE_STRINGS } from './helpers';

const hello = {
  enabled: true,
  paused: false,
  prePaint: [],
  tabSession: 'tab-1',
};

test.describe('content script flow (fake service worker)', () => {
  test('a rejected fit does not flash on every unrelated update, and retries when the clipping box changes', async ({
    page,
  }) => {
    await open(page, 'clip');
    await page.evaluate(
      ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
      [plan([{ op: 'text_floor', level: 2 }]), hello] as const,
    );
    const sizes = await page.evaluate(async () => {
      const p = document.querySelector('#card-1 p')!;
      const ticker = document.createElement('span');
      document.body.append(ticker);
      const timer = setInterval(() => {
        ticker.textContent = String(Date.now());
      }, 180);
      const sizes: number[] = [];
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const frame = () => {
          sizes.push(parseFloat(getComputedStyle(p).fontSize));
          if (performance.now() - start < 3500) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      clearInterval(timer);
      return sizes;
    });
    expect(Math.max(...sizes)).toBe(12);
    await page.locator('.card').evaluateAll((cards) =>
      cards.forEach((card) => {
        (card as HTMLElement).style.height = '160px';
      }),
    );
    await expect
      .poll(() =>
        page.locator('#card-1 p').evaluate((p) => getComputedStyle(p).fontSize),
      )
      .toBe('18px');
  });

  for (const fixture of ['large', 'shadow'] as const) {
    test(`${fixture}: extraction yields and shadow styles never expose the original fit`, async ({
      page,
    }) => {
      await open(page, fixture);
      await page.evaluate(() => {
        const root =
          document.querySelector('product-card')?.shadowRoot ?? document;
        const style = document.createElement('style');
        style.textContent =
          'p { transition: font-size 400ms, line-height 400ms; }';
        (root instanceof Document ? root.head : root).append(style);
      });
      await page.evaluate(
        ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
        [plan([{ op: 'text_floor', level: 2 }]), hello] as const,
      );
      const sizes = await page.evaluate(async () => {
        const root =
          document.querySelector('product-card')?.shadowRoot ?? document;
        const paragraphs = [...root.querySelectorAll('p')].filter(
          (p) => getComputedStyle(p).fontSize === '18px',
        );
        const watched = [
          paragraphs[0]!,
          paragraphs[Math.floor(paragraphs.length / 2)]!,
          paragraphs.at(-1)!,
        ];
        const ticker = document.createElement('span');
        document.body.append(ticker);
        const timer = setInterval(() => {
          ticker.textContent = String(Date.now());
        }, 180);
        const sizes: number[] = [];
        const start = performance.now();
        await new Promise<void>((resolve) => {
          const frame = () => {
            for (const p of watched)
              sizes.push(parseFloat(getComputedStyle(p).fontSize));
            if (performance.now() - start < 3500) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });
        clearInterval(timer);
        return sizes;
      });
      expect(sizes.length).toBeGreaterThan(30);
      expect(Math.min(...sizes)).toBe(18);
      expect(Math.max(...sizes)).toBe(18);
    });
  }

  test('adapted text stays stable on every frame during repeated page updates and host transitions', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.addStyleTag({
      content:
        'main p { transition: font-size 400ms, line-height 400ms, color 400ms; }',
    });
    await page.evaluate(
      ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
      [plan([{ op: 'text_floor', level: 2 }]), hello] as const,
    );
    await page.waitForTimeout(600);
    const samples = await page.evaluate(async () => {
      const p = document.querySelector('main p:not(.byline)')!;
      const main = p.parentElement!;
      const tick = document.createElement('span');
      document.body.append(tick);
      // Text-only churn every 180 ms, and new paragraphs arriving now and then.
      const timer = setInterval(() => {
        tick.textContent = String(Date.now());
      }, 180);
      let n = 0;
      const more = setInterval(() => {
        const extra = document.createElement('p');
        extra.textContent = `Arriving paragraph ${++n} with enough words to read as running text in the story.`;
        main.append(extra);
      }, 400);
      const sizes: number[] = [];
      const arrivals: number[] = [];
      const opacityTransition = p.animate([{ opacity: 1 }, { opacity: 0.4 }], {
        duration: 10000,
      });
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const frame = () => {
          sizes.push(parseFloat(getComputedStyle(p).fontSize));
          for (const q of main.querySelectorAll('p:not(.byline)'))
            arrivals.push(parseFloat(getComputedStyle(q).fontSize));
          if (performance.now() - start < 6500) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      clearInterval(timer);
      clearInterval(more);
      return {
        sizes,
        arrivals,
        sent: window.__webableEngine.sentMessages(),
        animationState: opacityTransition.playState,
      };
    });
    expect(samples.sizes.length).toBeGreaterThan(30);
    expect(
      Math.min(...samples.sizes),
      'no frame may expose the original or transitioning text',
    ).toBe(18);
    expect(Math.max(...samples.sizes)).toBe(18);
    // Arriving paragraphs are fitted in their first frame, never animating in.
    expect(Math.min(...samples.arrivals)).toBe(18);
    expect(Math.max(...samples.arrivals)).toBe(18);
    // Text-only churn never re-measures the page; arriving content does, at a
    // calm rate, always measuring the site's own styles.
    const signals = samples.sent.filter((m) => m.type === 'cs:signals');
    expect(signals.length).toBeGreaterThanOrEqual(2);
    expect(signals.length).toBeLessThanOrEqual(3);
    expect(signals.map((m) => m.signals.text.mainFontPx)).toEqual(
      signals.map(() => 13),
    );
    expect(samples.animationState).toBe('running');
    // At most one trailing decision for the last arrivals, then quiet.
    await page.waitForTimeout(6000);
    const quietCount = await page.evaluate(
      () =>
        window.__webableEngine
          .sentMessages()
          .filter((m) => m.type === 'cs:signals').length,
    );
    await page.waitForTimeout(1500);
    expect(
      await page.evaluate(
        () =>
          window.__webableEngine
            .sentMessages()
            .filter((m) => m.type === 'cs:signals').length,
      ),
    ).toBe(quietCount);
  });

  test('Undo wins over a page plan that was already in flight', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(
      ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
      [plan([{ op: 'text_floor', level: 2 }]), hello] as const,
    );
    await page.evaluate(() => {
      window.__webableEngine.holdSignals(true);
      // Content arrives: the page asks for a fresh decision (rate-limited).
      const main = document.querySelector(
        'main p:not(.byline)',
      )!.parentElement!;
      for (let i = 0; i < 3; i++) {
        const p = document.createElement('p');
        p.textContent = 'More content while planning, long enough to be read.';
        main.append(p);
      }
    });
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() => window.__webableEngine.sentMessages())
          ).filter((m) => m.type === 'cs:signals').length,
        { timeout: 10_000 },
      )
      .toBe(2);
    await page.evaluate(() =>
      window.__webableEngine.workerMessage({
        type: 'sw:undo',
        op: 'text_floor',
      }),
    );
    await page.evaluate(() => window.__webableEngine.holdSignals(false));
    await page.waitForTimeout(1000);
    expect(
      await page
        .locator('main p:not(.byline)')
        .first()
        .evaluate((p) => getComputedStyle(p).fontSize),
    ).toBe('13px');
  });

  test('late AI cannot add a new change after a real interaction or an obsolete plan', async ({
    page,
  }) => {
    await open(page, 'article');
    const initial = plan([{ op: 'text_floor', level: 2 }]);
    await page.evaluate(
      ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
      [initial, hello] as const,
    );
    await page.mouse.click(1200, 750);
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.__webableEngine.sentMessages())).map(
          (m) => m.type,
        ),
      )
      .toContain('cs:interaction');
    const late = plan([{ op: 'contrast' }]);
    const reply = await page.evaluate(
      (pl) =>
        window.__webableEngine.workerMessage({
          type: 'sw:plan',
          plan: pl,
          reason: 'refine',
          basePlanId: 'obsolete-plan',
        }),
      late,
    );
    expect(reply).toMatchObject({
      changes: [{ op: 'text_floor', status: 'applied' }],
    });
    const interacted = await page.evaluate(
      ([pl, id]) =>
        window.__webableEngine.workerMessage({
          type: 'sw:plan',
          plan: pl,
          reason: 'refine',
          basePlanId: id,
        }),
      [late, initial.id] as const,
    );
    expect(interacted).toMatchObject({
      changes: [{ op: 'text_floor', status: 'applied' }],
    });
  });

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

  test('one engine per document: a second injection reports the running one', async ({
    page,
  }) => {
    await open(page, 'article');
    const p = plan([{ op: 'text_floor', level: 2 }]);
    const first = await page.evaluate(
      ([pl, h]) =>
        window.__webableEngine.injectAdapter(pl as never, h as never),
      [p, hello] as const,
    );
    expect(first.created).toBe(true);
    expect(first.sent.map((m) => m.type)).toEqual([
      'cs:hello',
      'cs:signals',
      'cs:applied',
    ]);
    const second = await page.evaluate(
      ([pl, h]) =>
        window.__webableEngine.injectAdapter(pl as never, h as never),
      [p, hello] as const,
    );
    expect(second.created).toBe(false);
    expect(second.adaptersCreated).toBe(1);
    expect(second.sent).toEqual([
      { type: 'cs:hello', restored: true },
      {
        type: 'cs:applied',
        planId: p.id,
        changes: [
          expect.objectContaining({ op: 'text_floor', status: 'applied' }),
        ],
      },
    ]);
    expect(
      await page.evaluate(() => document.querySelectorAll('webable-ui').length),
    ).toBe(1);
    await page.evaluate(() => window.__webableEngine.stopAdapter());
  });

  test('sw:offer-resolved is answered; the toast Undo sends one cs:undo-all', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(
      ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
      [
        plan([{ op: 'text_floor', level: 2 }, { op: 'contrast' }]),
        hello,
      ] as const,
    );
    expect(
      await page.evaluate(() =>
        window.__webableEngine.workerMessage({
          type: 'sw:offer-resolved',
          op: 'line_spacing',
        }),
      ),
    ).toEqual({ ok: true });
    const pressed = await page.evaluate(
      () =>
        window.__webableEngine.adapterPress('Undo') ||
        window.__webableEngine.adapterPress('Undo all'),
    );
    expect(pressed).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__webableEngine.sentMessages().map((m) => m.type),
        ),
      )
      .toContain('cs:undo-all');
    const sent = await page.evaluate(() =>
      window.__webableEngine.sentMessages(),
    );
    expect(sent.filter((m) => m.type === 'cs:undo-all')).toEqual([
      { type: 'cs:undo-all', source: 'toast' },
    ]);
    expect(sent.filter((m) => m.type === 'cs:event')).toEqual([]);
    await page.evaluate(() => window.__webableEngine.stopAdapter());
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
