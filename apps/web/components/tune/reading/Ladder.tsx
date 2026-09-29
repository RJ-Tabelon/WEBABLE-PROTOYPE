'use client';

import {
  nextReadingSize,
  seededRandom,
  type ReadingTrial,
} from '@webable/core';
import {
  READING_SENTENCES,
  shuffleStimuli,
} from '@webable/core/calibration/stimuli';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  elapsedSince,
  useDisturbance,
  useStimulusOnset,
  useTaskKeys,
} from '../shared/hooks';
import {
  Deck,
  ResponseButton,
  Responses,
  Stage,
  TaskHeading,
} from '../shared/primitives';
import {
  boxWidthPx,
  ladderStartPx,
  maxFitPx,
  MIN_CHARS,
  MIN_CHARS_LARGE_PRINT,
  STIMULUS_FAMILY,
  wordCount,
  type StimulusMetrics,
} from './geometry';

type Answer = ReadingTrial['response'];

export interface LadderProps {
  comfortPx: number;
  metrics: StimulusMetrics;
  largePrint: boolean;
  seed: number;
  /** False while paused: keys are ignored. */
  active: boolean;
  /** Changes on every resume from Pause; a trial open across a pause is marked disturbed. */
  epoch: number;
  onDone: (trials: ReadingTrial[], displayLimited: boolean) => void;
}

function contentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return (
    el.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight)
  );
}

/**
 * V2 reading ladder (cal-vision §3): true/false sentences, descending in 0.2 log
 * steps while reading stays fast, then 0.1 steps to bracket the knee. The walk
 * itself is `nextReadingSize` (core); this screen shows, times and records.
 */
export function Ladder({
  comfortPx,
  metrics,
  largePrint,
  seed,
  active,
  epoch,
  onDone,
}: LadderProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<{
    width: number;
    fitPx: number;
    startPx: number;
  } | null>(null);
  const [trials, setTrials] = useState<ReadingTrial[]>([]);
  const sentences = useMemo(
    () => shuffleStimuli(READING_SENTENCES, seededRandom(seed)),
    [seed],
  );

  // S_fit and S0 are fixed once, from the stage width when the screen opens.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const width = Math.max(200, contentWidth(el));
    const fitPx = maxFitPx(
      width,
      metrics.advanceEm,
      largePrint ? MIN_CHARS_LARGE_PRINT : MIN_CHARS,
    );
    setGeometry({ width, fitPx, startPx: ladderStartPx(comfortPx, fitPx) });
  }, [comfortPx, largePrint, metrics.advanceEm]);

  const size = geometry
    ? nextReadingSize({
        trials,
        startPx: geometry.startPx,
        maxFitPx: geometry.fitPx,
      })
    : null;
  const index = trials.length;
  const sentence = sentences[index % sentences.length];
  const trialKey = size === null ? null : index;
  const onset = useStimulusOnset(trialKey);
  const disturbed = useDisturbance(trialKey);
  const epochAtOnset = useRef(epoch);
  const answered = useRef<number>(-1);

  useEffect(() => {
    epochAtOnset.current = epoch;
    // Only on a new trial; a resume keeps the old epoch so the open trial is marked.
  }, [trialKey]);

  const finished = geometry !== null && size === null && trials.length > 0;
  const doneSent = useRef(false);
  useEffect(() => {
    if (!finished || doneSent.current || !geometry) return;
    doneSent.current = true;
    const last = trials[trials.length - 1];
    const displayLimited =
      !!last &&
      trials.length > 1 &&
      last.fontPx >= geometry.fitPx * 0.99 &&
      (last.response === 'cant' || !last.correct);
    onDone(trials, displayLimited);
  }, [finished, geometry, onDone, trials]);

  const respond = (response: Answer) => {
    if (size === null || !sentence || answered.current === index) return;
    answered.current = index;
    const rtMs = elapsedSince(onset.current);
    const correct =
      response !== 'cant' && (response === 'true') === sentence.answer;
    setTrials((prev) => [
      ...prev,
      {
        fontPx: size,
        xHeightPx: Math.round(size * metrics.xHeightRatio * 100) / 100,
        words: wordCount(sentence.text),
        response,
        correct,
        rtMs,
        disturbed: disturbed.current || epochAtOnset.current !== epoch,
      },
    ]);
  };

  useTaskKeys(
    {
      t: () => respond('true'),
      f: () => respond('false'),
      c: () => respond('cant'),
      ArrowLeft: () => respond('true'),
      ArrowRight: () => respond('false'),
      ArrowDown: () => respond('cant'),
    },
    active && size !== null,
  );

  return (
    <>
      <TaskHeading>Is it true?</TaskHeading>
      <Deck>
        Read each sentence at your normal pace, then answer. Can&rsquo;t read it
        is always a fine answer.
      </Deck>
      <Stage ref={stageRef} label="Sentence" className="tn-stage--center">
        {geometry && size !== null && sentence ? (
          <p
            key={index}
            className="tn-stimulus-text tn-stimulus-text--box"
            style={{
              fontFamily: STIMULUS_FAMILY,
              fontSize: `${size}px`,
              lineHeight: 1.3,
              inlineSize: `${boxWidthPx(size, metrics.advanceEm, geometry.width)}px`,
            }}
          >
            {sentence.text}
          </p>
        ) : null}
      </Stage>
      <Responses label="Your answer">
        <ResponseButton hotkey="t" onPress={() => respond('true')}>
          True
        </ResponseButton>
        <ResponseButton hotkey="f" onPress={() => respond('false')}>
          False
        </ResponseButton>
        <ResponseButton hotkey="c" onPress={() => respond('cant')}>
          Can&rsquo;t read it
        </ResponseButton>
      </Responses>
    </>
  );
}
