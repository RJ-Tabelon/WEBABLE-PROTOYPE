import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Tune end to end, keyboard only: every screen is reached with Tab, arrows,
 * Space, Enter and the task keys (T / F / C, 1-4, - / +). No mouse event is
 * sent. Signed out, so the finished fit waits in this browser.
 */

const MAX_TABS = 80;

async function step(page: Page): Promise<string | null> {
  return page.locator('.tn-screen').getAttribute('data-step');
}

async function waitForStep(page: Page, expected: string): Promise<void> {
  await expect.poll(() => step(page)).toBe(expected);
}

/** Press Tab until `target` has focus (it must be reachable by Tab). */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeAttached();
  for (let i = 0; i < MAX_TABS; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

async function activate(page: Page, target: Locator): Promise<void> {
  await tabTo(page, target);
  await page.keyboard.press('Enter');
}

/** Every screen change moves focus to the new h1 (design-final §9.2). */
async function expectScreen(page: Page, name: string | RegExp): Promise<void> {
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveText(name);
  await expect(h1).toBeFocused();
}

/**
 * Answer the stimulus on screen, then wait for the next one: every trial
 * mounts a new stimulus element (keyed by trial), or the screen moves on.
 */
async function answerTrial(
  page: Page,
  selector: string,
  stepId: string,
  key: string,
): Promise<void> {
  const stimulus = page.locator(selector);
  await expect(stimulus).toBeAttached();
  await stimulus.evaluate((el) => el.setAttribute('data-answered', ''));
  await page.keyboard.press(key);
  // Done when the screen moved on, a new stimulus is up, or the stimuli ended.
  await expect
    .poll(
      async () =>
        (await step(page)) !== stepId ||
        (await page.locator(`${selector}:not([data-answered])`).count()) > 0 ||
        (await stimulus.count()) === 0,
    )
    .toBe(true);
}

function button(page: Page, name: string | RegExp): Locator {
  return page.getByRole('button', { name, exact: typeof name === 'string' });
}

async function beginWithKeyboard(page: Page): Promise<void> {
  await page.goto('/tune');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /fit WebAble to you/,
  );
  // The radio group takes one Tab stop; arrows move the choice.
  await tabTo(page, page.getByRole('radio', { name: 'Mouse' }));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('radio', { name: 'Keyboard only' }),
  ).toBeChecked();
  await activate(page, button(page, 'Begin'));
}

