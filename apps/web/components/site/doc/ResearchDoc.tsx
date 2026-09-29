import { TextLink } from '@webable/ui';
import { DOCS_UPDATED } from './ContactLine';
import { DocPage, DocSection, type TocEntry } from './DocPage';
import {
  ADAPTATIONS,
  DECISION_EVIDENCE,
  NOT_OFFERED,
  SOURCE_BY_ID,
  TUNE_EVIDENCE,
  type EvidenceItem,
} from './research-data';

const TOC: readonly TocEntry[] = [
  { id: 'changes', title: 'Each change' },
  { id: 'tune', title: 'How Tune measures' },
  { id: 'decisions', title: 'How WebAble decides' },
  { id: 'not-offered', title: 'What WebAble doesn’t offer' },
];

function Evidence({ item }: { item: EvidenceItem }) {
  const titleId = `ev-${item.id}`;
  return (
    <div className="ws-evidence">
      <div className="ws-evidence__head">
        <h3 id={titleId} className="ws-evidence__title">
          {item.title}
        </h3>
        <p className="ws-evidence__strength">
          Evidence: {item.strength.toLowerCase()}
        </p>
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
      <ul className="ws-cites" aria-label={`Sources for ${item.title}`}>
        {item.sources.map((id) => {
          const source = SOURCE_BY_ID.get(id);
          if (!source) return null;
          return (
            <li key={id}>
              <TextLink href={source.url}>{source.cite}</TextLink>
            </li>
          );
        })}
      </ul>
    </div>
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
    >
      <DocSection
        id="changes"
        title="Each change"
        deck="WebAble only makes changes from a reviewed list, each with a fixed range of sizes. These are the reasons for each one."
      >
        {ADAPTATIONS.map((item) => (
          <Evidence key={item.id} item={item} />
        ))}
      </DocSection>

      <DocSection
        id="tune"
        title="How Tune measures"
        deck="Tune takes about 6 minutes, so each task measures only what it can measure well, and WebAble keeps learning afterwards."
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
          <Evidence key={item.id} item={item} />
        ))}
        <p className="ws-secondary">
          See also{' '}
          <TextLink href="/accessibility">how we check our own pages</TextLink>.
        </p>
      </DocSection>
    </DocPage>
  );
}
