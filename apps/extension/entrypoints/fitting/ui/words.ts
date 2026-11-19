// The words on the steps' own headings and buttons, in one place, so a host (the phone study) can say them its own
// way without changing what the steps measure. The defaults are the onboarding's words. A `…Line` is one instruction
// that stays on screen under the heading while the step runs; the onboarding has none.

import { createContext } from 'preact';

export interface StepLabels {
  sizeTitle: string;
  smaller: string;
  larger: string;
  comfortable: string;
  sizeLine?: string;
  /** Said in place of sizeLine when the bigger (or smaller) button can go no further. */
  sizeMax?: string;
  sizeMin?: string;
  /** The paragraph to size (default: content/sentences.ts COMFORT_PARAGRAPH). */
  sizeText?: string;
  tfTitle: string;
  yes: string;
  no: string;
  cantRead: string;
  tfLine?: string;
  faintTitle: string;
  cantSee: string;
  faintLine?: string;
  ldAskTitle: string;
  light: string;
  dark: string;
  same: string;
  ldLine?: string;
  dotsTitle: (touch: boolean) => string;
  dotsLine?: string;
  /** The instruction card's two buttons. */
  skipStep: string;
  startStep: string;
}

export const DEFAULT_LABELS: StepLabels = {
  sizeTitle: 'Pick a comfortable size',
  smaller: 'Smaller',
  larger: 'Larger',
  comfortable: 'This is comfortable',
  tfTitle: 'True or false?',
  yes: 'True',
  no: 'False',
  cantRead: 'I can’t read it',
  faintTitle: 'Which word is it?',
  cantSee: 'I can’t see a word',
  ldAskTitle: 'Which felt easier to read?',
  light: 'Light',
  dark: 'Dark',
  same: 'About the same',
  dotsTitle: (touch) => (touch ? 'Tap the dots' : 'Click the dots'),
  skipStep: 'Skip this one',
  startStep: 'Start',
};

export const StepLabelsContext = createContext<StepLabels>(DEFAULT_LABELS);
