import type { PageSnapshot } from '@webable/shared';

const EXCERPT_LIMIT = 2_000;
const HEADING_LIMIT = 25;
export const READABLE_TEXT_SELECTOR =
  'p, li, dd, dt, blockquote, figcaption, label, button, a, td, th, span';
const LANDMARK_SELECTOR =
  'main, nav, aside, header, footer, form, [role="main"], [role="navigation"], [role="complementary"], [role="banner"], [role="contentinfo"], [role="form"], [role="search"]';

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const PRIVATE_OR_NON_CONTENT_SELECTOR =
  'script, style, noscript, template, svg, canvas, input, textarea, select, option, [hidden], [aria-hidden="true"]';

export function isElementVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  let current: Element | null = element;

  while (current) {
    if (
      current.hasAttribute('hidden') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return false;
    }

    const style = view?.getComputedStyle(current);

    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    ) {
      return false;
    }

    current = current.parentElement;
  }

  return true;
}

function readableBodyText(document: Document): string {
  if (!document.body) {
    return '';
  }

  const text: string[] = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;

        if (
          !parent ||
          parent.closest(PRIVATE_OR_NON_CONTENT_SELECTOR) ||
          !isElementVisible(parent)
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return normalizedText(node.nodeValue).length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );

  while (walker.nextNode()) {
    text.push(walker.currentNode.nodeValue ?? '');
  }

  return normalizedText(text.join(' '));
}

function countWords(text: string): number {
  return text.length === 0 ? 0 : text.split(/\s+/).length;
}

function landmarkName(element: Element): string {
  return element.getAttribute('role') ?? element.tagName.toLowerCase();
}

function numericPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readPage(
  document: Document,
  location: Location,
  domRevision = 0,
): PageSnapshot {
  const fullText = readableBodyText(document);
  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href]'),
  ).filter(isElementVisible);
  const sameOrigin = anchors.filter((anchor) => {
    try {
      return new URL(anchor.href, location.href).origin === location.origin;
    } catch {
      return false;
    }
  }).length;
  const images = Array.from(document.images).filter(isElementVisible);
  const headings = Array.from(
    document.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'),
  ).filter(isElementVisible);
  const readableElements = Array.from(
    document.querySelectorAll<HTMLElement>(READABLE_TEXT_SELECTOR),
  ).filter(
    (element) =>
      isElementVisible(element) &&
      normalizedText(element.textContent).length > 0,
  );
  const view = document.defaultView;
  const documentElement = document.documentElement;
  const viewportWidth = Math.max(0, view?.innerWidth ?? 0);
  const viewportHeight = Math.max(0, view?.innerHeight ?? 0);
  const documentWidth = Math.max(0, documentElement.scrollWidth);
  const documentHeight = Math.max(0, documentElement.scrollHeight);
  const fixedOrStickyElements = Array.from(
    document.querySelectorAll<HTMLElement>('body *'),
  ).filter((element) => {
    if (!isElementVisible(element)) return false;
    const position = view?.getComputedStyle(element).position;
    return position === 'fixed' || position === 'sticky';
  }).length;

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    url: location.href,
    title: normalizedText(document.title),
    language: document.documentElement.lang || 'unknown',
    text: {
      excerpt: fullText.slice(0, EXCERPT_LIMIT),
      wordCount: countWords(fullText),
      truncated: fullText.length > EXCERPT_LIMIT,
      visibleElements: readableElements.length,
      belowMinimumSize: readableElements.filter(
        (element) =>
          numericPixels(view?.getComputedStyle(element).fontSize ?? '0') < 16,
      ).length,
    },
    headingCount: headings.length,
    headings: headings
      .slice(0, HEADING_LIMIT)
      .map((heading) => ({
        level: Number(heading.tagName.slice(1)),
        text: normalizedText(heading.textContent),
      }))
      .filter((heading) => heading.text.length > 0),
    links: {
      total: anchors.length,
      sameOrigin,
      external: anchors.length - sameOrigin,
    },
    controls: {
      buttons: Array.from(
        document.querySelectorAll('button, [role="button"]'),
      ).filter(isElementVisible).length,
      inputs: Array.from(document.querySelectorAll('input')).filter(
        isElementVisible,
      ).length,
      selects: Array.from(document.querySelectorAll('select')).filter(
        isElementVisible,
      ).length,
      textareas: Array.from(document.querySelectorAll('textarea')).filter(
        isElementVisible,
      ).length,
    },
    images: {
      total: images.length,
      withAlt: images.filter((image) => image.hasAttribute('alt')).length,
      withoutAlt: images.filter((image) => !image.hasAttribute('alt')).length,
    },
    landmarks: Array.from(document.querySelectorAll(LANDMARK_SELECTOR))
      .filter(isElementVisible)
      .map(landmarkName),
    layout: {
      viewportWidth,
      viewportHeight,
      documentWidth,
      documentHeight,
      hasHorizontalOverflow: documentWidth > viewportWidth + 1,
      fixedOrStickyElements,
    },
    domRevision,
  };
}
