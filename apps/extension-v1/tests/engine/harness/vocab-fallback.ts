/**
 * Test-only stand-in for @webable/core's vocabFilter, used by the harness and
 * unit tests only if the core implementation is unavailable. Same contract:
 * split on non-letters and camelCase, keep 2-20 letter vocabulary words,
 * collapse runs of dropped tokens to one '·', cap at `max` words.
 */
const WORDS = new Set(
  (
    'about accept account ad ads advertisement all also article banner basket buy cart chat close ' +
    'comment comments consent contact content cookie cookies desk feed filter footer grid header help ' +
    'home like links list main may menu messenger more most news newsletter notice open page popular ' +
    'privacy promo promoted rail read recommended related remove reject rail search share shop sidebar ' +
    'site slideshow sort sponsored sport stories subscribe support trending view weather widget with you'
  ).split(/\s+/),
);

export function fallbackTokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .filter((t) => t.length >= 2 && t.length <= 20)
    .map((t) => t.toLowerCase());
}

export function fallbackVocab(text: string, max = 6): string[] {
  const out: string[] = [];
  let kept = 0;
  for (const t of fallbackTokenize(text)) {
    if (kept >= max) break;
    if (WORDS.has(t)) {
      out.push(t);
      kept++;
    } else if (out[out.length - 1] !== '·') {
      out.push('·');
    }
  }
  return out;
}
