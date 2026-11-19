import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * INDEX.md: every image with its surface, state, viewport and theme, grouped
 * by product area, a count per surface, and every capture that did not happen
 * with the reason.
 */

const GROUP_ORDER = [
  'Public site',
  'Auth',
  'Tune',
  'Signed-in app',
  'Connect',
  'Extension popup',
  'Extension welcome page',
  'Engine on fixture pages',
  'Component gallery',
];

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|');

export async function writeIndex(rec, { started, finished, groups }) {
  const lines = [];
  const entries = rec.entries;
  lines.push('# WebAble capture index', '');
  lines.push(
    `Captured ${started.toISOString()} to ${finished.toISOString()} by \`scripts/capture/capture.mjs\` (groups: ${groups.join(', ')}).`,
    '',
    'File names are `<surface>__<state>__<viewport>-<theme>.png`. Viewports: `1440` = 1440x900 (device scale 1); `390` = 390x844 (device scale 2, touch emulation); popup images are named by the popup’s own width (`380` at WebAble text scale 1, `499` at 1.31, `570` at 1.5) and are as tall as the popup, up to Chrome’s 600 px. "Full page: yes" is the whole page; a page taller than one capture can hold (16,000 device px) is split into `-part-N-of-M` images. Otherwise the image is the first screen (the viewport), one element, or the popup.',
    '',
    'Signed-in pages run against a local Supabase stand-in (`scripts/capture/lib/supabase-stub.mjs`) with the e2e seed data (a measured fit and one earlier fit, two weeks of activity, a learned state, one install); nothing is read from or written to the hosted project. Extension-backed web states use the in-page stand-in from `apps/web/e2e/support/fake-extension.ts`. The extension is the e2e build (`wxt build --mode e2e`) on the engine fixtures.',
    '',
  );

  // Counts per surface.
  const bySurface = new Map();
  for (const e of entries)
    bySurface.set(e.surface, (bySurface.get(e.surface) ?? 0) + 1);
  lines.push(`## Counts (${entries.length} images)`, '');
  lines.push('| Surface | Images |', '| --- | ---: |');
  for (const [surface, n] of [...bySurface.entries()].sort()) {
    lines.push(`| ${cell(surface)} | ${n} |`);
  }
  lines.push('');

  const groupsSeen = [
    ...GROUP_ORDER.filter((g) => entries.some((e) => e.group === g)),
    ...[...new Set(entries.map((e) => e.group ?? 'Other'))].filter(
      (g) => !GROUP_ORDER.includes(g),
    ),
  ];
  for (const group of groupsSeen) {
    const rows = entries.filter((e) => (e.group ?? 'Other') === group);
    lines.push(`## ${group} (${rows.length})`, '');
    lines.push(
      '| File | Surface | State | Viewport | Theme | Full page | Note |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const e of rows) {
      lines.push(
        `| [${cell(e.file)}](${encodeURI(e.file)}) | ${cell(e.surface)} | ${cell(e.state)} | ${cell(e.viewport)} | ${cell(e.theme)} | ${e.full ? 'yes' : 'no'} | ${cell(e.note ?? '')} |`,
      );
    }
    lines.push('');
  }

  lines.push(`## Not captured (${rec.misses.length})`, '');
  if (rec.misses.length === 0) {
    lines.push('Everything the harness attempts was captured.', '');
  } else {
    lines.push(
      '| Surface | State | Viewport | Theme | Why |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const m of rec.misses) {
      lines.push(
        `| ${cell(m.surface)} | ${cell(m.state ?? '')} | ${cell(m.viewport ?? '')} | ${cell(m.theme ?? '')} | ${cell(m.reason)} |`,
      );
    }
    lines.push('');
  }
  if (rec.notes?.length) {
    lines.push('## Notes', '');
    for (const n of rec.notes) lines.push(`- ${n}`);
    lines.push('');
  }
  await writeFile(join(rec.outDir, 'INDEX.md'), lines.join('\n'));
}
