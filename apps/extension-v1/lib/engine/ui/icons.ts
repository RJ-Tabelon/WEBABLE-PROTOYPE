/**
 * Inline SVG glyphs for the in-page layer, built with createElementNS (no
 * innerHTML, so page Trusted Types policies never matter). Paths are Lucide
 * (ISC) at stroke 1.75 on a 24 grid, plus WebAble's custom fit arrow
 * (design-final.md 11.3). The brand font lacks arrows, checks and undo glyphs,
 * so they are never typed characters.
 */

const NS = 'http://www.w3.org/2000/svg';

type Shape = readonly [
  tag: 'path' | 'line' | 'polyline',
  attrs: Readonly<Record<string, string>>,
];

const GLYPHS = {
  check: { box: '0 0 24 24', shapes: [['path', { d: 'M20 6 9 17l-5-5' }]] },
  x: {
    box: '0 0 24 24',
    shapes: [
      ['path', { d: 'M18 6 6 18' }],
      ['path', { d: 'm6 6 12 12' }],
    ],
  },
  undo: {
    box: '0 0 24 24',
    shapes: [
      ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
      ['path', { d: 'M3 3v5h5' }],
    ],
  },
  /** Fit view: a page with a top strip and a side column (Lucide panels-top-left). */
  fitview: {
    box: '0 0 24 24',
    shapes: [
      [
        'path',
        {
          d: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
        },
      ],
      ['path', { d: 'M3 9h18' }],
      ['path', { d: 'M9 21V9' }],
    ],
  },
  /** Fit arrow: 12 x 8, a horizontal line with a 45 degree open head. */
  fit: {
    box: '0 0 12 8',
    shapes: [
      ['line', { x1: '0.875', y1: '4', x2: '11', y2: '4' }],
      ['polyline', { points: '7.5 0.875 11 4 7.5 7.125' }],
    ],
  },
} as const satisfies Record<string, { box: string; shapes: readonly Shape[] }>;

export type GlyphName = keyof typeof GLYPHS;

export function glyph(
  doc: Document,
  name: GlyphName,
  sizePx: number,
  className?: string,
): SVGSVGElement {
  const g = GLYPHS[name];
  const svg = doc.createElementNS(NS, 'svg');
  const [, , w, h] = g.box.split(' ').map(Number);
  svg.setAttribute('viewBox', g.box);
  svg.setAttribute('width', String(name === 'fit' ? 12 : sizePx));
  svg.setAttribute(
    'height',
    String(name === 'fit' ? 8 : Math.round((sizePx * (h ?? 24)) / (w ?? 24))),
  );
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  for (const [tag, attrs] of g.shapes as readonly Shape[]) {
    const el = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    // Absolute stroke: 1.75 px whatever the rendered size.
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(el);
  }
  return svg;
}
