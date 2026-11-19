import type { RegionEvidence } from '@webable/core/page/types';
import { TextLink } from '@webable/ui';
import { SAMPLE_REGION_EVIDENCE, payloadLines } from './sample-evidence';

export interface PayloadProps {
  caption?: string;
  captionId?: string;
  /**
   * Show only these fields, in contract order, followed by a link to the full
   * block on the privacy page. Default: every field, exactly as it is sent.
   */
  fields?: readonly (keyof RegionEvidence)[];
}

/** Where the full payload lives. */
export const FULL_PAYLOAD_HREF = '/privacy#what-webable-sends';

/**
 * The evidence page analysis sends about one area of a page, in Mono. Each field is
 * its own line with a hanging indent, so a long value wraps under itself instead of
 * scrolling sideways at 320 px.
 */
export function Payload({
  caption = 'One area of the sample page, exactly as page analysis would send it.',
  captionId,
  fields,
}: PayloadProps) {
  const all = payloadLines(SAMPLE_REGION_EVIDENCE);
  const lines = fields
    ? all.filter((line) => (fields as readonly string[]).includes(line.key))
    : all;
  const hidden = all.length - lines.length;
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
              {i < lines.length - 1 || hidden > 0 ? ',' : ''}
            </span>
          ))}
          {hidden > 0 ? (
            <span className="ws-payload__line ws-payload__key">…</span>
          ) : null}
          <span className="ws-payload__brace">{'}'}</span>
        </code>
      </pre>
      {hidden > 0 ? (
        <p className="ws-payload__more">
          <TextLink href={FULL_PAYLOAD_HREF}>
            {`And ${hidden} more ${hidden === 1 ? 'field' : 'fields'}. See them all`}
          </TextLink>
        </p>
      ) : null}
    </figure>
  );
}
