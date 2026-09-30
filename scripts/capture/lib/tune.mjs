/* global window, document, getComputedStyle -- page.evaluate callbacks run in the page. */
import { metaFor, settle, webContext } from './kit.mjs';

/**
 * Tune, signed out, walked screen by screen the way a person would: pointer
 * clicks at 1440 (mouse) and taps at 390 (touch), keys for the reading answers
 * (as the Tune e2e does). Every distinct screen is captured once per viewport;
 * a stage screen and Your fit are also captured in dark.
 */

const GROUP = 'Tune';

async function step(page) {
  return page
    .locator('.tn-screen')
    .getAttribute('data-step', { timeout: 2_000 })
    .catch(() => null);
}

async function waitStep(page, expected, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await step(page);
    if (typeof expected === 'function' ? expected(last) : last === expected)
      return last;
    await page.waitForTimeout(120);
  }
  throw new Error(
    `Tune never reached ${typeof expected === 'function' ? 'the expected step' : expected} (at ${last})`,
  );
}

function button(page, name) {
  return page.getByRole('button', { name, exact: typeof name === 'string' });
}

/** Centre of an element, scrolled into view, in viewport CSS pixels. */
async function centerOf(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function press(page, touch, point) {
  if (touch) {
    await page.touchscreen.tap(point.x, point.y);
    return;
  }
  await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
}

/** A touch drag over CDP (Playwright's touchscreen only taps). */
async function touchDrag(page, from, to) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let i = 1; i <= 12; i++) {
    const x = from.x + ((to.x - from.x) * i) / 12;
    const y = from.y + ((to.y - from.y) * i) / 12;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

async function click(page, touch, locator) {
  if (touch) await locator.tap();
  else await locator.click();
}

/** Press the stimulus key and wait until the next stimulus (or screen) shows. */
async function answerTrial(page, selector, stepId, key) {
  const stimulus = page.locator(selector).first();
  await stimulus.waitFor({ state: 'attached', timeout: 10_000 });
  await stimulus.evaluate((el) => el.setAttribute('data-answered', ''));
  await page.keyboard.press(key);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await step(page)) !== stepId) return;
    if ((await page.locator(`${selector}:not([data-answered])`).count()) > 0)
      return;
    if ((await page.locator(selector).count()) === 0) return;
    await page.waitForTimeout(60);
  }
}

/**
 * The answer a reader with ordinary vision would give: the true/false answer of
 * the sentence on screen (from the stimulus list in @webable/core), or
 * "Can't read it" once the text is smaller than `minPx`. Answering blindly
 * would steer the ladder to an implausible fit (70+ px text).
 */
async function readingKey(page, selector, sentences, minPx = 7) {
  const el = page.locator(selector).first();
  const { text, px } = await el.evaluate((node) => ({
    text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    px: parseFloat(getComputedStyle(node).fontSize),
  }));
  if (px < minPx) return { key: 'c', readMs: 1_500 };
  const hit = sentences.find((s) => text.includes(s.text));
  // About 250 words a minute, slower as the text gets small (the ladder
  // treats anything under 800 ms of reading as a skim and asks again).
  const words = text.split(' ').length;
  const perWord = px >= 14 ? 240 : px >= 10 ? 320 : 480;
  return {
    key: hit ? (hit.answer ? 't' : 'f') : 't',
    readMs: 600 + Math.max(900, words * perWord),
  };
}

/** Click targets in a pointing field until the screen moves on. */
async function clickTargets(page, touch, stepId, max = 60, onEach) {
  for (let i = 0; i < max && (await step(page)) === stepId; i++) {
    const target = page.locator('.tn-target').first();
    if ((await target.count()) === 0) {
      await page.waitForTimeout(100);
      continue;
    }
    if (onEach) await onEach(i);
    await target.evaluate((el) => el.setAttribute('data-pressed', ''));
    await press(page, touch, await centerOf(target));
    // Wait for the next circle (a new element) or the next screen.
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      if ((await step(page)) !== stepId) break;
      if ((await page.locator('.tn-target:not([data-pressed])').count()) > 0)
        break;
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(80);
  }
}

/**
 * A Tune screen as the person sees it (the viewport, with the sticky action
 * bar), and when the screen scrolls, also the whole screen (`<state>-full`).
 * `{ viewportOnly: true }` for sheets and dialogs.
 */
