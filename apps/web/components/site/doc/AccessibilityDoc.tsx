import { TextLink } from '@webable/ui';
import { ContactLine, DOCS_UPDATED } from './ContactLine';
import { DocPage, DocSection, Fact, type TocEntry } from './DocPage';

const TOC: readonly TocEntry[] = [
  { id: 'rules', title: 'The rules we design to' },
  { id: 'checks', title: 'How we check' },
  { id: 'gaps', title: 'What we know is missing' },
  { id: 'other-sites', title: 'On other sites' },
  { id: 'contact', title: 'Tell us' },
];

/**
 * How WebAble tests its own pages. It never claims conformance with any standard
 * (docs/01-Positioning.md §7): it states rules, methods and known gaps.
 */
export function AccessibilityDoc() {
  return (
    <DocPage
      eyebrow={`Updated ${DOCS_UPDATED}`}
      title="How we check our own pages."
      deck="WebAble has to work for the people who need it most. Here are the rules we build to, how we check them, and what we know is still missing."
      toc={TOC}
    >
      <DocSection
        id="rules"
        title="The rules we design to"
        deck="We use WCAG 2.2 as a checklist and set stricter rules of our own where the research supports it. We don’t claim that this site meets any standard."
      >
        <dl className="ws-facts">
          <Fact term="Text">
            Nothing smaller than 15 px, and reading text at 18 px. Headings grow
            with the page, and everything scales with your browser’s text size.
          </Fact>
          <Fact term="Contrast">
            Body text at 7:1 or more and secondary text at 4.5:1 or more, in the
            light and dark themes. A script computes every colour pair.
          </Fact>
          <Fact term="Targets">
            Controls are at least 44 px, and 64 px in Tune, with at least 8 px
            between them.
          </Fact>
          <Fact term="Keyboard">
            Everything works with the keyboard, in reading order, with a visible
            3 px focus outline. The first stop on every page skips to the
            content.
          </Fact>
          <Fact term="Motion">
            Nothing moves on its own for more than 5 seconds, nothing loops, and
            your device’s reduced motion setting turns animation off.
          </Fact>
          <Fact term="Layout">
            Pages reflow at 320 px wide, which is 400% zoom on a laptop, with no
            sideways scrolling.
          </Fact>
          <Fact term="Your fit">
            When you’ve tuned WebAble, this site uses your text size, target
            size, spacing and motion settings too.
          </Fact>
        </dl>
      </DocSection>

      <DocSection
        id="checks"
        title="How we check"
        deck="Automated tools find just over half of all problems, so we check by hand as well."
      >
        <h3>Automated</h3>
        <ul>
          <li>axe-core on every page, in the light and dark themes.</li>
          <li>
            A contrast script over every text and background pair in our colour
            tokens.
          </li>
          <li>
            Unit tests for heading order and for the words we promise never to
            use.
          </li>
        </ul>
        <h3>By hand</h3>
        <ul>
          <li>Keyboard only, from the first tab stop to the footer.</li>
          <li>
            With a screen reader, listening for names, roles and announcements.
          </li>
          <li>At 200% and 400% zoom, and at 320 px wide.</li>
          <li>
            With reduced motion, Windows contrast themes, and text spacing
            overrides.
          </li>
        </ul>
        <p className="ws-secondary">
          The estimate that automated tools find 57% of issues comes from{' '}
          <TextLink href="https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/">
            a study by Deque
          </TextLink>
          .
        </p>
      </DocSection>

      <DocSection id="gaps" title="What we know is missing">
        <ul>
          <li>
            The sample pages on the home page are pictures made of text. Screen
            readers hear a description of each one and its changes, not the
            sample content itself.
          </li>
          <li>
            In those samples, busy areas are faded on purpose, to show how
            WebAble softens them. Because they are part of a picture, their
            contrast is lower than the rest of this site.
          </li>
          <li>
            Tune’s pointing task needs a mouse, trackpad or touch screen. If you
            use a keyboard, switch or voice, you can skip it and set target
            sizes yourself.
          </li>
          <li>Page analysis works only on pages in English.</li>
          <li>The extension runs only in Chrome 135 or later on a computer.</li>
        </ul>
      </DocSection>

      <DocSection
        id="other-sites"
        title="On other sites"
        deck="WebAble changes how other sites look and respond for you. It never takes over how they work with assistive technology."
      >
        <ul>
          <li>
            It never changes a page’s ARIA, the names of its controls, its focus
            order or its keyboard handling.
          </li>
          <li>
            Its messages on a page never take focus. Press Alt+Shift+W to move
            to one, and Esc to go back.
          </li>
          <li>
            It never claims a site is accessible or compliant, because a browser
            extension can’t make that true.
          </li>
        </ul>
        <p>
          More on this in <TextLink href="/research">the research</TextLink>.
        </p>
      </DocSection>

      <DocSection id="contact" title="Tell us">
        <p>
          If anything on this site or in WebAble gets in your way, we want to
          know. Tell us what you were doing and what happened.
        </p>
        <ContactLine lead="Write to us:" />
      </DocSection>
    </DocPage>
  );
}
