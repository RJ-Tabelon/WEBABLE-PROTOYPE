'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/* WCAG 2.x relative luminance and contrast ratio. */
/** Expands #RGB to #RRGGBB (browsers may shorten custom property values). */
function normalizeHex(value: string): string {
  const v = value.trim().toUpperCase();
  const short = /^#([0-9A-F])([0-9A-F])([0-9A-F])$/.exec(v);
  return short
    ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : v;
}

function parseHex(value: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(normalizeHex(value));
  if (!m || !m[1]) return null;
  const h = m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string | undefined, b: string | undefined): number | null {
  const ca = a ? parseHex(a) : null;
  const cb = b ? parseHex(b) : null;
  if (!ca || !cb) return null;
  const la = luminance(ca);
  const lb = luminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

interface Check {
  fg: string;
  bg: string;
  target: number;
  label: string;
}

interface TokenRow {
  token: string;
  role: string;
  checks: Check[];
}

const ink = (bg: string): Check[] => [
  { fg: '--ink', bg, target: 7, label: 'ink' },
  { fg: '--ink-2', bg, target: 7, label: 'ink-2' },
  { fg: '--ink-3', bg, target: 4.5, label: 'ink-3' },
];

const GROUPS: ReadonlyArray<{ name: string; rows: TokenRow[] }> = [
  {
    name: 'Surfaces',
    rows: [
      { token: '--canvas', role: 'Paper', checks: ink('--canvas') },
      {
        token: '--surface-raised',
        role: 'Inputs, popovers',
        checks: ink('--surface-raised'),
      },
      {
        token: '--surface-tonal',
        role: 'Footer, offer, wells',
        checks: ink('--surface-tonal'),
      },
      {
        token: '--surface-hover',
        role: 'Hover',
        checks: ink('--surface-hover'),
      },
      {
        token: '--surface-press',
        role: 'Pressed',
        checks: ink('--surface-press'),
      },
    ],
  },
  {
    name: 'Ink and lines',
    rows: [
      {
        token: '--ink',
        role: 'Body, headings, links',
        checks: [
          { fg: '--ink', bg: '--canvas', target: 7, label: 'canvas' },
          { fg: '--ink', bg: '--surface-press', target: 7, label: 'press' },
        ],
      },
      {
        token: '--ink-2',
        role: 'Secondary text',
        checks: [
          { fg: '--ink-2', bg: '--canvas', target: 7, label: 'canvas' },
          { fg: '--ink-2', bg: '--surface-press', target: 7, label: 'press' },
        ],
      },
      {
        token: '--ink-3',
        role: 'Meta, placeholders',
        checks: [
          { fg: '--ink-3', bg: '--canvas', target: 4.5, label: 'canvas' },
          { fg: '--ink-3', bg: '--surface-press', target: 4.5, label: 'press' },
        ],
      },
      {
        token: '--line-strong',
        role: 'Control edges',
        checks: [
          { fg: '--line-strong', bg: '--canvas', target: 3, label: 'canvas' },
          {
            fg: '--line-strong',
            bg: '--surface-press',
            target: 3,
            label: 'press',
          },
        ],
      },
      { token: '--line', role: 'Decorative hairline only', checks: [] },
      {
        token: '--focus',
        role: 'Focus ring',
        checks: [
          { fg: '--focus', bg: '--canvas', target: 3, label: 'canvas' },
          { fg: '--focus', bg: '--selection', target: 3, label: 'selection' },
        ],
      },
    ],
  },
  {
    name: 'Fern: WebAble changed this, or offers to',
    rows: [
      {
        token: '--accent',
        role: 'After-values, adapted, offer rule',
        checks: [
          { fg: '--accent', bg: '--canvas', target: 4.5, label: 'canvas' },
          {
            fg: '--accent',
            bg: '--surface-hover',
            target: 4.5,
            label: 'hover',
          },
        ],
      },
      {
        token: '--accent-tint',
        role: 'Tint',
        checks: [
          {
            fg: '--accent',
            bg: '--accent-tint',
            target: 4.5,
            label: 'accent on it',
          },
        ],
      },
      {
        token: '--selection',
        role: 'Text selection',
        checks: [
          { fg: '--ink', bg: '--selection', target: 7, label: 'ink on it' },
        ],
      },
    ],
  },
  {
    name: 'Fills and their labels',
    rows: [
      {
        token: '--action',
        role: 'Primary button',
        checks: [
          { fg: '--on-action', bg: '--action', target: 7, label: 'label' },
          {
            fg: '--on-action',
            bg: '--action-hover',
            target: 7,
            label: 'hover',
          },
        ],
      },
      {
        token: '--danger',
        role: 'Destructive',
        checks: [
          { fg: '--danger', bg: '--canvas', target: 4.5, label: 'text' },
          { fg: '--on-danger', bg: '--danger', target: 4.5, label: 'filled' },
        ],
      },
      {
        token: '--warning',
        role: 'Warning text',
        checks: [
          { fg: '--warning', bg: '--canvas', target: 4.5, label: 'text' },
          {
            fg: '--warning-icon',
            bg: '--warning-tint',
            target: 3,
            label: 'glyph',
          },
        ],
      },
      {
        token: '--surface-inverse',
        role: 'Toast, tooltip',
        checks: [
          {
            fg: '--on-inverse',
            bg: '--surface-inverse',
            target: 7,
            label: 'text',
          },
          {
            fg: '--on-inverse-accent',
            bg: '--surface-inverse',
            target: 4.5,
            label: 'check',
          },
        ],
      },
    ],
  },
  {
    name: 'Fixed in both themes',
    rows: [
      {
        token: '--stage',
        role: 'Calibration stage',
        checks: [
          { fg: '--stimulus', bg: '--stage', target: 15, label: 'stimulus' },
        ],
      },
    ],
  },
];

/**
 * Colour tokens read from the computed style of this panel, so the values and
 * ratios shown are exactly what the page renders in this theme.
 */
export function ColourTokens() {
  const probe = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  useLayoutEffect(() => {
    const el = probe.current;
    if (!el) return;
    const read = () => {
      const style = window.getComputedStyle(el);
      const next: Record<string, string> = {};
      const names = new Set<string>();
      for (const g of GROUPS)
        for (const r of g.rows) {
          names.add(r.token);
          for (const c of r.checks) {
            names.add(c.fg);
            names.add(c.bg);
          }
        }
      for (const name of names)
        next[name] = normalizeHex(style.getPropertyValue(name));
      setValues(next);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-wa-contrast'],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={probe} className="g-colours">
      {GROUPS.map((group) => (
        <div key={group.name} className="g-colours__group">
          <p className="g-colours__heading">{group.name}</p>
          <ul role="list" className="g-colours__list">
            {group.rows.map((row) => (
              <li key={row.token} className="g-colour">
                <span
                  className="g-colour__swatch"
                  style={{ background: `var(${row.token})` }}
                />
                <span className="g-colour__name">
                  <code>{row.token}</code>
                  <span className="g-caption">{row.role}</span>
                </span>
                <span className="g-colour__hex">{values[row.token] ?? ''}</span>
                <span className="g-colour__checks">
                  {row.checks.length === 0 ? (
                    <span className="g-caption">
                      Never a control’s only edge
                    </span>
                  ) : (
                    row.checks.map((check) => {
                      const r = contrast(values[check.fg], values[check.bg]);
                      const pass = r !== null && r + 1e-9 >= check.target;
                      return (
                        <span
                          key={check.label}
                          className="g-ratio"
                          data-pass={pass ? '' : undefined}
                        >
                          <span className="g-ratio__label">{check.label}</span>
                          <span className="g-ratio__value">
                            {r === null ? '–' : r.toFixed(2)}
                          </span>
                          <span className="g-ratio__target">
                            min {check.target}
                          </span>
                        </span>
                      );
                    })
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
