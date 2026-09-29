import { OP_CATALOG, OP_IDS } from '@webable/core/ops/catalog';
import { Kbd, TextLink } from '@webable/ui';
import type { ReactNode } from 'react';
import { ContactLine, DOCS_UPDATED } from './ContactLine';
import { DocPage, DocSection, Fact, type TocEntry } from './DocPage';

const TOC: readonly TocEntry[] = [
  { id: 'start', title: 'Getting started' },
  { id: 'changes', title: 'What WebAble changes' },
  { id: 'undo', title: 'Undo, pause and turn off' },
  { id: 'privacy', title: 'Privacy and site access' },
  { id: 'keys', title: 'Keyboard shortcuts' },
  { id: 'contact', title: 'Contact' },
];

function Question({
  id,
  q,
  children,
}: {
  id: string;
  q: string;
  children: ReactNode;
}) {
  return (
    <div className="ws-faq">
      <h3 id={id} className="ws-faq__q">
        {q}
      </h3>
      <div className="ws-faq__a ws-prose">{children}</div>
    </div>
  );
}

/**
 * Help (FAQ). Every answer is open: help is never hidden behind a disclosure
 * (design-final §7.12, WCAG 3.2.6), and the contact section is always at the end.
 */
export function HelpDoc() {
  return (
    <DocPage
      eyebrow={`Updated ${DOCS_UPDATED}`}
      title="Help"
      deck="Short answers about setting up WebAble, what it changes, how to undo anything, and what it sends."
      toc={TOC}
    >
      <DocSection id="start" title="Getting started">
        <Question id="what-is" q="What is WebAble?">
          <p>
            A Chrome extension that fits websites to how you read, point and
            focus. It changes things like text size, click targets and motion,
            shows you each change, and lets you undo it.
          </p>
        </Question>
        <Question id="need" q="What do I need?">
          <p>
            Chrome 135 or later on a computer. WebAble works only in Chrome for
            now. An account is optional, and lets your fit follow you to other
            computers.
          </p>
        </Question>
        <Question id="setup" q="How do I set it up?">
          <p>
            Choose <TextLink href="/tune">Get started</TextLink> and tune
            WebAble, which takes about 6 minutes. Then add the extension to
            Chrome and allow it to change pages. WebAble also makes small, safe
            changes before you tune.
          </p>
        </Question>
        <Question id="tune-again" q="Can I tune again, or skip parts?">
          <p>
            Yes to both. You can skip any part of Tune, and tune again at any
            time. Each Tune saves a new version of your fit, so you can go back.
          </p>
        </Question>
        <Question id="right-answer" q="Is there a right answer in Tune?">
          <p>
            No. There’s no passing or failing. Tune measures what fits you, not
            how well you do.
          </p>
        </Question>
      </DocSection>

      <DocSection
        id="changes"
        title="What WebAble changes"
        deck="Only changes from this reviewed list, each within a fixed range. WebAble never rewrites page text."
      >
        <dl className="ws-facts">
          {OP_IDS.map((id) => (
            <Fact key={id} term={OP_CATALOG[id].label}>
              {OP_CATALOG[id].description}
            </Fact>
          ))}
        </dl>
        <Question id="see-changes" q="How do I see what changed?">
          <p>
            Select the WebAble button in Chrome’s toolbar. Its “What changed”
            list shows each change with its before and after values. “Show on
            page” outlines where each one is.
          </p>
        </Question>
        <Question id="never-changes" q="What doesn’t WebAble change?">
          <p>
            It never changes page text, a page’s ARIA, the names of its
            controls, its focus order or its keyboard handling. It can’t add
            missing image descriptions or captions, and it can’t change Chrome’s
            own pages or the Chrome Web Store.
          </p>
        </Question>
        <Question id="undone" q="Why did WebAble undo a change on its own?">
          <p>
            After every change, WebAble checks the page for problems such as
            text that overlaps or is cut off. If a change causes one, WebAble
            puts it back and tells you why in the “What changed” list.
          </p>
        </Question>
        <Question id="suggestions" q="Why did WebAble ask me a question?">
          <p>
            When something on a page seems hard to use, WebAble may ask whether
            to change it, for example “Make buttons bigger on this site?” It
            never changes anything from what it notices without asking. Choose
            Not now and it won’t ask again on that site for 7 days.
          </p>
        </Question>
      </DocSection>

      <DocSection id="undo" title="Undo, pause and turn off">
        <Question id="undo-one" q="How do I undo a change?">
          <p>
            Open WebAble from Chrome’s toolbar and choose Undo next to the
            change, or Undo all for the whole page. You can also press{' '}
            <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>U</Kbd> on the page.
          </p>
        </Question>
        <Question id="pause" q="How do I pause WebAble on one site?">
          <p>
            Open WebAble from the toolbar and switch off “WebAble on this site”.
            The site then looks the way it made itself until you switch it back
            on.
          </p>
        </Question>
        <Question id="off" q="How do I turn WebAble off everywhere?">
          <p>
            Open WebAble, go to Settings, and choose “Turn WebAble off
            everywhere”. You can also remove the extension from Chrome at any
            time.
          </p>
        </Question>
      </DocSection>

      <DocSection id="privacy" title="Privacy and site access">
        <Question id="sent" q="What does WebAble send?">
          <p>
            Only if you turn on page analysis: the structure of parts of a page,
            never its text, what you type or which sites you visit. The details
            are on{' '}
            <TextLink href="/privacy#what-webable-sends">
              What WebAble sends
            </TextLink>
            .
          </p>
        </Question>
        <Question id="access" q="Why does WebAble ask for access to all sites?">
          <p>
            To fit a page as it loads, Chrome requires an extension to have
            access to that site. WebAble asks once, with a button you choose to
            press. You can limit it to certain sites in Chrome’s extension
            settings, and WebAble then works only there.
          </p>
        </Question>
      </DocSection>

      <DocSection
        id="keys"
        title="Keyboard shortcuts"
        deck="You can change them in Chrome at chrome://extensions/shortcuts."
      >
        <dl className="ws-keys">
          <div className="ws-keys__row">
            <dt>Move to WebAble’s message on the page</dt>
            <dd>
              <Kbd>Alt</Kbd>
              <Kbd>Shift</Kbd>
              <Kbd>W</Kbd>
            </dd>
          </div>
          <div className="ws-keys__row">
            <dt>Undo all changes on this page</dt>
            <dd>
              <Kbd>Alt</Kbd>
              <Kbd>Shift</Kbd>
              <Kbd>U</Kbd>
            </dd>
          </div>
          <div className="ws-keys__row">
            <dt>Go back from WebAble’s message</dt>
            <dd>
              <Kbd>Esc</Kbd>
            </dd>
          </div>
        </dl>
      </DocSection>

      <DocSection
        id="contact"
        title="Contact"
        deck="Stuck, or something isn’t right? Tell us what you were doing and what happened."
      >
        <ContactLine lead="Write to the WebAble team:" />
        <p className="ws-secondary">
          Please don’t include passwords or personal details you wouldn’t want
          to share.
        </p>
      </DocSection>
    </DocPage>
  );
}
