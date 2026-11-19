import { Button, Icon, TextLink } from '@webable/ui';
import { HeroShowcase } from '../hero/HeroShowcase';
import { GlyphField } from './GlyphField';
import { Faq, type FaqItem } from '../kit/Faq';
import { SectionIntro } from '../kit/SectionIntro';
import { STUDY } from '../study';
import { Features } from './Features';
import { FitsDemo } from './FitsDemo';
import { HowItWorks } from './HowItWorks';
import { Payload } from './Payload';
import { StudyBand } from './StudyBand';

/** What gets in people's way on ordinary pages, in plain words. */
const STRUGGLES = [
  {
    title: 'Small, faint text',
    text: 'Zooming the whole page often pushes things off the side of the screen.',
  },
  {
    title: 'Buttons that are easy to miss',
    text: 'Links and controls packed so close that a shaky tap lands on the wrong one.',
  },
  {
    title: 'Things that move',
    text: 'Video ads and slideshows that pull your eye away from what you came to read.',
  },
  {
    title: 'Crowded pages',
    text: 'Menus, ads and side columns all compete with the one thing you came to do.',
  },
] as const;

/** Things a person's own browser extension structurally cannot change (docs/01 §7). */
const LIMITS = [
  'Missing image descriptions, captions or audio description.',
  'Controls a site built without keyboard support.',
  'Session timeouts, error messages from the server, and CAPTCHAs.',
  'Chrome’s own pages and the Chrome Web Store.',
] as const;

/** The fields the home page shows; the privacy page shows the whole block. */
const HOME_PAYLOAD_FIELDS = [
  'zone',
  'width',
  'landmark',
  'links',
  'text_amount',
  'class_words',
  'heading_words',
  'control_words',
] as const;

const FAQ: readonly FaqItem[] = [
  {
    id: 'faq-accessible',
    question: 'Does WebAble make a site accessible?',
    answer: (
      <p>
        No. WebAble changes how pages look and respond for you. It never claims
        a site is accessible or compliant. Some problems live in a site’s own
        code, and only the site can change them.
      </p>
    ),
  },
  {
    id: 'faq-limits',
    question: 'What can’t WebAble change?',
    answer: (
      <ul
        role="list"
        className="wm-limits"
        aria-label="What WebAble can’t change"
      >
        {LIMITS.map((limit) => (
          <li key={limit}>
            <Icon name="minus" size={16} />
            <span>{limit}</span>
          </li>
        ))}
      </ul>
    ),
  },
  {
    id: 'faq-undo',
    question: 'Can I undo what it changes?',
    answer: (
      <p>
        Yes. Open WebAble from Chrome’s toolbar to see every change on the page,
        and undo one or all of them. You can also pause WebAble on any site.
      </p>
    ),
  },
  {
    id: 'faq-tune',
    question: 'Do I have to set it up first?',
    answer: (
      <p>
        No. WebAble works on the first page you open. Tuning it to you takes a
        few short tasks, and you can skip any part.
      </p>
    ),
  },
  {
    id: 'faq-browsers',
    question: 'Where does it work?',
    answer: (
      <p>
        WebAble runs in Chrome on a computer, on the sites you already use.
        Chrome’s own pages and the Chrome Web Store are the exceptions.
      </p>
    ),
  },
  {
    id: 'faq-sent',
    question: 'What does WebAble send?',
    answer: (
      <p>
        Your fit syncs to your account. Page analysis is off until you turn it
        on, and then it sends page structure only: never page text, anything you
        typed, or where you’ve been.{' '}
        <TextLink href="/privacy">Read the privacy details</TextLink>
      </p>
    ),
  },
];

