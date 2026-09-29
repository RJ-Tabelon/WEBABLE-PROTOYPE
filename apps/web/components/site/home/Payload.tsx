import { SAMPLE_REGION_EVIDENCE, payloadLines } from './sample-evidence';

export interface PayloadProps {
  caption?: string;
  captionId?: string;
}

/**
 * The exact evidence page analysis sends about one area of a page, in Mono. Each
 * field is its own line with a hanging indent, so a long value wraps under itself
 * instead of scrolling sideways at 320 px.
 */
export function Payload({
  caption = 'One area of the sample page, exactly as page analysis would send it.',
  captionId,
}: PayloadProps) {
  const lines = payloadLines(SAMPLE_REGION_EVIDENCE);
  return (
    <figure className="ws-payload">
      <figcaption id={captionId} className="ws-payload__caption">
        {caption}
      </figcaption>
      <pre className="ws-payload__code">
        <code>
          <span className="ws-payload__brace">{'{'}</span>
          {lines.map(({ key, value }, i) => (
            <span key={key} className="ws-payload__line">
              <span className="ws-payload__key">{`"${key}": `}</span>
              {value}
              {i < lines.length - 1 ? ',' : ''}
            </span>
          ))}
          <span className="ws-payload__brace">{'}'}</span>
        </code>
      </pre>
    </figure>
  );
}
