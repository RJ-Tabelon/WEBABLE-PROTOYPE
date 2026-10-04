import AxeBuilder from '@axe-core/playwright';
import {
  focusProfile,
  strongReaderProfile,
} from '@webable/core/policy/fixtures';
import type { Page } from '@playwright/test';

import {
  computed,
  expect,
  FIXTURE_ORIGIN,
  test,
  type Extension,
} from './extension';
import { fakeSession, startDecideStub } from './supabase-stub';

/**
 * The whole extension on the engine fixtures: the worker plans, the engine
 * applies and verifies, the popup lists and undoes. The e2e build may run on
 * the fixture origin without a click; everything else is the production code.
 */

const STORY = 'main.story p:not(.byline)';

test('an existing install recovers its saved fit after old verifier failures without losing site choices', async ({
  ext,
}) => {
  await ext.seed({ profile: ordinaryFit() });
  await ext.control.evaluate(async () => {
    const storage = (
      globalThis as unknown as {
        chrome: {
          storage: {
            local: { set(v: Record<string, unknown>): Promise<void> };
          };
        };
      }
    ).chrome.storage.local;
    const day = Math.floor(Date.now() / 86_400_000);
    await storage.set({
      'wa.sites': {
        '127.0.0.1': {
          engineVersion: 'engine-1.0.0',
          rule: {
            paused: false,
            pins: ['text_floor'],
            blocks: ['target_size'],
            levels: {},
            updatedAt: Date.now(),
          },
          state: {
            t: day,
            dims: {},
            ops: {
              text_floor: {
                s: 0,
                f: 0,
                t: day,
                e: { s: 0, f: 10, t: day },
                skipUntil: day + 7,
                engineUntil: day + 7,
              },
              contrast: { s: 0, f: 0, t: day, sessionOff: 'old-page-undo' },
            },
          },
          lastVisit: 0,
          lastChanges: 0,
          announced: false,
          levelMemo: null,
          at: Date.now(),
        },
      },
    });
  });
  const { page, tabId } = await ext.openFixture('article');
  await expect.poll(() => computed(page, STORY, 'font-size')).toBe('16px');
  const view = await ext.send<{
    site: { blocks: string[] };
    undoneByYou: string[];
  }>({ type: 'ui:view', tabId });
  expect(view.site.blocks).toEqual(
    expect.arrayContaining(['target_size', 'contrast']),
  );
  expect(view.undoneByYou).toContain('contrast');
  const popup = await ext.openPopup(tabId);
  await expect(
    popup.getByRole('button', { name: 'Redo contrast' }),
  ).toBeVisible();
});

function ordinaryFit() {
  const p = strongReaderProfile();
  p.vision.textMinPx.value = 16;
  p.motor.minTargetPx.value = 32;
  return p;
}

test('the saved fit stays adapted on every frame through continuous rendering and transitions', async ({
  ext,
}) => {
  await ext.seed({ profile: ordinaryFit() });
  const { page, tabId } = await ext.openFixture('article');
  await expect.poll(() => computed(page, STORY, 'font-size')).toBe('16px');
  await page.addStyleTag({
    content: 'main.story p { transition: font-size 400ms, line-height 400ms; }',
  });
  await page.waitForTimeout(1000);
  const sizes = await page.evaluate(async () => {
    const story = document.querySelector('main.story p:not(.byline)')!;
    const ticker = document.createElement('span');
    document.body.append(ticker);
    const timer = setInterval(() => {
      ticker.textContent = String(Date.now());
    }, 180);
    const sizes: number[] = [];
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        sizes.push(parseFloat(getComputedStyle(story).fontSize));
        if (performance.now() - start < 4500) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    clearInterval(timer);
    return sizes;
  });
  expect(sizes.length).toBeGreaterThan(30);
  expect(Math.min(...sizes)).toBe(16);
  expect(Math.max(...sizes)).toBe(16);
  await expect
    .poll(async () =>
      (await ext.tabState(tabId))?.changes.map((c) => [c.op, c.status]),
    )
    .toContainEqual(['text_floor', 'applied']);
});

