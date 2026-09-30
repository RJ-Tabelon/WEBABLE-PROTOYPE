import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OP_IDS } from '@webable/core/ops/catalog';
import { describe, expect, it } from 'vitest';

import { __test, mergePlans } from '../../../lib/engine/engine';
import {
  shouldRelease,
  stabilizerParams,
} from '../../../lib/engine/ops/behavior';
import {
  BOOST,
  calmMotionCss,
  focusOutlineCss,
  PREPAINT_FILES,
  tok,
} from '../../../lib/engine/ops/css';
import {
  MARK_ATTR,
  MarkBook,
  opsNear,
  setOffGate,
  tokenOp,
  tokensOf,
} from '../../../lib/engine/ops/marks';
import {
  BISECT_ORDER,
  levelValue,
  OPS,
} from '../../../lib/engine/ops/registry';
import { padBucket } from '../../../lib/engine/ops/targets';
import { ch, px, wordSpacingFor } from '../../../lib/engine/ops/text';
import { fitParts, fitSpoken } from '../../../lib/engine/ui/layer';
import { LAYER_TOKENS } from '../../../lib/engine/ui/styles';
import {
  BoxGrid,
  nearestGaps,
  spacingFailures,
  type SpacingTarget,
} from '../../../lib/engine/util/geometry';

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = join(here, '..', '..', '..');

describe('op registry', () => {
  it('implements every op in the catalog', () => {
    for (const id of OP_IDS) expect(OPS[id].id).toBe(id);
  });

  it('maps levels onto the reviewed ladders, clamped', () => {
    expect(levelValue('text_floor', 2)).toBe(18);
    expect(levelValue('text_floor', 99)).toBe(48);
    expect(levelValue('target_size', -3)).toBe(24);
    expect(levelValue('dim_distractions', 1)).toBe(0.45);
  });

  it('bisects layout ops before paint ops', () => {
    expect(BISECT_ORDER.slice(0, 3)).toEqual([
      'text_floor',
      'line_spacing',
      'line_length',
    ]);
  });
});

describe('marks', () => {
  it('maps every token family to exactly one op', () => {
    expect(tokenOp('tf')).toBe('text_floor');
    expect(tokenOp('tflh150')).toBe('text_floor');
    expect(tokenOp('tfa')).toBe('text_floor');
    expect(tokenOp('ct12')).toBe('contrast');
    expect(tokenOp('hs')).toBe('target_size');
    expect(tokenOp('hx4')).toBe('target_size');
    expect(tokenOp('tg8')).toBe('target_spacing');
    expect(tokenOp('mgt')).toBe('menu_grace');
    expect(tokenOp('ups')).toBe('unpin_bars');
    expect(tokenOp('dm')).toBe('dim_distractions');
    expect(tokenOp('page')).toBeNull();
  });

  it('removes one op without touching another, and leaves no attribute behind', () => {
    document.body.innerHTML = '<div id="a"><p id="p">x</p></div>';
    const p = document.getElementById('p') as Element;
    const book = new MarkBook();
    book.mark(p, 'tf');
    book.mark(p, 'ct0');
    book.mark(p, 'tf');
    expect(tokensOf(p)).toEqual(['tf', 'ct0']);
    expect([...opsNear(p)].sort()).toEqual(['contrast', 'text_floor']);
    expect(book.countFor('text_floor')).toBe(1);
    book.unmarkOp('text_floor');
    expect(tokensOf(p)).toEqual(['ct0']);
    book.unmarkOp('contrast');
    expect(p.hasAttribute(MARK_ATTR)).toBe(false);
  });

  it('writes a random attribute and opaque tokens: no name or value reaches the page', () => {
    document.body.innerHTML = '<p id="p">x</p>';
    const p = document.getElementById('p') as Element;
    const book = new MarkBook();
    book.mark(p, 'tflh150');
    book.mark(p, 'ct3');
    book.mark(p, 'hx12');
    expect(MARK_ATTR).toMatch(/^data-[a-z]{6}$/);
    expect(MARK_ATTR.startsWith('data-wa')).toBe(false);
    const raw = (p.getAttribute(MARK_ATTR) ?? '').split(' ');
    expect(raw).toHaveLength(3);
    for (const t of raw) expect(t).toMatch(/^[a-z]{5}$/);
    expect(raw.join(' ')).not.toMatch(/tf|ct\d|hx|150|12/);
    expect(tokensOf(p)).toEqual(['tflh150', 'ct3', 'hx12']);
    expect(tok('ct3')).toContain(`[${MARK_ATTR}~="${raw[1]}"]`);
    expect(tok('ct3')).not.toContain('ct3');
    book.clear();
    expect(p.hasAttribute(MARK_ATTR)).toBe(false);
  });

  it('keeps the pre-paint stand-down list on <html>', () => {
    setOffGate(document, 'calm_motion', true);
    setOffGate(document, 'focus_outline', true);
    setOffGate(document, 'calm_motion', true);
    expect(document.documentElement.getAttribute('data-wa-off')).toBe(
      'calm_motion focus_outline',
    );
    setOffGate(document, 'calm_motion', false);
    setOffGate(document, 'focus_outline', false);
    expect(document.documentElement.hasAttribute('data-wa-off')).toBe(false);
  });
});

