// The interactions run: one demo page driven like a presenter would, with a screenshot and checks per step.
//   panel → Jev Lens (card, sheet, plain rule) → Explain → struggle offer after near-misses → Calm view steps →
//   Confirm → Original page and back.
// Shortcuts first (Alt+Shift+W/L/C/O), with the round-1 keys and visible buttons as fallbacks, so the run works
// against either build. Never presses anything on a real site that could submit or buy: use it on demo pages.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { baseDpr, shoot, sleep, slug } from './common.mjs';
import { health as fetchHealth } from './server.mjs';
import { mainLabelFrom, measureView, summarizeCalm } from './firstscreen.mjs';
import { calmFacts, clickRect, pressKey, uiClick, uiFind, uiProbe, waitUi } from './ui.mjs';

const CALM_UI = ['.wa-calm', '[aria-label="Calm view"][role="dialog"]'];

export async function runInteract({ context, runDir, site, ext, health = null, struggleSeconds = 75, log = console.log }) {
  const dir = path.join(runDir, 'interact');
  mkdirSync(dir, { recursive: true });
  const out = { site: site.name, url: site.url, steps: [], errors: [], timings: {} };
  const page = await context.newPage();
  page.__webableEvalKeep = true;
  page.on('pageerror', (e) => out.errors.push(`page: ${String(e.message).split('\n')[0].slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location()?.url ?? '';
    if (where.startsWith('chrome-extension://') || /webable/i.test(m.text())) out.errors.push(`extension: ${m.text().slice(0, 200)}`);
  });
  let n = 0;
  let tabId = null;
  const report = async () => {
    try {
      const r = await ext.report(page.url(), tabId);
      if (r.tabId != null) tabId = r.tabId;
      return r.report;
    } catch {
      return null;
    }
  };
  const step = async (title, { checks = [], notes = [], facts = null } = {}) => {
    const file = `interact/${String(++n).padStart(2, '0')}-${slug(title).slice(0, 40)}.png`;
    await shoot(page, path.join(runDir, file)).catch((e) => out.errors.push(`screenshot: ${e.message.split('\n')[0]}`));
    const ok = checks.every((c) => c.ok !== false);
    const s = { title, file, checks, notes: notes.filter(Boolean), facts, ok };
    out.steps.push(s);
    const bad = checks.filter((c) => c.ok === false).map((c) => c.name);
    log(`  ${ok ? '✓' : '✗'} ${title}${bad.length ? ` · failed: ${bad.join(', ')}` : ''}`);
    return s;
  };
  const check = (name, ok, detail = '') => ({ name, ok: ok === null ? null : !!ok, detail });
  /** Page zoom (devicePixelRatio ÷ the run's --dpr). */
  const dpr = () => page.evaluate(() => devicePixelRatio).then((d) => d / baseDpr()).catch(() => 1);
  const fittedMarks = () =>
    page
      .evaluate(() => ({
        dpr: devicePixelRatio,
        marks: document.querySelectorAll('[data-wa-t],[data-wa-tm],[data-wa-dim],[data-wa-main],[data-wa-sp],[data-wa-w]').length,
      }))
      .catch(() => ({ dpr: 1, marks: 0 }));
  const waitPhase = async (pred, ms) => {
    const t0 = Date.now();
    let r = null;
    while (Date.now() - t0 < ms) {
      r = await report();
      if (r && pred(r)) return r;
      await sleep(300);
    }
    return r;
  };
  /**
   * Try each way in turn (a key combo, or an async function that clicks something) until `test` is true.
   * Returns { how, by } where `by` can be passed back to toggle() to undo with the same way, or null.
   */
  const toggle = async (ways, test, wait = 900) => {
    for (const w of ways) {
      if (typeof w === 'function') await w();
      else await pressKey(page, w);
      await sleep(wait);
      if (await test()) return { how: typeof w === 'function' ? (w.label ?? 'button') : w, by: w };
    }
    return null;
  };
  const labelled = (label, fn) => Object.assign(fn, { label });
  /** Close whatever WebAble surface is still open (explain card, panel, Lens), so the next step starts clean. */
  const tidy = async () => {
    for (let i = 0; i < 4; i++) {
      const p = await uiProbe(page);
      if (p.explain) {
        await pressKey(page, 'Escape');
        await sleep(300);
        if ((await uiProbe(page)).explain) await uiClick(page, ['.wa-ex button', '[data-wa-explain] button'], { re: 'Close' });
      } else if (p.lens) {
        await pressKey(page, 'Escape');
        await sleep(300);
        if ((await uiProbe(page)).lens) await uiClick(page, ['button'], { re: 'Close Jev Lens|Close the Lens|Close Lens' });
      } else if (p.panel) {
        if (!(await uiClick(page, ['button'], { re: '^Close panel' }))) await uiClick(page, ['.wa-pill', '[data-wa-pill]']);
      } else return;
      await sleep(500);
    }
  };

  try {
    /* 1. load, fitted */
    const t0 = Date.now();
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    let rep = await waitPhase((r) => ['understood', 'calm', 'error'].includes(r.phase), 15_000);
    out.timings.toUnderstoodMs = Date.now() - t0;
    await sleep(1500);
    rep = await report();
    const mainLabel = mainLabelFrom(rep);
    out.mainLabel = mainLabel;
    if (rep?.phase === 'calm') {
      const f = summarizeCalm(await calmFacts(page, mainLabel));
      await step('Calm view opened by itself', {
        facts: f,
        checks: [
          check('Heading near the top', f.h1Ok, `h1 top ${f.h1Top ?? '—'} px (≤ 140)`),
          check(
            'Task on the first screen',
            f.taskOk,
            f.task ? `${f.task.kind} “${f.task.text}” ${f.task.top}–${f.task.bottom} px` : 'none found',
          ),
          check('At most one filled button', f.filledOk, (f.filled ?? []).join(', ') || 'none'),
        ],
      });
      await pressKey(page, 'Alt+Shift+KeyC');
      await waitPhase((r) => r.phase !== 'calm', 4000);
      await sleep(600);
    }
    const fitted = await fittedMarks();
    const after = await measureView(page, 'after', { mainLabel });
    await step('Fitted page', {
      facts: after,
      checks: [
        check(
          'Main action not covered',
          after.page?.main ? (after.page.main.coveredBy ? false : after.page.main.inView ? true : null) : null,
          after.page?.main
            ? `“${after.page.main.label}” ${after.page.main.top}–${after.page.main.bottom} px${after.page.main.coveredBy ? `, under ${after.page.main.coveredBy}` : after.page.main.below ? ' (below the first screen)' : ''}`
            : 'no main action marked',
        ),
        check('Pill clear of page controls', !after.page?.pillOver?.length, after.page?.pillOver?.join(', ') || 'clear'),
      ],
      notes: [`Page overlays cover ${after.page?.overlayPct ?? '—'}% · WebAble ${after.page?.webablePct ?? '—'}%`],
    });

    /* 2. panel */
    const panelBy = await toggle(
      ['Alt+Shift+KeyW', labelled('the pill', async () => void (await uiClick(page, ['.wa-pill', '[data-wa-pill]'])))],
      async () => (await uiProbe(page)).panel,
      800,
    );
    let probe = await uiProbe(page);
    // AI availability right now (the server marks it off for 10 minutes after a quota error, then retries).
    const live = (await fetchHealth()) ?? health;
    const aiNow = live ? (typeof live.ai === 'string' ? live.ai : live.openai === false ? 'off' : 'on') : null;
    await step('Panel', {
      facts: { openedWith: panelBy?.how ?? null, text: probe.panelText?.slice(0, 1200) ?? null },
      checks: [
        check('Panel opens', probe.panel, panelBy ? `with ${panelBy.how}` : 'neither Alt+Shift+W nor the pill opened it'),
        check(
          'AI line matches the server',
          probe.panelText && aiNow ? /AI layouts? (are )?off|no credits/i.test(probe.panelText) === (aiNow !== 'on') : null,
          aiNow ? `server reports AI ${aiNow}` : 'server health unknown',
        ),
        check('Lists the shortcuts', probe.panelText ? /Alt\s*\+\s*Shift|⌥⇧/i.test(probe.panelText) : null, ''),
      ],
    });

    /* 3. Lens: on from the open panel; it should close the panel */
    const lensBy = await toggle(['Alt+Shift+KeyL', 'Alt+KeyJ'], async () => (await uiProbe(page)).lens, 1300);
    await page.mouse.move(-20, -20);
    await sleep(500);
    const lens = await measureView(page, 'lens', { mainLabel });
    probe = await uiProbe(page);
    await step('Jev Lens', {
      facts: lens,
      checks: [
        check('Lens turns on', !!lensBy, lensBy ? `with ${lensBy.how}` : 'no shortcut turned it on'),
        check('Panel closes for the Lens', !probe.panel, probe.panel ? 'panel still open' : 'closed'),
        check(
          'Chips never overlap',
          lens.lens ? lens.lens.overlapping.length === 0 : null,
          lens.lens ? `${lens.lens.chips} chips, ${lens.lens.overlapping.length} overlapping` : '',
        ),
        check(
          'No “Today” pill in the header',
          lens.lens?.head ? !/Today/i.test(lens.lens.head) : null,
          (lens.lens?.head ?? '').slice(0, 160),
        ),
      ],
    });
    if (lensBy) {
      // Hover card over the main action.
      const m = await page.evaluate(() => {
        const el = document.querySelector('[data-wa-main]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, dpr: devicePixelRatio };
      });
      const vh = await page.evaluate(() => innerHeight).catch(() => 720);
      if (m && m.y >= 0 && m.y + m.h < vh) {
        await page.mouse.move(m.x + m.w / 2, m.y + m.h / 2, { steps: 6 });
        await sleep(700);
        await step('Lens · card on the main action', { notes: ['pointer over the main action'] });
      }
      const sheet = await uiClick(page, ['button', '[role="button"]'], { re: '\\d+ elements|elements\\s*▸|All elements' });
      if (sheet) {
        await sleep(700);
        await step('Lens · side sheet', { notes: [sheet.text] });
      }
      const rule = await uiClick(page, ['button', '[role="button"]'], { re: 'plain rule' });
      if (rule) {
        await sleep(700);
        await step('Lens · vs plain rule', { notes: [rule.text] });
      }
      await toggle([lensBy.by, 'Escape'], async () => !(await uiProbe(page)).lens, 700);
    }

    /* 4. Explain a paragraph */
    await tidy();
    await page.mouse.click(4, 360).catch(() => {});
    const para = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('main p, article p, p')].filter((p) => (p.textContent || '').split(/\s+/).length >= 25);
      const p = ps.find((x) => x.getBoundingClientRect().height > 10) ?? null;
      if (!p) return null;
      p.scrollIntoView({ block: 'center' });
      return true;
    });
    if (para) {
      await sleep(500);
      const r = await page.evaluate(() => {
        const ps = [...document.querySelectorAll('main p, article p, p')].filter((p) => (p.textContent || '').split(/\s+/).length >= 25);
        const p = ps.find((x) => x.getBoundingClientRect().height > 10);
        const b = p.getBoundingClientRect();
        return { x: b.left, y: b.top, dpr: devicePixelRatio };
      });
      await page.mouse.click(r.x + 24, r.y + 8, { clickCount: 3 });
      await sleep(800);
      const aff = await waitUi(page, ['.wa-ex-pill', 'button'], { re: '^\\W*Explain' }, 3000);
      if (aff) {
        const tE = Date.now();
        await clickRect(page, aff);
        let ex = null;
        for (let i = 0; i < 60; i++) {
          ex = (await uiProbe(page)).explain;
          if (ex && !ex.loading && ex.t.length > 20) break;
          await sleep(300);
        }
        out.timings.explainMs = Date.now() - tE;
        const t = ex?.t ?? '';
        const unavailable = /couldn.t write|right now|unavailable/i.test(t);
        await step('Explain', {
          facts: { text: t.slice(0, 600), ms: out.timings.explainMs },
          checks: [
            check('Card appears', !!ex, ex ? `${out.timings.explainMs} ms` : 'no card'),
            (() => {
              const covs = [...t.matchAll(/covered\s*(\d\.\d+)/gi)].map((m) => Number(m[1]));
              const allZero = covs.length >= 2 && covs.every((c) => c === 0);
              return check(
                'Coverage only when Jev answered',
                unavailable ? covs.length === 0 : !allZero,
                unavailable
                  ? 'AI unavailable: the original only, no numbers'
                  : allZero
                    ? `every sentence “covered 0.00” (${covs.length})`
                    : `${covs.length} coverage numbers`,
              );
            })(),
          ],
        });
        await tidy();
      } else {
        await step('Explain', { checks: [check('Explain button beside the selection', false, 'not shown after a triple-click')] });
      }
      await page.mouse.click(4, 360).catch(() => {});
    }

    /* 5. Struggle: near-misses beside small controls, then the corrective click, until an offer shows */
    await tidy();
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
    const tS = Date.now();
    let rounds = 0;
    let offer = null;
    const pickTargets = () =>
      page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('input[type=checkbox]:not([disabled]), input[type=radio]:not([disabled])')) {
          if (el.closest('webable-ui')) continue;
          out.push(el.id ? `#${CSS.escape(el.id)}` : null);
        }
        return out.filter(Boolean).slice(0, 8);
      });
    const targets = await pickTargets();
    while (targets.length && Date.now() - tS < struggleSeconds * 1000 && !offer) {
      const sel = targets[rounds % targets.length];
      await page.evaluate((s) => {
        const el = document.querySelector(s);
        const r = el?.getBoundingClientRect();
        if (r && (r.top < 90 || r.bottom > innerHeight - 90)) el.scrollIntoView({ block: 'center' });
      }, sel);
      await sleep(250);
      const t = await page.evaluate((s) => {
        const b = document.querySelector(s).getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height, dpr: devicePixelRatio };
      }, sel);
      // A press 18 px left of the control, then the corrective press on it 0.6 s later (a near-miss).
      await page.mouse.move(t.x - 18, t.y + t.h / 2, { steps: 5 });
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
      await sleep(600);
      await page.mouse.move(t.x + t.w / 2, t.y + t.h / 2, { steps: 5 });
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
      rounds++;
      await sleep(rounds % 3 === 0 ? 3200 : 1100);
      const p = await uiProbe(page);
      if (p.offer) offer = p.offer;
    }
    out.timings.struggleRounds = rounds;
    out.timings.offerAfterMs = offer ? Date.now() - tS : null;
    rep = await report();
    if (offer) {
      const vh = (await page.evaluate(() => innerHeight).catch(() => 720)) || 720;
      const fits = (o) => o && o.y >= 0 && o.y + o.h <= vh + 1;
      await step('Offer after near-misses', {
        facts: { text: offer.t, rounds, ms: out.timings.offerAfterMs },
        checks: [
          check('Offer card fits the screen', fits(offer), `${Math.round(offer.y)}–${Math.round(offer.y + offer.h)} of ${vh} CSS px`),
        ],
      });
      const chip = await uiFind(page, ['.wa-offer-chip']);
      if (chip) {
        await clickRect(page, chip);
        await sleep(500);
      }
      const why = await uiClick(page, ['.wa-offer button', '.wa-offer a', '[data-wa-offer] button'], { re: 'Why' });
      if (why) {
        await sleep(600);
        const o2 = (await uiProbe(page)).offer;
        const repeats = o2
          ? (() => {
              const sentences = o2.t.split(/(?<=[.?!])\s+/).filter((x) => x.length > 30);
              return sentences.length !== new Set(sentences).size;
            })()
          : null;
        await step('Offer · Why this?', {
          facts: { text: o2?.t ?? null },
          checks: [
            check('Still fits the screen', fits(o2), o2 ? `${Math.round(o2.y)}–${Math.round(o2.y + o2.h)} of ${vh}` : ''),
            check('No repeated paragraph', repeats === null ? null : !repeats, ''),
          ],
        });
      }
      const yes = await uiClick(page, ['.wa-offer .wa-btn-primary', '.wa-offer button', '[data-wa-offer] button'], {
        re: '^(?!Not now|Why|Don)',
      });
      if (yes) {
        await sleep(350);
        const outlined = await page
          .evaluate(() => document.querySelectorAll('[class*="wa-flash"], [data-wa-flash], [data-wa-outline]').length)
          .catch(() => 0);
        await step('Offer accepted', {
          notes: [`pressed “${yes.text}”`, outlined ? `${outlined} outlined for a moment` : null],
          facts: { toasts: (await uiProbe(page)).toasts },
        });
        const undo = await uiClick(page, ['.wa-toast-undo', '.wa-toast button'], { re: 'Undo' });
        if (undo) await sleep(800);
      }
    } else {
      const s = rep?.struggle;
      await step('No offer after near-misses', {
        notes: [
          `${rounds} near-misses in ${Math.round((Date.now() - tS) / 1000)} s`,
          s ? `Jev: level ${s.level ?? '—'}` : 'no struggle judgment yet',
        ],
        facts: { struggle: s ?? null },
      });
    }

    /* 6. Calm view, step by step */
    await tidy();
    // An accepted offer may already have opened it (the report can lag the screen, so ask the UI too).
    const calmOpen = async () => (await uiProbe(page)).calm || (await report())?.phase === 'calm';
    const calmBy = (await calmOpen())
      ? { how: 'the accepted offer', by: null }
      : await toggle(
          [
            'Alt+Shift+KeyC',
            labelled(
              'the panel button',
              async () => void (await uiClick(page, ['.wa-panel button', 'button'], { re: '^Calm view|Open Calm view' })),
            ),
          ],
          calmOpen,
          1500,
        );
    await waitUi(page, CALM_UI, {}, 6000);
    await sleep(700);
    let cf = summarizeCalm(await calmFacts(page, mainLabel));
    await step('Calm view', {
      facts: cf,
      checks: [
        check('Opens', !!calmBy && cf.open, calmBy ? `with ${calmBy.how}` : 'did not open'),
        check('Heading near the top', cf.h1Ok, `h1 top ${cf.h1Top ?? '—'} px (≤ 140)`),
        check(
          'Task on the first screen',
          cf.taskOk,
          cf.task ? `${cf.task.kind} “${cf.task.text}” ${cf.task.top}–${cf.task.bottom} px` : 'none found',
        ),
        check('At most one filled button', cf.filledOk, (cf.filled ?? []).join(', ') || 'none'),
        check('No chat controls inside', cf.text ? !/Minimi[sz]e chat|Send message/i.test(cf.text) : null, ''),
      ],
    });
    // Stay still so a better layout can swap in.
    await sleep(7500);
    rep = await report();
    cf = summarizeCalm(await calmFacts(page, mainLabel));
    await step('Calm view · after 8 s', {
      facts: { redesign: rep?.redesign ?? null },
      notes: [rep?.redesign ? `layout: ${rep.redesign.chosen}${rep.redesign.autoApply ? ' (applied)' : ''}` : 'no layout result'],
    });

    const isConfirm = /Confirm|Submit|Place order|Send/i;
    for (let k = 0; k < 6; k++) {
      cf = summarizeCalm(await calmFacts(page, mainLabel));
      if ((cf.dockButtons ?? []).some((b) => isConfirm.test(b.t) && !b.disabled)) break;
      const next =
        (await uiFind(page, ['.wa-dock button', '.wa-stepnav button', ...CALM_UI.map((c) => `${c} button`)], {
          re: '^\\s*(Continue|Next)\\b',
          enabled: true,
        })) ?? null;
      if (!next) break;
      await clickRect(page, next);
      await sleep(900);
      cf = summarizeCalm(await calmFacts(page, mainLabel));
      const m = /Step (\d+) of (\d+)/.exec(cf.stepText ?? '');
      const early = m ? Number(m[1]) < Number(m[2]) : null;
      const docked = (cf.dockButtons ?? []).some((b) => isConfirm.test(b.t) && !b.disabled);
      await step(`Calm view · ${cf.stepText ?? `step ${k + 2}`}`, {
        facts: { stepText: cf.stepText, dock: cf.dockText },
        checks: [check('No Confirm in the dock before the last step', early === null ? null : !(early && docked), cf.dockText ?? '')],
      });
    }

    /* 7. Confirm */
    const confirm = await uiFind(page, ['.wa-dock button', ...CALM_UI.map((c) => `${c} button`)], {
      re: 'Confirm refill|^\\s*Confirm|Submit',
      enabled: true,
    });
    if (confirm) {
      await clickRect(page, confirm);
      await sleep(900);
      // Some builds ask for a second press before they press the page's own submit.
      const again = summarizeCalm(await calmFacts(page, mainLabel));
      if (/press again|again to confirm/i.test(again.dockText ?? '')) {
        const c2 = await uiFind(page, ['.wa-dock button', ...CALM_UI.map((c) => `${c} button`)], {
          re: 'Confirm refill|^\\s*Confirm|Submit',
          enabled: true,
        });
        if (c2) await clickRect(page, c2);
      }
      await sleep(1600);
      cf = summarizeCalm(await calmFacts(page, mainLabel));
      const pageDone = await page.evaluate(() => {
        const box = document.querySelector('[data-confirmed], [role=status]');
        return !!box && !box.hidden && box.getBoundingClientRect().height > 0
          ? (box.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
          : null;
      });
      const dockDone = (cf.dockButtons ?? []).find((b) => /requested|✓|done|sent/i.test(b.t));
      await step('Calm view · confirmed', {
        facts: { page: pageDone, dock: cf.dockText },
        checks: [
          check('The page took the request', !!pageDone, pageDone ?? 'no confirmation on the page'),
          check('Dock says it is done', dockDone ? dockDone.disabled : false, cf.dockText ?? 'no dock'),
          check('Shows the page’s confirmation heading', cf.text ? /Refill requested|confirmed|thank you/i.test(cf.text) : null, ''),
        ],
      });
    } else {
      await step('Calm view · no Confirm found', { checks: [check('Confirm reachable', false, 'no Confirm button in the Calm view')] });
    }

    /* 8. Original page and back */
    const isOriginal = async () => {
      const m = await fittedMarks();
      return m.marks <= 2 && (await report())?.phase !== 'calm';
    };
    const origBy = await toggle(
      [
        'Alt+Shift+KeyO',
        'Alt+Shift+KeyF',
        labelled(
          'the Original page button',
          async () => void (await uiClick(page, ['.wa-strip button', 'button'], { re: '^Original page' })),
        ),
      ],
      isOriginal,
      1500,
    );
    await step('Original page', {
      facts: await fittedMarks(),
      checks: [check('One step shows the original', !!origBy, origBy ? `with ${origBy.how}` : `zoom ${await dpr()}`)],
    });
    if (origBy) {
      const backWays = typeof origBy.by === 'string' ? [origBy.by] : [];
      backWays.push(labelled('Back to fitted', async () => void (await uiClick(page, ['button'], { re: 'Back to fitted|Fitted page' }))));
      // Back means the fitted page, or the Calm view if that was open before (it has its own sizes, zoom 100%).
      const backOk = async () => {
        const m = await fittedMarks();
        const calm = (await report())?.phase === 'calm';
        return { ok: m.marks > 0 && (calm || m.dpr === fitted.dpr), m, calm };
      };
      await toggle(backWays, async () => (await backOk()).ok, 1800);
      await sleep(600);
      const back = await backOk();
      await step('Back to fitted', {
        facts: { ...back.m, calm: back.calm },
        checks: [check('Fit comes back', back.ok, `${back.calm ? 'Calm view again · ' : ''}zoom ${back.m.dpr / baseDpr()}, ${back.m.marks} marks`)],
      });
    }
  } catch (e) {
    out.errors.push(`interact: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`);
    await step('Where it stopped').catch(() => {});
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}
