import { FitMark, ProgressRuler, type RulerSection } from '@webable/ui';
import { SAMPLE_ORIGINAL } from '../sample/model';

const TUNE_SECTIONS: readonly RulerSection[] = [
  { id: 'reading', label: 'Reading', tasks: 8 },
  { id: 'pointing', label: 'Pointing', tasks: 9 },
  { id: 'focus', label: 'Focus', tasks: 6 },
];

/**
 * Tune · Browse · It learns. Each step has one precise picture: the Tune ruler,
 * a fit mark readout, and a change row with keep and undo. The pictures are
 * decorative; each step's text says the same thing in words.
 */
export function HowItWorks() {
  return (
    <ol role="list" className="ws-steps">
      <li className="ws-step">
        <div className="ws-step__visual" aria-hidden="true">
          <ProgressRuler sections={TUNE_SECTIONS} current={1} taskIndex={4} />
        </div>
        <p className="ws-step__eyebrow">01 · about 6 min</p>
        <h3 className="ws-step__title">Tune</h3>
        <p className="ws-step__text">
          Three short tasks for reading, pointing and focus. There’s no passing
          or failing, and you can skip any part.
        </p>
      </li>

      <li className="ws-step">
        <div className="ws-step__visual" aria-hidden="true">
          <div className="ws-readout">
            <FitMark
              label="Text size"
              from={SAMPLE_ORIGINAL.bodyPx}
              to={18}
              unit="px"
              size="readout"
            />
            <span className="ws-readout__source">
              {SAMPLE_ORIGINAL.domain} · passed every check
            </span>
          </div>
        </div>
        <p className="ws-step__eyebrow">02 · every page</p>
        <h3 className="ws-step__title">Browse</h3>
        <p className="ws-step__text">
          As each page loads, WebAble fits it to you, checks every change, and
          shows you exactly what it did.
        </p>
      </li>

      <li className="ws-step">
        <div className="ws-step__visual" aria-hidden="true">
          <div className="ws-keep">
            <FitMark
              label="Click targets"
              from={SAMPLE_ORIGINAL.targetPx}
              to={44}
              unit="px"
            />
            <div className="ws-keep__pair">
              <span className="ws-pill ws-pill--primary">Keep</span>
              <span className="ws-pill">Undo</span>
            </div>
          </div>
        </div>
        <p className="ws-step__eyebrow">03 · over time</p>
        <h3 className="ws-step__title">It learns</h3>
        <p className="ws-step__text">
          Keep what helps and undo what doesn’t. WebAble learns from each
          choice, and asks before it tries something new.
        </p>
      </li>
    </ol>
  );
}
