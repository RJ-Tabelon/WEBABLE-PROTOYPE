// Tiny looping illustrations of each step for the instruction card. Pure CSS; a still frame under reduced motion.

import type { JSX } from 'preact';
import { useContext } from 'preact/hooks';
import { RING_COUNT, RING_ORDER } from '../logic/pointing';
import type { StepId } from '../logic/steps';
import { StepLabelsContext } from './words';

function Lines(props: { widths: number[] }): JSX.Element {
  return (
    <>
      {props.widths.map((w) => (
        <span class="dm-line" style={{ width: `${w}%` }} />
      ))}
    </>
  );
}

function SizeDemo(): JSX.Element {
  const L = useContext(StepLabelsContext);
  return (
    <div class="dm-col">
      <div class="dm-card dm-size">
        <div class="dm-size-text">
          <Lines widths={[100, 92, 70]} />
        </div>
      </div>
      <div class="dm-row">
        <span class="dm-pill">{L.smaller}</span>
        <span class="dm-pill dm-press-b">{L.larger}</span>
      </div>
    </div>
  );
}

function TrueFalseDemo(): JSX.Element {
  const L = useContext(StepLabelsContext);
  return (
    <div class="dm-col">
      <div class="dm-card dm-tf">
        <span class="dm-tf-text">
          <Lines widths={[100, 64]} />
        </span>
      </div>
      <div class="dm-row">
        <span class="dm-pill dm-press-a">{L.yes}</span>
        <span class="dm-pill dm-press-b">{L.no}</span>
      </div>
    </div>
  );
}

function FaintDemo(): JSX.Element {
  return (
    <div class="dm-col">
      <div class="dm-card dm-faint">
        <span class="dm-faint-word">house</span>
      </div>
      <div class="dm-row">
        <span class="dm-pill">table</span>
        <span class="dm-pill dm-press-a">house</span>
        <span class="dm-pill">river</span>
        <span class="dm-pill">cloud</span>
      </div>
    </div>
  );
}

function LightDarkDemo(): JSX.Element {
  return (
    <div class="dm-row dm-ld">
      <div class="dm-card dm-ld-light">
        <Lines widths={[100, 86, 60]} />
      </div>
      <div class="dm-card dm-ld-dark">
        <Lines widths={[100, 86, 60]} />
      </div>
    </div>
  );
}

function DotsDemo(): JSX.Element {
  const R = 58;
  return (
    <div class="dm-ring" aria-hidden="true">
      {Array.from({ length: RING_COUNT }, (_, i) => {
        const a = -Math.PI / 2 + (i / RING_COUNT) * Math.PI * 2;
        const order = RING_ORDER.indexOf(i);
        return (
          <span
            class={`dm-dot ${order === 0 ? 'is-still' : ''}`}
            style={{
              left: `${70 + R * Math.cos(a) - 9}px`,
              top: `${70 + R * Math.sin(a) - 9}px`,
              animationDelay: `${order * 0.6}s`,
            }}
          />
        );
      })}
    </div>
  );
}

/** A real website in a browser window, with WebAble's small card at the bottom naming what to find. */
function FindDemo(): JSX.Element {
  return (
    <div class="dm-browser">
      <div class="dm-browser-bar">
        <i />
        <i />
        <i />
        <span class="dm-browser-url" />
      </div>
      <div class="dm-browser-page">
        <div class="dm-browser-nav">
          {[0, 1, 2, 3, 4].map((i) => (
            <span class={`dm-link ${i === 3 ? 'is-target' : ''}`} />
          ))}
        </div>
        <Lines widths={[100, 90, 96, 72]} />
      </div>
      <div class="dm-taskcard">
        Find and click: <b>Health</b>
      </div>
    </div>
  );
}

/** Round 10: a chat with the person's AI (the question, its answer), then the answer pasted into WebAble. */
function ContextDemo(): JSX.Element {
  return (
    <div class="dm-browser dm-chat">
      <div class="dm-browser-bar">
        <i />
        <i />
        <i />
        <span class="dm-browser-url" />
      </div>
      <div class="dm-browser-page dm-chat-page">
        <span class="dm-bubble dm-bubble-me">
          <Lines widths={[100, 64]} />
        </span>
        <span class="dm-bubble dm-bubble-ai">
          <Lines widths={[100, 94, 100, 58]} />
        </span>
      </div>
      <div class="dm-taskcard">
        Paste its answer into <b>WebAble</b>
      </div>
    </div>
  );
}

const DEMOS: Record<StepId, () => JSX.Element> = {
  size: SizeDemo,
  truefalse: TrueFalseDemo,
  faint: FaintDemo,
  lightdark: LightDarkDemo,
  dots: DotsDemo,
  find: FindDemo,
  context: ContextDemo,
};

export function Demo(props: { step: StepId }): JSX.Element {
  const D = DEMOS[props.step];
  return (
    <div class="dm" aria-hidden="true" data-step={props.step}>
      <D />
    </div>
  );
}
