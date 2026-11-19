/**
 * The Jev Lens on a CBS News story: a real screenshot of WebAble in Chrome on
 * 18 November 2026, with the extension in this repo and its server running, at
 * a 1440 x 900 window and 2x pixels. The person is the hero's sample (the demo
 * fit plus the sample ChatGPT answer). The numbers in the copy are that page
 * view's own record: Jev read 11 paragraphs and picked 9; 4 rewrites passed
 * their checks and 5 kept the page's words. Retake the picture and the numbers
 * together.
 */
export const LENS_SHOT = {
  src: '/home/lens-cbs.webp',
  width: 2880,
  height: 1800,
  alt: 'A CBS News story about panic buying at Costco with the Jev Lens on. Each part of the page is outlined and labelled with Jev’s probability, like Headline 0.85 and Ad 0.96. Each paragraph has a tag, either “plainer words · rewritten” in green or “checked: kept the original” in orange. A side panel says Jev read 11 paragraphs, picked 9, rewrote 4, and 5 kept the page’s words after the check.',
} as const;
