// Owner: C, D (round 4: the article header). The first band of the Calm view: an optional eyebrow (the page's caption), the page's title, one
// orientation line in the page's own words, one pinned sentence when it carries a time, money or a rule, and the rest
// of the page's intro behind "About this page". Nothing here is written by us or by a model.
import type { JSX } from 'preact';
import { Blocks, InlineLink, Picture, renderParts } from './Blocks';
import { useCalm } from './context';
import { InlineDisclosure } from './Disclosure';
import { Speaker } from './icons';
import { LiveDot, isLiveText } from './markers';
import type { Inline } from './model';
import type { ArticleHead, Lead } from './plan';

function Parts({ parts }: { parts: Inline[] }): JSX.Element {
  return <>{renderParts(parts)}</>;
}

export function LeadBand({ lead, small = false }: { lead: Lead; small?: boolean }): JSX.Element {
  const Title = lead.titleSize === 'page' ? 'h1' : 'h2';
  const hasLine = !!(lead.orient || lead.pinned);
  return (
    <header class="wa-lead">
      {lead.eyebrow && <p class="wa-eyebrow wa-lead__eyebrow">{lead.eyebrow}</p>}
      {lead.title && <Title class={lead.titleSize === 'page' && !small ? 'wa-h-page' : 'wa-h-section'}>{lead.title}</Title>}
      {(hasLine || lead.about.length > 0) && (
        <div class="wa-orient">
          {lead.orient && (
            <span class="wa-orient__line">
              <Parts parts={lead.orient} />{' '}
            </span>
          )}
          {lead.pinned && (
            <span class="wa-orient__pin">
              <Parts parts={lead.pinned} />{' '}
            </span>
          )}
          {lead.about.length > 0 && (
            <InlineDisclosure label="About this page">
              <Blocks blocks={lead.about} />
            </InlineDisclosure>
          )}
        </div>
      )}
    </header>
  );
}

/**
 * An article's header (design.md §2): kicker · date, then the title (left-aligned), the dek, the byline with each name
 * once (the page's own links), and the lead picture in the picture column with its caption and credit.
 */
export function ArticleHeader({ lead, art, readLine = null, listen = null }: {
  lead: Lead | null; art: ArticleHead; readLine?: string | null;
  /** Round 8b: the article's own Listen control; one quiet button under the byline presses it. */
  listen?: Element | null;
}): JSX.Element {
  const ctx = useCalm();
  const meta = [art.kicker, art.date].filter((x): x is string => !!x);
  const by = art.byline;
  // Round 8: "N min read" under the headline: the page's own, else words / 230 (markers.readTimeLine).
  return (
    <header class="wa-art">
      {meta.length > 0 && (
        <p class="wa-art__meta wa-meta">
          {art.kicker && isLiveText(art.kicker) ? (
            <span class="wa-art__kicker wa-live">
              <LiveDot pulse={!!ctx.pulse} />
              {art.kicker}
            </span>
          ) : (
            art.kicker && <span class="wa-art__kicker">{art.kicker}</span>
          )}
          {art.kicker && art.date && (
            <span class="wa-sep" aria-hidden="true">
              ·
            </span>
          )}
          {art.date && <span>{art.date}</span>}
        </p>
      )}
      {lead?.title && <h1 class="wa-h-page">{lead.title}</h1>}
      {art.dek && <p class="wa-art__dek">{art.dek}</p>}
      {by && (
        <p class="wa-art__byline wa-meta">
          <span class="wa-art__names">
            {by.prefix && <span>{by.prefix} </span>}
            {by.names.length > 0
              ? by.names.map((n, i) => (
                  <span key={i}>
                    {i > 0 && ', '}
                    <InlineLink p={n} />
                  </span>
                ))
              : by.text}
          </span>
          {readLine && (
            <>
              <span class="wa-sep" aria-hidden="true">
                ·
              </span>
              <span class="wa-art__readtime">{readLine}</span>
            </>
          )}
        </p>
      )}
      {readLine && !by && <p class="wa-meta wa-readtime">{readLine}</p>}
      {listen && (
        <button type="button" class="wa-btn wa-listen" onClick={() => ctx.click(listen)}>
          <Speaker />
          <span>Listen to this article</span>
        </button>
      )}
      {art.lead && (
        <div class="wa-art__lead">
          <Picture b={art.lead} lead wide />
        </div>
      )}
    </header>
  );
}
