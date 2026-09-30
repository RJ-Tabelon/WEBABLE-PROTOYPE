'use client';

import type { DeviceClass } from '@webable/core';
import type { FitRow } from '@webable/core/profile/describe';
import { Button, TextLink } from '@webable/ui';
import { useState, type ReactNode } from 'react';

import { useExtension } from '../../lib/extension/useExtension';
import { MODULE_LABEL, type ModuleId, type Setup } from './flow/steps';
import { usePendingFit } from './flow/storage';
import { FitLine, rowValue } from './shared/fit';
import {
  CheckChip,
  Deck,
  OptionGroup,
  Rest,
  TaskHeading,
  type ChoiceOption,
} from './shared/primitives';

const INPUTS: ReadonlyArray<ChoiceOption<Setup['input']>> = [
  { value: 'mouse', label: 'Mouse' },
  { value: 'trackpad', label: 'Trackpad' },
  { value: 'touch', label: 'Touch' },
  { value: 'keyboard', label: 'Keyboard only' },
];

const ASSISTIVE: ReadonlyArray<ChoiceOption<'screen-reader' | 'magnifier'>> = [
  { value: 'screen-reader', label: 'Screen reader' },
  { value: 'magnifier', label: 'Magnifier' },
];

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Sep 29", in the person's time zone. */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}`;
}

export interface IntroProps {
  defaultInput: Setup['input'];
  recalibrate: boolean;
  /** Phones and tablets get a note: WebAble runs in Chrome on a computer. */
  deviceClass: DeviceClass | null;
  onBegin: (choice: Pick<Setup, 'input' | 'assistive'>) => void;
}

/**
 * The Tune intro (design-final §13.3): what it is, how long, that nothing is
 * passed or failed, and the two questions that shape the route. The parts list
 * stands in for the ruler here.
 */
export function Intro({
  defaultInput,
  recalibrate,
  deviceClass,
  onBegin,
}: IntroProps) {
  const [input, setInput] = useState<Setup['input']>(defaultInput);
  const [uses, setUses] = useState(false);
  const [assistive, setAssistive] = useState<'screen-reader' | 'magnifier'>(
    'screen-reader',
  );
  const pending = usePendingFit();
  const handheld = deviceClass === 'phone' || deviceClass === 'tablet';
  return (
    <div className="tn-intro">
      <div className="tn-intro__top">
        <TaskHeading eyebrow="3 short tasks · about 6 min">
          {recalibrate
            ? 'Let’s check your fit again.'
            : 'Let’s fit WebAble to you.'}
        </TaskHeading>
        <p className="tn-lead">
          There&rsquo;s no passing or failing. Skip any part.
        </p>
        {handheld ? (
          <p className="tn-meta">
            WebAble runs in Chrome on a computer. Tune there for a fit that
            matches it.
          </p>
        ) : null}
        {pending ? (
          <p className="tn-meta tn-intro__pending">
            You have an unsaved fit from {shortDate(pending.savedAt)}.{' '}
            <TextLink href="/tune/save">Save it</TextLink>
          </p>
        ) : null}
      </div>
      <ol className="tn-parts" aria-label="The three parts">
        <li>
          <span className="tn-parts__name">Reading</span>
          <span className="tn-parts__what">Short sentences, at your pace</span>
        </li>
        <li>
          <span className="tn-parts__name">Pointing</span>
          <span className="tn-parts__what">A few circles to click</span>
        </li>
        <li>
          <span className="tn-parts__name">Focus</span>
          <span className="tn-parts__what">
            Everyday pages, a few questions
          </span>
        </li>
      </ol>
      <div className="tn-intro__setup">
        <OptionGroup
          legend="How do you usually point?"
          options={INPUTS}
          value={input}
          onChange={setInput}
          className="tn-options--inputs"
        />
        <div className="tn-intro__assistive">
          <CheckChip checked={uses} onChange={setUses}>
            I use a screen reader or magnifier
          </CheckChip>
          {uses ? (
            <OptionGroup
              legend="Which one?"
              options={ASSISTIVE}
              value={assistive}
              onChange={setAssistive}
              className="tn-options--inset"
            />
          ) : null}
        </div>
      </div>
      <div className="tn-controls">
        <Button
          variant="primary"
          size="task"
          arrow="forward"
          onClick={() =>
            onBegin({ input, assistive: uses ? assistive : 'none' })
          }
        >
          Begin
        </Button>
      </div>
      <p className="tn-meta">
        Your answers stay in this browser. Only your fit is saved, when you
        choose to save it.
      </p>
    </div>
  );
}