test('a saved ordinary fit adapts delayed rendering, reused nodes and changed styles', async ({
  ext,
}) => {
  await ext.seed({ profile: ordinaryFit() });
  const { page, tabId } = await ext.openFixture('hydration');
  await expect(page.locator('#story').first()).toBeAttached();
  await expect
    .poll(() => computed(page, '#story', 'font-size'), { timeout: 15_000 })
    .toBe('16px');
  await expect
    .poll(async () =>
      (await ext.tabState(tabId))?.changes.map((c) => [c.op, c.status]),
    )
    .toContainEqual(['target_size', 'applied']);

  // A framework reuses its node, then CSS switches back to small text.
  await page
    .locator('p')
    .evaluateAll((ps) => ps.forEach((p) => p.classList.add('large')));
  await expect.poll(() => computed(page, '#story', 'font-size')).toBe('24px');
  await page
    .locator('p')
    .evaluateAll((ps) => ps.forEach((p) => p.classList.remove('large')));
  await expect.poll(() => computed(page, '#story', 'font-size')).toBe('16px');

  // A fresh decision must measure the host CSS, not WebAble's own 16px rule.
  await page.locator('#story').evaluate((p) => {
    p.firstChild!.textContent += ' Content updated again.';
  });
  await page.waitForTimeout(1200);
  expect(await computed(page, '#story', 'font-size')).toBe('16px');

  const popup = await ext.openPopup(tabId);
  const rows = await changeRows(popup);
  await rows
    .filter({ hasText: 'Text size' })
    .getByRole('button', { name: 'Undo text size' })
    .click();
  await expect.poll(() => computed(page, '#story', 'font-size')).toBe('12px');
  await page.locator('#story').evaluate((p) => {
    p.firstChild!.textContent += ' Another update after Undo.';
  });
  await page.waitForTimeout(1200);
  expect(await computed(page, '#story', 'font-size')).toBe('12px');
});

test('an ordinary saved fit applies on an initial document and a full navigation', async ({
  ext,
}) => {
  await ext.seed({ profile: ordinaryFit() });
  const { page } = await ext.openFixture('article');
  await expect.poll(() => computed(page, STORY, 'font-size')).toBe('16px');
  await page.goto(`${FIXTURE_ORIGIN}/engine/hydration.html`);
  await expect(page.locator('#story').first()).toBeAttached();
  await expect
    .poll(() => computed(page, '#story', 'font-size'), { timeout: 15_000 })
    .toBe('16px');
});

test('saving a fit updates a page that was already open without a popup or reload', async ({
  ext,
}) => {
  const { page } = await ext.openFixture('article');
  expect(await computed(page, STORY, 'font-size')).toBe('13px');
  const result = await ext.send<{ ok: boolean }>({
    type: 'e2e:seed',
    profile: ordinaryFit(),
    reset: false,
  });
  expect(result.ok).toBe(true);
  await expect.poll(() => computed(page, STORY, 'font-size')).toBe('16px');
});

test('a calmer page stays calm through automatic refreshes', async ({
  ext,
}) => {
  await ext.seed({ profile: ordinaryFit() });
  const { page, tabId } = await ext.openFixture('store');
  await ext.send({ type: 'ui:quick', tabId, key: 'calm', on: true });
  const moving = () =>
    page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              a.effect?.getComputedTiming().iterations === Infinity,
          ).length,
    );
  await expect.poll(moving).toBe(0);
  const frames = await page.evaluate(async () => {
    const ticker = document.createElement('span');
    document.querySelector('main')!.append(ticker);
    const timer = setInterval(() => {
      ticker.textContent = String(Date.now());
    }, 180);
    const frames: number[] = [];
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        frames.push(
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' &&
                a.effect?.getComputedTiming().iterations === Infinity,
            ).length,
        );
        if (performance.now() - start < 3500) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    clearInterval(timer);
    return frames;
  });
  expect(Math.max(...frames)).toBe(0);
  expect(await moving()).toBe(0);
  await expect
    .poll(async () =>
      (await ext.tabState(tabId))?.changes.map((c) => [c.op, c.status]),
    )
    .toContainEqual(['calm_motion', 'applied']);
});

async function expectNoAxeViolations(page: Page): Promise<void> {
  // Contrast is measured on settled colours, not mid-fade.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} (${n.failureSummary ?? ''})`).join(', ')}`,
  );
  expect(summary, 'axe violations').toEqual([]);
}