test('a keyboard-only Tune reaches Your fit and keeps the fit in this browser', async ({
  page,
}) => {
  await beginWithKeyboard(page);

  /* ---------- Reading ---------- */
  await expectScreen(page, 'Make this comfortable to read.');
  const paragraph = page.locator('.tn-stimulus-text');
  const startPx = await paragraph.evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize),
  );
  await page.keyboard.press('=');
  await expect
    .poll(() =>
      paragraph.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    )
    .toBeGreaterThan(startPx);
  await activate(page, button(page, 'This is comfortable'));

  await expectScreen(page, 'Is it true?');
  await expect(page.locator('.tn-stage')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  for (let i = 0; i < 20 && (await step(page)) === 'reading.ladder'; i++) {
    await page.waitForTimeout(900); // a plausible reading time
    await answerTrial(
      page,
      '.tn-stimulus-text',
      'reading.ladder',
      i % 3 === 2 ? 'c' : 't',
    );
  }

  await waitForStep(page, 'reading.contrast');
  await expectScreen(page, 'Which word is it?');
  for (let i = 0; i < 20 && (await step(page)) === 'reading.contrast'; i++) {
    const word = page.locator('.tn-stimulus-word');
    // After the last answer the word goes a moment before the screen does.
    await expect
      .poll(
        async () =>
          (await step(page)) !== 'reading.contrast' || (await word.count()) > 0,
      )
      .toBe(true);
    if ((await step(page)) !== 'reading.contrast') break;
    const shown = (await word.textContent()) ?? '';
    const grey = await word.evaluate((el) =>
      Number(/\d+/.exec(getComputedStyle(el).color)?.[0] ?? 0),
    );
    const options = await page
      .locator('.tn-responses--grid .tn-response__label')
      .allTextContents();
    const index = options.indexOf(shown);
    const key = grey < 235 && index >= 0 ? String(index + 1) : 'c';
    await answerTrial(page, '.tn-stimulus-word', 'reading.contrast', key);
  }

  await waitForStep(page, 'reading.polarity');
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(800);
    await answerTrial(page, '.tn-polarity-box', 'reading.polarity', 'f');
  }
  await expectScreen(page, 'Which felt easier to read?');
  await activate(page, button(page, 'Dark on light'));

  await expectScreen(page, 'Here’s your text.');
  await activate(page, button(page, 'Looks good'));

  /* ---------- Pointing: skipped with an explanation ---------- */
  await expectScreen(page, 'No pointing needed.');
  await expect(page.locator('.tn-field')).toHaveCount(0);
  await activate(page, button(page, 'Continue'));

  /* ---------- Focus ---------- */
  await expectScreen(page, 'Next, a few everyday pages.');
  await activate(page, button(page, 'Start'));

  await expectScreen(page, 'Find it.');
  for (let i = 0; i < 16 && (await step(page)) === 'focus.search'; i++) {
    const target =
      (await page.locator('.tn-findbar__target').textContent()) ?? '';
    const link = page
      .locator('.tn-stage')
      .getByRole('button', { name: target, exact: true });
    await activate(page, link);
    await expect
      .poll(async () =>
        (await step(page)) !== 'focus.search'
          ? 'moved on'
          : await page.locator('.tn-findbar__target').textContent(),
      )
      .not.toBe(target);
    if ((await step(page)) === 'focus.search') {
      // Each new page moves focus back to the "Find" line.
      await expect(page.locator('.tn-findbar__prompt')).toBeFocused();
    }
  }

  await expectScreen(page, 'What would you do next?');
  const nextTargets = /^(Proceed|Continue|Apply|Keep reading)$/;
  for (let i = 0; i < 4; i++) {
    const goal = await page.locator('.tn-goal').textContent();
    await activate(
      page,
      page.locator('.tn-flow__btn', { hasText: nextTargets }),
    );
    await expect
      .poll(async () =>
        (await step(page)) !== 'focus.next'
          ? 'moved on'
          : await page.locator('.tn-goal').textContent(),
      )
      .not.toBe(goal);
  }

  await expectScreen(page, 'Find the answer.');
  // Keyboard answers from a list, so nothing needs pointing.
  for (let i = 0; i < 2; i++) {
    const question = await page.locator('.tn-goal__question').textContent();
    await activate(page, page.locator('.tn-choice').first());
    await expect
      .poll(async () =>
        (await step(page)) !== 'focus.text'
          ? 'moved on'
          : await page.locator('.tn-goal__question').textContent(),
      )
      .not.toBe(question);
  }

  await waitForStep(page, 'focus.prefs');
  for (let i = 0; i < 4; i++) {
    const question = await page
      .getByRole('heading', { level: 1 })
      .textContent();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    if (i === 0) {
      // Answer the first pair with the arrows; leave the others without a preference.
      await tabTo(page, page.getByRole('radio').first());
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('radio').nth(1)).toBeChecked();
    }
    await activate(page, button(page, 'Continue'));
    await expect
      .poll(async () =>
        (await step(page)) !== 'focus.prefs'
          ? 'moved on'
          : await page.getByRole('heading', { level: 1 }).textContent(),
      )
      .not.toBe(question);
  }

  await expectScreen(page, 'Did anything get in your way?');
  await tabTo(page, page.getByRole('checkbox', { name: 'Nothing' }));
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'Nothing' })).toBeChecked();
  await activate(page, button(page, 'Continue'));

  /* ---------- Your fit ---------- */
  await expectScreen(page, 'Your fit');
  await expect(page.locator('.sr-only[aria-live="polite"]').last()).toHaveText(
    'All 3 parts done. Your fit is ready.',
  );
  const rows = page.locator('.tn-fit-row');
  await expect(rows).toHaveCount(10);
  // Adjust opens a row's control, by keyboard.
  const adjust = rows.first().getByRole('button', { name: /Adjust/ });
  await activate(page, adjust);
  await expect(adjust).toHaveAttribute('aria-expanded', 'true');
  await activate(page, button(page, 'Use this fit'));

  /* ---------- Saved in this browser ---------- */
  await expectScreen(page, 'Keep your fit.');
  await expect(
    page.getByRole('link', { name: /Create an account/ }),
  ).toHaveAttribute('href', '/sign-up?next=%2Ftune%2Fsave');
  const pending = await page.evaluate(() =>
    localStorage.getItem('wa-tune-pending-v1'),
  );
  expect(pending).not.toBeNull();
  const parsed = JSON.parse(pending ?? '{}') as {
    v: number;
    source: string;
    record: { modules: Record<string, unknown> };
  };
  expect(parsed.v).toBe(1);
  expect(parsed.source).toBe('calibration');
  expect(Object.keys(parsed.record.modules).sort()).toEqual([
    'focus',
    'pointing',
    'reading',
  ]);
  // Only summaries are kept: no per-trial response times or trial lists.
  expect(pending).not.toContain('rtMs');
  expect(pending).not.toContain('"ladder"');
  // WebAble's own UI now wears the fit.
  const ui = await page.evaluate(() => localStorage.getItem('wa-fit-ui'));
  expect(ui).toContain('--wa-text-scale');
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Focus never moves: a still, bright block stands in for motion', async ({
    page,
  }) => {
    await beginWithKeyboard(page);
    await expectScreen(page, 'Make this comfortable to read.');
    await activate(page, button(page, 'Skip this part'));
    await expectScreen(page, 'No pointing needed.');
    await activate(page, button(page, 'Continue'));
    await expectScreen(page, 'Next, a few everyday pages.');
    await expect(page.locator('main')).toContainText('less motion');
    await activate(page, button(page, 'Start'));

    let salient = 0;
    for (let i = 0; i < 16 && (await step(page)) === 'focus.search'; i++) {
      await expect(button(page, 'Stop motion')).toHaveCount(0);
      const running = await page
        .locator('.tn-mock')
        .evaluate((el) => el.getAnimations({ subtree: true }).length);
      expect(running).toBe(0);
      salient += await page.locator('.tn-mock__salient').count();
      const target =
        (await page.locator('.tn-findbar__target').textContent()) ?? '';
      await activate(
        page,
        page
          .locator('.tn-stage')
          .getByRole('button', { name: target, exact: true }),
      );
      await expect
        .poll(async () =>
          (await step(page)) !== 'focus.search'
            ? 'moved on'
            : await page.locator('.tn-findbar__target').textContent(),
        )
        .not.toBe(target);
    }
    expect(salient).toBe(6);
    await expectScreen(page, 'What would you do next?');
  });
});

test('Esc pauses, and Save and finish later picks up at the same part', async ({
  page,
}) => {
  await beginWithKeyboard(page);
  await expectScreen(page, 'Make this comfortable to read.');
  await page.keyboard.press('Escape');
  const dialog = page.getByRole('dialog', { name: 'Paused' });
  await expect(dialog).toBeVisible();
  await activate(
    page,
    dialog.getByRole('button', { name: 'Save and finish later' }),
  );
  await expectScreen(page, 'Finish whenever you like.');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Pick up where you left off?',
  );
  await activate(page, button(page, 'Continue with reading'));
  await expectScreen(page, 'Make this comfortable to read.');
});
