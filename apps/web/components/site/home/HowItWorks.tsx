import { FitMark, Icon, StatusShape } from '@webable/ui';

/** The three text sizes Tune's reading task shows, as words with a sample. */
const SIZES = [
  { word: 'Smaller', px: 15 },
  { word: 'Medium', px: 20, chosen: true },
  { word: 'Larger', px: 26 },
] as const;

function TuneVisual() {
  return (
    <div
      className="wm-step__visual wm-mini"
      role="img"
      aria-label="A Tune task: choose the text size that is easiest to read. Medium is chosen."
    >
      <p className="wm-mini__title">Which is easiest to read?</p>
      <div className="wm-sizes">
        {SIZES.map((size) => (
          <span
            key={size.word}
            className="wm-sizes__option"
            data-chosen={'chosen' in size ? '' : undefined}
          >
            <span className="wm-sizes__aa" style={{ fontSize: size.px }}>
              Aa
            </span>
            <span className="wm-sizes__word">{size.word}</span>
          </span>
        ))}
      </div>
      <span className="wm-mini__progress">
        <span style={{ inlineSize: '40%' }} />
      </span>
    </div>
  );
}

function BrowseVisual() {
  return (
    <div
      className="wm-step__visual wm-mini"
      role="img"
      aria-label="WebAble's toolbar badge on a news page: adapted, with three changes listed."
    >
      <p className="wm-mini__status">
        <StatusShape state="adapted" size={16} className="wm-mini__glyph" />
        <span>Adapted · 3 changes</span>
      </p>
      <ul role="list" className="wm-mini__rows">
        <li>
          <FitMark label="Text size" from={13} to={18} unit="px" />
        </li>
        <li>
          <FitMark label="Click targets" from={24} to={44} unit="px" />
        </li>
        <li>
          <FitMark label="Moving things" from={3} to={0} />
        </li>
      </ul>
    </div>
  );
}

function KeepVisual() {
  return (
    <div
      className="wm-step__visual wm-mini"
      role="img"
      aria-label="A change with Keep and Undo buttons beside it."
    >
      <p className="wm-mini__title">Text size, 13 to 18 px</p>
      <div className="wm-mini__choice">
        <span className="wm-mini__btn wm-mini__btn--ink">Keep</span>
        <span className="wm-mini__btn">
          <Icon name="rotate-ccw" size={16} />
          Undo
        </span>
      </div>
      <p className="wm-mini__note">
        WebAble learns from what you keep and undo.
      </p>
    </div>
  );
}

const STEPS = [
  {
    n: '01',
    title: 'Tune it to you',
    text: 'A few short tasks show how you read, point and focus. You can skip any part.',
    visual: <TuneVisual />,
  },
  {
    n: '02',
    title: 'Browse as usual',
    text: 'Each page is fitted as it loads. WebAble checks every change and shows you what it did.',
    visual: <BrowseVisual />,
  },
  {
    n: '03',
    title: 'Keep what helps',
    text: 'Undo any change in one click. WebAble asks before it tries anything new.',
    visual: <KeepVisual />,
  },
] as const;

/** Tune · Browse · Keep: three numbered cards, each with a small picture of that step. */
export function HowItWorks() {
  return (
    <ol role="list" className="wm-steps">
      {STEPS.map((step) => (
        <li key={step.n} className="wm-step">
          {step.visual}
          <div className="wm-step__body">
            <p className="wm-step__n" aria-hidden="true">
              {step.n}
            </p>
            <h3 className="wm-h3">{step.title}</h3>
            <p className="wm-step__text">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
