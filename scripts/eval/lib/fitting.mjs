// The onboarding (docs/design/ONBOARDING.md), driven like a person at the eval viewport: a reader whose comfortable
// size is near 20 px, who sees faint words up to grey ~200, points with a spread of about 9 px, finds links and picks
// the calmer page. Every instruction card, step and the Results page is screenshotted on arrival and checked for what a
// person would miss (answers below the screen or covered, sideways scrolling).
// Hooks: `globalThis.__fitting` (phase(), raw(), finish(demoName)) and the `data-answer` attributes on every answer.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { shoot, sleep, slug } from './common.mjs';

/** Layout checks for the current screen: answers on the first screen and not covered, no sideways scroll. */
const SCREEN_SRC = () => {
  const vw = innerWidth;
  const vh = innerHeight;
  const below = [];
  const covered = [];
  for (const b of document.querySelectorAll('[data-answer]')) {
    if (b.closest('.mk')) continue;
    if (b.closest('[inert]')) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const name = (b.getAttribute('data-answer') || '').slice(0, 30);
    if (r.bottom > vh + 1) {
      below.push(name);
      continue;
    }
    if (r.bottom <= 0) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(vh - 1, r.top + r.height / 2));
    if (hit && !b.contains(hit)) covered.push(name);
  }
  return { vw, vh, docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight, below, covered };
};

const PHASE_SRC = () => globalThis.__fitting?.phase() ?? null;

/** Centre of the first element matching `sel`, or null. */
const centre = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);

/**
 * Drive the onboarding once and return { screens, errors, seconds }. `larger` presses the text-size + on Results that
 * many times (a person who wants text a step larger than measured). The fit the flow saved is left in storage.
 */
