import { FitMark, Icon, StatusShape } from '@webable/ui';
import Image from 'next/image';
import { BrowserWindow } from '../kit/BrowserWindow';
import { LENS_SHOT } from './lens';
import { withBase } from '../../../lib/base-path';

/** WebAble's window on one page: each change in words, each with its own Undo. */
function PopupVisual() {
  return (
    <div
      className="wm-popup"
      role="img"
      aria-label="WebAble's window on news.example.com. Three changes: text size 13 to 18 pixels, click targets 24 to 44 pixels, moving things 3 to 0. Each has an Undo button, with Undo all and Pause on this site below."
    >
      <div className="wm-popup__head">
        <StatusShape state="adapted" size={16} className="wm-popup__glyph" />
        <span className="wm-popup__title">Adapted</span>
        <span className="wm-popup__site">news.example.com</span>
      </div>
      <ul role="list" className="wm-popup__rows">
        <li>
          <FitMark label="Text size" from={13} to={18} unit="px" />
          <span className="wm-popup__undo">Undo</span>
        </li>
        <li>
          <FitMark label="Click targets" from={24} to={44} unit="px" />
          <span className="wm-popup__undo">Undo</span>
        </li>
        <li>
          <FitMark label="Moving things" from={3} to={0} />
          <span className="wm-popup__undo">Undo</span>
        </li>
      </ul>
      <div className="wm-popup__foot">
        <span className="wm-popup__all">
          <Icon name="rotate-ccw" size={16} />
          Undo all
        </span>
        <span className="wm-popup__pause">
          <Icon name="pause" size={16} />
          Pause on this site
        </span>
      </div>
    </div>
  );
}

/** A wireframe of a busy page: the article stays, the ads and side column settle. */
function CalmVisual() {
  return (
    <div
      className="wm-calm"
      role="img"
      aria-label="A busy news page with WebAble: the article stays in front, the ads stop moving and the side column fades back."
    >
      <div className="wm-calm__page">
        <span className="wm-calm__bar" />
        <div className="wm-calm__cols">
          <div className="wm-calm__main">
            <span className="wm-calm__h" />
            <span className="wm-calm__line" />
            <span className="wm-calm__line" />
            <span className="wm-calm__line wm-calm__line--short" />
            <span className="wm-calm__line" />
            <span className="wm-calm__line wm-calm__line--short" />
          </div>
          <div className="wm-calm__rail">
            <span className="wm-calm__ad">
              <Icon name="pause" size={16} />
              <span>Paused</span>
            </span>
            <span className="wm-calm__ad wm-calm__ad--faded" />
            <span className="wm-calm__line wm-calm__line--faded" />
            <span className="wm-calm__line wm-calm__line--faded wm-calm__line--short" />
          </div>
        </div>
      </div>
    </div>
  );
}

const SITES = [
  { initial: 'N', domain: 'news.example.com', state: 'Fitted' },
  { initial: 'R', domain: 'recipes.example.com', state: 'Fitted' },
  { initial: 'P', domain: 'pharmacy.example.com', state: 'Fitted' },
  { initial: 'B', domain: 'bank.example.com', state: 'Paused by you' },
] as const;

/** One fit, many sites: each with its state, one paused by the person. */
function SitesVisual() {
  return (
    <div
      className="wm-sites"
      role="img"
      aria-label="Four sites using the same fit. Three are fitted; the bank site is paused by the person."
    >
      {SITES.map((site) => (
        <div
          key={site.domain}
          className="wm-sites__row"
          data-paused={site.state === 'Fitted' ? undefined : ''}
        >
          <span className="wm-sites__icon">{site.initial}</span>
          <span className="wm-sites__domain">{site.domain}</span>
          <span className="wm-sites__state">{site.state}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * What WebAble does once it is running, as a bento: the Jev Lens screenshot
 * across the top (the most credible part of the story), then three cards, each
 * a title, one sentence and a small picture of the thing itself.
 */
export function Features() {
  return (
    <div className="wm-bento">
      <article className="wm-card wm-card--wide" aria-labelledby="verify-title">
        <div className="wm-card__head">
          <h3 id="verify-title" className="wm-h3">
            Checked before it stays
          </h3>
          <p className="wm-card__text">
            Every rewrite is checked by code and by Jev, the model WebAble uses
            to read pages. If a number, a link or a fact changed, the paragraph
            keeps the page’s own words. Layout changes are checked for eight
            kinds of breakage, and put back if they break something.
          </p>
        </div>
        <figure className="wm-lens">
          <BrowserWindow domain="cbsnews.com">
            <Image
              className="wm-lens__shot"
              src={withBase(LENS_SHOT.src)}
              alt={LENS_SHOT.alt}
              width={LENS_SHOT.width}
              height={LENS_SHOT.height}
              sizes="(min-width: 80em) 72rem, 100vw"
            />
          </BrowserWindow>
          <figcaption className="wm-lens__caption">
            The Jev Lens, WebAble’s view of what it decided on a page, on a CBS
            News story on 18 November 2026. Jev picked 9 of 11 paragraphs to
            rewrite. 4 rewrites passed and stayed, with green tags. 5 failed a
            check, so those paragraphs kept the page’s words, with orange tags.
          </figcaption>
        </figure>
      </article>

      <article className="wm-card" aria-labelledby="feature-changes">
        <div className="wm-card__head">
          <h3 id="feature-changes" className="wm-h3">
            Every change, in plain words
          </h3>
          <p className="wm-card__text">
            Open WebAble on any page to see what it changed. Undo one change,
            all of them, or pause the site.
          </p>
        </div>
        <div className="wm-card__visual">
          <PopupVisual />
        </div>
      </article>

      <article className="wm-card" aria-labelledby="feature-calm">
        <div className="wm-card__head">
          <h3 id="feature-calm" className="wm-h3">
            Busy pages settle down
          </h3>
          <p className="wm-card__text">
            Ads stop moving and side columns fade back, so the thing you came
            for comes forward. Every link still works.
          </p>
        </div>
        <div className="wm-card__visual">
          <CalmVisual />
        </div>
      </article>

      <article className="wm-card" aria-labelledby="feature-sites">
        <div className="wm-card__head">
          <h3 id="feature-sites" className="wm-h3">
            One fit, every site
          </h3>
          <p className="wm-card__text">
            Your fit is saved to your account and works on the sites you already
            use. Pause any site you’d rather leave alone.
          </p>
        </div>
        <div className="wm-card__visual">
          <SitesVisual />
        </div>
      </article>
    </div>
  );
}
