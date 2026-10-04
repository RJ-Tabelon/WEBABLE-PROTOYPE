import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Tune end to end. The main run is keyboard only: every screen is reached
 * with Tab, arrows, Space, Enter and the task keys (T / F / C, 1-4, - / +),
 * and no mouse event is sent. Signed out, so the finished fit waits in this
 * browser. Layout checks run at the three reference windows and text scales.
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

/**
 * Skip and Continue are ignored for 300 ms after a screen changes (so a double
 * press never skips two parts); a person takes longer than that to reach them.
 */
const SETTLE_MS = 320;

/** Every screen change moves focus to the new h1 (design-final §9.2). */
async function expectScreen(page: Page, name: string | RegExp): Promise<void> {
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveText(name);
  await expect(h1).toBeFocused();
  await page.waitForTimeout(SETTLE_MS);
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
  // The next stimulus is up, or the last answer ended the screen.
  await expect
    .poll(
      async () => (await step(page)) !== stepId || (await stimulus.count()) > 0,
    )
    .toBe(true);
  if ((await step(page)) !== stepId) return;
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

/** The action bar's Skip for the part on screen ("Skip reading"). */
function skip(page: Page, part: 'reading' | 'pointing' | 'focus'): Locator {
  return page
    .locator('.wa-task__actions')
    .getByRole('button', { name: `Skip ${part}`, exact: true });
}

async function beginWith(
  page: Page,
  input: 'Mouse' | 'Keyboard only',
): Promise<void> {
  await page.goto('/tune');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /fit WebAble to you/,
  );
  // The radio group takes one Tab stop; arrows move the choice.
  await tabTo(page, page.getByRole('radio', { name: 'Mouse' }));
  if (input === 'Keyboard only') {
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  }
  await expect(page.getByRole('radio', { name: input })).toBeChecked();
  await activate(page, button(page, 'Begin'));
}

async function beginWithKeyboard(page: Page): Promise<void> {
  await beginWith(page, 'Keyboard only');
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right - 0.5 &&
    b.left < a.right - 0.5 &&
    a.top < b.bottom - 0.5 &&
    b.top < a.bottom - 0.5
  );
}

