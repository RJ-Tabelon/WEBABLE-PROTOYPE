import AxeBuilder from '@axe-core/playwright';
import {
  focusProfile,
  strongReaderProfile,
} from '@webable/core/policy/fixtures';
import type { Page } from '@playwright/test';

import { computed, expect, test, type Extension } from './extension';
import { fakeSession, startDecideStub } from './supabase-stub';

/**
 * The whole extension on the engine fixtures: the worker plans, the engine
 * applies and verifies, the popup lists and undoes. The e2e build may run on
 * the fixture origin without a click; everything else is the production code.
 */

const STORY = 'main.story p:not(.byline)';

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

  test('adapts a page, lists the change, and undo from the popup restores it', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('article');

    // Most text here is 13 px against a 21 px fit: the whole page is zoomed.
    await expect.poll(() => tabZoom(ext, tabId)).toBeCloseTo(1.25, 2);
    expect(await computed(page, STORY, 'font-size')).toBe('13px');

    const popup = await ext.openPopup(tabId);
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      /^Adapted · 1\schange$/,
    );
    const rows = await changeRows(popup);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Page zoom');
    // The fit mark carries the measured values, and says them in words.
    await expect(rows.first()).toContainText('100% to 125%');

    await expectNoAxeViolations(popup);

    await rows.first().getByRole('button', { name: 'Undo page zoom' }).click();
    await expect.poll(() => tabZoom(ext, tabId)).toBeCloseTo(1, 2);
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      'Changes undone on this page',
    );
    // The optional reason, for 8 s.
    const reason = popup.getByRole('group', { name: 'Page zoom undone' });
    await expect(reason).toBeVisible();
    await reason.getByRole('button', { name: 'Too much' }).click();
    await expect(reason.getByRole('status')).toHaveText(/Noted/);

    // The undo reached the page and the worker's record.
    const state = await ext.tabState(tabId);
    expect(state?.changes.filter((c) => c.status === 'applied')).toEqual([]);
  });

  test('a text size set for this site applies on the page, and its Undo restores the page', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('article');
    await expect.poll(() => tabZoom(ext, tabId)).toBeCloseTo(1.25, 2);
    const popup = await ext.openPopup(tabId);

    await popup.getByRole('button', { name: 'Adjust for this site' }).click();
    const slider = popup.getByRole('slider', { name: 'Text size' });
    await expect(slider).toHaveAttribute('aria-valuetext', '18 pixels');
    await popup.getByRole('button', { name: 'Increase text size' }).click();
    await expect(slider).toHaveAttribute('aria-valuetext', '21 pixels');

    // A size the person chose wins over the zoom WebAble picked; the engine applies it.
    await expect.poll(() => computed(page, STORY, 'font-size')).toBe('21px');
    await expect.poll(() => tabZoom(ext, tabId)).toBeCloseTo(1, 2);
    expect(await computed(page, 'main.story h1', 'font-size')).toBe('32px');

    const rows = await changeRows(popup);
    const text = rows.filter({ hasText: 'Text size' });
    await expect(text).toHaveCount(1);
    await expect(text).toContainText('13 to 21 pixels');
    await text.getByRole('button', { name: 'Undo text size' }).click();
    await expect.poll(() => computed(page, STORY, 'font-size')).toBe('13px');
    await expect(
      popup.getByRole('group', { name: 'Text size undone' }),
    ).toBeVisible();
  });

  test('an offer asks first, and "Try it" applies exactly that change', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { tabId } = await ext.openFixture('store');
    const popup = await ext.openPopup(tabId);

    const offer = popup.getByRole('region', {
      name: /Make them bigger here\?/,
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
    await expect(rows.filter({ hasText: 'Click targets' })).toHaveCount(1);
    await expect
      .poll(async () =>
        (await ext.tabState(tabId))?.changes.map((c) => [c.op, c.status]),
      )
      .toContainEqual(['target_size', 'applied']);
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
    await expect(
      popup.getByRole('switch', { name: 'Larger text' }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(popup.getByText('Larger text was undone')).toBeVisible();
    await expect(popup.getByText(/so WebAble put it back\./)).toBeVisible();
    // No "is on" confirmation for a change that did not stay.
    await expect(
      popup.getByRole('status').getByText(/is on for this site/),
    ).toHaveCount(0);
    // The page is exactly as the site made it.
    expect(await computed(page, '#card-1 p', 'font-size')).toBe('12px');
    // Not an error: no alert, and "Why?" explains the checks.
    await popup.getByRole('button', { name: 'Why?' }).click();
    await expect(
      popup.getByText(/WebAble checks every change right after it makes it/),
    ).toBeVisible();

    await expectNoAxeViolations(popup);
  });

  test('pausing a site restores the page and survives a reload', async ({
    ext,
  }) => {
    await ext.seed({ profile: strongReaderProfile() });
    const { page, tabId } = await ext.openFixture('article');
    await expect.poll(() => tabZoom(ext, tabId)).toBeCloseTo(1.25, 2);

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
    await expect.poll(() => tabZoom(ext, tabId)).toBeCloseTo(1, 2);
    await expectNoAxeViolations(popup);

    // A reload stays untouched: the engine is not even registered for this site.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    expect(await tabZoom(ext, tabId)).toBeCloseTo(1, 2);
    expect(await page.locator('html').getAttribute('data-wa-off')).toBeNull();

    // Resume from the popup.
    await popup.reload();
    await expect(popup.getByRole('heading', { level: 1 })).toHaveText(
      'Paused on this site',
    );
    await popup.getByRole('button', { name: 'Resume on this site' }).focus();
    await popup.keyboard.press('Enter');
    await expect
      .poll(() => tabZoom(ext, tabId), { timeout: 15_000 })
      .toBeCloseTo(1.25, 2);
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
    await popup.getByRole('button', { name: /^What changed/ }).click();
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

test.describe('welcome page', () => {
  test('explains site access and links to Connect', async ({ ext }) => {
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.id}/welcome.html`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Set up WebAble',
    );
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Let WebAble work on every site',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Allow on all sites' }),
    ).toBeVisible();
    await expect(
      page.getByText('What never leaves this computer'),
    ).toBeVisible();
    const connect = page.getByRole('link', { name: /Connect your fit/ });
    await expect(connect).toHaveAttribute('href', /\/connect$/);
    await expectNoAxeViolations(page);
  });
});
