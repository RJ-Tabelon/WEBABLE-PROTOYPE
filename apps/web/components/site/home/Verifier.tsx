import { FitArrow, Icon } from '@webable/ui';
import { OP_CATALOG } from '@webable/core/ops/catalog';
import { SAMPLE_ORIGINAL } from '../sample/model';

/** The checks WebAble runs after every change (docs/08 §1, engine.md §4.2). */
export const VERIFIER_CHECKS = [
  { id: 'clip', name: 'Text cut off' },
  { id: 'overlap', name: 'Text overlap' },
  { id: 'overflow', name: 'Sideways scrolling' },
  { id: 'contrast', name: 'Contrast' },
  { id: 'focus-hidden', name: 'Hidden focus' },
  { id: 'collapsed', name: 'Collapsed controls' },
  { id: 'focus-lost', name: 'Lost focus' },
] as const;

/** The line spacing WebAble tried on the product card: the top of its reviewed ladder. */
const TRIED_LINE_HEIGHT = OP_CATALOG.line_spacing.levels.at(-1) ?? 2;

function ProductCard({ tried }: { tried: boolean }) {
  return (
    <div className="ws-card" data-tried={tried ? '' : undefined}>
      <div className="ws-card__photo" />
      <div className="ws-card__info">
        <p className="ws-card__title">Canvas weekend bag</p>
        <div className="ws-card__desc">
          <p>
            Waxed cotton with leather handles and a zip pocket inside. Fits a
            laptop up to 14 inches.
          </p>
        </div>
        <div className="ws-card__row">
          <span className="ws-card__price">$68</span>
          <span className="ws-card__button">Add to basket</span>
          {tried ? (
            <span className="ws-card__overlap">
              <span className="ws-card__overlap-label">Text overlap</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * "Checked before it stays": a change that was undone because it made text overlap.
 * Showing what WebAble refuses to keep is the most credible part of the story.
 * A rollback is shown neutrally, never as an alarm (design-final §10.2).
 */
export function Verifier() {
  const tried = TRIED_LINE_HEIGHT.toFixed(1);
  const original = SAMPLE_ORIGINAL.lineHeight.toFixed(1);
  return (
    <div className="ws-verify">
      <div className="ws-tiles">
        <figure className="ws-tile">
          <figcaption className="ws-tile__caption">
            <strong>Tried</strong>
            <span className="ws-tile__change">
              Line spacing
              <span className="ws-tile__value">
                {original}
                <span className="sr-only"> to </span>
                <FitArrow className="ws-tile__arrow" />
                {tried}
              </span>
            </span>
          </figcaption>
          <div
            className="ws-tile__frame"
            role="img"
            aria-label={`A product card with line spacing ${tried}. The description runs into the price and the Add to basket button.`}
          >
            <ProductCard tried />
          </div>
        </figure>
        <figure className="ws-tile">
          <figcaption className="ws-tile__caption">
            <strong>Put back</strong>
            <span>
              Line spacing <span className="ws-tile__value">{original}</span>
            </span>
          </figcaption>
          <div
            className="ws-tile__frame"
            role="img"
            aria-label="The same product card as the site made it. Nothing overlaps."
          >
            <ProductCard tried={false} />
          </div>
        </figure>
      </div>

      <div>
        <p className="ws-checks__head" id="verify-checks">
          Checks after the change
        </p>
        <ol role="list" className="ws-checks" aria-labelledby="verify-checks">
          {VERIFIER_CHECKS.map((check) => {
            const found = check.id === 'overlap';
            return (
              <li key={check.id} data-found={found ? '' : undefined}>
                <Icon
                  name={found ? 'x' : 'check'}
                  size={20}
                  className="ws-checks__glyph"
                />
                <span className="ws-checks__name">{check.name}</span>
                <span className="ws-checks__result">
                  {found ? 'Found' : 'Passed'}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="ws-undone">
          <Icon name="rotate-ccw" size={16} className="ws-undone__glyph" />
          <p className="ws-undone__title">Line spacing was undone</p>
          <p className="ws-undone__text">
            It made text overlap here, so WebAble put it back.
          </p>
        </div>
      </div>
    </div>
  );
}
