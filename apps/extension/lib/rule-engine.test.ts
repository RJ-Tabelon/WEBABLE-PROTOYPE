import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultPageRulePreferences,
  type PageRulePreferences,
} from '@webable/shared';

import { applyAccessibilityRules } from './rule-engine';

function preferences(
  overrides: Partial<PageRulePreferences>,
): PageRulePreferences {
  return { ...defaultPageRulePreferences, ...overrides };
}

describe('applyAccessibilityRules', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-webable-focus');
    document.documentElement.removeAttribute('data-webable-reduce-motion');
    document.documentElement.removeAttribute('data-webable-contrast');
    document.body.innerHTML = `
      <p id="small" style="font-size: 10px; line-height: 10px; letter-spacing: 0; word-spacing: 0; margin-bottom: 0">
        Small readable text
      </p>
      <p id="large" style="font-size: 20px">Already large text</p>
      <button id="action">Continue</button>
    `;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks only undersized text for the minimum-size rule', () => {
    applyAccessibilityRules(document, preferences({ minimumTextSize: true }));

    expect(
      document
        .querySelector('#small')
        ?.hasAttribute('data-webable-minimum-text'),
    ).toBe(true);
    expect(
      document
        .querySelector('#large')
        ?.hasAttribute('data-webable-minimum-text'),
    ).toBe(false);
    expect(
      document.querySelector('#webable-page-rules')?.textContent,
    ).toContain('font-size: 16px !important');
  });

  it('adds published minimum text-spacing markers', () => {
    applyAccessibilityRules(document, preferences({ textSpacing: true }));
    const small = document.querySelector('#small');

    expect(small?.hasAttribute('data-webable-line-height')).toBe(true);
    expect(small?.hasAttribute('data-webable-letter-spacing')).toBe(true);
    expect(small?.hasAttribute('data-webable-word-spacing')).toBe(true);
    expect(small?.hasAttribute('data-webable-paragraph-spacing')).toBe(true);
  });

  it('enables enhanced keyboard focus', () => {
    applyAccessibilityRules(document, preferences({ enhancedFocus: true }));

    expect(document.documentElement.dataset.webableFocus).toBe('true');
    expect(
      document.querySelector('#webable-page-rules')?.textContent,
    ).toContain(':focus-visible');
  });

  it('reduces motion and pauses autoplay media', () => {
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
    const video = document.createElement('video');
    video.autoplay = true;
    document.body.append(video);

    applyAccessibilityRules(document, preferences({ reduceMotion: true }));

    expect(document.documentElement.dataset.webableReduceMotion).toBe('true');
    expect(pause).toHaveBeenCalledOnce();
  });

  it.each(['high', 'dark'] as const)(
    'applies and removes the %s contrast mode',
    (contrastMode) => {
      applyAccessibilityRules(document, preferences({ contrastMode }));
      expect(document.documentElement.dataset.webableContrast).toBe(
        contrastMode,
      );

      applyAccessibilityRules(document, preferences({}));
      expect(document.documentElement.dataset.webableContrast).toBeUndefined();
    },
  );

  it('removes rule markers when rules are disabled', () => {
    applyAccessibilityRules(
      document,
      preferences({ minimumTextSize: true, textSpacing: true }),
    );
    applyAccessibilityRules(document, preferences({}));

    const small = document.querySelector('#small');
    expect(small?.hasAttribute('data-webable-minimum-text')).toBe(false);
    expect(small?.hasAttribute('data-webable-line-height')).toBe(false);
    expect(document.documentElement.hasAttribute('data-webable-contrast')).toBe(
      false,
    );
  });
});