/** The "What changed" rows, expanding the folded list when an offer is showing. */
async function changeRows(popup: Page) {
  const folded = popup.getByRole('button', { name: /^What changed/ });
  if (
    (await folded.count()) > 0 &&
    (await folded.getAttribute('aria-expanded')) === 'false'
  )
    await folded.click();
  return popup
    .getByRole('list', { name: 'What changed' })
    .getByRole('listitem');
}

async function tabZoom(ext: Extension, tabId: number): Promise<number> {
  return ext.control.evaluate(
    (id) =>
      (
        globalThis as unknown as {
          chrome: { tabs: { getZoom(id: number): Promise<number> } };
        }
      ).chrome.tabs.getZoom(id),
    tabId,
  );
}

test.describe('popup', () => {
  test('first run: basic fit, quick switches and the call to Tune', async ({
    ext,
  }) => {
    const { tabId } = await ext.openFixture('article');
    const popup = await ext.openPopup(tabId);

    const title = popup.getByRole('heading', { level: 1 });
    await expect(title).toHaveText('Basic fit is on');
    // The state title has focus on open, so it is announced first.
    await expect(title).toBeFocused();
    await expect(
      popup.getByText('Small safe fixes work on every site.'),
    ).toBeVisible();
    await expect(popup.getByText('Quick changes for this site')).toBeVisible();
    for (const name of ['Larger text', 'Bigger click targets', 'Calmer page'])
      await expect(popup.getByRole('switch', { name })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    await expect(
      popup.getByRole('link', { name: /Tune WebAble to you/ }),
    ).toBeVisible();
    await expect(popup.getByRole('link', { name: /Sign in/ })).toBeVisible();

    await expectNoAxeViolations(popup);
  });

  test('adapts a page without zooming it, lists the change, and undo and redo work', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('article');

    // Most text here is 13 px against a larger fit: the text grows, and the
    // tab's zoom is never touched.
    await expect
      .poll(() => computed(page, STORY, 'font-size'))
      .not.toBe('13px');
    const fitted = await computed(page, STORY, 'font-size');
    expect(await tabZoom(ext, tabId)).toBeCloseTo(1, 2);

    const popup = await ext.openPopup(tabId);
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      /^Adapted/,
    );
    const rows = await changeRows(popup);
    const text = rows.filter({ hasText: 'Text size' });
    await expect(text).toHaveCount(1);
    // The fit mark carries the measured values, and says them in words.
    await expect(text).toContainText(`13 to ${parseInt(fitted, 10)} pixels`);
    await expect(rows.filter({ hasText: 'Page zoom' })).toHaveCount(0);

    await expectNoAxeViolations(popup);

    await text.getByRole('button', { name: 'Undo text size' }).click();
    await expect.poll(() => computed(page, STORY, 'font-size')).toBe('13px');
    // The optional reason; the row stays until the popup closes.
    const reason = popup.getByRole('group', { name: 'Text size was undone' });
    await expect(reason).toBeVisible();
    await reason.getByRole('button', { name: 'Too much' }).click();
    await expect(reason.getByRole('status')).toHaveText(/Noted/);

    // The undo reached the worker's record.
    const state = await ext.tabState(tabId);
    expect(
      state?.changes.filter(
        (c) => c.op === 'text_floor' && c.status === 'applied',
      ),
    ).toEqual([]);

    // Redo puts it back.
    await reason.getByRole('button', { name: 'Redo text size' }).click();
    await expect.poll(() => computed(page, STORY, 'font-size')).toBe(fitted);
    expect(await tabZoom(ext, tabId)).toBeCloseTo(1, 2);
  });

  test('Undo is saved without answering a reason and survives reload, a new tab, and a worker restart', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('article');
    await expect
      .poll(() => computed(page, STORY, 'font-size'))
      .not.toBe('13px');
    const alreadyOpen = await ext.openFixture('article');
    await expect
      .poll(() => computed(alreadyOpen.page, STORY, 'font-size'))
      .not.toBe('13px');
    const popup = await ext.openPopup(tabId);
    const rows = await changeRows(popup);
    await rows
      .filter({ hasText: 'Text size' })
      .getByRole('button', { name: 'Undo text size' })
      .click();
    await expect(
      popup.getByRole('group', { name: 'Text size was undone' }),
    ).toContainText('Saved for this site');
    await expect
      .poll(() => computed(alreadyOpen.page, STORY, 'font-size'))
      .toBe('13px');
    const session = (await ext.tabState(tabId))?.tabSession;
    await page.reload();
    await expect
      .poll(async () => (await ext.tabState(tabId))?.tabSession)
      .not.toBe(session);
    await expect
      .poll(async () => (await ext.tabState(tabId))?.phase)
      .toBe('ready');
    expect(await computed(page, STORY, 'font-size')).toBe('13px');
    await popup.reload();
    await expect(
      popup.getByRole('group', { name: 'Text size was undone' }),
    ).toBeVisible();
    const next = await ext.openFixture('article');
    expect(await computed(next.page, STORY, 'font-size')).toBe('13px');
    // Stop the actual worker; the next UI message wakes a new instance.
    const cdp = await ext.context.newCDPSession(ext.control);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
    await expect
      .poll(async () => {
        const view = await ext.send<{ site: { blocks: string[] } }>({
          type: 'ui:view',
          tabId,
        });
        return view.site.blocks;
      })
      .toContain('text_floor');
    await popup.reload();
    await popup.getByRole('button', { name: 'Redo text size' }).click();
    await expect
      .poll(() => computed(page, STORY, 'font-size'))
      .not.toBe('13px');
    await expect
      .poll(() => computed(alreadyOpen.page, STORY, 'font-size'))
      .not.toBe('13px');
  });

  test('a text size set for this site applies on the page, and its Undo restores the page', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('article');
    await expect
      .poll(() => computed(page, STORY, 'font-size'))
      .not.toBe('13px');
    const popup = await ext.openPopup(tabId);

    await popup.getByRole('button', { name: 'Adjust for this site' }).click();
    const slider = popup.getByRole('slider', { name: 'Text size' });
    const before = (await slider.getAttribute('aria-valuetext')) ?? '';
    await popup.getByRole('button', { name: 'Increase text size' }).click();
    await expect(slider).not.toHaveAttribute('aria-valuetext', before);
    const chosen = parseInt(
      (await slider.getAttribute('aria-valuetext')) ?? '',
      10,
    );

    // The size the person chose applies on the page; the tab is never zoomed.
    await expect
      .poll(() => computed(page, STORY, 'font-size'))
      .toBe(`${chosen}px`);
    expect(await tabZoom(ext, tabId)).toBeCloseTo(1, 2);
    expect(await computed(page, 'main.story h1', 'font-size')).toBe('32px');

    const rows = await changeRows(popup);
    const text = rows.filter({ hasText: 'Text size' });
    await expect(text).toHaveCount(1);
    await expect(text).toContainText(`13 to ${chosen} pixels`);
    await text.getByRole('button', { name: 'Undo text size' }).click();
    await expect.poll(() => computed(page, STORY, 'font-size')).toBe('13px');
    await expect(
      popup.getByRole('group', { name: 'Text size was undone' }),
    ).toBeVisible();
  });

  test('an optional spacing offer asks first, and "Try it" applies exactly that change', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('store');
    const popup = await ext.openPopup(tabId);

    // A saved minimum applies automatically; a fast Undo on this site
    // leaves optional suggestions for the next visit.
    const initialRows = await changeRows(popup);
    await initialRows
      .filter({ hasText: 'Click targets' })
      .getByRole('button', { name: 'Undo click targets' })
      .click();
    await page.reload();

    const offer = popup.getByRole('region', {
      name: /Add space between them\?/,
    });
    await expect(offer).toBeVisible();
    const accept = offer.getByRole('button', { name: 'Try it' });
    const decline = offer.getByRole('button', { name: 'Not now' });
    // Declining costs the same as accepting.
    const [a, d] = await Promise.all([
      accept.boundingBox(),
      decline.boundingBox(),
    ]);
    expect(
      a &&
        d &&
        Math.abs(a.width - d.width) < 1 &&
        Math.abs(a.height - d.height) < 1,
    ).toBe(true);
    await expectNoAxeViolations(popup);

    await accept.click();
    await expect(offer).toHaveCount(0);
    const rows = await changeRows(popup);
    await expect(
      rows.filter({ hasText: 'Space between controls' }),
    ).toHaveCount(1);
    await expect
      .poll(async () =>
        (await ext.tabState(tabId))?.changes.map((c) => [c.op, c.status]),
      )
      .toContainEqual(['target_spacing', 'applied']);
  });

  test('a text change that clips is undone by the checks and shown as a neutral row', async ({
    ext,
  }) => {
    const { page, tabId } = await ext.openFixture('clip');
    const popup = await ext.openPopup(tabId);
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      'Basic fit is on',
    );

    // "Larger text" pins an 18 px floor for this site; 12 px captions in fixed boxes would clip.
    await popup.getByRole('switch', { name: 'Larger text' }).click();
    // The switch tells the truth: the checks undid it here, so it reads Off
    // (the pin for this site is kept).
    await expect(
      popup.getByRole('switch', { name: 'Larger text' }),
    ).toHaveAttribute('aria-checked', 'false');
    await expect(popup.getByText(/Undone here/)).toBeVisible();
    await expect(popup.getByText('Larger text was undone')).toBeVisible();
    await expect(popup.getByText(/so WebAble put it back\./)).toBeVisible();
    // No "is on" confirmation for a change that did not stay.
    await expect(
      popup.getByRole('status').getByText(/is on for this site/),
    ).toHaveCount(0);
    // The page is exactly as the site made it.
    expect(await computed(page, '#card-1 p', 'font-size')).toBe('12px');
    // Not an error: no alert, and "Why?" explains the checks.
    await popup.getByRole('button', { name: 'Why?' }).first().click();
    await expect(
      popup
        .getByText(/WebAble checks every change right after it makes it/)
        .first(),
    ).toBeVisible();

    await expectNoAxeViolations(popup);
  });

  test('pausing a site restores the page and survives a reload', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('article');
    await expect
      .poll(() => computed(page, STORY, 'font-size'))
      .not.toBe('13px');

    const popup = await ext.openPopup(tabId);
    const siteSwitch = popup.getByRole('switch', {
      name: 'WebAble on this site',
    });
    await expect(siteSwitch).toHaveAttribute('aria-checked', 'true');
    await siteSwitch.click();

    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      'Paused on this site',
    );
    await expect(
      popup.getByText('127.0.0.1 looks the way the site made it.'),
    ).toBeVisible();
    await expect(siteSwitch).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => computed(page, STORY, 'font-size')).toBe('13px');
    await expectNoAxeViolations(popup);

    // A reload stays untouched: the engine is not even registered for this site.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    expect(await computed(page, STORY, 'font-size')).toBe('13px');
    expect(await page.locator('html').getAttribute('data-wa-off')).toBeNull();

    // Resume from the popup.
    await popup.reload();
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      'Paused on this site',
    );
    await popup.getByRole('button', { name: 'Resume on this site' }).focus();
    await popup.keyboard.press('Enter');
    await expect
      .poll(() => computed(page, STORY, 'font-size'), { timeout: 15_000 })
      .not.toBe('13px');
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      /^Adapted/,
    );
    // The button went away with the state; focus moved to the new state title.
    await expect(popup.getByRole('heading', { level: 1 })).toBeFocused();
  });

  test('settings and "What was sent" are sub-views with a Back button', async ({
    ext,
  }) => {
    const { tabId } = await ext.openFixture('article');
    const popup = await ext.openPopup(tabId);

    await popup.getByRole('button', { name: 'Settings' }).click();
    await expect(
      popup.getByRole('heading', { level: 1, name: 'Settings' }),
    ).toBeFocused();
    await expect(
      popup.getByRole('radiogroup', { name: 'Theme' }),
    ).toBeVisible();
    await popup.getByRole('radio', { name: 'Dark' }).click();
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoAxeViolations(popup);

    await popup
      .getByRole('button', { name: 'Turn WebAble off everywhere' })
      .click();
    await expect(
      popup.getByText('Turn WebAble off on every site?'),
    ).toBeFocused();
    await popup.getByRole('button', { name: 'Keep it on' }).click();
    await expect(
      popup.getByRole('button', { name: 'Turn WebAble off everywhere' }),
    ).toBeFocused();
    // Off everywhere, and back on, without leaving the keyboard.
    await popup
      .getByRole('button', { name: 'Turn WebAble off everywhere' })
      .click();
    await popup.getByRole('button', { name: 'Turn off' }).click();
    await expect(
      popup.getByRole('button', { name: 'Turn WebAble on' }),
    ).toBeFocused();
    await popup.keyboard.press('Enter');
    await expect(
      popup.getByRole('button', { name: 'Turn WebAble off everywhere' }),
    ).toBeFocused();

    await popup.getByRole('button', { name: 'Back' }).click();
    await popup.getByRole('button', { name: 'What was sent' }).click();
    await expect(
      popup.getByRole('heading', { level: 1, name: 'What was sent' }),
    ).toBeFocused();
    await expect(
      popup.getByText('Nothing was sent from this page.'),
    ).toBeVisible();
    await expect(
      popup.getByText('page text, anything you typed, your browsing history.'),
    ).toBeVisible();
    await expectNoAxeViolations(popup);
    await popup.keyboard.press('Escape');
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      'Basic fit is on',
    );
  });
});

