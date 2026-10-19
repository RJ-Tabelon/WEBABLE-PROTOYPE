import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FitLayout } from '@webable/core';
import { FIT_SOLVER_VERSION } from '@webable/core/versions';
import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  displayStack,
  fontStack,
  X_HEIGHT_ADJUST,
} from './fonts';
import { checkTiers, distinguishable } from './health';
import {
  emphasisWeight,
  fitViewCss,
  FV_PALETTES,
  headingLeading,
  NUDGE_LIMIT,
  NUDGE_RATIO,
  nudgeLayout,
  paletteTokens,
} from './styles';

const here = dirname(fileURLToPath(import.meta.url));

/** A layout like the solver's at F = 18, T = 44 (docs/12 §4.2). */
export function layout(over: Partial<FitLayout> = {}): FitLayout {
  return {
    v: 1,
    version: FIT_SOLVER_VERSION,
    type: {
      pageHeading: { px: 30, weight: 600, cue: 'none' },
      sectionHeading: { px: 25, weight: 600, cue: 'none' },
      title: { px: 21.5, weight: 600, cue: 'none' },
      body: { px: 18, weight: 400, cue: 'none' },
      meta: { px: 15.5, weight: 400, cue: 'none' },
      lineHeight: 1.5,
      wordSpacingEm: 0.04,
      letterSpacingEm: 0,
      maxLineCh: 66,
      minLineCh: 13,
      font: 'system',
    },
    target: { minPx: 44, gapPx: 9, controlPx: 44 },
    space: {
      unitPx: 14,
      groupGapPx: 35,
      sectionGapPx: 42,
      cardPadPx: 14,
      pagePadPx: 16,
      maxContentPx: 1200,
    },
    grid: {
      card_media: { minWidthPx: 226, maxCols: 4 },
      card_text: { minWidthPx: 288, maxCols: 3 },
      row: { minWidthPx: 0, maxCols: 1 },
    },
    groupEvery: 6,
    structure: {
      level: 0,
      listFirst: null,
      groupEvery: 6,
      splitSentences: null,
      outline: false,
      sectionsOpen: null,
    },
    nav: { inlineMax: 8 },
    tertiary: 'collapsed',
    palette: { scheme: 'light', contrast: 'standard' },
    motion: 'allow',
    ...over,
  };
}

