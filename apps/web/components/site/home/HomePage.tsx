import { Button, Icon, SectionHeader, TextLink } from '@webable/ui';
import { HeroDemo } from '../HeroDemo';
import { FitsDemo } from './FitsDemo';
import { HowItWorks } from './HowItWorks';
import { Payload } from './Payload';
import { Verifier, VERIFIER_CHECKS } from './Verifier';

/** Things a person's own browser extension structurally cannot change (docs/01 §7). */
const LIMITS = [
  'Missing image descriptions, captions or audio description.',
  'Controls a site built without keyboard support.',
  'Session timeouts, error messages from the server, and CAPTCHAs.',
  'Chrome’s own pages and the Chrome Web Store.',
] as const;

/** The home page: one idea per viewport, in the order a visitor needs them. */
export function HomePage() {
  return (
    <>
      <section className="ws-hero" aria-labelledby="hero-title">
        <div className="wa-container ws-hero__grid">
          <div className="ws-hero__copy">
            <h1 id="hero-title" className="ws-hero__title">
              The web, made to measure.
            </h1>
            <p className="ws-hero__deck">
              WebAble learns how you read, point and focus, then adjusts each
              site to fit. You see every change and can undo it.
            </p>
            <div className="ws-hero__actions">
              <Button href="/tune" variant="primary" arrow="forward">
                Get started
              </Button>
              <TextLink href="#how" kind="standalone">
                See how it works
              </TextLink>
            </div>
            <p className="ws-hero__meta">
              An extension for Chrome · Tune it in about 6 minutes
            </p>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="ws-section" aria-labelledby="fits-title">
        <div className="wa-container">
          <SectionHeader
            eyebrow="One page · three fits"
            title="Different people, different fits."
            titleId="fits-title"
            deck="The same page, adapted three ways. Each fit comes from a person’s own Tune, not from a preset."
          />
          <FitsDemo />
        </div>
      </section>

      <section id="how" className="ws-section" aria-labelledby="how-title">
        <div className="wa-container">
          <SectionHeader
            eyebrow="3 steps · about 6 minutes to start"
            title="Three short tasks. Then every site fits."
            titleId="how-title"
            deck="WebAble measures how you read, point and focus, then carries your fit to every site you visit."
            link={{ href: '/research', label: 'See the research' }}
          />
          <HowItWorks />
        </div>
      </section>

      <section className="ws-section" aria-labelledby="verify-title">
        <div className="wa-container">
          <SectionHeader
            eyebrow={`${VERIFIER_CHECKS.length} checks after every change`}
            title="Checked before it stays."
            titleId="verify-title"
            deck="After each change, WebAble checks the page. If a change breaks something, WebAble puts it back and tells you why."
          />
          <Verifier />
        </div>
      </section>

      <section className="ws-section" aria-labelledby="privacy-title">
        <div className="wa-container">
          <SectionHeader
            eyebrow="Page analysis is off until you turn it on"
            title="What leaves your browser, in plain words."
            titleId="privacy-title"
            deck="Your fit syncs to your account. Page analysis, if you turn it on, sends page structure and nothing else."
          />
          <div className="ws-privacy">
            <dl className="ws-ledger">
              <div>
                <dt className="ws-ledger__term">Sent</dt>
                <dd>
                  <ul role="list" className="ws-ledger__list">
                    <li>
                      Page structure: where each area sits, its size, and how
                      many links and buttons it has
                    </li>
                    <li>Up to 6 common words per label, from a public list</li>
                  </ul>
                </dd>
              </div>
              <div>
                <dt className="ws-ledger__term">Not sent</dt>
                <dd>
                  <ul role="list" className="ws-ledger__list">
                    <li>Page text</li>
                    <li>Anything you typed</li>
                    <li>Your browsing history or page addresses</li>
                    <li>Your fit</li>
                  </ul>
                </dd>
              </div>
            </dl>
            <div>
              <Payload />
              <p className="ws-link-row">
                <TextLink href="/privacy" kind="standalone">
                  Read the privacy details
                </TextLink>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="ws-section" aria-labelledby="limits-title">
        <div className="wa-container ws-boundary">
          <SectionHeader
            eyebrow="Honest limits"
            title="What WebAble can’t change."
            titleId="limits-title"
            deck="WebAble changes how pages look and respond for you. It never claims a site is accessible or compliant. Some problems live in a site’s own code, and only the site can change them."
          />
          <ul
            role="list"
            className="ws-boundary__list"
            aria-labelledby="limits-title"
          >
            {LIMITS.map((limit) => (
              <li key={limit}>
                <Icon name="minus" size={16} />
                <span>{limit}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="wa-container ws-cta" aria-labelledby="cta-title">
        <h2 id="cta-title" className="ws-cta__title">
          Tune WebAble to you.
        </h2>
        <p className="ws-cta__deck">
          About 6 minutes. There’s no passing or failing, and you can skip any
          part.
        </p>
        <div className="ws-cta__actions">
          <Button href="/tune" variant="primary" arrow="forward">
            Get started
          </Button>
        </div>
      </section>
    </>
  );
}
