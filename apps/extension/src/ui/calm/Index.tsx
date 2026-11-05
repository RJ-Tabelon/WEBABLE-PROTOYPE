// Owner: D. A news home page in Calm view v3 (design.md §2, F3): the story the page itself makes most prominent, with
// its picture wide; six more top stories as rows (headline, two-line dek, time, a 16:9 picture on the right); then the
// page's own sections in page order, each with its first few stories and the rest behind "More in X (n)". Every word
// is the page's; every row presses the page's own link. Nothing is dropped: a section's other parts are in its "More".
import type { JSX } from 'preact';
import { Blocks, Picture, keepImage } from './Blocks';
import { useCalm } from './context';
import { Disclosure } from './Disclosure';
import { AdTag, Kicker, isAdItem, liveLabelFor } from './markers';
import type { CardLinkBlock } from './model';
import type { IndexPlan, IndexSection } from './plan';

function usePress(s: CardLinkBlock): (e: MouseEvent) => void {
  const ctx = useCalm();
  return (e: MouseEvent): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // our own href opens a new tab
    e.preventDefault();
    ctx.click(s.el);
  };
}

/** The lead story: a wide 16:9 picture, kicker, an h2-size headline, one dek line and the time. All one link. */
function LeadStory({ s }: { s: CardLinkBlock }): JSX.Element {
  const press = usePress(s);
  const ctx = useCalm();
  const pic = s.image && keepImage(s.image, true) ? s.image : null;
  const live = liveLabelFor(s.el, s.kicker, ctx.marks);
  const body = (
    <>
      {pic && <Picture b={pic} ratio={16 / 9} lead caption={false} />}
      {isAdItem(s.el, ctx.marks) && <AdTag />}
      <Kicker text={s.kicker} live={live} pulse={!!ctx.pulse} />
      <h2 class="wa-leadstory__title">{s.title}</h2>
      {s.dek && <p class="wa-leadstory__dek">{s.dek}</p>}
      {s.time && <span class="wa-time">{s.time}</span>}
    </>
  );
  return s.href ? (
    <a class="wa-leadstory" href={s.href} onClick={press}>
      {body}
    </a>
  ) : (
    <div class="wa-leadstory" role="link" tabIndex={0} onClick={() => ctx.click(s.el)} onKeyDown={(e) => e.key === 'Enter' && ctx.click(s.el)}>
      {body}
    </div>
  );
}

/** One story as a row: the words on the left, its picture on the right (above it on a narrow screen). */
export function StoryRow({ s }: { s: CardLinkBlock }): JSX.Element {
  const press = usePress(s);
  const ctx = useCalm();
  const pic = s.image && keepImage(s.image, true) ? s.image : null;
  const live = liveLabelFor(s.el, s.kicker, ctx.marks);
  const body = (
    <>
      <span class="wa-story__text">
        {isAdItem(s.el, ctx.marks) && <AdTag />}
        <Kicker text={s.kicker} live={live} pulse={!!ctx.pulse} />
        <span class="wa-story__title">{s.title}</span>
        {s.dek && <span class="wa-story__dek">{s.dek}</span>}
        {s.time && <span class="wa-time">{s.time}</span>}
      </span>
      {pic && (
        <span class="wa-story__thumb">
          <Picture b={pic} ratio={16 / 9} caption={false} />
        </span>
      )}
    </>
  );
  const cls = `wa-story${pic ? '' : ' wa-story--text'}`;
  return s.href ? (
    <a class={cls} href={s.href} onClick={press}>
      {body}
    </a>
  ) : (
    <button type="button" class={cls} style={{ textAlign: 'left', border: 0, background: 'transparent', font: 'inherit', cursor: 'pointer' }} onClick={() => ctx.click(s.el)}>
      {body}
    </button>
  );
}

function Stories({ list }: { list: CardLinkBlock[] }): JSX.Element {
  return (
    <div class="wa-stories">
      {list.map((s) => (
        <StoryRow key={s.key} s={s} />
      ))}
    </div>
  );
}

/** A section of the page: its title, its first stories, then "More in X (n)" with every other story and part. */
function IndexSectionView({ sec }: { sec: IndexSection }): JSX.Element {
  const more = sec.rest.length + sec.other.length > 0;
  if (!sec.title) {
    const all = [...sec.first, ...sec.rest];
    return (
      <section class="wa-isec wa-isec--plain" aria-label="More stories">
        <Disclosure title="More stories" count={all.length || null}>
          {all.length > 0 && <Stories list={all} />}
          {sec.other.length > 0 && <Blocks blocks={sec.other} />}
        </Disclosure>
      </section>
    );
  }
  if (!sec.first.length) {
    return (
      <section class="wa-isec" aria-label={sec.title}>
        <Disclosure title={sec.title}>
          <Blocks blocks={sec.other} />
        </Disclosure>
      </section>
    );
  }
  return (
    <section class="wa-isec" aria-label={sec.title}>
      <div class="wa-head">
        <h2 class="wa-h-section">{sec.title}</h2>
      </div>
      <Stories list={sec.first} />
      {more && (
        <div class="wa-isec__more">
          <Disclosure title={`More in ${sec.title}`} count={sec.rest.length || null} quiet>
            {sec.rest.length > 0 && <Stories list={sec.rest} />}
            {sec.other.length > 0 && <Blocks blocks={sec.other} />}
          </Disclosure>
        </div>
      )}
    </section>
  );
}

export function IndexView({ index }: { index: IndexPlan }): JSX.Element {
  return (
    <div class="wa-index">
      {index.lead && <LeadStory s={index.lead} />}
      {index.top.length > 0 && (
        <section aria-label="Top stories">
          <h2 class="wa-eyebrow wa-storyhead">Top stories</h2>
          <Stories list={index.top} />
        </section>
      )}
      {index.sections.map((sec) => (
        <IndexSectionView key={sec.key} sec={sec} />
      ))}
    </div>
  );
}
