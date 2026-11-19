/**
 * Copy rules from design-final.md 13, as a checker for unit tests. Used to lint
 * every message this layer can show a person.
 */

const BANNED = [
  /\bnormal\b/i,
  /\bdisab/i,
  /\bimpair/i,
  /\bpatient/i,
  /\bdiagnos/i,
  /\bsymptom/i,
  /\btest\b/i,
  /\bscore/i,
  /\bassessment/i,
  /\bresults?\b/i,
  /\boops\b/i,
  /\bsorry\b/i,
  /\bcompliant\b/i,
  /\bmagic\b/i,
  /\bseamless/i,
];

/** Problems with one message; empty when it follows the rules. */
export function copyProblems(message: string): string[] {
  const problems: string[] = [];
  if (message.includes('!')) problems.push('uses an exclamation mark');
  if (!/^[A-Z0-9"']/.test(message))
    problems.push('does not start in sentence case');
  if (/[A-Z]{3,}/.test(message.replace(/WebAble/g, '')))
    problems.push('uses all caps');
  for (const pattern of BANNED)
    if (pattern.test(message)) problems.push(`uses banned word ${pattern}`);
  for (const sentence of message.split(/(?<=[.?])\s+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean).length;
    if (words > 20) problems.push(`sentence over 20 words: "${sentence}"`);
  }
  if (!/[.?]$/.test(message.trim()))
    problems.push('does not end with a full stop');
  return problems;
}