export async function runFitting({ context, extensionId, runDir, larger = 0, log = () => {} }) {
  const dir = path.join(runDir, 'fitting');
  mkdirSync(dir, { recursive: true });
  const out = { screens: [], errors: [], seconds: null };
  const page = await context.newPage();
  // run.mjs closes extension tabs it did not open; this one is ours.
  page.__webableEvalKeep = true;
  page.on('pageerror', (e) => out.errors.push(`page error: ${String(e?.message ?? e).split('\n')[0]}`));
  let n = 0;
  const shot = async (title, { scrolled = false } = {}) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${slug(title)}.png`;
    await shoot(page, path.join(dir, file));
    const m = await page.evaluate(SCREEN_SRC).catch(() => null);
    const problems = [];
    if (m) {
      if (m.docWidth > m.vw + 1) problems.push(`scrolls sideways (${m.docWidth - m.vw} px)`);
      if (!scrolled && m.below.length) problems.push(`below the first screen: ${m.below.join(', ')}`);
      if (m.covered.length) problems.push(`covered: ${m.covered.join(', ')}`);
    }
    out.screens.push({ title, file: `fitting/${file}`, ok: problems.length === 0, problems, notes: [], checks: m ? { docHeight: m.docHeight, vh: m.vh } : {} });
    log(`  ${problems.length ? '✗' : '✓'} ${title}${problems.length ? ` · ${problems.join('; ')}` : ''}`);
  };
  const click = (sel) => page.click(sel, { timeout: 4000 });
  const has = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);
  try {
    await page.goto(`chrome-extension://${extensionId}/fitting.html`, { waitUntil: 'load' });
    await sleep(900);
    await shot('Welcome');
    const t0 = Date.now();
    await page.mouse.move(700, 500);
    await click('[data-answer="start"]');
    await sleep(500);
    const seen = new Set();
    let sizeTaps = 0;
    for (let guard = 0; guard < 600; guard++) {
      const phase = await page.evaluate(PHASE_SRC);
      if (!phase || phase === 'results') break;
      if (phase === 'closing' || phase === 'boot') {
        await sleep(300);
        continue;
      }
      const [kind, step] = phase.split(':');
      if (kind === 'intro') {
        if (!seen.has(phase)) {
          seen.add(phase);
          await sleep(400);
          await shot(`Card · ${step}`);
        }
        await sleep(300);
        await click('[data-answer="start-step"]');
        await sleep(250);
        continue;
      }
      if (!seen.has(phase)) {
        seen.add(phase);
        await sleep(400);
        await shot(`Step · ${step}`);
      }
      if (step === 'size') {
        // Larger until the paragraph is about 20 px, then "This is comfortable".
        const px = await page.evaluate(() => Number(document.querySelector('.fl-para')?.getAttribute('data-px') ?? 0));
        if (px && px < 20 && sizeTaps < 8) {
          sizeTaps += 1;
          await sleep(500);
          await click('[data-answer="larger"]');
          continue;
        }
        await sleep(700);
        await click('[data-answer="comfortable"]');
        await sleep(200);
      } else if (step === 'truefalse' || step === 'lightdark') {
        const info = await page.evaluate(() => {
          const el = document.querySelector('.fl-sentence');
          return el ? { truth: el.getAttribute('data-truth'), px: Number(el.getAttribute('data-px') || 20) } : null;
        });
        if (!info) {
          // Light or dark: the closing question.
          if (await has('[data-answer="light"]')) {
            await sleep(800);
            await click('[data-answer="light"]');
            await sleep(200);
          } else await sleep(200);
          continue;
        }
        let wait = 1900;
        let ans = info.truth;
        if (step === 'truefalse' && info.px < 12) ans = 'cant';
        else if (info.px < 20) wait = Math.min(9000, 1900 * 10 ** (2.5 * (Math.log10(20) - Math.log10(info.px))) + 300);
        await sleep(wait);
        await click(`.fl-actions [data-answer="${ans}"]`);
        await sleep(150);
      } else if (step === 'faint') {
        const word = await page.evaluate(() => {
          const el = document.querySelector('.fl-word');
          if (!el) return null;
          const w = el.getAttribute('data-word');
          const btn = [...document.querySelectorAll('.fl-words [data-answer]')].find((b) => b.querySelector(`[data-word="${w}"]`));
          return { id: btn?.getAttribute('data-answer') ?? null, g: getComputedStyle(el).color };
        });
        if (!word) {
          await sleep(200);
          continue;
        }
        const gray = Number(/(\d+)/.exec(word.g)?.[1] ?? 0);
        await sleep(900);
        await click(gray <= 200 && word.id ? `.fl-words [data-answer="${word.id}"]` : '[data-answer="none"]');
        await sleep(150);
      } else if (step === 'dots') {
        const dot = await centre(page, '.fl-dot.is-lit');
        if (!dot) {
          await sleep(200);
          continue;
        }
        await sleep(450);
        const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 12;
        await page.mouse.move(dot.x + g(), dot.y + g(), { steps: 4 });
        await page.mouse.down();
        await sleep(80);
        await page.mouse.up();
        await sleep(150);
      } else if (step === 'find') {
        if (await has('[data-answer="first"]')) {
          await sleep(1200);
          const calm = await page.evaluate(() => document.querySelector('.fl-thumbs')?.getAttribute('data-calm'));
          await click(`[data-answer="${calm ?? 'same'}"]`);
          await sleep(300);
          continue;
        }
        if (await has('[data-answer="done-find"]')) {
          await sleep(600);
          await click('[data-answer="too much on the page"]');
          await sleep(300);
          await shot('Find · got in the way');
          await click('[data-answer="done-find"]');
          await sleep(300);
          continue;
        }
        const f = await page.evaluate(() => {
          const s = document.querySelector('.fl-stage[data-target]');
          return s ? { t: s.getAttribute('data-target'), trial: s.getAttribute('data-trial') } : null;
        });
        if (!f?.t) {
          await sleep(200);
          continue;
        }
        if (!seen.has(`find-${f.trial}`)) {
          seen.add(`find-${f.trial}`);
          await sleep(600);
          if (f.trial === '2') await shot(`Find · trial ${f.trial}`);
        }
        await sleep(1500);
        const r = await page.evaluate((t) => {
          const a = [...document.querySelectorAll('.fl-stage .mk-link')].find((x) => x.querySelector('.mk-label')?.textContent === t);
          if (!a) return null;
          a.scrollIntoView({ block: 'nearest' });
          const q = a.getBoundingClientRect();
          return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
        }, f.t);
        if (r) await page.mouse.click(r.x, r.y);
        else out.errors.push(`Find: "${f.t}" not on the page`);
        await sleep(400);
      } else {
        await sleep(200);
      }
    }
    await page.waitForFunction(() => globalThis.__fitting?.phase() === 'results', null, { timeout: 8000 }).catch(() => out.errors.push('never reached Results'));
    await sleep(900);
    out.seconds = Math.round((Date.now() - t0) / 1000);
    await shot('Results', { scrolled: true });
    for (let i = 0; i < larger; i++) {
      // The Results page is another part's; find its text-size + by its accessible name.
      const ok = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /larger|bigger|increase/i.test(`${x.getAttribute('aria-label') ?? ''} ${x.textContent ?? ''}`) && !x.disabled);
        b?.click();
        return !!b;
      });
      if (!ok) {
        out.errors.push('no text-size + on Results');
        break;
      }
      await sleep(300);
    }
    if (larger) await shot(`Results · larger ×${larger}`, { scrolled: true });
    // The measured fit stays saved for run.mjs; the demo path below saves Rosa, so keep the measured one aside.
    const measured = await page.evaluate(async () => (await chrome.storage.local.get('fit')).fit ?? null).catch(() => null);
    // The settings view, as the WebAble sheet opens it.
    await page.goto(`chrome-extension://${extensionId}/fitting.html#settings`, { waitUntil: 'load' });
    await sleep(900);
    await shot('Settings view', { scrolled: true });
    // The way a presenter shows it: Rosa's demo fit straight to Results through the hook.
    await page.goto(`chrome-extension://${extensionId}/fitting.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!globalThis.__fitting, null, { timeout: 5000 });
    await page.evaluate(() => globalThis.__fitting.finish('rosa'));
    await sleep(900);
    await shot('Results · Rosa demo', { scrolled: true });
    if (measured) await page.evaluate(async (fit) => chrome.storage.local.set({ fit }), measured);
  } catch (e) {
    out.errors.push(`onboarding: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`);
    await shot('Where it stopped').catch(() => {});
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}
