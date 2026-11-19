import { Icon } from '@webable/ui';
import type { ReactNode } from 'react';
import { SAMPLE_ORIGINAL } from './sample/model';

export interface FrameChromeProps {
  /** WebAble's state for this page: the status glyph (when adapted) and a short label. */
  status: ReactNode;
  /** Domain shown in the address line. */
  domain?: string;
}

/**
 * The top strip of the hero's preview frame: the sample page's address and
 * WebAble's state for it, like a browser window with the extension running. One
 * row; it is decorative (the figure carries the description), so it is hidden
 * from assistive technology. The Original / Fitted control sits beside it.
 */
export function FrameChrome({
  status,
  domain = SAMPLE_ORIGINAL.domain,
}: FrameChromeProps) {
  return (
    <div className="ws-frame__chrome" aria-hidden="true">
      <span className="ws-frame__address">
        <Icon name="lock" size={16} />
        <span className="ws-frame__domain">{domain}</span>
      </span>
      <span className="ws-frame__status">{status}</span>
    </div>
  );
}
