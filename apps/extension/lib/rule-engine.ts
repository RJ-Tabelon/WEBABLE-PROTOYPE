import type { PageRulePreferences } from '@webable/shared';

import { isElementVisible, READABLE_TEXT_SELECTOR } from './page-reader';

const STYLE_ID = 'webable-page-rules';
const MINIMUM_TEXT_ATTRIBUTE = 'data-webable-minimum-text';
const LINE_HEIGHT_ATTRIBUTE = 'data-webable-line-height';
const LETTER_SPACING_ATTRIBUTE = 'data-webable-letter-spacing';
const WORD_SPACING_ATTRIBUTE = 'data-webable-word-spacing';
const PARAGRAPH_SPACING_ATTRIBUTE = 'data-webable-paragraph-spacing';

const RULE_CSS = `
[${MINIMUM_TEXT_ATTRIBUTE}] { font-size: 16px !important; }
[${LINE_HEIGHT_ATTRIBUTE}] { line-height: 1.5 !important; }
[${LETTER_SPACING_ATTRIBUTE}] { letter-spacing: 0.12em !important; }
[${WORD_SPACING_ATTRIBUTE}] { word-spacing: 0.16em !important; }
[${PARAGRAPH_SPACING_ATTRIBUTE}] { margin-bottom: 2em !important; }
html[data-webable-focus="true"] :focus-visible {
  outline: 3px solid #f0a629 !important;
  outline-offset: 3px !important;
}
html[data-webable-reduce-motion="true"] *,
html[data-webable-reduce-motion="true"] *::before,
html[data-webable-reduce-motion="true"] *::after {
  scroll-behavior: auto !important;
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
}
html[data-webable-contrast="high"],
html[data-webable-contrast="high"] body {
  color-scheme: light !important;
  color: #000 !important;
  background: #fff !important;
}
html[data-webable-contrast="high"] :where(main, article, section, aside, nav, header, footer, div, p, li, span) {
  color: inherit !important;
  background-color: transparent !important;
}
html[data-webable-contrast="high"] a { color: #003ea8 !important; }
html[data-webable-contrast="dark"],
html[data-webable-contrast="dark"] body {
  color-scheme: dark !important;
  color: #f7f7f2 !important;
  background: #111614 !important;
}
html[data-webable-contrast="dark"] :where(main, article, section, aside, nav, header, footer, div, p, li, span) {
  color: inherit !important;
  background-color: transparent !important;
}
html[data-webable-contrast="dark"] a { color: #91caff !important; }
`;

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ensureStyle(document: Document): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = RULE_CSS;
  (document.head ?? document.documentElement).append(style);
}

function setAttribute(element: Element, name: string, enabled: boolean): void {
  if (enabled) element.setAttribute(name, '');
  else element.removeAttribute(name);
}

function markReadableText(
  document: Document,
  preferences: PageRulePreferences,
): void {
  const view = document.defaultView;
  const readableElements = Array.from(
    document.querySelectorAll<HTMLElement>(READABLE_TEXT_SELECTOR),
  );

  // Always measure the page's own styles, not the result of a previous pass.
  readableElements.forEach((element) => {
    element.removeAttribute(MINIMUM_TEXT_ATTRIBUTE);
    element.removeAttribute(LINE_HEIGHT_ATTRIBUTE);
    element.removeAttribute(LETTER_SPACING_ATTRIBUTE);
    element.removeAttribute(WORD_SPACING_ATTRIBUTE);
    element.removeAttribute(PARAGRAPH_SPACING_ATTRIBUTE);
  });

  readableElements.forEach((element) => {
    if (!isElementVisible(element) || !element.textContent?.trim()) return;
    const style = view?.getComputedStyle(element);
    const fontSize = pixels(style?.fontSize ?? '0');
    const lineHeight =
      style?.lineHeight === 'normal'
        ? fontSize * 1.2
        : pixels(style?.lineHeight ?? '0');

    setAttribute(
      element,
      MINIMUM_TEXT_ATTRIBUTE,
      preferences.minimumTextSize && fontSize > 0 && fontSize < 16,
    );
    setAttribute(
      element,
      LINE_HEIGHT_ATTRIBUTE,
      preferences.textSpacing && lineHeight < fontSize * 1.5,
    );
    setAttribute(
      element,
      LETTER_SPACING_ATTRIBUTE,
      preferences.textSpacing &&
        pixels(style?.letterSpacing ?? '0') < fontSize * 0.12,
    );
    setAttribute(
      element,
      WORD_SPACING_ATTRIBUTE,
      preferences.textSpacing &&
        pixels(style?.wordSpacing ?? '0') < fontSize * 0.16,
    );
    setAttribute(
      element,
      PARAGRAPH_SPACING_ATTRIBUTE,
      preferences.textSpacing &&
        element.matches('p') &&
        pixels(style?.marginBottom ?? '0') < fontSize * 2,
    );
  });
}

export function applyAccessibilityRules(
  document: Document,
  preferences: PageRulePreferences,
): void {
  ensureStyle(document);
  markReadableText(document, preferences);

  const root = document.documentElement;
  root.dataset.webableFocus = String(preferences.enhancedFocus);
  root.dataset.webableReduceMotion = String(preferences.reduceMotion);

  if (preferences.contrastMode === 'unchanged') {
    delete root.dataset.webableContrast;
  } else {
    root.dataset.webableContrast = preferences.contrastMode;
  }

  if (preferences.reduceMotion) {
    document
      .querySelectorAll<HTMLMediaElement>('video[autoplay], audio[autoplay]')
      .forEach((media) => media.pause());
  }
}
