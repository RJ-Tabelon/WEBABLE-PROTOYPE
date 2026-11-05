// Server-side second pass over everything that can reach a model. The extension already redacted it; this
// pass uses the same core functions so a modified or buggy client still cannot send personal text.
import { allowlistWords, redactText, stillSensitive, uiLabel } from '@webable/core';
import type {
  OverlayButtonEvidence, OverlayEvidence, PageDigest, PageOutline, Role, StruggleSignals, VisualVerifyRequest,
} from '@webable/core';

/** A label for Jev: redacted, capped at 15 words; if anything still looks personal, only allowlisted words remain. */
export function cleanLabel(s: string, maxWords = 15): string {
  const once = uiLabel(s, maxWords);
  return stillSensitive(once) ? allowlistWords(once) : once;
}

export function sanitizeDigest(d: PageDigest): { digest: PageDigest; changed: number } {
  let changed = 0;
  const fix = (s: string, maxWords = 15) => {
    const out = cleanLabel(s, maxWords);
    if (out !== s) changed++;
    return out;
  };
  const elements = d.elements.map((e) => ({ ...e, label: fix(e.label) }));
  const ids = new Set(elements.map((e) => e.id));
  return {
    digest: {
      ...d,
      page: {
        ...d.page,
        title: fix(d.page.title, 20),
        url_path: redactText(d.page.url_path),
        headings: d.page.headings.map((h) => fix(h, 20)),
      },
      elements,
      mainCandidates: [...new Set(d.mainCandidates)].filter((id) => ids.has(id)),
    },
    changed,
  };
}

const words = (s: string) => s.replace(/·/g, ' ').replace(/\s+/g, ' ').trim();
const SHAPE = /^([a-z][a-z _-]{0,30}?)(?: x\d{1,5})?$/i;

/** Words a code-written shape may use (a closed set, so a shape can never carry page text). */
const SHAPE_WORDS = new Set(
  ('price prices amount date dates time count counts rating ratings phone email url link links id number numbers ' +
    'paragraph paragraphs text list lists item items carousel slide slides table row rows column columns card cards ' +
    'image images photo photos video media gallery field fields form step steps option options choice choices chip chips ' +
    'tab tabs menu button buttons record records result results review reviews comment comments heading headings')
    .split(' '),
);

/** Shapes are code-written ('price', 'list x12'): shape words plus an optional count; anything else is filtered. */
export function cleanShape(s: string): string {
  const m = SHAPE.exec(s.trim());
  if (m && m[1]!.toLowerCase().split(/[\s_-]+/).filter(Boolean).every((w) => SHAPE_WORDS.has(w))) return s.trim();
  return vocabOnly(s);
}

/**
 * Vocabulary-only text. A label the device already filtered passes unchanged (its "·" markers kept); a label with
 * any word outside the vocabulary, or any digit, is replaced by the filtered version.
 */
export function vocabOnly(s: string): string {
  const filtered = allowlistWords(s);
  return words(filtered) === words(s) ? s : filtered;
}

/** The generative model sees an allowlisted outline only: every label goes through the vocabulary filter again. */
export function sanitizeOutline(o: PageOutline): { outline: PageOutline; changed: number } {
  let changed = 0;
  const seen = new Set<string>();
  const nodes = [];
  for (const n of o.nodes) {
    if (seen.has(n.id)) continue; // duplicate ids would make the layout ambiguous
    seen.add(n.id);
    const label = vocabOnly(n.label);
    if (label !== n.label) changed++;
    const shape = n.shape === undefined ? undefined : cleanShape(n.shape);
    nodes.push({ ...n, label, ...(shape !== undefined ? { shape } : {}) });
  }
  // Parents that are not in the outline become roots.
  for (const n of nodes) if (n.parent !== undefined && (!seen.has(n.parent) || n.parent === n.id)) delete n.parent;
  return { outline: { ...o, nodes }, changed };
}

export function sanitizeRoles(roles: Record<string, Role>, outline: PageOutline): Record<string, Role> {
  const ids = new Set(outline.nodes.map((n) => n.id));
  const out: Record<string, Role> = {};
  for (const [id, role] of Object.entries(roles)) if (ids.has(id)) out[id] = role;
  return out;
}

/** Signals are code-written bands and short evidence sentences; any value that looks personal is dropped. */
export function sanitizeSignals(s: StruggleSignals): { signals: StruggleSignals; dropped: number } {
  let dropped = 0;
  const out: StruggleSignals = { page_kind: '', time_on_page: '', task_progress: '' };
  for (const [k, v] of Object.entries(s)) {
    if (stillSensitive(v)) {
      dropped++;
      if (k === 'page_kind' || k === 'time_on_page' || k === 'task_progress') out[k] = 'unknown';
      continue;
    }
    out[k] = v;
  }
  return { signals: out, dropped };
}

export function sanitizeVisual(r: VisualVerifyRequest): VisualVerifyRequest {
  return {
    ...r,
    controls: r.controls.map((s) => cleanLabel(s)),
    help: r.help.map((s) => cleanLabel(s)),
    mainLabel: r.mainLabel === null ? null : cleanLabel(r.mainLabel),
  };
}

/** Overlay evidence for Jev: labels and visible text redacted like element labels; class words kept to short words. */
export function sanitizeOverlay(o: OverlayEvidence): OverlayEvidence {
  return { ...o, label: cleanLabel(o.label), class_words: cleanWords(o.class_words) };
}

export function sanitizeOverlayButton(b: OverlayButtonEvidence): OverlayButtonEvidence {
  return { ...b, label: cleanLabel(b.label), visible_text: cleanLabel(b.visible_text, 8), class_words: cleanWords(b.class_words) };
}

function cleanWords(ws: string[]): string[] {
  return ws.map((w) => cleanLabel(w, 3)).filter((w) => w !== '' && !/\[[a-z]+\]/.test(w));
}