test('a keyboard-only Tune reaches Your fit and keeps the fit in this browser', async ({
  page,
}) => {
  await beginWithKeyboard(page);

  /* ---------- Reading ---------- */
  await expectScreen(page, 'Make this comfortable to read.');
  const paragraph = page.locator('.tn-stimulus-text');
  // Reading stimuli are set in the bundled Noto Sans, whatever the machine has.
  await expect(paragraph).toHaveCSS('font-family', /^"?Noto Sans"?/);
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (face) =>
          face.family.replace(/["']/g, '') === 'Noto Sans' &&
          face.status === 'loaded',
      ),
    ),
  ).toBe(true);
  // The glyphs on screen come from the bundled web font, not a system face.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.tn-stimulus-text',
  });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  expect(fonts[0]).toMatchObject({
    familyName: 'Noto Sans',
    isCustomFont: true,
  });
  await cdp.detach();
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
    // Each step of the scale has its full name; words show only at the ends.
    await expect(
      page.getByRole('radio', { name: 'Version 1, clearly' }),
    ).toBeAttached();
    await expect(page.locator('.tn-scale__word')).toHaveText([
      'Version 1',
      'About the same',
      'Version 2',
    ]);
    if (i === 0) {
      // Answer the first pair with the arrows; leave the others without a preference.
      await tabTo(page, page.getByRole('radio').first());
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowRight');
      await expect(
        page.getByRole('radio', { name: 'Version 1, a little' }),
      ).toBeChecked();
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
  // Every setting is on the page: the changes first, the rest in "Left as
  // sites made them", where nothing shows a number.
  const rows = page.locator('.tn-fit__item');
  await expect(rows).toHaveCount(10);
  const rest = page.locator('.tn-fit__rows--compact .wa-fitrow__value');
  for (const text of await rest.allTextContents()) {
    expect(text).not.toMatch(/\d/);
  }
  // The primary action lives in the action bar, always in view.
  const bar = page.locator('.wa-task__actions');
  await expect(bar.getByRole('button', { name: 'Use this fit' })).toBeVisible();
  // Adjust first opens the first changed row and moves focus onto its control.
  await activate(page, bar.getByRole('button', { name: 'Adjust first' }));
  const first = rows.first();
  // The row's toggle reads "Done" while its editor is open.
  const toggle = first.locator('button[aria-expanded]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAccessibleName(/^Done/);
  await expect(first.locator('.wa-fit-editor')).toBeVisible();
  await expect
    .poll(() => first.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAccessibleName(/^Adjust/);
  await expect(toggle).toBeFocused();
  await activate(page, bar.getByRole('button', { name: 'Use this fit' }));

  /* ---------- Saved in this browser ---------- */
  await expectScreen(page, 'Keep your fit.');
  await expect(
    page.getByRole('link', { name: /Create an account/ }),
  ).toHaveAttribute('href', '/sign-up?next=%2Ftune%2Fsave');
  await expect(
    page.getByRole('link', { name: 'I have an account' }),
  ).toHaveAttribute('href', '/sign-in?next=%2Ftune%2Fsave');
  await expect(page.getByRole('link', { name: 'Not now' })).toHaveAttribute(
    'href',
    '/',
  );
  await expect(page.locator('main')).toContainText(
    'Your fit stays in this browser.',
  );
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

  // The next Tune says a fit is waiting, and where to save it.
  await page.goto('/tune');
  await expect(page.locator('.tn-intro__pending')).toContainText(
    'You have an unsaved fit from',
  );
  await expect(
    page.locator('.tn-intro__pending').getByRole('link', { name: 'Save it' }),
  ).toHaveAttribute('href', '/tune/save');
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Focus never moves: a still, bright block stands in for motion', async ({
    page,
  }) => {
    await beginWithKeyboard(page);
    await expectScreen(page, 'Make this comfortable to read.');
    await activate(page, skip(page, 'reading'));
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
  // Resume and Esc close the sheet; there is no second "Resume" (the ✕).
  await expect(dialog.getByRole('button', { name: 'Resume' })).toHaveCount(1);
  await expect(dialog.getByRole('button')).toHaveCount(2);
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

test('skipping every part moves focus to each new heading, and a double Enter skips one part only', async ({
  page,
}) => {
  await beginWith(page, 'Mouse');
  await expectScreen(page, 'Make this comfortable to read.');
  await activate(page, skip(page, 'reading'));

  await expectScreen(page, 'Next, pointing.');
  await waitForStep(page, 'before.pointing');
  // The rest screen keeps Pause and the next part's Skip (design-final §9.2).
  await expect(
    page.locator('.wa-task__actions').getByRole('button', { name: 'Pause' }),
  ).toBeVisible();
  await tabTo(page, skip(page, 'pointing'));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await expectScreen(page, 'Next, a few everyday pages.');
  await page.waitForTimeout(500);
  expect(await step(page)).toBe('before.focus');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

  await activate(page, skip(page, 'focus'));
  await expectScreen(page, 'Your fit');
});

test('task keys work only inside the screen, and arrows scroll instead of answering', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await beginWithKeyboard(page);
  await expectScreen(page, 'Make this comfortable to read.');
  await activate(page, button(page, 'This is comfortable'));
  await expectScreen(page, 'Is it true?');
  const stimulus = page.locator('.tn-stimulus-text');
  await expect(stimulus).toBeAttached();
  await stimulus.evaluate((el) => el.setAttribute('data-first', ''));

  const scrolled = () =>
    page.evaluate(
      () =>
        (document.scrollingElement?.scrollTop ?? 0) +
        (document.querySelector('main')?.scrollTop ?? 0),
    );
  const before = await scrolled();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  expect(await scrolled()).toBeGreaterThan(before);
  await expect(page.locator('.tn-stimulus-text[data-first]')).toHaveCount(1);

  // With focus in the action bar the letter keys do nothing.
  await tabTo(
    page,
    page.locator('.wa-task__actions').getByRole('button', { name: 'Pause' }),
  );
  await page.keyboard.press('t');
  await page.waitForTimeout(400);
  await expect(page.locator('.tn-stimulus-text[data-first]')).toHaveCount(1);

  // Inside the screen they answer.
  await page.locator('.tn-screen h1').focus();
  await page.keyboard.press('t');
  await expect(page.locator('.tn-stimulus-text[data-first]')).toHaveCount(0);
});

/* ---------- Layout at every reference window and text scale ---------- */

const WINDOWS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const;
const SCALES = ['1', '1.31', '1.58'] as const;

/**
 * Without scrolling, the last answer ends at or above the top of the action
 * bar, and no control reached by Tab is ever under the action bar. Reading
 * answers are timed (scrolling to them would count as reading time), so they
 * are also inside the window when the bars are not pinned and the action bar
 * follows the content. Contrast answers are not timed: at a large text size on
 * a phone the page may scroll to them, never under a bar.
 */
async function checkLayout(
  page: Page,
  label: string,
  { timed }: { timed: boolean },
): Promise<void> {
  const layout = await page.evaluate(() => {
    const responses = [...document.querySelectorAll('.tn-screen .tn-response')];
    const last = responses.at(-1)?.getBoundingClientRect() ?? null;
    const bar = document.querySelector('.wa-task__actions');
    const barBox = bar?.getBoundingClientRect() ?? null;
    return {
      last: last ? { bottom: last.bottom } : null,
      barTop: barBox?.top ?? null,
      viewport: window.innerHeight,
    };
  });
  if (layout.last) {
    const barTop = layout.barTop ?? Infinity;
    const limit = timed ? Math.min(barTop, layout.viewport) : barTop;
    expect(layout.last.bottom, `${label}: answers in view`).toBeLessThanOrEqual(
      limit + 0.5,
    );
  }

  await page.locator('.tn-screen h1').focus();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      const screen = document.querySelector('.tn-screen');
      if (!el || !screen?.contains(el) || el === screen) return null;
      const r = el.getBoundingClientRect();
      const bar = document.querySelector('.wa-task__actions');
      const b = bar?.getBoundingClientRect();
      return {
        el: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        bar: b
          ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
          : null,
      };
    });
    if (!focus) break;
    if (focus.bar)
      expect(
        intersects(focus.el, focus.bar),
        `${label}: a focused control sits under the action bar`,
      ).toBe(false);
  }
  await page.locator('.tn-screen h1').focus();
}