/** Relative luminance (WCAG 2.x) of #RRGGBB. */
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe('Fit view palette (docs/12 §4.1)', () => {
  it('shares only the fern accent with packages/tokens', () => {
    const css = readFileSync(
      join(
        here,
        '..',
        '..',
        '..',
        '..',
        '..',
        'packages',
        'tokens',
        'src',
        'tokens.css',
      ),
      'utf8',
    );
    const accent = (start: RegExp): string => {
      const m = start.exec(css);
      if (!m) throw new Error(`block not found: ${start}`);
      const from = m.index + m[0].length;
      const end = /\n\s*\}/.exec(css.slice(from));
      const body = css.slice(from, from + (end?.index ?? 0));
      const v = /--accent:\s*([^;]+);/i.exec(body)?.[1] ?? '';
      return v.trim().toUpperCase();
    };
    expect(accent(/^:root \{/m)).toBe(FV_PALETTES.light['--accent']);
    expect(
      accent(
        /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme=["']light["']\]\) \{/,
      ),
    ).toBe(FV_PALETTES.dark['--accent']);
  });

  it('is the Showroom palette: grey canvas, white cards, one blue for actions', () => {
    const light = paletteTokens({ scheme: 'light', contrast: 'standard' });
    expect(light['--canvas']).toBe('#F5F5F7');
    expect(light['--surface-raised']).toBe('#FFFFFF');
    expect(light['--ink']).toBe('#1D1D1F');
    expect(light['--action']).toBe('#0071E3');
    expect(light['--link']).toBe('#0066CC');
    expect(light['--shadow-card']).toContain('rgba(0, 0, 0, 0.06)');
    const dark = paletteTokens({ scheme: 'dark', contrast: 'standard' });
    expect(dark['--canvas']).toBe('#000000');
    expect(dark['--surface-raised']).toBe('#1C1C1E');
    expect(dark['--ink']).toBe('#F5F5F7');
    expect(dark['--shadow-card']).toBe('none');
  });

  it('keeps text and controls readable on every surface', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const contrast of ['standard', 'more', 'max'] as const) {
        const p = paletteTokens({ scheme, contrast });
        const at = `${scheme}/${contrast}`;
        const surfaces = ['--canvas', '--surface-raised', '--surface-tonal'];
        for (const bg of surfaces) {
          const b = p[bg] as string;
          expect(
            ratio(p['--ink'] as string, b),
            `${at} ink ${bg}`,
          ).toBeGreaterThanOrEqual(7);
          expect(
            ratio(p['--ink-2'] as string, b),
            `${at} ink-2 ${bg}`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            ratio(p['--link'] as string, b),
            `${at} link ${bg}`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            ratio(p['--accent'] as string, b),
            `${at} accent ${bg}`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            ratio(p['--focus'] as string, b),
            `${at} focus ${bg}`,
          ).toBeGreaterThanOrEqual(3);
        }
        expect(
          ratio(p['--on-action'] as string, p['--action'] as string),
          `${at} on-action`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          ratio(p['--on-accent'] as string, p['--accent'] as string),
          `${at} on-accent`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          ratio(p['--badge'] as string, p['--surface-raised'] as string),
          `${at} badge`,
        ).toBeGreaterThanOrEqual(4.5);
        // Selected chips: canvas text on an ink fill.
        expect(
          ratio(p['--canvas'] as string, p['--ink'] as string),
          `${at} chip`,
        ).toBeGreaterThanOrEqual(7);
        if (contrast !== 'standard')
          expect(
            ratio(p['--link'] as string, p['--surface-raised'] as string),
            `${at} link 7`,
          ).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('more contrast drops secondary ink and hairlines; max is ink on paper without shadows', () => {
    const more = paletteTokens({ scheme: 'light', contrast: 'more' });
    expect(more['--ink-2']).toBe(FV_PALETTES.light['--ink']);
    expect(more['--line']).toBe(FV_PALETTES.light['--line-strong']);
    expect(more['--link']).toBe('#0040DD');
    expect(
      paletteTokens({ scheme: 'dark', contrast: 'more' })['--on-action'],
    ).toBe('#000000');
    const max = paletteTokens({ scheme: 'dark', contrast: 'max' });
    expect(max['--canvas']).toBe('#000000');
    expect(max['--ink']).toBe('#FFFFFF');
    expect(max['--link']).toBe('#6CB4FF');
    expect(max['--shadow-card']).toBe('none');
    expect(max['--shadow-float']).toBe('none');
    const maxLight = paletteTokens({ scheme: 'light', contrast: 'max' });
    expect(maxLight['--canvas']).toBe('#FFFFFF');
    expect(maxLight['--surface-tonal']).toBe('#F0F0F0');
    expect(maxLight['--badge']).toBe('#8A2E00');
  });

  it('draws shadow lengths with the sheet px (zoom-divided)', () => {
    const p = paletteTokens(
      { scheme: 'light', contrast: 'standard' },
      (n) => `${n / 2}px`,
    );
    expect(p['--shadow-float']).toBe('0px 6px 20px rgba(0, 0, 0, 0.16)');
  });
});

describe('Fit view sheet', () => {
  it('draws every size at px / zoom', () => {
    const css = fitViewCss(layout(), 1.5);
    expect(css).toContain('.t-body { font-size: 12px;');
    expect(css).toContain('.t-page { font-size: 20px;');
    expect(css).toContain('--fv-min: 29.333px;');
    expect(fitViewCss(layout(), 1)).toContain('--fv-min: 44px;');
    // A nonsense zoom never divides by zero.
    expect(fitViewCss(layout(), 0)).toContain('.t-body { font-size: 18px;');
  });

  it('matches Tune: the system face (or Atkinson), font-size-adjust on every face', () => {
    const css = fitViewCss(layout(), 1);
    expect(css).toContain(`font-size-adjust: ex-height ${X_HEIGHT_ADJUST};`);
    expect(css).toContain(`font-family: ${fontStack('system')};`);
    expect(fontStack('system')).toMatch(/^-apple-system, BlinkMacSystemFont/);
    expect(fontStack('system')).not.toContain('WebAble');
    expect(displayStack('system')).toMatch(/^"SF Pro Display"/);
    expect(fontStack('atkinson')).toMatch(/^"WebAble Fit Sans"/);
    const atk = layout();
    atk.type = { ...atk.type, font: 'atkinson' };
    expect(fitViewCss(atk, 1)).toContain(
      `font-size-adjust: ex-height ${X_HEIGHT_ADJUST};`,
    );
  });

  it('leads with size: headings 600, body 400, controls 500, tracking only at 0 spacing', () => {
    const css = fitViewCss(layout(), 1);
    expect(css).toMatch(
      /\.t-page \{ font-size: 30px; font-weight: 600; line-height: 1\.08; letter-spacing: -0\.022em;/,
    );
    expect(css).toMatch(
      /\.t-section \{ font-size: 25px; font-weight: 600; line-height: 1\.14; letter-spacing: -0\.016em;/,
    );
    expect(css).toMatch(
      /\.t-body \{ font-size: 18px; font-weight: 400; line-height: 1\.5; \}/,
    );
    expect(emphasisWeight(layout())).toBe(500);
    expect(css).toMatch(
      /\.fv-btn, \.fv-pill, \.fv-wa \{[^}]*font-weight: 500;/,
    );
    expect(css).not.toMatch(/font-weight: 700/);
    // A long page title is drawn at the section size.
    expect(css).toContain('.t-page.t-page--long { font-size: 25px;');
    // The person's own letter spacing applies everywhere instead.
    const spaced = layout();
    spaced.type = { ...spaced.type, letterSpacingEm: 0.06 };
    expect(fitViewCss(spaced, 1)).not.toContain('letter-spacing: -0.022em');
    // Heavier floors raise the control weight with the body.
    const heavy = layout();
    heavy.type = { ...heavy.type, body: { px: 18, weight: 600, cue: 'none' } };
    expect(emphasisWeight(heavy)).toBe(600);
    // Leading: tight headings, never below 1.15 once lines are spaced out.
    expect(headingLeading('pageHeading', 1.5)).toBe(1.08);
    expect(headingLeading('pageHeading', 1.8)).toBe(1.15);
    expect(headingLeading('title', 1.8)).toBe(1.25);
  });

  it('draws the Showroom chrome: 1280 page, frosted strip, pills, panels', () => {
    const css = fitViewCss(layout(), 1);
    expect(css).toMatch(/\.fv-page \{[^}]*max-width: 1280px;/);
    expect(css).toContain('--fv-pad: max(24px, 4vw, 18px);');
    expect(css).toContain('backdrop-filter: saturate(180%) blur(20px)');
    expect(css).toContain('--fv-r-card: 22px;');
    expect(css).toContain('--fv-r-panel: 28px;');
    expect(css).toMatch(/\.fv-thumb \{[^}]*border-radius: 16px;/);
    expect(css).toMatch(/\.fv-article \{[^}]*border-radius: 28px;/);
    // Standard: surfaces, not borders; edges come back above standard.
    expect(css).toContain('--fv-card-edge: 0px;');
    expect(
      fitViewCss(
        { ...layout(), palette: { scheme: 'light', contrast: 'more' } },
        1,
      ),
    ).toContain('--fv-card-edge: 1px;');
    const maxCss = fitViewCss(
      { ...layout(), palette: { scheme: 'dark', contrast: 'max' } },
      1,
    );
    expect(maxCss).toContain('--fv-card-edge: 2px;');
    expect(maxCss).not.toContain('backdrop-filter: saturate');
    // The sections sheet is appended.
    expect(css).toContain(
      '/* ---------- Sections and records (styles-sections.ts) ---------- */',
    );
  });

  it('carries cues, reduced motion and forced colours', () => {
    const l = layout();
    l.type = { ...l.type, pageHeading: { px: 30, weight: 600, cue: 'rule' } };
    const css = fitViewCss({ ...l, motion: 'reduce' }, 1);
    expect(css).toMatch(/\.t-page\.cue \{ border-block-start: 2px solid/);
    expect(css).toContain(
      '* { transition: none !important; animation: none !important; }',
    );
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('--fv-dur: 0ms;');
    expect(fitViewCss(layout(), 1)).toContain('--fv-dur: 180ms;');
  });
});

describe('Text − / +', () => {
  it('scales every tier by the same factor, so ranks and ratios hold', () => {
    const base = layout();
    const up = nudgeLayout(base, 2);
    const f = NUDGE_RATIO ** 2;
    expect(up.type.body.px).toBeCloseTo(18 * f, 0);
    expect(up.type.pageHeading.px / up.type.body.px).toBeCloseTo(30 / 18, 1);
    expect(up.grid.card_media.minWidthPx).toBe(Math.round(226 * f));
    expect(up.target.controlPx).toBeGreaterThanOrEqual(up.target.minPx);
    const down = nudgeLayout(base, -3);
    expect(down.target.controlPx).toBe(44); // never below the hit-area floor
    expect(nudgeLayout(base, 0)).toBe(base);
    expect(nudgeLayout(base, 99).type.body.px).toBe(
      nudgeLayout(base, NUDGE_LIMIT).type.body.px,
    );
  });
});

describe('type tiers', () => {
  it('adjacent tiers differ by 1.15x, 200 weight or a cue', () => {
    const a = { px: 23, weight: 600 as const, cue: 'none' as const };
    const b = { px: 21, weight: 600 as const, cue: 'none' as const };
    expect(distinguishable(a, b).ok).toBe(false);
    expect(distinguishable({ ...a, cue: 'band' }, b).ok).toBe(true);
    expect(
      distinguishable({ ...a, weight: 700 }, { ...b, weight: 400 }).ok,
    ).toBe(true);
    expect(distinguishable({ ...a, px: 24.15 }, b).ok).toBe(true);
    expect(checkTiers(layout()).every((t) => t.ok)).toBe(true);
    const flat = layout();
    flat.type = {
      ...flat.type,
      sectionHeading: { px: 23, weight: 600, cue: 'none' },
      title: { px: 22, weight: 600, cue: 'none' },
    };
    const bad = checkTiers(flat).filter((t) => !t.ok);
    expect(bad.map((t) => `${t.upper}/${t.lower}`)).toEqual([
      'sectionHeading/title',
    ]);
  });
});

describe('fonts', () => {
  it('decodes the base64 face the worker sends', () => {
    expect(Array.from(base64ToBytes('d09GMg=='))).toEqual([119, 79, 70, 50]); // "wOF2"
  });
});
