/**
 * The Tune battery as an ordered list of screens (design-final §9, cal-vision §3,
 * cal-motor §5.1, cal-attention §4). One purpose per screen. Which screens run for
 * a person is decided by `isStepActive` from their setup and what has happened so
 * far; nothing here touches the DOM.
 */

export type ModuleId = 'reading' | 'pointing' | 'focus';

export const MODULES: readonly ModuleId[] = ['reading', 'pointing', 'focus'];

export const MODULE_LABEL: Readonly<Record<ModuleId, string>> = {
  reading: 'Reading',
  pointing: 'Pointing',
  focus: 'Focus',
};

export type StepId =
  | 'intro'
  | 'resume'
  | 'sr-route'
  | 'reading.comfort'
  | 'reading.ladder'
  | 'reading.contrast'
  | 'reading.polarity'
  | 'reading.preview'
  | 'before.pointing'
  | 'pointing.keyboard'
  | 'pointing.warmup'
  | 'pointing.ring'
  | 'pointing.hold'
  | 'pointing.drag'
  | 'pointing.return'
  | 'pointing.preview'
  | 'before.focus'
  | 'focus.search'
  | 'focus.next'
  | 'focus.text'
  | 'focus.prefs'
  | 'focus.chips'
  | 'fit'
  | 'done';

/** Every screen of the battery, in order. `resume` replaces `intro` when a saved Tune exists. */
export const STEP_ORDER: readonly StepId[] = [
  'intro',
  'sr-route',
  'reading.comfort',
  'reading.ladder',
  'reading.contrast',
  'reading.polarity',
  'reading.preview',
  'before.pointing',
  'pointing.keyboard',
  'pointing.warmup',
  'pointing.ring',
  'pointing.hold',
  'pointing.drag',
  'pointing.return',
  'pointing.preview',
  'before.focus',
  'focus.search',
  'focus.next',
  'focus.text',
  'focus.prefs',
  'focus.chips',
  'fit',
  'done',
];

export interface StepInfo {
  module: ModuleId | null;
  /**
   * Position of the task inside its module for the ruler, counted in tasks done
   * when the screen opens. Lead-in screens (`before.*`) are 0.
   */
  taskIndex: number;
  /** Rough time for the screen, seconds (words only, never shown as a clock). */
  estimateSec: number;
  /** Whether "Pause" and "Skip this part" are offered. */
  actions: boolean;
}

export const STEP_INFO: Readonly<Record<StepId, StepInfo>> = {
  intro: { module: null, taskIndex: 0, estimateSec: 0, actions: false },
  resume: { module: null, taskIndex: 0, estimateSec: 0, actions: false },
  'sr-route': { module: null, taskIndex: 0, estimateSec: 6, actions: false },
  'reading.comfort': {
    module: 'reading',
    taskIndex: 0,
    estimateSec: 15,
    actions: true,
  },
  'reading.ladder': {
    module: 'reading',
    taskIndex: 1,
    estimateSec: 45,
    actions: true,
  },
  'reading.contrast': {
    module: 'reading',
    taskIndex: 2,
    estimateSec: 20,
    actions: true,
  },
  'reading.polarity': {
    module: 'reading',
    taskIndex: 3,
    estimateSec: 25,
    actions: true,
  },
  'reading.preview': {
    module: 'reading',
    taskIndex: 4,
    estimateSec: 15,
    actions: true,
  },
  'before.pointing': {
    module: 'pointing',
    taskIndex: 0,
    estimateSec: 5,
    actions: true,
  },
  'pointing.keyboard': {
    module: 'pointing',
    taskIndex: 0,
    estimateSec: 5,
    actions: false,
  },
  'pointing.warmup': {
    module: 'pointing',
    taskIndex: 0,
    estimateSec: 8,
    actions: true,
  },
  'pointing.ring': {
    module: 'pointing',
    taskIndex: 1,
    estimateSec: 50,
    actions: true,
  },
  'pointing.hold': {
    module: 'pointing',
    taskIndex: 2,
    estimateSec: 12,
    actions: true,
  },
  'pointing.drag': {
    module: 'pointing',
    taskIndex: 3,
    estimateSec: 15,
    actions: true,
  },
  'pointing.return': {
    module: 'pointing',
    taskIndex: 4,
    estimateSec: 8,
    actions: true,
  },
  'pointing.preview': {
    module: 'pointing',
    taskIndex: 5,
    estimateSec: 12,
    actions: true,
  },
  'before.focus': {
    module: 'focus',
    taskIndex: 0,
    estimateSec: 8,
    actions: true,
  },
  'focus.search': {
    module: 'focus',
    taskIndex: 0,
    estimateSec: 40,
    actions: true,
  },
  'focus.next': {
    module: 'focus',
    taskIndex: 1,
    estimateSec: 15,
    actions: true,
  },
  'focus.text': {
    module: 'focus',
    taskIndex: 2,
    estimateSec: 30,
    actions: true,
  },
  'focus.prefs': {
    module: 'focus',
    taskIndex: 3,
    estimateSec: 20,
    actions: true,
  },
  'focus.chips': {
    module: 'focus',
    taskIndex: 4,
    estimateSec: 8,
    actions: true,
  },
  fit: { module: null, taskIndex: 0, estimateSec: 0, actions: false },
  done: { module: null, taskIndex: 0, estimateSec: 0, actions: false },
};

