// Round 10: the onboarding's last step, "Your context". Ask the AI the person uses most one question (ChatGPT and
// Claude open with it filled in), paste its answer, Continue. The answer is read in the background while "You're all
// set" shows (App waits for it, up to a limit); what WebAble took from it is shown on Results, never here.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { AskSteps } from '../ai/AiScreen';
import type { AiSource } from '../ai/reader';
import { TaskLayout } from './Task';

export function ContextTask(props: {
  /** Start reading the answer (App keeps the result for Results). */
  onImport(text: string, source: AiSource | null): void;
  onDone(): void;
  onSkip(): void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [source, setSource] = useState<AiSource | null>(null);
  return (
    <TaskLayout title="Bring your context" stageClass="is-context" focusTitle>
      <AskSteps
        text={text}
        problem={null}
        onText={setText}
        onSource={setSource}
        onContinue={() => {
          props.onImport(text, source);
          props.onDone();
        }}
        back={{ label: 'I don’t use an AI assistant', go: props.onSkip }}
      />
    </TaskLayout>
  );
}
