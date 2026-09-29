import { Icon } from '@webable/ui';
import type { ReactNode } from 'react';
import { SAMPLE_ORIGINAL } from './sample/model';

export interface FrameChromeProps {
  /** The WebAble state for this page: a status glyph and a short label. */
  status: ReactNode;
  /** Domain shown in the address line. */
  domain?: string;
  /**
   * An interactive control that belongs to the frame, such as the hero's
   * Original / Fitted switch. It sits at the end of the strip, like an extension's
   * button in a browser toolbar.
   */
  control?: ReactNode;
}

/**
 * The top strip of a preview frame: the sample page's address and WebAble's state
 * for it, like a browser window with the extension running. The address and state
 * are decorative (the figure carries the description); the optional control is not.
 */
export function FrameChrome({
  status,
  domain = SAMPLE_ORIGINAL.domain,
  control,
}: FrameChromeProps) {
  return (
    <div className="ws-frame__chrome" data-control={control ? '' : undefined}>
      <span className="ws-frame__meta" aria-hidden="true">
        <span className="ws-frame__address">
          <Icon name="lock" size={16} />
          {domain}
        </span>
        <span className="ws-frame__status">{status}</span>
      </span>
      {control ? <div className="ws-frame__control">{control}</div> : null}
    </div>
  );
}
