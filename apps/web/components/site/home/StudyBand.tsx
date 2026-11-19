import { TextLink } from '@webable/ui';
import { STUDY } from '../study';

const STATS = [
  {
    value: `${STUDY.correct.webable.percent}%`,
    label: 'Correct answers',
    before: `${STUDY.correct.original.percent}% on the original pages`,
  },
  {
    value: `${Math.round(STUDY.usability.webable)}`,
    unit: 'out of 100',
    label: 'Ease-of-use rating',
    before: `${Math.round(STUDY.usability.original)} on the original pages`,
  },
  {
    value: `${STUDY.gaveUp.webable}`,
    label: 'Times someone said “I could not find it”',
    before: `${STUDY.gaveUp.original} on the original pages`,
  },
] as const;

/**
 * The study, as one band of proof rather than the page's subject: a sentence,
 * three numbers with what they were before, and what the study does not show.
 * The research page has the rest.
 */
export function StudyBand() {
  return (
    <section
      id="study"
      className="wm-section wm-study"
      aria-labelledby="study-title"
    >
      <div className="wa-container">
        <div className="wm-study__grid">
          <div className="wm-study__lead">
            <h2 id="study-title" className="wm-h2">
              {`We tried WebAble with ${STUDY.people} people aged 50 to 84.`}
            </h2>
            <p className="wm-study__statement">
              <strong>
                {`They found the right answer ${STUDY.correct.webable.percent}% of the time with WebAble,`}
              </strong>{' '}
              {`and ${STUDY.correct.original.percent}% of the time on the same pages as the sites made them.`}
            </p>
          </div>
          <dl className="wm-stats">
            {STATS.map((stat) => (
              <div key={stat.label} className="wm-stat">
                <dt className="wm-stat__label">{stat.label}</dt>
                <dd className="wm-stat__value">
                  {stat.value}
                  {'unit' in stat ? (
                    <span className="wm-stat__unit">{` ${stat.unit}`}</span>
                  ) : null}
                </dd>
                <dd className="wm-stat__before">{stat.before}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="wm-study__note">
          <p>
            {`An exploratory study in fall 2026 with people who often have trouble with websites. Each person looked for facts in saved copies of ${STUDY.sites.join(', ').replace(/, ([^,]*)$/, ' and $1')} stories on a phone, once as the site made them and once with a study version of WebAble that could also reword passages. How long it took didn’t change reliably.`}
          </p>
          <TextLink href="/research#study" kind="standalone">
            How we ran the study
          </TextLink>
        </div>
      </div>
    </section>
  );
}