async function screenShots(
  rec,
  page,
  meta,
  { viewportOnly = false, keepPointer = false } = {},
) {
  await rec.shot(page, meta, { keepPointer });
  if (viewportOnly) return;
  const overflow = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 2,
  );
  if (overflow)
    await rec.shot(
      page,
      { ...meta, state: `${meta.state}-full` },
      { fullPage: true },
    );
}

/** Where the Tune dark shots are taken: emulate dark, shoot, go back to light. */
async function darkShot(rec, page, surface, state, vpTag) {
  await page.emulateMedia({ colorScheme: 'dark' });
  await settle(page, 300);
  await screenShots(rec, page, {
    surface,
    state,
    viewport: vpTag,
    theme: 'dark',
    group: GROUP,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await settle(page, 200);
}

async function begin(page, base, { input, screenReader = false } = {}) {
  await page.goto(`${base}/tune`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: input }).check();
  if (screenReader) {
    await page
      .getByRole('checkbox', { name: 'I use a screen reader or magnifier' })
      .check();
  }
}

/** The full walk at one viewport. */
async function walk(ctx, cfg) {
  const { browser, rec, base } = ctx;
  const sentences = ctx.fixtures.READING_SENTENCES;
  const touch = cfg.vp === 'mobile';
  const vpTag = cfg.vp === 'mobile' ? '390' : '1440';
  const context = await webContext(browser, cfg);
  const page = await context.newPage();
  const shoot = (surface, state, options) =>
    screenShots(
      rec,
      page,
      metaFor(surface, state, cfg, { group: GROUP }),
      options,
    );
  const at = (surface, state) => metaFor(surface, state, cfg, { group: GROUP });

  try {
    await rec.attempt(at('tune-intro', 'default'), async () => {
      await page.goto(`${base}/tune`, { waitUntil: 'networkidle' });
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('heading', { level: 1 }).waitFor();
      await settle(page, 300);
      await shoot('tune-intro', 'default');
    });

    await begin(page, base, { input: touch ? 'Touch' : 'Mouse' });
    await click(page, touch, button(page, 'Begin'));

    /* ---------- Reading ---------- */
    await waitStep(page, 'reading.comfort');
    await settle(page, 300);
    await shoot('tune-reading', '1-comfort');

    await rec.attempt(at('tune-pause-sheet', 'open'), async () => {
      await page.keyboard.press('Escape');
      const dialog = page.getByRole('dialog', { name: 'Paused' });
      await dialog.waitFor();
      await settle(page, 400);
      await shoot('tune-pause-sheet', 'open', { viewportOnly: true });
      await dialog.getByRole('button', { name: 'Resume' }).first().click();
      await dialog.waitFor({ state: 'hidden' });
    });

    await page.keyboard.press('=');
    await page.waitForTimeout(200);
    await click(page, touch, button(page, 'This is comfortable'));

    await waitStep(page, 'reading.ladder');
    await page.locator('.tn-stimulus-text').first().waitFor();
    await settle(page, 300);
    await shoot('tune-reading', '2-ladder');
    if (!touch)
      await rec.attempt(
        { ...at('tune-reading', '2-ladder'), theme: 'dark' },
        () => darkShot(rec, page, 'tune-reading', '2-ladder', vpTag),
      );
    for (let i = 0; i < 60 && (await step(page)) === 'reading.ladder'; i++) {
      const { key, readMs } = await readingKey(
        page,
        '.tn-stimulus-text',
        sentences,
      );
      await page.waitForTimeout(readMs);
      await answerTrial(page, '.tn-stimulus-text', 'reading.ladder', key);
    }

    await waitStep(page, 'reading.contrast');
    await page.locator('.tn-stimulus-word').first().waitFor();
    await settle(page, 200);
    await shoot('tune-reading', '3-contrast-word');
    for (let i = 0; i < 60 && (await step(page)) === 'reading.contrast'; i++) {
      const word = page.locator('.tn-stimulus-word');
      const deadline = Date.now() + 5_000;
      while (
        Date.now() < deadline &&
        (await step(page)) === 'reading.contrast' &&
        (await word.count()) === 0
      )
        await page.waitForTimeout(60);
      if ((await step(page)) !== 'reading.contrast') break;
      const shown = (await word.first().textContent()) ?? '';
      const grey = await word
        .first()
        .evaluate((el) =>
          Number(/\d+/.exec(getComputedStyle(el).color)?.[0] ?? 0),
        );
      const options = await page
        .locator('.tn-responses--grid .tn-response__label')
        .allTextContents();
      const index = options.indexOf(shown);
      // A typical reader sees a word down to about 2% contrast on white.
      const key = grey <= 250 && index >= 0 ? String(index + 1) : 'c';
      await answerTrial(page, '.tn-stimulus-word', 'reading.contrast', key);
    }

    await waitStep(page, 'reading.polarity');
    const seen = new Set();
    for (let i = 0; i < 20 && (await step(page)) === 'reading.polarity'; i++) {
      const box = page.locator('.tn-polarity-box').first();
      if ((await box.count()) === 0) break;
      const cls = (await box.getAttribute('class')) ?? '';
      const polarity = /--(\w+)/.exec(cls)?.[1] ?? 'unknown';
      if (!seen.has(polarity)) {
        seen.add(polarity);
        await settle(page, 200);
        await shoot('tune-reading', `4-light-dark-trial-${polarity}`);
      }
      const { key, readMs } = await readingKey(
        page,
        '.tn-polarity-box',
        sentences,
      );
      await page.waitForTimeout(readMs);
      await answerTrial(page, '.tn-polarity-box', 'reading.polarity', key);
    }
    await page
      .getByRole('heading', { level: 1, name: 'Which felt easier to read?' })
      .waitFor();
    await settle(page, 200);
    await shoot('tune-reading', '4-light-dark-question');
    await click(page, touch, button(page, 'Dark on light'));

    await waitStep(page, 'reading.preview');
    await settle(page, 300);
    await shoot('tune-reading', '5-preview');
    await click(page, touch, button(page, 'Looks good'));

    /* ---------- Pointing ---------- */
    await waitStep(page, 'before.pointing');
    await settle(page, 300);
    await shoot('tune-rest', 'before-pointing');
    await click(page, touch, button(page, 'Continue'));

    await waitStep(page, 'pointing.warmup');
    await page.locator('.tn-target').first().waitFor();
    await settle(page, 200);
    await shoot('tune-pointing', '1-warm-up');
    await clickTargets(page, touch, 'pointing.warmup', 10);

    await waitStep(page, 'pointing.ring');
    await page.locator('.tn-target').first().waitFor();
    await settle(page, 200);
    await shoot('tune-pointing', '2-ring');
    let blockShot = false;
    let firstSize = await page
      .locator('.tn-target')
      .first()
      .evaluate((el) => el.style.inlineSize)
      .catch(() => null);
    await clickTargets(page, touch, 'pointing.ring', 60, async () => {
      if (blockShot) return;
      const size = await page
        .locator('.tn-target')
        .first()
        .evaluate((el) => el.style.inlineSize)
        .catch(() => null);
      if (size && firstSize && size !== firstSize) {
        blockShot = true;
        await settle(page, 100);
        await shoot('tune-pointing', '2-ring-next-size');
      }
      firstSize ??= size;
    });

    await waitStep(page, 'pointing.hold');
    await page.locator('.tn-target').first().waitFor();
    await settle(page, 200);
    await shoot('tune-pointing', '3-hold');
    if (touch) {
      for (let i = 0; i < 6 && (await step(page)) === 'pointing.hold'; i++) {
        await press(page, true, await centerOf(page.locator('.tn-target')));
        await page.waitForTimeout(250);
      }
    } else {
      for (let i = 0; i < 4 && (await step(page)) === 'pointing.hold'; i++) {
        const c = await centerOf(page.locator('.tn-target'));
        await page.mouse.move(c.x - 120, c.y, { steps: 2 });
        await page.mouse.move(c.x, c.y, { steps: 10 });
        await page.waitForTimeout(700);
        if (i === 0)
          await shoot('tune-pointing', '3-hold-filling', {
            viewportOnly: true,
            keepPointer: true,
          });
        await page.waitForTimeout(1_200);
        if (i === 0)
          await shoot('tune-pointing', '3-hold-click-now', {
            viewportOnly: true,
            keepPointer: true,
          });
        await page.mouse.down();
        await page.waitForTimeout(40);
        await page.mouse.up();
        await page.waitForTimeout(250);
      }
    }

    const afterHold = await waitStep(
      page,
      (s) => s !== 'pointing.hold',
      15_000,
    );
    if (afterHold === 'pointing.drag') {
      await page.locator('.tn-token').waitFor();
      await settle(page, 200);
      await shoot('tune-pointing', '4-drag');
      for (let i = 0; i < 6 && (await step(page)) === 'pointing.drag'; i++) {
        const from = await centerOf(page.locator('.tn-token'));
        const to = await centerOf(page.locator('.tn-well'));
        if (touch) {
          await touchDrag(page, from, to);
        } else {
          await page.mouse.move(from.x, from.y, { steps: 4 });
          await page.mouse.down();
          await page.mouse.move(to.x, to.y, { steps: 16 });
          await page.mouse.up();
        }
        await page.waitForTimeout(300);
      }
      if ((await step(page)) === 'pointing.drag')
        await click(page, touch, button(page, 'I’d rather not drag'));
    }

    const afterDrag = await waitStep(
      page,
      (s) => s !== 'pointing.drag' && s !== 'pointing.hold',
    );
    if (afterDrag === 'pointing.return') {
      await page.locator('.tn-target').first().waitFor();
      await settle(page, 200);
      await shoot('tune-pointing', '5-return');
      await clickTargets(page, touch, 'pointing.return', 30);
    }

    await waitStep(page, 'pointing.preview');
    await settle(page, 300);
    await shoot('tune-pointing', '6-preview');
    await click(page, touch, button(page, 'Use this size'));

    /* ---------- Focus ---------- */
    await waitStep(page, 'before.focus');
    await settle(page, 300);
    await shoot('tune-rest', 'before-focus');
    await click(page, touch, button(page, 'Start'));

    await waitStep(page, 'focus.search');
    const shots = new Set();
    for (let i = 0; i < 20 && (await step(page)) === 'focus.search'; i++) {
      const target =
        (await page.locator('.tn-findbar__target').textContent()) ?? '';
      const practice = await page
        .locator('.tn-screen')
        .getByText('First, a practice page.')
        .count();
      const busy = await page.locator('.tn-mock--busy').count();
      const moving = await page.locator('.tn-findbar__stop').count();
      const kind = practice
        ? 'practice'
        : `${busy ? 'busy' : 'clean'}${moving ? '-moving' : ''}`;
      if (!shots.has(kind)) {
        shots.add(kind);
        await settle(page, 200);
        await shoot('tune-focus', `1-search-${kind}`);
        if (kind === 'clean') {
          // A wrong click first, for the neutral "Not that one." line.
          const wrong = page
            .locator('.tn-stage')
            .getByRole('button')
            .filter({ hasNotText: target })
            .first();
          if ((await wrong.count()) > 0) {
            await click(page, touch, wrong);
            await settle(page, 200);
            await shoot('tune-focus', '1-search-not-that-one');
          }
        }
      }
      const link = page
        .locator('.tn-stage')
        .getByRole('button', { name: target, exact: true });
      await click(page, touch, link);
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if ((await step(page)) !== 'focus.search') break;
        const now = await page.locator('.tn-findbar__target').textContent();
        if (now !== target) break;
        await page.waitForTimeout(60);
      }
    }

    await waitStep(page, 'focus.next');
    await settle(page, 300);
    await shoot('tune-focus', '2-whats-next');
    for (let i = 0; i < 8 && (await step(page)) === 'focus.next'; i++) {
      const goal = await page.locator('.tn-goal').textContent();
      await click(
        page,
        touch,
        page
          .locator('.tn-flow__btn', {
            hasText: /^(Proceed|Continue|Apply|Keep reading)$/,
          })
          .first(),
      );
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if ((await step(page)) !== 'focus.next') break;
        if ((await page.locator('.tn-goal').textContent()) !== goal) break;
        await page.waitForTimeout(60);
      }
    }

    await waitStep(page, 'focus.text');
    await settle(page, 300);
    const listFirst = (await page.locator('.tn-choice').count()) > 0;
    await shoot(
      'tune-focus',
      listFirst ? '3-find-in-text-list' : '3-find-in-text',
    );
    if (!listFirst) {
      await click(page, touch, button(page, 'Choose from a list instead'));
      await page.locator('.tn-choice').first().waitFor();
      await settle(page, 200);
      await shoot('tune-focus', '3-find-in-text-list');
    }
    for (let i = 0; i < 4 && (await step(page)) === 'focus.text'; i++) {
      const q = await page.locator('.tn-goal__question').textContent();
      await click(page, touch, page.locator('.tn-choice').first());
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if ((await step(page)) !== 'focus.text') break;
        if ((await page.locator('.tn-goal__question').textContent()) !== q)
          break;
        await page.waitForTimeout(60);
      }
    }

    await waitStep(page, 'focus.prefs');
    for (let i = 0; i < 6 && (await step(page)) === 'focus.prefs'; i++) {
      const q = await page.getByRole('heading', { level: 1 }).textContent();
      if (i === 0) {
        await page.getByRole('radio').nth(1).check();
        await settle(page, 200);
        await shoot('tune-focus', '4-preferences');
      }
      await click(page, touch, button(page, 'Continue'));
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if ((await step(page)) !== 'focus.prefs') break;
        if ((await page.getByRole('heading', { level: 1 }).textContent()) !== q)
          break;
        await page.waitForTimeout(60);
      }
    }

    await waitStep(page, 'focus.chips');
    await settle(page, 300);
    await shoot('tune-focus', '5-chips');
    await page.getByRole('checkbox', { name: 'Nothing' }).check();
    await settle(page, 150);
    await shoot('tune-focus', '5-chips-answered');
    await click(page, touch, button(page, 'Continue'));

    /* ---------- Your fit ---------- */
    await waitStep(page, 'fit');
    await page.locator('.tn-fit-row').first().waitFor();
    await settle(page, 500);
    await shoot('tune-your-fit', 'default');
    await rec.attempt(
      { ...at('tune-your-fit', 'default'), theme: 'dark' },
      () => darkShot(rec, page, 'tune-your-fit', 'default', vpTag),
    );
    await rec.attempt(at('tune-your-fit', 'adjust-open'), async () => {
      const adjust = page
        .locator('.tn-fit-row')
        .first()
        .getByRole('button', { name: /Adjust/ });
      await click(page, touch, adjust);
      await settle(page, 300);
      await shoot('tune-your-fit', 'adjust-open');
      await click(page, touch, adjust);
    });
    await click(page, touch, button(page, 'Use this fit'));
    await waitStep(page, 'done');
    await settle(page, 400);
    await shoot('tune-saved', 'signed-out-keep-your-fit');
  } catch (error) {
    rec.miss(
      at('tune-walk', `stopped-at-${(await step(page)) ?? 'unknown'}`),
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await context.close();
  }
}