test.describe('page analysis', () => {
  /** Words and values from the fixture that must never leave the device. */
  const PRIVATE = [
    'quillon',
    'vesperine',
    'zebulon',
    'quartzite',
    'marmalade',
    '127.0.0.1',
    '4173',
    'http',
    '/engine/',
    'fixture',
  ];

  test('sends page structure only, and "What was sent" shows exactly those bytes', async ({
    ext,
  }) => {
    const stub = await startDecideStub();
    try {
      await ext.seed({
        profile: focusProfile(),
        account: {
          userId: fakeSession().user.id,
          email: 'person@example.com',
          cloudAnalysis: true,
          productLearning: false,
          theme: 'system',
          onboardingStep: 'connected',
          needsReauth: false,
          connectedAt: 0,
          lastSyncAt: 0,
        },
      });
      // The worker's own session (as the sign-in handoff would leave it).
      await ext.control.evaluate(
        (session) =>
          (
            globalThis as unknown as {
              chrome: { storage: { local: { set(v: object): Promise<void> } } };
            }
          ).chrome.storage.local.set({ 'wa.auth': JSON.stringify(session) }),
        fakeSession(),
      );
      const { tabId } = await ext.openFixture('article');
      await expect.poll(() => stub.bodies.length, { timeout: 10_000 }).toBe(1);
      expect(stub.authorizations[0]).toBe('Bearer e2e-access-token');
      const sent = stub.bodies[0]!;
      for (const word of PRIVATE)
        expect(sent.toLowerCase()).not.toContain(word);

      const popup = await ext.openPopup(tabId);
      await expect(
        popup.getByText('Suggestions run on this device only.'),
      ).toHaveCount(0);
      await popup.getByRole('button', { name: 'What was sent' }).click();
      await expect(
        popup.getByText(/^Last sent .+ to WebAble’s server$/),
      ).toBeVisible();
      await expect(popup.getByText(/page structure —/)).toBeVisible();
      await popup.getByRole('button', { name: 'Show the exact data' }).click();
      const shown = await popup.getByLabel('The exact data sent').textContent();
      expect(JSON.parse(shown ?? 'null')).toEqual(JSON.parse(sent));
      await expectNoAxeViolations(popup);

      // The same page again: answered from this device's cache, nothing sent.
      await ext.openFixture('article');
      await popup.waitForTimeout(500);
      expect(stub.bodies).toHaveLength(1);
    } finally {
      await ext.seed({});
      await stub.close();
    }
  });
});

