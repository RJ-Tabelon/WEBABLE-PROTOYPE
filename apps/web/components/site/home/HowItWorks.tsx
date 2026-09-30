/**
 * Tune · Browse · It learns: three columns on the text edge, each opened by the
 * index rule's 24 px ink tick, a title and one sentence. No pictures, no pills.
 */
const STEPS = [
  {
    title: 'Tune',
    text: 'Short tasks measure how you read, point and focus, and you can skip any part.',
  },
  {
    title: 'Browse',
    text: 'As each page loads, WebAble fits it to you, checks every change and shows you what it did.',
  },
  {
    title: 'It learns',
    text: 'WebAble learns from what you keep and undo, and asks before it tries anything new.',
  },
] as const;

export function HowItWorks() {
  return (
    <ol role="list" className="ws-steps">
      {STEPS.map((step) => (
        <li key={step.title} className="ws-step">
          <h3 className="ws-step__title">{step.title}</h3>
          <p className="ws-step__text">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}
