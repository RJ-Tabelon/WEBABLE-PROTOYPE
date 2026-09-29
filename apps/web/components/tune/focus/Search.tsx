'use client';

import type { SearchTrial } from '@webable/core';
import { Button } from '@webable/ui';
import { useEffect, useRef, useState } from 'react';

import { elapsedSince, useStimulusOnset } from '../shared/hooks';
import { Deck, Stage, TaskHeading } from '../shared/primitives';
import { MockPage } from './pages';
import { TEMPLATES, type SearchPlanTrial } from './plan';

/** Search ceiling: after this the target is shown and the trial counts as timed out. */
export const SEARCH_CEILING_MS = 12_000;

export interface SearchProps {
  plan: readonly SearchPlanTrial[];
  /** Predicted pointer movement time from the pointing part, ms (0 if unknown). */
  predictedMoveMs: number;
  basePx: number;
  active: boolean;
  epoch: number;
  onDone: (
    trials: SearchTrial[],
    motionShown: boolean,
    stopMotionPressed: boolean,
  ) => void;
}

/**
 * Task A "Find it" (cal-attention §4.1): find a named link on a mock page,
 * clean or busy, still or moving (a static salient block under reduced motion).
 * A wrong click gets a neutral "Not that one."; after 12 s the link is shown.
 */
export function Search({
  plan,
  predictedMoveMs,
  basePx,
  active,
  epoch,
  onDone,
}: SearchProps) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const trials = useRef<SearchTrial[]>([]);
  const motionShown = useRef(false);
  const missed = useRef(false);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const sent = useRef(false);

  const trial = plan[index];
  const moving = !!trial && trial.motion === 'animated' && !stopped;
  const movingAtOnset = useRef(false);
  const key = trial ? `${index}-${epoch}` : null;
  const onset = useStimulusOnset(key);

  // New trial (or resume): reset feedback, note motion, arm the ceiling.
  useEffect(() => {
    if (!trial) return;
    setWrong(false);
    setRevealed(false);
    missed.current = false;
    movingAtOnset.current = moving;
    if (moving) motionShown.current = true;
    if (index > 0) promptRef.current?.focus({ preventScroll: true });
    if (!active) return;
    const ceiling = setTimeout(() => setRevealed(true), SEARCH_CEILING_MS);
    return () => clearTimeout(ceiling);
    // `moving` is read at onset only.
  }, [key, active]);

  const pick = (label: string) => {
    if (!trial || !active) return;
    if (label !== trial.target) {
      missed.current = true;
      setWrong(true);
      return;
    }
    if (!trial.practice) {
      trials.current.push({
        clutter: trial.clutter,
        motion:
          trial.motion === 'animated' && !movingAtOnset.current
            ? 'still'
            : trial.motion,
        rtMs: elapsedSince(onset.current),
        firstClickCorrect: !missed.current,
        timedOut: revealed,
        predictedMoveMs,
      });
    }
    const next = index + 1;
    if (next >= plan.length) {
      if (!sent.current) {
        sent.current = true;
        onDone(trials.current, motionShown.current, stopped);
      }
      return;
    }
    setIndex(next);
  };

  if (!trial) return null;
  const template = TEMPLATES[trial.template];
  const practice = trial.practice;

  return (
    <>
      <TaskHeading>Find it.</TaskHeading>
      <Deck>
        {practice
          ? 'First, a practice page. Click the link named at the top.'
          : 'Click the link named at the top. Some pages are busy, and that is expected.'}
      </Deck>
      <Stage label="Page" bleed className="tn-stage--page">
        <div className="tn-findbar">
          <p
            ref={promptRef}
            tabIndex={-1}
            className="tn-findbar__prompt"
            aria-live="polite"
          >
            <span className="tn-findbar__verb">Find</span>
            <span className="tn-findbar__target">{trial.target}</span>
            {wrong && !revealed ? (
              <span className="tn-findbar__note">Not that one.</span>
            ) : null}
            {revealed ? (
              <span className="tn-findbar__note">It&rsquo;s outlined.</span>
            ) : null}
          </p>
          {moving ? (
            <Button
              variant="secondary"
              size="task"
              iconStart="pause"
              className="tn-findbar__stop"
              onClick={() => {
                setStopped(true);
                // The button goes away with the motion: keep focus on the task.
                promptRef.current?.focus({ preventScroll: true });
              }}
            >
              Stop motion
            </Button>
          ) : null}
        </div>
        <MockPage
          key={index}
          template={template}
          clutter={trial.clutter}
          motion={
            moving
              ? 'animated'
              : trial.motion === 'animated'
                ? 'still'
                : trial.motion
          }
          sources={moving ? trial.sources : []}
          mirror={trial.mirror}
          links={trial.links}
          target={trial.target}
          firstAdvanceMs={trial.firstAdvanceMs}
          reveal={revealed}
          onPick={pick}
          basePx={basePx}
        />
      </Stage>
    </>
  );
}
