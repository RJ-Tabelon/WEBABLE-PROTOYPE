'use client';

import { Button, FitMarkBlock, SectionHeader } from '@webable/ui';
import { useSearchParams } from 'next/navigation';

import { SiteShell } from '../../../../components/shell/SiteShell';

/** `?signedIn=1` previews the header a signed-in visitor sees. */
export function SiteShellPreviewView() {
  return (
    <SiteShell signedIn={useSearchParams().get('signedIn') === '1'}>
      <p className="g-preview-note">
        Preview of the site shell. Content is placeholder copy from the design
        spec.
      </p>
      <div className="wa-container">
        <section className="g-hero" aria-labelledby="preview-hero">
          <h1 id="preview-hero" className="wa-display">
            The web, made to measure.
          </h1>
          <p className="g-hero__deck">
            WebAble learns how you read, point and focus, then adjusts each site
            to fit. You see every change and can undo it.
          </p>
          <div>
            <Button href="/get" variant="primary" arrow="forward">
              Add to Chrome
            </Button>
          </div>
        </section>
        <section id="how" className="wa-section" aria-labelledby="preview-how">
          <SectionHeader
            eyebrow="3 short tasks · about 6 min"
            title="Three short tasks. Then every site fits."
            deck="WebAble measures how you read, point and focus. It never asks for a diagnosis."
            titleId="preview-how"
            link={{ href: '/research', label: 'See the research' }}
          />
          <div style={{ maxInlineSize: '20rem' }}>
            <FitMarkBlock label="Text size" from={13} to={18} unit="px" draw />
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
