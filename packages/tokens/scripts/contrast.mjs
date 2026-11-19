#!/usr/bin/env node
/**
 * Contrast gate for the WebAble design tokens (design-final.md §6 and §15).
 *
 * Parses src/tokens.css, resolves the light theme (the `:root` block) and the dark
 * theme (the `:root[data-theme="dark"]` block), and checks every pair listed in §6
 * against its target with the WCAG 2.x relative-luminance formula. It also checks
 * that every copy of a theme in the file (media-query dark, attribute dark, scoped
 * light and dark) holds identical values, because the file writes them out by hand.
 *
 * Usage: node scripts/contrast.mjs [--quiet] [--json]
 * Exits 1 when any pair misses its target or a theme copy drifts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../src/tokens.css');
const args = new Set(process.argv.slice(2));
const quiet = args.has('--quiet');
const asJson = args.has('--json');

/* ------------------------------------------------------------------ parsing */

/** Strips comments so declarations can be matched line-independently. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Returns the body of the first rule whose selector text matches `selector` exactly
 * (after whitespace normalisation). Handles one level of nesting inside @media.
 */
function normalizeSelector(selector) {
  return selector.replace(/\s+/g, ' ').replace(/'/g, '"').trim();
}

function findBlock(css, selector) {
  const want = normalizeSelector(selector);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (normalizeSelector(m[1]) === want) return m[2];
  }
  return null;
}

function parseDecls(body) {
  const out = new Map();
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const value = part
      .slice(i + 1)
      .trim()
      .replace(/\s+/g, ' ');
    if (name.startsWith('--') || name === 'color-scheme') out.set(name, value);
  }
  return out;
}

const raw = readFileSync(cssPath, 'utf8');
const css = stripComments(raw);

const rootBody = findBlock(css, ':root');
const darkAttrBody = findBlock(css, ':root[data-theme="dark"]');
const darkMediaBody = findBlock(css, ':root:not([data-theme="light"])');
const scopedLightBody = findBlock(css, '[data-theme="light"]:not(:root)');
const scopedDarkBody = findBlock(css, '[data-theme="dark"]:not(:root)');

const problems = [];
for (const [name, body] of [
  [':root', rootBody],
  [':root[data-theme="dark"]', darkAttrBody],
  [
    ':root:not([data-theme="light"]) (prefers-color-scheme: dark)',
    darkMediaBody,
  ],
  ['[data-theme="light"]:not(:root)', scopedLightBody],
  ['[data-theme="dark"]:not(:root)', scopedDarkBody],
]) {
  if (!body) problems.push(`Missing theme block ${name} in tokens.css`);
}
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

const lightDecls = parseDecls(rootBody);
const darkDecls = new Map([...lightDecls, ...parseDecls(darkAttrBody)]);

/* ------------------------------------------------------ theme-copy drift check */

function compareBlocks(label, reference, body) {
  const decls = parseDecls(body);
  for (const [name, value] of decls) {
    const ref = reference.get(name);
    if (ref === undefined) {
      problems.push(`${label}: ${name} is not defined in the reference theme`);
    } else if (ref.toLowerCase() !== value.toLowerCase()) {
      problems.push(`${label}: ${name} is ${value}, reference is ${ref}`);
    }
  }
  return decls;
}

const darkAttr = parseDecls(darkAttrBody);
const darkMedia = compareBlocks('dark (media query)', darkDecls, darkMediaBody);
for (const name of darkAttr.keys()) {
  if (!darkMedia.has(name))
    problems.push(`dark (media query) is missing ${name}`);
}
const scopedDark = compareBlocks('dark (scoped)', darkDecls, scopedDarkBody);
for (const name of darkAttr.keys()) {
  if (!scopedDark.has(name)) problems.push(`dark (scoped) is missing ${name}`);
}
const scopedLight = compareBlocks(
  'light (scoped)',
  lightDecls,
  scopedLightBody,
);
// A scoped light block must reset everything the dark theme overrides.
for (const name of darkAttr.keys()) {
  if (!scopedLight.has(name))
    problems.push(`light (scoped) does not reset ${name}`);
}

/* ------------------------------------------------------------- colour maths */

function resolveVar(decls, value, depth = 0) {
  if (depth > 8) throw new Error(`Circular var() while resolving ${value}`);
  const m = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!m) return value.trim();
  const next = decls.get(m[1]);
  if (next === undefined) throw new Error(`Undefined token ${m[1]}`);
  return resolveVar(decls, next, depth + 1);
}

/** Parses #RRGGBB or rgb(r g b / a) into { rgb: [0..255 x3], a }. */
function parseColor(value) {
  const v = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const h = m[1];
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), a: 1 };
  }
  m =
    /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/i.exec(
      v,
    );
  if (m) {
    let a =
      m[4] === undefined
        ? 1
        : m[4].endsWith('%')
          ? parseFloat(m[4]) / 100
          : parseFloat(m[4]);
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a };
  }
  throw new Error(`Unsupported colour value "${value}"`);
}