/** Short routes for screens the main walk never shows. */
async function sideRoutes(ctx) {
  const { browser, rec, base } = ctx;
  const cfg = { vp: 'desktop', theme: 'light' };
  const at = (surface, state) => metaFor(surface, state, cfg, { group: GROUP });
  const context = await webContext(browser, cfg);
  const page = await context.newPage();
  const shoot = (surface, state) => screenShots(rec, page, at(surface, state));

  await rec.attempt(at('tune-intro', 'assistive-open'), async () => {
    await begin(page, base, { input: 'Mouse', screenReader: true });
    await settle(page, 300);
    await shoot('tune-intro', 'assistive-open');
    await button(page, 'Begin').click();
    await waitStep(page, 'sr-route');
    await settle(page, 300);
    await shoot('tune-screen-reader-route', 'default');
  });

  await rec.attempt(at('tune-pointing', 'keyboard-no-pointing'), async () => {
    await begin(page, base, { input: 'Keyboard only' });
    await button(page, 'Begin').click();
    await waitStep(page, 'reading.comfort');
    await button(page, 'Skip this part').click();
    await waitStep(page, 'pointing.keyboard');
    await settle(page, 300);
    await shoot('tune-pointing', 'keyboard-no-pointing');
  });

  await rec.attempt(at('tune-saved-for-later', 'default'), async () => {
    await begin(page, base, { input: 'Mouse' });
    await button(page, 'Begin').click();
    await waitStep(page, 'reading.comfort');
    await page.keyboard.press('Escape');
    const dialog = page.getByRole('dialog', { name: 'Paused' });
    await dialog.getByRole('button', { name: 'Save and finish later' }).click();
    await page
      .getByRole('heading', { level: 1, name: 'Finish whenever you like.' })
      .waitFor();
    await settle(page, 300);
    await shoot('tune-saved-for-later', 'default');
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .getByRole('heading', { level: 1, name: 'Pick up where you left off?' })
      .waitFor();
    await settle(page, 300);
    await shoot('tune-resume', 'default');
    await page.evaluate(() => localStorage.clear());
  });
  await context.close();
}

export async function captureTune(ctx) {
  await walk(ctx, { vp: 'desktop', theme: 'light' });
  await walk(ctx, { vp: 'mobile', theme: 'light' });
  await sideRoutes(ctx);
  ctx.rec.note(
    'Tune is walked signed out, so its last screen is "Keep your fit." (the fit waits in this browser). The signed-in end screen ("Your fit is saved") needs a full signed-in walk and is not captured; the signed-in "Tune again" intro is (tune-intro__recalibrate).',
  );
}
