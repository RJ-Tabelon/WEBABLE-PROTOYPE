import { expect, test } from '@playwright/test';

import {
  pageContextSchema,
  regionEvidenceSchema,
} from '@webable/core/page/types';

import { FIXTURES, open, PRIVATE_STRINGS, regionKeys } from './helpers';

test.describe('extraction', () => {
  test('partial walks retain native measurements of covered content and update reused nodes', async ({
    page,
  }) => {
    await open(page, 'large');
    const full = await page.evaluate(() =>
      window.__webableEngine.extractLimited(6000),
    );
    expect(full.perf.truncated).toBe(false);
    await page.addStyleTag({ content: 'main p { font-size: 24px; }' });
    const partial = await page.evaluate(() =>
      window.__webableEngine.extractLimited(12),
    );
    expect(partial.perf.truncated).toBe(true);
    expect(partial.signals.text.totalChars).toBe(full.signals.text.totalChars);
    expect(partial.signals.text.mainFontPx).toBe(24);
    expect(partial.signals.targets.count).toBe(full.signals.targets.count);
    await page
      .locator('main p')
      .first()
      .evaluate((p) => p.remove());
    const removed = await page.evaluate(() =>
      window.__webableEngine.extractLimited(12),
    );
    expect(removed.signals.text.totalChars).toBeLessThan(
      partial.signals.text.totalChars,
    );
    expect(removed.signals.text.mainFontPx).toBe(24);
  });

  for (const fixture of FIXTURES) {
    test(`${fixture}: no page text, URL, title or form value in signals or evidence`, async ({
      page,
    }) => {
      await open(page, fixture);
      // The real VOCAB_V1 filter from @webable/core is what runs here.
      expect(
        await page.evaluate(() => window.__webableEngine.vocabSource),
      ).toBe('core');
      const x = await page.evaluate(() => window.__webableEngine.extract());
      const serialized = JSON.stringify({
        signals: x.signals,
        evidence: x.evidence,
      }).toLowerCase();
      for (const s of PRIVATE_STRINGS)
        expect(serialized, `leaked "${s}"`).not.toContain(s);
      // The only thing that can leave the device validates against the core schemas.
      expect(pageContextSchema.safeParse(x.evidence.page).success).toBe(true);
      for (const [key, ev] of Object.entries(x.evidence.regions)) {
        expect(key).toMatch(/^c[0-9a-z]+$/);
        expect(
          regionEvidenceSchema.safeParse(ev).success,
          `region ${key}`,
        ).toBe(true);
      }
      // Evidence strings are vocabulary words only.
      for (const ev of Object.values(x.evidence.regions)) {
        for (const w of ev.class_words) expect(w).toMatch(/^[a-z]{2,20}$/);
        expect(ev.heading_words).toMatch(/^[a-z· ]*$/);
      }
    });
  }

  test('article: text, contrast, line length, main content and rule roles', async ({
    page,
  }) => {
    await open(page, 'article');
    const {
      signals: s,
      evidence,
      perf,
    } = await page.evaluate(() => window.__webableEngine.extract());
    expect(s.category).toBe('article');
    expect(s.categoryConfidence).toBeGreaterThan(0.5);
    expect(s.text.mainFontPx).toBe(13);
    expect(s.text.mainLineHeight).toBeCloseTo(16 / 13, 1);
    expect(s.text.mainLineCh ?? 0).toBeGreaterThan(100);
    expect(s.contrast.below45).toBeGreaterThan(0);
    expect(s.main.key).not.toBeNull();
    expect(s.main.ambiguous).toBe(false);
    const roles = s.regions.map((r) => r.ruleRole);
    expect(roles).toContain('main_content');
    expect(roles).toContain('promo_ad');
    expect(roles).toContain('navigation');
    expect(evidence.page.signals).toEqual(
      expect.arrayContaining([
        'jsonld_article',
        'og_type_article',
        'readerable',
      ]),
    );
    // The related rail is not decided locally: it is page-analysis evidence.
    const rails = Object.values(evidence.regions).filter(
      (r) => r.zone === 'right_rail',
    );
    expect(rails.length).toBeGreaterThan(0);
    expect(rails[0]?.class_words).toEqual(expect.arrayContaining(['related']));
    expect(perf.busyMs).toBeLessThan(50);
  });

  test('store: targets, motion, pinned bars, hover menus, consent and chat', async ({
    page,
  }) => {
    await open(page, 'store');
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v !== null && !v.paused;
    });
    const { signals: s } = await page.evaluate(() =>
      window.__webableEngine.extract(),
    );
    expect(s.targets.crowded).toBeGreaterThan(0);
    expect(s.targets.below['24']).toBeGreaterThan(0);
    expect(s.targets.below['44']).toBeGreaterThanOrEqual(s.targets.below['24']);
    expect(s.motion.autoplayMedia).toBe(1);
    expect(s.motion.carousels).toBe(1);
    expect(s.motion.animatedImages).toBe(1);
    expect(s.motion.infinite).toBeGreaterThan(0);
    expect(s.sticky.bars).toBeGreaterThanOrEqual(1);
    expect(s.sticky.topBandPx).toBe(72);
    expect(s.hoverMenus).toBeGreaterThanOrEqual(1);
    const roles = s.regions.map((r) => r.ruleRole);
    expect(roles).toContain('consent_banner');
    expect(roles).toContain('chat_widget');
  });

  test('component keys are stable across reloads', async ({ page }) => {
    await open(page, 'article');
    const first = await regionKeys(page);
    await open(page, 'article');
    const second = await regionKeys(page);
    expect(second.map((r) => r.key).sort()).toEqual(
      first.map((r) => r.key).sort(),
    );
  });

  test('forms are counted, never read', async ({ page }) => {
    await open(page, 'article');
    const { signals } = await page.evaluate(() =>
      window.__webableEngine.extract(),
    );
    expect(signals.forms.count).toBe(1);
    expect(signals.forms.hasPassword).toBe(false);
    expect(JSON.stringify(signals)).not.toContain('example.com');
  });

  test('performance budget: extraction busy time on every fixture', async ({
    page,
  }) => {
    const rows: string[] = [];
    for (const fixture of FIXTURES) {
      await open(page, fixture);
      // First run warms caches (fonts, style); the budget applies to the steady state too.
      await page.evaluate(() => window.__webableEngine.extract());
      const { perf } = await page.evaluate(() =>
        window.__webableEngine.extract(),
      );
      rows.push(
        `${fixture}: busy ${perf.busyMs} ms, wall ${perf.wallMs} ms, ${perf.nodes} nodes`,
      );
      expect(perf.busyMs, fixture).toBeLessThan(30);
    }
    test.info().annotations.push({
      type: 'extract budget',
      description: rows.join('; '),
    });
    console.log(rows.join('\n'));
  });
});
