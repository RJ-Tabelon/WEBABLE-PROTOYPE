import { Icon, TextLink } from '@webable/ui';
import { Fragment } from 'react';
import { DOCS_UPDATED } from './ContactLine';
import { DocPage, DocSection, type TocEntry } from './DocPage';
import {
  ADAPTATIONS,
  DECISION_EVIDENCE,
  NOT_OFFERED,
  SOURCE_BY_ID,
  TUNE_EVIDENCE,
  type EvidenceItem,
  type Polarity,
} from './research-data';

const TOC: readonly TocEntry[] = [
  { id: 'changes', title: 'Each change' },
  { id: 'tune', title: 'How Tune measures' },
  { id: 'decisions', title: 'How WebAble decides' },
  { id: 'not-offered', title: 'What WebAble doesn’t offer' },
];

const blockId = (item: EvidenceItem) => `ev-${item.id}`;

/**
 * An external source link whose last word and arrow never part, so a wrapped
 * citation never starts a line with a lone arrow. Opens in a new tab (§7.2).
 */
function SourceLink({ cite, url }: { cite: string; url: string }) {
  const cut = cite.lastIndexOf(' ');
  return (
    <TextLink
      href={url}
      external={false}
      target="_blank"
      rel="noopener noreferrer"
    >
      {cut > 0 ? cite.slice(0, cut + 1) : null}
      <span className="ws-nowrap">
        {cite.slice(cut + 1)}
        <Icon name="arrow-up-right" size={16} className="wa-link__icon" />
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </TextLink>
  );
}

/** "Evidence: strong", or "Evidence against it: strong" for ideas left out. */
function strengthLabel(item: EvidenceItem, polarity: Polarity): string {
  const strength = item.strength.toLowerCase();
  return polarity === 'against'
    ? `Evidence against it: ${strength}`
    : `Evidence: ${strength}`;
}

function Evidence({
  item,
  polarity = item.polarity ?? 'for',
}: {
  item: EvidenceItem;
  /** Which way the evidence points. Default: the item's own, else `for`. */
  polarity?: Polarity;
}) {
  const titleId = blockId(item);
  const sources = item.sources
    .map((id) => SOURCE_BY_ID.get(id))
    .filter((source) => source !== undefined);
  return (
    <div className="ws-evidence">
      <div className="ws-evidence__head">
        <h3 id={titleId} className="ws-evidence__title">
          {item.title}
        </h3>
        <p className="ws-evidence__strength">{strengthLabel(item, polarity)}</p>
      </div>
      <div className="ws-evidence__body ws-prose">
        <p>{item.finding}</p>
        <p>
          <strong>What WebAble does.</strong> {item.practice}
        </p>
        {item.gap ? (
          <p className="ws-evidence__gap">
            <strong>What it doesn’t show.</strong> {item.gap}
          </p>
        ) : null}
      </div>
      <p className="ws-cites">
        <span className="sr-only">Sources: </span>
        {sources.map((source, i) => (
          <Fragment key={source.id}>
            {i > 0 ? <span aria-hidden="true">{' · '}</span> : null}
            <SourceLink cite={source.cite} url={source.url} />
          </Fragment>
        ))}
      </p>
    </div>
  );
}

/** Every change on one screen: its evidence and what WebAble does, each linked to its block. */
function ChangeTable({ items }: { items: readonly EvidenceItem[] }) {
  return (
    <table className="ws-table">
      <caption className="sr-only">
        Each change, how strong its evidence is, and what WebAble does
      </caption>
      <thead>
        <tr>
          <th scope="col">Change</th>
          <th scope="col">Evidence</th>
          <th scope="col">What WebAble does</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <th scope="row">
              <a className="wa-link" href={`#${blockId(item)}`}>
                {item.title}
              </a>
            </th>
            <td>{item.strength}</td>
            <td>{item.summary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The evidence behind each adaptation and behind Tune, with honest gaps. */
export function ResearchDoc() {
  return (
    <DocPage
      eyebrow={`Updated ${DOCS_UPDATED} · ${ADAPTATIONS.length} changes, ${TUNE_EVIDENCE.length} Tune tasks`}
      title="The evidence behind every change."
      deck="What the studies found, what WebAble does because of it, and what the evidence doesn’t show yet. Sources open in a new tab."
      toc={TOC}
      notes
    >
      <DocSection
        id="changes"
        title="Each change"
        deck="WebAble only makes changes from a reviewed list, each with a fixed range of sizes. These are the reasons for each one."
      >
        <ChangeTable items={ADAPTATIONS} />
        {ADAPTATIONS.map((item) => (
          <Evidence key={item.id} item={item} />
        ))}
      </DocSection>

      <DocSection
        id="tune"
        title="How Tune measures"
        deck="Tune is short, so each task measures only what it can measure well, and WebAble keeps learning afterwards."
      >
        {TUNE_EVIDENCE.map((item) => (
          <Evidence key={item.id} item={item} />
        ))}
      </DocSection>

      <DocSection
        id="decisions"
        title="How WebAble decides"
        deck="The idea behind WebAble is that software should fit the person, not the other way round."
      >
        {DECISION_EVIDENCE.map((item) => (
          <Evidence key={item.id} item={item} />
        ))}
      </DocSection>

      <DocSection
        id="not-offered"
        title="What WebAble doesn’t offer"
        deck="Some popular ideas don’t hold up in studies. WebAble leaves them out."
      >
        {NOT_OFFERED.map((item) => (
          <Evidence key={item.id} item={item} polarity={item.polarity} />
        ))}
        <p className="ws-secondary">
          See also{' '}
          <TextLink href="/accessibility">how we check our own pages</TextLink>.
        </p>
      </DocSection>
    </DocPage>
  );
}
