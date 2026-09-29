/**
 * VOCAB_V1: a bundled, reviewed, public list of ~1,500 lowercase English UI and
 * web-structure words. Health, finance, religion, sexuality and politics terms,
 * and all proper nouns, are excluded. Only these words can leave the device,
 * so the set of possible page-analysis payload strings is enumerable.
 */
export const VOCAB_V1: ReadonlySet<string> = new Set<string>();

/** Split on non-letters and camelCase, lowercase, keep 2-20 letter tokens. */
export function tokenize(_text: string): string[] {
  throw new Error('not implemented');
}

/**
 * Keep only vocabulary words, collapse runs of dropped tokens to a single '·',
 * cap at `max` words. "Welcome back, Caden" -> ["welcome", "back", "·"].
 */
export function vocabFilter(_text: string, _max?: number): string[] {
  throw new Error('not implemented');
}

export function isVocabWord(_word: string): boolean {
  throw new Error('not implemented');
}
