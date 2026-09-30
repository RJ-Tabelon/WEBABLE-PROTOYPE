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
  useContentBox,
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
  useStimulusFontReady,
} from '../shared/primitives';
import {
  boxWidthPx,
  maxFitHeightPx,
  maxFitPx,
  MIN_CHARS,
  MIN_CHARS_LARGE_PRINT,
  STIMULUS_FAMILY,
  wordCount,
} from './geometry';

type Stated = NonNullable<ReadingSession['statedPolarity']>;

const LINE_HEIGHT = 1.3;
/** The light and dark boxes' padding around the text (tune.css). */
const BOX_INSET_INLINE = 40;
const BOX_INSET_BLOCK = 32;

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
  const stage = useContentBox(stageRef, { width: 560, height: 0 });
  const stageWidthPx = stage.width;
  const fontReady = useStimulusFontReady();
  const widthFitPx = Math.min(
    targetPx,
    maxFitPx(
      stageWidthPx,
      advanceEm,
      largePrint ? MIN_CHARS_LARGE_PRINT : MIN_CHARS,
    ),
  );
  // The light and dark boxes fit the stage, so the answers stay in view.
  const sentencePx = Math.max(
    12,
    maxFitHeightPx({
      heightPx: stage.height,
      widthPx: stageWidthPx,
      advanceEm,
      lineHeight: LINE_HEIGHT,
      maxPx: widthFitPx,
      insetInlinePx: BOX_INSET_INLINE,
      insetBlockPx: BOX_INSET_BLOCK,
    }),
  );
  const [trials, setTrials] = useState<PolarityTrial[]>([]);
  const index = trials.length;
  const reading = index < order.length;
  const polarity = order[index];
  const sentence = sentences[index % sentences.length];
  const shown = reading && fontReady;
  const onset = useStimulusOnset(shown ? index : null);
  const disturbed = useDisturbance(shown ? index : null);
  const answered = useRef(-1);
  const sent = useRef(false);

  const respond = (value: boolean | null) => {
    if (!shown || !sentence || !polarity || answered.current === index) return;
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
    active && shown,
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

  const box = boxWidthPx(
    sentencePx,
    advanceEm,
    stageWidthPx - BOX_INSET_INLINE,
  );
  return (
    <>
      <TaskHeading key="read">Is it true?</TaskHeading>
      <Deck>Some are light text on dark. Read at your usual pace.</Deck>
      <Stage ref={stageRef} label="Sentence" className="tn-stage--center">
        {sentence && fontReady ? (
          <p
            key={index}
            className={`tn-stimulus tn-polarity-box tn-polarity-box--${polarity}`}
            style={{
              fontFamily: STIMULUS_FAMILY,
              fontSize: `${sentencePx}px`,
              lineHeight: LINE_HEIGHT,
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
