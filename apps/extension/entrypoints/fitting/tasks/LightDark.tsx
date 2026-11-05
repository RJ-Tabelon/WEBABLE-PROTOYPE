// R4, "Light or dark?": two true/false sentences on a light stage and two on a dark one, near the person's size, then
// "Which felt easier to read?". Fills reading.polarity (times and the stated choice).

import type { Polarity } from '@webable/core';
import type { JSX } from 'preact';
import { useContext, useMemo, useRef, useState } from 'preact/hooks';
import { StepLabelsContext } from '../ui/words';
import { SENTENCES, type Sentence } from '../content/sentences';
import { STIMULUS_FONT } from '../logic/env';
import { shuffle } from '../logic/rand';
import { normalizedMs } from '../logic/read';
import { useKeys, usePressed, useTrialClock } from '../ui/hooks';
import { Answer, TaskLayout, type TaskProps } from './Task';

/** Light, dark, dark, light: each side gets one early and one late sentence. */
const SIDES: Array<'light' | 'dark'> = ['light', 'dark', 'dark', 'light'];

/** Near their size: one step above the smallest sentence they read correctly, else the comfortable size. */
function nearPx(ladder: ReadonlyArray<{ px: number; correct: boolean; cant?: boolean }>, seed: number | null): number {
  const read = ladder.filter((t) => t.correct && !t.cant).map((t) => t.px);
  const base = read.length ? Math.min(...read) * 10 ** 0.1 : (seed ?? 18);
  return Math.round(Math.max(12, Math.min(40, base)) * 10) / 10;
}

export function LightDarkTask(props: TaskProps): JSX.Element {
  const L = useContext(StepLabelsContext);
  const { raw } = props;
  const pool = useMemo(() => shuffle(SENTENCES, props.rng).slice(0, SIDES.length), []);
  const eff = useMemo(() => nearPx(raw.ladder, raw.seedPx), []);
  const [n, setN] = useState(0);
  const asking = n >= SIDES.length;
  const side = SIDES[n] ?? 'light';
  const sentence = pool[n] as Sentence | undefined;
  const clock = useTrialClock(n);
  const [pressed, press] = usePressed();
  const answered = useRef(0);
  const css = eff / (raw.zoom || 1);

  const reply = (r: 'true' | 'false') => {
    if (asking || !sentence || !clock.armed()) return;
    press(r);
    const rt = clock.elapsed();
    if ((r === 'true') === sentence.truth) {
      const ms = normalizedMs(sentence.text.length, rt);
      (side === 'light' ? raw.lightMs : raw.darkMs).push(ms);
    }
    answered.current += 1;
    props.onAnswer();
    setN(n + 1);
  };

  const choose = (p: Polarity, id: string) => {
    press(id);
    raw.stated = p;
    props.onAnswer();
    props.onDone({ trials: answered.current + 1, stop: 'person' });
  };

  useKeys(true, (key) => {
    const k = key.toLowerCase();
    if (!asking) {
      if (k === 't') reply('true');
      else if (k === 'f') reply('false');
    } else if (k === 'l') choose('light', 'light');
    else if (k === 'd') choose('dark', 'dark');
    else if (k === 's' || k === 'a') choose('none', 'same');
  });

  if (asking) {
    return (
      <TaskLayout
        title={L.ldAskTitle}
        stageClass="is-ld-ask"
        focusTitle
        actions={
          <>
            <Answer id="light" pressed={pressed} onClick={() => choose('light', 'light')} keys="L">
              {L.light}
            </Answer>
            <Answer id="dark" pressed={pressed} onClick={() => choose('dark', 'dark')} keys="D">
              {L.dark}
            </Answer>
            <Answer id="same" kind="quiet" pressed={pressed} onClick={() => choose('none', 'same')} keys="S">
              {L.same}
            </Answer>
          </>
        }
      >
        <div class="fl-ld-pair" aria-hidden="true">
          <div class="fl-ld-swatch is-light">
            <span style={{ fontFamily: STIMULUS_FONT }}>Aa</span>
            <i />
            <i />
          </div>
          <div class="fl-ld-swatch is-dark">
            <span style={{ fontFamily: STIMULUS_FONT }}>Aa</span>
            <i />
            <i />
          </div>
        </div>
      </TaskLayout>
    );
  }

  return (
    <TaskLayout
      title={L.tfTitle}
      sub={L.ldLine}
      stageClass={`is-read is-ld ${side === 'dark' ? 'is-dark' : ''}`}
      focusTitle={n === 0}
      actions={
        <>
          <Answer id="true" pressed={pressed} onClick={() => reply('true')} keys="T">
            {L.yes}
          </Answer>
          <Answer id="false" pressed={pressed} onClick={() => reply('false')} keys="F">
            {L.no}
          </Answer>
        </>
      }
    >
      {sentence ? (
        <p class="fl-sentence" key={n} style={{ fontSize: `${css}px`, fontFamily: STIMULUS_FONT, maxWidth: '22ch' }} data-truth={sentence.truth ? 'true' : 'false'}>
          {sentence.text}
        </p>
      ) : null}
    </TaskLayout>
  );
}