for (const win of WINDOWS) {
  for (const scale of SCALES) {
    test(`answers stay in view at ${win.width}×${win.height}, text scale ${scale}`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(win);
      await beginWithKeyboard(page);
      await page.addStyleTag({
        content: `:root { --wa-text-scale: ${scale} !important; }`,
      });
      await expectScreen(page, 'Make this comfortable to read.');
      await activate(page, button(page, 'This is comfortable'));

      await expectScreen(page, 'Is it true?');
      await expect(page.locator('.tn-stimulus-text')).toBeAttached();
      await checkLayout(page, `ladder ${win.width} ${scale}`, {
        timed: true,
      });
      for (let i = 0; i < 30 && (await step(page)) === 'reading.ladder'; i++)
        await answerTrial(page, '.tn-stimulus-text', 'reading.ladder', 'c');

      await waitForStep(page, 'reading.contrast');
      await expect(page.locator('.tn-stimulus-word')).toBeAttached();
      await checkLayout(page, `contrast ${win.width} ${scale}`, {
        timed: false,
      });
      for (
        let i = 0;
        i < 20 && (await step(page)) === 'reading.contrast';
        i++
      ) {
        if ((await page.locator('.tn-stimulus-word').count()) === 0) {
          await page.waitForTimeout(100);
          continue;
        }
        await answerTrial(page, '.tn-stimulus-word', 'reading.contrast', 'c');
      }

      await waitForStep(page, 'reading.polarity');
      await expect(page.locator('.tn-polarity-box')).toBeAttached();
      await checkLayout(page, `polarity ${win.width} ${scale}`, {
        timed: true,
      });
      await page.waitForTimeout(SETTLE_MS);

      await activate(page, skip(page, 'reading'));
      await expectScreen(page, 'No pointing needed.');
      await activate(page, button(page, 'Continue'));
      await expectScreen(page, 'Next, a few everyday pages.');
      await activate(page, button(page, 'Start'));
      await expectScreen(page, 'Find it.');
      await checkLayout(page, `find ${win.width} ${scale}`, {
        timed: true,
      });
      // The find bar is in view, above the action bar.
      const findbar = await page
        .locator('.tn-findbar')
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(findbar).toBeGreaterThanOrEqual(0);
    });
  }
}

/* ---------- Mock pages at phone widths ---------- */