describe('css', () => {
  it('ships pre-paint files identical to the engine source (modulo formatting)', () => {
    // Formatting-insensitive: whitespace collapsed, quote style unified.
    const norm = (css: string): string =>
      css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/'/g, '"')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{},;])\s*/g, '$1')
        .trim();
    for (const [name, make] of Object.entries(PREPAINT_FILES)) {
      const file = readFileSync(
        join(extRoot, 'public', 'prepaint', name),
        'utf8',
      );
      expect(norm(file), name).toBe(norm(make()));
    }
  });

  it('gates document rules so paused sites stand down, and boosts specificity', () => {
    expect(focusOutlineCss(3, 'doc')).toContain('data-wa-off~="focus_outline"');
    expect(focusOutlineCss(3, 'doc')).toContain('data-wa-off~="all"');
    expect(focusOutlineCss(3, 'shadow')).not.toContain('html');
    expect(calmMotionCss('doc')).toContain(BOOST);
    expect(focusOutlineCss(3, 'doc')).toContain('outline: 3px solid #1a1a17');
    expect(focusOutlineCss(3, 'doc')).toContain(
      'box-shadow: 0 0 0 7px #ffffff',
    );
  });

  it('keeps the in-page layer tokens identical to packages/tokens', () => {
    const css = readFileSync(
      join(extRoot, '..', '..', 'packages', 'tokens', 'src', 'tokens.css'),
      'utf8',
    );
    const block = (start: RegExp): Record<string, string> => {
      const m = start.exec(css);
      if (!m) throw new Error(`block not found: ${start}`);
      const from = m.index + m[0].length;
      // Blocks close on their own line; comments inside may contain braces.
      const end = /\n\s*\}/.exec(css.slice(from));
      const body = css.slice(from, from + (end?.index ?? 0));
      const out: Record<string, string> = {};
      for (const [, k, v] of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi))
        out[k as string] = (v as string).trim();
      return out;
    };
    const light = block(/^:root \{/m);
    const dark = block(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme=["']light["']\]\) \{/,
    );
    for (const [k, v] of Object.entries(LAYER_TOKENS.light))
      expect(light[k]?.toUpperCase(), k).toBe(v.toUpperCase());
    for (const [k, v] of Object.entries(LAYER_TOKENS.dark))
      expect(dark[k]?.toUpperCase(), `dark ${k}`).toBe(v.toUpperCase());
    for (const [k, v] of Object.entries(LAYER_TOKENS.fixed))
      expect(light[k]?.split(/\s/)[0]?.toUpperCase(), k).toBe(v.toUpperCase());
  });
});

