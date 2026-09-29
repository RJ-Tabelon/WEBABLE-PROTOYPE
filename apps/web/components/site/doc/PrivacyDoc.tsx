import { TextLink } from '@webable/ui';
import { Payload } from '../home/Payload';
import { ContactLine, DOCS_UPDATED } from './ContactLine';
import { DocPage, DocSection, Fact, type TocEntry } from './DocPage';

const TOC: readonly TocEntry[] = [
  { id: 'short', title: 'The short version' },
  { id: 'stored', title: 'What your account holds' },
  { id: 'device', title: 'What stays on your device' },
  { id: 'what-webable-sends', title: 'What WebAble sends' },
  { id: 'product-learning', title: 'Product learning' },
  { id: 'choices', title: 'Download or delete' },
  { id: 'contact', title: 'Questions' },
];

/**
 * Privacy in plain nouns (design-final §13.1 rule 9), consistent with
 * docs/08-System-Architecture.md §4 (data model) and §5 (page analysis) and the
 * core migration. Never "nothing leaves your device" while a cloud tier exists.
 */
export function PrivacyDoc() {
  return (
    <DocPage
      eyebrow={`Updated ${DOCS_UPDATED}`}
      title="Privacy, in plain words."
      deck="What WebAble keeps, where it keeps it, what it sends and when, and how to take all of it back."
      toc={TOC}
    >
      <DocSection id="short" title="The short version">
        <ul>
          <li>
            WebAble never sends page text, anything you type, or the addresses
            of the pages you visit.
          </li>
          <li>
            Your fit and settings are saved to your account, so they work on
            your other computers.
          </li>
          <li>
            Page analysis is off until you turn it on. When it is on, it sends
            page structure only.
          </li>
          <li>
            You can download everything in your account, or delete it, at any
            time.
          </li>
          <li>WebAble has no ads and never sells your data.</li>
        </ul>
      </DocSection>

      <DocSection
        id="stored"
        title="What your account holds"
        deck="Kept in WebAble’s database, run on Supabase. Every row is locked to your account, so no one else who signs in can read it."
      >
        <dl className="ws-facts">
          <Fact
            term="Sign-in details"
            meta="Kept until you delete your account."
          >
            Your email address, and a password if you choose one. Passwords are
            kept only as a one-way hash.
          </Fact>
          <Fact
            term="Account settings"
            meta="Kept until you delete your account."
          >
            Your choices for page analysis and product learning, your theme, and
            how far you are through setup.
          </Fact>
          <Fact
            term="Your fit"
            meta="Each version is kept until you delete it or your account. Under 8 KB."
          >
            The values WebAble uses for text, click targets, spacing, motion and
            contrast. Each time you tune again, a new version is saved, so you
            can go back.
          </Fact>
          <Fact
            term="Tune summaries"
            meta="Kept until you delete your account. Under 16 KB each."
          >
            A short summary of each part of Tune and a rough device type, such
            as “laptop with a mouse”. Never your individual answers, pointer
            paths or reading times.
          </Fact>
          <Fact
            term="What WebAble learned"
            meta="Older choices count for less over time."
          >
            Counts of the changes you kept or undid, with no sites attached.
          </Fact>
          <Fact term="Weekly change counts" meta="Deleted after 26 weeks.">
            How many changes of each kind were made, kept or undone each week,
            for your Changes page. No sites or page addresses.
          </Fact>
          <Fact
            term="Connected browsers"
            meta="Kept until you remove the browser or delete your account."
          >
            A random id for each install, the browser, the operating system and
            the WebAble version.
          </Fact>
        </dl>
        <p className="ws-secondary">
          Your account never holds health information, page addresses, page
          content or your individual Tune answers.
        </p>
      </DocSection>

      <DocSection
        id="device"
        title="What stays on your device"
        deck="Some things would reveal where you go on the web, so they never leave your browser."
      >
        <dl className="ws-facts">
          <Fact
            term="Your sites"
            meta="In the extension’s storage in this browser."
          >
            The sites where you changed a setting, and those settings. A list of
            sites is browsing history, so it is never sent to WebAble’s server.
            Your Sites page asks the extension for it directly while the page is
            open.
          </Fact>
          <Fact
            term="Recent changes"
            meta="The last 30 days, up to 500 changes."
          >
            What WebAble changed on each page, and whether you kept it.
          </Fact>
          <Fact
            term="Saved page answers"
            meta="In the extension’s storage in this browser."
          >
            Answers from page analysis, filed under a code made with a secret
            key that never leaves your browser, so the codes can’t be traced
            back to sites.
          </Fact>
          <Fact
            term="What was sent"
            meta="In the extension’s storage in this browser."
          >
            A receipt for every page analysis request, which you can open from
            the WebAble button in Chrome’s toolbar.
          </Fact>
          <Fact term="Tune answers" meta="In memory only, while you tune.">
            Each answer you give during Tune. When you finish, only the summary
            is kept.
          </Fact>
          <Fact
            term="Website preferences"
            meta="In this browser’s local storage."
          >
            Your theme and the text and spacing this website uses for you.
          </Fact>
        </dl>
      </DocSection>

      <DocSection
        id="what-webable-sends"
        title="What WebAble sends"
        deck="Page analysis helps WebAble tell what an area of a page is for, such as navigation or an ad. It is off until you turn it on, and it needs you to be signed in."
      >
        <p>
          WebAble’s own rules decide most pages on your device. Only when they
          can’t tell what an area is for, and page analysis is on, the extension
          sends a description of that area’s structure: where it sits, its size,
          how many links, buttons and fields it has, and at most 6 common words
          per label from a public list of about 1,600. Any other word is dropped
          before anything is sent.
        </p>
        <Payload caption="One area of the sample page on the home page, exactly as it would be sent." />
        <h3>Where it goes</h3>
        <p>
          To WebAble’s server, which checks every word against the public list
          again, then asks Jev, a page classification model made by TypeSafe AI.
          Jev answers with how likely each option WebAble wrote is, such as
          “navigation” or “advertisement”. It never writes code or styles, and
          it never sees your fit.
        </p>
        <h3>Never sent</h3>
        <ul>
          <li>Page text, and headings or labels as written</li>
          <li>The page address, the site’s name or the page title</li>
          <li>Anything you typed, and the values in any form</li>
          <li>Your fit, your settings, or which sites you visit</li>
        </ul>
        <h3>When it never runs</h3>
        <p>
          On password and payment pages, on pages that aren’t in English, and
          when you are signed out or have turned page analysis off. Turning it
          off stops sending at once, and WebAble keeps working with its own
          rules.
        </p>
        <h3>Limits on the server</h3>
        <p>
          To prevent abuse, WebAble’s server counts page analysis requests for
          each account. The counts are deleted after 2 days, and the requests
          themselves are never stored.
        </p>
      </DocSection>

      <DocSection id="product-learning" title="Product learning">
        <p>
          Off unless you turn it on. When it is on, the extension reports
          whether changes helped, as coarse counts with random noise added on
          your device and without your account. Totals are only published for
          groups of 50 devices or more, so no one person’s answers can be picked
          out.
        </p>
      </DocSection>

      <DocSection id="choices" title="Download or delete">
        <ul>
          <li>
            Download your data from{' '}
            <TextLink href="/app/privacy">Privacy in your account</TextLink>:
            one file with everything your account holds.
          </li>
          <li>
            Delete your account from the same page. It removes your account and
            everything tied to it, all at once.
          </li>
          <li>
            Removing the extension from Chrome deletes what it kept in that
            browser.
          </li>
        </ul>
        <p>
          WebAble uses the data it handles only to fit pages to you. It is never
          used for ads, sold, or used to judge anyone.
        </p>
      </DocSection>

      <DocSection id="contact" title="Questions">
        <ContactLine lead="Ask us anything about your data:" />
      </DocSection>
    </DocPage>
  );
}
