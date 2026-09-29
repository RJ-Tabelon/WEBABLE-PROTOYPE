'use client';

import { Button } from '@webable/ui';
import { useState } from 'react';

import { MODULE_LABEL, type ModuleId, type Setup } from './flow/steps';
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

export interface IntroProps {
  defaultInput: Setup['input'];
  recalibrate: boolean;
  onBegin: (choice: Pick<Setup, 'input' | 'assistive'>) => void;
}

/**
 * The Tune intro (design-final §13.3): what it is, how long, that nothing is
 * passed or failed, and the two questions that shape the route.
 */
export function Intro({ defaultInput, recalibrate, onBegin }: IntroProps) {
  const [input, setInput] = useState<Setup['input']>(defaultInput);
  const [uses, setUses] = useState(false);
  const [assistive, setAssistive] = useState<'screen-reader' | 'magnifier'>(
    'screen-reader',
  );
  return (
    <div className="tn-intro">
      <TaskHeading eyebrow={recalibrate ? 'Tune again' : 'Tune'}>
        {recalibrate
          ? 'Let’s check your fit again.'
          : 'Let’s fit WebAble to you.'}
      </TaskHeading>
      <p className="tn-lead">
        3 short tasks, about 6 minutes. There&rsquo;s no passing or failing.
        Skip any part.
      </p>
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
      <TaskHeading eyebrow="Tune">Pick up where you left off?</TaskHeading>
      <p className="tn-lead">
        {savedOn
          ? `Your answers from ${savedOn} are saved in this browser.`
          : 'Your answers so far are saved in this browser.'}{' '}
        Go on with {MODULE_LABEL[module].toLowerCase()}, or start again.
      </p>
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
  onContinue,
}: {
  readingDone: boolean;
  onContinue: () => void;
}) {
  return (
    <Rest
      done={readingDone ? 'Reading is done.' : null}
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

export function SavedSignedIn({ recalibration }: { recalibration: boolean }) {
  return (
    <Rest
      done="Your fit is saved."
      title="WebAble now fits you."
      action={
        recalibration ? (
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
      <Deck>
        {recalibration
          ? 'The extension picks up the new fit the next time it syncs. This page already uses it.'
          : 'This page already uses your fit. Next, connect the extension so the sites you visit can use it too.'}
      </Deck>
    </Rest>
  );
}

export const SIGN_UP_TO_SAVE = '/sign-up?next=%2Ftune%2Fsave';
export const SIGN_IN_TO_SAVE = '/sign-in?next=%2Ftune%2Fsave';

export function SavedLocally() {
  return (
    <Rest
      done="Your fit is ready."
      title="Keep your fit."
      action={
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
      }
    >
      <Deck>
        Create an account to keep it and use it in the extension. Until then it
        waits in this browser only.
      </Deck>
    </Rest>
  );
}
