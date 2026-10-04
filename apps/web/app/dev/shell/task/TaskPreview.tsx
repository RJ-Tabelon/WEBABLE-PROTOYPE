'use client';

import { Actions, Button, ProgressRuler, Sheet } from '@webable/ui';
import { useState } from 'react';
import { TaskShell } from '../../../../components/shell/TaskShell';

const SECTIONS = [
  { id: 'reading', label: 'Reading', tasks: 6 },
  { id: 'pointing', label: 'Pointing', tasks: 10 },
  { id: 'focus', label: 'Focus', tasks: 4 },
];

export function TaskPreview() {
  const [task, setTask] = useState(3);
  const [paused, setPaused] = useState(false);
  return (
    <>
      <TaskShell
        ruler={
          <ProgressRuler sections={SECTIONS} current={1} taskIndex={task} />
        }
        progress="Part 2 of 3 · Pointing · about 1 min left"
        progressShort="About 1 min left"
        onPause={() => setPaused(true)}
        onSkip={() => setTask(0)}
      >
        <h1 className="g-task-title">Click each circle as it appears.</h1>
        <p className="g-task-deck">Take your time. There’s no right speed.</p>
        <div className="g-stage">
          <button
            type="button"
            className="g-stage__target"
            aria-label="Circle"
            onClick={() => setTask((t) => Math.min(10, t + 1))}
          />
        </div>
      </TaskShell>
      <Sheet
        open={paused}
        onOpenChange={setPaused}
        title="Paused"
        description="Your answers so far are saved."
        actions={
          <Actions>
            <Button
              variant="primary"
              size="task"
              onClick={() => setPaused(false)}
            >
              Resume
            </Button>
            <Button
              variant="secondary"
              size="task"
              onClick={() => setPaused(false)}
            >
              Save and finish later
            </Button>
          </Actions>
        }
      />
    </>
  );
}
