// The onboarding's steps and their words (docs/design/ONBOARDING.md, "The flow" and round 8c). Nothing here tells the
// person a result: what we learned is shown once, at the end. Pure data and functions, so the words can be checked
// without a browser.

import type { BrowserSettings, InputClass } from '@webable/core';

export type StepId = 'size' | 'truefalse' | 'faint' | 'lightdark' | 'dots' | 'find' | 'context';
export type PartId = 'reading' | 'pointing' | 'finding' | 'context';

export const PARTS: Array<{ id: PartId; label: string }> = [
  { id: 'reading', label: 'Reading' },
  { id: 'pointing', label: 'Pointing' },
  { id: 'finding', label: 'Finding' },
  // Round 10: the last step, bringing in what the person's AI assistant knows about how they like things explained.
  { id: 'context', label: 'Your context' },
];

export const PART_OF: Record<StepId, PartId> = {
  size: 'reading',
  truefalse: 'reading',
  faint: 'reading',
  lightdark: 'reading',
  dots: 'pointing',
  find: 'finding',
  context: 'context',
};

const ORDER: StepId[] = ['size', 'truefalse', 'faint', 'lightdark', 'dots', 'find', 'context'];

/**
 * The steps this person does. Keyboard users skip the dots (WebAble never changes keyboard use). With the system's own
 * colours on, the faint word and light-or-dark steps are left out: the system's colours win, and grey text cannot be
 * shown faithfully anyway.
 */
export function planSteps(input: InputClass, settings: BrowserSettings | null): StepId[] {
  return ORDER.filter((s) => {
    if (s === 'dots') return input !== 'keyboard';
    if (s === 'faint' || s === 'lightdark') return !settings?.forcedColors;
    return true;
  });
}

export function partsFor(steps: StepId[]): Array<{ id: PartId; label: string }> {
  const used = new Set(steps.map((s) => PART_OF[s]));
  return PARTS.filter((p) => used.has(p.id));
}

export interface StepWords {
  title: string;
  /** What to do, in one sentence. */
  todo: string;
  /** What counts as success, in one sentence. */
  success: string;
}

export function wordsFor(step: StepId, input: InputClass): StepWords {
  const touch = input === 'touch';
  switch (step) {
    case 'size':
      return {
        title: 'Pick a comfortable size',
        todo: 'Make the words larger or smaller until they feel easy to read.',
        success: 'Any size is right if it feels relaxed to you.',
      };
    case 'truefalse':
      return {
        title: 'True or false?',
        todo: 'Read each short sentence and say whether it is true or false.',
        success: 'The words get smaller as you go. When you can’t read one, just say so.',
      };
    case 'faint':
      return {
        title: 'Which word is it?',
        todo: 'A word appears, a little lighter each time. Pick it from the four below it.',
        success: 'When you can’t see a word, say so. That helps as much as an answer.',
      };
    case 'lightdark':
      return {
        title: 'Light or dark?',
        todo: 'Read two sentences on a light page and two on a dark one, then pick the easier one.',
        success: 'There is no better choice, only the one that suits your eyes.',
      };
    case 'dots':
      return {
        title: touch ? 'Tap the dots' : 'Click the dots',
        todo: `${touch ? 'Tap' : 'Click'} each dot as it fills in, at your usual pace.`,
        success: 'Close is fine. A miss tells us just as much.',
      };
    case 'find':
      // Round 8c: the Finding part happens on real websites.
      return {
        title: 'Now, some real websites',
        todo: 'We’ll open three websites, one at a time. On each one, find what we ask for and click it.',
        success: 'WebAble stays off while you do this, so we see the web as it really is.',
      };
    case 'context':
      // Round 10: the person's AI answer, read while "You're all set" shows; what WebAble took from it is on Results.
      return {
        title: 'Bring your context',
        todo: 'Ask the AI you use most one question, then paste its answer here.',
        success: 'Its answer tells WebAble how you like things explained. No AI? Skip this one.',
      };
  }
}

/** "Reading · 2 of 4", or just "Pointing" when the part has one step. */
export function eyebrowFor(step: StepId, steps: StepId[]): string {
  const part = PART_OF[step];
  const label = PARTS.find((p) => p.id === part)?.label ?? '';
  const inPart = steps.filter((s) => PART_OF[s] === part);
  if (inPart.length < 2) return label;
  return `${label} · ${inPart.indexOf(step) + 1} of ${inPart.length}`;
}

/** "Reading is done." when the step before this one finished a part. A neutral transition: it never says a result. */
export function partSetLine(prev: StepId | null, next: StepId): string | null {
  if (!prev || PART_OF[prev] === PART_OF[next]) return null;
  const label = PARTS.find((p) => p.id === PART_OF[prev])?.label ?? '';
  return `${label} is done.`;
}

/** "Did anything get in your way?": the chips, and the words core reads from them (also RunEvidence.gotInWay ids). */
export const IN_THE_WAY: Array<{ id: string; label: string }> = [
  { id: 'moving things', label: 'Moving things' },
  { id: 'popups', label: 'Pop-ups' },
  { id: 'too much on the page', label: 'Too much on the page' },
  { id: 'small text', label: 'Small text' },
];
