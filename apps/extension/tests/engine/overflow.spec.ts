import { expect, test } from '@playwright/test';

import { open, plan } from './helpers';

test('overflow rolls back only the responsible fit and does not retry it on unrelated updates', async ({
  page,
}) => {
  await open(page, 'article');
  await page.evaluate(() => {
    document.body.innerHTML = `<main><p id="wide">${'readable '.repeat(16)}</p><p id="normal">Other readable content stays adapted and keeps its darker text.</p><button id="edge">+</button><span id="ticker"></span></main>`;
    const style = document.createElement('style');
    style.textContent =
      'body { margin: 0; } main p { font: 13px/16px monospace; color: #999; margin: 0; } #wide { display: inline-block; white-space: nowrap; } #edge { position: absolute; right: 1px; top: 160px; width: 18px; height: 18px; padding: 0; border: 0; }';
    document.head.append(style);
  });
  await page.evaluate(
    ([pl, h]) => window.__webableEngine.runAdapter(pl as never, h as never),
    [
      plan([
        { op: 'text_floor', level: 2 },
        { op: 'line_spacing', level: 2 },
        { op: 'contrast' },
        { op: 'target_size', level: 2 },
      ]),
      { enabled: true, paused: false, prePaint: [], tabSession: 'overflow' },
    ] as const,
  );
  const changes = (
    (await page.evaluate(() =>
      window.__webableEngine.workerMessage({ type: 'sw:get-changes' }),
    )) as { changes: Array<{ op: string; status: string; vcode?: string }> }
  ).changes;
  expect(changes.find((c) => c.op === 'text_floor')).toMatchObject({
    status: 'undone_by_checks',
    vcode: 'overflow',
  });
  expect(changes.find((c) => c.op === 'contrast')?.status).toBe('applied');
  expect(changes.find((c) => c.op === 'line_spacing')?.status).toBe('applied');
  expect(changes.find((c) => c.op === 'target_size')?.status).toBe('applied');
  const samples = await page.evaluate(
    async (remote) => {
      const p = document.querySelector('#wide')!;
      const ticker = document.querySelector('#ticker')!;
      const timer = setInterval(() => {
        ticker.textContent = String(Date.now());
        void window.__webableEngine.workerMessage({
          type: 'sw:plan',
          plan: remote,
          reason: 'refine',
        });
      }, 180);
      const sizes: number[] = [];
      const colors = new Set<string>();
      const spacing = new Set<string>();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const frame = () => {
          sizes.push(parseFloat(getComputedStyle(p).fontSize));
          colors.add(getComputedStyle(p).color);
          spacing.add(
            getComputedStyle(document.querySelector('#normal')!).lineHeight,
          );
          if (performance.now() - start < 3500) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      clearInterval(timer);
      return { sizes, colors: [...colors], spacing: [...spacing] };
    },
    plan([
      { op: 'text_floor', level: 2 },
      { op: 'line_spacing', level: 2 },
      { op: 'contrast' },
      { op: 'target_size', level: 2 },
    ]),
  );
  expect(Math.max(...samples.sizes)).toBe(13);
  expect(samples.colors).toHaveLength(1);
  expect(samples.colors[0]).not.toBe('rgb(153, 153, 153)');
  expect(samples.spacing).toHaveLength(1);
  expect(parseFloat(samples.spacing[0]!)).toBeGreaterThan(16);
  // A real native constraint change may make the rejected fit safe.
  await page.locator('#wide').evaluate((p) => {
    (p as HTMLElement).style.whiteSpace = 'normal';
  });
  await expect
    .poll(() =>
      page.locator('#wide').evaluate((p) => getComputedStyle(p).fontSize),
    )
    .toBe('18px');
});

test('existing horizontal scrolling does not undo safe text or colour adaptations', async ({
  page,
}) => {
  await open(page, 'article');
  await page.evaluate(() => {
    document.body.innerHTML =
      '<main><p>Reading content in a deliberately wide canvas.</p></main>';
    const style = document.createElement('style');
    style.textContent =
      'body { margin: 0; width: 1800px; } main p { width: 100%; font: 13px/16px monospace; color: #999; }';
    document.head.append(style);
    window.scrollTo(400, 0);
  });
  const changes = await page.evaluate(
    (p) => window.__webableEngine.apply(p),
    plan([{ op: 'text_floor', level: 2 }, { op: 'contrast' }]),
  );
  expect(changes.every((c) => c.status === 'applied')).toBe(true);
});

test('page width changes during verification cannot be blamed on WebAble', async ({
  page,
}) => {
  await open(page, 'article');
  await page.evaluate(() => {
    const p = document.querySelector('main p:not(.byline)')!;
    const observer = new MutationObserver((records) => {
      if (!records.some((r) => r.type === 'attributes')) return;
      observer.disconnect();
      const wide = document.createElement('div');
      wide.style.width = '2000px';
      document.body.append(wide);
    });
    observer.observe(p, { attributes: true });
  });
  const changes = await page.evaluate(
    (p) => window.__webableEngine.apply(p),
    plan([{ op: 'text_floor', level: 2 }, { op: 'contrast' }]),
  );
  expect(changes.every((c) => c.status === 'applied')).toBe(true);
});

test('enlarging a target at the document edge cannot add horizontal scrolling', async ({
  page,
}) => {
  await open(page, 'article');
  await page.evaluate(() => {
    document.body.innerHTML =
      '<main><p>Readable article content here.</p><button id="edge">+</button></main>';
    const style = document.createElement('style');
    style.textContent =
      'body { margin: 0; } #edge { position: absolute; right: 1px; top: 100px; width: 18px; height: 18px; border: 0; padding: 0; }';
    document.head.append(style);
  });
  const before = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  await page.evaluate(
    (p) => window.__webableEngine.apply(p),
    plan([{ op: 'target_size', level: 2 }]),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    before,
  );
  expect(
    (await page.evaluate(() => window.__webableEngine.changes()))[0]?.status,
  ).toBe('applied');
});

test('showing fit outlines on edge elements cannot enlarge the page', async ({
  page,
}) => {
  await open(page, 'article');
  await page.evaluate(() => {
    document.body.innerHTML =
      '<main><p id="edge">A paragraph spans the whole viewport and its outline must fit inside it.</p></main>';
    const style = document.createElement('style');
    style.textContent =
      'body { margin: 0; } main p { margin: 0; font-size: 13px; }';
    document.head.append(style);
  });
  await page.evaluate(
    (p) => window.__webableEngine.apply(p),
    plan([{ op: 'text_floor', level: 2 }]),
  );
  const before = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  await page.evaluate(() =>
    window.__webableEngine.showOnPage('text_floor', true),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    before,
  );
});