describe('geometry: WCAG 2.5.8 spacing', () => {
  const t = (
    id: number,
    left: number,
    top: number,
    w: number,
    h: number,
  ): SpacingTarget => ({
    id,
    box: { left, top, right: left + w, bottom: top + h },
    small: Math.min(w, h) < 24,
  });

  it('passes undersized targets whose 24 px circles do not meet', () => {
    // 20 px targets, 30 px apart centre to centre: circles (r=12) do not intersect.
    expect(
      spacingFailures([t(1, 0, 0, 20, 20), t(2, 30, 0, 20, 20)], 24).size,
    ).toBe(0);
  });

  it('fails crowded undersized targets', () => {
    const fails = spacingFailures(
      [t(1, 0, 0, 16, 16), t(2, 18, 0, 16, 16), t(3, 36, 0, 16, 16)],
      24,
    );
    expect([...fails.keys()].sort()).toEqual([1, 2, 3]);
  });

  it('parameterises by the calibrated size', () => {
    const pair = [t(1, 0, 0, 30, 30), t(2, 40, 0, 30, 30)].map((x) => ({
      ...x,
      small: true,
    }));
    expect(spacingFailures(pair, 24).size).toBe(0);
    expect(spacingFailures(pair, 44).size).toBe(2);
  });

  it('finds the nearest gaps per axis, including diagonal neighbours', () => {
    const a = { id: 1, box: { left: 100, top: 100, right: 120, bottom: 120 } };
    const right = {
      id: 2,
      box: { left: 126, top: 100, right: 146, bottom: 120 },
    };
    const below = {
      id: 3,
      box: { left: 100, top: 150, right: 120, bottom: 170 },
    };
    const grid = new BoxGrid([a, right, below], 64);
    expect(nearestGaps(a, grid, 44)).toEqual({ x: 6, y: 30 });
  });

  it('buckets pads down so caps are never exceeded', () => {
    expect(padBucket(0.5)).toBe(0);
    expect(padBucket(5)).toBe(4);
    expect(padBucket(13)).toBe(12);
    expect(padBucket(100)).toBe(28);
  });
});

describe('copy helpers', () => {
  it('writes digits, a no-break space and the unit', () => {
    expect(px(17.6)).toBe('18 px');
    expect(ch(70.2)).toBe('70 characters');
    expect(wordSpacingFor(1.8)).toBe(0.12);
  });

  it('builds the fit mark and its spoken form', () => {
    expect(fitParts('13 px', '18 px')).toEqual({
      before: '13',
      after: '18 px',
    });
    expect(fitParts('100%', '45%')).toEqual({ before: '100%', after: '45%' });
    expect(fitSpoken('13 px', '18 px')).toBe('13 to 18 pixels');
    expect(fitSpoken('0 ms', '400 ms')).toBe('0 to 400 milliseconds');
  });
});

describe('steady clicks', () => {
  it('holds a slip, releases a deliberate drag or cancel', () => {
    const p = stabilizerParams(300);
    expect(shouldRelease(p, 20, 100)).toBe(false); // a slip during the press
    expect(shouldRelease(p, 20, 400)).toBe(true); // moved after the hold window: a drag
    expect(shouldRelease(p, 60, 50)).toBe(true); // moved far: a cancel
    expect(shouldRelease(p, 5, 1000)).toBe(false);
  });
});

describe('plans', () => {
  const op = (id: 'text_floor' | 'contrast', level: number) => ({
    op: id,
    level,
    mode: 'auto' as const,
    scope: 'page' as const,
    trace: {
      op: id,
      mode: 'auto' as const,
      source: 'profile' as const,
      level,
      p: 1,
      pOk: 1,
      why: '',
      evidence: [],
    },
  });

  it('merges refinements without dropping applied ops', () => {
    const prev = {
      id: 'a',
      createdAt: 0,
      category: 'article' as const,
      basis: 'local' as const,
      ops: [op('text_floor', 1)],
    };
    const next = {
      id: 'b',
      createdAt: 1,
      category: 'article' as const,
      basis: 'page_analysis' as const,
      ops: [op('contrast', 0), op('text_floor', 2)],
    };
    const merged = mergePlans(prev, next);
    expect(merged.id).toBe('b');
    expect(merged.ops.map((o) => [o.op, o.level])).toEqual([
      ['text_floor', 2],
      ['contrast', 0],
    ]);
  });

  it('compares scopes by region set', () => {
    expect(__test.sameScope('page', 'page')).toBe(true);
    expect(
      __test.sameScope({ regions: ['a', 'b'] }, { regions: ['b', 'a'] }),
    ).toBe(true);
    expect(__test.sameScope({ regions: ['a'] }, 'page')).toBe(false);
  });

  it('offer copy never names the person, and falls back to the op', () => {
    const planned = {
      ...op('text_floor', 2),
      mode: 'offer' as const,
      trace: {
        ...op('text_floor', 2).trace,
        evidence: [{ kind: 'friction' as const, signal: 'zoom_in' as const }],
      },
    };
    const copy = __test.offerCopy(planned);
    expect(copy.question.length).toBeGreaterThan(5);
    expect(copy.question).not.toMatch(
      /disab|impair|low vision|patient|normal|!/i,
    );
    expect(copy.question.endsWith('?')).toBe(true);
  });
});
