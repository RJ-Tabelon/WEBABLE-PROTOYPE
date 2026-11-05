// R3, "Which word is it?": one word on the white stage, lighter each time (1 easy, then up to 6 picked by QUEST+;
// 3 under "More contrast"). Four word buttons and "I can't see a word". Fills reading.faint.

import type { JSX } from 'preact';
import { useContext, useMemo, useState } from 'preact/hooks';
import { StepLabelsContext } from '../ui/words';
import { FAINT_WORDS } from '../content/sentences';
import { STIMULUS_FONT } from '../logic/env';
import { FaintQuest, type GrayStimulus } from '../logic/quest';
import { shuffle } from '../logic/rand';
import { useKeys, usePressed, useTrialClock } from '../ui/hooks';
import { Answer, TaskLayout, type TaskProps } from './Task';

export function FaintTask(props: TaskProps): JSX.Element {
  const L = useContext(StepLabelsContext);
  const { raw } = props;
  const body = props.draft.text.override ?? props.draft.text.bodyPx;
  const quest = useMemo(() => new FaintQuest(body >= 32, props.settings?.contrastMore ? 3 : 6), []);
  const order = useMemo(() => shuffle(FAINT_WORDS, props.rng), []);
  const [trial, setTrial] = useState(0);
  const [stim, setStim] = useState<GrayStimulus | null>(() => quest.next());
  const clock = useTrialClock(trial);
  const [pressed, press] = usePressed();
  const target = order[trial % order.length] ?? 'house';
  const options = useMemo(() => {
    const others = shuffle(
      FAINT_WORDS.filter((w) => w !== target),
      props.rng,
    ).slice(0, 3);
    return shuffle([target, ...others], props.rng);
  }, [trial]);
  // Big enough that size never limits seeing the word: twice the person's text size.
  const css = Math.max(40, Math.min(96, 2 * body)) / (raw.zoom || 1);

  const answer = (word: string | null, id: string) => {
    if (!clock.armed() || !stim) return;
    press(id);
    const correct = word === target;
    quest.record(stim, correct);
    raw.faint.push({ contrast: Math.round(stim.ratio * 1000) / 1000, correct });
    props.onAnswer();
    if (quest.done) {
      const ceiling = quest.trials.filter((t) => t.correct && t.stim.weber <= 0.02).length >= 3;
      props.onDone({ trials: quest.trials.length, stop: ceiling ? 'ceiling' : 'max_trials' });
      return;
    }
    setStim(quest.next());
    setTrial((t) => t + 1);
  };

  useKeys(true, (key) => {
    const k = Number(key);
    if (k >= 1 && k <= 4) answer(options[k - 1] ?? null, `w${k}`);
    else if (key === '0' || key.toLowerCase() === 'c') answer(null, 'none');
  });

  const g = stim?.gray ?? 128;
  return (
    <TaskLayout
      title={L.faintTitle}
      sub={L.faintLine}
      stageClass="is-faint"
      focusTitle
      actions={
        <>
          <div class="fl-words">
            {options.map((w, i) => (
              <Answer id={`w${i + 1}`} pressed={pressed} onClick={() => answer(w, `w${i + 1}`)} keys={String(i + 1)}>
                <span data-word={w}>{w}</span>
              </Answer>
            ))}
          </div>
          <Answer id="none" kind="quiet" pressed={pressed} onClick={() => answer(null, 'none')} keys="0">
            {L.cantSee}
          </Answer>
        </>
      }
    >
      <p
        class="fl-word"
        key={trial}
        aria-hidden="true"
        data-word={target}
        style={{ fontSize: `${css}px`, fontFamily: STIMULUS_FONT, color: `rgb(${g}, ${g}, ${g})` }}
      >
        {target}
      </p>
    </TaskLayout>
  );
}
