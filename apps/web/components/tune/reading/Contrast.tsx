'use client';

import {
  createContrastStaircase,
  seededRandom,
  weberToGrey,
  type ContrastStaircase,
  type ContrastTrial,
} from '@webable/core';
import {
  CONTRAST_WORDS,
  shuffleStimuli,
} from '@webable/core/calibration/stimuli';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useContentBox, useTaskKeys } from '../shared/hooks';
import {
  Deck,
  ResponseButton,
  Responses,
  Stage,
  TaskHeading,
  useStimulusFontReady,
} from '../shared/primitives';
import { maxFitPx, MIN_CHARS, STIMULUS_FAMILY } from './geometry';

export interface ContrastProps {
  /** Word size S_c = 2 x the critical print size (font px); capped here to S_fit. */
  targetPx: number;
  advanceEm: number;
  largePrint: boolean;
  seed: number;
  active: boolean;
  onDone: (trials: ContrastTrial[]) => void;
}

interface Round {
  word: string;
  options: string[];
  weber: number;
}

/**
 * V3 "Which word is it?" (cal-vision §3): one grey word on white, four same-length
 * choices plus "I can't see a word", placed by the QUEST+ staircase (core).
 */
export function Contrast({
  targetPx,
  advanceEm,
  largePrint,
  seed,
  active,
  onDone,
}: ContrastProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useContentBox(stageRef, { width: 560, height: 0 });
  const fontReady = useStimulusFontReady();
  // One line of type, never taller than the stage (the answers stay in view).
  const heightFit = stage.height > 0 ? stage.height * 0.8 : Infinity;
  const wordPx = Math.max(
    12,
    Math.min(targetPx, maxFitPx(stage.width, advanceEm, MIN_CHARS), heightFit),
  );
  const staircase = useRef<ContrastStaircase | null>(null);
  if (staircase.current === null)
    staircase.current = createContrastStaircase({ largePrint });
  const random = useMemo(() => seededRandom(seed ^ 0x51ed), [seed]);
  const words = useMemo(
    () => shuffleStimuli(CONTRAST_WORDS, seededRandom(seed ^ 0xc0de)),
    [seed],
  );
  const [trials, setTrials] = useState<ContrastTrial[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const answered = useRef(-1);

  // Build the round for the current trial index.
  useEffect(() => {
    const stair = staircase.current;
    if (!stair || stair.done()) return;
    const entry = words[trials.length % words.length];
    if (!entry) return;
    setRound({
      word: entry.word,
      options: shuffleStimuli([entry.word, ...entry.distractors], random),
      weber: stair.next(),
    });
  }, [trials.length, words, random]);

  const done = trials.length > 0 && staircase.current?.done() === true;
  const sent = useRef(false);
  useEffect(() => {
    if (!done || sent.current) return;
    sent.current = true;
    onDone(trials);
  }, [done, onDone, trials]);

  const answer = (choice: string | null) => {
    const stair = staircase.current;
    if (!round || !stair || done || !fontReady) return;
    if (answered.current === trials.length) return;
    answered.current = trials.length;
    const cantSee = choice === null;
    const correct = !cantSee && choice === round.word;
    stair.update(correct);
    setTrials((prev) => [...prev, { weber: round.weber, correct, cantSee }]);
  };

  const keys: Record<string, () => void> = { c: () => answer(null) };
  round?.options.forEach((option, i) => {
    keys[String(i + 1)] = () => answer(option);
  });
  useTaskKeys(keys, active && !!round && !done && fontReady);

  return (
    <>
      <TaskHeading>Which word is it?</TaskHeading>
      <Deck>Pick the word you see. Some are very faint.</Deck>
      <Stage
        ref={stageRef}
        label="Word"
        className="tn-stage--center tn-stage--word"
      >
        {round && !done && fontReady ? (
          <p
            key={trials.length}
            className="tn-stimulus tn-stimulus-word"
            style={{
              fontFamily: STIMULUS_FAMILY,
              fontSize: `${wordPx}px`,
              color: weberToGrey(round.weber),
            }}
            aria-hidden="true"
          >
            {round.word}
          </p>
        ) : null}
      </Stage>
      {/* The four words and "I can't see a word" are one block of answers. */}
      <div className="tn-answers">
        <Responses label="The word" layout="grid">
          {(round?.options ?? ['', '', '', '']).map((option, i) => (
            <ResponseButton
              // Keyed by place, so the button with focus keeps it between trials.
              key={i}
              hotkey={String(i + 1)}
              onPress={() => answer(option)}
              disabled={!round}
            >
              {option}
            </ResponseButton>
          ))}
        </Responses>
        <div className="tn-controls">
          <ResponseButton hotkey="c" onPress={() => answer(null)}>
            I can&rsquo;t see a word
          </ResponseButton>
        </div>
      </div>
    </>
  );
}