function toHex(rgb) {
  return `#${rgb
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** Composites a possibly translucent colour over an opaque backdrop. */
function over(fg, bg) {
  return fg.rgb.map((c, i) => c * fg.a + bg.rgb[i] * (1 - fg.a));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A colour operand in a pair: a token name, a literal hex, or a composite
 * `{ token, over }` (translucent token composited over a literal backdrop).
 */
function resolveOperand(decls, operand) {
  if (typeof operand === 'object') {
    const top = parseColor(resolveVar(decls, decls.get(operand.token)));
    const backdrop = parseColor(operand.over);
    return {
      rgb: over(top, backdrop),
      label: `${operand.token} over ${operand.over}`,
    };
  }
  if (operand.startsWith('#'))
    return { rgb: parseColor(operand).rgb, label: operand };
  const value = decls.get(operand);
  if (value === undefined) throw new Error(`Undefined token ${operand}`);
  const c = parseColor(resolveVar(decls, value));
  if (c.a !== 1)
    throw new Error(`${operand} is translucent; pair it as a composite`);
  return { rgb: c.rgb, label: operand };
}

/* ---------------------------------------------------------------- the pairs */

const TEXT = 7;
const TEXT_MIN = 4.5;
const NON_TEXT = 3;
const STIMULUS = 15;

const SURFACES = [
  '--canvas',
  '--surface-raised',
  '--surface-tonal',
  '--surface-hover',
  '--surface-press',
];

/** @type {Array<{fg: any, bg: any, kind: string, target: number, use: string, dark?: {fg?: any, bg?: any}}>} */
const pairs = [];
const add = (fg, bg, kind, target, use, dark) =>
  pairs.push({ fg, bg, kind, target, use, dark });

for (const s of SURFACES)
  add('--ink', s, 'text', TEXT, 'Body, headings, labels, links');
for (const s of SURFACES)
  add('--ink-2', s, 'text', TEXT, 'Secondary text, decks, hints, nav links');
for (const s of SURFACES)
  add('--ink-3', s, 'text', TEXT_MIN, 'Meta, placeholders, disabled labels');
for (const s of [
  '--canvas',
  '--surface-raised',
  '--surface-tonal',
  '--surface-hover',
  '--accent-tint',
])
  add(
    '--accent',
    s,
    'text',
    TEXT_MIN,
    'After-value in fit marks, "Adapted" label',
  );
for (const s of ['--canvas', '--surface-raised', '--surface-tonal'])
  add('--accent-hover', s, 'text', TEXT_MIN, 'Accent text on hover');
for (const s of [
  '--canvas',
  '--surface-raised',
  '--surface-tonal',
  '--warning-tint',
])
  add('--warning', s, 'text', TEXT_MIN, 'Warning message text');
for (const s of [
  '--canvas',
  '--surface-raised',
  '--surface-tonal',
  '--danger-tint',
])
  add(
    '--danger',
    s,
    'text',
    TEXT_MIN,
    'Error text, destructive outline button',
  );
for (const s of [
  '--accent-tint',
  '--warning-tint',
  '--danger-tint',
  '--selection',
])
  add('--ink', s, 'text', TEXT, 'Text on tints and selection');
for (const s of ['--accent-tint', '--warning-tint', '--danger-tint'])
  add('--ink-2', s, 'text', TEXT, 'Secondary text on tints');
for (const s of ['--action', '--action-hover', '--action-press'])
  add('--on-action', s, 'text', TEXT, 'Primary button label');
for (const s of ['--accent', '--accent-hover'])
  add(
    '--on-accent',
    s,
    'text',
    TEXT_MIN,
    'Check glyph and label on accent fills',
  );
for (const s of ['--danger', '--danger-hover'])
  add('--on-danger', s, 'text', TEXT_MIN, 'Filled destructive confirm button');
for (const s of ['--surface-inverse', '--surface-inverse-hover'])
  add('--on-inverse', s, 'text', TEXT, 'Toast and tooltip text');
add(
  '--on-inverse-2',
  '--surface-inverse',
  'text',
  TEXT_MIN,
  'Toast secondary text',
);
add(
  '--on-inverse-accent',
  '--surface-inverse',
  'text',
  TEXT_MIN,
  'Toast "applied" glyph',
);
add(
  '#FFFFFF',
  '--badge-accent',
  'text',
  TEXT_MIN,
  'Toolbar badge: change count',
);
add('#1A1A17', '--badge-warn', 'text', TEXT_MIN, 'Toolbar badge: "!"');
add(
  '--stimulus',
  '--stage',
  'text',
  STIMULUS,
  'Calibration stimuli (fixed in both themes)',
);

for (const s of SURFACES)
  add(
    '--line-strong',
    s,
    'non-text',
    NON_TEXT,
    'Control boundaries, switch-off track, ruler',
  );
for (const s of ['--canvas', '--surface-raised', '--surface-tonal'])
  add(
    '--accent',
    s,
    'non-text',
    NON_TEXT,
    'Switch-on track, fit outline, adapted disc, offer rule',
  );
for (const s of [
  '--canvas',
  '--surface-raised',
  '--surface-tonal',
  '--warning-tint',
])
  add('--warning-icon', s, 'non-text', NON_TEXT, 'Warning triangle glyph');
for (const s of ['--canvas', '--surface-tonal'])
  add('--ink-2', s, 'non-text', NON_TEXT, 'Switch-off thumb, status glyphs');
add(
  '--on-inverse-2',
  '--surface-inverse',
  'non-text',
  NON_TEXT,
  'Toast action button ring',
);

for (const s of [
  ...SURFACES,
  '--accent-tint',
  '--warning-tint',
  '--danger-tint',
  '--selection',
])
  add(
    '--focus',
    s,
    'focus',
    NON_TEXT,
    'Focus ring on every surface it can sit on',
  );
add(
  '--focus-inverse',
  '--surface-inverse',
  'focus',
  NON_TEXT,
  'Focus ring inside toast/tooltip',
);

// Sticky header: 92% canvas composited over the worst-case content scrolling beneath it
// (black under the light header, white under the dark one).
add(
  '--ink',
  { token: '--header-bg', over: '#000000' },
  'text',
  TEXT,
  'Sticky header over scrolled content',
  { bg: { token: '--header-bg', over: '#FFFFFF' } },
);
// In-page layer (always the light accent on host pages).
add(
  '--inpage-accent',
  '--inpage-casing',
  'non-text',
  NON_TEXT,
  'Fit outline against its casing',
);
add('--focus', '#FFFFFF', 'focus', NON_TEXT, 'In-page focus against its halo', {
  bg: '--surface-raised',
});
add(
  '--line-strong',
  '#FFFFFF',
  'non-text',
  NON_TEXT,
  'In-page chip edge on a white page',
);

/* ---------------------------------------------------------------- evaluate */

const rows = [];
let failures = 0;
for (const pair of pairs) {
  const row = { use: pair.use, kind: pair.kind, target: pair.target };
  for (const [theme, decls] of [
    ['light', lightDecls],
    ['dark', darkDecls],
  ]) {
    const fgOp = theme === 'dark' && pair.dark?.fg ? pair.dark.fg : pair.fg;
    const bgOp = theme === 'dark' && pair.dark?.bg ? pair.dark.bg : pair.bg;
    try {
      const fg = resolveOperand(decls, fgOp);
      const bg = resolveOperand(decls, bgOp);
      const r = ratio(fg.rgb, bg.rgb);
      const pass = r + 1e-9 >= pair.target;
      if (!pass) failures += 1;
      row[theme] = {
        fg: fg.label,
        bg: bg.label,
        fgHex: toHex(fg.rgb),
        bgHex: toHex(bg.rgb),
        ratio: Math.round(r * 100) / 100,
        pass,
      };
    } catch (error) {
      failures += 1;
      row[theme] = {
        error: error instanceof Error ? error.message : String(error),
        pass: false,
      };
    }
  }
  rows.push(row);
}

if (asJson) {
  console.log(
    JSON.stringify({ pairs: rows, drift: problems, failures }, null, 2),
  );
} else {
  if (!quiet) {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(
      `${pad('Pair', 62)} ${pad('Kind', 9)} ${pad('Light', 8)} ${pad('Dark', 8)} Target`,
    );
    for (const row of rows) {
      const l = row.light;
      const d = row.dark;
      const darkNote =
        !d.error && !l.error && d.bg !== l.bg ? ` (dark: ${d.bg})` : '';
      const name = l.error ? l.error : `${l.fg} on ${l.bg}${darkNote}`;
      const fmt = (t) =>
        t.error ? 'ERR' : `${t.ratio.toFixed(2)}${t.pass ? '' : ' ✗'}`;
      console.log(
        `${pad(name, 62)} ${pad(row.kind, 9)} ${pad(fmt(l), 8)} ${pad(fmt(d), 8)} ${row.target}`,
      );
    }
    console.log('');
  }
  for (const p of problems) console.error(`✗ theme drift: ${p}`);
  const total = rows.length * 2;
  if (failures || problems.length) {
    console.error(
      `✗ ${failures} of ${total} ratios below target; ${problems.length} theme-copy problem(s).`,
    );
  } else {
    console.log(
      `✓ ${rows.length} token pairs, ${total} ratios, 0 failures. Theme copies in sync.`,
    );
  }
}

process.exit(failures || problems.length ? 1 : 0);
