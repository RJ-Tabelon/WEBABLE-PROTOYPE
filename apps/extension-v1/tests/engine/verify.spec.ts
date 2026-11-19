import { expect, test, type Page } from '@playwright/test';

import { domState, open, plan, regionKeys, styleState } from './helpers';

/**
 * Paragraphs whose clipping box is sized by a fixed-height flex column four
 * levels up: nothing within three ancestors says the text cannot grow, so
 * only verification can find out.
 */
async function hiddenConstraint(page: Page): Promise<void> {
  await open(page, 'article');
  await page.evaluate(() => {
    document.body.innerHTML = `<main><h1>Notes</h1><div class="outer"><div class="pane"><div><div><p>Small print that fits this panel exactly until it grows, then the panel cuts it off.</p><p>Another line of small print in the same panel, written to fill it.</p></div></div></div></div><p>A paragraph outside the panel, free to grow with the rest.</p></main>`;
    const style = document.createElement('style');
    style.textContent =
      'body { margin: 0; font-family: Arial, sans-serif; } main p { font-size: 12px; line-height: 15px; margin: 0 0 4px; } .outer { display: flex; flex-direction: column; height: 72px; width: 320px; } .pane { flex: 1; min-height: 0; overflow: hidden; }';
    document.head.append(style);
  });
}