/** Task counts per module; the ruler draws sections in proportion to them. */
export const MODULE_TASKS: Readonly<Record<ModuleId, number>> = {
  reading: 5,
  pointing: 6,
  focus: 5,
};

export function moduleOf(step: StepId): ModuleId | null {
  return STEP_INFO[step].module;
}

export function stepsOfModule(module: ModuleId): StepId[] {
  return STEP_ORDER.filter((step) => STEP_INFO[step].module === module);
}

/** Setup chosen on the intro screen, plus what the browser says. */
export interface Setup {
  input: 'mouse' | 'trackpad' | 'touch' | 'keyboard';
  assistive: 'none' | 'screen-reader' | 'magnifier';
  /** The OS or the person's WebAble profile asks for less motion. */
  reducedMotion: boolean;
  /** Forced colours: contrast and polarity cannot be measured. */
  forcedColors: boolean;
  /** /tune?recalibrate=1 with a current fit to compare against. */
  recalibrate: boolean;
}

/** What `isStepActive` needs to know beyond the setup. */
export interface StepContext {
  setup: Setup | null;
  /** The ring ran in express mode (cal-motor §5.1): drag and the return block are skipped. */
  express: boolean;
  /** Seconds since pointing began, when it has. */
  pointingElapsedSec: number | null;
  /** A saved Tune exists, so `resume` replaces `intro`. */
  hasStash: boolean;
}

/** Return block is auto-skipped once pointing has taken longer than this (cal-motor §5.1). */
export const RETURN_BLOCK_CUTOFF_SEC = 150;

export function isStepActive(step: StepId, ctx: StepContext): boolean {
  const setup = ctx.setup;
  if (step === 'intro') return !ctx.hasStash;
  if (step === 'resume') return ctx.hasStash;
  if (step === 'fit' || step === 'done') return true;
  if (!setup) return false;
  const screenReader = setup.assistive === 'screen-reader';
  const keyboard = setup.input === 'keyboard';
  switch (step) {
    case 'sr-route':
      return screenReader;
    case 'reading.comfort':
    case 'reading.ladder':
    case 'reading.preview':
      return !screenReader;
    case 'reading.contrast':
    case 'reading.polarity':
      return !screenReader && !setup.forcedColors;
    case 'before.pointing':
      return !keyboard;
    case 'pointing.keyboard':
      return keyboard;
    case 'pointing.warmup':
    case 'pointing.ring':
    case 'pointing.hold':
    case 'pointing.preview':
      return !keyboard;
    case 'pointing.drag':
      return !keyboard && !ctx.express;
    case 'pointing.return':
      return (
        !keyboard &&
        !ctx.express &&
        (ctx.pointingElapsedSec === null ||
          ctx.pointingElapsedSec <= RETURN_BLOCK_CUTOFF_SEC)
      );
    case 'before.focus':
      return true;
    case 'focus.search':
    case 'focus.next':
    case 'focus.text':
    case 'focus.prefs':
      return !screenReader;
    case 'focus.chips':
      return true;
  }
}

/** The first active step after `from` (exclusive), or `fit`. */
export function nextActiveStep(from: StepId, ctx: StepContext): StepId {
  const start = STEP_ORDER.indexOf(from);
  for (let i = start + 1; i < STEP_ORDER.length; i++) {
    const step = STEP_ORDER[i];
    if (step && isStepActive(step, ctx)) return step;
  }
  return 'done';
}

/** The first active step of a module, or the first active step after it. */
export function firstStepOfModule(module: ModuleId, ctx: StepContext): StepId {
  const steps = stepsOfModule(module);
  const first = steps.find((step) => isStepActive(step, ctx));
  if (first) return first;
  const last = steps[steps.length - 1];
  return last ? nextActiveStep(last, ctx) : 'fit';
}

/** The first active step after every screen of `module`. */
export function stepAfterModule(module: ModuleId, ctx: StepContext): StepId {
  const steps = stepsOfModule(module);
  const last = steps[steps.length - 1];
  return last ? nextActiveStep(last, ctx) : 'fit';
}