test('on mock pages at 320-430 px, badges and thumbnails never sit on a link', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await beginWithKeyboard(page);
  await expectScreen(page, 'Make this comfortable to read.');
  await activate(page, skip(page, 'reading'));
  await expectScreen(page, 'No pointing needed.');
  await activate(page, button(page, 'Continue'));
  await expectScreen(page, 'Next, a few everyday pages.');
  await activate(page, button(page, 'Start'));

  const seen = new Set<string>();
  for (let i = 0; i < 20 && (await step(page)) === 'focus.search'; i++) {
    const mock = page.locator('.tn-stage .tn-mock');
    const template = await mock.getAttribute('data-template');
    const clutter = (await mock.getAttribute('class'))?.includes(
      'tn-mock--busy',
    )
      ? 'busy'
      : 'clean';
    seen.add(`${template}/${clutter}`);
    for (let width = 320; width <= 430; width += 10) {
      await page.setViewportSize({ width, height: 844 });
      const overlaps = await page.evaluate(() => {
        const out: string[] = [];
        for (const item of document.querySelectorAll('.tn-mock__item')) {
          const link = item.querySelector('.tn-mock__link');
          if (!link) continue;
          const range = document.createRange();
          range.selectNodeContents(link);
          const words = [...range.getClientRects()];
          for (const other of item.querySelectorAll(
            '.tn-mock__badge, .tn-mock__thumb',
          )) {
            const o = other.getBoundingClientRect();
            for (const w of words) {
              if (
                w.left < o.right - 0.5 &&
                o.left < w.right - 0.5 &&
                w.top < o.bottom - 0.5 &&
                o.top < w.bottom - 0.5
              )
                out.push(`${link.textContent} / ${other.className}`);
            }
          }
        }
        return out;
      });
      expect(overlaps, `${template}/${clutter} at ${width}px`).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const target =
      (await page.locator('.tn-findbar__target').textContent()) ?? '';
    await page
      .locator('.tn-stage')
      .getByRole('button', { name: target, exact: true })
      .click();
    await expect
      .poll(async () =>
        (await step(page)) !== 'focus.search'
          ? 'moved on'
          : await page.locator('.tn-findbar__target').textContent(),
      )
      .not.toBe(target);
  }
  // Every template, clean and busy.
  expect(seen.size).toBe(8);
});

/* ---------- The fit preview's marks never cover the page's words ---------- */

for (const width of [1440, 390]) {
  test(`fit preview outlines and discs stay off the text at ${width} px`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await beginWithKeyboard(page);
    await expectScreen(page, 'Make this comfortable to read.');
    // A larger comfortable size, then "can't read" answers: text gets larger.
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    await activate(page, button(page, 'This is comfortable'));
    await expectScreen(page, 'Is it true?');
    for (let i = 0; i < 30 && (await step(page)) === 'reading.ladder'; i++)
      await answerTrial(page, '.tn-stimulus-text', 'reading.ladder', 'c');
    await waitForStep(page, 'reading.contrast');
    await page.waitForTimeout(SETTLE_MS);
    await activate(page, skip(page, 'reading'));
    await expectScreen(page, 'No pointing needed.');
    await activate(page, button(page, 'Continue'));
    await expectScreen(page, 'Next, a few everyday pages.');
    await activate(page, skip(page, 'focus'));
    await expectScreen(page, 'Your fit');

    const outlines = page.locator('.tn-fit-outline');
    await expect(outlines.first()).toBeAttached();
    await expect(page.locator('.tn-fit-legend li')).toHaveCount(
      await outlines.count(),
    );
    const hits = await page.evaluate(() => {
      const layer = document.querySelector('[data-layer="fitted"]');
      if (!layer) return ['no fitted layer'];
      const words: DOMRect[] = [];
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        words.push(...range.getClientRects());
      }
      const hit = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 0.5 &&
        b.left < a.right - 0.5 &&
        a.top < b.bottom - 0.5 &&
        b.top < a.bottom - 0.5;
      const out: string[] = [];
      for (const outline of document.querySelectorAll('.tn-fit-outline')) {
        const o = outline.getBoundingClientRect();
        // The stroke: the 2 px border and its 1 px casing on each side.
        const band = 4;
        const strokes = [
          new DOMRect(o.left - 1, o.top - 1, o.width + 2, band),
          new DOMRect(o.left - 1, o.bottom - band + 1, o.width + 2, band),
          new DOMRect(o.left - 1, o.top - 1, band, o.height + 2),
          new DOMRect(o.right - band + 1, o.top - 1, band, o.height + 2),
        ];
        const disc = outline
          .querySelector('.tn-fit-disc')
          ?.getBoundingClientRect();
        for (const w of words) {
          if (strokes.some((s) => hit(s, w))) out.push('stroke');
          if (disc && hit(disc, w)) out.push('disc');
        }
        // The disc stays inside the frame.
        const frame = document
          .querySelector('.tn-fitpv__frame')
          ?.getBoundingClientRect();
        if (disc && frame && (disc.right > frame.right || disc.top < frame.top))
          out.push('disc outside the frame');
      }
      return out;
    });
    expect(hits).toEqual([]);
  });
}