test.describe('keyboard and targets', () => {
  /** Interactive elements whose box is under 44 px on either side. */
  async function smallTargets(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'button, a[href], [role="switch"], [role="slider"], [role="radio"], [tabindex="0"]',
        ),
      ]
        .filter(
          (el) => el.getClientRects().length > 0 && !el.closest('[hidden]'),
        )
        .filter((el) => {
          const r = el.getBoundingClientRect();
          // The slider thumb's hit area is its 44 px rail (design-final 7.6).
          if (el.getAttribute('role') === 'slider') return false;
          return r.height < 44 || r.width < 44;
        })
        .map(
          (el) =>
            `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim()}"`,
        ),
    );
  }

  test('every popup control is at least 44 px and reachable by Tab with a visible ring', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { tabId } = await ext.openFixture('store');
    const popup = await ext.openPopup(tabId);
    await popup.getByRole('button', { name: 'Adjust for this site' }).click();
    expect(await smallTargets(popup)).toEqual([]);

    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      await popup.keyboard.press('Tab');
      const info = await popup.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          name: (el.getAttribute('aria-label') ?? el.textContent ?? '')
            .trim()
            .slice(0, 40),
          ring:
            style.outlineStyle !== 'none' &&
            parseFloat(style.outlineWidth) >= 3,
        };
      });
      if (!info) continue;
      expect(info.ring, `focus ring on "${info.name}"`).toBe(true);
      seen.push(info.name);
    }
    for (const name of [
      'Settings',
      'WebAble on this site',
      'Try it',
      'Undo',
      'What was sent',
    ])
      expect(
        seen.some((n) => n.includes(name)),
        name,
      ).toBe(true);
  });

  test('sub-views and the welcome page keep 44 px targets', async ({ ext }) => {
    const { tabId } = await ext.openFixture('article');
    const popup = await ext.openPopup(tabId);
    await popup.getByRole('button', { name: 'Settings' }).click();
    expect(await smallTargets(popup)).toEqual([]);
    await popup.getByRole('button', { name: 'Back' }).click();
    await popup.getByRole('button', { name: 'What was sent' }).click();
    expect(await smallTargets(popup)).toEqual([]);
    const welcome = await ext.context.newPage();
    await welcome.goto(`chrome-extension://${ext.id}/welcome.html`);
    expect(await smallTargets(welcome)).toEqual([]);
  });
});

