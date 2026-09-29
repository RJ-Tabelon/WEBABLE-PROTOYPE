'use client';

import {
  seededRandom,
  type PolarityTrial,
  type ReadingSession,
} from '@webable/core';
import {
  READING_SENTENCES,
  shuffleStimuli,
} from '@webable/core/calibration/stimuli';
import { useMemo, useRef, useState } from 'react';

import {
  elapsedSince,
  useContentWidth,
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
  maxFitPx,
  MIN_CHARS,
  MIN_CHARS_LARGE_PRINT,
  STIMULUS_FAMILY,
  wordCount,
} from './geometry';

type Stated = NonNullable<ReadingSession['statedPolarity']>;

export interface PolarityProps {
  /** S_p = the critical print size + 0.1 log (font px); capped here to S_fit. */
  targetPx: number;
  advanceEm: number;
  largePrint: boolean;
  seed: number;
  /** Sentence ids already used by the ladder, so none repeats. */
  usedCount: number;
  active: boolean;
  onDone: (trials: PolarityTrial[], stated: Stated | null) => void;
}

/**
 * V4 light and dark sentences (cal-vision §3): four true/false sentences near the
 * operational size in L-D-D-L or D-L-L-D order, then "Which felt easier?". Both
 * polarities are drawn inside the white stage; the stage itself never goes dark.
 */
export function Polarity({
  targetPx,
  advanceEm,
  largePrint,
  seed,
  usedCount,
  active,
  onDone,
}: PolarityProps) {
  const order = useMemo<Array<'light' | 'dark'>>(
    () =>
      seededRandom(seed ^ 0x7a11)() < 0.5
        ? ['light', 'dark', 'dark', 'light']
        : ['dark', 'light', 'light', 'dark'],
    [seed],
  );
  const sentences = useMemo(() => {
    const all = shuffleStimuli(READING_SENTENCES, seededRandom(seed));
    // Continue after the ladder's sentences so nothing is read twice.
    return [...all.slice(usedCount), ...all.slice(0, usedCount)];
  }, [seed, usedCount]);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageWidthPx = useContentWidth(stageRef, 560);
  const sentencePx = Math.max(
    12,
    Math.min(
      targetPx,
      maxFitPx(
        stageWidthPx,
        advanceEm,
        largePrint ? MIN_CHARS_LARGE_PRINT : MIN_CHARS,
      ),
    ),
  );
  const [trials, setTrials] = useState<PolarityTrial[]>([]);
  const index = trials.length;
  const reading = index < order.length;
  const polarity = order[index];
  const sentence = sentences[index % sentences.length];
  const onset = useStimulusOnset(reading ? index : null);
  const disturbed = useDisturbance(reading ? index : null);
  const answered = useRef(-1);
  const sent = useRef(false);

  const respond = (value: boolean | null) => {
    if (!reading || !sentence || !polarity || answered.current === index)
      return;
    answered.current = index;
    const rtMs = elapsedSince(onset.current);
    setTrials((prev) => [
      ...prev,
      {
        polarity,
        words: wordCount(sentence.text),
        // A disturbed trial carries no speed: record it as not valid.
        rtMs: disturbed.current ? 0 : rtMs,
        correct:
          !disturbed.current && value !== null && value === sentence.answer,
      },
    ]);
  };

  const choose = (stated: Stated) => {
    if (sent.current) return;
    sent.current = true;
    onDone(trials, stated);
  };

  useTaskKeys(
    { t: () => respond(true), f: () => respond(false), c: () => respond(null) },
    active && reading,
  );

  if (!reading) {
    return (
      <>
        <TaskHeading key="question">Which felt easier to read?</TaskHeading>
        <Deck>You just read both kinds. Any answer is fine.</Deck>
        <Responses label="Easier to read" layout="stack">
          <ResponseButton onPress={() => choose('light')}>
            <span className="tn-swatch tn-swatch--light" aria-hidden="true">
              Aa
            </span>
            Dark on light
          </ResponseButton>
          <ResponseButton onPress={() => choose('dark')}>
            <span className="tn-swatch tn-swatch--dark" aria-hidden="true">
              Aa
            </span>
            Light on dark
          </ResponseButton>
          <ResponseButton onPress={() => choose('same')}>
            About the same
          </ResponseButton>
        </Responses>
      </>
    );
  }

  const box = boxWidthPx(sentencePx, advanceEm, stageWidthPx);
  return (
    <>
      <TaskHeading key="read">Is it true?</TaskHeading>
      <Deck>
        Some of these are light text on dark. Read at your normal pace.
      </Deck>
      <Stage ref={stageRef} label="Sentence" className="tn-stage--center">
        {sentence ? (
          <p
            key={index}
            className={`tn-polarity-box tn-polarity-box--${polarity}`}
            style={{
              fontFamily: STIMULUS_FAMILY,
              fontSize: `${sentencePx}px`,
              lineHeight: 1.3,
              inlineSize: `${box}px`,
            }}
          >
            {sentence.text}
          </p>
        ) : null}
      </Stage>
      <Responses label="Your answer">
        <ResponseButton hotkey="t" onPress={() => respond(true)}>
          True
        </ResponseButton>
        <ResponseButton hotkey="f" onPress={() => respond(false)}>
          False
        </ResponseButton>
        <ResponseButton hotkey="c" onPress={() => respond(null)}>
          Can&rsquo;t read it
        </ResponseButton>
      </Responses>
    </>
  );
}
