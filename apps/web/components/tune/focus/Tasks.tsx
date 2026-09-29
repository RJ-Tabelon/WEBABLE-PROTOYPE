'use client';

import type {
  FindTextTrial,
  FocusSession,
  NextActionTrial,
} from '@webable/core';
import { Button } from '@webable/ui';
import { useEffect, useRef, useState } from 'react';

import { elapsedSince, useStimulusOnset } from '../shared/hooks';
import {
  Deck,
  OptionGroup,
  Stage,
  TaskHeading,
  type ChoiceOption,
} from '../shared/primitives';
import { FlowPage, MockPage, TextPage, Thumbnail } from './pages';
import {
  FLOWS,
  orientedPreference,
  TEMPLATES,
  type NextPlanTrial,
  type PairPlan,
  type ScaleAnswer,
  type SearchPlanTrial,
  type TextPlanTrial,
} from './plan';

/* ---------- Task B: What's next? ---------- */

export interface NextActionProps {
  plan: readonly NextPlanTrial[];
  basePx: number;
  active: boolean;
  epoch: number;
  onDone: (trials: NextActionTrial[]) => void;
}

/**
 * Task B (cal-attention §4.2): the goal is stated without the button's words;
 * the first click ends the trial, with no right or wrong shown.
 */
export function NextAction({
  plan,
  basePx,
  active,
  epoch,
  onDone,
}: NextActionProps) {
  const [index, setIndex] = useState(0);
  const trials = useRef<NextActionTrial[]>([]);
  const goalRef = useRef<HTMLParagraphElement>(null);
  const sent = useRef(false);
  const trial = plan[index];
  const onset = useStimulusOnset(trial ? `${index}-${epoch}` : null);

  useEffect(() => {
    if (index > 0) goalRef.current?.focus({ preventScroll: true });
  }, [index]);

  if (!trial) return null;
  const flow = FLOWS[trial.flow];

  const pick = (which: 'target' | 'decoy' | 'other') => {
    if (!active) return;
    trials.current.push({
      hierarchy: trial.hierarchy,
      rtMs: elapsedSince(onset.current),
      firstClick: which,
    });
    if (index + 1 >= plan.length) {
      if (!sent.current) {
        sent.current = true;
        onDone(trials.current);
      }
      return;
    }
    setIndex(index + 1);
  };

  return (
    <>
      <TaskHeading>What would you do next?</TaskHeading>
      <p
        ref={goalRef}
        tabIndex={-1}
        className="tn-deck tn-goal"
        aria-live="polite"
      >
        {flow.goal}
      </p>
      <Stage label="Page" bleed className="tn-stage--page">
        <FlowPage
          key={index}
          flow={flow}
          hierarchy={trial.hierarchy}
          decoyFirst={trial.decoyFirst}
          onPick={pick}
          basePx={basePx}
        />
      </Stage>
    </>
  );
}

/* ---------- Task C: Find in text ---------- */

export interface FindTextProps {
  plan: readonly TextPlanTrial[];
  /** Keyboard and touch answer from three choices (cal-attention §4.3). */
  choicesFirst: boolean;
  basePx: number;
  active: boolean;
  epoch: number;
  onDone: (trials: FindTextTrial[]) => void;
}

export function FindText({
  plan,
  choicesFirst,
  basePx,
  active,
  epoch,
  onDone,
}: FindTextProps) {
  const [index, setIndex] = useState(0);
  const [useChoices, setUseChoices] = useState(choicesFirst);
  const trials = useRef<FindTextTrial[]>([]);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const sent = useRef(false);
  const trial = plan[index];
  const onset = useStimulusOnset(trial ? `${index}-${epoch}` : null);

  useEffect(() => {
    if (index > 0) questionRef.current?.focus({ preventScroll: true });
  }, [index]);

  if (!trial) return null;
  const { passage, format } = trial;

  const answer = (sentence: number) => {
    if (!active) return;
    trials.current.push({
      format,
      rtMs: elapsedSince(onset.current),
      correct: sentence === passage.answerIndex,
    });
    if (index + 1 >= plan.length) {
      if (!sent.current) {
        sent.current = true;
        onDone(trials.current);
      }
      return;
    }
    setIndex(index + 1);
  };

  return (
    <>
      <TaskHeading>Find the answer.</TaskHeading>
      <p
        ref={questionRef}
        tabIndex={-1}
        className="tn-deck tn-goal"
        aria-live="polite"
      >
        <span className="tn-goal__question">{passage.question}</span>{' '}
        {useChoices
          ? 'Read the page, then pick the sentence that answers it.'
          : 'Click the sentence that answers it.'}
      </p>
      <Stage label="Page" className="tn-stage--page tn-stage--text">
        <TextPage
          key={index}
          passage={passage}
          format={format}
          onPickSentence={useChoices ? undefined : answer}
          basePx={basePx}
        />
      </Stage>
      {useChoices ? (
        <div
          className="tn-choices"
          role="group"
          aria-label="Which sentence answers it?"
        >
          {passage.choices.map((i) => (
            <Button
              key={`${index}-${i}`}
              variant="secondary"
              size="task"
              block
              className="tn-choice"
              onClick={() => answer(i)}
            >
              {passage.sentences[i]}
            </Button>
          ))}
        </div>
      ) : (
        <div className="tn-controls tn-controls--end">
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              setUseChoices(true);
              // The button goes away: keep focus on the question.
              questionRef.current?.focus({ preventScroll: true });
            }}
          >
            Choose from a list instead
          </Button>
        </div>
      )}
    </>
  );
}