test.describe('turning WebAble off and on', () => {
  const fontOf = (page: Page) => computed(page, STORY, 'font-size');

  test('an open page goes back to the original, then adapts again without a reload', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('article');
    await expect.poll(() => fontOf(page)).not.toBe('13px');
    const fitted = await fontOf(page);

    await ext.send({ type: 'ui:enabled', enabled: false });
    await expect.poll(() => fontOf(page)).toBe('13px');

    await ext.send({ type: 'ui:enabled', enabled: true });
    await expect.poll(() => fontOf(page)).toBe(fitted);
    await expect
      .poll(async () => (await ext.tabState(tabId))?.phase)
      .toBe('ready');
  });

  test('a page that loaded while WebAble was off adapts when it is turned on', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    await ext.send({ type: 'ui:enabled', enabled: false });
    const { page, tabId } = await ext.openFixture('article', { settle: false });
    await page.waitForTimeout(800);
    expect(await fontOf(page)).toBe('13px');

    await ext.send({ type: 'ui:enabled', enabled: true });
    await expect.poll(() => fontOf(page)).not.toBe('13px');
    await expect
      .poll(async () => (await ext.tabState(tabId))?.phase)
      .toBe('ready');
    const popup = await ext.openPopup(tabId);
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      /^Adapted/,
    );
  });

  test('pausing and resuming a site on an open page re-applies its changes', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('article');
    await expect.poll(() => fontOf(page)).not.toBe('13px');
    const fitted = await fontOf(page);
    const popup = await ext.openPopup(tabId);
    const siteSwitch = popup.getByRole('switch', {
      name: 'WebAble on this site',
    });
    await siteSwitch.click();
    await expect.poll(() => fontOf(page)).toBe('13px');
    await siteSwitch.click();
    await expect.poll(() => fontOf(page)).toBe(fitted);
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      /^Adapted/,
    );
  });

  test('every page reached by following links in the same tab adapts', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('store');
    // The commit and the new page's hello race; repeat to catch an interleaving.
    for (let i = 0; i < 5; i += 1) {
      const next =
        i % 2 === 0
          ? `${FIXTURE_ORIGIN}/engine/article.html?hop=${i}`
          : `${FIXTURE_ORIGIN}/engine/store.html?hop=${i}`;
      await page.evaluate((url) => {
        const a = document.createElement('a');
        a.href = url;
        a.id = 'next';
        a.textContent = 'Next';
        document.body.prepend(a);
      }, next);
      const before = (await ext.tabState(tabId))?.tabSession;
      await page.click('#next');
      await page.waitForURL(next);
      // A new page view, adapted: its own session, the engine on record, ready.
      await expect
        .poll(
          async () => {
            const t = await ext.tabState(tabId);
            return Boolean(
              t?.engine &&
              t.phase === 'ready' &&
              t.tabSession &&
              t.tabSession !== before,
            );
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      if (i % 2 === 0)
        await expect
          .poll(() => computed(page, STORY, 'font-size'))
          .not.toBe('13px');
    }
  });

  test('a prerendered page leaves the current page alone, and adapts once it is shown', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('store');
    const before = await ext.tabState(tabId);
    expect(before?.phase).toBe('ready');

    // Chrome preloads the article in the background, as it does for search results.
    const target = `${FIXTURE_ORIGIN}/engine/article.html?prerender=1`;
    await page.evaluate((url) => {
      const rules = document.createElement('script');
      rules.type = 'speculationrules';
      rules.textContent = JSON.stringify({
        prerender: [{ source: 'list', urls: [url] }],
      });
      document.head.append(rules);
      const a = document.createElement('a');
      a.href = url;
      a.id = 'go';
      a.textContent = 'Article';
      document.body.prepend(a);
    }, target);
    await page.waitForTimeout(1500);
    // The tab still shows the store, and its record is untouched.
    const during = await ext.tabState(tabId);
    expect(during?.phase).toBe('ready');
    // The new link on the current page is adapted too, but prerendering
    // must not bind the current tab to a different document.
    expect(during?.tabSession).toBe(before?.tabSession);
    expect(during?.changes.map((c) => [c.op, c.status, c.level])).toEqual(
      before?.changes.map((c) => [c.op, c.status, c.level]),
    );

    await page.click('#go');
    await page.waitForURL(target);
    await expect
      .poll(() => computed(page, STORY, 'font-size'))
      .not.toBe('13px');
    await expect
      .poll(async () => (await ext.tabState(tabId))?.phase)
      .toBe('ready');
    const prerendered = await page.evaluate(
      () =>
        (
          performance.getEntriesByType(
            'navigation',
          )[0] as PerformanceNavigationTiming & { activationStart?: number }
        ).activationStart ?? 0,
    );
    test.info().annotations.push({
      type: 'prerender',
      description:
        prerendered > 0 ? 'activated from prerender' : 'not prerendered',
    });
  });

  test('a page that loaded while its site was paused adapts on resume, without a reload', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const first = await ext.openFixture('article');
    await expect.poll(() => fontOf(first.page)).not.toBe('13px');
    const fitted = await fontOf(first.page);
    await ext.send({
      type: 'ui:pause-site',
      tabId: first.tabId,
      paused: true,
    });
    await first.page.close();

    const { page, tabId } = await ext.openFixture('article', { settle: false });
    await page.waitForTimeout(800);
    expect(await fontOf(page)).toBe('13px');
    await ext.send({ type: 'ui:pause-site', tabId, paused: false });
    await expect.poll(() => fontOf(page)).toBe(fitted);
    await expect
      .poll(async () => (await ext.tabState(tabId))?.phase)
      .toBe('ready');
  });
});

