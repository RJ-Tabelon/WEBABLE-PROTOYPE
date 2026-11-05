// Owner: round 8b (SIMPLIFIED.md rules 1, 5 and 8). The end of a reading page: the site's related stories as one
// clean list, "More from {site}" (uniform cards, or rows with the picture on the right when the text is enlarged), then
// the site's menu and footer links, de-duplicated, in one closed "Site links (N)" at the very end. Every word is the
// page's; every item presses the page's own link.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Picture, keepImage } from './Blocks';
import { useCalm } from './context';
import { Disclosure } from './Disclosure';
import { StoryRow } from './Index';
import type { CardLinkBlock, ControlBlock } from './model';
import type { CalmPlan } from './plan';

/** Stories shown before "Show more" (three rows of three cards at the widest). */
const FIRST = 9;

function usePress(el: Element): (e: MouseEvent) => void {
  const ctx = useCalm();
  return (e: MouseEvent): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // our own href opens a new tab
    e.preventDefault();
    ctx.click(el);
  };
}

/** A story's one short meta line: its time, else a length the page prints ("6 min read", "25 mins"). */
function metaOf(s: CardLinkBlock): string | null {
  return s.time ?? s.lines.find((l) => /\b\d+\s*(min(ute)?s?|hrs?|hours?)\b/i.test(l) && l.length <= 24) ?? null;
}

/** One story as a card: its picture on top (16:9), the title in ink at weight 600, then a short meta line. */
function StoryCard({ s, pictures }: { s: CardLinkBlock; pictures: boolean }): JSX.Element {
  const press = usePress(s.el);
  const ctx = useCalm();
  const pic = pictures && s.image && keepImage(s.image, true) ? s.image : null;
  const meta = metaOf(s);
  const body = (
    <>
      {pic && <Picture b={pic} ratio={16 / 9} caption={false} />}
      <span class="wa-card2__title">{s.title}</span>
      {meta && <span class="wa-meta">{meta}</span>}
    </>
  );
  return s.href ? (
    <a class="wa-card2" href={s.href} onClick={press}>
      {body}
    </a>
  ) : (
    <div class="wa-card2" role="link" tabIndex={0} onClick={() => ctx.click(s.el)} onKeyDown={(e) => e.key === 'Enter' && ctx.click(s.el)}>
      {body}
    </div>
  );
}

/**
 * "More from {site}": cards in a grid of auto-fill 340 px columns with 24 px gaps when every story has a picture (or
 * none has), so the cards are uniform; one column of rows (title left, picture right) when the text is enlarged past
 * 18 px or only some stories have pictures. No counts.
 */
export function MoreFrom({ plan, bodyPx }: { plan: CalmPlan; bodyPx: number }): JSX.Element | null {
  const [all, setAll] = useState(false);
  const list = plan.more;
  if (!list.length) return null;
  const site = plan.siteName && plan.siteName !== 'This page' ? plan.siteName : 'this site';
  const title = `More from ${site}`;
  const pictured = list.filter((s) => !!s.image && keepImage(s.image, true)).length;
  const uniform = pictured === 0 || pictured === list.length;
  const rows = bodyPx > 18 || !uniform;
  const shown = all ? list : list.slice(0, FIRST);
  return (
    <section class="wa-band wa-end" aria-label={title}>
      <h2 class="wa-h-section wa-end__title">{title}</h2>
      {rows ? (
        <div class="wa-stories">
          {shown.map((s) => (
            <StoryRow key={s.key} s={{ ...s, time: metaOf(s) }} />
          ))}
        </div>
      ) : (
        <div class="wa-cards">
          {shown.map((s) => (
            <StoryCard key={s.key} s={s} pictures={pictured > 0} />
          ))}
        </div>
      )}
      {list.length > FIRST && (
        <div class="wa-more">
          <button type="button" class="wa-btn" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : 'Show more'}
          </button>
        </div>
      )}
    </section>
  );
}

function SiteLink({ b }: { b: ControlBlock }): JSX.Element {
  const press = usePress(b.el);
  return (
    <a class="wa-sitelink" href={b.href ?? undefined} onClick={press}>
      {b.text}
    </a>
  );
}

/** The site's menu and footer links, de-duplicated, as a compact two- or three-column list in one closed disclosure. */
export function SiteLinks({ plan }: { plan: CalmPlan }): JSX.Element | null {
  const links = plan.siteLinks;
  if (!links.length) return null;
  return (
    <section class="wa-band wa-links" aria-label="Site links">
      <Disclosure title={`Site links (${links.length})`}>
        <ul class="wa-sitelinks">
          {links.map((l) => (
            <li key={l.key}>
              <SiteLink b={l} />
            </li>
          ))}
        </ul>
      </Disclosure>
    </section>
  );
}