/* ---------- Task D: Which worked better for you? ---------- */

const SCALE: ReadonlyArray<ChoiceOption<string>> = [
  { value: '2', label: 'Version 1', hint: 'clearly' },
  { value: '1', label: 'Version 1', hint: 'a little' },
  { value: '0', label: 'About', hint: 'the same' },
  { value: '-1', label: 'Version 2', hint: 'a little' },
  { value: '-2', label: 'Version 2', hint: 'clearly' },
];

export interface PreferencesProps {
  pairs: readonly PairPlan[];
  search: readonly SearchPlanTrial[];
  next: readonly NextPlanTrial[];
  text: readonly TextPlanTrial[];
  reducedMotion: boolean;
  onDone: (preferences: FocusSession['preferences']) => void;
}

/**
 * Four post-use comparisons of the pages just used, on a -2..2 scale, with
 * sides randomized (cal-attention §4.4). "About the same" is always fine, and
 * Continue without a choice records no preference.
 */
export function Preferences({
  pairs,
  search,
  next,
  text,
  reducedMotion,
  onDone,
}: PreferencesProps) {
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const answers = useRef<FocusSession['preferences']>({
    still: null,
    clean: null,
    chunked: null,
    hierarchy: null,
  });
  const pair = pairs[index];
  if (!pair) return null;

  const sample = search.find((t) => !t.practice) ?? search[0];
  const flow = next[0];
  const passage = text[0];

  const version = (adapted: boolean) => {
    if (pair.id === 'still' && sample) {
      const template = TEMPLATES[sample.template];
      const moving = reducedMotion ? 'salient' : 'animated';
      return (
        <MockPage
          template={template}
          clutter="clean"
          motion={adapted ? 'still' : moving}
          sources={[]}
          mirror={false}
          links={sample.links}
          interactive={false}
        />
      );
    }
    if (pair.id === 'clean' && sample) {
      return (
        <MockPage
          template={TEMPLATES[sample.template]}
          clutter={adapted ? 'clean' : 'busy'}
          motion="still"
          sources={[]}
          mirror={false}
          links={sample.links}
          interactive={false}
        />
      );
    }
    if (pair.id === 'chunked' && passage) {
      return (
        <TextPage
          passage={passage.passage}
          format={adapted ? 'chunked' : 'dense'}
        />
      );
    }
    if (flow) {
      return (
        <FlowPage
          flow={FLOWS[flow.flow]}
          hierarchy={adapted ? 'strong' : 'weak'}
          decoyFirst={flow.decoyFirst}
          interactive={false}
        />
      );
    }
    return null;
  };

  const caption = (adapted: boolean, n: 1 | 2) => {
    if (pair.id !== 'still') return `Version ${n}`;
    if (adapted) return `Version ${n}, still`;
    return reducedMotion
      ? `Version ${n}, with a bright block`
      : `Version ${n}, with moving parts`;
  };

  const advance = () => {
    const value =
      choice === null
        ? null
        : orientedPreference(Number(choice) as ScaleAnswer, pair.adaptedFirst);
    answers.current = { ...answers.current, [pair.id]: value };
    setChoice(null);
    if (index + 1 >= pairs.length) onDone(answers.current);
    else setIndex(index + 1);
  };

  return (
    <>
      <TaskHeading key={pair.id} eyebrow="Which worked better for you?">
        {pair.question}
      </TaskHeading>
      <div className="tn-pair">
        <Thumbnail label={caption(pair.adaptedFirst, 1)}>
          {version(pair.adaptedFirst)}
        </Thumbnail>
        <Thumbnail label={caption(!pair.adaptedFirst, 2)}>
          {version(!pair.adaptedFirst)}
        </Thumbnail>
      </div>
      <OptionGroup
        legend={pair.question}
        hideLegend
        options={SCALE}
        value={choice}
        onChange={setChoice}
        className="tn-options--scale"
      />
      <div className="tn-controls">
        <Button variant="primary" size="task" arrow="forward" onClick={advance}>
          Continue
        </Button>
      </div>
    </>
  );
}

/* ---------- "Did anything get in your way?" ---------- */

type Chip = FocusSession['chips'][number];

const CHIPS: ReadonlyArray<ChoiceOption<Chip>> = [
  { value: 'moving', label: 'Moving things' },
  { value: 'busy', label: 'Too much on screen' },
  { value: 'long_text', label: 'Long blocks of text' },
  { value: 'unclear_action', label: 'Hard to tell what to click' },
  { value: 'nothing', label: 'Nothing' },
];

export function Chips({
  onDone,
  screenReader,
}: {
  onDone: (chips: Chip[]) => void;
  screenReader: boolean;
}) {
  const [chips, setChips] = useState<Chip[]>([]);
  const change = (next: Chip[]) => {
    const added = next.find((c) => !chips.includes(c));
    if (added === 'nothing') setChips(['nothing']);
    else setChips(next.filter((c) => c !== 'nothing'));
  };
  return (
    <>
      <TaskHeading>
        {screenReader
          ? 'Does anything on web pages get in your way?'
          : 'Did anything get in your way?'}
      </TaskHeading>
      <Deck>
        Choose any that apply, or Nothing. Leaving it blank is fine too.
      </Deck>
      <OptionGroup
        legend="Things that got in the way"
        hideLegend
        multiple
        options={CHIPS}
        value={chips}
        onChange={change}
      />
      <div className="tn-controls">
        <Button
          variant="primary"
          size="task"
          arrow="forward"
          onClick={() => onDone(chips)}
        >
          Continue
        </Button>
      </div>
    </>
  );
}
