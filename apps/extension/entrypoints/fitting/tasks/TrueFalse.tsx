// R2, "True or false?": one short sentence, each 0.1 log smaller than the last, from a step above the comfortable size.
// Stops at 9 sentences, 35 s of reading, or two misses in a row. Fills reading.ladder.

import { textPriorPx, type ReadTrial } from '@webable/core';
import type { JSX } from 'preact';
import { useContext, useMemo, useRef, useState } from 'preact/hooks';
import { StepLabelsContext } from '../ui/words';
import { SENTENCES, type Sentence } from '../content/sentences';
import { STIMULUS_FONT } from '../logic/env';
import { shuffle } from '../logic/rand';
import { ladderPx, ladderStartPx, ladderStop, maxSentenceCss, normalizedMs } from '../logic/read';
import { useBox, useKeys, usePressed, useTrialClock } from '../ui/hooks';
import { Answer, TaskLayout, type TaskProps } from './Task';

type Reply = 'true' | 'false' | 'cant';

export function TrueFalseTask(props: TaskProps): JSX.Element {
  const L = useContext(StepLabelsContext);
  const { raw, env } = props;
  const zoom = raw.zoom || 1;
  const pool = useMemo(() => shuffle(SENTENCES, props.rng), []);
  const start = useMemo(() => ladderStartPx(raw.seedPx, textPriorPx(props.settings)), []);
  const [n, setN] = useState(0);
  const sentence = pool[n % pool.length] as Sentence;
  const clock = useTrialClock(n);
  const readMs = useRef(0);
  const [pressed, press] = usePressed();
  const [ref, box] = useBox<HTMLDivElement>({ w: 664, h: 224 });

  const minEff = props.settings?.minFontPx ?? 0;
  const maxEff = maxSentenceCss(box.w, box.h, env.charRatio, 13) * zoom;
  const shownEff = Math.round(Math.max(minEff, Math.min(maxEff, ladderPx(start, n))) * 10) / 10;
  const css = shownEff / zoom;

  const reply = (r: Reply) => {
    if (!clock.armed()) return;
    press(r);
    const rt = clock.elapsed();
    const t: ReadTrial = {
      px: shownEff,
      ms: normalizedMs(sentence.text.length, rt),
      correct: r !== 'cant' && (r === 'true') === sentence.truth,
    };
    if (r === 'cant') t.cant = true;
    raw.ladder.push(t);
    readMs.current += rt;
    props.onAnswer();
    const nextPx = ladderPx(start, n + 1);
    // Chrome's minimum font size would draw smaller sentences at the same size: stop there too.
    const stop = ladderStop(raw.ladder, readMs.current, nextPx) ?? (nextPx < minEff ? 'ladder_end' : null);
    if (stop) {
      props.onDone({ trials: raw.ladder.length, stop });
      return;
    }
    setN(n + 1);
  };

  useKeys(true, (key) => {
    const k = key.toLowerCase();
    if (k === 't') reply('true');
    else if (k === 'f') reply('false');
    else if (k === 'c' || k === '0') reply('cant');
  });

  return (
    <TaskLayout
      title={L.tfTitle}
      sub={L.tfLine}
      stageClass="is-read"
      stageRef={ref}
      focusTitle
      actions={
        <>
          <Answer id="true" pressed={pressed} onClick={() => reply('true')} keys="T">
            {L.yes}
          </Answer>
          <Answer id="false" pressed={pressed} onClick={() => reply('false')} keys="F">
            {L.no}
          </Answer>
          <Answer id="cant" kind="quiet" pressed={pressed} onClick={() => reply('cant')} keys="C">
            {L.cantRead}
          </Answer>
        </>
      }
    >
      <p
        class="fl-sentence"
        key={n}
        style={{ fontSize: `${css}px`, fontFamily: STIMULUS_FONT, maxWidth: css <= 40 ? '22ch' : '100%' }}
        data-truth={sentence.truth ? 'true' : 'false'}
        data-px={shownEff}
      >
        {sentence.text}
      </p>
    </TaskLayout>
  );
}
