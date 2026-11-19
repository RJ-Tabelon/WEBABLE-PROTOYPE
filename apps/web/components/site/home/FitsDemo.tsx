import { FitMark, Icon } from '@webable/ui';
import Image from 'next/image';
import { BrowserWindow } from '../kit/BrowserWindow';
import {
  FIT_PEOPLE,
  FITS_CAPTURED_ON,
  FITS_SHOT_SIZE,
  isDoneChange,
} from './fits';
import { withBase } from '../../../lib/base-path';

/**
 * "Different people, different fits": real screenshots of the same passage of
 * one NPR story, fitted for three sample people side by side. Each sits in a
 * small browser window that runs off its tinted stage, so the text shows near
 * the size it had on screen; under it, what got in that person's way and what
 * WebAble did, from its own record. Nothing to choose: the three sit in one row
 * at ≥64em and stack below.
 */
export function FitsDemo() {
  return (
    <div className="wm-fits-wrap">
      <div className="wm-fits">
        {FIT_PEOPLE.map((person) => (
          <figure key={person.id} className="wm-fit">
            <div className="wm-fit__stage" data-tone={person.id}>
              <BrowserWindow
                domain="npr.org"
                compact
                className="wm-fit__window"
              >
                <Image
                  className="wm-fit__shot"
                  src={withBase(person.shot.src)}
                  alt={person.shot.alt}
                  width={FITS_SHOT_SIZE.width}
                  height={FITS_SHOT_SIZE.height}
                  sizes="34rem"
                />
              </BrowserWindow>
            </div>
            <figcaption className="wm-fit__caption">
              <span className="wm-fit__who">{person.struggle}</span>
            </figcaption>
            <ul role="list" className="ws-fit__marks wm-fit__marks">
              {person.changes.map((c) =>
                isDoneChange(c) ? (
                  <li key={c.said} className="wm-fit__did">
                    <Icon name="check" size={16} />
                    <span>{c.said}</span>
                  </li>
                ) : (
                  <li key={c.label}>
                    <FitMark
                      label={c.label}
                      from={c.from}
                      to={c.to}
                      unit={c.unit}
                    />
                  </li>
                ),
              )}
            </ul>
          </figure>
        ))}
      </div>
      <p className="wm-fits__note">
        Real screenshots of WebAble in Chrome, {FITS_CAPTURED_ON}, on the same
        NPR story for three sample people. It’s a page for reading, so all three
        got WebAble’s simpler version. WebAble isn’t affiliated with NPR.
      </p>
    </div>
  );
}