test.describe('verification and rollback', () => {
  test('clipping trap: a class whose box would cut its text off is never enlarged', async ({
    page,
  }) => {
    await open(page, 'clip');
    await page.evaluate(() => window.__webableEngine.extract());
    const dom0 = await domState(page);
    const css0 = await styleState(page);
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 2 }]),
    );
    // The cards' text sits in fixed-height boxes that clip: excluded as a
    // class before anything is written. What is left already reads at 18 px.
    expect(changes[0]).toMatchObject({
      op: 'text_floor',
      status: 'not_needed',
    });
    expect(await domState(page)).toEqual(dom0);
    expect(await styleState(page)).toEqual(css0);
    expect(await page.evaluate(() => window.__webableEngine.applied())).toEqual(
      [],
    );
  });

  test('a constraint no style announces: text floor is undone whole by checks with vcode clip', async ({
    page,
  }) => {
    await hiddenConstraint(page);
    await page.evaluate(() => window.__webableEngine.extract());
    const dom0 = await domState(page);
    const css0 = await styleState(page);
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 2 }]),
    );
    expect(changes[0]).toMatchObject({
      op: 'text_floor',
      status: 'undone_by_checks',
      vcode: 'clip',
    });
    // Rolled back completely: the page is exactly as it was, every paragraph
    // included (no element-by-element patchwork).
    expect(await domState(page)).toEqual(dom0);
    expect(await styleState(page)).toEqual(css0);
    expect(await page.evaluate(() => window.__webableEngine.applied())).toEqual(
      [],
    );
  });

  test('clipping trap: line spacing is undone by checks with vcode clip', async ({
    page,
  }) => {
    await open(page, 'clip');
    await page.evaluate(() => window.__webableEngine.extract());
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'line_spacing', level: 3 }], 'spacing'),
    );
    // Main content is the <main>; its captions clip under looser lines.
    expect(changes[0]).toMatchObject({
      op: 'line_spacing',
      status: 'undone_by_checks',
      vcode: 'clip',
    });
  });

  test('a failing op is rolled back alone; the rest of the batch stays', async ({
    page,
  }) => {
    await hiddenConstraint(page);
    await page.evaluate(() => window.__webableEngine.extract());
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([
        { op: 'text_floor', level: 2 },
        { op: 'focus_outline' },
        { op: 'calm_motion' },
      ]),
    );
    const byOp = Object.fromEntries(changes.map((c) => [c.op, c.status]));
    expect(byOp).toEqual({
      text_floor: 'undone_by_checks',
      focus_outline: 'applied',
      calm_motion: 'applied',
    });
    expect(await page.evaluate(() => window.__webableEngine.applied())).toEqual(
      ['focus_outline', 'calm_motion'],
    );
  });

  test('protected regions are never dimmed, whatever the plan says', async ({
    page,
  }) => {
    await open(page, 'store');
    const regions = await regionKeys(page);
    const all = regions.map((r) => r.key);
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'dim_distractions', level: 2, regions: all }]),
    );
    const dimmed = await page.evaluate(() =>
      [
        ...document.querySelectorAll(window.__webableEngine.markSelector('dm')),
      ].map((e) => e.id || e.className || e.localName),
    );
    // Dimmable regions follow the plan; protected ones are vetoed locally.
    expect(dimmed).toEqual(
      expect.arrayContaining(['intercom-lightweight-app', 'sponsored-rail']),
    );
    for (const never of ['onetrust-banner-sdk', 'top', 'main', 'nav'])
      expect(dimmed).not.toContain(never);
    for (const sel of ['#onetrust-banner-sdk', 'header.top', 'main', 'nav']) {
      expect(
        await page.evaluate(
          (s) => getComputedStyle(document.querySelector(s) as Element).opacity,
          sel,
        ),
        sel,
      ).toBe('1');
    }
  });

  test('protected regions are never dimmed on the article either', async ({
    page,
  }) => {
    await open(page, 'article');
    const regions = await regionKeys(page);
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([
        {
          op: 'dim_distractions',
          level: 2,
          regions: regions.map((r) => r.key),
        },
      ]),
    );
    for (const sel of [
      'main.story',
      'header.site-header',
      'footer.site-footer',
      'nav',
      'form.newsletter',
    ]) {
      expect(
        await page.evaluate(
          (s) => getComputedStyle(document.querySelector(s) as Element).opacity,
          sel,
        ),
        sel,
      ).toBe('1');
    }
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector('aside.related') as Element)
            .opacity,
      ),
    ).toBe('0.3');
  });

  test('on-demand verify re-checks what is applied', async ({ page }) => {
    await open(page, 'article');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 2 }, { op: 'contrast' }]),
    );
    const report = await page.evaluate(() => window.__webableEngine.verify());
    expect(report.rolledBack).toEqual([]);
    expect(
      (await page.evaluate(() => window.__webableEngine.applied())).sort(),
    ).toEqual(['contrast', 'text_floor']);
  });

  test('point of regard is kept when text grows above the reading position', async ({
    page,
  }) => {
    await open(page, 'large');
    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.evaluate(() => window.__webableEngine.extract());
    // The reading position: the text block near the top of the viewport, in main.
    const before = await page.evaluate(() => {
      const main = document.querySelector('main') as Element;
      const x =
        main.getBoundingClientRect().left +
        Math.min(main.getBoundingClientRect().width / 2, 200);
      const el = document.elementFromPoint(
        x,
        window.innerHeight * 0.12,
      ) as Element;
      (window as unknown as { __anchor: Element }).__anchor = el;
      return el.getBoundingClientRect().top;
    });
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 2 }]),
    );
    const after = await page.evaluate(
      () =>
        (
          window as unknown as { __anchor: Element }
        ).__anchor.getBoundingClientRect().top,
    );
    expect(Math.abs(after - before)).toBeLessThan(24);
    await page.evaluate(() => window.__webableEngine.undo('all'));
    const restored = await page.evaluate(
      () =>
        (
          window as unknown as { __anchor: Element }
        ).__anchor.getBoundingClientRect().top,
    );
    expect(Math.abs(restored - before)).toBeLessThan(24);
  });

  test('performance budget: extraction and verification on a large page', async ({
    page,
  }) => {
    await open(page, 'large');
    await page.evaluate(() => window.__webableEngine.extract());
    const x = await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([
        { op: 'text_floor', level: 2 },
        { op: 'target_size', level: 2 },
        { op: 'contrast' },
        { op: 'line_spacing', level: 2 },
      ]),
    );
    const perf = await page.evaluate(() => window.__webableEngine.perf());
    const summary = `large page: ${x.perf.nodes} nodes, extract busy ${x.perf.busyMs} ms (truncated ${x.perf.truncated}), write ${perf.writeMs.toFixed(1)} ms + layout ${perf.layoutMs.toFixed(1)} ms, verify ${perf.verifyMs.toFixed(1)} ms`;
    console.log(summary);
    test.info().annotations.push({ type: 'budget', description: summary });
    expect(x.perf.busyMs).toBeLessThan(50);
    expect(perf.verifyMs).toBeLessThan(60);
  });
});