/** The home page: the product first, then how it works, proof and trust. */
export function HomePage() {
  return (
    <>
      <section className="wm-hero" aria-labelledby="hero-title">
        <div className="wm-hero__top">
          <GlyphField clear=".wm-hero__head" />
          <div className="wa-container wm-hero__head">
            <a className="wm-announce" href="#study">
              <span className="wm-announce__tag">New</span>
              <span className="wm-announce__text">
                {`What we learned from ${STUDY.people} people aged 50 to 84`}
              </span>
              <Icon
                name="arrow-right"
                size={16}
                className="wm-announce__arrow"
              />
            </a>
            <h1 id="hero-title" className="wm-display">
              The web, made to measure.
            </h1>
            <p className="wm-hero__deck">
              WebAble fits every website to the person using it. It learns how
              you read, point and focus, then adjusts each page to suit you. You
              see every change and can undo it.
            </p>
            <div className="wm-actions wm-actions--center">
              <Button
                href="/get"
                variant="primary"
                arrow="forward"
                className="wm-btn"
              >
                Add to Chrome
              </Button>
              <Button
                href="/tune"
                variant="ghost"
                className="wm-btn wm-btn--soft"
              >
                Or tune it first
              </Button>
            </div>
            <p className="wm-hero__meta">
              <span>For Chrome on a computer</span>
              <span aria-hidden="true" className="wm-hero__dot" />
              <span>Works on the sites you already use</span>
            </p>
          </div>
        </div>
        <div className="wm-hero__stage">
          <div className="wm-hero__window">
            <HeroShowcase />
          </div>
        </div>
      </section>

      <section className="wm-section" aria-labelledby="problem-title">
        <div className="wa-container">
          <SectionIntro
            align="split"
            titleId="problem-title"
            title="Websites are built for an average user who doesn’t exist."
            deck={
              <>
                <p>
                  Accessibility standards set one bar for everyone. People don’t
                  come in one size. Small text bothers one person, a crowded
                  page another, a moving ad a third, and what bothers you can
                  change from year to year.
                </p>
                <p>
                  A page can meet every standard and still be hard for the
                  person using it. Browser settings help a little, but they’re
                  buried, they treat everyone the same, and they can break the
                  page.
                </p>
              </>
            }
          />
          <ul role="list" className="wm-struggles">
            {STRUGGLES.map((item) => (
              <li key={item.title} className="wm-struggle">
                <h3 className="wm-struggle__title">{item.title}</h3>
                <p className="wm-struggle__text">{item.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="wm-section" aria-labelledby="fits-title">
        <div className="wa-container">
          <SectionIntro
            titleId="fits-title"
            title="One page, fitted to three different people."
            deck={
              <p>
                The same NPR story, changed three ways. Each fit comes from what
                got in that person’s way.
              </p>
            }
          />
          <FitsDemo />
        </div>
      </section>

      <section id="how" className="wm-section" aria-labelledby="how-title">
        <div className="wa-container">
          <SectionIntro
            titleId="how-title"
            title="Set it up once. Every site fits after that."
            deck={
              <p>
                WebAble learns how you read, point and focus, then carries your
                fit to every site you visit.
              </p>
            }
          />
          <HowItWorks />
          <div className="wm-actions wm-actions--center wm-how__actions">
            <Button
              href="/get"
              variant="primary"
              arrow="forward"
              className="wm-btn"
            >
              Add to Chrome
            </Button>
            <Button
              href="/research"
              variant="ghost"
              className="wm-btn wm-btn--soft"
            >
              See the research
            </Button>
          </div>
        </div>
      </section>

      <section
        id="features"
        className="wm-section"
        aria-labelledby="features-title"
      >
        <div className="wa-container">
          <SectionIntro
            titleId="features-title"
            title="Changes you can see, check and undo."
            deck={
              <p>
                WebAble changes text, spacing, targets and clutter, and can put
                paragraphs in plainer words. Each rewrite is checked and marked,
                and one click shows the page’s own words.
              </p>
            }
          />
          <Features />
        </div>
      </section>

      <StudyBand />

      <section
        id="privacy"
        className="wm-section"
        aria-labelledby="privacy-title"
      >
        <div className="wa-container wm-privacy">
          <div className="wm-privacy__intro">
            <h2 id="privacy-title" className="wm-h2">
              What leaves your browser, in plain words.
            </h2>
            <p className="wm-privacy__deck">
              Your fit syncs to your account. Page analysis is off until you
              turn it on. Then it sends page structure and nothing else.
            </p>
            <TextLink href="/privacy" kind="standalone">
              Read the privacy details
            </TextLink>
          </div>
          <div className="wm-privacy__body">
            <dl className="wm-ledger">
              <div className="wm-ledger__card">
                <dt className="wm-ledger__term">Sent with page analysis</dt>
                <dd>
                  <ul role="list" className="wm-ledger__list">
                    <li>
                      <Icon name="check" size={16} />
                      <span>
                        Page structure: where each area sits, its size, and how
                        many links and buttons it has
                      </span>
                    </li>
                    <li>
                      <Icon name="check" size={16} />
                      <span>
                        Up to 6 common words per label, from a public list
                      </span>
                    </li>
                  </ul>
                </dd>
              </div>
              <div className="wm-ledger__card">
                <dt className="wm-ledger__term">
                  Never sent with page analysis
                </dt>
                <dd>
                  <ul role="list" className="wm-ledger__list">
                    <li>
                      <Icon name="x" size={16} />
                      <span>Page text</span>
                    </li>
                    <li>
                      <Icon name="x" size={16} />
                      <span>Anything you typed</span>
                    </li>
                    <li>
                      <Icon name="x" size={16} />
                      <span>Your browsing history or page addresses</span>
                    </li>
                    <li>
                      <Icon name="x" size={16} />
                      <span>Your fit</span>
                    </li>
                  </ul>
                </dd>
              </div>
            </dl>
            <div className="wm-code">
              <div className="wm-code__bar" aria-hidden="true">
                <span className="wm-code__tab">
                  One area of the sample page
                </span>
              </div>
              <Payload
                fields={HOME_PAYLOAD_FIELDS}
                caption="Part of what page analysis would send about one area of the sample page."
              />
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="wm-section" aria-labelledby="faq-title">
        <div className="wa-container wm-faq-section">
          <h2 id="faq-title" className="wm-h2">
            Questions
          </h2>
          <Faq items={FAQ} />
        </div>
      </section>

      <section className="wm-cta" aria-labelledby="cta-title">
        <div className="wa-container wm-cta__inner">
          <h2 id="cta-title" className="wm-h2 wm-cta__title">
            Tune WebAble to you.
          </h2>
          <p className="wm-cta__deck">
            {
              'About 6 minutes. There’s no passing or failing, and you can skip any part.'
            }
          </p>
          <div className="wm-actions wm-actions--center">
            <Button
              href="/tune"
              variant="primary"
              arrow="forward"
              className="wm-btn"
            >
              Start tuning
            </Button>
            <Button href="/get" variant="ghost" className="wm-btn wm-btn--soft">
              Add to Chrome
            </Button>
          </div>
        </div>
        <div className="wm-cta__rings" aria-hidden="true" />
      </section>
    </>
  );
}