test('the popup sets its own width when Chrome opens it small', async ({
  ext,
}) => {
  // Chrome opens an action popup at a few pixels wide and grows it to the
  // content, so the popup's width must not follow the viewport.
  const { tabId } = await ext.openFixture('article');
  const popup = await ext.openPopup(tabId);
  await popup.setViewportSize({ width: 25, height: 600 });
  const width = await popup.evaluate(
    () => document.documentElement.getBoundingClientRect().width,
  );
  expect(width).toBeCloseTo(380, 0);
});

test('the popup keeps normal text and 380 px with a large-text fit, and never scrolls sideways', async ({
  ext,
}) => {
  await ext.seed({ profile: strongReaderProfile() });
  const { tabId } = await ext.openFixture('article');
  const popup = await ext.openPopup(tabId);
  const size = await popup.evaluate(() => ({
    width: document.documentElement.getBoundingClientRect().width,
    scale: getComputedStyle(document.documentElement).getPropertyValue(
      '--wa-text-scale',
    ),
    overflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }));
  // Normal-size text in the popup, whatever the fit.
  expect(Number(size.scale)).toBe(1);
  expect(size.width).toBeCloseTo(380, 0);
  expect(size.overflow).toBeLessThanOrEqual(0);
});

test.describe('welcome page', () => {
  test('explains site access and links to Tune and sign-in', async ({
    ext,
  }) => {
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.id}/welcome.html`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Set up WebAble',
    );
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Allow WebAble on sites',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Allow on all sites' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'What WebAble reads and sends' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Tune WebAble/ }),
    ).toHaveAttribute('href', /\/tune$/);
    await expect(
      page.getByRole('link', { name: 'I have an account' }),
    ).toHaveAttribute('href', /\/sign-in\?next=\/connect$/);
    await expectNoAxeViolations(page);
  });

  test('#allow focuses the Allow button', async ({ ext }) => {
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.id}/welcome.html#allow`);
    await expect(
      page.getByRole('button', { name: 'Allow on all sites' }),
    ).toBeFocused();
  });
});
