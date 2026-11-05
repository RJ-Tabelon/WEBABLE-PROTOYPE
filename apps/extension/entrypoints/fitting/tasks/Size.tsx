// R1, "Pick a comfortable size": the paragraph itself grows and shrinks. Fills reading.seedPx (px at 100%).

import { textPriorPx } from '@webable/core';
import type { JSX } from 'preact';
import { useContext, useState } from 'preact/hooks';
import { StepLabelsContext } from '../ui/words';
import { COMFORT_PARAGRAPH } from '../content/sentences';
import { STIMULUS_FONT } from '../logic/env';
import { useBox, useKeys } from '../ui/hooks';
import { TaskLayout, type TaskProps } from './Task';

/** Sizes the buttons step through (px at 100%). */
export const SIZE_STEPS = [14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48] as const;

/** Whether a paragraph of `chars` fits a w × h box at s CSS px (line height 1.45, word wrap loses about two characters a line). */
function fits(s: number, w: number, h: number, charRatio: number, chars: number): boolean {
  const cpl = w / (charRatio * s) - 2;
  if (cpl < 12) return false;
  return Math.ceil(chars / cpl) * 1.45 * s <= h;
}

export function SizeTask(props: TaskProps): JSX.Element {
  const L = useContext(StepLabelsContext);
  const { raw, env } = props;
  const zoom = raw.zoom || 1;
  const [idx, setIdx] = useState(() => {
    const want = Math.max(16, textPriorPx(props.settings) ?? 16);
    let best = 1;
    SIZE_STEPS.forEach((s, i) => {
      if (Math.abs(s - want) < Math.abs((SIZE_STEPS[best] as number) - want)) best = i;
    });
    return best;
  });
  const [ref, box] = useBox<HTMLDivElement>({ w: 664, h: 360 });
  const eff = SIZE_STEPS[idx] as number;
  const next = SIZE_STEPS[idx + 1];
  const text = L.sizeText ?? COMFORT_PARAGRAPH;
  const canGrow = next != null && fits(next / zoom, box.w, box.h, env.charRatio, text.length);
  const canShrink = idx > 0;

  const smaller = () => canShrink && setIdx(idx - 1);
  const larger = () => canGrow && setIdx(idx + 1);
  const done = () => {
    raw.seedPx = raw.eff(eff / zoom);
    props.onAnswer();
    props.onDone({ trials: 1, stop: 'person' });
  };

  useKeys(true, (key) => {
    if (key === '-' || key === '_') smaller();
    else if (key === '+' || key === '=') larger();
  });

  return (
    <TaskLayout
      title={L.sizeTitle}
      sub={!canGrow && L.sizeMax ? L.sizeMax : !canShrink && L.sizeMin ? L.sizeMin : L.sizeLine}
      stageClass="is-size"
      stageRef={ref}
      focusTitle
      actions={
        <>
          <div class="fl-pair">
            <button
              type="button"
              class="btn btn-secondary"
              onClick={smaller}
              disabled={!canShrink}
              data-answer="smaller"
              aria-keyshortcuts="-"
            >
              {L.smaller}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              onClick={larger}
              disabled={!canGrow}
              data-answer="larger"
              aria-keyshortcuts="+"
            >
              {L.larger}
            </button>
          </div>
          <button type="button" class="btn btn-primary" onClick={done} data-answer="comfortable">
            {L.comfortable}
          </button>
        </>
      }
    >
      <p class="fl-para" style={{ fontSize: `${eff / zoom}px`, fontFamily: STIMULUS_FONT }} data-px={eff}>
        {text}
      </p>
      <span class="visually-hidden" aria-live="polite">{`Size ${idx + 1} of ${SIZE_STEPS.length}`}</span>
    </TaskLayout>
  );
}
