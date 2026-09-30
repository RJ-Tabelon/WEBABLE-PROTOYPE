import { FitMark } from '@webable/ui';
import { PROFILE_FITS, marksFor } from '../sample/model';
import { SamplePage } from '../sample/SamplePage';

/**
 * "Different people, different fits": the same crop of the sample page's article
 * column (masthead, headline, icon row, first paragraph), rendered with three fits
 * side by side, each with the model's real values underneath. Nothing to choose:
 * the three sit in one row at ≥64em and stack below. The focus fit's softened
 * masthead is the real focus_view op.
 */
export function FitsDemo() {
  return (
    <div className="ws-fits">
      {PROFILE_FITS.map((profile) => {
        const marks = marksFor(profile.fit);
        return (
          <figure key={profile.id} className="ws-fit">
            <figcaption className="ws-fit__head">{profile.head}</figcaption>
            <div className="ws-fit__frame" data-theme="light">
              <SamplePage
                fit={profile.fit}
                crop="article"
                showHitAreas
                label="The top of the sample news page, with this fit."
              />
            </div>
            <ul role="list" className="ws-fit__marks">
              {marks.map((m) => (
                <li key={m.id}>
                  <FitMark
                    label={m.label}
                    from={m.from}
                    to={m.to}
                    unit={m.unit}
                  />
                </li>
              ))}
            </ul>
          </figure>
        );
      })}
    </div>
  );
}