export function Resume({
  module,
  savedOn,
  onContinue,
  onRestart,
}: {
  module: ModuleId;
  savedOn: string | null;
  onContinue: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="tn-intro">
      <div className="tn-intro__top">
        <TaskHeading eyebrow="Tune">Pick up where you left off?</TaskHeading>
        <p className="tn-lead">
          {savedOn
            ? `Your answers from ${savedOn} are saved in this browser.`
            : 'Your answers so far are saved in this browser.'}{' '}
          Go on with {MODULE_LABEL[module].toLowerCase()}, or start again.
        </p>
      </div>
      <div className="tn-controls">
        <Button
          variant="primary"
          size="task"
          arrow="forward"
          onClick={onContinue}
        >
          Continue with {MODULE_LABEL[module].toLowerCase()}
        </Button>
        <Button variant="secondary" size="task" onClick={onRestart}>
          Start over
        </Button>
      </div>
    </div>
  );
}

export function ScreenReaderRoute({ onContinue }: { onContinue: () => void }) {
  return (
    <Rest
      title="We’ll keep this short."
      action={
        <Button
          variant="primary"
          size="task"
          arrow="forward"
          onClick={onContinue}
        >
          Continue
        </Button>
      }
    >
      <Deck>
        The reading and focus tasks are visual, so they are skipped. WebAble
        never changes what your screen reader uses: names, order and keys.
      </Deck>
    </Rest>
  );
}

export function KeyboardPointing({
  readingDone,
  fit,
  onContinue,
}: {
  readingDone: boolean;
  fit?: ReactNode;
  onContinue: () => void;
}) {
  return (
    <Rest
      done={readingDone ? 'Reading is done.' : null}
      fit={fit}
      title="No pointing needed."
      action={
        <Button
          variant="primary"
          size="task"
          arrow="forward"
          onClick={onContinue}
        >
          Continue
        </Button>
      }
    >
      <Deck>
        The pointing tasks are for a mouse, trackpad or touch screen, so they
        are skipped. WebAble never changes how keys work on a page.
      </Deck>
    </Rest>
  );
}

export function SavedForLater() {
  return (
    <Rest
      done="Your answers so far are saved in this browser."
      title="Finish whenever you like."
      action={
        <Button variant="primary" size="task" href="/" arrow="forward">
          Back to WebAble
        </Button>
      }
    >
      <Deck>Open Tune again to pick up where you left off.</Deck>
    </Rest>
  );
}

/**
 * After a save: when the extension in this browser is connected, it already
 * has the fit (the save nudges it), so the next step is the fit itself.
 * Otherwise the next step is connecting the extension.
 */
export function SavedToAccount({
  done,
}: {
  /** "Your fit is saved." or "Your fit is saved to your account." */
  done: string;
}) {
  const { state } = useExtension();
  const connected = state.phase === 'ready' && state.status.connected;
  const known = state.phase !== 'checking';
  return (
    <Rest
      done={done}
      title="WebAble now fits you."
      action={
        !known ? null : connected ? (
          <Button variant="primary" size="task" href="/app" arrow="forward">
            See your fit
          </Button>
        ) : (
          <Button variant="primary" size="task" href="/connect" arrow="forward">
            Connect the extension
          </Button>
        )
      }
    >
      {known ? (
        <Deck>
          {connected
            ? 'WebAble in this browser now uses it.'
            : 'This page already uses your fit. Next, connect the extension so the sites you visit can use it too.'}
        </Deck>
      ) : null}
    </Rest>
  );
}

export function SavedSignedIn() {
  return <SavedToAccount done="Your fit is saved." />;
}

export const SIGN_UP_TO_SAVE = '/sign-up?next=%2Ftune%2Fsave';
export const SIGN_IN_TO_SAVE = '/sign-in?next=%2Ftune%2Fsave';

/** How many values the end screen lists. */
const KEEP_VALUES = 4;

/**
 * Signed out: the fit waits in this browser. It lists what the fit changes, so
 * the choice to keep it is made with the real values in view.
 */
export function SavedLocally({ rows }: { rows: readonly FitRow[] }) {
  const changed = rows
    .filter((row) => row.changesPages && rowValue(row).kind !== 'same')
    .slice(0, KEEP_VALUES);
  return (
    <Rest
      done="Your fit is ready."
      title="Keep your fit."
      action={
        <div className="tn-keep">
          <div className="tn-controls">
            <Button
              variant="primary"
              size="task"
              href={SIGN_UP_TO_SAVE}
              arrow="forward"
            >
              Create an account
            </Button>
            <Button variant="secondary" size="task" href={SIGN_IN_TO_SAVE}>
              I have an account
            </Button>
          </div>
          <div className="tn-keep__later">
            <Button variant="ghost" size="md" flush="start" href="/">
              Not now
            </Button>
            <p className="tn-meta">Your fit stays in this browser.</p>
          </div>
        </div>
      }
    >
      <Deck>Create an account to keep it and use it in the extension.</Deck>
      {changed.length > 0 ? (
        <ul className="tn-keep__values" aria-label="Your fit changes">
          {changed.map((row) => (
            <li key={row.id}>
              <FitLine label={row.label} value={rowValue(row)} />
            </li>
          ))}
        </ul>
      ) : null}
    </Rest>
  );
}
