// What every step gets, and the one layout they share: the question, the white stage, the answers under it.

import type { BrowserSettings, FitProfile, InputClass } from '@webable/core';
import type { ComponentChildren, JSX, Ref } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Env } from '../logic/env';
import type { Rng } from '../logic/rand';
import type { RawCollector } from '../logic/raw';

export interface StepOutcome {
  trials: number;
  stop?: string;
}

export interface TaskProps {
  raw: RawCollector;
  env: Env;
  settings: BrowserSettings | null;
  /** The person's settings so far (text size from the reading steps, and so on). */
  draft: FitProfile;
  rng: Rng;
  input: InputClass;
  /** An answer was given: the chrome shows a soft check. */
  onAnswer: () => void;
  onDone: (o: StepOutcome) => void;
}

export function TaskLayout(props: {
  title: ComponentChildren;
  /** A quiet line under the question (practice, "Here it is."). Its space is always kept, so nothing jumps. */
  sub?: string | null;
  stageClass: string;
  stageRef?: Ref<HTMLDivElement>;
  stageStyle?: JSX.CSSProperties;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  /** Move focus to the question when the step starts (screen readers hear it first). */
  focusTitle?: boolean;
  data?: Record<string, string | number | undefined>;
}): JSX.Element {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (props.focusTitle) h.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section class="fl-task">
      <h2 class="fl-task-title" ref={h} tabIndex={-1}>
        {props.title}
      </h2>
      {props.sub !== undefined ? (
        <p class="fl-task-sub" aria-live="polite">
          {props.sub ?? ''}
        </p>
      ) : null}
      <div class={`fl-stage card ${props.stageClass}`} ref={props.stageRef} style={props.stageStyle} {...(props.data ?? {})}>
        {props.children}
      </div>
      {props.actions ? <div class="fl-actions">{props.actions}</div> : null}
    </section>
  );
}

/** An answer button: 72 px, with the 120 ms press-down for mouse and keyboard alike. */
export function Answer(props: {
  id: string;
  pressed: string | null;
  onClick: () => void;
  children: ComponentChildren;
  keys?: string;
  kind?: 'answer' | 'quiet';
}): JSX.Element {
  return (
    <button
      type="button"
      class={`${props.kind === 'quiet' ? 'answer fl-answer-quiet' : 'answer'} ${props.pressed === props.id ? 'is-down' : ''}`}
      onClick={props.onClick}
      data-answer={props.id}
      aria-keyshortcuts={props.keys}
    >
      {props.children}
    </button>
  );
}
