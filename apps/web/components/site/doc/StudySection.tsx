import { STUDY } from '../study';
import { DocSection, Fact } from './DocPage';

const { correct, usability, ease, gaveUp, wrong, time, perPerson } = STUDY;

/** One decimal, the way the paper reports it. */
const one = (n: number) => n.toFixed(1);
/** A typographic minus, so a drop never reads as a hyphen. */
const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

const ROWS = [
  {
    measure: 'Correct answers',
    original: `${correct.original.percent}% (${correct.original.count} of ${STUDY.tasksPerVersion})`,
    webable: `${correct.webable.percent}% (${correct.webable.count} of ${STUDY.tasksPerVersion})`,
    change: `${signed(correct.differencePoints)} points`,
  },
  {
    measure: 'Ease-of-use rating, out of 100',
    original: one(usability.original),
    webable: one(usability.webable),
    change: signed(usability.difference),
  },
  {
    measure: 'How easy each task felt, 1 to 7',
    original: ease.original.toFixed(2),
    webable: ease.webable.toFixed(2),
    change: signed(ease.difference),
  },
  {
    measure: 'Answers of “I could not find it”',
    original: `${gaveUp.original}`,
    webable: `${gaveUp.webable}`,
    change: signed(gaveUp.webable - gaveUp.original),
  },
  {
    measure: 'Wrong answers',
    original: `${wrong.original}`,
    webable: `${wrong.webable}`,
    change: signed(wrong.webable - wrong.original),
  },
  {
    measure: 'Average seconds on the page',
    original: one(time.meanOriginal),
    webable: one(time.meanWebable),
    change: 'No reliable change',
  },
] as const;

const LIMITS = [
  'It doesn’t show that WebAble makes people faster. Time on the page didn’t change reliably.',
  'It can’t say which part helped. WebAble was compared as a whole, so text size, layout and rewording can’t be told apart.',
  'It compared WebAble only with the pages as the sites made them, not with reader views or phone settings.',
  `It was small: ${STUDY.people} people, six stories and one session each. The p-values aren’t adjusted for making several comparisons.`,
  'People may rate a version that looks new more highly. That’s why we put the most weight on correct answers.',
  'The reworded passages were checked by WebAble’s own checks, not by people outside the project.',
] as const;

/**
 * WebAble's own study, in full: who took part, what they did, what changed and
 * what it doesn't show. The home page's study band links here.
 */
export function StudySection() {
  return (
    <DocSection
      id="study"
      title={`Our study with ${STUDY.people} people`}
      deck="In fall 2026 we compared WebAble with the same pages as the sites made them. It was a small, exploratory study, so read the numbers as a first look."
    >
      <dl className="ws-facts">
        <Fact term="Who">
          {`${STUDY.people} adults aged 50 to 84 who said websites often give them trouble. ${STUDY.ages
            .map((a) => `${a.count} were ${a.band}`)
            .join(', ')
            .replace(/, ([^,]*)$/, ' and $1')}.`}
        </Fact>
        <Fact term="What gave them trouble">
          {`Getting around websites (${STUDY.trouble[0].count}), finding information (${STUDY.trouble[1].count}) and understanding what they read (${STUDY.trouble[2].count}). Many named more than one.`}
        </Fact>
        <Fact term="Where">
          On a phone, through a study website, so nothing had to be installed.
        </Fact>
        <Fact term="Pages">
          {`Saved copies of six ${STUDY.sites.join(', ').replace(/, ([^,]*)$/, ' and $1')} stories, so everyone saw the same page.`}
        </Fact>
        <Fact term="Approval">
          Exempt determination from the University of Florida’s Human Research
          Protection Program, October 2026.
        </Fact>
      </dl>

      <h3>What each person did</h3>
      <p>
        Each person set WebAble up, then did two rounds of three tasks. In each
        task they looked for one fact in a news, health or entertainment story.
        One round showed the pages as the sites made them and the other showed
        them with WebAble, in an order chosen at random. Each round used
        different stories, so nobody already knew an answer.
      </p>
      <p>
        Every question offered “I could not find it” as an answer. People
        weren’t told which round was WebAble until the end, and WebAble never
        saw the questions or the answers.
      </p>

      <h3>What changed</h3>
      <table className="ws-table ws-table--study">
        <caption className="sr-only">
          {`What changed between the two rounds, for all ${STUDY.people} people`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Original pages</th>
            <th scope="col">With WebAble</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.measure}>
              <th scope="row">{row.measure}</th>
              <td>{row.original}</td>
              <td>{row.webable}</td>
              <td>{row.change}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {`Most of the gain came from fewer people giving up. “I could not find it” fell from ${gaveUp.original} answers to ${gaveUp.webable}, and wrong answers fell from ${wrong.original} to ${wrong.webable}. Person by person, ${perPerson.better} found more right answers with WebAble, ${perPerson.same} found as many and ${perPerson.worse} found fewer. ${STUDY.noticed} of the ${STUDY.people} said the two rounds felt different.`}
      </p>
      <p className="ws-secondary">
        {`For correct answers, the 95% interval for the difference runs from ${correct.interval[0]} to ${correct.interval[1]} points (p = ${correct.p}). For the ease-of-use rating it runs from ${usability.interval[0]} to ${usability.interval[1]} (p ${usability.p}), and for how easy each task felt from ${ease.interval[0].toFixed(2)} to ${ease.interval[1].toFixed(2)} (p ${ease.p}). Time on the page didn’t differ reliably (p = ${time.p}). The median times were ${one(time.medianOriginal)} and ${one(time.medianWebable)} seconds.`}
      </p>

      <h3>What the study doesn’t show</h3>
      <ul>
        {LIMITS.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>

      <h3>The version we studied</h3>
      <p>
        The study ran WebAble inside a study website on a phone. Besides
        changing text size, spacing and clutter, that version could regroup
        sections and reword some passages in plainer words. A reworded passage
        that failed WebAble’s checks was thrown out and the original kept. The
        Chrome extension rewords paragraphs too, in the same careful way, but it
        runs on a computer and on live sites, so the study tells you how the
        whole approach did, not how each part of the extension does.
      </p>
    </DocSection>
  );
}
